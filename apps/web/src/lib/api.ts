import type { ApiResponse, ErrorCode } from "@chat/shared";

export type ClientErrorCode = ErrorCode | "NETWORK_ERROR" | "TIMEOUT";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ClientErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let onUnauthenticated: (() => void) | undefined;
/** Called whenever the server reports the session is gone (expired, revoked, banned). */
export const setUnauthenticatedHandler = (fn: () => void) => void (onUnauthenticated = fn);

type Options = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Render's free tier can take ~50s to wake up, so the first request needs a generous timeout. */
  timeoutMs?: number;
};

/**
 * Fetch wrapper for the same-origin `/api` (Vite proxy in dev, Netlify proxy in production).
 * Unwraps the `{ success, data | error }` envelope and throws `ApiError` for every failure.
 */
export async function api<T>(path: string, { method = "GET", body, signal, timeoutMs = 30_000 }: Options = {}): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        "X-Requested-With": "chatapp",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (signal?.aborted) throw err; // cancelled by the caller (e.g. React Query) — not an error to show
    if (timeout.aborted) throw new ApiError(0, "TIMEOUT", "The server took too long to respond. Please try again.");
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection.");
  }

  if (res.status === 204) return undefined as T;

  let json: ApiResponse<T> | null = null;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    // Non-JSON: usually a proxy/gateway page while the backend is starting.
  }
  if (!json) {
    const waking = res.status === 502 || res.status === 503 || res.status === 504;
    throw new ApiError(
      res.status,
      "INTERNAL_ERROR",
      waking ? "The server is starting up. Try again in a moment." : "Unexpected response from the server.",
    );
  }
  if (!json.success) {
    if (json.error.code === "UNAUTHENTICATED") onUnauthenticated?.();
    throw new ApiError(res.status, json.error.code, json.error.message, json.error.fields);
  }
  return json.data;
}

export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : "Something went wrong. Please try again.";

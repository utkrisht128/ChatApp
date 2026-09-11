import type { z } from "zod";
import { ApiError } from "./api";

export type FieldErrors = Record<string, string>;

/** Client-side validation with the same schema the server uses. */
export function validate<S extends z.ZodType>(schema: S, values: unknown): { data?: z.output<S>; errors: FieldErrors } {
  const result = schema.safeParse(values);
  if (result.success) return { data: result.data, errors: {} };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) errors[String(issue.path[0] ?? "_")] ??= issue.message;
  return { errors };
}

/** Splits a server error into field errors (shown inline) and a form-level message. */
export function fromServer(err: unknown): { fields: FieldErrors; message?: string } {
  if (err instanceof ApiError) {
    const fields = err.fields ?? {};
    return { fields, message: Object.keys(fields).length ? undefined : err.message };
  }
  return { fields: {}, message: "Something went wrong. Please try again." };
}

/** Only allow same-app relative redirects (prevents open redirects via ?next=). */
export const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

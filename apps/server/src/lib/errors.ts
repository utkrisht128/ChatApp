import type { ErrorCode } from "@chat/shared";

/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, code: ErrorCode = "BAD_REQUEST") => new AppError(400, code, message);
export const unauthenticated = (message = "Please sign in to continue") =>
  new AppError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "You don't have permission to do that", code: ErrorCode = "FORBIDDEN") =>
  new AppError(403, code, message);
export const notFound = (code: ErrorCode = "NOT_FOUND", message = "Not found") => new AppError(404, code, message);
export const conflict = (code: ErrorCode, message: string, fields?: Record<string, string>) =>
  new AppError(409, code, message, fields);

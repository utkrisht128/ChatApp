/** Every API response uses one of these two envelopes. */
export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    /** Field-level validation messages, keyed by dotted path. */
    fields?: Record<string, string>;
  };
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "BAD_REQUEST",
  "UNAUTHENTICATED",
  "INVALID_CREDENTIALS",
  "EMAIL_NOT_VERIFIED",
  "ACCOUNT_BANNED",
  "FORBIDDEN",
  "CSRF_REJECTED",
  "NOT_FOUND",
  "USER_NOT_FOUND",
  "CHAT_NOT_FOUND",
  "MESSAGE_NOT_FOUND",
  "FILE_NOT_FOUND",
  "CONFLICT",
  "USERNAME_TAKEN",
  "EMAIL_TAKEN",
  "TOKEN_INVALID",
  "BLOCKED",
  "PAYLOAD_TOO_LARGE",
  "QUOTA_EXCEEDED",
  "UNSUPPORTED_MEDIA_TYPE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Cursor-paginated list. `nextCursor` is null when there is nothing older. */
export type Page<T> = { items: T[]; nextCursor: string | null };

import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import type { ApiFailure } from "@chat/shared";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";

const send = (res: Parameters<RequestHandler>[1], status: number, error: ApiFailure["error"]) =>
  res.status(status).json({ success: false, error } satisfies ApiFailure);

export const notFoundHandler: RequestHandler = (_req, res) =>
  send(res, 404, { code: "NOT_FOUND", message: "Route not found" });

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  if (err instanceof AppError) {
    return send(res, err.status, { code: err.code, message: err.message, fields: err.fields });
  }

  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    return send(res, 400, { code: "VALIDATION_ERROR", message: "Please check the highlighted fields", fields });
  }

  // body-parser errors
  if (err?.type === "entity.too.large") {
    return send(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request is too large" });
  }
  if (err?.type === "entity.parse.failed") {
    return send(res, 400, { code: "BAD_REQUEST", message: "Malformed JSON" });
  }

  // Mongoose cast errors (e.g. a malformed ObjectId that slipped past validation).
  if (err?.name === "CastError") {
    return send(res, 400, { code: "BAD_REQUEST", message: "Invalid identifier" });
  }

  // Unique index violation that wasn't pre-checked (race between two requests).
  if (err?.code === 11000) {
    return send(res, 409, { code: "CONFLICT", message: "That already exists" });
  }

  logger.error({ err, method: req.method, url: req.originalUrl }, "Unhandled request error");
  return send(res, 500, { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." });
};

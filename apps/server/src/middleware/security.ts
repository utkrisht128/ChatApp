import type { RequestHandler } from "express";
import { rateLimit, type Options } from "express-rate-limit";
import type { ApiFailure } from "@chat/shared";
import { env, isTest } from "../config/env";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence in depth (on top of SameSite=Lax cookies):
 * state-changing requests must carry our custom header — which a cross-site
 * form cannot set without a CORS preflight — and, when the browser sends an
 * Origin, it must be one of ours.
 */
export const csrfGuard: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get("origin");
  const originOk = !origin || env.CLIENT_URL.includes(origin.replace(/\/+$/, ""));
  if (originOk && req.get("x-requested-with") === "chatapp") return next();
  res.status(403).json({
    success: false,
    error: { code: "CSRF_REJECTED", message: "Request blocked for security reasons" },
  } satisfies ApiFailure);
};

/** Rate limiter factory with a consistent error envelope. Disabled in tests. */
export function limiter(opts: Partial<Options> & { windowMs: number; limit: number }) {
  return rateLimit({
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => isTest,
    handler: (_req, res) =>
      res.status(429).json({
        success: false,
        error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down and try again shortly." },
      } satisfies ApiFailure),
    ...opts,
  });
}

/** Broad per-IP ceiling for the whole API. Specific routes add tighter limits. */
export const apiLimiter = limiter({ windowMs: 60_000, limit: 600 });

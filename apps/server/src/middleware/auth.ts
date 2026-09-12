import type { Request, RequestHandler } from "express";
import { notFound, unauthenticated } from "../lib/errors";
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from "../modules/auth/cookies";
import { resolveSession } from "../modules/auth/service";

/** Attaches `req.auth` when a valid session cookie is present. Never rejects on its own. */
export const authenticate: RequestHandler = async (req, res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || token.length === 0 || token.length > 100) return next();

  const session = await resolveSession(token);
  if (!session) {
    clearSessionCookie(res);
    return next();
  }
  if (session.refreshed) setSessionCookie(res, token);
  req.auth = { user: session.user, sessionId: session.sessionId };
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => next(req.auth ? undefined : unauthenticated());

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthenticated());
  // 404 rather than 403, so the admin surface isn't advertised to regular users —
  // the same reason `requireMembership` hides chats a caller isn't in.
  if (req.auth.user.role !== "admin") return next(notFound("NOT_FOUND", "Not found"));
  next();
};

/** The authenticated user. Only call behind `requireAuth`. */
export function authOf(req: Request) {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}

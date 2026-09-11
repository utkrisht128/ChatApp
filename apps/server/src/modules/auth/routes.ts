import { Router, type Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "@chat/shared";
import { noContent, ok } from "../../lib/http";
import { toMe } from "../../lib/serialize";
import { authOf, requireAuth } from "../../middleware/auth";
import { limiter } from "../../middleware/security";
import { clearSessionCookie, setSessionCookie } from "./cookies";
import * as auth from "./service";

const MIN = 60_000;
const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");
const userKey = (req: Request) => req.auth?.user.id ?? ipKey(req);

const signupLimiter = limiter({ windowMs: 60 * MIN, limit: 10, keyGenerator: ipKey });
// Per IP + account, counting only failures, so a typo or two never locks anyone out
// but guessing a password is capped at 10 attempts per 15 minutes.
const loginLimiter = limiter({
  windowMs: 15 * MIN,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKey(req)}:${String(req.body?.identifier ?? "").toLowerCase().slice(0, 254)}`,
});
const emailLimiter = limiter({ windowMs: 15 * MIN, limit: 5, keyGenerator: ipKey });
const tokenLimiter = limiter({ windowMs: 15 * MIN, limit: 20, keyGenerator: ipKey });
const resendLimiter = limiter({ windowMs: 60 * MIN, limit: 3, keyGenerator: userKey });
const ticketLimiter = limiter({ windowMs: MIN, limit: 30, keyGenerator: userKey });

const meta = (req: Request): auth.SessionMeta => ({ userAgent: (req.get("user-agent") ?? "").slice(0, 300) });

export const authRouter = Router();

authRouter.post("/register", signupLimiter, async (req, res) => {
  const input = registerSchema.parse(req.body);
  const { user, token } = await auth.register(input, meta(req));
  setSessionCookie(res, token);
  ok(res, { user: toMe(user) }, 201);
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const { user, token } = await auth.login(input, meta(req));
  setSessionCookie(res, token);
  ok(res, { user: toMe(user) });
});

authRouter.post("/logout", async (req, res) => {
  if (req.auth) await auth.revokeSession(req.auth.sessionId);
  clearSessionCookie(res);
  noContent(res);
});

authRouter.post("/logout-all", requireAuth, async (req, res) => {
  await auth.revokeAllSessions(authOf(req).user._id);
  clearSessionCookie(res);
  noContent(res);
});

authRouter.get("/me", requireAuth, (req, res) => {
  ok(res, { user: toMe(authOf(req).user) });
});

authRouter.post("/verify-email", tokenLimiter, async (req, res) => {
  const { token } = verifyEmailSchema.parse(req.body);
  await auth.verifyEmail(token);
  ok(res, { verified: true });
});

authRouter.post("/resend-verification", requireAuth, resendLimiter, async (req, res) => {
  await auth.resendVerification(authOf(req).user);
  ok(res, { sent: true });
});

authRouter.post("/forgot-password", emailLimiter, async (req, res) => {
  const { email } = forgotPasswordSchema.parse(req.body);
  await auth.forgotPassword(email);
  ok(res, { sent: true });
});

authRouter.post("/reset-password", tokenLimiter, async (req, res) => {
  const { token, password } = resetPasswordSchema.parse(req.body);
  await auth.resetPassword(token, password);
  clearSessionCookie(res);
  ok(res, { reset: true });
});

authRouter.post("/change-password", requireAuth, loginLimiter, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const { user, sessionId } = authOf(req);
  await auth.changePassword(user._id, sessionId, currentPassword, newPassword);
  ok(res, { changed: true });
});

/** Short-lived, single-use ticket that authenticates the direct WebSocket connection to the API host. */
authRouter.post("/socket-ticket", requireAuth, ticketLimiter, async (req, res) => {
  ok(res, { ticket: await auth.issueSocketTicket(authOf(req).user._id) });
});

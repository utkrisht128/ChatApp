import argon2 from "argon2";
import type { z } from "zod";
import type { loginSchema, registerSchema } from "@chat/shared";
import { env } from "../../config/env";
import { AppError, conflict, unauthenticated } from "../../lib/errors";
import * as emails from "../../lib/emails";
import { sendMail } from "../../lib/mailer";
import { hashToken, randomToken } from "../../lib/tokens";
import { AuthToken, type AuthTokenType } from "../../models/AuthToken";
import { Session } from "../../models/Session";
import { User, type UserDoc } from "../../models/User";

const DAY = 86_400_000;
const SESSION_TTL = env.SESSION_TTL_DAYS * DAY;
const TOKEN_TTL: Record<AuthTokenType, number> = { verify: DAY, reset: 3_600_000, socket: 60_000 };

// OWASP-recommended argon2id baseline (19 MiB, 2 iterations) — fits Render's free-tier memory.
const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const hashPassword = (password: string) => argon2.hash(password, ARGON);

// Verifying against a dummy hash when the user doesn't exist keeps response times
// identical, so login timing can't be used to discover which accounts exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("timing-equaliser-not-a-real-password"));

export type SessionMeta = { userAgent: string };

export async function createSession(userId: UserDoc["_id"], meta: SessionMeta) {
  const token = randomToken();
  await Session.create({
    userId,
    tokenHash: hashToken(token),
    userAgent: meta.userAgent,
    expiresAt: new Date(Date.now() + SESSION_TTL),
  });
  return token;
}

/**
 * Resolves a session cookie to its user. Sessions slide: once a day of the TTL has
 * been used up, the expiry is pushed forward and `refreshed` tells the caller to
 * re-issue the cookie.
 */
export async function resolveSession(token: string) {
  const session = await Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;

  const user = await User.findById(session.userId);
  if (!user || user.bannedAt) {
    await Session.deleteMany({ userId: session.userId });
    return null;
  }

  let refreshed = false;
  if (session.expiresAt.getTime() - Date.now() < SESSION_TTL - DAY) {
    session.expiresAt = new Date(Date.now() + SESSION_TTL);
    await session.save();
    refreshed = true;
  }
  return { user, sessionId: session._id.toString(), refreshed };
}

export const revokeSession = (sessionId: string) => Session.deleteOne({ _id: sessionId });

export const revokeAllSessions = (userId: UserDoc["_id"], exceptSessionId?: string) =>
  Session.deleteMany({ userId, ...(exceptSessionId ? { _id: { $ne: exceptSessionId } } : {}) });

async function issueToken(userId: UserDoc["_id"], type: AuthTokenType) {
  const token = randomToken();
  await AuthToken.create({ userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TOKEN_TTL[type]) });
  return token;
}

/** Atomically marks a token used, so a token can never be redeemed twice even under concurrent requests. */
async function consumeToken(token: string, type: AuthTokenType) {
  const record = await AuthToken.findOneAndUpdate(
    { tokenHash: hashToken(token), type, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
  );
  return record?.userId ?? null;
}

async function sendVerification(user: UserDoc) {
  await AuthToken.deleteMany({ userId: user._id, type: "verify", usedAt: null });
  const token = await issueToken(user._id, "verify");
  await sendMail({ to: user.email, ...emails.verifyEmail(user.displayName, token) });
}

export async function register(input: z.output<typeof registerSchema>, meta: SessionMeta) {
  const [emailTaken, usernameTaken] = await Promise.all([
    User.exists({ email: input.email }),
    User.exists({ username: input.username }),
  ]);
  if (emailTaken || usernameTaken) {
    const fields: Record<string, string> = {};
    if (emailTaken) fields.email = "An account with this email already exists";
    if (usernameTaken) fields.username = "This username is taken";
    throw conflict(emailTaken ? "EMAIL_TAKEN" : "USERNAME_TAKEN", Object.values(fields)[0]!, fields);
  }

  const user = await User.create({
    email: input.email,
    username: input.username,
    displayName: input.displayName ?? input.username,
    passwordHash: await hashPassword(input.password),
  });
  void sendVerification(user);
  const token = await createSession(user._id, meta);
  return { user, token };
}

export async function login(input: z.output<typeof loginSchema>, meta: SessionMeta) {
  const field = input.identifier.includes("@") ? "email" : "username";
  const user = await User.findOne({ [field]: input.identifier }).select("+passwordHash");

  const valid = await argon2.verify(user?.passwordHash ?? (await getDummyHash()), input.password);
  if (!user || !valid) throw new AppError(401, "INVALID_CREDENTIALS", "Incorrect username/email or password");
  if (user.bannedAt) throw new AppError(403, "ACCOUNT_BANNED", "This account has been suspended");

  if (argon2.needsRehash(user.passwordHash, ARGON)) {
    user.passwordHash = await hashPassword(input.password);
    await user.save();
  }
  const token = await createSession(user._id, meta);
  return { user, token };
}

/** Admin rights from ADMIN_EMAILS are only granted once the address is proven to belong to the user. */
async function applyAdminPolicy(user: UserDoc) {
  if (user.emailVerifiedAt && user.role !== "admin" && env.ADMIN_EMAILS.includes(user.email)) {
    user.role = "admin";
    await user.save();
  }
}

export async function verifyEmail(token: string) {
  const userId = await consumeToken(token, "verify");
  const user = userId ? await User.findById(userId) : null;
  if (!user) throw new AppError(400, "TOKEN_INVALID", "This verification link is invalid or has expired");
  if (!user.emailVerifiedAt) {
    user.emailVerifiedAt = new Date();
    await user.save();
  }
  await applyAdminPolicy(user);
}

export async function resendVerification(user: UserDoc) {
  if (user.emailVerifiedAt) return;
  await sendVerification(user);
}

/** Always succeeds from the caller's point of view, so it can't be used to probe for accounts. */
export async function forgotPassword(email: string) {
  const user = await User.findOne({ email });
  if (!user || user.bannedAt) return;
  await AuthToken.deleteMany({ userId: user._id, type: "reset", usedAt: null });
  const token = await issueToken(user._id, "reset");
  await sendMail({ to: user.email, ...emails.resetPassword(user.displayName, token) });
}

export async function resetPassword(token: string, password: string) {
  const userId = await consumeToken(token, "reset");
  const user = userId ? await User.findById(userId) : null;
  if (!user) throw new AppError(400, "TOKEN_INVALID", "This reset link is invalid or has expired");
  user.passwordHash = await hashPassword(password);
  // Receiving the reset email proves ownership of the address.
  user.emailVerifiedAt ??= new Date();
  await user.save();
  await revokeAllSessions(user._id);
  await applyAdminPolicy(user);
}

export async function changePassword(userId: UserDoc["_id"], sessionId: string, current: string, next: string) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw unauthenticated();
  if (!(await argon2.verify(user.passwordHash, current))) {
    throw new AppError(400, "INVALID_CREDENTIALS", "Current password is incorrect", {
      currentPassword: "Current password is incorrect",
    });
  }
  user.passwordHash = await hashPassword(next);
  await user.save();
  await revokeAllSessions(user._id, sessionId);
}

export const issueSocketTicket = (userId: UserDoc["_id"]) => issueToken(userId, "socket");

export async function redeemSocketTicket(ticket: string) {
  const userId = await consumeToken(ticket, "socket");
  if (!userId) return null;
  const user = await User.findById(userId);
  return user && !user.bannedAt ? user : null;
}

/** Called on every authenticated request/login path that may need the admin role applied. */
export const ensureAdminPolicy = applyAdminPolicy;

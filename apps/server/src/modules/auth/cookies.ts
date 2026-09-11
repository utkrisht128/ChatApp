import type { Response } from "express";
import { env, isProd } from "../../config/env";

/**
 * `__Host-` prefix (production): the browser only accepts the cookie over HTTPS,
 * for Path=/ and without a Domain — so no subdomain can overwrite it.
 */
export const SESSION_COOKIE = isProd ? "__Host-sid" : "sid";

const base = { httpOnly: true, secure: isProd, sameSite: "lax", path: "/" } as const;

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { ...base, maxAge: env.SESSION_TTL_DAYS * 86_400_000 });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, base);
}

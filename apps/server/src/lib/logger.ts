import pino from "pino";
import { env, isProd } from "../config/env";

/**
 * Structured logger. Secrets, credentials and message content are redacted —
 * see the `redact` list — so request/response objects can be logged safely.
 */
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  base: undefined,
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      'res.headers["set-cookie"]',
      "*.password",
      "*.currentPassword",
      "*.newPassword",
      "*.token",
      "*.passwordHash",
      "*.body",
    ],
    censor: "[redacted]",
  },
  ...(isProd ? {} : { transport: { target: "pino-pretty", options: { colorize: true, ignore: "pid,hostname" } } }),
});

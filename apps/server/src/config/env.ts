import { z } from "zod";

const csv = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  CLIENT_URL: csv
    .transform((list) => list.map((o) => o.replace(/\/+$/, "")))
    .refine((list) => list.length > 0, "CLIENT_URL is required"),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SMTP_URL: optional,
  MAIL_FROM: z.string().default("ChatApp <no-reply@example.com>"),
  VAPID_PUBLIC_KEY: optional,
  VAPID_PRIVATE_KEY: optional,
  VAPID_SUBJECT: z.string().default("mailto:admin@example.com"),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(16).default(8),
  USER_STORAGE_QUOTA_MB: z.coerce.number().positive().default(100),
  ADMIN_EMAILS: csv.transform((list) => list.map((e) => e.toLowerCase())),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Logger isn't configured yet (it depends on env), so write directly.
    console.error("Invalid environment configuration:");
    for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = load();
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
/** Public URL of the frontend, used to build links in emails. */
export const appUrl = env.CLIENT_URL[0]!;

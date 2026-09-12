import { z } from "zod";
import { objectIdSchema } from "./chats";
import { REPORT_STATUSES, type ReportReason, type ReportStatus } from "./moderation";
import type { PublicUser } from "./models";

export const ADMIN_USER_FILTERS = ["all", "banned", "admins", "unverified"] as const;
export type AdminUserFilter = (typeof ADMIN_USER_FILTERS)[number];

export const adminUsersQuerySchema = z.object({
  q: z.string().trim().max(64).optional(),
  filter: z.enum(ADMIN_USER_FILTERS).default("all"),
  cursor: objectIdSchema.optional(),
});

export const setBanSchema = z.strictObject({
  banned: z.boolean(),
  /** Shown to nobody but other moderators; the banned person only sees a generic message. */
  reason: z.string().trim().max(200).default(""),
});

export const setUserRoleSchema = z.strictObject({ role: z.enum(["user", "admin"]) });

export const adminReportsQuerySchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  cursor: objectIdSchema.optional(),
});

export const resolveReportSchema = z.strictObject({
  status: z.enum(["reviewed", "actioned", "dismissed"]),
  /** Also delete the reported message for everyone. Only meaningful for message reports. */
  removeMessage: z.boolean().default(false),
});

/** A user as a moderator sees them — includes fields never exposed to ordinary users. */
export type AdminUser = PublicUser & {
  email: string;
  role: "user" | "admin";
  emailVerified: boolean;
  bannedAt: string | null;
  banReason: string;
  createdAt: string;
  storageUsedBytes: number;
};

export type AdminReport = {
  id: string;
  subject: "user" | "message";
  targetId: string;
  chatId: string | null;
  reason: ReportReason;
  note: string;
  /** The reported text, captured when the report was filed. */
  snapshot: string;
  status: ReportStatus;
  createdAt: string;
  reviewedAt: string | null;
  reporter: PublicUser | null;
  targetUser: AdminUser | null;
};

export type AdminStats = {
  users: { total: number; banned: number; admins: number; newThisWeek: number };
  messages: { total: number; today: number };
  chats: { direct: number; groups: number };
  reports: { open: number; total: number };
  storageBytes: number;
};

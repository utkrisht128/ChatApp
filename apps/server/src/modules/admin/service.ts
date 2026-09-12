import { Types } from "mongoose";
import type {
  AdminReport,
  AdminStats,
  AdminUser,
  adminReportsQuerySchema,
  adminUsersQuerySchema,
  Page,
  ReportReason,
  ReportStatus,
  resolveReportSchema,
} from "@chat/shared";
import type { z } from "zod";
import { badRequest, forbidden, notFound } from "../../lib/errors";
import { escapeRegex, isObjectId, sameId, type Id } from "../../lib/ids";
import { toPublicUser } from "../../lib/serialize";
import { Conversation } from "../../models/Conversation";
import { Message } from "../../models/Message";
import { Report } from "../../models/Report";
import { User, type UserDoc, type UserFields } from "../../models/User";
import { revokeAllSessions } from "../auth/service";
import { removeMessageAsModerator } from "../messages/service";

const PAGE_SIZE = 30;
type UserLean = UserFields & { _id: Types.ObjectId; createdAt: Date };

function toAdminUser(user: UserLean | UserDoc): AdminUser {
  const u = user as UserLean;
  return {
    ...toPublicUser(u),
    email: u.email,
    role: u.role as AdminUser["role"],
    emailVerified: Boolean(u.emailVerifiedAt),
    bannedAt: u.bannedAt?.toISOString() ?? null,
    banReason: u.banReason ?? "",
    createdAt: u.createdAt.toISOString(),
    storageUsedBytes: u.storageUsedBytes ?? 0,
  };
}

export async function listUsers(query: z.output<typeof adminUsersQuerySchema>): Promise<Page<AdminUser>> {
  const filter: Record<string, unknown> = {};
  if (query.q) {
    const rx = escapeRegex(query.q.toLowerCase().replace(/^@/, ""));
    filter.$or = [{ username: { $regex: rx } }, { displayName: { $regex: rx, $options: "i" } }, { email: { $regex: rx } }];
  }
  if (query.filter === "banned") filter.bannedAt = { $ne: null };
  if (query.filter === "admins") filter.role = "admin";
  if (query.filter === "unverified") filter.emailVerifiedAt = null;
  if (query.cursor) filter._id = { $lt: new Types.ObjectId(query.cursor) };

  const docs = await User.find(filter).sort({ _id: -1 }).limit(PAGE_SIZE + 1).lean<UserLean[]>();
  const page = docs.slice(0, PAGE_SIZE);
  return {
    items: page.map(toAdminUser),
    nextCursor: docs.length > PAGE_SIZE ? String(page.at(-1)!._id) : null,
  };
}

async function loadTarget(actorId: Id, targetId: string, action: string) {
  if (sameId(actorId, targetId)) throw badRequest(`You can't ${action} your own account`);
  const target = isObjectId(targetId) ? await User.findById(targetId) : null;
  if (!target) throw notFound("USER_NOT_FOUND", "User not found");
  return target;
}

/**
 * Bans or unbans an account. A ban ejects immediately: `revokeAllSessions` deletes every
 * session and drops live sockets, and `resolveSession` refuses any cookie for a banned user.
 */
export async function setBan(actorId: Id, targetId: string, banned: boolean, reason: string): Promise<AdminUser> {
  const target = await loadTarget(actorId, targetId, "ban");
  // Requiring a demotion first means no single admin can quietly remove the others.
  if (banned && target.role === "admin") throw forbidden("Remove this person's admin role before banning them");

  target.bannedAt = banned ? (target.bannedAt ?? new Date()) : null;
  target.banReason = banned ? reason : "";
  await target.save();
  if (banned) await revokeAllSessions(target._id);
  return toAdminUser(target);
}

export async function setRole(actorId: Id, targetId: string, role: "user" | "admin"): Promise<AdminUser> {
  const target = await loadTarget(actorId, targetId, "change the role of");
  if (role === "admin") {
    // Same rule as ADMIN_EMAILS: admin is only granted on a proven address.
    if (!target.emailVerifiedAt) throw badRequest("This person must verify their email before becoming an admin");
    if (target.bannedAt) throw badRequest("Unban this account before making them an admin");
  }
  target.role = role;
  await target.save();
  return toAdminUser(target);
}

type ReportLean = {
  _id: Types.ObjectId;
  reporterId: Types.ObjectId;
  targetUserId: Types.ObjectId;
  subject: string;
  targetId: Types.ObjectId;
  conversationId: Types.ObjectId | null;
  reason: string;
  note: string;
  snapshot: string;
  status: string;
  reviewedAt: Date | null;
  createdAt: Date;
};

/** Reports plus the people involved, resolved in two queries rather than per row. */
async function withPeople(reports: ReportLean[]): Promise<AdminReport[]> {
  const ids = reports.flatMap((r) => [r.reporterId, r.targetUserId]);
  const users = ids.length ? await User.find({ _id: { $in: ids } }).lean<UserLean[]>() : [];
  const byId = new Map(users.map((u) => [String(u._id), u]));

  return reports.map((r) => {
    const reporter = byId.get(String(r.reporterId));
    const target = byId.get(String(r.targetUserId));
    return {
      id: String(r._id),
      subject: r.subject as AdminReport["subject"],
      targetId: String(r.targetId),
      chatId: r.conversationId ? String(r.conversationId) : null,
      reason: r.reason as ReportReason,
      note: r.note,
      snapshot: r.snapshot,
      status: r.status as ReportStatus,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reporter: reporter ? toPublicUser(reporter) : null,
      targetUser: target ? toAdminUser(target) : null,
    };
  });
}

export async function listReports(query: z.output<typeof adminReportsQuerySchema>): Promise<Page<AdminReport>> {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.cursor) filter._id = { $lt: new Types.ObjectId(query.cursor) };

  const docs = await Report.find(filter).sort({ _id: -1 }).limit(PAGE_SIZE + 1).lean<ReportLean[]>();
  const page = docs.slice(0, PAGE_SIZE);
  return {
    items: await withPeople(page),
    nextCursor: docs.length > PAGE_SIZE ? String(page.at(-1)!._id) : null,
  };
}

export async function resolveReport(actorId: Id, reportId: string, input: z.output<typeof resolveReportSchema>) {
  const report = isObjectId(reportId) ? await Report.findById(reportId) : null;
  if (!report) throw notFound("NOT_FOUND", "Report not found");

  if (input.removeMessage) {
    if (report.subject !== "message") throw badRequest("Only a reported message can be removed");
    await removeMessageAsModerator(String(report.targetId));
  }
  report.status = input.status;
  report.reviewedBy = actorId as Types.ObjectId;
  report.reviewedAt = new Date();
  await report.save();

  const [resolved] = await withPeople([report.toObject() as ReportLean]);
  return resolved!;
}

export async function getStats(): Promise<AdminStats> {
  const dayAgo = new Date();
  dayAgo.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [total, banned, admins, newThisWeek, messages, messagesToday, direct, groups, openReports, totalReports, storage] =
    await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ bannedAt: { $ne: null } }),
      User.countDocuments({ role: "admin" }),
      User.countDocuments({ createdAt: { $gte: weekAgo } }),
      Message.countDocuments({ type: { $ne: "system" } }),
      Message.countDocuments({ type: { $ne: "system" }, createdAt: { $gte: dayAgo } }),
      Conversation.countDocuments({ type: "direct" }),
      Conversation.countDocuments({ type: "group" }),
      Report.countDocuments({ status: "open" }),
      Report.countDocuments({}),
      User.aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: "$storageUsedBytes" } } }]),
    ]);

  return {
    users: { total, banned, admins, newThisWeek },
    messages: { total: messages, today: messagesToday },
    chats: { direct, groups },
    reports: { open: openReports, total: totalReports },
    storageBytes: storage[0]?.total ?? 0,
  };
}

import { Types } from "mongoose";
import type { BlockedUser, CreateReportInput } from "@chat/shared";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { sameId, type Id } from "../../lib/ids";
import { toPublicUser } from "../../lib/serialize";
import { Block } from "../../models/Block";
import { Message } from "../../models/Message";
import { Report } from "../../models/Report";
import { User } from "../../models/User";
import { requireMembership } from "../chats/service";
import { PUBLIC_USER_FIELDS } from "../users/presence";

const MAX_BLOCKED = 500;

/** Blocks or unblocks someone, and returns the caller's updated block list. */
export async function setBlocked(meId: Types.ObjectId, targetId: string, blocked: boolean): Promise<BlockedUser[]> {
  if (sameId(meId, targetId)) throw badRequest("You can't block yourself");
  const target = await User.findById(targetId).select("_id");
  if (!target) throw notFound("USER_NOT_FOUND", "User not found");

  if (blocked) {
    if ((await Block.countDocuments({ blockerId: meId })) >= MAX_BLOCKED) {
      throw badRequest(`You can block up to ${MAX_BLOCKED} people`);
    }
    try {
      await Block.create({ blockerId: meId, blockedId: target._id });
    } catch (err) {
      // Already blocked — blocking twice is a no-op, not an error.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  } else {
    await Block.deleteOne({ blockerId: meId, blockedId: target._id });
  }
  return listBlocked(meId);
}

export async function listBlocked(meId: Id): Promise<BlockedUser[]> {
  const blocks = await Block.find({ blockerId: meId }).sort({ _id: -1 }).limit(MAX_BLOCKED).lean();
  if (!blocks.length) return [];
  const users = await User.find({ _id: { $in: blocks.map((b) => b.blockedId) } })
    .select(PUBLIC_USER_FIELDS)
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return blocks.flatMap((b) => {
    const user = byId.get(String(b.blockedId));
    // Presence is deliberately omitted: someone you blocked can't be watched either.
    return user ? [{ ...toPublicUser(user), blockedAt: b.createdAt.toISOString() }] : [];
  });
}

/**
 * Files a report. Message reports snapshot the text, so the report stays meaningful after
 * the message is edited or deleted, and require the reporter to be in that chat — you can't
 * probe for messages by reporting ids.
 */
export async function createReport(reporterId: Types.ObjectId, input: CreateReportInput) {
  let targetUserId: Types.ObjectId;
  let conversationId: Types.ObjectId | null = null;
  let snapshot = "";

  if (input.subject === "message") {
    const msg = await Message.findById(input.targetId).select("senderId conversationId body hiddenFor").lean();
    if (!msg) throw notFound("MESSAGE_NOT_FOUND", "Message not found");
    if (msg.hiddenFor.some((id) => sameId(id, reporterId))) throw notFound("MESSAGE_NOT_FOUND", "Message not found");
    await requireMembership(String(msg.conversationId), reporterId);
    targetUserId = msg.senderId;
    conversationId = msg.conversationId;
    snapshot = (msg.body ?? "").slice(0, 1000);
  } else {
    const user = await User.findById(input.targetId).select("_id");
    if (!user) throw notFound("USER_NOT_FOUND", "User not found");
    targetUserId = user._id;
  }

  if (sameId(targetUserId, reporterId)) throw badRequest("You can't report yourself");

  try {
    await Report.create({
      reporterId,
      subject: input.subject,
      targetId: input.targetId,
      targetUserId,
      conversationId,
      reason: input.reason,
      note: input.note,
      snapshot,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict("CONFLICT", "You've already reported this");
    throw err;
  }
}

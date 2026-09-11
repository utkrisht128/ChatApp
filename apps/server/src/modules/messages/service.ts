import { Types } from "mongoose";
import {
  EDIT_WINDOW_MS,
  messagePreview,
  type Message as MessageDTO,
  type MessagePage,
  type MessageType,
  type Receipt,
  type SendMessageInput,
  type SystemEvent,
} from "@chat/shared";
import { badRequest, forbidden, notFound } from "../../lib/errors";
import { isObjectId, sameId, type Id } from "../../lib/ids";
import { Conversation } from "../../models/Conversation";
import { Member } from "../../models/Member";
import { Message, type MessageFields } from "../../models/Message";
import { User } from "../../models/User";
import { emitToUsers } from "../../realtime/bus";
import { requireMembership } from "../chats/service";

type MessageLean = MessageFields & { _id: Types.ObjectId };

const oid = (id: Id) => (typeof id === "string" ? new Types.ObjectId(id) : id);
const DELETED_PREVIEW = "Message deleted";
const messageNotFound = () => notFound("MESSAGE_NOT_FOUND", "Message not found");

const previewOf = messagePreview;

export function toMessage(m: MessageLean): MessageDTO {
  const grouped = new Map<string, string[]>();
  for (const r of m.reactions ?? []) grouped.set(r.emoji, [...(grouped.get(r.emoji) ?? []), String(r.userId)]);
  return {
    id: String(m._id),
    chatId: String(m.conversationId),
    senderId: String(m.senderId),
    clientId: m.clientId,
    type: m.type as MessageType,
    body: m.deletedAt ? "" : m.body,
    replyTo: m.replyTo ? { id: String(m.replyTo.messageId), senderId: String(m.replyTo.senderId), preview: m.replyTo.preview } : null,
    reactions: [...grouped].map(([emoji, userIds]) => ({ emoji, userIds })),
    mentions: (m.mentions ?? []).map(String),
    forwarded: Boolean(m.forwarded),
    system: m.system
      ? {
          event: m.system.event as SystemEvent,
          actorId: String(m.system.actorId),
          targetIds: (m.system.targetIds ?? []).map(String),
          ...(m.system.value ? { value: m.system.value } : {}),
        }
      : null,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
  };
}

export async function activeMemberIds(conversationId: Id) {
  const members = await Member.find({ conversationId, leftAt: null }).select("userId").lean();
  return members.map((m) => String(m.userId));
}

/** Read receipts flow only when *both* people have them switched on. */
async function readReceiptPolicy(userIds: Id[]) {
  const users = await User.find({ _id: { $in: userIds } }).select("settings.readReceipts").lean();
  const allows = new Map(users.map((u) => [String(u._id), u.settings?.readReceipts !== false]));
  return (id: Id) => allows.get(String(id)) ?? true;
}

const str = (id: Types.ObjectId | null | undefined) => (id ? String(id) : null);

export async function receiptsFor(conversationId: Id, viewerId: Id): Promise<Receipt[]> {
  const members = await Member.find({ conversationId, leftAt: null, userId: { $ne: viewerId } })
    .select("userId lastDeliveredMessageId lastReadMessageId")
    .lean();
  const allows = await readReceiptPolicy([viewerId, ...members.map((m) => m.userId)]);
  return members.map((m) => ({
    userId: String(m.userId),
    deliveredId: str(m.lastDeliveredMessageId),
    ...(allows(viewerId) && allows(m.userId) ? { readId: str(m.lastReadMessageId) } : {}),
  }));
}

/** Tells the other members that `subjectId`'s receipt pointers moved. */
async function broadcastReceipt(conversationId: Types.ObjectId, subjectId: Id) {
  const member = await Member.findOne({ conversationId, userId: subjectId }).select("lastDeliveredMessageId lastReadMessageId").lean();
  if (!member) return;
  const others = (await activeMemberIds(conversationId)).filter((id) => !sameId(id, subjectId));
  if (!others.length) return;
  const allows = await readReceiptPolicy([subjectId, ...others]);
  const base = { chatId: String(conversationId), userId: String(subjectId), deliveredId: str(member.lastDeliveredMessageId) };
  const canSeeRead = (id: string) => allows(subjectId) && allows(id);
  emitToUsers(others.filter(canSeeRead), "receipt:updated", { ...base, readId: str(member.lastReadMessageId) });
  emitToUsers(others.filter((id) => !canSeeRead(id)), "receipt:updated", base);
}

export async function listMessages(viewerId: Id, chatId: string, opts: { before?: string; limit: number }): Promise<MessagePage> {
  const member = await requireMembership(chatId, viewerId);
  const conv = await Conversation.findById(member.conversationId).select("type").lean();
  const docs = await Message.find({
    conversationId: member.conversationId,
    hiddenFor: { $ne: viewerId },
    // Group members only see history from when they (last) joined.
    ...(conv?.type === "group" ? { createdAt: { $gte: member.joinedAt } } : {}),
    ...(opts.before ? { _id: { $lt: oid(opts.before) } } : {}),
  })
    .sort({ _id: -1 })
    .limit(opts.limit + 1)
    .lean<MessageLean[]>();

  const page = docs.slice(0, opts.limit);
  const oldest = page.at(-1);
  return {
    items: page.reverse().map(toMessage),
    nextCursor: docs.length > opts.limit && oldest ? String(oldest._id) : null,
    // Receipts describe the chat's current state, so only the newest page carries them.
    ...(opts.before ? {} : { receipts: await receiptsFor(member.conversationId, viewerId) }),
  };
}

export async function sendMessage(senderId: Types.ObjectId, chatId: string, input: SendMessageInput) {
  const member = await requireMembership(chatId, senderId);
  const conv = await Conversation.findById(member.conversationId).select("type permissions");
  if (!conv) throw notFound("CHAT_NOT_FOUND", "Chat not found");
  if (conv.type === "group" && conv.permissions?.send === "admins" && member.role === "member") {
    throw forbidden("Only admins can send messages in this group");
  }

  // Idempotency: a retry of an already-stored send returns the original.
  const existing = await Message.findOne({ senderId, clientId: input.clientId }).lean<MessageLean>();
  if (existing) {
    if (!sameId(existing.conversationId, conv._id)) throw badRequest("Duplicate message id");
    return { message: toMessage(existing), created: false };
  }

  let replyTo = null;
  if (input.replyToId) {
    const target = await Message.findOne({ _id: input.replyToId, conversationId: conv._id, hiddenFor: { $ne: senderId } }).lean<MessageLean>();
    if (!target) throw notFound("MESSAGE_NOT_FOUND", "The message you're replying to no longer exists");
    replyTo = { messageId: target._id, senderId: target.senderId, preview: target.deletedAt ? DELETED_PREVIEW : previewOf(target.body) };
  }

  let doc;
  try {
    doc = await Message.create({ conversationId: conv._id, senderId, clientId: input.clientId, type: "text", body: input.body, replyTo });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const dup = await Message.findOne({ senderId, clientId: input.clientId }).lean<MessageLean>();
      if (dup) return { message: toMessage(dup), created: false };
    }
    throw err;
  }

  const at = doc.createdAt;
  await Promise.all([
    // Conditional so concurrent sends can never leave an older message as the "last" one.
    Conversation.updateOne(
      { _id: conv._id, $or: [{ lastMessage: null }, { "lastMessage.messageId": { $lt: doc._id } }] },
      { $set: { lastMessage: { messageId: doc._id, senderId, preview: previewOf(input.body), type: "text", createdAt: at } }, $max: { lastMessageAt: at } },
    ),
    Member.updateMany(
      { conversationId: conv._id, leftAt: null, userId: { $ne: senderId } },
      { $inc: { unreadCount: 1 }, $set: { hidden: false }, $max: { lastMessageAt: at } },
    ),
    // Replying means you've seen the chat: everything up to your message counts as read.
    Member.updateOne(
      { _id: member._id },
      {
        $set: { hidden: false, unreadCount: 0, mentionCount: 0 },
        $max: { lastMessageAt: at, lastReadMessageId: doc._id, lastDeliveredMessageId: doc._id },
      },
    ),
  ]);

  const message = toMessage(doc.toObject() as MessageLean);
  emitToUsers(await activeMemberIds(conv._id), "message:new", { message });
  await broadcastReceipt(conv._id, senderId);
  return { message, created: true };
}

/** Loads a message the user can see (member of its chat, not hidden for them), else 404. */
async function loadVisibleMessage(userId: Id, messageId: string) {
  if (!isObjectId(messageId)) throw messageNotFound();
  const msg = await Message.findById(messageId);
  if (!msg || msg.hiddenFor.some((id) => sameId(id, userId))) throw messageNotFound();
  await requireMembership(String(msg.conversationId), userId);
  return msg;
}

async function broadcastUpdated(msg: { conversationId: Types.ObjectId; toObject(): unknown }) {
  emitToUsers(await activeMemberIds(msg.conversationId), "message:updated", { message: toMessage(msg.toObject() as MessageLean) });
}

export async function editMessage(userId: Id, messageId: string, body: string) {
  const msg = await loadVisibleMessage(userId, messageId);
  if (!sameId(msg.senderId, userId)) throw forbidden("You can only edit your own messages");
  if (msg.deletedAt) throw badRequest("Deleted messages can't be edited");
  if (msg.type !== "text") throw badRequest("Only text messages can be edited");
  if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_MS) throw badRequest("Messages can only be edited within 48 hours of sending");
  if (msg.body === body) return toMessage(msg.toObject() as MessageLean);

  msg.body = body;
  msg.editedAt = new Date();
  await msg.save();
  await Promise.all([
    Conversation.updateOne({ _id: msg.conversationId, "lastMessage.messageId": msg._id }, { $set: { "lastMessage.preview": previewOf(body) } }),
    Message.updateMany({ conversationId: msg.conversationId, "replyTo.messageId": msg._id }, { $set: { "replyTo.preview": previewOf(body) } }),
  ]);
  await broadcastUpdated(msg);
  return toMessage(msg.toObject() as MessageLean);
}

export async function deleteMessage(userId: Id, messageId: string, scope: "me" | "everyone") {
  const msg = await loadVisibleMessage(userId, messageId);

  if (scope === "me") {
    await Message.updateOne({ _id: msg._id }, { $addToSet: { hiddenFor: oid(userId) } });
    emitToUsers([userId], "message:hidden", { chatId: String(msg.conversationId), messageId: String(msg._id) });
    return;
  }

  if (msg.type === "system") throw badRequest("Group events can't be deleted for everyone");
  if (!sameId(msg.senderId, userId)) throw forbidden("You can only delete your own messages for everyone");
  if (msg.deletedAt) return;
  msg.deletedAt = new Date();
  msg.body = "";
  msg.reactions = [] as never;
  msg.mentions = [] as never;
  await msg.save();
  // Quotes of the deleted message must not keep showing its text.
  await Promise.all([
    Conversation.updateOne({ _id: msg.conversationId, "lastMessage.messageId": msg._id }, { $set: { "lastMessage.preview": DELETED_PREVIEW } }),
    Message.updateMany({ conversationId: msg.conversationId, "replyTo.messageId": msg._id }, { $set: { "replyTo.preview": DELETED_PREVIEW } }),
  ]);
  await broadcastUpdated(msg);
}

/** Sets (or with null, removes) the user's single reaction, atomically. */
export async function setReaction(userId: Id, messageId: string, emoji: string | null) {
  const msg = await loadVisibleMessage(userId, messageId);
  if (msg.deletedAt) throw badRequest("You can't react to a deleted message");
  if (msg.type === "system") throw badRequest("You can't react to group events");
  const uid = oid(userId);
  const others = { $filter: { input: "$reactions", cond: { $ne: ["$$this.userId", uid] } } };
  await Message.collection.updateOne({ _id: msg._id }, [
    { $set: { reactions: emoji ? { $concatArrays: [others, [{ userId: uid, emoji }]] } : others } },
  ]);
  const updated = await Message.findById(msg._id);
  if (!updated) throw messageNotFound();
  await broadcastUpdated(updated);
  return toMessage(updated.toObject() as MessageLean);
}

/** Moves the reader's read pointer forward (never back) and recomputes their unread count. */
export async function markRead(userId: Id, chatId: string, messageId: string) {
  const member = await requireMembership(chatId, userId);
  const id = oid(messageId);
  if (!(await Message.exists({ _id: id, conversationId: member.conversationId }))) throw messageNotFound();
  if (member.lastReadMessageId && member.lastReadMessageId >= id) return { unreadCount: member.unreadCount };

  // Same rule as when counting up on send: system events never count as unread.
  const unreadCount = await Message.countDocuments({
    conversationId: member.conversationId,
    _id: { $gt: id },
    senderId: { $ne: userId },
    hiddenFor: { $ne: userId },
    type: { $ne: "system" },
  });
  await Member.updateOne(
    { _id: member._id },
    { $set: { unreadCount, ...(unreadCount === 0 ? { mentionCount: 0 } : {}) }, $max: { lastReadMessageId: id, lastDeliveredMessageId: id } },
  );
  emitToUsers([userId], "chat:read", { chatId, unreadCount });
  await broadcastReceipt(member.conversationId, userId);
  return { unreadCount };
}

/** Recipient's device acknowledged a message. */
export async function markDelivered(userId: Id, chatId: string, messageId: string) {
  const id = oid(messageId);
  if (!(await Message.exists({ _id: id, conversationId: chatId }))) return;
  const res = await Member.updateOne(
    { conversationId: chatId, userId, leftAt: null, $or: [{ lastDeliveredMessageId: null }, { lastDeliveredMessageId: { $lt: id } }] },
    { $set: { lastDeliveredMessageId: id } },
  );
  if (res.modifiedCount) await broadcastReceipt(oid(chatId), userId);
}

/** On connect, everything that arrived while the user was offline counts as delivered. */
export async function markAllDelivered(userId: Id) {
  const members = await Member.find({ userId, leftAt: null }).select("conversationId lastDeliveredMessageId").lean();
  if (!members.length) return;
  const convs = await Conversation.find({ _id: { $in: members.map((m) => m.conversationId) }, lastMessage: { $ne: null } })
    .select("lastMessage")
    .lean();
  const latest = new Map(convs.map((c) => [String(c._id), c.lastMessage!]));

  const stale = members.filter((m) => {
    const last = latest.get(String(m.conversationId));
    return last && !sameId(last.senderId, userId) && (!m.lastDeliveredMessageId || m.lastDeliveredMessageId < last.messageId);
  });
  if (!stale.length) return;
  await Member.bulkWrite(
    stale.map((m) => ({
      updateOne: { filter: { _id: m._id }, update: { $max: { lastDeliveredMessageId: latest.get(String(m.conversationId))!.messageId } } },
    })),
  );
  await Promise.all(stale.map((m) => broadcastReceipt(m.conversationId, userId)));
}

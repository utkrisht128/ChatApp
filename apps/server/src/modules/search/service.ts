import { Types } from "mongoose";
import type { ChatRef, FileHit, MessageHit, Page, SearchQuery } from "@chat/shared";
import { escapeRegex, type Id } from "../../lib/ids";
import { fileUrl } from "../../lib/serialize";
import { Conversation } from "../../models/Conversation";
import { Member } from "../../models/Member";
import { Message, type MessageFields } from "../../models/Message";
import { User } from "../../models/User";
import { requireMembership } from "../chats/service";
import { toAttachment } from "../files/service";
import { toMessage } from "../messages/service";

const PAGE_SIZE = 25;
/**
 * Search reaches across the caller's most recently active chats. Beyond this the query
 * would need a per-chat clause for every group's join date, which stops being a sensible
 * single query; in practice nobody is a member of more than a few hundred chats.
 */
const MAX_SCOPED_CHATS = 300;

const oid = (id: Id) => (typeof id === "string" ? new Types.ObjectId(id) : id);
type MessageLean = MessageFields & { _id: Types.ObjectId };
type ConvLean = { _id: Types.ObjectId; type: string; name: string; avatarFileId?: Types.ObjectId | null; directKey?: string | null };

const empty = <T>(): Page<T> => ({ items: [], nextCursor: null });

/**
 * The set of messages a viewer may search: their current chats, minus messages hidden for
 * them or deleted, and — in groups — anything sent before they joined. This is the same
 * visibility rule `listMessages` applies, expressed as one filter.
 */
async function scopeFor(viewerId: Id, chatId?: string) {
  if (chatId) await requireMembership(chatId, viewerId);
  const members = await Member.find({ userId: viewerId, leftAt: null, ...(chatId ? { conversationId: oid(chatId) } : {}) })
    .select("conversationId joinedAt")
    .sort({ lastMessageAt: -1 })
    .limit(MAX_SCOPED_CHATS)
    .lean();
  if (!members.length) return null;

  const convs = await Conversation.find({ _id: { $in: members.map((m) => m.conversationId) } })
    .select("type name avatarFileId directKey")
    .lean<ConvLean[]>();
  const convById = new Map(convs.map((c) => [String(c._id), c]));

  const direct: Types.ObjectId[] = [];
  const groups: object[] = [];
  for (const m of members) {
    const conv = convById.get(String(m.conversationId));
    if (!conv) continue;
    if (conv.type === "group") groups.push({ conversationId: m.conversationId, createdAt: { $gte: m.joinedAt } });
    else direct.push(m.conversationId);
  }
  const or = [...(direct.length ? [{ conversationId: { $in: direct } }] : []), ...groups];
  if (!or.length) return null;

  return { convById, visible: { $or: or, hiddenFor: { $ne: oid(viewerId) }, deletedAt: null } };
}

/** Display details for each chat a result can belong to (direct chats resolve to the other person). */
async function chatRefs(viewerId: Id, convById: Map<string, ConvLean>): Promise<Map<string, ChatRef>> {
  const viewer = String(viewerId);
  const peerIdOf = (c: ConvLean) => c.directKey?.split(":").find((id) => id !== viewer);
  const peerIds = [...convById.values()].filter((c) => c.type === "direct").flatMap((c) => peerIdOf(c) ?? []);
  const peers = peerIds.length ? await User.find({ _id: { $in: peerIds } }).select("displayName avatarFileId").lean() : [];
  const peerById = new Map(peers.map((u) => [String(u._id), u]));

  return new Map(
    [...convById.values()].map((c) => {
      const peer = c.type === "direct" ? peerById.get(peerIdOf(c) ?? "") : undefined;
      return [
        String(c._id),
        {
          id: String(c._id),
          type: c.type as ChatRef["type"],
          name: c.type === "direct" ? (peer?.displayName ?? "Deleted account") : c.name,
          avatarUrl: c.type === "direct" ? fileUrl(peer?.avatarFileId) : fileUrl(c.avatarFileId),
        },
      ];
    }),
  );
}

/** Full-text search over message bodies, newest first. */
export async function searchMessages(viewerId: Id, q: SearchQuery): Promise<Page<MessageHit>> {
  const scope = await scopeFor(viewerId, q.chatId);
  if (!scope) return empty();

  const docs = await Message.find({
    ...scope.visible,
    type: { $ne: "system" },
    $text: { $search: q.q },
    ...(q.cursor ? { _id: { $lt: oid(q.cursor) } } : {}),
  })
    .sort({ _id: -1 })
    .limit(PAGE_SIZE + 1)
    .lean<MessageLean[]>();

  const page = docs.slice(0, PAGE_SIZE);
  const refs = await chatRefs(viewerId, scope.convById);
  return {
    items: page.flatMap((m) => {
      const chat = refs.get(String(m.conversationId));
      return chat ? [{ message: toMessage(m), chat }] : [];
    }),
    nextCursor: docs.length > PAGE_SIZE ? String(page.at(-1)!._id) : null,
  };
}

/** Attachments whose file name matches, newest first. One row per matching attachment. */
export async function searchFiles(viewerId: Id, q: SearchQuery): Promise<Page<FileHit>> {
  const scope = await scopeFor(viewerId, q.chatId);
  if (!scope) return empty();
  const rx = new RegExp(escapeRegex(q.q), "i");

  const docs = await Message.find({
    ...scope.visible,
    "attachments.name": { $regex: rx },
    ...(q.cursor ? { _id: { $lt: oid(q.cursor) } } : {}),
  })
    .sort({ _id: -1 })
    .limit(PAGE_SIZE + 1)
    .lean<MessageLean[]>();

  const page = docs.slice(0, PAGE_SIZE);
  const refs = await chatRefs(viewerId, scope.convById);
  return {
    items: page.flatMap((m) => {
      const chat = refs.get(String(m.conversationId));
      if (!chat) return [];
      return (m.attachments ?? [])
        .filter((a) => rx.test(a.name ?? ""))
        .map((a) => ({
          messageId: String(m._id),
          chat,
          senderId: String(m.senderId),
          createdAt: m.createdAt.toISOString(),
          attachment: toAttachment(a),
        }));
    }),
    nextCursor: docs.length > PAGE_SIZE ? String(page.at(-1)!._id) : null,
  };
}

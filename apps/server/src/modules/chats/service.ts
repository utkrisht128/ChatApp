import { Types } from "mongoose";
import { MAX_PINNED_CHATS, type ChatSummary, type MemberRole, type MessageType, type Page, type UpdateMembershipInput } from "@chat/shared";
import { badRequest, notFound } from "../../lib/errors";
import { isObjectId, type Id } from "../../lib/ids";
import { fileUrl, toPublicUser } from "../../lib/serialize";
import { Conversation } from "../../models/Conversation";
import { Member, type MemberFields } from "../../models/Member";
import { User } from "../../models/User";
import { PUBLIC_USER_FIELDS, presenceOf } from "../users/presence";

type MemberLean = MemberFields & { _id: Types.ObjectId };

const PAGE_SIZE = 30;
const chatNotFound = () => notFound("CHAT_NOT_FOUND", "Chat not found");

export const directKeyOf = (a: Id, b: Id) => [String(a), String(b)].sort().join(":");
const peerIdOf = (directKey: string | null | undefined, viewerId: string) =>
  directKey?.split(":").find((id) => id !== viewerId);

/**
 * The single authorization gate for anything scoped to a chat. Non-members get
 * 404 rather than 403 so chat ids can't be probed for existence.
 */
export async function requireMembership(chatId: string, userId: Id) {
  if (!isObjectId(chatId)) throw chatNotFound();
  const member = await Member.findOne({ conversationId: chatId, userId, leftAt: null });
  if (!member) throw chatNotFound();
  return member;
}

/** Turns memberships into chat-list rows with a fixed number of queries, regardless of list length. */
async function buildSummaries(viewerId: Id, members: MemberLean[]): Promise<ChatSummary[]> {
  if (members.length === 0) return [];
  const viewer = String(viewerId);

  const conversations = await Conversation.find({ _id: { $in: members.map((m) => m.conversationId) } }).lean();
  const convById = new Map(conversations.map((c) => [String(c._id), c]));

  const peerIds = conversations
    .filter((c) => c.type === "direct")
    .map((c) => peerIdOf(c.directKey, viewer))
    .filter((id): id is string => Boolean(id));
  const peers = peerIds.length ? await User.find({ _id: { $in: peerIds } }).select(PUBLIC_USER_FIELDS).lean() : [];
  const peerById = new Map(peers.map((u) => [String(u._id), u]));

  return members.flatMap((m): ChatSummary[] => {
    const c = convById.get(String(m.conversationId));
    if (!c) return [];
    const peerDoc = c.type === "direct" ? peerById.get(peerIdOf(c.directKey, viewer) ?? "") : undefined;
    const peer = peerDoc ? toPublicUser(peerDoc, presenceOf(peerDoc, { isContact: true })) : null;
    const last = c.lastMessage;
    return [
      {
        id: String(c._id),
        type: c.type as ChatSummary["type"],
        name: c.type === "direct" ? (peer?.displayName ?? "Deleted account") : c.name,
        avatarUrl: c.type === "direct" ? (peer?.avatarUrl ?? null) : fileUrl(c.avatarFileId),
        peer,
        memberCount: c.memberCount,
        lastMessage: last
          ? {
              id: String(last.messageId),
              senderId: String(last.senderId),
              preview: last.preview,
              type: last.type as MessageType,
              createdAt: last.createdAt.toISOString(),
            }
          : null,
        lastMessageAt: (m.lastMessageAt ?? c.lastMessageAt).toISOString(),
        unreadCount: m.unreadCount,
        mentionCount: m.mentionCount,
        pinned: Boolean(m.pinnedAt),
        archived: Boolean(m.archivedAt),
        mutedUntil: m.mutedUntil && m.mutedUntil > new Date() ? m.mutedUntil.toISOString() : null,
        role: m.role as MemberRole,
      },
    ];
  });
}

const encodeCursor = (m: MemberLean) => `${m.lastMessageAt.getTime()}_${m._id}`;
function decodeCursor(cursor: string) {
  const [t, id] = cursor.split("_");
  const time = Number(t);
  if (!Number.isFinite(time) || !isObjectId(id)) throw badRequest("Invalid cursor");
  return { time: new Date(time), id: new Types.ObjectId(id) };
}

/**
 * Chat list. Pinned chats all come first on the first page; the rest are keyset-paginated
 * by (lastMessageAt, _id) so pages stay stable while new messages arrive.
 */
export async function listChats(userId: Id, opts: { archived: boolean; cursor?: string }): Promise<Page<ChatSummary>> {
  const base = { userId, hidden: false, leftAt: null, archivedAt: opts.archived ? { $ne: null } : null };

  const pinned =
    !opts.cursor && !opts.archived
      ? await Member.find({ ...base, pinnedAt: { $ne: null } }).sort({ pinnedAt: -1 }).lean<MemberLean[]>()
      : [];

  const after = opts.cursor ? decodeCursor(opts.cursor) : null;
  const rest = await Member.find({
    ...base,
    pinnedAt: null,
    ...(after ? { $or: [{ lastMessageAt: { $lt: after.time } }, { lastMessageAt: after.time, _id: { $lt: after.id } }] } : {}),
  })
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(PAGE_SIZE + 1)
    .lean<MemberLean[]>();

  const page = rest.slice(0, PAGE_SIZE);
  return {
    items: await buildSummaries(userId, [...pinned, ...page]),
    nextCursor: rest.length > PAGE_SIZE ? encodeCursor(page.at(-1)!) : null,
  };
}

/**
 * Chats the user is in whose name (or the other person's name/username) matches. Searching
 * only ever looks at the caller's own memberships, so it can't reveal a chat they aren't in.
 */
export async function searchChats(userId: Id, query: string): Promise<ChatSummary[]> {
  const members = await Member.find({ userId, hidden: false, leftAt: null })
    .sort({ lastMessageAt: -1 })
    .limit(300)
    .lean<MemberLean[]>();
  const summaries = await buildSummaries(userId, members);
  const q = query.trim().toLowerCase().replace(/^@/, "");
  return summaries.filter((c) => c.name.toLowerCase().includes(q) || c.peer?.username.includes(q)).slice(0, 25);
}

export async function getChat(userId: Id, chatId: string) {
  const member = await requireMembership(chatId, userId);
  const [summary] = await buildSummaries(userId, [member.toObject() as MemberLean]);
  if (!summary) throw chatNotFound();
  return summary;
}

/** Tolerates the race where two requests insert the same membership at once. */
async function upsertMember(conversationId: Types.ObjectId, userId: Types.ObjectId, update: object) {
  try {
    await Member.updateOne({ conversationId, userId }, update, { upsert: true });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }
}

/** Finds or creates the one direct chat between two users. Idempotent and safe under concurrent calls. */
export async function openDirectChat(meId: Types.ObjectId, otherId: string) {
  if (String(meId) === otherId) throw badRequest("You can't start a chat with yourself");
  const other = await User.findOne({ _id: otherId, bannedAt: null }).select("_id");
  if (!other) throw notFound("USER_NOT_FOUND", "User not found");

  const directKey = directKeyOf(meId, other._id);
  let conv = await Conversation.findOne({ directKey });
  if (!conv) {
    try {
      conv = await Conversation.create({ type: "direct", directKey, memberCount: 2, createdBy: meId });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      conv = await Conversation.findOne({ directKey });
    }
  }
  if (!conv) throw new Error("Direct conversation could not be created");

  await Promise.all([
    // The person starting the chat always sees it (and un-archives/un-hides it).
    upsertMember(conv._id, meId, { $set: { hidden: false, archivedAt: null } }),
    // The recipient only sees it once a message arrives.
    upsertMember(conv._id, other._id, { $setOnInsert: { hidden: true } }),
  ]);
  return getChat(meId, String(conv._id));
}

export async function updateMembership(userId: Id, chatId: string, patch: UpdateMembershipInput) {
  const member = await requireMembership(chatId, userId);

  if (patch.archived !== undefined) {
    member.archivedAt = patch.archived ? (member.archivedAt ?? new Date()) : null;
    if (patch.archived) member.pinnedAt = null; // archived chats can't stay pinned
  }
  if (patch.pinned !== undefined) {
    if (patch.pinned && !member.pinnedAt) {
      const pinnedCount = await Member.countDocuments({ userId, leftAt: null, pinnedAt: { $ne: null } });
      if (pinnedCount >= MAX_PINNED_CHATS) throw badRequest(`You can pin up to ${MAX_PINNED_CHATS} chats`);
      member.archivedAt = null;
    }
    member.pinnedAt = patch.pinned ? (member.pinnedAt ?? new Date()) : null;
  }
  if (patch.mutedUntil !== undefined) member.mutedUntil = patch.mutedUntil ? new Date(patch.mutedUntil) : null;

  await member.save();
  return getChat(userId, chatId);
}

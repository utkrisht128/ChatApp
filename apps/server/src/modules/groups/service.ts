import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { describeSystemEvent, GROUP_LIMITS, type CreateGroupInput, type GroupInfo, type GroupPermissions, type MemberRole, type SystemEvent, type UpdateGroupInput } from "@chat/shared";
import { badRequest, forbidden, notFound } from "../../lib/errors";
import { isObjectId, sameId, type Id } from "../../lib/ids";
import { fileUrl, toPublicUser } from "../../lib/serialize";
import { Conversation, type ConversationDoc } from "../../models/Conversation";
import { Member, type MemberDoc } from "../../models/Member";
import { Message } from "../../models/Message";
import { User } from "../../models/User";
import { emitToUsers } from "../../realtime/bus";
import { directKeyOf, getChat, requireMembership } from "../chats/service";
import { claimAvatar, deleteFiles } from "../files/service";
import { activeMemberIds, toMessage } from "../messages/service";
import { PUBLIC_USER_FIELDS, presenceOf } from "../users/presence";

const oid = (id: Id) => (typeof id === "string" ? new Types.ObjectId(id) : id);
const isAdmin = (m: { role?: string | null }) => m.role === "owner" || m.role === "admin";
const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, member: 2 };

/** Loads a group the user belongs to. Non-members and direct chats get 404. */
async function loadGroup(chatId: string, userId: Id) {
  const member = await requireMembership(chatId, userId);
  const conv = await Conversation.findById(member.conversationId);
  if (!conv || conv.type !== "group") throw notFound("CHAT_NOT_FOUND", "Group not found");
  return { conv, member };
}

function assertAllowed(conv: ConversationDoc, member: MemberDoc, action: "addMembers" | "editInfo") {
  if (isAdmin(member) || conv.permissions?.[action] === "all") return;
  throw forbidden(action === "addMembers" ? "Only admins can add members to this group" : "Only admins can edit this group's info");
}

async function refreshMemberCount(conversationId: Types.ObjectId) {
  const memberCount = await Member.countDocuments({ conversationId, leftAt: null });
  await Conversation.updateOne({ _id: conversationId }, { $set: { memberCount } });
}

async function notifyUpdated(conversationId: Types.ObjectId, extra: Id[] = []) {
  emitToUsers(new Set([...(await activeMemberIds(conversationId)), ...extra.map(String)]), "chat:updated", { chatId: String(conversationId) });
}

/**
 * Posts a group event into the timeline. It bumps the chat in everyone's list but never
 * counts as unread. `body` carries server-rendered text for previews; clients re-render
 * from `system` so they can say "You".
 */
export async function postSystemMessage(conversationId: Types.ObjectId, actorId: Id, event: SystemEvent, targetIds: Id[] = [], value?: string) {
  const users = await User.find({ _id: { $in: [actorId, ...targetIds] } }).select("displayName").lean();
  const names = new Map(users.map((u) => [String(u._id), u.displayName]));
  const system = { event, actorId: String(actorId), targetIds: targetIds.map(String), ...(value ? { value } : {}) };
  const text = describeSystemEvent(system, (id) => names.get(id) ?? "Someone");

  const doc = await Message.create({
    conversationId,
    senderId: actorId,
    clientId: `sys-${randomUUID()}`,
    type: "system",
    body: text,
    system: { event, actorId: oid(actorId), targetIds: targetIds.map(oid), value },
  });
  await Promise.all([
    Conversation.updateOne(
      { _id: conversationId, $or: [{ lastMessage: null }, { "lastMessage.messageId": { $lt: doc._id } }] },
      { $set: { lastMessage: { messageId: doc._id, senderId: oid(actorId), preview: text, type: "system", createdAt: doc.createdAt } }, $max: { lastMessageAt: doc.createdAt } },
    ),
    Member.updateMany({ conversationId, leftAt: null }, { $set: { hidden: false }, $max: { lastMessageAt: doc.createdAt } }),
  ]);
  // Targets are included so someone just removed sees why the chat went away.
  const message = toMessage(doc.toObject() as never);
  emitToUsers(new Set([...(await activeMemberIds(conversationId)), ...targetIds.map(String)]), "message:new", { message });
  return message;
}

export async function createGroup(creatorId: Types.ObjectId, input: CreateGroupInput) {
  const ids = [...new Set(input.memberIds)].filter((id) => !sameId(id, creatorId));
  if (ids.length === 0) throw badRequest("Add at least one other person");
  const users = await User.find({ _id: { $in: ids }, bannedAt: null }).select("_id").lean();
  if (users.length !== ids.length) throw badRequest("Some of the people you picked are no longer available");

  const conv = await Conversation.create({
    type: "group",
    name: input.name,
    description: input.description ?? "",
    memberCount: ids.length + 1,
    createdBy: creatorId,
  });
  await Member.insertMany([
    { conversationId: conv._id, userId: creatorId, role: "owner" },
    ...ids.map((id) => ({ conversationId: conv._id, userId: oid(id), role: "member" })),
  ]);
  await postSystemMessage(conv._id, creatorId, "group_created", [], input.name);
  return getChat(creatorId, String(conv._id));
}

export async function getGroupInfo(viewerId: Id, chatId: string): Promise<GroupInfo> {
  const { conv } = await loadGroup(chatId, viewerId);
  const members = await Member.find({ conversationId: conv._id }).select("userId role joinedAt leftAt").lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).select(PUBLIC_USER_FIELDS).lean();
  // "Contacts"-only presence is visible to people who share a direct chat with that user.
  const directs = await Conversation.find({ directKey: { $in: users.map((u) => directKeyOf(viewerId, u._id)) } }).select("directKey").lean();
  const contactKeys = new Set(directs.map((c) => c.directKey));
  const userById = new Map(users.map((u) => [String(u._id), u]));

  return {
    id: String(conv._id),
    name: conv.name,
    description: conv.description,
    avatarUrl: fileUrl(conv.avatarFileId),
    permissions: {
      send: (conv.permissions?.send ?? "all") as GroupPermissions["send"],
      addMembers: (conv.permissions?.addMembers ?? "admins") as GroupPermissions["addMembers"],
      editInfo: (conv.permissions?.editInfo ?? "admins") as GroupPermissions["editInfo"],
    },
    memberCount: conv.memberCount,
    createdAt: conv.createdAt.toISOString(),
    createdBy: String(conv.createdBy),
    members: members
      .flatMap((m) => {
        const u = userById.get(String(m.userId));
        if (!u) return [];
        const active = !m.leftAt;
        const isContact = contactKeys.has(directKeyOf(viewerId, u._id));
        return [{ user: toPublicUser(u, active ? presenceOf(u, { isContact }) : undefined), role: m.role as MemberRole, joinedAt: m.joinedAt.toISOString(), active }];
      })
      .sort((a, b) => Number(b.active) - Number(a.active) || ROLE_ORDER[a.role]! - ROLE_ORDER[b.role]! || a.joinedAt.localeCompare(b.joinedAt)),
  };
}

export async function updateGroup(userId: Id, chatId: string, patch: UpdateGroupInput) {
  const { conv, member } = await loadGroup(chatId, userId);
  if (patch.name !== undefined || patch.description !== undefined) assertAllowed(conv, member, "editInfo");
  if (patch.permissions && !isAdmin(member)) throw forbidden("Only admins can change group settings");

  const events: [SystemEvent, string?][] = [];
  if (patch.name !== undefined && patch.name !== conv.name) {
    conv.name = patch.name;
    events.push(["renamed", patch.name]);
  }
  if (patch.description !== undefined && patch.description !== conv.description) {
    conv.description = patch.description;
    events.push(["description_changed"]);
  }
  if (patch.permissions) {
    let changed = false;
    for (const [key, value] of Object.entries(patch.permissions)) {
      if (value && conv.get(`permissions.${key}`) !== value) {
        conv.set(`permissions.${key}`, value);
        changed = true;
      }
    }
    if (changed) events.push(["permissions_changed"]);
  }
  if (!events.length) return getGroupInfo(userId, chatId);

  await conv.save();
  for (const [event, value] of events) await postSystemMessage(conv._id, userId, event, [], value);
  await notifyUpdated(conv._id);
  return getGroupInfo(userId, chatId);
}

export async function setGroupAvatar(userId: Types.ObjectId, chatId: string, fileId: string | null) {
  const { conv, member } = await loadGroup(chatId, userId);
  assertAllowed(conv, member, "editInfo");
  const previous = conv.avatarFileId;
  conv.avatarFileId = fileId ? await claimAvatar(userId, fileId) : null;
  await conv.save();
  if (previous && !sameId(previous, conv.avatarFileId)) await deleteFiles([previous]);
  await postSystemMessage(conv._id, userId, "photo_changed", [], fileId ? undefined : "removed");
  await notifyUpdated(conv._id);
  return getGroupInfo(userId, chatId);
}

export async function addMembers(userId: Id, chatId: string, userIds: string[]) {
  const { conv, member } = await loadGroup(chatId, userId);
  assertAllowed(conv, member, "addMembers");

  const ids = [...new Set(userIds)];
  const [users, existing] = await Promise.all([
    User.find({ _id: { $in: ids }, bannedAt: null }).select("_id").lean(),
    Member.find({ conversationId: conv._id, userId: { $in: ids }, leftAt: null }).select("userId").lean(),
  ]);
  const alreadyIn = new Set(existing.map((m) => String(m.userId)));
  const toAdd = users.map((u) => String(u._id)).filter((id) => !alreadyIn.has(id));
  if (!toAdd.length) return getGroupInfo(userId, chatId);

  const current = await Member.countDocuments({ conversationId: conv._id, leftAt: null });
  if (current + toAdd.length > GROUP_LIMITS.maxMembers) throw badRequest(`Groups are limited to ${GROUP_LIMITS.maxMembers} members`);

  const now = new Date();
  // Upsert so people who left before can be re-added; they start fresh from now.
  await Member.bulkWrite(
    toAdd.map((id) => ({
      updateOne: {
        filter: { conversationId: conv._id, userId: oid(id) },
        update: {
          $set: {
            role: "member",
            joinedAt: now,
            leftAt: null,
            hidden: false,
            unreadCount: 0,
            mentionCount: 0,
            archivedAt: null,
            pinnedAt: null,
            lastReadMessageId: null,
            lastDeliveredMessageId: null,
            lastMessageAt: now,
          },
        },
        upsert: true,
      },
    })),
  );
  await refreshMemberCount(conv._id);
  await postSystemMessage(conv._id, userId, "members_added", toAdd);
  await notifyUpdated(conv._id);
  return getGroupInfo(userId, chatId);
}

export async function removeMember(userId: Id, chatId: string, targetId: string) {
  if (sameId(targetId, userId)) {
    await leaveGroup(userId, chatId);
    return null;
  }
  const { conv, member } = await loadGroup(chatId, userId);
  const target = isObjectId(targetId) ? await Member.findOne({ conversationId: conv._id, userId: targetId, leftAt: null }) : null;
  if (!target) throw notFound("USER_NOT_FOUND", "That person isn't in this group");
  if (!isAdmin(member)) throw forbidden("Only admins can remove members");
  if (target.role === "owner") throw forbidden("The group owner can't be removed");
  if (target.role === "admin" && member.role !== "owner") throw forbidden("Only the owner can remove an admin");

  target.leftAt = new Date();
  target.role = "member";
  await target.save();
  await refreshMemberCount(conv._id);
  await postSystemMessage(conv._id, userId, "member_removed", [targetId]);
  await notifyUpdated(conv._id, [targetId]);
  return getGroupInfo(userId, chatId);
}

export async function leaveGroup(userId: Id, chatId: string) {
  const { conv, member } = await loadGroup(chatId, userId);

  // An owner leaving hands the group to the longest-serving admin, else the longest-serving member.
  if (member.role === "owner") {
    const others = { conversationId: conv._id, leftAt: null, userId: { $ne: oid(userId) } };
    const successor =
      (await Member.findOne({ ...others, role: "admin" }).sort({ joinedAt: 1 })) ?? (await Member.findOne(others).sort({ joinedAt: 1 }));
    if (successor) {
      successor.role = "owner";
      await successor.save();
    }
  }
  member.leftAt = new Date();
  member.role = "member";
  await member.save();
  await refreshMemberCount(conv._id);
  await postSystemMessage(conv._id, userId, "member_left");
  await notifyUpdated(conv._id, [userId]);
}

export async function setRole(userId: Id, chatId: string, targetId: string, role: "admin" | "member") {
  const { conv, member } = await loadGroup(chatId, userId);
  if (!isAdmin(member)) throw forbidden("Only admins can change roles");
  const target = isObjectId(targetId) ? await Member.findOne({ conversationId: conv._id, userId: targetId, leftAt: null }) : null;
  if (!target) throw notFound("USER_NOT_FOUND", "That person isn't in this group");
  if (target.role === "owner") throw forbidden("The owner's role can't be changed");
  if (role === "member" && target.role === "admin" && member.role !== "owner") throw forbidden("Only the owner can remove admin rights");
  if (target.role !== role) {
    target.role = role;
    await target.save();
    await notifyUpdated(conv._id);
  }
  return getGroupInfo(userId, chatId);
}

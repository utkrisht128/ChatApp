import type { z } from "zod";
import type { PublicUser, updateProfileSchema, updateSettingsSchema } from "@chat/shared";
import { conflict, notFound } from "../../lib/errors";
import { escapeRegex, sameId, type Id } from "../../lib/ids";
import { claimAvatar, deleteFiles } from "../files/service";
import { toPublicUser } from "../../lib/serialize";
import { Conversation } from "../../models/Conversation";
import { User, type UserDoc } from "../../models/User";
import { directKeyOf } from "../chats/service";
import { blockExists } from "../moderation/blocks";
import { PUBLIC_USER_FIELDS, presenceOf } from "./presence";

export async function updateProfile(user: UserDoc, input: z.output<typeof updateProfileSchema>) {
  if (input.username && input.username !== user.username) {
    if (await User.exists({ username: input.username })) {
      throw conflict("USERNAME_TAKEN", "This username is taken", { username: "This username is taken" });
    }
    user.username = input.username;
  }
  if (input.displayName !== undefined) user.displayName = input.displayName;
  if (input.bio !== undefined) user.bio = input.bio;
  await user.save();
  return user;
}

export async function updateSettings(user: UserDoc, patch: z.output<typeof updateSettingsSchema>) {
  // Dotted $set paths, so a partial update never overwrites sibling settings.
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === "notifications") {
      for (const [k, v] of Object.entries(value as object)) if (v !== undefined) set[`settings.notifications.${k}`] = v;
    } else {
      set[`settings.${key}`] = value;
    }
  }
  const updated = await User.findByIdAndUpdate(user._id, { $set: set }, { returnDocument: "after", runValidators: true });
  if (!updated) throw notFound("USER_NOT_FOUND", "User not found");
  return updated;
}

export async function setAvatar(user: UserDoc, fileId: string | null) {
  const previous = user.avatarFileId;
  user.avatarFileId = fileId ? await claimAvatar(user._id, fileId) : null;
  await user.save();
  if (previous && !sameId(previous, user.avatarFileId)) await deleteFiles([previous]);
  return user;
}

/** Username prefix or display-name substring. Input is regex-escaped, so it can't inject patterns. */
export async function searchUsers(meId: Id, query: string): Promise<PublicUser[]> {
  const q = query.toLowerCase().replace(/^@/, "");
  if (!q) return [];
  const rx = escapeRegex(q);
  const users = await User.find({
    _id: { $ne: meId },
    bannedAt: null,
    $or: [{ username: { $regex: `^${rx}` } }, { displayName: { $regex: rx, $options: "i" } }],
  })
    .select(PUBLIC_USER_FIELDS)
    .limit(20)
    .lean();

  const rank = (u: { username: string }) => (u.username === q ? 0 : u.username.startsWith(q) ? 1 : 2);
  return users.sort((a, b) => rank(a) - rank(b) || a.username.localeCompare(b.username)).map((u) => toPublicUser(u));
}

export async function getProfile(meId: Id, username: string) {
  const user = await User.findOne({ username: username.toLowerCase(), bannedAt: null }).select(PUBLIC_USER_FIELDS).lean();
  if (!user) throw notFound("USER_NOT_FOUND", "User not found");
  const [isContact, blocked] = await Promise.all([
    Conversation.exists({ directKey: directKeyOf(meId, user._id) }).then(Boolean),
    blockExists(meId, user._id),
  ]);
  // A block hides presence both ways, without revealing that a block exists.
  return toPublicUser(user, blocked ? undefined : presenceOf(user, { isContact }));
}

import type { Me, PublicUser } from "@chat/shared";
import type { UserDoc, UserFields } from "../models/User";

type UserLike = Pick<UserFields, "username" | "displayName" | "bio" | "avatarFileId"> & { _id: { toString(): string } };

export const fileUrl = (fileId: { toString(): string } | null | undefined) => (fileId ? `/api/files/${fileId}` : null);

/**
 * Public view of a user. Presence fields are passed in by the caller, which is
 * responsible for applying privacy settings and blocks before including them.
 */
export function toPublicUser(user: UserLike, presence?: { online?: boolean; lastSeenAt?: Date | null }): PublicUser {
  return {
    id: user._id.toString(),
    username: user.username,
    displayName: user.displayName,
    avatarUrl: fileUrl(user.avatarFileId),
    bio: user.bio ?? "",
    ...(presence?.online !== undefined ? { online: presence.online } : {}),
    ...(presence?.lastSeenAt !== undefined ? { lastSeenAt: presence.lastSeenAt?.toISOString() ?? null } : {}),
  };
}

export function toMe(user: UserDoc): Me {
  const s = user.settings;
  return {
    ...toPublicUser(user),
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    role: user.role as Me["role"],
    settings: {
      theme: s.theme as Me["settings"]["theme"],
      readReceipts: s.readReceipts,
      lastSeenVisibility: s.lastSeenVisibility as Me["settings"]["lastSeenVisibility"],
      onlineVisibility: s.onlineVisibility as Me["settings"]["onlineVisibility"],
      enterToSend: s.enterToSend,
      sounds: s.sounds,
      notifications: {
        messages: s.notifications?.messages ?? true,
        groups: s.notifications?.groups ?? true,
        mentions: s.notifications?.mentions ?? true,
        showPreview: s.notifications?.showPreview ?? true,
      },
    },
    createdAt: user.createdAt.toISOString(),
  };
}

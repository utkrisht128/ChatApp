import { isOnline } from "../../realtime/presence";

type Subject = {
  _id: { toString(): string };
  lastSeenAt?: Date | null;
  settings?: { lastSeenVisibility?: string | null; onlineVisibility?: string | null } | null;
};

const visible = (setting: string | null | undefined, isContact: boolean) =>
  !setting || setting === "everyone" || (setting === "contacts" && isContact);

/**
 * Presence fields a viewer is allowed to see, per the subject's privacy settings.
 * "Contacts" means people the subject shares a direct chat with. Hidden fields are omitted entirely.
 */
export function presenceOf(user: Subject, { isContact }: { isContact: boolean }) {
  return {
    ...(visible(user.settings?.onlineVisibility, isContact) ? { online: isOnline(user._id.toString()) } : {}),
    ...(visible(user.settings?.lastSeenVisibility, isContact) ? { lastSeenAt: user.lastSeenAt ?? null } : {}),
  };
}

/** Fields needed to render a public user with presence. */
export const PUBLIC_USER_FIELDS =
  "username displayName bio avatarFileId lastSeenAt settings.lastSeenVisibility settings.onlineVisibility";

import { z } from "zod";
import { objectIdSchema, type MemberRole } from "./chats";
import type { PublicUser } from "./models";

export const GROUP_LIMITS = { maxMembers: 256, name: 64, description: 512 } as const;

export const SYSTEM_EVENTS = [
  "group_created",
  "members_added",
  "member_removed",
  "member_left",
  "renamed",
  "description_changed",
  "permissions_changed",
] as const;
export type SystemEvent = (typeof SYSTEM_EVENTS)[number];
export type SystemInfo = { event: SystemEvent; actorId: string; targetIds: string[]; value?: string };

const permission = z.enum(["all", "admins"]);
export type GroupPermission = z.infer<typeof permission>;
export type GroupPermissions = { send: GroupPermission; addMembers: GroupPermission; editInfo: GroupPermission };

const nameSchema = z.string().trim().min(1, "Give the group a name").max(GROUP_LIMITS.name);
const descriptionSchema = z.string().trim().max(GROUP_LIMITS.description);

export const createGroupSchema = z.strictObject({
  name: nameSchema,
  description: descriptionSchema.optional(),
  memberIds: z.array(objectIdSchema).min(1, "Add at least one person").max(GROUP_LIMITS.maxMembers - 1),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.strictObject({
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
  permissions: z
    .strictObject({ send: permission.optional(), addMembers: permission.optional(), editInfo: permission.optional() })
    .optional(),
});
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const addMembersSchema = z.strictObject({ userIds: z.array(objectIdSchema).min(1).max(50) });
export const setRoleSchema = z.strictObject({ role: z.enum(["admin", "member"]) });

export type GroupMember = { user: PublicUser; role: MemberRole; joinedAt: string; active: boolean };

export type GroupInfo = {
  id: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  permissions: GroupPermissions;
  memberCount: number;
  createdAt: string;
  createdBy: string;
  /** Includes former members (active: false) so their old messages still show a name. */
  members: GroupMember[];
};

const joinNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? "someone") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * Human text for a system event. `nameOf(id, asTarget)` lets the client say "You added Bob"
 * / "Alice removed you"; the server uses plain display names for chat-list previews.
 */
export function describeSystemEvent(s: SystemInfo, nameOf: (id: string, asTarget: boolean) => string) {
  const actor = nameOf(s.actorId, false);
  const targets = joinNames(s.targetIds.map((id) => nameOf(id, true)));
  switch (s.event) {
    case "group_created":
      return `${actor} created the group${s.value ? ` “${s.value}”` : ""}`;
    case "members_added":
      return `${actor} added ${targets}`;
    case "member_removed":
      return `${actor} removed ${targets}`;
    case "member_left":
      return `${actor} left the group`;
    case "renamed":
      return `${actor} renamed the group to “${s.value ?? ""}”`;
    case "description_changed":
      return `${actor} changed the group description`;
    case "permissions_changed":
      return `${actor} changed the group settings`;
  }
}

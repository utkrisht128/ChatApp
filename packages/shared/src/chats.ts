import { z } from "zod";
import type { PublicUser } from "./models";

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const MAX_PINNED_CHATS = 5;

export const createDirectChatSchema = z.strictObject({ userId: objectIdSchema });

export const updateMembershipSchema = z.strictObject({
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  /** ISO timestamp, or null to unmute. "Forever" is a far-future date. */
  mutedUntil: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;

export const listChatsQuerySchema = z.object({
  archived: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  cursor: z.string().max(80).optional(),
});

export const userSearchQuerySchema = z.object({ q: z.string().trim().min(1).max(64) });

export const MESSAGE_TYPES = ["text", "image", "video", "file", "audio", "voice", "system"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export type LastMessage = {
  id: string;
  senderId: string;
  preview: string;
  type: MessageType;
  createdAt: string;
};

export type MemberRole = "owner" | "admin" | "member";

export type ChatSummary = {
  id: string;
  type: "direct" | "group";
  /** Group name, or the other person's display name for direct chats. */
  name: string;
  avatarUrl: string | null;
  /** The other participant (direct chats only). */
  peer: PublicUser | null;
  memberCount: number;
  lastMessage: LastMessage | null;
  lastMessageAt: string;
  unreadCount: number;
  mentionCount: number;
  pinned: boolean;
  archived: boolean;
  mutedUntil: string | null;
  role: MemberRole;
};

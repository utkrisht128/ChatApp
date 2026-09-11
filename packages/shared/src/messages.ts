import { z } from "zod";
import { objectIdSchema, type MessageType } from "./chats";
import type { Page } from "./api";

export const MAX_MESSAGE_LENGTH = 4000;
/** Messages can be edited for this long after sending. */
export const EDIT_WINDOW_MS = 48 * 3_600_000;
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/** One-line preview used in the chat list and reply quotes (identical on client and server). */
export function messagePreview(body: string) {
  const s = body.replace(/\s+/g, " ").trim();
  return s.length > 120 ? `${s.slice(0, 119)}…` : s;
}

const bodySchema = z
  .string()
  .trim()
  .min(1, "Message can't be empty")
  .max(MAX_MESSAGE_LENGTH, `Messages are limited to ${MAX_MESSAGE_LENGTH} characters`);

/** Client-generated id that makes sending idempotent (safe to retry). */
export const clientIdSchema = z.string().regex(/^[\w-]{8,64}$/, "Invalid client id");

export const sendMessageSchema = z.strictObject({
  clientId: clientIdSchema,
  body: bodySchema,
  replyToId: objectIdSchema.optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.strictObject({ body: bodySchema });

export const reactionSchema = z.strictObject({
  /** One reaction per person; null removes yours. */
  emoji: z
    .string()
    .max(16)
    .regex(/^\p{Extended_Pictographic}/u, "Not an emoji")
    .nullable(),
});

export const markReadSchema = z.strictObject({ messageId: objectIdSchema });

export const listMessagesQuerySchema = z.object({
  before: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const deleteMessageQuerySchema = z.object({ scope: z.enum(["me", "everyone"]).default("everyone") });

export type Reaction = { emoji: string; userIds: string[] };

export type Message = {
  id: string;
  chatId: string;
  senderId: string;
  clientId: string;
  type: MessageType;
  body: string;
  replyTo: { id: string; senderId: string; preview: string } | null;
  reactions: Reaction[];
  mentions: string[];
  forwarded: boolean;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
};

/**
 * Per-member receipt pointers: every message with id ≤ pointer was delivered to / read by
 * that member. `readId` is omitted when either side has read receipts turned off.
 */
export type Receipt = { userId: string; deliveredId: string | null; readId?: string | null };

export type MessagePage = Page<Message> & { receipts?: Receipt[] };

/* ── Real-time events ───────────────────────────────────────────────────── */

export const typingEventSchema = z.strictObject({ chatId: objectIdSchema, isTyping: z.boolean() });
export const deliveredEventSchema = z.strictObject({ chatId: objectIdSchema, messageId: objectIdSchema });

export interface ServerToClientEvents {
  "message:new": (p: { message: Message }) => void;
  "message:updated": (p: { message: Message }) => void;
  /** "Delete for me" — sync your other devices. */
  "message:hidden": (p: { chatId: string; messageId: string }) => void;
  "receipt:updated": (p: Receipt & { chatId: string }) => void;
  typing: (p: { chatId: string; userId: string; isTyping: boolean }) => void;
  presence: (p: { userId: string; online?: boolean; lastSeenAt?: string | null }) => void;
  /** You read a chat on another device. */
  "chat:read": (p: { chatId: string; unreadCount: number }) => void;
}

export interface ClientToServerEvents {
  typing: (p: z.infer<typeof typingEventSchema>) => void;
  "message:delivered": (p: z.infer<typeof deliveredEventSchema>) => void;
}

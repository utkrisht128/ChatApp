import { z } from "zod";
import { objectIdSchema, type MessageType } from "./chats";
import type { Page } from "./api";
import type { SystemInfo } from "./groups";
import { attachmentIcon, attachmentInputSchema, attachmentLabel, MAX_ATTACHMENTS, type Attachment, type FileKind } from "./files";

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

export const sendMessageSchema = z
  .strictObject({
    clientId: clientIdSchema,
    /** Optional when attachments are present (it becomes the caption). */
    body: z.string().trim().max(MAX_MESSAGE_LENGTH, `Messages are limited to ${MAX_MESSAGE_LENGTH} characters`).default(""),
    replyToId: objectIdSchema.optional(),
    attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENTS).default([]),
  })
  .refine((m) => m.body.length > 0 || m.attachments.length > 0, { message: "Message can't be empty", path: ["body"] });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** Chat-list preview for any message: text, attachment label, or both ("📷 Look at this"). */
export function summarizeMessage(m: { body: string; attachments: { kind: FileKind; name: string; durationMs?: number }[] }) {
  const text = messagePreview(m.body);
  const first = m.attachments[0];
  if (!first) return text;
  return text ? `${attachmentIcon(first.kind)} ${text}` : attachmentLabel(m.attachments);
}

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
  attachments: Attachment[];
  /** Present on type "system" (e.g. "Alice added Bob"); `body` then holds a server-rendered fallback. */
  system: SystemInfo | null;
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
  /** Group info, membership or roles changed — refetch. Also sent to someone just removed. */
  "chat:updated": (p: { chatId: string }) => void;
}

export interface ClientToServerEvents {
  typing: (p: z.infer<typeof typingEventSchema>) => void;
  "message:delivered": (p: z.infer<typeof deliveredEventSchema>) => void;
}

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

/**
 * `@username` in a message body. The leading boundary stops an email address ("a@bob")
 * reading as a mention. Anything that doesn't resolve to a real member of the chat is
 * ignored by the server, so a mention can't be faked from the client.
 */
const MENTION_RE = /(?:^|[^\w@])@([a-zA-Z0-9_]{3,24})/g;

export function parseMentions(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_RE)].map((m) => m[1]!.toLowerCase()))].slice(0, 50);
}

/** Splits a body into [text, mentionedUsername | null] pairs for rendering. */
export function mentionParts(body: string): [string, string | null][] {
  const parts: [string, string | null][] = [];
  let at = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const start = m.index + m[0].length - m[1]!.length - 1; // position of the "@"
    if (start > at) parts.push([body.slice(at, start), null]);
    parts.push([body.slice(start, start + m[1]!.length + 1), m[1]!.toLowerCase()]);
    at = start + m[1]!.length + 1;
  }
  if (at < body.length) parts.push([body.slice(at), null]);
  return parts;
}

export const MAX_PINNED_MESSAGES = 10;
/** Cap on one person's starred list, so it stays a single cheap query. */
export const MAX_STARRED = 500;
export const MAX_FORWARD_TARGETS = 10;

export const forwardMessageSchema = z.strictObject({
  /** One clientId per target chat, so a retried forward doesn't duplicate. */
  targets: z
    .array(z.strictObject({ chatId: objectIdSchema, clientId: clientIdSchema }))
    .min(1, "Pick at least one chat")
    .max(MAX_FORWARD_TARGETS),
});
export type ForwardMessageInput = z.infer<typeof forwardMessageSchema>;

export const setPinnedSchema = z.strictObject({ pinned: z.boolean() });
export const setStarredSchema = z.strictObject({ starred: z.boolean() });

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

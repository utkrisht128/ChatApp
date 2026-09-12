import { z } from "zod";
import { objectIdSchema } from "./chats";
import type { Attachment } from "./files";
import type { Message } from "./messages";

export const SEARCH_TYPES = ["messages", "chats", "users", "files"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const MIN_SEARCH_LENGTH = 2;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(MIN_SEARCH_LENGTH, "Type at least 2 characters").max(100),
  type: z.enum(SEARCH_TYPES).default("messages"),
  /** Restricts message/file results to one chat (in-chat search). */
  chatId: objectIdSchema.optional(),
  cursor: objectIdSchema.optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Just enough of a chat to render a result row without loading the whole summary. */
export type ChatRef = { id: string; type: "direct" | "group"; name: string; avatarUrl: string | null };

export type MessageHit = { message: Message; chat: ChatRef };
export type FileHit = { messageId: string; chat: ChatRef; senderId: string; createdAt: string; attachment: Attachment };

/**
 * Highlights every occurrence of the query's words in `text`, as [text, isMatch] pairs.
 * Used for search-result snippets; the same splitting runs on both sides so a hit always
 * looks the same wherever it is rendered.
 */
export function highlightParts(text: string, query: string): [string, boolean][] {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter((w) => w.length >= MIN_SEARCH_LENGTH))];
  if (!words.length) return [[text, false]];
  const lower = text.toLowerCase();
  const spans: [number, number][] = [];
  for (const w of words) {
    for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + w.length)) spans.push([i, i + w.length]);
  }
  if (!spans.length) return [[text, false]];
  spans.sort((a, b) => a[0] - b[0]);

  const parts: [string, boolean][] = [];
  let at = 0;
  for (const [start, end] of spans) {
    if (end <= at) continue; // already inside a previous (overlapping) match
    const from = Math.max(start, at);
    if (from > at) parts.push([text.slice(at, from), false]);
    parts.push([text.slice(from, end), true]);
    at = end;
  }
  if (at < text.length) parts.push([text.slice(at), false]);
  return parts;
}

/** Trims a long body around the first match so the snippet shows the interesting part. */
export function snippet(text: string, query: string, radius = 70) {
  const flat = text.replace(/\s+/g, " ").trim();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const at = words.reduce((best, w) => {
    const i = flat.toLowerCase().indexOf(w);
    return i !== -1 && (best === -1 || i < best) ? i : best;
  }, -1);
  if (at === -1 || flat.length <= radius * 2) return flat;
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

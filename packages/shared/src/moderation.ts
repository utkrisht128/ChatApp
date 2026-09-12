import { z } from "zod";
import { objectIdSchema } from "./chats";
import type { PublicUser } from "./models";

export const REPORT_REASONS = ["spam", "harassment", "hate", "violence", "nudity", "scam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam or unwanted messages",
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  violence: "Violence or threats",
  nudity: "Nudity or sexual content",
  scam: "Scam or fraud",
  other: "Something else",
};

export const REPORT_STATUSES = ["open", "reviewed", "actioned", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const createReportSchema = z.strictObject({
  subject: z.enum(["user", "message"]),
  targetId: objectIdSchema,
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(500).default(""),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

export const setBlockedSchema = z.strictObject({ blocked: z.boolean() });

export type BlockedUser = PublicUser & { blockedAt: string };

/* ── Link previews ──────────────────────────────────────────────────────── */

export const linkPreviewQuerySchema = z.object({ url: z.string().trim().max(2048) });

/**
 * What the server is willing to say about a link. No image is included: fetching a
 * third-party image from the browser would leak every reader's IP to that site, and
 * proxying the bytes is not worth the cost here.
 */
export type LinkPreview = {
  url: string;
  host: string;
  title: string;
  description: string;
  siteName: string;
};

/** First http(s) link in a message body, if any — used to decide whether to ask for a preview. */
export function firstLink(body: string): string | null {
  const match = /\b(?:https?:\/\/|www\.)[^\s<>]+[^\s<>.,:;"'!?)\]}]/i.exec(body);
  if (!match) return null;
  const raw = match[0];
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

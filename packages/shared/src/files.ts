import { z } from "zod";
import { objectIdSchema } from "./chats";

export const FILE_KINDS = ["image", "video", "audio", "voice", "file"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const UPLOAD_PURPOSES = ["attachment", "avatar", "thumb"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const MAX_ATTACHMENTS = 10;
/** Default per-file limit (the server's MAX_UPLOAD_MB can only lower it). */
export const DEFAULT_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const MAX_VOICE_MS = 5 * 60_000;

/** Server-enforced allowlist. No SVG or HTML: they can carry scripts. */
export const ALLOWED_MIME: Record<FileKind, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
  audio: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/wav", "audio/webm"],
  voice: ["audio/webm", "audio/ogg", "audio/mp4"],
  file: [
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/json",
    "application/zip",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
};

/** "audio/webm;codecs=opus" → "audio/webm". */
export const baseMime = (mime: string) => (mime.split(";")[0] ?? "").trim().toLowerCase();

export const uploadQuerySchema = z
  .object({
    purpose: z.enum(UPLOAD_PURPOSES),
    kind: z.enum(FILE_KINDS),
    chatId: objectIdSchema.optional(),
    name: z.string().trim().min(1).max(200).default("file"),
  })
  .refine((q) => q.purpose === "avatar" || q.chatId, { message: "chatId is required", path: ["chatId"] });
export type UploadQuery = z.infer<typeof uploadQuerySchema>;

/** Display details the client measured (dimensions, duration, waveform, blur placeholder). */
export const attachmentInputSchema = z.strictObject({
  fileId: objectIdSchema,
  width: z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
  durationMs: z.number().int().nonnegative().max(6 * 3_600_000).optional(),
  waveform: z.array(z.number().int().min(0).max(255)).max(64).optional(),
  placeholder: z
    .string()
    .max(4000)
    .regex(/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/)
    .optional(),
  thumbFileId: objectIdSchema.optional(),
});
export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

export const setAvatarSchema = z.strictObject({ fileId: objectIdSchema.nullable() });

export type UploadedFile = { id: string; kind: FileKind; mime: string; size: number; name: string };

export type Attachment = {
  id: string;
  kind: FileKind;
  mime: string;
  size: number;
  name: string;
  url: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  placeholder?: string;
  thumbUrl?: string | null;
};

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const ICON: Record<FileKind, string> = { image: "📷", video: "🎥", audio: "🎵", voice: "🎤", file: "📄" };

/** Chat-list label for attachments: "📷 Photo", "📷 3 photos", "🎤 Voice message (0:12)", "📄 notes.pdf". */
export function attachmentLabel(attachments: { kind: FileKind; name: string; durationMs?: number }[]) {
  const first = attachments[0];
  if (!first) return "";
  const n = attachments.length;
  switch (first.kind) {
    case "image":
      return n > 1 ? `📷 ${n} photos` : "📷 Photo";
    case "video":
      return n > 1 ? `🎥 ${n} videos` : "🎥 Video";
    case "voice":
      return `🎤 Voice message${first.durationMs ? ` (${formatDuration(first.durationMs)})` : ""}`;
    case "audio":
      return `🎵 ${first.name}`;
    case "file":
      return n > 1 ? `📄 ${n} files` : `📄 ${first.name}`;
  }
}

export const attachmentIcon = (kind: FileKind) => ICON[kind];

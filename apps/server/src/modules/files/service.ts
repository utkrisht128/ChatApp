import { Types } from "mongoose";
import { ALLOWED_MIME, baseMime, MAX_AVATAR_BYTES, type Attachment, type AttachmentInput, type UploadedFile, type UploadQuery } from "@chat/shared";
import { env } from "../../config/env";
import { AppError, badRequest, notFound } from "../../lib/errors";
import { isObjectId, sameId, type Id } from "../../lib/ids";
import { logger } from "../../lib/logger";
import { contentMatches } from "../../lib/sniff";
import { storage, type StoredFile } from "../../lib/storage";
import { Conversation } from "../../models/Conversation";
import { Member } from "../../models/Member";
import { Message } from "../../models/Message";
import { User } from "../../models/User";
import { requireMembership } from "../chats/service";

const MB = 1024 * 1024;
const oid = (id: Id) => (typeof id === "string" ? new Types.ObjectId(id) : id);
const fileNotFound = () => notFound("FILE_NOT_FOUND", "File not found");
const unsupported = (message: string) => new AppError(415, "UNSUPPORTED_MEDIA_TYPE", message);

/** Strip path separators and control characters; the name is only ever displayed / offered for download. */
const cleanName = (name: string) => name.replace(/[/\\\x00-\x1f\x7f]/g, "_").slice(0, 200) || "file";

export async function uploadFile(ownerId: Types.ObjectId, q: UploadQuery, body: Buffer, declaredType: string): Promise<UploadedFile> {
  const mime = baseMime(declaredType || "application/octet-stream");
  if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest("The file is empty");
  if (q.purpose !== "attachment" && q.kind !== "image") throw badRequest("Photos and thumbnails must be images");
  if (!ALLOWED_MIME[q.kind].includes(mime)) throw unsupported("This file type isn't supported");
  if (!contentMatches(mime, body)) throw unsupported("The file's contents don't match its type");
  if (q.purpose === "avatar" && body.length > MAX_AVATAR_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Photos must be under 2 MB");
  if (q.chatId) await requireMembership(q.chatId, ownerId);

  // Reserve quota atomically, so parallel uploads can't overshoot it.
  const quota = env.USER_STORAGE_QUOTA_MB * MB;
  const reserved = await User.findOneAndUpdate({ _id: ownerId, storageUsedBytes: { $lte: quota - body.length } }, { $inc: { storageUsedBytes: body.length } });
  if (!reserved) throw new AppError(413, "QUOTA_EXCEEDED", "You've reached your storage limit. Delete some attachments and try again.");

  const name = cleanName(q.name);
  try {
    const id = await storage.put(body, name, {
      ownerId,
      purpose: q.purpose,
      kind: q.kind,
      contentType: mime,
      chatId: q.chatId ? oid(q.chatId) : null,
      messageId: null,
      inUse: false,
    });
    return { id: String(id), kind: q.kind, mime, size: body.length, name };
  } catch (err) {
    await User.updateOne({ _id: ownerId }, { $inc: { storageUsedBytes: -body.length } });
    logger.error({ err }, "File upload failed");
    throw err;
  }
}

/** Removes files and refunds their owners' quota. Missing files are ignored. */
export async function deleteFiles(ids: (Types.ObjectId | null | undefined)[]) {
  for (const id of ids) {
    if (!id) continue;
    const f = await storage.stat(id);
    if (!f) continue;
    await storage.remove(id);
    await User.updateOne({ _id: f.metadata.ownerId }, { $inc: { storageUsedBytes: -f.length } });
  }
}

/** Uploader can cancel an upload that was never sent. */
export async function cancelUpload(userId: Id, fileId: string) {
  if (!isObjectId(fileId)) throw fileNotFound();
  const f = await storage.stat(oid(fileId));
  if (!f || !sameId(f.metadata.ownerId, userId) || f.metadata.inUse) throw fileNotFound();
  await deleteFiles([f.id]);
}

/**
 * Every live message that still shows this file. Forwarding reuses the stored file rather
 * than copying it, so one file can appear in several messages across several chats.
 */
function messagesUsing(fileId: Types.ObjectId) {
  return Message.find({ $or: [{ "attachments.fileId": fileId }, { "attachments.thumbFileId": fileId }], deletedAt: null })
    .select("conversationId createdAt hiddenFor")
    .limit(50)
    .lean();
}

/**
 * Who may download a file:
 *  - profile / group photos: any signed-in user
 *  - not yet sent: only the uploader
 *  - attachments: anyone who can see at least one message carrying the file — a current
 *    member of that chat, where the message isn't deleted or hidden for them and, in
 *    groups, was sent after they joined
 * Everyone else gets 404, so file ids can't be probed.
 */
export async function authorizeDownload(userId: Id, fileId: string): Promise<StoredFile> {
  if (!isObjectId(fileId)) throw fileNotFound();
  const f = await storage.stat(oid(fileId));
  if (!f) throw fileNotFound();
  const m = f.metadata;
  if (m.purpose === "avatar") {
    if (!m.inUse && !sameId(m.ownerId, userId)) throw fileNotFound();
    return f;
  }
  if (!m.messageId) {
    if (sameId(m.ownerId, userId)) return f;
    throw fileNotFound();
  }

  const uses = await messagesUsing(f.id);
  if (!uses.length) throw fileNotFound();
  const convIds = [...new Set(uses.map((u) => String(u.conversationId)))];
  const [members, convs] = await Promise.all([
    Member.find({ conversationId: { $in: convIds }, userId, leftAt: null }).select("conversationId joinedAt").lean(),
    Conversation.find({ _id: { $in: convIds } }).select("type").lean(),
  ]);
  const memberOf = new Map(members.map((x) => [String(x.conversationId), x]));
  const typeOf = new Map(convs.map((c) => [String(c._id), c.type]));

  const allowed = uses.some((u) => {
    if (u.hiddenFor.some((id) => sameId(id, userId))) return false;
    const member = memberOf.get(String(u.conversationId));
    if (!member) return false;
    return !(typeOf.get(String(u.conversationId)) === "group" && u.createdAt < member.joinedAt);
  });
  if (!allowed) throw fileNotFound();
  return f;
}

/**
 * Deletes a message's files, keeping any that a forward of it still shows. Called instead
 * of `deleteFiles` when a message goes away, so deleting the original never breaks a copy.
 */
export async function deleteFilesUnusedBy(messageId: Types.ObjectId, ids: (Types.ObjectId | null | undefined)[]) {
  const orphans = [];
  for (const id of ids) {
    if (!id) continue;
    const stillUsed = await Message.exists({
      _id: { $ne: messageId },
      deletedAt: null,
      $or: [{ "attachments.fileId": id }, { "attachments.thumbFileId": id }],
    });
    if (!stillUsed) orphans.push(id);
  }
  await deleteFiles(orphans);
}

/**
 * Claims the sender's uploads for a new message, exactly once each (a file can't be
 * attached twice, or by someone else, or to another chat). On failure, nothing stays claimed.
 */
export async function claimAttachments(senderId: Types.ObjectId, conversationId: Types.ObjectId, inputs: AttachmentInput[]) {
  const claimed: StoredFile[] = [];
  const release = () => storage.update(claimed.map((f) => f.id), { inUse: false });
  const claim = async (id: string, purpose: "attachment" | "thumb") => {
    const f = await storage.claim(oid(id), { ownerId: senderId, purpose, chatId: conversationId, inUse: false }, { inUse: true });
    if (!f) {
      await release();
      throw badRequest("One of the attachments is no longer available. Please attach it again.");
    }
    claimed.push(f);
    return f;
  };

  const subdocs = [];
  for (const input of inputs) {
    const f = await claim(input.fileId, "attachment");
    const thumb = input.thumbFileId ? await claim(input.thumbFileId, "thumb") : null;
    subdocs.push({
      // Type, size and name come from the stored file, never from the client.
      fileId: f.id,
      kind: f.metadata.kind,
      mime: f.metadata.contentType,
      size: f.length,
      name: f.filename,
      width: input.width,
      height: input.height,
      durationMs: input.durationMs,
      waveform: input.waveform,
      placeholder: input.placeholder,
      thumbFileId: thumb?.id ?? null,
    });
  }
  return { subdocs, fileIds: claimed.map((f) => f.id), release };
}

type AttachmentDoc = {
  fileId: Types.ObjectId;
  kind: string;
  mime?: string | null;
  size?: number | null;
  name?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  waveform?: number[] | null;
  placeholder?: string | null;
  thumbFileId?: Types.ObjectId | null;
};

export function toAttachment(a: AttachmentDoc): Attachment {
  return {
    id: String(a.fileId),
    kind: a.kind as Attachment["kind"],
    mime: a.mime ?? "application/octet-stream",
    size: a.size ?? 0,
    name: a.name ?? "file",
    url: `/api/files/${a.fileId}`,
    ...(a.width ? { width: a.width } : {}),
    ...(a.height ? { height: a.height } : {}),
    ...(a.durationMs != null ? { durationMs: a.durationMs } : {}),
    ...(a.waveform?.length ? { waveform: a.waveform } : {}),
    ...(a.placeholder ? { placeholder: a.placeholder } : {}),
    thumbUrl: a.thumbFileId ? `/api/files/${a.thumbFileId}` : null,
  };
}

/** Claims an uploaded photo for a profile or group and frees the previous one. */
export async function claimAvatar(ownerId: Types.ObjectId, fileId: string) {
  const f = await storage.claim(oid(fileId), { ownerId, purpose: "avatar", inUse: false }, { inUse: true });
  if (!f) throw badRequest("That photo is no longer available. Please upload it again.");
  return f.id;
}

/** Hourly: delete uploads that were never sent (or photos never applied) after 24h. */
export function startFileJanitor() {
  const run = async () => {
    try {
      const stale = await storage.findUnused(new Date(Date.now() - 24 * 3_600_000), 200);
      if (!stale.length) return;
      await deleteFiles(stale.map((f) => f.id));
      logger.info({ count: stale.length }, "Removed unused uploads");
    } catch (err) {
      logger.error({ err }, "File cleanup failed");
    }
  };
  const timer = setInterval(run, 3_600_000);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}

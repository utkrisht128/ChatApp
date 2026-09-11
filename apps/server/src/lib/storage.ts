import type { Readable } from "node:stream";
import mongoose, { Types } from "mongoose";
import type { FileKind, UploadPurpose } from "@chat/shared";

export type FileMeta = {
  ownerId: Types.ObjectId;
  purpose: UploadPurpose;
  kind: FileKind;
  contentType: string;
  chatId: Types.ObjectId | null;
  messageId: Types.ObjectId | null;
  /** Attached to a message or set as an avatar. Unused uploads are cleaned up after 24h. */
  inUse: boolean;
};

export type StoredFile = { id: Types.ObjectId; length: number; filename: string; uploadDate: Date; metadata: FileMeta };

/**
 * Where file bytes live. GridFS today (MongoDB Atlas, no extra service); an S3/R2 driver
 * can implement the same interface later without touching callers.
 */
export interface StorageDriver {
  put(data: Buffer, filename: string, metadata: FileMeta): Promise<Types.ObjectId>;
  stat(id: Types.ObjectId): Promise<StoredFile | null>;
  /** `end` is inclusive, matching HTTP Range semantics. */
  open(id: Types.ObjectId, range?: { start: number; end: number }): Readable;
  remove(id: Types.ObjectId): Promise<void>;
  /** Atomically flips metadata for a file that matches `where` — used to claim uploads exactly once. */
  claim(id: Types.ObjectId, where: Partial<Record<keyof FileMeta, unknown>>, set: Partial<FileMeta>): Promise<StoredFile | null>;
  update(ids: Types.ObjectId[], set: Partial<FileMeta>): Promise<void>;
  findUnused(olderThan: Date, limit: number): Promise<StoredFile[]>;
  ensureIndexes(): Promise<void>;
}

const prefixed = (obj: Record<string, unknown>) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [`metadata.${k}`, v]));

type FileDoc = { _id: Types.ObjectId; length: number; filename: string; uploadDate: Date; metadata: FileMeta };
const toStored = (d: FileDoc | null): StoredFile | null =>
  d ? { id: d._id, length: d.length, filename: d.filename, uploadDate: d.uploadDate, metadata: d.metadata } : null;

class GridFsStorage implements StorageDriver {
  private get db() {
    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");
    return db;
  }
  private get bucket() {
    return new mongoose.mongo.GridFSBucket(this.db, { bucketName: "files" });
  }
  private get files() {
    return this.db.collection<FileDoc>("files.files");
  }

  put(data: Buffer, filename: string, metadata: FileMeta) {
    return new Promise<Types.ObjectId>((resolve, reject) => {
      const upload = this.bucket.openUploadStream(filename, { metadata });
      upload.once("finish", () => resolve(upload.id as Types.ObjectId));
      upload.once("error", reject);
      upload.end(data);
    });
  }

  async stat(id: Types.ObjectId) {
    return toStored(await this.files.findOne({ _id: id }));
  }

  open(id: Types.ObjectId, range?: { start: number; end: number }) {
    // GridFS `end` is exclusive.
    return this.bucket.openDownloadStream(id, range ? { start: range.start, end: range.end + 1 } : undefined);
  }

  async remove(id: Types.ObjectId) {
    try {
      await this.bucket.delete(id);
    } catch (err) {
      if (!/FileNotFound|File not found/i.test(String((err as Error).message))) throw err;
    }
  }

  async claim(id: Types.ObjectId, where: Partial<Record<keyof FileMeta, unknown>>, set: Partial<FileMeta>) {
    const doc = await this.files.findOneAndUpdate({ _id: id, ...prefixed(where) }, { $set: prefixed(set) }, { returnDocument: "after" });
    return toStored(doc);
  }

  async update(ids: Types.ObjectId[], set: Partial<FileMeta>) {
    if (ids.length) await this.files.updateMany({ _id: { $in: ids } }, { $set: prefixed(set) });
  }

  async findUnused(olderThan: Date, limit: number) {
    const docs = await this.files.find({ "metadata.inUse": false, uploadDate: { $lt: olderThan } }).limit(limit).toArray();
    return docs.map((d) => toStored(d)!);
  }

  async ensureIndexes() {
    await this.files.createIndex({ "metadata.inUse": 1, uploadDate: 1 });
  }
}

export const storage: StorageDriver = new GridFsStorage();

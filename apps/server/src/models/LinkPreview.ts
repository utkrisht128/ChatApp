import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

/**
 * Cached preview for one URL, so a link shared in a busy chat is fetched once rather than
 * once per reader. `failed` is cached too — a dead link shouldn't be retried on every view.
 */
const linkPreviewSchema = new Schema({
  /** SHA-256 of the normalised URL; the URL itself can exceed the index key limit. */
  key: { type: String, required: true, unique: true },
  url: { type: String, required: true, maxlength: 2048 },
  host: { type: String, default: "", maxlength: 255 },
  title: { type: String, default: "", maxlength: 300 },
  description: { type: String, default: "", maxlength: 500 },
  siteName: { type: String, default: "", maxlength: 100 },
  failed: { type: Boolean, default: false },
  fetchedAt: { type: Date, default: () => new Date() },
});

// Previews expire after a week, so pages that change aren't cached forever.
linkPreviewSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

export type LinkPreviewFields = InferSchemaType<typeof linkPreviewSchema>;
export type LinkPreviewDoc = HydratedDocument<LinkPreviewFields>;
export const LinkPreviewCache = model("LinkPreview", linkPreviewSchema);

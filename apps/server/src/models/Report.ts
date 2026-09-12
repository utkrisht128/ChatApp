import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { REPORT_REASONS, REPORT_STATUSES } from "@chat/shared";

/**
 * A report raised by a user about another user or a message. The reported content is
 * snapshotted, so a report stays reviewable after the original is edited or deleted.
 */
const reportSchema = new Schema(
  {
    reporterId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    subject: { type: String, enum: ["user", "message"], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    /** The reported user (for a message report, its sender) — the handle moderation acts on. */
    targetUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    conversationId: { type: Schema.Types.ObjectId, default: null },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    note: { type: String, default: "", maxlength: 500 },
    snapshot: { type: String, default: "", maxlength: 1000 },
    status: { type: String, enum: REPORT_STATUSES, default: "open" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The moderation queue: open reports first, newest first.
reportSchema.index({ status: 1, _id: -1 });
// One person can't pile up duplicate reports for the same thing.
reportSchema.index({ reporterId: 1, subject: 1, targetId: 1 }, { unique: true });
reportSchema.index({ targetUserId: 1 });

export type ReportFields = InferSchemaType<typeof reportSchema> & { createdAt: Date };
export type ReportDoc = HydratedDocument<ReportFields>;
export const Report = model("Report", reportSchema);

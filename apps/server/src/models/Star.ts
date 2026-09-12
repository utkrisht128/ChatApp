import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

/**
 * A message one user starred. Kept in its own collection rather than an array on the
 * message so it can't grow unbounded and stays private to the person who starred it.
 */
const starSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    messageId: { type: Schema.Types.ObjectId, required: true },
    conversationId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

starSchema.index({ userId: 1, messageId: 1 }, { unique: true });
// The starred list, newest first.
starSchema.index({ userId: 1, _id: -1 });

export type StarFields = InferSchemaType<typeof starSchema> & { createdAt: Date };
export type StarDoc = HydratedDocument<StarFields>;
export const Star = model("Star", starSchema);

import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

/** One person blocking another. Directional: blocking is not mutual. */
const blockSchema = new Schema(
  {
    blockerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    blockedId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
// "Does either of these two block the other?" — answered by one query.
blockSchema.index({ blockedId: 1, blockerId: 1 });

export type BlockFields = InferSchemaType<typeof blockSchema> & { createdAt: Date };
export type BlockDoc = HydratedDocument<BlockFields>;
export const Block = model("Block", blockSchema);

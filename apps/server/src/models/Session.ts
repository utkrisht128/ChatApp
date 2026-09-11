import { Schema, model, type InferSchemaType } from "mongoose";

/** A login session. Only a SHA-256 hash of the cookie token is stored. */
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    userAgent: { type: String, default: "", maxlength: 300 },
    // TTL index: MongoDB deletes the document once expiresAt passes.
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

export type SessionFields = InferSchemaType<typeof sessionSchema>;
export const Session = model("Session", sessionSchema);

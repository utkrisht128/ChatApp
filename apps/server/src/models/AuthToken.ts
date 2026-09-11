import { Schema, model, type InferSchemaType } from "mongoose";

export const AUTH_TOKEN_TYPES = ["verify", "reset", "socket"] as const;
export type AuthTokenType = (typeof AUTH_TOKEN_TYPES)[number];

/** Single-use, expiring tokens (email verification, password reset, socket handshake tickets). */
const authTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: AUTH_TOKEN_TYPES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

export type AuthTokenFields = InferSchemaType<typeof authTokenSchema>;
export const AuthToken = model("AuthToken", authTokenSchema);

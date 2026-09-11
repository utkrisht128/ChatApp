import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { DEFAULT_SETTINGS, VISIBILITY } from "@chat/shared";

const d = DEFAULT_SETTINGS;

const settingsSchema = new Schema(
  {
    theme: { type: String, enum: ["system", "light", "dark"], default: d.theme },
    readReceipts: { type: Boolean, default: d.readReceipts },
    lastSeenVisibility: { type: String, enum: VISIBILITY, default: d.lastSeenVisibility },
    onlineVisibility: { type: String, enum: VISIBILITY, default: d.onlineVisibility },
    enterToSend: { type: Boolean, default: d.enterToSend },
    sounds: { type: Boolean, default: d.sounds },
    notifications: {
      messages: { type: Boolean, default: d.notifications.messages },
      groups: { type: Boolean, default: d.notifications.groups },
      mentions: { type: Boolean, default: d.notifications.mentions },
      showPreview: { type: Boolean, default: d.notifications.showPreview },
    },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 24 },
    displayName: { type: String, required: true, trim: true, maxlength: 48 },
    passwordHash: { type: String, required: true, select: false },
    bio: { type: String, default: "", maxlength: 160 },
    avatarFileId: { type: Schema.Types.ObjectId, default: null },
    emailVerifiedAt: { type: Date, default: null },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    bannedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
    storageUsedBytes: { type: Number, default: 0 },
    settings: { type: settingsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export type UserFields = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserFields>;
export const User = model("User", userSchema);

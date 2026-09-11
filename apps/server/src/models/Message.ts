import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { FILE_KINDS, MAX_MESSAGE_LENGTH, MESSAGE_TYPES, SYSTEM_EVENTS } from "@chat/shared";

const replySchema = new Schema(
  {
    messageId: { type: Schema.Types.ObjectId, required: true },
    senderId: { type: Schema.Types.ObjectId, required: true },
    /** Snapshot, so a quote renders without loading the original. Kept in sync on edit/delete. */
    preview: { type: String, default: "", maxlength: 200 },
  },
  { _id: false },
);

/** Flat list (one entry per person) so a reaction can be replaced in one atomic update. */
const reactionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    emoji: { type: String, required: true, maxlength: 16 },
  },
  { _id: false },
);

/** A file on a message. Type/size/name are copied from the stored file at send time. */
const attachmentSchema = new Schema(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: FILE_KINDS, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    name: { type: String, default: "file", maxlength: 200 },
    width: Number,
    height: Number,
    durationMs: Number,
    waveform: { type: [Number], default: undefined },
    placeholder: { type: String, maxlength: 4000 },
    thumbFileId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

/** Structured group event, rendered per viewer ("You added Bob"). */
const systemSchema = new Schema(
  {
    event: { type: String, enum: SYSTEM_EVENTS, required: true },
    actorId: { type: Schema.Types.ObjectId, required: true },
    targetIds: { type: [Schema.Types.ObjectId], default: [] },
    value: { type: String, maxlength: 200 },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    clientId: { type: String, required: true, maxlength: 64 },
    type: { type: String, enum: MESSAGE_TYPES, default: "text" },
    body: { type: String, default: "", maxlength: MAX_MESSAGE_LENGTH },
    mentions: { type: [Schema.Types.ObjectId], default: [] },
    replyTo: { type: replySchema, default: null },
    forwarded: { type: Boolean, default: false },
    system: { type: systemSchema, default: null },
    attachments: { type: [attachmentSchema], default: [] },
    reactions: { type: [reactionSchema], default: [] },
    /** Users who chose "delete for me". */
    hiddenFor: { type: [Schema.Types.ObjectId], default: [] },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// History pagination: newest-first within a conversation.
messageSchema.index({ conversationId: 1, _id: -1 });
// Idempotent sends: a retried request with the same clientId maps to the same message.
messageSchema.index({ senderId: 1, clientId: 1 }, { unique: true });

export type MessageFields = InferSchemaType<typeof messageSchema> & { createdAt: Date };
export type MessageDoc = HydratedDocument<MessageFields>;
export const Message = model("Message", messageSchema);

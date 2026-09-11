import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

const PERMISSION = { type: String, enum: ["all", "admins"] } as const;

/** Snapshot of the newest message, denormalized so the chat list never touches `messages`. */
const lastMessageSchema = new Schema(
  {
    messageId: { type: Schema.Types.ObjectId, required: true },
    senderId: { type: Schema.Types.ObjectId, required: true },
    preview: { type: String, default: "", maxlength: 200 },
    type: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { _id: false },
);

const conversationSchema = new Schema(
  {
    type: { type: String, enum: ["direct", "group"], required: true },
    name: { type: String, trim: true, maxlength: 64, default: "" },
    description: { type: String, trim: true, maxlength: 512, default: "" },
    avatarFileId: { type: Schema.Types.ObjectId, default: null },
    permissions: {
      send: { ...PERMISSION, default: "all" },
      addMembers: { ...PERMISSION, default: "admins" },
      editInfo: { ...PERMISSION, default: "admins" },
    },
    /** "<smallerUserId>:<largerUserId>" — guarantees one direct chat per pair of users. */
    directKey: { type: String, default: undefined },
    memberCount: { type: Number, default: 0 },
    lastMessage: { type: lastMessageSchema, default: null },
    lastMessageAt: { type: Date, default: () => new Date() },
    pinnedMessageIds: { type: [Schema.Types.ObjectId], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

conversationSchema.index({ directKey: 1 }, { unique: true, partialFilterExpression: { directKey: { $type: "string" } } });

export type ConversationFields = InferSchemaType<typeof conversationSchema>;
export type ConversationDoc = HydratedDocument<ConversationFields>;
export const Conversation = model("Conversation", conversationSchema);

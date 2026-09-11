import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

/** A user's membership in a conversation, plus their personal view of it (unread, pinned, muted…). */
const memberSchema = new Schema({
  conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  role: { type: String, enum: ["owner", "admin", "member"], default: "member" },

  /** Receipt pointers: every message with _id ≤ pointer has been delivered to / read by this member. */
  lastDeliveredMessageId: { type: Schema.Types.ObjectId, default: null },
  lastReadMessageId: { type: Schema.Types.ObjectId, default: null },
  unreadCount: { type: Number, default: 0, min: 0 },
  mentionCount: { type: Number, default: 0, min: 0 },

  /** Copy of the conversation's lastMessageAt, so the chat list can be sorted and paginated on this collection alone. */
  lastMessageAt: { type: Date, default: () => new Date() },
  /** A direct chat stays out of the recipient's list until the first message arrives. */
  hidden: { type: Boolean, default: false },
  pinnedAt: { type: Date, default: null },
  archivedAt: { type: Date, default: null },
  mutedUntil: { type: Date, default: null },
  leftAt: { type: Date, default: null },
  joinedAt: { type: Date, default: () => new Date() },
});

memberSchema.index({ conversationId: 1, userId: 1 }, { unique: true });
// Chat list: one user's visible memberships, newest activity first.
memberSchema.index({ userId: 1, hidden: 1, leftAt: 1, archivedAt: 1, pinnedAt: 1, lastMessageAt: -1, _id: -1 });

export type MemberFields = InferSchemaType<typeof memberSchema>;
export type MemberDoc = HydratedDocument<MemberFields>;
export const Member = model("Member", memberSchema);

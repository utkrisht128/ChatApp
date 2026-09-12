import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

/** One browser's push subscription. A user can have several (phone, laptop, …). */
const pushSubscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** Unique across users: re-subscribing on a shared device reassigns the endpoint. */
    endpoint: { type: String, required: true, unique: true, maxlength: 1000 },
    p256dh: { type: String, required: true, maxlength: 200 },
    auth: { type: String, required: true, maxlength: 100 },
    userAgent: { type: String, default: "", maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

pushSubscriptionSchema.index({ userId: 1 });

export type PushSubscriptionFields = InferSchemaType<typeof pushSubscriptionSchema> & { createdAt: Date };
export type PushSubscriptionDoc = HydratedDocument<PushSubscriptionFields>;
export const PushSubscription = model("PushSubscription", pushSubscriptionSchema);

import { z } from "zod";

/** A browser push subscription, as produced by PushManager.subscribe(). */
export const pushSubscriptionSchema = z.strictObject({
  endpoint: z.string().trim().min(1).max(1000),
  keys: z.strictObject({
    p256dh: z.string().trim().min(1).max(200),
    auth: z.string().trim().min(1).max(100),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushUnsubscribeSchema = z.strictObject({ endpoint: z.string().trim().min(1).max(1000) });

/** What the service worker receives. Kept small: push payloads have a size limit. */
export type PushPayload = {
  title: string;
  body: string;
  chatId: string;
  messageId: string;
  /** Groups notifications for the same chat, so a busy chat replaces rather than stacks. */
  tag: string;
};

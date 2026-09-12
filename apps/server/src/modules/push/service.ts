import webpush from "web-push";
import { summarizeMessage, type FileKind, type PushPayload, type PushSubscriptionInput } from "@chat/shared";
import { env } from "../../config/env";
import type { Id } from "../../lib/ids";
import { logger } from "../../lib/logger";
import { Conversation } from "../../models/Conversation";
import { Member } from "../../models/Member";
import { Message } from "../../models/Message";
import { PushSubscription } from "../../models/PushSubscription";
import { User } from "../../models/User";
import { isOnline } from "../../realtime/presence";

/** Push only works once VAPID keys are configured; without them the feature is simply off. */
export const pushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
}

export const publicKey = () => (pushEnabled ? env.VAPID_PUBLIC_KEY! : null);

export async function subscribe(userId: Id, input: PushSubscriptionInput, userAgent: string) {
  await PushSubscription.updateOne(
    { endpoint: input.endpoint },
    { $set: { userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent.slice(0, 300) } },
    { upsert: true },
  );
}

export async function unsubscribe(userId: Id, endpoint: string) {
  await PushSubscription.deleteOne({ userId, endpoint });
}

/**
 * Sends a payload to every device of these users, dropping subscriptions the push service
 * says are gone (404/410) so dead endpoints don't accumulate.
 */
async function pushTo(userIds: Id[], payload: PushPayload) {
  if (!pushEnabled || !userIds.length) return;
  const subs = await PushSubscription.find({ userId: { $in: userIds } }).lean();
  if (!subs.length) return;
  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, { TTL: 12 * 3600 });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await PushSubscription.deleteOne({ _id: sub._id });
          return;
        }
        // Never log the payload: it can contain message text.
        logger.warn({ status }, "Push delivery failed");
      }
    }),
  );
}

/**
 * Notifies the people who should hear about a new message: members who aren't the sender,
 * aren't currently connected, and haven't muted the chat — except that a mention still gets
 * through a mute, matching what the notification settings promise.
 */
export async function notifyNewMessage(messageId: Id) {
  if (!pushEnabled) return;

  const message = await Message.findById(messageId).lean();
  if (!message || message.type === "system") return;
  const conv = await Conversation.findById(message.conversationId).select("type name").lean();
  if (!conv) return;

  const members = await Member.find({ conversationId: message.conversationId, leftAt: null, userId: { $ne: message.senderId } })
    .select("userId mutedUntil")
    .lean();
  if (!members.length) return;

  const mentioned = new Set((message.mentions ?? []).map(String));
  const now = new Date();
  // Someone with the app open is told over the socket; a push as well would be duplicate noise.
  const offline = members.filter((m) => !isOnline(String(m.userId)));
  if (!offline.length) return;

  const users = await User.find({ _id: { $in: offline.map((m) => m.userId) } })
    .select("displayName settings.notifications")
    .lean();
  const settingsOf = new Map(users.map((u) => [String(u._id), u.settings?.notifications]));

  const sender = await User.findById(message.senderId).select("displayName").lean();
  const senderName = sender?.displayName ?? "Someone";
  const isGroup = conv.type === "group";

  const wanted = offline.filter((m) => {
    const id = String(m.userId);
    const n = settingsOf.get(id);
    if (!n) return false;
    const isMentioned = mentioned.has(id);
    if (isMentioned && n.mentions === false) return false;
    if (!isMentioned) {
      if (m.mutedUntil && m.mutedUntil > now) return false;
      if (isGroup ? n.groups === false : n.messages === false) return false;
    }
    return true;
  });
  if (!wanted.length) return;

  const preview = summarizeMessage({
    body: message.body ?? "",
    attachments: (message.attachments ?? []).map((a) => ({ kind: a.kind as FileKind, name: a.name ?? "file", durationMs: a.durationMs ?? undefined })),
  });

  // "Show preview" is per-user, so people who turned it off need their own payload.
  const groups = new Map<boolean, Id[]>();
  for (const m of wanted) {
    const show = settingsOf.get(String(m.userId))?.showPreview !== false;
    groups.set(show, [...(groups.get(show) ?? []), m.userId]);
  }

  const chatId = String(message.conversationId);
  for (const [showPreview, ids] of groups) {
    await pushTo(ids, {
      title: isGroup ? conv.name : senderName,
      body: showPreview ? (isGroup ? `${senderName}: ${preview}` : preview) : "New message",
      chatId,
      messageId: String(message._id),
      tag: `chat-${chatId}`,
    });
  }
}

/** Fire-and-forget wrapper: a push failure must never fail the send that triggered it. */
export function notifyNewMessageInBackground(messageId: Id) {
  if (!pushEnabled) return;
  void notifyNewMessage(messageId).catch((err) => logger.error({ err }, "Push notification failed"));
}

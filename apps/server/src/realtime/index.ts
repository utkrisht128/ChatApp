import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { deliveredEventSchema, typingEventSchema } from "@chat/shared";
import { env } from "../config/env";
import { sameId } from "../lib/ids";
import { logger } from "../lib/logger";
import { Conversation } from "../models/Conversation";
import { Member } from "../models/Member";
import { User } from "../models/User";
import { redeemSocketTicket } from "../modules/auth/service";
import { activeMemberIds, markAllDelivered, markDelivered } from "../modules/messages/service";
import { emitToUsers, setIo, userRoom, type IO } from "./bus";
import { addConnection, removeConnection } from "./presence";

/** Simple per-socket token bucket: `burst` events, refilling `perSecond`. */
function tokenBucket(burst: number, perSecond: number) {
  let tokens = burst;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * perSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

/**
 * Who may see a user's presence: everyone who shares a chat with them, narrowed by the
 * user's privacy settings ("contacts" = people they share a direct chat with).
 */
async function broadcastPresence(userId: string, online: boolean) {
  const user = await User.findById(userId).select("lastSeenAt settings.onlineVisibility settings.lastSeenVisibility").lean();
  if (!user) return;
  const convIds = await Member.distinct("conversationId", { userId, leftAt: null });
  if (!convIds.length) return;
  const [everyone, directConvs] = await Promise.all([
    Member.distinct("userId", { conversationId: { $in: convIds }, userId: { $ne: userId }, leftAt: null }),
    Conversation.find({ _id: { $in: convIds }, type: "direct" }).select("directKey").lean(),
  ]);
  const contacts = new Set(directConvs.flatMap((c) => c.directKey?.split(":") ?? []).filter((id) => id !== userId));
  const audience = (setting: string | null | undefined) =>
    new Set(setting === "nobody" ? [] : setting === "contacts" ? [...contacts] : everyone.map(String));

  const seeOnline = audience(user.settings?.onlineVisibility);
  const seeLastSeen = audience(user.settings?.lastSeenVisibility);
  const lastSeenAt = user.lastSeenAt?.toISOString() ?? null;

  // Group recipients by what they're allowed to see, then emit once per group.
  const groups = new Map<string, string[]>();
  for (const id of everyone.map(String)) {
    const key = `${seeOnline.has(id) ? 1 : 0}${!online && seeLastSeen.has(id) ? 1 : 0}`;
    if (key !== "00") groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  for (const [key, ids] of groups) {
    emitToUsers(ids, "presence", {
      userId,
      ...(key[0] === "1" ? { online } : {}),
      ...(key[1] === "1" ? { lastSeenAt } : {}),
    });
  }
}

const logFailure = (what: string) => (err: unknown) => logger.error({ err }, `Realtime: ${what} failed`);

export function createRealtime(httpServer: HttpServer): IO {
  const io: IO = new Server(httpServer, {
    cors: { origin: env.CLIENT_URL, credentials: false },
    serveClient: false,
    maxHttpBufferSize: 16_000, // clients only send tiny events; big payloads go over REST
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  // Handshake auth: a single-use, 60-second ticket issued by POST /api/auth/socket-ticket.
  io.use(async (socket, next) => {
    try {
      const ticket: unknown = socket.handshake.auth?.ticket;
      const user = typeof ticket === "string" && ticket.length <= 100 ? await redeemSocketTicket(ticket) : null;
      if (!user) {
        logger.warn("Socket connection rejected: invalid ticket");
        return next(new Error("UNAUTHENTICATED"));
      }
      socket.data.userId = user.id;
      next();
    } catch (err) {
      logger.error({ err }, "Socket auth error");
      next(new Error("INTERNAL_ERROR"));
    }
  });

  io.on("connection", (socket) => {
    const userId: string = socket.data.userId;
    const allow = tokenBucket(30, 10);
    void socket.join(userRoom(userId));

    if (addConnection(userId)) void broadcastPresence(userId, true).catch(logFailure("presence"));
    void markAllDelivered(userId).catch(logFailure("mark delivered"));

    socket.on("typing", async (raw) => {
      if (!allow()) return;
      const parsed = typingEventSchema.safeParse(raw);
      if (!parsed.success) return;
      try {
        // Membership is re-checked on every event — the recipient list *is* the membership check.
        const members = await activeMemberIds(parsed.data.chatId);
        if (!members.some((id) => sameId(id, userId))) return;
        emitToUsers(members.filter((id) => id !== userId), "typing", { chatId: parsed.data.chatId, userId, isTyping: parsed.data.isTyping });
      } catch (err) {
        logFailure("typing")(err);
      }
    });

    socket.on("message:delivered", async (raw) => {
      if (!allow()) return;
      const parsed = deliveredEventSchema.safeParse(raw);
      if (!parsed.success) return;
      await markDelivered(userId, parsed.data.chatId, parsed.data.messageId).catch(logFailure("delivered"));
    });

    socket.on("disconnect", async () => {
      if (!removeConnection(userId)) return;
      try {
        await User.updateOne({ _id: userId }, { $set: { lastSeenAt: new Date() } });
        await broadcastPresence(userId, false);
      } catch (err) {
        logFailure("offline presence")(err);
      }
    });
  });

  setIo(io);
  return io;
}

import { Router } from "express";
import { deleteMessageQuerySchema, editMessageSchema, listMessagesQuerySchema, markReadSchema, reactionSchema, sendMessageSchema } from "@chat/shared";
import { noContent, ok } from "../../lib/http";
import { authOf } from "../../middleware/auth";
import { limiter } from "../../middleware/security";
import * as messages from "./service";

const perUser = { keyGenerator: (req: { auth?: { user: { id: string } } }) => req.auth?.user.id ?? "anon" };
// Generous for humans, tight enough to stop a script flooding a chat.
const sendLimiter = limiter({ windowMs: 60_000, limit: 90, ...perUser });
const writeLimiter = limiter({ windowMs: 60_000, limit: 120, ...perUser });

/** Mounted at /api/chats/:chatId */
export const chatMessagesRouter = Router({ mergeParams: true });

chatMessagesRouter.get("/messages", async (req, res) => {
  const query = listMessagesQuerySchema.parse(req.query);
  ok(res, await messages.listMessages(authOf(req).user._id, (req.params as { chatId: string }).chatId, query));
});

chatMessagesRouter.post("/messages", sendLimiter, async (req, res) => {
  const input = sendMessageSchema.parse(req.body);
  const { message, created } = await messages.sendMessage(authOf(req).user._id, (req.params as { chatId: string }).chatId, input);
  ok(res, { message }, created ? 201 : 200);
});

chatMessagesRouter.post("/read", writeLimiter, async (req, res) => {
  const { messageId } = markReadSchema.parse(req.body);
  ok(res, await messages.markRead(authOf(req).user._id, (req.params as { chatId: string }).chatId, messageId));
});

/** Mounted at /api/messages */
export const messagesRouter = Router();

messagesRouter.patch("/:messageId", writeLimiter, async (req, res) => {
  const { body } = editMessageSchema.parse(req.body);
  ok(res, { message: await messages.editMessage(authOf(req).user._id, req.params.messageId as string, body) });
});

messagesRouter.delete("/:messageId", writeLimiter, async (req, res) => {
  const { scope } = deleteMessageQuerySchema.parse(req.query);
  await messages.deleteMessage(authOf(req).user._id, req.params.messageId as string, scope);
  noContent(res);
});

messagesRouter.put("/:messageId/reaction", writeLimiter, async (req, res) => {
  const { emoji } = reactionSchema.parse(req.body);
  ok(res, { message: await messages.setReaction(authOf(req).user._id, req.params.messageId as string, emoji) });
});

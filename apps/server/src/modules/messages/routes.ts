import { Router } from "express";
import {
  deleteMessageQuerySchema,
  editMessageSchema,
  forwardMessageSchema,
  listMessagesQuerySchema,
  markReadSchema,
  reactionSchema,
  sendMessageSchema,
  setPinnedSchema,
  setStarredSchema,
} from "@chat/shared";
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

chatMessagesRouter.get("/pinned", async (req, res) => {
  ok(res, { messages: await messages.listPinned(authOf(req).user._id, (req.params as { chatId: string }).chatId) });
});

/** Mounted at /api/messages */
export const messagesRouter = Router();

// Before the /:messageId routes, so "starred" isn't read as a message id.
messagesRouter.get("/starred", async (req, res) => {
  ok(res, { messages: await messages.listStarred(authOf(req).user._id) });
});

messagesRouter.post("/:messageId/forward", sendLimiter, async (req, res) => {
  const input = forwardMessageSchema.parse(req.body);
  const sent = await messages.forwardMessage(authOf(req).user._id, req.params.messageId as string, input);
  ok(res, { messages: sent }, 201);
});

messagesRouter.put("/:messageId/pinned", writeLimiter, async (req, res) => {
  const { pinned } = setPinnedSchema.parse(req.body);
  ok(res, { messages: await messages.setPinned(authOf(req).user._id, req.params.messageId as string, pinned) });
});

messagesRouter.put("/:messageId/starred", writeLimiter, async (req, res) => {
  const { starred } = setStarredSchema.parse(req.body);
  await messages.setStarred(authOf(req).user._id, req.params.messageId as string, starred);
  noContent(res);
});

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

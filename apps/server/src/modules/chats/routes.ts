import { Router } from "express";
import { createDirectChatSchema, listChatsQuerySchema, updateMembershipSchema } from "@chat/shared";
import { ok } from "../../lib/http";
import { authOf } from "../../middleware/auth";
import * as chats from "./service";

export const chatsRouter = Router();

chatsRouter.get("/", async (req, res) => {
  const query = listChatsQuerySchema.parse(req.query);
  ok(res, await chats.listChats(authOf(req).user._id, query));
});

chatsRouter.post("/direct", async (req, res) => {
  const { userId } = createDirectChatSchema.parse(req.body);
  ok(res, { chat: await chats.openDirectChat(authOf(req).user._id, userId) });
});

chatsRouter.get("/:chatId", async (req, res) => {
  ok(res, { chat: await chats.getChat(authOf(req).user._id, req.params.chatId) });
});

chatsRouter.patch("/:chatId/membership", async (req, res) => {
  const patch = updateMembershipSchema.parse(req.body);
  ok(res, { chat: await chats.updateMembership(authOf(req).user._id, req.params.chatId, patch) });
});

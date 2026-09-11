import { Router } from "express";
import { addMembersSchema, createGroupSchema, setRoleSchema, updateGroupSchema } from "@chat/shared";
import { noContent, ok } from "../../lib/http";
import { authOf } from "../../middleware/auth";
import { limiter } from "../../middleware/security";
import * as groups from "./service";

const createLimiter = limiter({ windowMs: 60 * 60_000, limit: 20, keyGenerator: (req) => req.auth?.user.id ?? "anon" });
const chatId = (req: { params: Record<string, unknown> }) => req.params.chatId as string;
const targetId = (req: { params: Record<string, unknown> }) => req.params.userId as string;

export const groupsRouter = Router();

groupsRouter.post("/", createLimiter, async (req, res) => {
  const input = createGroupSchema.parse(req.body);
  ok(res, { chat: await groups.createGroup(authOf(req).user._id, input) }, 201);
});

groupsRouter.get("/:chatId", async (req, res) => {
  ok(res, { group: await groups.getGroupInfo(authOf(req).user._id, chatId(req)) });
});

groupsRouter.patch("/:chatId", async (req, res) => {
  const patch = updateGroupSchema.parse(req.body);
  ok(res, { group: await groups.updateGroup(authOf(req).user._id, chatId(req), patch) });
});

groupsRouter.post("/:chatId/members", async (req, res) => {
  const { userIds } = addMembersSchema.parse(req.body);
  ok(res, { group: await groups.addMembers(authOf(req).user._id, chatId(req), userIds) });
});

groupsRouter.delete("/:chatId/members/:userId", async (req, res) => {
  const group = await groups.removeMember(authOf(req).user._id, chatId(req), targetId(req));
  if (!group) return noContent(res);
  ok(res, { group });
});

groupsRouter.patch("/:chatId/members/:userId", async (req, res) => {
  const { role } = setRoleSchema.parse(req.body);
  ok(res, { group: await groups.setRole(authOf(req).user._id, chatId(req), targetId(req), role) });
});

groupsRouter.post("/:chatId/leave", async (req, res) => {
  await groups.leaveGroup(authOf(req).user._id, chatId(req));
  noContent(res);
});

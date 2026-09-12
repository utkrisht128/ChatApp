import { Router } from "express";
import { setAvatarSchema, setBlockedSchema, updateProfileSchema, updateSettingsSchema, userSearchQuerySchema } from "@chat/shared";
import { ok } from "../../lib/http";
import { toMe } from "../../lib/serialize";
import { authOf } from "../../middleware/auth";
import { limiter } from "../../middleware/security";
import { listBlocked, setBlocked } from "../moderation/service";
import * as users from "./service";

const searchLimiter = limiter({ windowMs: 60_000, limit: 60, keyGenerator: (req) => req.auth?.user.id ?? "anon" });

export const usersRouter = Router();

usersRouter.get("/search", searchLimiter, async (req, res) => {
  const { q } = userSearchQuerySchema.parse(req.query);
  ok(res, { items: await users.searchUsers(authOf(req).user._id, q) });
});

// Before "/:username", so "blocked" isn't read as someone's username.
usersRouter.get("/blocked", async (req, res) => {
  ok(res, { users: await listBlocked(authOf(req).user._id) });
});

usersRouter.put("/:userId/blocked", async (req, res) => {
  const { blocked } = setBlockedSchema.parse(req.body);
  ok(res, { users: await setBlocked(authOf(req).user._id, req.params.userId as string, blocked) });
});

usersRouter.patch("/me", async (req, res) => {
  const input = updateProfileSchema.parse(req.body);
  ok(res, { user: toMe(await users.updateProfile(authOf(req).user, input)) });
});

usersRouter.patch("/me/settings", async (req, res) => {
  const patch = updateSettingsSchema.parse(req.body);
  ok(res, { user: toMe(await users.updateSettings(authOf(req).user, patch)) });
});

/** Set (upload first via POST /api/files?purpose=avatar) or remove (null) your profile photo. */
usersRouter.put("/me/avatar", async (req, res) => {
  const { fileId } = setAvatarSchema.parse(req.body);
  ok(res, { user: toMe(await users.setAvatar(authOf(req).user, fileId)) });
});

usersRouter.get("/:username", async (req, res) => {
  ok(res, { user: await users.getProfile(authOf(req).user._id, req.params.username) });
});

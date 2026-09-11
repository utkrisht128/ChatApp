import { Router } from "express";
import { updateProfileSchema, updateSettingsSchema, userSearchQuerySchema } from "@chat/shared";
import { ok } from "../../lib/http";
import { toMe } from "../../lib/serialize";
import { authOf } from "../../middleware/auth";
import { limiter } from "../../middleware/security";
import * as users from "./service";

const searchLimiter = limiter({ windowMs: 60_000, limit: 60, keyGenerator: (req) => req.auth?.user.id ?? "anon" });

export const usersRouter = Router();

usersRouter.get("/search", searchLimiter, async (req, res) => {
  const { q } = userSearchQuerySchema.parse(req.query);
  ok(res, { items: await users.searchUsers(authOf(req).user._id, q) });
});

usersRouter.patch("/me", async (req, res) => {
  const input = updateProfileSchema.parse(req.body);
  ok(res, { user: toMe(await users.updateProfile(authOf(req).user, input)) });
});

usersRouter.patch("/me/settings", async (req, res) => {
  const patch = updateSettingsSchema.parse(req.body);
  ok(res, { user: toMe(await users.updateSettings(authOf(req).user, patch)) });
});

usersRouter.get("/:username", async (req, res) => {
  ok(res, { user: await users.getProfile(authOf(req).user._id, req.params.username) });
});

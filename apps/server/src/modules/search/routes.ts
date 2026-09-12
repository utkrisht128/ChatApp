import { Router } from "express";
import { searchQuerySchema } from "@chat/shared";
import { ok } from "../../lib/http";
import { authOf } from "../../middleware/auth";
import { limiter } from "../../middleware/security";
import { searchChats } from "../chats/service";
import { searchUsers } from "../users/service";
import * as search from "./service";

// Searching is read-only but does real work per request, so it gets its own ceiling.
const searchLimiter = limiter({ windowMs: 60_000, limit: 90, keyGenerator: (req) => req.auth?.user.id ?? "anon" });

export const searchRouter = Router();

searchRouter.get("/", searchLimiter, async (req, res) => {
  const query = searchQuerySchema.parse(req.query);
  const me = authOf(req).user._id;
  switch (query.type) {
    case "messages":
      return ok(res, await search.searchMessages(me, query));
    case "files":
      return ok(res, await search.searchFiles(me, query));
    case "chats":
      return ok(res, { items: await searchChats(me, query.q), nextCursor: null });
    case "users":
      return ok(res, { items: await searchUsers(me, query.q), nextCursor: null });
  }
});

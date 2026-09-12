import { Router } from "express";
import { linkPreviewQuerySchema } from "@chat/shared";
import { ok } from "../../lib/http";
import { limiter } from "../../middleware/security";
import { getLinkPreview } from "./service";

// This is the one endpoint that makes the server fetch a URL the user chose, so it is
// limited tightly per user on top of the SSRF guards in safeFetch.
const previewLimiter = limiter({ windowMs: 60_000, limit: 30, keyGenerator: (req) => req.auth?.user.id ?? "anon" });

export const linksRouter = Router();

linksRouter.get("/preview", previewLimiter, async (req, res) => {
  const { url } = linkPreviewQuerySchema.parse(req.query);
  ok(res, { preview: await getLinkPreview(url) });
});

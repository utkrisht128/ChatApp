import { pipeline } from "node:stream/promises";
import express, { Router, type Request, type Response } from "express";
import { uploadQuerySchema } from "@chat/shared";
import { env } from "../../config/env";
import { noContent, ok } from "../../lib/http";
import { logger } from "../../lib/logger";
import { storage } from "../../lib/storage";
import { authOf } from "../../middleware/auth";
import { limiter } from "../../middleware/security";
import * as files from "./service";

const uploadLimiter = limiter({ windowMs: 60 * 60_000, limit: 200, keyGenerator: (req) => req.auth?.user.id ?? "anon" });

type Range = { start: number; end: number } | "invalid" | null;

/** Single-range `bytes=` parser (all browsers use single ranges for media seeking). */
function parseRange(header: string | undefined, size: number): Range {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return "invalid";
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? "invalid" : { start, end };
}

const INLINE = /^(image|video|audio)\//;
const dispositionName = (name: string) => `filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export const filesRouter = Router();

// Raw body upload (XHR from the browser, for progress events). Metadata travels in the query string.
filesRouter.post("/", uploadLimiter, express.raw({ type: () => true, limit: `${env.MAX_UPLOAD_MB}mb` }), async (req: Request, res: Response) => {
  const q = uploadQuerySchema.parse(req.query);
  const file = await files.uploadFile(authOf(req).user._id, q, req.body as Buffer, req.get("content-type") ?? "");
  ok(res, { file }, 201);
});

filesRouter.get("/:fileId", async (req, res) => {
  const f = await files.authorizeDownload(authOf(req).user._id, req.params.fileId);
  const etag = `"${f.id}"`;
  const type = f.metadata.contentType;

  res.setHeader("ETag", etag);
  // File ids are immutable, so the browser may cache forever — but only privately.
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  // Even if something slipped past validation, a file can never run script in our origin.
  res.setHeader("Content-Security-Policy", "default-src 'none'; media-src 'self'; img-src 'self'; sandbox");
  res.setHeader("Content-Type", type);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Disposition", `${INLINE.test(type) && req.query.download === undefined ? "inline" : "attachment"}; ${dispositionName(f.filename)}`);
  if (req.get("if-none-match") === etag) return void res.status(304).end();

  const range = parseRange(req.get("range"), f.length);
  if (range === "invalid") {
    res.setHeader("Content-Range", `bytes */${f.length}`);
    return void res.status(416).end();
  }
  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${f.length}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
  } else {
    res.setHeader("Content-Length", String(f.length));
  }
  if (req.method === "HEAD") return void res.end();

  try {
    await pipeline(storage.open(f.id, range ?? undefined), res);
  } catch (err) {
    // Client aborts (seeking, navigating away) are normal; anything else is worth a log line.
    if ((err as NodeJS.ErrnoException).code !== "ERR_STREAM_PREMATURE_CLOSE") logger.warn({ err }, "File download failed");
    res.destroy();
  }
});

filesRouter.delete("/:fileId", async (req, res) => {
  await files.cancelUpload(authOf(req).user._id, req.params.fileId);
  noContent(res);
});

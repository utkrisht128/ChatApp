import { createHash } from "node:crypto";
import type { LinkPreview } from "@chat/shared";
import { fetchHtml } from "../../lib/safeFetch";
import { LinkPreviewCache } from "../../models/LinkPreview";

const keyOf = (url: string) => createHash("sha256").update(url).digest("hex");
/** Only the head matters, and it bounds the work the regexes do. */
const HEAD_LIMIT = 100_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

function decodeEntities(text: string) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    const key = code.toLowerCase();
    if (ENTITIES[key]) return ENTITIES[key];
    if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16) || 0) || whole;
    if (key.startsWith("#")) return String.fromCodePoint(Number(key.slice(1)) || 0) || whole;
    return whole;
  });
}

const clean = (text: string, max: number) => decodeEntities(text).replace(/\s+/g, " ").trim().slice(0, max);

/** Reads a `<meta>` value by property/name, trying each candidate in order. */
function meta(html: string, names: string[]): string {
  for (const name of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`, "i");
    const tag = re.exec(html)?.[0];
    const content = tag ? /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] : undefined;
    if (content?.trim()) return content;
  }
  return "";
}

function parse(html: string, finalUrl: string): LinkPreview {
  const head = html.slice(0, HEAD_LIMIT);
  const title = meta(head, ["og:title", "twitter:title"]) || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] || "";
  return {
    url: finalUrl,
    host: new URL(finalUrl).hostname.replace(/^www\./, ""),
    title: clean(title, 300),
    description: clean(meta(head, ["og:description", "twitter:description", "description"]), 500),
    siteName: clean(meta(head, ["og:site_name"]), 100),
  };
}

/**
 * Preview for a link, cached (including failures, so a dead link isn't refetched per reader).
 * Returns null when the URL is unsafe, unreachable, or has nothing worth showing.
 */
export async function getLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  const key = keyOf(rawUrl);
  const cached = await LinkPreviewCache.findOne({ key }).lean();
  if (cached) {
    return cached.failed ? null : { url: cached.url, host: cached.host, title: cached.title, description: cached.description, siteName: cached.siteName };
  }

  const fetched = await fetchHtml(rawUrl);
  const preview = fetched ? parse(fetched.html, fetched.url) : null;
  // A page with no title tells the reader nothing, so treat it as a failure.
  const failed = !preview?.title;

  await LinkPreviewCache.updateOne(
    { key },
    { $set: { key, url: preview?.url ?? rawUrl.slice(0, 2048), host: preview?.host ?? "", title: preview?.title ?? "", description: preview?.description ?? "", siteName: preview?.siteName ?? "", failed, fetchedAt: new Date() } },
    { upsert: true },
  ).catch(() => {});

  return failed ? null : preview;
}

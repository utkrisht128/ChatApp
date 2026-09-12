// Netlify can't read environment variables inside netlify.toml, so the /api proxy rule and
// the Content-Security-Policy (which has to name the API origin) are generated at build time.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const clean = (value) => (value ?? "").replace(/\/+$/, "");
const apiOrigin = clean(process.env.API_ORIGIN);
const socketOrigin = clean(process.env.VITE_SOCKET_URL);

const lines = [];
if (apiOrigin) {
  if (!/^https:\/\//.test(apiOrigin)) {
    console.error(`API_ORIGIN must be an https:// URL, got "${apiOrigin}"`);
    process.exit(1);
  }
  lines.push(`/api/*  ${apiOrigin}/api/:splat  200!`);
} else if (process.env.NETLIFY) {
  console.error("API_ORIGIN is not set — the /api proxy cannot be configured.");
  process.exit(1);
}

// SPA fallback: every other path serves the app shell.
lines.push("/*  /index.html  200");
writeFileSync(new URL("../dist/_redirects", import.meta.url), lines.join("\n") + "\n");

/* ── Content-Security-Policy ────────────────────────────────────────────── */

const indexUrl = new URL("../dist/index.html", import.meta.url);
const html = readFileSync(indexUrl, "utf8");

// index.html carries one inline script (the pre-paint theme switch). Allow exactly that
// script by hash rather than opening the policy up with 'unsafe-inline'.
const inlineHashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
  (m) => `'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`,
);

// The WebSocket connects straight to the API host, so its wss:// origin must be allowed too.
const wsOrigin = socketOrigin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
const connect = ["'self'", socketOrigin, wsOrigin].filter(Boolean);

const csp = [
  "default-src 'self'",
  `script-src 'self' ${inlineHashes.join(" ")}`.trim(),
  // React sets style attributes (transforms, theme previews, the resizable list width).
  "style-src 'self' 'unsafe-inline'",
  // data: for blur placeholders, blob: for local previews of files being sent.
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  `connect-src ${connect.join(" ")}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

writeFileSync(new URL("../dist/_headers", import.meta.url), `/*\n  Content-Security-Policy: ${csp}\n`);

console.log(`Wrote dist/_redirects (${apiOrigin ? `API → ${apiOrigin}` : "no API proxy"})`);
console.log(`Wrote dist/_headers (CSP, ${inlineHashes.length} inline script hash(es), connect-src: ${connect.join(" ")})`);

// Netlify can't read environment variables inside netlify.toml redirects, so the
// /api proxy rule is generated at build time from API_ORIGIN.
import { writeFileSync } from "node:fs";

const origin = (process.env.API_ORIGIN ?? "").replace(/\/+$/, "");
const lines = [];

if (origin) {
  if (!/^https:\/\//.test(origin)) {
    console.error(`API_ORIGIN must be an https:// URL, got "${origin}"`);
    process.exit(1);
  }
  lines.push(`/api/*  ${origin}/api/:splat  200!`);
} else if (process.env.NETLIFY) {
  console.error("API_ORIGIN is not set — the /api proxy cannot be configured.");
  process.exit(1);
}

// SPA fallback: every other path serves the app shell.
lines.push("/*  /index.html  200");

writeFileSync(new URL("../dist/_redirects", import.meta.url), lines.join("\n") + "\n");
console.log(`Wrote dist/_redirects (${origin ? `API → ${origin}` : "no API proxy"})`);

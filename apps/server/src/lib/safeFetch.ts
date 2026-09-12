import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { logger } from "./logger";

/**
 * Outbound HTTP for link previews — the only place the server fetches a URL a user chose,
 * and therefore the one place that has to be hardened against SSRF.
 *
 * The defence is applied at *connect* time via a custom DNS lookup rather than by resolving
 * the hostname first and fetching afterwards. Resolve-then-fetch leaves a DNS-rebinding
 * window: the name can resolve to a public address for the check and to 127.0.0.1 for the
 * real connection. Validating inside the socket's own lookup closes that window, and it is
 * re-applied to every redirect hop.
 */

const MAX_REDIRECTS = 3;
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;

/** Anything not routable on the public internet: loopback, private, link-local, CGNAT, multicast… */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const p = ip.split(".").map(Number) as [number, number, number, number];
    if (p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false; // link-local, incl. cloud metadata at 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  if (version === 6) {
    const ip6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (ip6 === "::" || ip6 === "::1") return false;
    if (ip6.startsWith("fe80") || ip6.startsWith("fc") || ip6.startsWith("fd")) return false; // link-local, unique-local
    if (ip6.startsWith("ff")) return false; // multicast
    // IPv4-mapped (::ffff:127.0.0.1) must be judged by the embedded v4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip6);
    if (mapped) return isPublicAddress(mapped[1]!);
    return true;
  }
  return false;
}

/** DNS lookup that refuses to hand the socket a non-public address. */
const guardedLookup: typeof dnsLookup = ((hostname: string, options: unknown, callback: unknown) => {
  const done = (typeof options === "function" ? options : callback) as (
    err: NodeJS.ErrnoException | null,
    address?: string | LookupAddress[],
    family?: number,
  ) => void;
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return done(err);
    const safe = addresses.filter((a) => isPublicAddress(a.address));
    if (!safe.length) return done(Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }));
    const opts = (typeof options === "object" && options) || {};
    if ((opts as { all?: boolean }).all) return done(null, safe);
    return done(null, safe[0]!.address, safe[0]!.family);
  });
}) as typeof dnsLookup;

function parseTarget(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // https only: no http (downgrade / plaintext), and certainly no file:, gopher: or data:.
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  // A literal private IP in the URL never reaches the DNS guard, so check it here too.
  if (isIP(url.hostname) && !isPublicAddress(url.hostname)) return null;
  return url;
}

type Fetched = { url: string; html: string };

function fetchOnce(url: URL): Promise<{ status: number; location?: string; html?: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        lookup: guardedLookup,
        timeout: TIMEOUT_MS,
        headers: {
          // Identify honestly, and ask only for HTML.
          "User-Agent": "ChatAppLinkPreview/1.0 (+link preview bot)",
          Accept: "text/html;q=0.9,*/*;q=0.1",
          "Accept-Language": "en",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.destroy();
          return resolve({ status, location: res.headers.location });
        }
        const type = String(res.headers["content-type"] ?? "");
        if (!type.includes("text/html") && !type.includes("application/xhtml")) {
          res.destroy();
          return resolve({ status });
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, html: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timed out")));
    req.on("error", reject);
    req.end();
  });
}

/** Fetches HTML from a user-supplied URL, or null if it isn't safe or isn't HTML. */
export async function fetchHtml(raw: string): Promise<Fetched | null> {
  let url = parseTarget(raw);
  if (!url) return null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res;
    try {
      res = await fetchOnce(url);
    } catch (err) {
      // Includes the guard's own refusal; nothing here is worth alarming about.
      logger.debug({ err, host: url.hostname }, "Link preview fetch failed");
      return null;
    }
    if (res.html !== undefined) return { url: url.toString(), html: res.html };
    if (!res.location) return null;

    // Every hop is re-validated: a public URL is allowed to redirect to a private one.
    const next = parseTarget(new URL(res.location, url).toString());
    if (!next) return null;
    url = next;
  }
  return null;
}

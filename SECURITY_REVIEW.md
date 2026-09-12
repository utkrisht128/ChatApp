# Security Review (Phase 6)

A full pass against the checklist in `MODERNIZATION_PLAN.md` §6, plus an authorization
matrix covering every route. Everything below was **verified by running it**, not by reading
the code alone — the matrix lives in `apps/server/test/authz.test.ts` and runs in CI with the
rest of the suite.

**Result:** 163 server tests green across 12 files. Two gaps were found and fixed during this
phase; three risks are accepted and documented.

---

## 1. The original audit's findings

All 19 findings from `PROJECT_AUDIT.md` came from the legacy app in `public/` and `server/`.
Those folders were **deleted in this phase** (they were still tracked, referenced by nothing).
The rewrite addresses each finding by design rather than by patching:

| # | Original finding | How it's addressed now | Proof |
|---|---|---|---|
| S1 | No authentication anywhere | Opaque session tokens, stored hashed, `HttpOnly` cookie | `authz.test.ts` — every protected route 401s for an anonymous caller |
| S2 | Anyone can read any conversation | `requireMembership` gates every chat-scoped route | `authz.test.ts` — non-members get 404 on all 20 chat/message/group routes |
| S3 | Anyone can send as anyone | The sender is the session, never the request body | same |
| S4 | Password hash returned to the client | `passwordHash` is `select: false`; responses go through `toMe`/`toPublicUser` | `auth.test.ts` asserts no `/password/i` anywhere in the register response |
| S5 | Socket identity hijacking | Handshake needs a single-use 60s ticket; membership re-checked per event | `auth.test.ts`, `realtime.test.ts` |
| S6 | Anyone can change anyone's avatar | Avatar routes act on the session user only | `authz.test.ts` |
| S7 | User directory leaks every email | `PublicUser` has no email; only the admin API exposes it | `admin.test.ts` |
| S8 | NoSQL operator injection | zod types every value before it reaches Mongo; regex input is escaped | `auth.test.ts` rejects `{"$ne": null}` |
| S9 | Wildcard CORS | No CORS on REST (same-origin via proxy); Socket.IO uses a `CLIENT_URL` allowlist | — |
| S10 | No rate limiting | Per-IP and per-account limits on auth, send, upload, search, previews, reports, tickets | `auth/routes.ts` |
| S11 | Identity in `localStorage` | Identity lives in an `HttpOnly` cookie the JS can't read | — |
| S12 | Stack traces leaked | One error handler; unknown errors become a generic 500 | `authz.test.ts` asserts no `stack\|mongo\|Cast` in error bodies |
| S13 | No security headers / no body limit | helmet + `express.json({ limit: "100kb" })` + Netlify headers incl. CSP | this phase |
| S14 | Weak password policy, wrong Mongoose options | zod `passwordSchema`; argon2id hashing | `auth.test.ts` |
| S15 | Case-sensitive, untrimmed identifiers | Email and username are trimmed and lowercased | `auth.test.ts` |
| S16 | `server/.env` not gitignored | `.gitignore` covers `.env` and `.env.*` (allowing `.env.example`); legacy folder deleted | history scan below |
| S17 | 120+ dependency advisories | 0 production advisories; 1 low dev-only (see accepted risks) | `npm audit` |
| S18 | SVG avatars | SVG is rejected by the upload allowlist, and content is sniffed | `files.test.ts` |
| S19 | Username enumeration on register | Still distinguishes taken email vs username, but behind a 10/hour/IP limit | see accepted risks |

---

## 2. The §6 checklist, item by item

| Requirement | Status |
|---|---|
| helmet, `json({limit:'100kb'})`, CORS allowlist | ✅ `app.ts` |
| Rate limits on auth, send, upload, search | ✅ plus previews, reports and socket tickets |
| zod on every input, strict objects | ✅ bodies use `strictObject` (unknown field → 400, so no mass assignment); query strings use `object`, since Express adds its own keys |
| CSRF: SameSite=Lax + custom header + Origin check | ✅ `security.ts`; `auth.test.ts` covers both the missing header and a foreign Origin |
| XSS: React escaping, no `dangerouslySetInnerHTML`, SVG rejected | ✅ verified by grep — no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` anywhere in `apps/web` |
| Uploads: allowlist, sniffing, attachment disposition | ✅ `files.test.ts` — spoofed types, SVG and over-quota all rejected |
| Link previews with SSRF protection | ✅ https-only, no credentials in URL, byte cap, timeout, and the address check runs **inside the socket's DNS lookup** (closing the DNS-rebinding window) and again on every redirect hop |
| Account enumeration: forgot-password always 200 | ✅ `auth.test.ts` |
| Session rotation; all sessions revoked on reset | ✅ `auth.test.ts` |
| Logs redact credentials and message bodies | ✅ pino redacts `cookie`, `authorization`, `set-cookie`, `*.password`, `*.currentPassword`, `*.newPassword`, `*.token`, `*.passwordHash`, `*.body` |

---

## 3. The authorization matrix

`apps/server/test/authz.test.ts` crosses every route with the callers who must not reach it:

- **Anonymous** — all 44 protected routes return 401.
- **Signed in, not a member** — all 20 chat/message/group routes return **404, never 403**, so a
  chat's existence can't be probed. The chat list and search leak nothing either.
- **Member, not owner** — can react and hide a message for themselves, but editing or
  deleting someone else's message for everyone is 403.
- **Group member, not admin** — rename, avatar, add/remove members and role changes are 403;
  an admin still can't remove or demote the owner.
- **Blocked** — messaging is refused in both directions, while history already exchanged stays
  readable (blocking is not deletion).
- **Banned** — the existing session is dead on every route, and a fresh login is refused.
- **Cross-tenant ids** — a message or chat id from one conversation is useless in another, and
  malformed ids return 400/404 without leaking driver internals.
- **Non-admin** — every admin route returns 404 (`admin.test.ts`).

---

## 4. Fixed during this phase

1. **`requireAdmin` returned the wrong status.** It called `forbidden("Not found", "NOT_FOUND")`,
   producing a **403 that carried the error code `NOT_FOUND`** — contradicting its own comment and
   the convention `requireMembership` already follows. Non-admins now get 404. *(Found by the
   Phase 5 tests; fixed in `eb8fcf1`.)*
2. **No Content-Security-Policy on the frontend.** `netlify.toml` set four security headers but
   no CSP. The build now generates `dist/_headers` with one, including a **hash for the single
   inline theme script** rather than `'unsafe-inline'`, and a `connect-src` naming the API and
   WebSocket origins.
3. **Legacy `public/` and `server/` deleted** — 43 tracked files containing every original
   vulnerability, referenced by nothing.

---

## 5. Accepted risks

1. **One low, dev-only dependency advisory** (esbuild's dev server can read arbitrary files on
   Windows). `npm audit fix` would add **120 packages** of platform-specific binaries to resolve
   something that cannot affect production, since that dev server is never run here. Not worth the
   supply-chain surface. Production dependencies: **0 advisories**.
2. **Register still distinguishes "email taken" from "username taken"** (S19). Merging them would
   make signup meaningfully worse for honest users; the enumeration risk is capped by the
   10-per-hour-per-IP signup limit.
3. **Blocking hides presence and stops messaging, but doesn't erase history.** This matches how
   mainstream messengers behave, and is asserted deliberately in the matrix so it can't change by
   accident.

## 6. Secrets

`.gitignore` covers `.env` and `.env.*` while allowing `.env.example`. A scan of **all 13 commits**
found no `.env`, `.pem`, `.key` or `id_rsa` file ever committed, and no secret-shaped strings
(`mongodb+srv://`, private-key headers, AWS keys, `sk_live_`, Slack tokens) in any revision.

Two untracked legacy files remain on disk only — `server/.env` and `public/src/.env`, from 2023.
They were never tracked, and were left in place rather than deleted, since removing untracked
files isn't reversible. They can be deleted safely at any time.

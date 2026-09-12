# Modernization Plan — ChatApp

Companion to [PROJECT_AUDIT.md](PROJECT_AUDIT.md). Priority order: **UX > Reliability > Security > Performance > Maintainability > Feature count.**

Each architectural decision below follows the same structure: *what exists → what's wrong → proposal → why → risk*.

> ## ✅ Confirmed decisions (2026-09-11) — these override anything below
> 1. **Database: stay on MongoDB** (MongoDB Atlas **M0 free**, 512 MB). Mongoose 8/9 with a redesigned, conversation-based schema (§3a). Integrity is enforced in the service layer, backed by unique and compound indexes.
> 2. **No custom domain → Setup B.** Netlify proxies `/api/*` to Render, so the session cookie is first-party. Socket.IO connects directly to `*.onrender.com` using a short-lived, single-use ticket.
> 3. **No existing data** → no migration script. The legacy `public/` and `server/` folders are removed once parity is reached.
> 4. **Free tiers only:** Render free web service (sleeps after ~15 min idle, so the frontend shows a "Waking up server…" state and the socket reconnects on its own), Netlify free, Atlas M0.
> 5. **No Cloudflare R2 for now.** Files are stored in **MongoDB GridFS** behind a `StorageDriver` interface, so S3/R2 can be added later by implementing one file. Because of the 512 MB cap: images are compressed client-side (max 1600px, WebP/JPEG), files are capped at **8 MB**, voice notes use Opus/WebM, and there are per-user quotas.
> 6. **Email:** SMTP via nodemailer (any free SMTP provider, e.g. Brevo, or a Gmail app password). If SMTP isn't configured in development, verification and reset links are printed to the server console. In production they are never logged.

---

## 1. Key Decisions

### D1. Database: PostgreSQL proposed — ❌ **declined; MongoDB kept**
- **Exists:** MongoDB with 2 loosely typed collections.
- **Wrong:** Chat data is inherently relational: users ↔ conversation members ↔ messages ↔ reactions/receipts. The requirements explicitly call for foreign keys, constraints and indexed pagination. Mongo can do this, but only with application-enforced integrity.
- **Proposal (declined):** PostgreSQL (Render Postgres) with Prisma, for real FKs, transactional sends and built-in full-text search.
- **Decision:** stay on **MongoDB Atlas M0** with Mongoose and the redesigned schema in §3a.
- **How the trade-off was covered:** integrity lives in the service layer, backed by unique and
  compound indexes — a unique `directKey` for one DM per pair, unique `(senderId, clientId)` for
  idempotent sends, unique `(conversationId, userId)` per membership, and one reaction per person
  enforced by a single atomic aggregation-pipeline update. Message search uses a MongoDB text
  index, so no search engine was added either.
- **Cost accepted:** no cross-document transactions, so a few multi-collection updates are ordered
  to be safe when replayed rather than atomic.

### D2. Frontend build: CRA → Vite + TypeScript
- CRA is deprecated and carries 70+ advisories. Vite is the standard replacement, deploys to Netlify trivially, and makes route-level code splitting simple.
- TypeScript, plus **zod schemas shared** between client and server, removes the whole class of "shape drift" bugs found in the audit (B13, the inconsistent response shapes).

### D3. Authentication: none → server sessions in httpOnly cookies
- **Proposal:** Opaque random session tokens, stored **hashed** in a `sessions` table and sent as an `HttpOnly; Secure; SameSite=Lax` cookie. Sliding expiry is 30 days, and sessions can be revoked (logout, "log out of other devices").
- **Why not JWT in localStorage:** it can be stolen by XSS and cannot be revoked. Opaque DB sessions are simpler and safer at this scale.
- Passwords: **argon2id** only (OWASP parameters). There was no existing data to carry over, so no
  bcrypt verification path was built and bcrypt is not a dependency.
- Email verification and password reset: single-use, hashed, expiring tokens delivered over **SMTP
  via nodemailer**. With no SMTP configured in development, links are printed to the console.
- Google OAuth: **deferred.** It adds operational surface without improving core UX. It can be added later without schema changes (`accounts` table).

### D4. Netlify ↔ Render topology (cookies + WebSockets)
Netlify and Render sit on different sites, and browsers increasingly block third-party cookies. Two supported setups:

| Setup | REST | WebSocket | Needs |
|---|---|---|---|
| **A** — custom domain | `api.yourdomain.com` (same-site → `SameSite=Lax` cookie works) | `api.yourdomain.com` | A domain you own |
| ✅ **B (in use)** — no custom domain | Netlify proxy: `/api/*` → Render (first-party cookie) | Direct to `*.onrender.com`, authenticated with a **short-lived, single-use socket ticket** fetched over the proxied REST call | Nothing extra |

Netlify rewrites cannot proxy WebSocket upgrades, which is why B uses tickets. **Setup B is what
runs**, chosen because there is no custom domain; the code supports both, selected by env vars, so
moving to A later is a configuration change rather than a code change.

### D5. Real-time: keep Socket.IO, redesign the protocol
- Socket.IO is already in use, handles reconnection and fallbacks, and works on Render, so there is no reason to switch.
- **Change:** authenticate on handshake (cookie or ticket). The server derives identity; the client never sends a `userId`. Each socket joins `user:{id}` plus one room per conversation. Multi-tab works naturally.
- **Sending moves to the REST API or an ack'd socket event, persisted first and broadcast second.** A client-generated `clientId` gives idempotency (safe retries) and optimistic-message reconciliation.
- Single Render instance for now, with presence kept in memory. Scaling out later = add `@socket.io/redis-adapter` (documented, not built now).

### D6. File storage: S3-compatible object storage
- Render's disk is ephemeral, so files can't live there, and they don't belong in the DB.
- **Proposal:** **Cloudflare R2** (S3 API, no egress fees) via `@aws-sdk/client-s3`.
  - Uploads: the server authorizes and issues a **presigned PUT** (content-type and size locked), and the client uploads directly with a progress bar.
  - Downloads: the server checks membership and issues a **short-lived presigned GET**. The bucket stays private.
- Images are resized and compressed **client-side** before upload (canvas), plus a small thumbnail/blurhash. Server-side `sharp` processing is deferred unless it proves necessary.

### D7. Styling & UI primitives
- Replace global CSS with **Tailwind CSS v4** driven by **CSS-variable design tokens** (light/dark/system). This removes the global collision class of bugs entirely.
- **Radix UI primitives** for Dialog, DropdownMenu, ContextMenu, Popover and Tooltip. Accessible focus management and keyboard handling are hard to get right by hand, and these are unstyled, so the design stays original.
- A custom bottom sheet on mobile (built on Radix Dialog).

### D8. State management
- **TanStack Query** for server state (cache, infinite pagination, optimistic updates, refetch on reconnect).
- **Zustand** for a small amount of client state (UI panels, composer drafts, connection status).
- Socket events write directly into the Query cache. There is no second copy of message data.

---

## 2. Target Architecture

```
┌──────────────────── Netlify ────────────────────┐
│  React 19 + Vite SPA (PWA shell, service worker)│
│  /api/* ──proxy (setup B)──┐                    │
└────────────────────────────┼────────────────────┘
                             ▼
┌──────────────────── Render (Web Service) ───────┐      ┌──────────────┐
│  Node 22 · Express 5 · Socket.IO 4              │─────▶│ Render       │
│  REST /api/*  ·  WS /socket.io                  │      │ PostgreSQL   │
│  helmet · CORS allowlist · rate limits · zod    │      └──────────────┘
│  pino logs · /health · graceful shutdown        │      ┌──────────────┐
│                                                  │─────▶│ Cloudflare R2│◀── browser PUT/GET (presigned)
└──────────────────────────────────────────────────┘      └──────────────┘
                                                           Resend (email) · Web Push (VAPID)
```

### Repository layout (npm workspaces; no extra monorepo tooling)

```
ChatApp-main/
├── apps/
│   ├── web/                    # Vite React app  → Netlify
│   │   └── src/
│   │       ├── app/            # providers, router, error boundary
│   │       ├── layouts/        # AppShell (responsive 1/2/3-pane), AuthLayout
│   │       ├── pages/          # route entries (lazy-loaded)
│   │       ├── features/
│   │       │   ├── auth/  chats/  messages/  composer/  groups/
│   │       │   ├── media/ voice/  search/    profile/   settings/
│   │       │   └── notifications/  safety/  admin/
│   │       ├── components/ui/  # Button, Avatar, Sheet, Skeleton, Toast…
│   │       ├── hooks/  lib/ (api client, socket, query client)
│   │       ├── stores/  styles/ (tokens.css)  types/
│   └── server/                 # Express API → Render
│       ├── prisma/             # schema.prisma, migrations, seed
│       ├── scripts/migrate-from-mongo.ts
│       └── src/
│           ├── config/         # env parsing (zod) — fail fast on boot
│           ├── modules/        # auth, users, chats, messages, groups,
│           │                   # files, search, notifications, safety, admin
│           │   └── <module>/{routes,service,schemas}.ts
│           ├── realtime/       # socket auth, rooms, presence, event handlers
│           ├── middleware/     # auth, rateLimit, validate, error
│           └── lib/            # db, logger, storage, mailer, push
├── packages/shared/            # zod schemas, event names, API types
├── netlify.toml  render.yaml  .env.example files
└── PROJECT_AUDIT.md  MODERNIZATION_PLAN.md  DEPLOYMENT.md
```

The old `public/` and `server/` folders stay untouched until the new app reaches feature parity, and are then removed in a single commit.

---

## 3a. Database Schema — MongoDB (CONFIRMED; supersedes §3)

```
users           _id · email (unique, lowercased) · username (unique, lowercased) · displayName
                passwordHash · bio · avatarFileId · emailVerifiedAt · role (user|admin) · bannedAt
                lastSeenAt · settings { theme, readReceipts, lastSeenVisibility, onlineVisibility,
                notifications{…}, enterToSend, sounds } · timestamps
sessions        _id · userId · tokenHash (unique) · userAgent · expiresAt (TTL index) · timestamps
authtokens      _id · userId · type (verify|reset|socket) · tokenHash (unique) · expiresAt (TTL) · usedAt
conversations   _id · type (direct|group) · name · description · avatarFileId
                permissions { send, addMembers, editInfo, removeMembers : 'all'|'admins' }
                directKey (unique, partial: only direct chats; "<minId>:<maxId>")
                lastMessage { _id, senderId, preview, type, createdAt }   ← denormalized for chat list
                lastMessageAt (sort key) · pinnedMessageIds[] (≤ 20) · createdBy · timestamps
members         _id · conversationId · userId · role (owner|admin|member)   UNIQUE (conversationId,userId)
                lastReadMessageId · lastDeliveredMessageId · unreadCount · mentionCount
                mutedUntil · pinnedAt · archivedAt · leftAt · joinedAt
                INDEX (userId, leftAt, archivedAt) · INDEX (conversationId)
messages        _id · conversationId · senderId · clientId · type (text|image|video|file|audio|voice|system)
                body · mentions[userId] · replyTo { _id, senderId, preview } · forwarded (bool)
                attachments[] { fileId, kind, mime, size, name, width, height, durationMs, waveform[], thumbFileId }
                reactions[] { emoji, userIds[] } · linkPreview { url, title, description, image }
                editedAt · deletedAt · system { event, actorId, targetIds[] } · createdAt
                INDEX (conversationId, _id:-1) · UNIQUE (senderId, clientId) · TEXT (body)
stars           UNIQUE (userId, messageId) · conversationId · createdAt
blocks          UNIQUE (blockerId, blockedId)
reports         reporterId · targetUserId? · targetMessageId? · reason · details · status · resolvedBy
notifications   userId · type · data · readAt · createdAt (TTL 90 days)
pushsubs        userId · endpoint (unique) · keys
files (GridFS)  fs.files metadata { ownerId, conversationId?, kind, purpose (avatar|attachment|thumb) }
```

Notes:
- **Unread counts are a counter on `members`.** On each send, `$inc` runs on every other member; the counter resets to 0 when that member reads. The chat list is **2 queries** (members for the user, then conversations `$in`), with no N+1 and no counting over messages.
- **Receipts are per-member pointers** (`lastDeliveredMessageId`, `lastReadMessageId`). A message's status for its sender is derived by comparing its `_id` with the other members' pointers.
- **Pagination:** keyset on `_id` (`{conversationId, _id: {$lt: cursor}}` sorted `_id:-1`, limit 50), served by the compound index.
- **Idempotent sends:** a unique `(senderId, clientId)` index means a retry returns the existing message instead of creating a duplicate.
- **Search:** the Mongo `$text` index on `messages.body` is scoped to the conversations the user belongs to. User search is a prefix regex on the lowercased username or display name, with regex special characters escaped.
- **No multi-document transactions are required.** Writes are ordered so a partial failure leaves consistent data: message first, then counters and `lastMessage`.

## 3. Database Schema (Prisma / Postgres) — superseded by §3a, kept for reference

```
users            id (uuid) · email (citext, unique) · username (citext, unique) · password_hash
                 display_name · bio · avatar_key · email_verified_at · role (user|admin)
                 banned_at · last_seen_at · created_at · updated_at
user_settings    user_id PK/FK · theme · read_receipts · last_seen_visibility · online_visibility
                 notification prefs · enter_to_send · language
sessions         id · user_id FK · token_hash (unique) · user_agent · ip · expires_at · created_at
auth_tokens      id · user_id FK · type (verify|reset) · token_hash · expires_at · used_at
conversations    id · type (direct|group) · name · description · avatar_key
                 settings jsonb (who_can_send / add / edit_info / remove)
                 direct_key (unique; sorted pair — prevents duplicate DMs) · last_message_at · created_by
conversation_members  (conversation_id, user_id) PK · role (owner|admin|member)
                 joined_at · left_at · last_read_message_id · last_delivered_message_id
                 muted_until · pinned_at · archived_at
messages         id (bigint identity, monotonic → cursor pagination) · conversation_id FK
                 sender_id FK · client_id (unique per sender → idempotency) · type (text|media|voice|system)
                 body · reply_to_id FK self · forwarded_from_id · edited_at · deleted_at
                 created_at · search_vector (tsvector, GIN)
                 INDEX (conversation_id, id DESC)
attachments      id · message_id FK · storage_key · kind · mime · size · width · height
                 duration_ms · thumbnail_key · original_name · waveform
reactions        (message_id, user_id, emoji) PK
pinned_messages  (conversation_id, message_id) PK · pinned_by · pinned_at
starred_messages (user_id, message_id) PK
link_previews    url_hash PK · url · title · description · image_url · fetched_at
blocks           (blocker_id, blocked_id) PK
reports          id · reporter_id · target_user_id? · target_message_id? · reason · status · resolved_by
notifications    id · user_id · type · payload jsonb · read_at · created_at
push_subscriptions id · user_id · endpoint (unique) · keys jsonb
```

Design notes:
- **Read receipts and delivery are stored as a per-member pointer** (`last_read_message_id`, `last_delivered_message_id`), not a row per message per user. That is O(members) instead of O(messages × members). A message's status for its sender is derived from these pointers: Sent → Delivered (all recipients' delivered ≥ id) → Read.
- **Unread count** = `count(messages where id > last_read_message_id)`, backed by the `(conversation_id, id)` index. The chat list is fetched in **one query** (lateral join for the last message), with no N+1.
- **Pagination:** keyset (`WHERE id < :cursor ORDER BY id DESC LIMIT 50`), never offset.
- **Soft delete** for messages (`deleted_at`, body cleared) so replies still render "Message deleted".

---

## 4. API Design

A consistent envelope, `{ "success": true, "data": … }` / `{ "success": false, "error": { "code", "message", "fields?" } }`, correct HTTP status codes, a zod-validated body/query/params on every route, and a central error handler that never leaks internals.

```
/api/auth      POST register · login · logout · logout-all · verify-email · resend-verification
               POST forgot-password · reset-password · GET me · POST socket-ticket
/api/users     GET search?q= · GET :username · PATCH me · PATCH me/settings · POST me/avatar
/api/chats     GET (list, cursor) · POST direct {userId} · GET :id
               PATCH :id/membership {muted, pinned, archived} · POST :id/read {messageId}
/api/chats/:id/messages   GET ?before=&limit= · GET ?around= (jump to search hit) · POST (send)
/api/messages  PATCH :id (edit) · DELETE :id · POST :id/reactions · DELETE :id/reactions/:emoji
               POST :id/forward {chatIds} · POST|DELETE :id/pin · POST|DELETE :id/star · GET starred
/api/groups    POST · PATCH :id · POST :id/members · DELETE :id/members/:userId
               PATCH :id/members/:userId {role} · POST :id/leave
/api/files     POST upload-url · GET :id/url
/api/search    GET ?q=&chatId=&type=messages|people|chats|files
/api/notifications  GET · POST read · POST push-subscription · DELETE push-subscription
/api/safety    POST blocks · DELETE blocks/:userId · GET blocks · POST reports
/api/admin     GET stats · GET users · POST users/:id/ban|unban · GET reports · PATCH reports/:id
               DELETE messages/:id          (requireRole('admin') on the whole router)
/health        liveness + DB ping
```

**Authorization is enforced in the service layer**, not just in routes: `assertMember(chatId)`, `assertCanSend` (group permissions, blocks, bans), `assertOwnMessage`, `assertGroupRole`. Blocking is enforced there too: blocked users cannot create DMs with or message the blocker, and presence and last seen are hidden from them.

### Socket events (server → client unless noted)

```
client→server:  typing:start|stop {chatId} · chat:open {chatId} · message:delivered {chatId, messageId}
server→client:  message:new · message:updated · message:deleted · reaction:updated
                receipt:updated {chatId, userId, deliveredId, readId}
                typing {chatId, userId, isTyping} · presence {userId, online, lastSeen}
                chat:updated · member:updated · notification:new
```

All events are validated with zod and rate-limited per socket. Membership is re-checked before any broadcast. Presence is only sent to users who share a conversation and are allowed to see it by privacy settings.

---

## 5. Frontend UX Architecture

**Responsive shell (container/breakpoint driven, not scaled down):**

| Width | Layout |
|---|---|
| < 768px (phone) | Single pane, stack navigation: Chats list ↔ Conversation (slide transition, back button, swipe back). Bottom tab bar: Chats · Search · Settings |
| 768–1199px (tablet) | Two panes: resizable chat list + conversation. The info panel opens as an overlay |
| ≥ 1200px (desktop) | Nav rail + chat list + conversation + optional details panel (inline) |
| ≥ 1600px | Max message line width is capped for readability; the details panel stays open by default |

**Mobile specifics:** `100dvh` plus the `visualViewport` API so the composer stays above the keyboard; `env(safe-area-inset-*)`; 44px minimum touch targets; long-press → bottom-sheet actions; swipe-to-reply; no hover-only affordances.

**Desktop specifics:** right-click context menu, a hover action bar on messages, drag-and-drop upload, and `Ctrl/Cmd+K` command palette search. `Esc` closes, `Enter` sends, `Shift+Enter` adds a newline, `↑` edits your last message, and `Alt+↑/↓` switches chats.

**Message list:** reverse infinite scroll, date separators, grouping of consecutive messages from the same sender, an "unread messages" divider, a jump-to-bottom button with an unread badge, and scroll position preserved when older pages load.

> **Implemented differently (Phase 3):** instead of `@tanstack/react-virtual`, the list is a bottom-anchored `flex-direction: column-reverse` scroller with `content-visibility: auto` on each row, loading 50 messages per page.
> - **Why:** the browser keeps the scroll position when older pages are prepended, which is the hardest part to get right with a JS virtualizer on dynamic-height rows. Off-screen rows skip layout and paint, which gives most of virtualization's rendering benefit. Text selection, find-in-page and screen readers stay native. And it's one fewer dependency.
> - **Trade-off:** the DOM grows as a user scrolls far back. If profiling in Phase 7 shows that matters, older pages can be trimmed from the cache with `maxPages`.

**States everywhere:** skeletons (chat list, messages, profile), designed empty states, inline errors with retry, a route-level error boundary, and a global connection banner (`Offline` · `Reconnecting…` · `Connected`).

**Offline / poor network:** optimistic messages keyed by `clientId` show Sending → Sent/Failed, with tap-to-retry. The outbox is held in IndexedDB and flushed on reconnect. Query data is refetched when the socket reconnects. The PWA shell is cached by the service worker, but **message content is not cached** there, for privacy.

**Design system:** original palette (not WhatsApp green or Discord blurple), an Inter-style variable font, a 4px spacing scale, a radius scale, 3 elevation levels, and motion kept to 150–250ms. Dark mode uses a separate, intentionally designed surface ramp, not inverted colours. Contrast is checked to WCAG AA. `prefers-reduced-motion` is respected.

---

## 6. Security Architecture (checklist the implementation must satisfy)

- helmet with a strict CSP, `express.json({ limit: '100kb' })`, and a CORS allowlist from `CLIENT_URL`
- `express-rate-limit`: auth endpoints (per IP + per account), send message, upload URL, search
- zod on **every** input (REST + socket): request bodies use `strictObject` (so an unknown field is a 400, not a silent mass assignment), query strings use `object` since Express adds keys of its own. Values reach Mongo already typed, and any user text used in a regex is escaped, so operator injection (`{"$ne": null}`) can't happen
- CSRF: SameSite=Lax cookies plus a required custom header (`X-Requested-With`) on state-changing requests, plus an Origin check
- XSS: React escaping; message text rendered through a linkifier that emits text nodes only (no `dangerouslySetInnerHTML`); SVG uploads rejected for avatars
- Uploads: MIME/size allowlist enforced by the presigned policy, server-side sniffing on finalize, `Content-Disposition: attachment` for non-media files
- Link previews: fetched server-side with **SSRF protection** (block private IP ranges, cap redirects, size and time limits)
- Account enumeration: forgot-password always returns 200; register conflict messages are rate-limited
- Session rotation on login and password change; all sessions revoked on password reset
- Logs (pino) redact `authorization`, `cookie`, `password`, `token` and message bodies

---

## 7. Phased Roadmap

Each phase ends in a working, runnable state. Before every major change I'll post the *exists → wrong → proposal → why → files → risks → preservation* summary, as you asked.

| Phase | Deliverables | Exit criteria | Status |
|---|---|---|---|
| **0. Scaffold** | `git init`, workspaces, `apps/web` (Vite+TS+Tailwind), `apps/server` (Express 5+TS+Mongoose), `packages/shared`, `.env.example`, `.gitignore` for `.env*` | Both apps boot; `/health` returns OK | ✅ `3eda53a` |
| **1. Auth + data model** | Mongoose models and indexes, opaque hashed sessions, register/login/logout/me, email verification, password reset, rate limits, error envelope | Every route rejects an unauthenticated caller; no password material ever leaves the server | ✅ `3eda53a` |
| **2. UI foundation** | Tokens, light/dark/system theme, primitives, responsive AppShell, auth pages, chat list, empty conversation, skeletons, toasts, error boundary | Layout verified at 360, 390, 430, 768, 1024, 1440 and 1920px | ✅ `528758a` |
| **3. Core messaging** | DMs, send (optimistic + idempotent), paginated bottom-anchored history, authenticated sockets, presence, typing, delivered/read, reply/edit/delete/react, date separators, unread counts, connection banner | Two browsers chat in real time; reconnection recovers missed messages | ✅ `3489e81` |
| **4. Advanced** | Groups + permissions; media/files with progress/retry; voice messages; forward/pin/star/copy; link previews; mentions; search (global + in-chat); profiles; settings/privacy; mute/pin/archive; blocking/reporting; Web Push; PWA | Feature checklist passes on mobile and desktop | ✅ 4a `a96ae1c`, 4b `4fd2982`, 4c `4e0bc37` `40f5bd5` `4f679f3` |
| **5. Admin** | Role-gated admin area: users, ban/unban, reports queue (fed by phase 4c), content removal, basic stats | Non-admins get 404 at the API, not just hidden UI | ✅ `eb8fcf1` |
| **6. Security review** | Full pass against §6 and an authorization test matrix (every route × non-member/non-owner/blocked/banned) | All authz tests green | ✅ `0f7cc0c` — see [SECURITY_REVIEW.md](SECURITY_REVIEW.md) |
| **7. Performance** | Seed 100k messages / 500 chats; profile the list, queries (`EXPLAIN`) and bundle size; throttled-network tests | Chat opens in under 300ms on a warm cache; initial JS under ~200KB gzip | Next |
| **8. Testing** | Vitest (server services + authz), Supertest (API), socket integration tests, Playwright (auth, messaging between two users, mobile viewport), manual checklist | CI green | |
| **9. Deployment** | `netlify.toml`, `render.yaml`, `DEPLOYMENT.md` (every env var, GridFS/SMTP/VAPID setup, Netlify proxy + socket tickets) | Production deploy smoke-tested | |

---

## 8. New Dependencies (each justified)

| Package | Why it's needed |
|---|---|
| vite, typescript | CRA replacement; type safety across a much larger codebase |
| tailwindcss | Removes the global-CSS collision problem; fast responsive work |
| @radix-ui/* (a few primitives) | Accessible dialogs, menus and popovers |
| @tanstack/react-query | Pagination, caching, optimistic updates; would otherwise be hand-written |
| ~~@tanstack/react-virtual~~ | Dropped in Phase 3: native `column-reverse` + `content-visibility` instead (see §5) |
| zustand | Tiny client-state store |
| zod | Validation shared between client and server |
| mongoose | Schema, indexes and typed queries (MongoDB kept — see §9) |
| helmet, express-rate-limit, cookie-parser | Security baseline |
| argon2 (keep bcrypt for legacy verify) | Password hashing |
| pino | Structured, redacting logs |
| ~~@aws-sdk/client-s3~~ | Dropped: files live in GridFS behind a `StorageDriver` interface, so S3/R2 can be swapped in later without touching callers |
| nodemailer | Verification/reset email over SMTP |
| web-push | Browser push notifications |
| vitest, supertest, playwright | Tests |

**Removed:** react-scripts, styled-components, axios (replaced by a small `fetch` wrapper), uuid (`crypto.randomUUID`), buffer, web-vitals, nodemon (replaced by `tsx watch` in dev).

---

## 9. Decisions — Answered

All five were settled on 2026-09-11; the block at the top of this document is the
authoritative record, and the rest of the plan has been reconciled with it.

1. **Database:** stay on **MongoDB** (Atlas M0). The PostgreSQL proposal in §D1 was declined.
2. **Domain:** no custom domain — **setup B**: Netlify proxies `/api/*` to Render so the session
   cookie stays first-party, and the WebSocket connects straight to Render using a short-lived
   single-use ticket.
3. **Existing data:** none to migrate; the local Mongo database is throwaway. No migration script
   was written, and there is no legacy-password compatibility path.
4. **Third-party accounts:** no Cloudflare R2 and no Resend. Files go to **GridFS** behind a
   `StorageDriver` interface; email goes over **SMTP via nodemailer**.
5. **Render plan:** staying on the **free tier**, which sleeps after ~15 minutes idle. The API
   client allows a generous first-request timeout and the UI explains the wake-up delay rather
   than showing a bare error.

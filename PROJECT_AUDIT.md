# Project Audit — ChatApp

**Audit date:** 2026-09-11
**Scope:** Every source file in `public/` (frontend) and `server/` (backend) was read in full. Dependency advisories come from `npm audit --package-lock-only` against the committed lockfiles.
**Limitations:** The directory is **not a git repository**, so git history could not be checked for committed credentials. Neither `node_modules` folder is installed, so the app was not run. The behaviour described below comes from reading the code.

---

## 1. Summary

The app is a small MERN student project, about 600 lines of application code. It supports registration, login, picking a random avatar, a list of **every user in the database**, and 1:1 text messages delivered over Socket.IO.

**Verdict:** It works as a demo but cannot run in production as-is:

1. **No authentication exists after login.** The server never issues a token or session. Every endpoint trusts user IDs sent by the client, so anyone can read any conversation, send messages as anyone, and change anyone's avatar.
2. **Password hashes are sent to the browser** and stored in `localStorage`.
3. **The registration flow is broken.** A new user gets sent back to the login page. The avatar step also depends on a third-party API that is probably dead.
4. **There is no mobile layout at all.**
5. **120+ known dependency vulnerabilities**, including 7 critical, and the frontend is built on Create React App, which is deprecated.

Because the codebase is so small, "preserving functionality" means **preserving behaviour and user data, not code**. Almost no code can be reused as-is. The existing tech choices (React, Express, Socket.IO, bcrypt) are sound and will be kept.

---

## 2. Current Tech Stack

| Layer | Technology | Version (lockfile range) | Status |
|---|---|---|---|
| Frontend build | Create React App (`react-scripts`) | 5.0.1 | **Deprecated** (officially sunset Feb 2025); 70+ transitive vulns |
| UI | React | 18.2 | OK, React 19 is current |
| Routing | react-router-dom | 6.8 | Has a high-severity advisory; v7 is current |
| HTTP | axios | 1.2 | Has a high-severity advisory |
| Real-time client | socket.io-client | 4.5 | Outdated (advisory) |
| Styling | Plain global CSS files | — | `styled-components` is installed but **never used** |
| Emoji | emoji-picker-react | 4.4 | Usable |
| Toasts | react-toastify | 9.1 | Usable |
| Misc | uuid, buffer, web-vitals, @testing-library/* | — | Used badly (uuid), polyfill only (buffer), or unused |
| Backend | Express | 4.18 | Outdated (advisories); Express 5 is current |
| Database | MongoDB via Mongoose | 6.9 | **Critical advisory** (search injection); v8 is current |
| Auth | bcrypt | 5.1 | Advisory via `node-pre-gyp`/`tar`; the hash format itself is fine |
| Real-time | socket.io | 4.5 | Advisories in `engine.io`, `ws`, `socket.io-parser` |
| Dev | nodemon | 2.0 | **Used as the production `start` script**, listed under `dependencies` |
| Language | JavaScript (no types) | — | — |
| Tests | None | — | `npm test` in the server just exits with an error |

### File structure

```
ChatApp-main/
├── public/                 ← the React frontend (confusingly named "public")
│   ├── public/             ← CRA static assets (index.html, manifest, logo)
│   └── src/
│       ├── .env            ← in the wrong place: CRA does not read .env from src/
│       ├── App.js          ← routes: /register /login /setAvatar /
│       ├── pages/          ← Chat, Login, Register (+ .css)
│       ├── components/     ← ChatContainer, ChatInput, Contacts, Logout, SetAvatar, Welcome (+ .css)
│       ├── assets/         ← logo.svg, loader.gif (236 KB), robot.gif (1.6 MB)
│       └── utils/APIRoutes.js  ← hardcoded http://localhost:5000
└── server/
    ├── index.js            ← Express + Mongo + Socket.IO all in one file
    ├── .env                ← PORT, MONGO_URL (NOT gitignored)
    ├── controllers/        ← userControllers.js, messageController.js
    ├── models/             ← userModels.js, messageModel.js
    └── routes/             ← userRoutes.js, messagesRoute.js
```

---

## 3. Existing Features (what actually works)

| Feature | Status | Notes |
|---|---|---|
| Register (username, email, password) | ⚠️ **Broken** | The account is created, but the user lands on `/login` (see Bug B1) |
| Login (username + password) | ✅ Works | Errors are never shown to the user (Bug B3) |
| Password hashing | ✅ bcrypt, cost 10 | Hashes can be migrated as-is to any new backend |
| Pick an avatar from 4 random SVGs | ⚠️ Probably broken | Depends on `api.multiavatar.com`, which is unauthenticated and not maintained (Bug B2) |
| Contact list | ⚠️ Works | Shows **every registered user**, including their emails. There is no concept of a conversation |
| Load a 1:1 chat history | ✅ Works | Loads the full history with no pagination |
| Send a text message | ✅ Works | Saved over REST, then relayed over the socket |
| Real-time receive | ⚠️ Partially works | Messages appear in the wrong chat (Bug B4) |
| Emoji picker | ✅ Works | Positioned with a hardcoded `top: -460px` |
| Logout | ⚠️ Client-only | Clears `localStorage`; the server is never told |
| Responsive layout | ❌ | Only one breakpoint (720–1080px); fixed sizes everywhere |

**Missing** (compared with the target): groups, edit/delete/reply/react, message status, typing indicator, presence, media, voice, search, notifications, profiles, settings, theming, blocking/reporting, admin, password reset, email verification, tests, and deployment configuration.

---

## 4. Security Findings

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Low

| # | Sev | Finding | Location |
|---|---|---|---|
| S1 | 🔴 | **No authentication on any endpoint.** Login returns a user object but no token or session. Every later request identifies the user by an ID the client supplies. | `server/routes/*` |
| S2 | 🔴 | **Anyone can read any conversation.** `POST /api/messages/getmsg` takes any `{from, to}` pair and returns that conversation. | [messageController.js:5-11](server/controllers/messageController.js#L5-L11) |
| S3 | 🔴 | **Anyone can send messages as anyone.** `POST /api/messages/addmsg` trusts `from` from the request body. | [messageController.js:27-32](server/controllers/messageController.js#L27-L32) |
| S4 | 🔴 | **Password hash sent to the client.** `delete user.password` does nothing on a Mongoose document, so the bcrypt hash is returned and saved in `localStorage`. | [userControllers.js:13,35](server/controllers/userControllers.js#L13) |
| S5 | 🔴 | **Socket identity hijacking.** `add-user` accepts any user ID. An attacker can register as a victim's ID and receive all of the victim's live messages. `send-msg` relays arbitrary content with a spoofable `from`, and nothing is persisted or checked. | [index.js:39-48](server/index.js#L39-L48) |
| S6 | 🟠 | **Anyone can change anyone's avatar** via `POST /setavatar/:id`. | [userControllers.js:55](server/controllers/userControllers.js#L55) |
| S7 | 🟠 | **User directory leaks all emails.** `GET /allusers/:id` returns every user's email to anyone, without authentication. | [userControllers.js:41](server/controllers/userControllers.js#L41) |
| S8 | 🟠 | **NoSQL injection.** No input validation. `username`, `from` and `to` go straight into Mongo filters, so an object such as `{"$ne": null}` is accepted. | all controllers |
| S9 | 🟠 | **Wildcard CORS** on the REST API (`app.use(cors())`). | [index.js:10](server/index.js#L10) |
| S10 | 🟠 | **No rate limiting.** Login and register can be brute-forced; message endpoints can be spammed. | — |
| S11 | 🟠 | **Identity kept in `localStorage`.** Any XSS would expose the full user object. The client decides who it is. | frontend-wide |
| S12 | 🟡 | **Stack traces leaked.** Errors fall through to Express's default handler, which returns stack traces unless `NODE_ENV=production`. | server |
| S13 | 🟡 | **No security headers** (no helmet/CSP), and no request body size limit is configured. | server |
| S14 | 🟡 | **Weak password policy** enforced only on the client. The `min`/`max` options on Mongoose `String` fields do nothing (the correct names are `minlength`/`maxlength`). | [userModels.js](server/models/userModels.js) |
| S15 | 🟡 | **Case-sensitive, untrimmed usernames and emails**, so near-duplicate accounts are possible (`Alice` vs `alice`). | register |
| S16 | 🟡 | **`server/.env` is not gitignored.** The current contents are harmless (local Mongo URL), but a real secret added later would be committed. | [server/.gitignore](server/.gitignore) |
| S17 | 🟡 | **120+ dependency advisories.** Server: 38 (2 critical: `mongoose`, `tar`). Frontend: 77 (5 critical: `webpack`, `@babel/traverse`, `form-data`, `shell-quote`, `websocket-driver`). | lockfiles |
| S18 | ⚪ | Avatars are rendered as `data:image/svg+xml` inside `<img>`. Scripts don't run in that context, so the risk is low. User-supplied SVG must still never be rendered inline. | Contacts, ChatContainer |
| S19 | ⚪ | Username enumeration: register returns "Username already used" and "Email already used". | register |

**Good:** React escapes message text, so there is no stored XSS today. Passwords are hashed with bcrypt.

---

## 5. Functional Bugs

| # | Bug | Location |
|---|---|---|
| B1 | **Registration saves the user under the wrong `localStorage` key.** `Register` writes `"chat-app-user"`, but everything else reads `process.env.REACT_APP_LOCALHOST_KEY`. A newly registered user is redirected from `/` straight back to `/login`. | [Register.js:82](public/src/pages/Register.js#L82) |
| B1b | `.env` is in `public/src/`, but CRA reads only `public/.env`. `REACT_APP_LOCALHOST_KEY` is therefore `undefined`, and the login data is stored under the literal key `"undefined"`. It only works by accident. | [public/src/.env](public/src/.env) |
| B2 | **Avatar step.** `setIsLoading(false)` runs before the fetch finishes, so the page flashes empty. The 4 requests run one after another. It uses the deprecated `new Buffer()` and a list without `key`s. Errors are swallowed with `console.log`, which leaves an empty screen and **blocks the user from ever reaching chat**. It depends on an external API that has not been verified to still work. | [SetAvatar.js:60-80](public/src/components/SetAvatar.js#L60-L80) |
| B3 | **Login errors are never displayed.** `Login` imports `ToastContainer` but never renders it. | [Login.js](public/src/pages/Login.js) |
| B4 | **Incoming messages appear in the wrong chat.** The `msg-recieve` handler doesn't check the sender. A message from Bob shows up while you have Alice's chat open. | [ChatContainer.js:45-51](public/src/components/ChatContainer.js#L45-L51) |
| B5 | **Socket listener race.** The listener is attached once, on mount (`[]` deps). If `socket.current` isn't ready yet, live messages are never received. Listeners are never removed. | same |
| B6 | **Socket leak.** A new `io()` connection is created whenever `currentUser` changes and is never disconnected. On the server, `onlineUsers` maps one user to one socket (a second tab replaces the first) and entries are never removed on disconnect. | [Chat.js:32-37](public/src/pages/Chat.js#L32-L37), [index.js:36](server/index.js#L36) |
| B7 | `global.chatSocket = socket` is overwritten on every connection. It is dead code. | [index.js:38](server/index.js#L38) |
| B8 | Messages are sorted by `updatedAt` instead of `createdAt`, so edits would reorder history. | [messageController.js:11](server/controllers/messageController.js#L11) |
| B9 | `key={uuidv4()}` creates new keys on every render, so every message remounts on every render. `ref={scrollRef}` is attached to every message. | [ChatContainer.js:81](public/src/components/ChatContainer.js#L81) |
| B10 | `handleSendMsg` builds the new list from a stale `messages` closure, which can drop a message that arrives at the same moment. There is no error handling: if the POST fails, the promise rejection is unhandled and the user gets no feedback. | [ChatContainer.js:27-43](public/src/components/ChatContainer.js#L27-L43) |
| B11 | `Contacts` has a `useEffect` with no dependency array, so it re-reads `localStorage` on every render. | [Contacts.js:8-17](public/src/components/Contacts.js#L8-L17) |
| B12 | No `.catch` on any axios call, so a network failure means a blank screen or unhandled rejection. | frontend-wide |
| B13 | `Message.sender` uses `ref: "User"`, but the model is registered as `"Users"`, so `populate` would fail. | [messageModel.js:11](server/models/messageModel.js#L11) |
| B14 | If the Mongo connection fails, the error is logged and the server keeps accepting requests anyway. | [index.js:16-23](server/index.js#L16-L23) |
| B15 | The logout endpoint exists but is never called. It is also unauthenticated, so anyone can mark anyone offline. | [userControllers.js:75](server/controllers/userControllers.js#L75) |
| B16 | The Login error message says "Email and Password is required", but the field is a username. | [Login.js:35](public/src/pages/Login.js#L35) |

---

## 6. Architecture & Code-Quality Problems

- **No concept of a conversation.** Messages store an untyped `users: Array` pair, and the "contact list" is the whole user table. Groups, unread counts, last message, muting and pinning all need a `Conversation` + `Member` model.
- **No indexes** on `messages.users` or `createdAt`. Every chat load scans the collection and returns the **entire history**.
- **Server is one file.** DB, HTTP and sockets live together. There is no config validation, health check, graceful shutdown, structured logging or error middleware.
- **Inconsistent API.** RPC-style verbs (`/addmsg`, `/getmsg`, `/setavatar/:id`), `POST` used for reads, and `GET` used for logout. Every response returns `200` with a `status: false` flag and varying shapes (`msg`, `isSet`, a raw array).
- **Duplicated state.** The current user is parsed from `localStorage` in five components (Chat, Contacts, Welcome, ChatContainer, SetAvatar) instead of one auth context.
- **Global CSS collisions.** CRA bundles every `.css` file globally. `input`, `button`, `form`, `span` and `.brand` are restyled in 3–4 files, and `.Container` is defined differently in `Chat.css` and `SetAvatar.css`. Load order decides which style wins. Class names like `Containerr`/`Containerrr` show the workaround.
- **Dead code:** unused `styled-components` imports (4 files), an unused `ToastContainer` import in Login, an unused `axios` import in Logout, the unused `currentUser` prop in Welcome, and unused `web-vitals`/testing libraries.
- **Duplicated code:** Login.css and Register.css are ~95% identical, and `toastOptions` is copy-pasted into 3 files.
- **Hardcoded values:** `http://localhost:5000` (API), `http://localhost:3000` (socket CORS), and the multiavatar API key segment `4645646`.

---

## 7. UX, Responsiveness & Accessibility

- **Mobile: unusable.** A fixed `85vw × 85vh` box with a `25%/75%` grid on every screen size. On a 375px phone the contact list is about 94px wide. There is no list→conversation navigation and no back button.
- `100vh` combined with `body { overflow: hidden }` breaks when the mobile keyboard opens, and the composer can be hidden.
- The Logout button uses `position: absolute; right: 9%; top: 70px`, so it floats in unpredictable places.
- `.contacts { height: 545px }` is fixed.
- The emoji picker is pinned at `top: -460px` and overflows on short screens.
- **No loading, empty or error states.** There is no chat-list skeleton or empty conversation state, and a failed avatar fetch shows nothing.
- **Accessibility:** clickable `<div>`s for contacts and avatars (no keyboard access), icon-only buttons without labels (send, emoji, logout), no visible focus styles (`outline: none`), `alt=""` on meaningful avatars, and inputs with placeholders but no labels. The 1.6 MB `robot.gif` also costs performance.
- Dark-only theme with low-contrast combinations (for example `#4e0eff` link text on a near-black background).
- The PWA manifest is still the CRA default ("Create React App Sample"), and the page description reads "Web site created using create-react-app".

---

## 8. Database Review

**Current schema (MongoDB)**

```
Users    { username (unique), email (unique), password, isAvatarImageSet, avatarImage (base64 SVG string) }
Messages { message: { text }, users: Array<string>, sender: ObjectId, createdAt, updatedAt }
```

Problems:
- No conversation or membership entities, so groups, unread state and chat-list ordering are impossible without full scans.
- `users: Array` has no type, no index, and no guarantee that the IDs exist.
- Avatars are stored as base64 strings **inside the user document** and returned in every user list.
- No read, delivery, reaction, attachment, session, block or report entities.
- Validation options are misnamed (`min`/`max` on strings), so nothing is enforced.

**Existing data worth migrating:** users (username, email, bcrypt hash, avatar) and message text with timestamps. bcrypt hashes are portable, so existing users keep their passwords.

---

## 9. Deployment Readiness

| Item | Status |
|---|---|
| Frontend API URL | Hardcoded `localhost:5000` |
| Socket CORS | Hardcoded `localhost:3000` |
| Netlify config (`netlify.toml`, SPA redirects) | Missing, so deep links like `/login` would 404 |
| Render config (`render.yaml`, health check) | Missing |
| Production start script | Uses `nodemon` |
| Node version pinning (`engines`) | Missing |
| `.env.example` | Missing |
| Graceful shutdown (SIGTERM) | Missing; Render sends SIGTERM on every deploy |
| Logging | `console.log` only |
| File storage | None (Render's disk is ephemeral, so object storage is needed) |
| Email provider (reset/verification) | None |

---

## 10. Reuse Assessment

| Keep (concept / data) | Refactor | Replace | Add |
|---|---|---|---|
| React + Express + Socket.IO stack | Auth flow (keep username/email/password, add sessions) | CRA → **Vite** | Conversation/member model |
| bcrypt password hashes (migrate as-is) | Login/Register pages (rebuilt with validation and a11y) | Global CSS → **design tokens + utility CSS** | Session auth + socket auth |
| `emoji-picker-react` | Avatar flow → uploaded photo, with generated initials as the default | multiavatar API dependency | Validation, rate limits, helmet |
| `react-toastify` idea (toasts) | Chat container → virtualized list | `localStorage` identity | Everything in §3 "Missing" |
| Logo asset | Socket events → authenticated, room-based | Mongo `users: Array` model | Tests, CI, deploy config |
| Existing users + message history | | `robot.gif` / `loader.gif` → skeletons + SVG illustration | |

**Conclusion:** A **structured rewrite that preserves behaviour and migrates the data** is the right approach. Patching in place would mean touching every file anyway, and the missing pieces (auth, the conversation model, responsive layout) are foundations, not additions. Existing users and messages will be migrated by a script.

See **[MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md)** for the target architecture and phased roadmap.

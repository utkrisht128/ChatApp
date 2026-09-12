# Testing

## What runs automatically

| Suite | Where | Covers |
|---|---|---|
| **Server** — 163 tests, 12 files | `apps/server/test` | Services and the full HTTP API through Supertest, against a real MongoDB started in memory |
| **Authorization matrix** | `apps/server/test/authz.test.ts` | Every protected route against every caller who must not reach it (see `SECURITY_REVIEW.md`) |
| **Socket integration** | `apps/server/test/realtime.test.ts` | Ticket authentication, live delivery and receipts, typing isolation, presence privacy, forced logout |
| **End-to-end** | `e2e/` | Registration, sign-in, two users messaging each other live, and the phone layout — in a real browser |

```bash
npm run typecheck     # every workspace
npm test              # server suite (starts its own MongoDB, no setup)
npm run test:e2e      # end-to-end; needs a MongoDB on localhost:27017
npm run test:e2e:ui   # the same, in Playwright's UI mode
```

The end-to-end suite starts the API and the web dev server itself. The API runs with
`NODE_ENV=test` so the rate limiters are skipped — otherwise the ten-signups-per-hour limit would
fail the suite on its fifth run — and against its own `chatapp_e2e` database. It is started with
plain `tsx` rather than the `dev` script, so it cannot pick up `apps/server/.env` and quietly
point the tests at development data.

Locally the tests reuse the installed Microsoft Edge, so no browser download is needed. CI
installs Chromium. Both are configured in `playwright.config.ts`.

## What is deliberately not automated

These need real external services or human judgement. Check them before a release.

### Email
- [ ] Register a new account: the verification email arrives and its link verifies the account.
- [ ] "Forgot password": the email arrives, the link works, and it can only be used once.
- [ ] After a password reset, every other session is signed out.

*Without `SMTP_URL` set, development prints the email and its link to the server console, which is
enough to walk through the flow.*

### Push notifications
Never verified end to end — it needs VAPID keys and a real browser subscription.
- [ ] With `VAPID_*` configured, enable notifications in Settings and confirm the browser prompts.
- [ ] With the tab closed, a new message produces a system notification.
- [ ] The notification respects the "show preview" setting, and muted chats stay silent.
- [ ] Clicking the notification opens the right conversation.

### Files and media
- [ ] Upload a real photo, a video, a PDF and a document; each previews or downloads correctly.
- [ ] Record and send a voice message; the waveform and duration look right.
- [ ] A file over the size limit is refused with a clear message.
- [ ] Storage quota: uploading past the quota is refused.
- [ ] Deleting a message releases its file and the quota it used.

### Offline and installation
- [ ] Load the app, go offline: the shell still loads and a connection banner appears.
- [ ] Messages written offline send once the connection returns.
- [ ] Install as a PWA; the icon, name and theme colour are correct.

### Link previews
- [ ] Paste a public URL: a preview appears with title, description and image.
- [ ] Paste a URL that resolves to a private address: no preview, and no error shown to the user.

### Accessibility and input
- [ ] The whole app is reachable by keyboard, including the message list arrow keys.
- [ ] A screen reader announces new messages (the list is a `role="log"`).
- [ ] Visible focus rings everywhere; `Ctrl`/`Cmd`+`K` focuses search.
- [ ] Both themes are legible, and the app follows the system theme setting.

### Devices and browsers
- [ ] Safari on iOS and Chrome on Android: layout, the on-screen keyboard, and safe areas.
- [ ] Firefox and Safari on the desktop.
- [ ] A narrow window (360px) and a wide one (1920px).

## Performance

Load and query profiling is a separate exercise with its own harness and thresholds — see
`PERFORMANCE.md` and `apps/server/scripts/`.

# Deployment

Netlify serves the frontend; Render runs the API and WebSocket server; MongoDB Atlas stores both
the data and the uploaded files (GridFS). All three have free tiers that fit this app.

## How the pieces fit

The frontend and API share an origin as far as the browser is concerned:

- **`/api/*` is proxied by Netlify to Render.** The session cookie is therefore first-party
  (`HttpOnly; Secure; SameSite=Lax`), which is what makes it survive in browsers that block
  third-party cookies. Generated at build time into `dist/_redirects`, because `netlify.toml`
  cannot read environment variables.
- **The WebSocket connects straight to Render**, because Netlify cannot proxy upgrades. Since
  that is cross-origin, it cannot rely on the cookie: the client asks the API (same-origin, over
  the proxy) for a **single-use 60-second ticket** and presents that on the socket handshake.
- **The Content-Security-Policy is generated at build time** too, since `connect-src` has to name
  the Render origin. The one inline script is allowed by hash, not `'unsafe-inline'`.

This is why `API_ORIGIN` and `VITE_SOCKET_URL` are both build-time variables on Netlify, and both
point at the Render service.

## 1. MongoDB Atlas

1. Create a free **M0** cluster.
2. **Database Access** → add a user with a strong password.
3. **Network Access** → Render's outbound IPs are not fixed on the free plan, so allow
   `0.0.0.0/0`. The database user's password is what protects the cluster.
4. Copy the SRV connection string and append the database name:
   `mongodb+srv://USER:PASSWORD@cluster.xxxxx.mongodb.net/chatapp?retryWrites=true&w=majority`

Indexes are created by the server on first boot in production (`syncIndexes()`), so there is
nothing to run by hand.

> M0 gives **512MB total**, shared by messages and every uploaded file. `MAX_UPLOAD_MB` and
> `USER_STORAGE_QUOTA_MB` exist to keep that from filling up.

## 2. Render (API)

The repository contains `render.yaml`, so use **New → Blueprint** and point it at the repo; Render
reads the service definition and prompts for the values marked `sync: false`.

| Variable | Value |
|---|---|
| `MONGODB_URI` | The Atlas string from step 1 |
| `CLIENT_URL` | Your Netlify origin, e.g. `https://your-site.netlify.app` — **no trailing slash** |
| `SMTP_URL` | Optional — `smtps://user:pass@smtp.host:465` |
| `MAIL_FROM` | Optional — `ChatApp <no-reply@yourdomain>` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Optional — `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | Optional — `mailto:you@example.com` |
| `ADMIN_EMAILS` | Optional — comma-separated; these accounts get the admin role |

Everything else (`NODE_ENV`, `PORT`, `TRUST_PROXY`, log level, limits) is set by the blueprint or
by Render itself. **Do not set `PORT`** — Render provides it.

You do not have `CLIENT_URL` yet on the first pass. Deploy anyway, take the Render URL
(`https://chatapp-api.onrender.com`), do step 3, then come back and set `CLIENT_URL` to the
Netlify origin. The service restarts automatically.

### Free-tier behaviour worth knowing
The free instance **sleeps after 15 minutes of inactivity** and takes roughly 50 seconds to wake.
The client allows a 30-second request timeout and the socket retries, so the app recovers, but the
first visit after idling is slow. Upgrading to a paid instance is the only real fix.

## 3. Netlify (frontend)

**Add new site → Import an existing project.** `netlify.toml` already sets the build command
(`npm run build:web`), the publish directory (`apps/web/dist`), Node 22, and the security headers.

Set these **site environment variables** before the first build:

| Variable | Value |
|---|---|
| `API_ORIGIN` | The Render URL, e.g. `https://chatapp-api.onrender.com` |
| `VITE_SOCKET_URL` | The same Render URL |
| `VITE_VAPID_PUBLIC_KEY` | Optional — must equal the server's `VAPID_PUBLIC_KEY` |

The build **fails deliberately** if `API_ORIGIN` is missing on Netlify, rather than shipping a site
whose `/api` calls go nowhere.

## 4. Close the loop

Set `CLIENT_URL` on Render to the Netlify origin and let it redeploy. If you later add a custom
domain, update `CLIENT_URL` (it accepts a comma-separated list) and `API_ORIGIN`/`VITE_SOCKET_URL`,
then rebuild both sides — the CSP is baked in at build time.

## Smoke test after deploying

- [ ] `https://<render-url>/health` returns ok.
- [ ] The site loads; the browser console shows **no CSP violations**.
- [ ] Register an account; you land in the app.
- [ ] Open a second browser (or a private window), register another account, and message between
      them: messages, typing and read receipts should all appear **without reloading**. This is the
      real test of the socket ticket and the cross-origin WebSocket.
- [ ] Send a photo and a file; both upload and download.
- [ ] Reload: you are still signed in (first-party cookie surviving the proxy).
- [ ] On a phone-sized window, the list and conversation swap correctly.

### Not yet verified anywhere
These three could not be exercised in development and should be checked on the deployed site:

- **Push notifications** — needs VAPID keys and a real browser subscription. Enable notifications
  in Settings, close the tab, and have the other account send a message.
- **Link previews** — paste a public URL and confirm a preview appears. Also paste a URL that
  resolves to a private address and confirm nothing is fetched.
- **Offline** — load the app, go offline, confirm the shell still loads and queued messages send
  on reconnect.

## Rolling back

Both platforms keep previous deploys: Netlify's **Deploys → Publish deploy** and Render's
**Events → Rollback**. Neither touches the database, so a rollback is safe as long as no migration
has run — this app creates indexes but never destructively migrates.

## Operational notes

- **Logs** are structured JSON (pino) and redact cookies, tokens, passwords and message bodies.
- **First admin**: add the address to `ADMIN_EMAILS` and register or sign in with it. Admin routes
  return 404 (not 403) to everyone else, so there is nothing to discover.
- **Backups**: Atlas M0 has no automated backups. `mongodump` on a schedule is the free option.
- **Secrets**: everything sensitive is `sync: false` in `render.yaml` and a site variable on
  Netlify — nothing secret is committed. Rotate by changing the value and redeploying.

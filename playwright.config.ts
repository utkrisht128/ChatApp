import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the real stack: the API on its own database, and the app served
 * by Vite with the same /api and /socket.io proxying it uses in development.
 *
 * The API runs with NODE_ENV=test, which disables the rate limiters (`skip: () => isTest`).
 * Without that, the 10-signups-per-hour limit would fail the suite on its fifth run.
 *
 * The server is started with plain `tsx` rather than its `dev` script, so it cannot pick up
 * apps/server/.env and quietly point the tests at the development database.
 */
const API_PORT = 5001;
const WEB_PORT = 5173;
const MONGODB_URI = process.env.E2E_MONGODB_URI ?? "mongodb://127.0.0.1:27017/chatapp_e2e";

export default defineConfig({
  testDir: "./e2e",
  // Two users talking to each other is inherently racy to debug; keep failures reproducible.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        // Locally this reuses the installed Edge instead of downloading a browser; CI installs
        // Chromium properly with `playwright install`.
        ...(process.env.CI ? {} : { channel: "msedge" }),
      },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        ...(process.env.CI ? {} : { channel: "msedge" }),
      },
      testMatch: /mobile\.spec\.ts/,
    },
  ],

  webServer: [
    {
      command: "npx tsx apps/server/src/index.ts",
      port: API_PORT,
      // Always start fresh. Reusing whatever happens to be on the port once let a stale dev
      // server serve the tests, pointing them at the development database instead of this one.
      reuseExistingServer: false,
      stdout: "pipe",
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        PORT: String(API_PORT),
        MONGODB_URI,
        CLIENT_URL: `http://localhost:${WEB_PORT}`,
        LOG_LEVEL: "warn",
        TRUST_PROXY: "0",
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: "apps/web",
      port: WEB_PORT,
      // Always start fresh. Reusing whatever happens to be on the port once let a stale dev
      // server serve the tests, pointing them at the development database instead of this one.
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DEV_API_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
});

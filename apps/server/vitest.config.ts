import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["test/global-setup.ts"],
    setupFiles: ["test/setup.ts"],
    // env.ts validates at import time; the real connection string is injected by global-setup.
    env: {
      NODE_ENV: "test",
      MONGODB_URI: "mongodb://injected-by-global-setup",
      CLIENT_URL: "http://localhost:5173",
      ADMIN_EMAILS: "admin@example.com",
    },
    hookTimeout: 120_000,
    testTimeout: 20_000,
  },
});

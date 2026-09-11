import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.DEV_API_TARGET || "http://localhost:5000";

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: {
      port: 5173,
      // Same-origin /api in development, mirroring the Netlify proxy in production.
      proxy: { "/api": { target: apiTarget, changeOrigin: false } },
    },
    build: { sourcemap: true, target: "es2022" },
  };
});

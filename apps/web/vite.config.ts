import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

// While the API restarts, proxied requests and sockets get reset. Log it instead of letting an
// unhandled 'error' event take the whole dev server down.
const logProxyErrors: ProxyOptions["configure"] = (proxy) => {
  proxy.on("error", (err) => console.warn(`[proxy] ${err.message}`));
  proxy.on("proxyReqWs", (_req, _clientReq, socket) => socket.on("error", () => {}));
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // process.env wins over .env files: the end-to-end runner passes the API port this way, and
  // silently proxying to the default port instead would point the tests at the wrong database.
  const apiTarget = process.env.DEV_API_TARGET || env.DEV_API_TARGET || "http://localhost:5000";

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: {
      port: 5173,
      // Same-origin /api in development, mirroring the Netlify proxy in production.
      // In production the socket connects straight to VITE_SOCKET_URL; locally it can ride the dev proxy.
      proxy: {
        "/api": { target: apiTarget, changeOrigin: false, configure: logProxyErrors },
        "/socket.io": { target: apiTarget, changeOrigin: false, ws: true, configure: logProxyErrors },
      },
    },
    build: { sourcemap: true, target: "es2022" },
  };
});

import http from "node:http";
import mongoose from "mongoose";
import { createApp } from "./app";
import { env, isProd } from "./config/env";
import { connectDb, syncIndexes } from "./lib/db";
import { logger } from "./lib/logger";
import { createRealtime } from "./realtime";

process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "Unhandled promise rejection"));
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — exiting");
  process.exit(1);
});

async function main() {
  // Fail fast: without a database the service is useless, and Render will restart it.
  await connectDb(env.MONGODB_URI);
  if (isProd) await syncIndexes();

  const server = http.createServer(createApp());
  // Render's load balancer keeps connections alive for up to 60s+; outlive it to avoid 502s.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  const io = createRealtime(server);

  server.listen(env.PORT, () => logger.info({ port: env.PORT, env: env.NODE_ENV }, "Server started"));

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down gracefully");
    const force = setTimeout(() => {
      logger.warn("Forced exit after shutdown timeout");
      process.exit(1);
    }, 10_000);
    force.unref();

    // Closes sockets (clients reconnect to the new instance) and then the HTTP server.
    void io.close(async () => {
      await mongoose.disconnect();
      logger.info("Shutdown complete");
      process.exit(0);
    });
    server.closeIdleConnections();
    // Keep-alive connections (e.g. a proxy's pooled sockets) would otherwise hold the port
    // open until the forced exit: give in-flight requests a short grace period in
    // production, none in development where the watcher restarts immediately.
    if (isProd) setTimeout(() => server.closeAllConnections(), 5_000).unref();
    else server.closeAllConnections();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});

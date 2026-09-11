import cookieParser from "cookie-parser";
import express, { Router } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env";
import { isDbReady } from "./lib/db";
import { logger } from "./lib/logger";
import { authenticate } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { apiLimiter, csrfGuard } from "./middleware/security";
import { authRouter } from "./modules/auth/routes";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Behind Render's proxy (and Netlify's, for /api) — needed for correct client IPs in rate limiting.
  app.set("trust proxy", env.TRUST_PROXY);

  // The browser reaches the REST API same-origin (Vite proxy in dev, Netlify proxy in production),
  // so no CORS is enabled here. Socket.IO configures its own CORS for the direct WebSocket.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));

  app.get(["/health", "/api/health"], (_req, res) => {
    const db = isDbReady();
    res.status(db ? 200 : 503).json({ status: db ? "ok" : "degraded", db, uptime: Math.round(process.uptime()) });
  });

  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  const api = Router();
  api.use("/auth", authRouter);

  app.use("/api", apiLimiter, csrfGuard, authenticate, api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

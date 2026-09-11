import mongoose from "mongoose";
import { isProd } from "../config/env";
import { logger } from "./logger";

mongoose.set("strictQuery", true);

export async function connectDb(uri: string) {
  mongoose.connection.on("disconnected", () => logger.warn("MongoDB disconnected"));
  mongoose.connection.on("reconnected", () => logger.info("MongoDB reconnected"));
  mongoose.connection.on("error", (err) => logger.error({ err }, "MongoDB error"));

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 10,
    // Build indexes automatically in development; in production they are synced explicitly at boot.
    autoIndex: !isProd,
  });
  logger.info("MongoDB connected");
}

/** Create any missing indexes declared on the models. Safe to run on every boot. */
export async function syncIndexes() {
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
}

export const isDbReady = () => mongoose.connection.readyState === 1;

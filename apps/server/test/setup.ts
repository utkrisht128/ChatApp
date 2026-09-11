import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, inject } from "vitest";
// Register models only — importing the app here would load real modules (e.g. the mailer)
// before a test file's vi.mock() calls can replace them.
import "../src/models";
import { syncIndexes } from "../src/lib/db";

// One throwaway database per test file, so files can run in parallel.
const dbName = `chatapp_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  await mongoose.connect(inject("mongoUri"), { dbName });
  await syncIndexes();
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

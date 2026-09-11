import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

/**
 * Uses TEST_MONGODB_URI when set (e.g. a local mongod), otherwise starts an
 * in-memory MongoDB so the suite runs anywhere, including CI, with no setup.
 */
export default async function setup(project: TestProject) {
  const external = process.env.TEST_MONGODB_URI;
  if (external) {
    project.provide("mongoUri", external);
    return;
  }
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const server = await MongoMemoryServer.create();
  project.provide("mongoUri", server.getUri());
  return () => server.stop();
}

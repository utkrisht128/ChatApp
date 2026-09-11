import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  // The shared workspace package ships TypeScript source, so bundle it in.
  noExternal: ["@chat/shared"],
});

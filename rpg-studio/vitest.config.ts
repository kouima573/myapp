import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@rpg/engine": path.resolve(__dirname, "packages/engine/src/index.ts"),
      "@rpg/modules": path.resolve(__dirname, "packages/modules/src/kit.ts"),
      "@rpg/schema": path.resolve(__dirname, "packages/schema/src/index.ts"),
    },
  },
  test: { include: ["packages/**/*.test.ts", "studio/src/**/*.test.ts", "tests/**/*.test.ts"], environment: "node" },
});

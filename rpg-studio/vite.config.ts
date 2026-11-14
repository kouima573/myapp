import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(__dirname, "studio"),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@rpg/engine": path.resolve(__dirname, "packages/engine/src/index.ts"),
      "@rpg/schema": path.resolve(__dirname, "packages/schema/src/index.ts"),
    },
  },
  server: { host: "127.0.0.1", port: 5173, fs: { allow: [path.resolve(__dirname)] } },
  build: { outDir: path.resolve(__dirname, "dist/studio"), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});

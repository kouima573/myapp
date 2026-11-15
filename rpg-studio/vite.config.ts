import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Tags every HTML element written in studio JSX with data-src="studio/src/…tsx:line", so the studio's
 * 「コードを探す」 (Alt+click) can show which file and line draws any part of the screen.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Babel is a transitive dependency of plugin-react; its types are not installed. */
function sourceTags({ types: t }: { types: any }) {
  return {
    visitor: {
      JSXOpeningElement(p: any, state: { filename?: string }) {
        const name = p.node.name;
        if (name.type !== "JSXIdentifier" || !/^[a-z]/.test(name.name)) return;
        if (p.node.attributes.some((a: any) => a.type === "JSXAttribute" && a.name.name === "data-src")) return;
        const file = path.relative(__dirname, state.filename ?? "").split(path.sep).join("/");
        if (!file.startsWith("studio/src/")) return;
        p.node.attributes.push(t.jsxAttribute(t.jsxIdentifier("data-src"), t.stringLiteral(`${file}:${p.node.loc?.start.line ?? 1}`)));
      },
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, "studio"),
  base: "./",
  plugins: [react({ babel: { plugins: [sourceTags] } })],
  resolve: {
    alias: {
      "@rpg/engine": path.resolve(__dirname, "packages/engine/src/index.ts"),
      "@rpg/modules": path.resolve(__dirname, "packages/modules/src/kit.ts"),
      "@rpg/schema": path.resolve(__dirname, "packages/schema/src/index.ts"),
    },
  },
  server: { host: "127.0.0.1", port: 5173, fs: { allow: [path.resolve(__dirname)] } },
  build: { outDir: path.resolve(__dirname, "dist/studio"), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});

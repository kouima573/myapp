import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildProject, REPO_ROOT } from "./build";
import { loadSystems, runProjectScenarios } from "./index";
import { loadProjectFromDisk } from "./load";
import { loadBuiltContent } from "../../runtime/src/standalone";

/**
 * The built game reads its data without Zod. It must behave exactly like the validated project:
 * every scenario test of the samples is replayed on the content loaded from the build output.
 */
describe("built game data", () => {
  for (const id of ["sample-rpg", "genre-gallery"]) {
    it(`${id}: the built data plays the same as the project (all scenarios pass)`, async () => {
      const root = path.join(REPO_ROOT, "projects", id);
      const out = path.join(REPO_ROOT, ".rpg-studio", `build-test-${id}-${crypto.randomBytes(4).toString("hex")}`);
      try {
        const result = await buildProject(root, { outDir: out, minify: false });
        expect(result.ok, result.diagnostics.map(d => d.message).join("\n")).toBe(true);
        const loaded = await loadProjectFromDisk(root);
        const systems = await loadSystems(root, loaded.content!);
        const read = async <T,>(relative: string): Promise<T> => JSON.parse(await fs.readFile(path.join(out, "data", ...relative.split("/")), "utf8")) as T;
        const built = await loadBuiltContent(read, systems);
        // No raw project files that the game does not need (ideas, art requests, tests…).
        expect(await fs.access(path.join(out, "data", "IDEA.md")).then(() => true, () => false)).toBe(false);
        const results = await runProjectScenarios(root, built, systems);
        expect(results.filter(r => !r.ok).map(r => `${r.file}: ${r.message}`)).toEqual([]);
        expect(results.length).toBeGreaterThan(0);
      } finally {
        await fs.rm(out, { recursive: true, force: true });
      }
    }, 120000);
  }
});

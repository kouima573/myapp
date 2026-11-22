import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { REPO_ROOT } from "./build";
import { loadSystems, runProjectScenarios } from "./index";
import { loadProjectFromDisk } from "./load";
import { cmdRename, findRefs } from "./refs";

let dir: string;
beforeAll(async () => {
  dir = path.join(REPO_ROOT, ".rpg-studio", `refs-test-${crypto.randomBytes(4).toString("hex")}`);
  await fs.cp(path.join(REPO_ROOT, "projects/sample-rpg"), dir, { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterAll(async () => { vi.restoreAllMocks(); await fs.rm(dir, { recursive: true, force: true }); });

describe("rpg refs / rename", () => {
  it("finds a flag in declarations, conditions and tests", async () => {
    const hits = await findRefs(dir, "questComplete");
    expect(hits.some(h => h.file === "project.json" && h.kind === "key")).toBe(true);
    expect(hits.some(h => h.kind === "value")).toBe(true);
  });

  it("renames a flag and an item everywhere; the project still validates and every scenario passes", async () => {
    expect(await cmdRename(["questComplete", "quest-done"], { write: true }, dir)).toBe(0);
    expect(await cmdRename(["herb", "healing-herb"], { write: true }, dir)).toBe(0);
    expect((await findRefs(dir, "questComplete")).filter(h => h.kind !== "code")).toEqual([]);
    const loaded = await loadProjectFromDisk(dir);
    expect(loaded.diagnostics.filter(d => d.severity === "error").map(d => `${d.file} ${d.at} ${d.message}`)).toEqual([]);
    const systems = await loadSystems(dir, loaded.content!);
    const results = await runProjectScenarios(dir, loaded.content!, systems);
    expect(results.filter(r => !r.ok).map(r => `${r.file}: ${r.message}`)).toEqual([]);
  }, 60000);

  it("refuses a name that is already used", async () => {
    expect(await cmdRename(["healing-herb", "bronze-sword"], { write: true }, dir)).toBe(1);
  });
});

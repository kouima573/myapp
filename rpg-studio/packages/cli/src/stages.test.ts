import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyStage, newProject } from "./scaffold";
import { loadProjectFromDisk } from "./load";
import { loadSystems, runProjectScenarios } from "./index";

describe("rpg new --stage (012)", () => {
  it("each stage is a valid project whose scenario tests pass", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rpg-stage-"));
    try {
      for (const stage of [1, 2, 3]) {
        const dir = await newProject(`stage-${stage}`, `段階${stage}`, root);
        await applyStage(dir, stage);
        const loaded = await loadProjectFromDisk(dir);
        expect(loaded.diagnostics.filter(d => d.severity === "error")).toEqual([]);
        const results = await runProjectScenarios(dir, loaded.content!, await loadSystems(dir, loaded.content!));
        expect(results.filter(r => !r.ok).map(r => r.message)).toEqual([]);
        expect(results.length).toBe(stage + 1);
      }
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }, 60000);
});

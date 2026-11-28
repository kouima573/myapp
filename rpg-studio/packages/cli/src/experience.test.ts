import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ExperienceScenarioSchema, runExperienceScenario } from "../../engine/src/experienceScenario";
import type { ExperienceDefinition } from "../../engine/src/experience";
import { importSystemModule } from "./build";
import { loadExperienceProject } from "./experience";

const root = path.resolve(__dirname, "../../../projects/deep-sea-post-office");

describe("独立作品（experience）", () => {
  it("見本「深海郵便局」が検証を通り、入力シナリオが状態遷移を確かめる", async () => {
    const loaded = await loadExperienceProject(root);
    expect(loaded.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(loaded.manifest?.runtime ?? "experience").toBe("experience");
    const definition = (await importSystemModule(loaded.entryFile!) as { default: ExperienceDefinition }).default;
    expect(definition.id).toBe(loaded.manifest!.id);
    const scenario = ExperienceScenarioSchema.parse(JSON.parse(await fs.readFile(path.join(root, "tests/deliver-thursday.experience.json"), "utf8")));
    expect(runExperienceScenario(definition, scenario)).toMatchObject({ ok: true });
    // 期待と違えば、その手順の番号で失敗する
    const wrong = { ...scenario, steps: scenario.steps.map((s, i) => i === 3 ? { ...s, expect: { paths: { eighthDay: false } } } : s) };
    expect(runExperienceScenario(definition, wrong)).toMatchObject({ ok: false, failedStep: 3 });
  });
});

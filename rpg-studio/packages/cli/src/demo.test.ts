import path from "node:path";
import { describe, expect, it } from "vitest";
import { demoContent, DEMO_ENDING_ID, loadProjectContent } from "../../schema/src/index";
import { createEngine } from "../../engine/src/index";
import { loadSystems } from "./index";
import { loadProjectFromDisk } from "./load";

const root = path.resolve(__dirname, "../../../projects/sample-rpg");

describe("体験版", () => {
  it("endWhen が成り立つと「体験版はここまで」のエンディングになり、完成版はそのまま", async () => {
    const loaded = await loadProjectFromDisk(root);
    const project = JSON.parse(loaded.texts["project.json"]!);
    project.demo = { endWhen: { flag: "beastPathUnlocked" } };
    const content = loadProjectContent({ ...loaded.texts, "project.json": JSON.stringify(project) }).content!;
    const demo = demoContent(content);
    expect(demo.project.title).toMatch(/体験版/);
    expect(content.project.title).not.toMatch(/体験版/);
    const engine = createEngine(demo, await loadSystems(root, demo));
    let state = engine.newGame(1);
    while (state.scene.kind === "message") state = engine.step(state, { type: "advance" }).state;
    state = engine.step(state, { type: "choose", choiceId: "human" }).state;
    while (state.scene.kind === "message") state = engine.step(state, { type: "advance" }).state;
    expect(state.scene.kind).toBe("field");
    state = engine.step({ ...state, flags: { ...state.flags, beastPathUnlocked: true } }, { type: "move", direction: "up" }).state;
    expect(state.scene).toMatchObject({ kind: "ending", ending: DEMO_ENDING_ID });
    // 条件の参照先は検証される
    project.demo = { endWhen: { flag: "no-such-flag" } };
    const bad = loadProjectContent({ ...loaded.texts, "project.json": JSON.stringify(project) });
    expect(bad.diagnostics.some(d => d.at === "demo.endWhen")).toBe(true);
  });
});

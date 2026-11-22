import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEngine, type Action } from "../../../packages/engine/src/index";
import { runScenario, ScenarioSchema } from "../../../packages/engine/src/scenario";
import { REPO_ROOT } from "../../../packages/cli/src/build";
import { loadSystems } from "../../../packages/cli/src/index";
import { loadProjectFromDisk } from "../../../packages/cli/src/load";
import { actionsToSteps, finalExpect } from "./recorder";

describe("recording play as a scenario test", () => {
  it("replaying the recorded steps reaches the same final state", async () => {
    const root = path.join(REPO_ROOT, "projects/sample-rpg");
    const content = (await loadProjectFromDisk(root)).content!;
    const systems = await loadSystems(root, content);
    const engine = createEngine(content, systems);
    // A short session as the studio would dispatch it (same seed as the recorder uses).
    let state = engine.newGame(1);
    const actions: Action[] = [];
    const act = (a: Action) => { actions.push(a); state = engine.step(state, a).state; };
    for (let i = 0; i < 20 && state.scene.kind !== "prompt"; i++) act({ type: "advance" });
    act({ type: "choose", choiceId: "dwarf" });
    for (let i = 0; i < 20 && state.scene.kind !== "field"; i++) act({ type: "advance" });
    for (const d of ["down", "down", "right", "right", "right", "up"] as const) act({ type: "move", direction: d });
    act({ type: "tick" }); act({ type: "tick" });
    act({ type: "interact" });
    for (let i = 0; i < 10 && state.scene.kind !== "field"; i++) act({ type: "advance" });
    const { steps, skipped } = actionsToSteps(actions);
    expect(skipped).toBe(0);
    expect(steps.some(s => s.times !== undefined)).toBe(true); // consecutive moves were merged
    const scenario = ScenarioSchema.parse({ name: "recorded", seed: 1, steps: [...steps, finalExpect(state, content)] });
    const result = runScenario(content, systems, scenario);
    expect(result.ok, result.message).toBe(true);
  });
});

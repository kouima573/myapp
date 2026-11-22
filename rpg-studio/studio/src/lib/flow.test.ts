import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../packages/cli/src/build";
import { loadProjectFromDisk } from "../../../packages/cli/src/load";
import { flowSources, flowTree, type FlowNode } from "./flow";

const flat = (n: FlowNode, depth = 0): string[] => [`${"  ".repeat(depth)}${n.kind}:${n.label}${n.when ? ` [${n.when}]` : ""}`, ...n.children.flatMap(c => flat(c, depth + 1))];

describe("branch diagram of dialogues and events", () => {
  it("draws choices, conditions and where a dialogue starts, without looping forever", async () => {
    const loaded = await loadProjectFromDisk(path.join(REPO_ROOT, "projects/sample-rpg"));
    const content = loaded.content!;
    for (const id of Object.keys(content.dialogues)) {
      const lines = flat(flowTree(content, { kind: "dialogue", id }));
      expect(lines[0]).toMatch(/^dialogue:会話 /);
    }
    for (const id of Object.keys(content.events)) expect(flat(flowTree(content, { kind: "event", id }))[0]).toMatch(/^event:イベント /);
    const withChoices = Object.values(content.dialogues).find(d => d.choices.length)!;
    const text = flat(flowTree(content, { kind: "dialogue", id: withChoices.id })).join("\n");
    expect(text).toContain("branch:選択肢");
    expect(text).toContain(`choice:${withChoices.choices[0]!.label}`);
    // A dialogue that calls itself back is shown once, then as a loop marker.
    const looping = { ...content, dialogues: { ...content.dialogues, a: { id: "a", speaker: "A", lines: ["…"], effects: [{ type: "dialogue" as const, dialogue: "a" }], choices: [] } } };
    expect(flat(flowTree(looping, { kind: "dialogue", id: "a" })).join("\n")).toContain("loop:↺ a に戻る");
    // Every dialogue the sample's NPCs use has a starting place.
    const npcDialogue = Object.values(content.maps).flatMap(m => m.npcs.flatMap(n => n.dialogues.map(d => d.dialogue)))[0]!;
    expect(flowSources(content, { kind: "dialogue", id: npcDialogue }).join()).toMatch(/マップ .* の人/);
  });
});

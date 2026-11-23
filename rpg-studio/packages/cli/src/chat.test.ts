import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyChangeSet, cardPack, fixPack, lookup, parseChangeSet, planPack, proposalChecks, readTodo, writeTodo } from "../../schema/src/index";
import { readProjectTexts } from "./load";
import { tryProposal } from "./chat";

const root = path.resolve(__dirname, "../../../projects/sample-rpg");
const answer = (body: object) => `はい、どうぞ。\n\`\`\`rpg-change\n${JSON.stringify(body)}\n\`\`\`\n`;

describe("チャットで作る（作業カード・依頼パック・取り込み）", () => {
  it("builds packs, applies a proposal, checks it and refuses broken ones", async () => {
    const { texts } = await readProjectTexts(root);
    texts["todo.json"] = writeTodo({ formatVersion: 1, cards: [{ id: "talk-cat", title: "村の猫と話す", goal: "話すとフラグが立つ", status: "todo", links: ["npc:village/cat", "dialogue:cat-talk", "dialogue:scout-dialog"], doneWhen: { test: "tests/cat.scenario.json" } }] });
    const pack = cardPack(texts, "talk-cat");
    expect(pack).toContain("### npc:village/cat\n（まだありません");
    expect(pack).toContain("\"id\": \"scout-dialog\""); // existing linked data is shown
    expect(pack).toContain("```rpg-change");
    expect(pack).toContain("setFlag"); // effect names come from the schema
    expect(planPack(texts)).toContain("talk-cat「村の猫と話す」");

    expect(parseChangeSet("なにもない").error).toBeTruthy();
    const set = parseChangeSet(answer({ card: "talk-cat", changes: [
      { op: "put", target: "flag:cat-met", value: { initial: false } },
      { op: "put", target: "npc:village/cat", value: { name: "ねこ", x: 4, y: 10, dialogues: [{ dialogue: "cat-talk" }] } },
      { op: "put", target: "dialogue:cat-talk", value: { speaker: "ねこ", lines: ["ニャー"], effects: [{ type: "setFlag", flag: "cat-met", value: true }] } },
      { op: "card", status: "done" },
    ] })).set!;
    const applied = applyChangeSet(texts, set);
    expect(applied.errors).toEqual([]);
    expect(applied.changed.sort()).toEqual(["dialogues/dialogues.json", "maps/village.json", "project.json", "todo.json"]);
    expect(lookup(applied.texts, "npc:village/cat")?.value).toMatchObject({ id: "cat", x: 4 });
    expect(readTodo(applied.texts).bundle.cards[0]!.status).toBe("done");
    // done needs the promised test
    expect(proposalChecks(applied.texts, set)[0]).toMatch(/cat\.scenario\.json/);
    expect(fixPack(texts, set, ["x"])).toContain("## 問題");

    // tryProposal validates: an undeclared flag is refused
    const bad = await tryProposal(root, texts, answer({ changes: [{ op: "put", target: "dialogue:cat-talk", value: { speaker: "ねこ", lines: ["ニャー"], effects: [{ type: "setFlag", flag: "nope", value: true }] } }] }));
    expect(bad.problems.join()).toMatch(/未宣言のフラグ 'nope'/);
    // and runs the scenario tests it brings
    const good = await tryProposal(root, texts, answer({ changes: [...set.changes.filter(c => c.op === "put"), { op: "put", target: "test:cat", value: { name: "猫", seed: 1, steps: [
      { advance: "all" }, { choose: "human" }, { advance: "all" }, { walkTo: { x: 4, y: 9 } }, { face: "down" }, { interact: true }, { advance: "all" }, { expect: { flags: { "cat-met": true } } },
    ] } }] }));
    expect(good.problems).toEqual([]);
    expect(good.changed).toContain("tests/cat.scenario.json");
  });
});

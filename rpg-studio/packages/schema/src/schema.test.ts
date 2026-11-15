import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readProjectTexts } from "../../cli/src/load";
import { loadProjectContent, migrateProjectV1toV2, migrateSaveV1toV2, type ProjectFileTexts } from "./index";

const root = path.resolve(__dirname, "../../..");
const sample = path.join(root, "projects/sample-rpg");
const v1Fixture = path.join(root, "tests/fixtures/v1-sample");

async function sampleTexts(): Promise<ProjectFileTexts> {
  return (await readProjectTexts(sample)).texts;
}

function edit(texts: ProjectFileTexts, file: string, recipe: (json: any) => void): ProjectFileTexts {
  const json = JSON.parse(texts[file]!);
  recipe(json);
  return { ...texts, [file]: JSON.stringify(json) };
}

describe("project format v2", () => {
  it("loads the sample without errors or warnings", async () => {
    const result = loadProjectContent(await sampleTexts());
    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.content!.maps)).toEqual(["village", "elder-house", "ruins"]);
  });

  it("reports cross-file mistakes with file and location", async () => {
    let texts = await sampleTexts();
    texts = edit(texts, "events/events.json", json => { json.events[1].effects[0].flag = "ruinsShortcutOpne"; });
    texts = edit(texts, "maps/village.json", json => { json.npcs[0].dialogues[1].dialogue = "missing-dialog"; json.rows[3] = json.rows[3].replace("*", "!"); });
    texts = edit(texts, "maps/ruins.json", json => { json.portals[0].targetMapId = "nowhere"; });
    const result = loadProjectContent(texts);
    expect(result.content).toBeNull();
    const messages = result.diagnostics.map(d => `${d.file} › ${d.at}: ${d.message}`);
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringMatching(/events\/events\.json › events\[open-ruins-shortcut\]\.effects\[0\]: 未宣言のフラグ 'ruinsShortcutOpne'/),
      expect.stringMatching(/maps\/village\.json › npcs\[scout\]\.dialogues\[1\]: 未定義の会話 'missing-dialog'/),
      expect.stringMatching(/maps\/village\.json › rows\[3\]: タイルセットにないコード '!'/),
      expect.stringMatching(/maps\/ruins\.json › portals\[ruins-to-village\]\.target: 出入口の行き先のマップ 'nowhere'/),
    ]));
  });

  it("refuses unknown and old formats without touching data", async () => {
    const texts = await sampleTexts();
    const future = loadProjectContent(edit(texts, "project.json", json => { json.formatVersion = 3; }));
    expect(future.diagnostics[0]!.message).toContain("未対応の制作データ形式");
    const old = loadProjectContent(edit(texts, "project.json", json => { json.formatVersion = 1; }));
    expect(old.diagnostics[0]!.message).toContain("rpg:migrate");
  });

  it("rejects bad shapes: wrong row length, entity out of bounds, broken JSON", async () => {
    let texts = await sampleTexts();
    texts = edit(texts, "maps/elder-house.json", json => { json.rows[2] = "hcc"; json.npcs[0].x = 40; });
    texts = { ...texts, "tiles.json": "{ broken" };
    const result = loadProjectContent(texts);
    const all = result.diagnostics.map(d => `${d.file}: ${d.message}`).join("\n");
    expect(all).toContain("maps/elder-house.json: 行2の文字数3がwidth(10)と一致しません");
    expect(all).toContain("elderの座標(40, 2)がマップ範囲外です");
    expect(all).toContain("tiles.json: JSONとして読めません");
  });
});

describe("v1 → v2 migration", () => {
  async function v1Texts() {
    const { texts, formatVersion } = await readProjectTexts(v1Fixture);
    expect(formatVersion).toBe(1);
    return texts;
  }

  it("produces a valid v2 project that keeps the v1 behaviour as data", async () => {
    const texts = await v1Texts();
    const result = migrateProjectV1toV2(texts);
    const migrated = { ...texts, ...result.files, "systems/abilities.ts": "export default {}" };
    const loaded = loadProjectContent(migrated);
    expect(loaded.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    const content = loaded.content!;
    expect(content.project.start).toEqual({ mapId: "village", x: 3, y: 9, facing: "down" });
    expect(content.tileset.tiles.find(t => t.code === "g")).toMatchObject({ passable: false, passableWhen: { flag: "ruinsShortcutOpen" } });
    expect(content.dialogues["scout-dialog"]!.choices[0]).toMatchObject({ once: true, effects: [{ type: "unlockAbility", ability: "beast-trail" }, { type: "setFlag", flag: "beastPathUnlocked" }] });
    expect(content.events["open-ruins-shortcut"]).toMatchObject({ when: { ability: "beast-trail" }, once: true });
    expect(result.manualSteps.join()).toContain("systems/*.ts");
  });

  it("is deterministic", async () => {
    const texts = await v1Texts();
    expect(migrateProjectV1toV2(texts)).toEqual(migrateProjectV1toV2(texts));
  });

  it("refuses non-v1 input", async () => {
    const texts = await sampleTexts();
    expect(() => migrateProjectV1toV2(texts)).toThrow(/formatVersion=1/);
  });

  it("migrates a v1 player save", async () => {
    const texts = await v1Texts();
    const content = loadProjectContent({ ...texts, ...migrateProjectV1toV2(texts).files, "systems/abilities.ts": "" }).content!;
    const save = migrateSaveV1toV2({
      formatVersion: 1, projectId: "sample-rpg", savedAt: "2026-11-13T00:00:00.000Z",
      state: { mapId: "ruins", player: { x: 9, y: 6, hp: 7, maxHp: 18 }, abilities: ["unyielding-soul", "beast-trail"], flags: { beastPathUnlocked: true, ruinsShortcutOpen: true }, completedEvents: ["scout-dialog", "open-ruins-shortcut"], battle: { active: false, enemyHp: 12, enemyMaxHp: 12, unyieldingUsed: false } },
    }, content);
    expect(save.formatVersion).toBe(2);
    expect(save.state.done).toEqual(["open-ruins-shortcut", "scout-dialog/learn-trail"]);
    expect(save.state.player).toMatchObject({ x: 9, y: 6, hp: 7 });
  });

  it("keeps the v1 fixture files byte-identical (migration is pure)", async () => {
    const before = fs.readFileSync(path.join(v1Fixture, "project.json"), "utf8");
    migrateProjectV1toV2(await v1Texts());
    expect(fs.readFileSync(path.join(v1Fixture, "project.json"), "utf8")).toBe(before);
  });
});

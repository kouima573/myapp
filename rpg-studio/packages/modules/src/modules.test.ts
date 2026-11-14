import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadProjectFromDisk } from "../../cli/src/load";
import type { GameContent, GameState } from "../../schema/src/index";
import { createEngine } from "../../engine/src/index";
import type { SceneDefinition } from "../../engine/src/systems";
import { moduleDiagnostics, withModules, MODULES } from "./index";
import shooter, { simulate, type ShooterData } from "./shooter";
import cards, { endTurn, playCard, type CardsData } from "./cards";
import puzzle, { checkPushLevel } from "./puzzle";
import novel from "./novel";
import planner from "./planner";

const root = path.resolve(__dirname, "../../../projects/sample-rpg");
let content: GameContent;
let state: GameState;

beforeAll(async () => {
  content = (await loadProjectFromDisk(root)).content!;
  state = createEngine(content, withModules(content, [])).newGame(1);
});
const ctx = () => ({ content, state });
const sceneOf = (s: unknown) => s as SceneDefinition;

describe("genre modules", () => {
  it("registers every module with a scene", () => {
    for (const [id, info] of Object.entries(MODULES)) {
      expect(info.system.id).toBe(id);
      expect(Object.keys(info.system.scenes ?? {}).length).toBeGreaterThan(0);
    }
  });

  it("sample project has no module diagnostics", () => {
    expect(moduleDiagnostics(content)).toEqual([]);
  });

  it("reports disabled / unknown modules and bad args", () => {
    const broken: GameContent = {
      ...content,
      project: { ...content.project, modules: { puzzle: {}, nope: {} } },
      maps: { ...content.maps, village: { ...content.maps.village!, entities: [...content.maps.village!.entities, { id: "bad", x: 0, y: 0, states: [{ trigger: "action", effects: [
        { type: "startScene", system: "novel", scene: "play", args: { script: [{ text: "a" }] } },
        { type: "startScene", system: "puzzle", scene: "push", args: { rows: ["#@$#"] } },
        { type: "startScene", system: "puzzle", scene: "slide", args: {} },
      ] }] } as never] } },
    };
    const messages = moduleDiagnostics(broken).map(d => d.message).join("\n");
    expect(messages).toContain("'nope'");
    expect(messages).toContain("'novel' が project.json の modules で有効になっていません");
    expect(messages).toContain("数(1)と目標");
    expect(messages).toContain("画面 'slide'");
  });

  it("puzzle level check", () => {
    expect(checkPushLevel(["#####", "#@$.#", "#####"])).toEqual([]);
    expect(checkPushLevel(["#@@x#"]).length).toBeGreaterThan(1);
    const scene = sceneOf(puzzle.scenes!.push!);
    let data: unknown = scene.start!(ctx(), { rows: ["#####", "#@$.#", "#####"] });
    data = scene.input(ctx(), data, { type: "left" }).data ?? data; // blocked by wall
    const solved = scene.input(ctx(), data, { type: "right" });
    expect(solved.close).toBe(true);
  });

  it("novel validates labels and jumps", () => {
    const scene = sceneOf(novel.scenes!.play!);
    expect(scene.checkArgs!({ script: [{ text: "a", jump: "missing" }] }, { content })).toEqual([expect.stringContaining("missing")]);
    let data: unknown = scene.start!(ctx(), { script: [{ text: "a", jump: "end" }, { text: "skipped" }, { label: "end", text: "b", effects: [{ type: "setFlag", flag: "x", value: true }] }] });
    const r = scene.input(ctx(), data, { type: "confirm" });
    data = r.data;
    expect((data as { i: number }).i).toBe(2);
    expect(r.apply).toEqual([{ type: "setFlag", flag: "x", value: true }]);
    expect(scene.input(ctx(), data, { type: "confirm" }).close).toBe(true);
  });

  it("planner applies effects each turn and onEnd at the last", () => {
    const scene = sceneOf(planner.scenes!.schedule!);
    let data: unknown = scene.start!(ctx(), { turns: 2, activities: [{ id: "a", label: "A", effects: [{ type: "setVar", var: "skill", op: "add", value: 1 }] }], onEnd: [{ type: "message", text: "end" }] });
    const first = scene.input(ctx(), data, { type: "confirm" });
    expect(first.apply).toHaveLength(1);
    data = first.data;
    const last = scene.input(ctx(), data, { type: "confirm" });
    expect(last.close).toBe(true);
    expect(last.effects).toEqual([{ type: "message", text: "end" }]);
  });

  it("cards: play and end turn", () => {
    const scene = cards.scenes!.battle!;
    let d = scene.start(ctx(), { enemyId: "training-dummy", hpScale: 2 }) as CardsData;
    expect(d.hand.length).toBe(d.args.handSize);
    const hp = d.enemyHp;
    const strike = d.hand.indexOf("strike");
    if (strike >= 0) { d = playCard(ctx(), d, strike); expect(d.enemyHp).toBeLessThan(hp); }
    d = endTurn(ctx(), d);
    expect(d.turn).toBe(2);
    expect(d.energy).toBe(d.args.energy);
  });

  it("shooter simulation is deterministic and firing wins", () => {
    const scene = shooter.scenes!.battle!;
    const start = scene.start(ctx(), { enemyId: "will-o-wisp", hpScale: 4, phases: content.database.enemies.find(e => e.id === "will-o-wisp")!.battle!.args.phases }) as ShooterData;
    const run = () => { let d = start; for (let i = 0; i < 400; i++) d = simulate(ctx(), d, ["fire", i % 120 < 60 ? "left" : "right"]); return d; };
    const a = run(), b = run();
    expect(a).toEqual(b);
    expect(a.enemyHp).toBeLessThan(start.enemyHp);
  });
});

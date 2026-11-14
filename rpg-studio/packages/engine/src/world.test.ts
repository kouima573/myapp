import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadProjectFromDisk } from "../../cli/src/load";
import { loadSystems } from "../../cli/src/index";
import type { GameContent, GameMap, GameState } from "../../schema/src/index";
import { createEngine, defineSystem, type Engine, type GameSystem } from "./index";

const root = path.resolve(__dirname, "../../../projects/sample-rpg");
let content: GameContent;
let systems: GameSystem[];

beforeAll(async () => {
  const loaded = await loadProjectFromDisk(root);
  content = loaded.content!;
  systems = await loadSystems(root, content);
});

function withMap(mapId: string, patch: (m: GameMap) => GameMap, extra: Partial<GameContent> = {}, extraSystems: GameSystem[] = []): Engine {
  return createEngine({ ...content, ...extra, maps: { ...content.maps, [mapId]: patch(content.maps[mapId]!) } }, [...systems, ...extraSystems]);
}
function begin(engine: Engine, at: { mapId: string; x: number; y: number }): GameState {
  let s = engine.newGame(1);
  while (s.scene.kind === "message") s = engine.step(s, { type: "advance" }).state;
  s = engine.step(s, { type: "choose", choiceId: "dwarf" }).state;
  while (s.scene.kind === "message") s = engine.step(s, { type: "advance" }).state;
  s = engine.run(s, [{ type: "teleport", mapId: at.mapId, x: at.x, y: at.y }]).state;
  while (s.scene.kind === "message") s = engine.step(s, { type: "advance" }).state;
  return s;
}

describe("entities", () => {
  it("switch state by condition and disappear when no state matches", () => {
    const engine = withMap("village", m => ({ ...m, entities: [...m.entities, { id: "ghost", name: "幽霊", x: 3, y: 10, states: [
      { when: { flag: "veteran" }, marker: "statue", solid: true, trigger: "action", effects: [{ type: "message", text: "強くなったな" }], behavior: { type: "still" } },
      { when: { not: { flag: "questComplete" } }, marker: "sparkle", solid: false, trigger: "touch", effects: [{ type: "message", text: "ひやり" }], behavior: { type: "still" } },
    ] }] }));
    let s = begin(engine, { mapId: "village", x: 3, y: 9 });
    expect(engine.visibleEntities(s).find(e => e.entity.id === "ghost")?.index).toBe(1);
    s = engine.step(s, { type: "move", direction: "down" }).state;
    expect(s.scene).toMatchObject({ kind: "message", text: "ひやり" });
    s = engine.step(s, { type: "advance" }).state;
    s = engine.run(s, [{ type: "setFlag", flag: "veteran" }]).state;
    expect(engine.visibleEntities(s).find(e => e.entity.id === "ghost")?.index).toBe(0);
    s = engine.run(s, [{ type: "setFlag", flag: "veteran", value: false }, { type: "setFlag", flag: "questComplete" }]).state;
    expect(engine.visibleEntities(s).some(e => e.entity.id === "ghost")).toBe(false);
  });

  it("chasers approach on ticks and trigger when they reach the player; patrols follow their path", () => {
    const engine = withMap("village", m => ({ ...m, entities: [...m.entities,
      { id: "hound", name: "猟犬", x: 8, y: 9, states: [{ marker: "sparkle", solid: true, trigger: "touch", effects: [{ type: "message", text: "捕まった！" }], behavior: { type: "chase", range: 6, every: 1 } }] },
      { id: "sentry", name: "見張り", x: 2, y: 12, states: [{ marker: "statue", solid: true, trigger: "none", effects: [], behavior: { type: "patrol", path: [{ x: 4, y: 12 }, { x: 2, y: 12 }], every: 1 } }] },
    ] }));
    let s = begin(engine, { mapId: "village", x: 3, y: 9 });
    for (let i = 0; i < 6 && s.scene.kind === "field"; i++) s = engine.step(s, { type: "tick" }).state;
    expect(s.scene).toMatchObject({ kind: "message", text: "捕まった！" });
    const sentry = engine.visibleEntities(s).find(e => e.entity.id === "sentry")!;
    expect(sentry.x).toBeGreaterThan(2);
  });

  it("wanderers stay within their radius and never walk through walls", () => {
    let s = begin(createEngine(content, systems), { mapId: "village", x: 3, y: 9 });
    const engine = createEngine(content, systems);
    for (let i = 0; i < 200; i++) s = engine.step(s, { type: "tick" }).state;
    const tet = engine.visibleEntities(s).find(e => e.entity.id === "apprentice")!;
    expect(Math.abs(tet.x - 11) + Math.abs(tet.y - 11)).toBeLessThanOrEqual(2);
    expect(engine.isPassable({ ...s, entities: {} }, tet.x, tet.y)).toBe(true);
  });
});

describe("world rules", () => {
  it("regions fire onEnter / onLeave and are usable in conditions", () => {
    const engine = withMap("village", m => ({ ...m, regions: [{ id: "plaza", x: 8, y: 8, w: 6, h: 3, onEnter: [{ type: "setVar", var: "loot", op: "add", value: 1 }], onLeave: [{ type: "setVar", var: "loot", op: "add", value: 10 }], onStep: [], inspect: [{ type: "message", text: "広場だ" }] }] }));
    let s = begin(engine, { mapId: "village", x: 7, y: 9 });
    s = engine.step(s, { type: "move", direction: "right" }).state;
    expect(s.vars.loot).toBe(1);
    expect(engine.evaluate({ inRegion: "plaza" }, s)).toBe(true);
    s = engine.step(s, { type: "face", direction: "down" }).state;
    s = engine.step(s, { type: "interact" }).state;
    expect(s.scene).toMatchObject({ kind: "message", text: "広場だ" });
    s = engine.step(engine.step(s, { type: "advance" }).state, { type: "move", direction: "left" }).state;
    expect(s.vars.loot).toBe(11);
  });

  it("scheduled effects fire after N steps and can be cancelled", () => {
    const engine = createEngine(content, systems);
    let s = begin(engine, { mapId: "village", x: 3, y: 9 });
    s = engine.run(s, [{ type: "schedule", id: "bell", after: 3, effects: [{ type: "setFlag", flag: "veteran" }] }, { type: "schedule", id: "never", after: 2, effects: [{ type: "setFlag", flag: "questComplete" }] }, { type: "cancelSchedule", id: "never" }]).state;
    for (const dir of ["right", "right", "left"] as const) s = engine.step(s, { type: "move", direction: dir }).state;
    expect(s.flags.veteran).toBe(true);
    expect(s.flags.questComplete).toBe(false);
  });

  it("battle maths can be replaced by expressions and commands switched off", () => {
    const battle = { ...content.project.battle, playerDamage: { mul: [{ ctx: "attack" as const }, 10] }, commands: { ...content.project.battle.commands, flee: false } };
    const engine = createEngine({ ...content, project: { ...content.project, battle } }, systems);
    let s = engine.run(begin(engine, { mapId: "village", x: 3, y: 9 }), [{ type: "battle", enemy: "moss-slime" }]).state;
    s = engine.step(s, { type: "battle", command: "attack" }).state;
    expect(s.scene.kind === "battle" && s.scene.battle.outcome).toBe("victory");
    s = engine.run(engine.step(s, { type: "advance" }).state, []).state;
    while (s.scene.kind === "message") s = engine.step(s, { type: "advance" }).state;
    s = engine.run(s, [{ type: "battle", enemy: "moss-slime" }]).state;
    s = engine.step(s, { type: "battle", command: "flee" }).state;
    expect(s.scene.kind === "battle" && s.scene.battle.log.at(-1)).toBe("そのコマンドは使えない。");
  });

  it("projects can add their own conditions and expression functions", () => {
    const custom = defineSystem({
      id: "weather",
      conditions: { raining: ({ state }) => state.steps % 2 === 1 },
      functions: { double: (_ctx, [n]) => (n ?? 0) * 2 },
    });
    const engine = createEngine({ ...content, project: { ...content.project, systems: [...content.project.systems, { id: "weather", path: "systems/weather.ts", title: "天気" }] } }, [...systems, custom]);
    let s = begin(engine, { mapId: "village", x: 3, y: 9 });
    expect(engine.evaluate({ custom: "weather.raining" }, s)).toBe(false);
    s = engine.step(s, { type: "move", direction: "right" }).state;
    expect(engine.evaluate({ custom: "weather.raining" }, s)).toBe(true);
    s = engine.run(s, [{ type: "setVar", var: "gold", value: { fn: "weather.double", args: [21] } }]).state;
    expect(s.vars.gold).toBe(42);
  });
});

describe("memory across cycles", () => {
  it("newCycle keeps meta sets, endings and the cycle number, and resets the run", () => {
    const engine = createEngine(content, systems);
    let s = begin(engine, { mapId: "village", x: 3, y: 9 });
    s = engine.run(s, [{ type: "addToSet", set: "memories", value: "rune-code" }, { type: "addToSet", set: "clues", value: "ancient-script" }, { type: "setVar", var: "gold", value: 99 }, { type: "ending", ending: "wind" }]).state;
    expect(s.scene.kind).toBe("ending");
    const meta = engine.metaOf(s);
    expect(meta.sets).toEqual({ memories: ["rune-code"], endings: ["wind"] });
    s = engine.step(s, { type: "advance" }).state;
    expect(s.cycle).toBe(2);
    expect(s.sets.memories).toEqual(["rune-code"]);
    expect(s.sets.clues).toEqual([]);
    expect(s.vars.gold).toBe(0);
    // A new game started from stored meta (the runtime does this on load) also remembers.
    const restarted = engine.newGame(5, meta);
    expect(restarted.sets.endings).toEqual(["wind"]);
    expect(engine.text(restarted, "{{set.memories}}")).toContain("風 → 星 → 岩");
  });
});

describe("v0.7: verbs, signals, onAction", () => {
  it("onAction can mirror the controls and swallow actions", () => {
    const mirror = defineSystem({
      id: "mirror",
      onAction(_ctx, action) {
        if (action.type === "move") return { action: { type: "move", direction: action.direction === "left" ? "right" : action.direction === "right" ? "left" : action.direction } };
        if (action.type === "interact") return { cancel: true, effects: [{ type: "message", text: "鏡の世界では調べられない" }] };
      },
    });
    const engine = createEngine(content, [...systems, mirror]);
    let s = begin(engine, { mapId: "village", x: 3, y: 12 });
    s = engine.step(s, { type: "move", direction: "left" }).state;
    expect(s.player.x).toBe(4);
    s = engine.step(s, { type: "interact" }).state;
    expect(s.scene).toMatchObject({ kind: "message", text: "鏡の世界では調べられない" });
  });

  it("signals reach every listening rule and stop endless chains", () => {
    const project = { ...content.project, signals: { ping: {}, pong: {} } };
    const loop = [
      { id: "a", on: "signal" as const, match: "ping", repeat: false, priority: 0, effects: [{ type: "signal" as const, signal: "pong" }] },
      { id: "b", on: "signal" as const, match: "pong", repeat: false, priority: 0, effects: [{ type: "signal" as const, signal: "ping" }] },
    ];
    const engine = createEngine({ ...content, project, rules: [...content.rules, ...loop] }, systems);
    const s = begin(engine, { mapId: "village", x: 3, y: 12 });
    expect(() => engine.run(s, [{ type: "startScene", system: "planner", scene: "schedule", args: { turns: 1, activities: [{ id: "x", label: "x", effects: [{ type: "signal", signal: "ping" }] }] } }])).not.toThrow();
    const opened = engine.run(s, [{ type: "startScene", system: "planner", scene: "schedule", args: { turns: 1, activities: [{ id: "x", label: "x", effects: [{ type: "signal", signal: "ping" }] }] } }]).state;
    expect(() => engine.step(opened, { type: "sceneInput", input: { type: "confirm" } })).toThrow(/32段/);
  });

  it("front condition and setPlayer survive save/load", () => {
    const engine = createEngine(content, systems);
    let s = begin(engine, { mapId: "village", x: 14, y: 6 });
    s = { ...s, player: { ...s.player, facing: "right" } };
    expect(engine.evaluate({ front: { tile: "~", blocked: true } }, s)).toBe(true);
    expect(engine.evaluate({ front: { tile: "." } }, s)).toBe(false);
    s = engine.run(s, [{ type: "setPlayer", name: "影", sprite: "village-guard" }]).state;
    expect(s.player).toMatchObject({ name: "影", sprite: "village-guard" });
    s = engine.run(s, [{ type: "setPlayer", name: null }]).state;
    expect(s.player.name).toBeUndefined();
    expect(s.player.sprite).toBe("village-guard");
  });
});

describe("pushing, carrying and cross-map entities", () => {
  const boulder = { id: "boulder", name: "岩", x: 4, y: 12, states: [{ marker: "statue" as const, solid: true, trigger: "none" as const, effects: [], behavior: { type: "still" as const }, pushable: true, onMoved: [{ type: "if" as const, when: { entityAt: { entity: "boulder", x: 6, y: 12 } }, then: [{ type: "message" as const, text: "カチリ" }] }] }] };
  const crate = { id: "crate", name: "箱", x: 3, y: 10, states: [{ marker: "chest" as const, solid: true, trigger: "none" as const, effects: [], behavior: { type: "still" as const }, carryable: true }] };

  it("walking into a pushable entity pushes it; onMoved sees where it went", () => {
    const engine = withMap("village", m => ({ ...m, entities: [...m.entities, boulder] }));
    let s = begin(engine, { mapId: "village", x: 3, y: 12 });
    s = engine.step(s, { type: "move", direction: "right" }).state;
    expect(engine.visibleEntities(s).find(e => e.entity.id === "boulder")).toMatchObject({ x: 5, y: 12 });
    expect(s.player.x).toBe(4);
    s = engine.step(s, { type: "move", direction: "right" }).state;
    expect(s.scene).toMatchObject({ kind: "message", text: "カチリ" });
    expect(engine.evaluate({ entityAt: { entity: "boulder", x: 6, y: 12 } }, s)).toBe(true);
  });

  it("carries an entity to another map and puts it down there", () => {
    const engine = withMap("village", m => ({ ...m, entities: [...m.entities, crate] }));
    let s = begin(engine, { mapId: "village", x: 3, y: 11 });
    s = { ...s, player: { ...s.player, facing: "up" } };
    s = engine.step(s, { type: "interact" }).state;
    expect(s.carrying).toEqual({ id: "crate", home: "village" });
    expect(engine.visibleEntities(s).some(e => e.entity.id === "crate")).toBe(false);
    expect(engine.evaluate({ carrying: "crate" }, s)).toBe(true);
    s = engine.run(s, [{ type: "teleport", mapId: "ruins", x: 2, y: 11, facing: "right" }]).state;
    while (s.scene.kind === "message") s = engine.step(s, { type: "advance" }).state;
    s = engine.step(s, { type: "interact" }).state;
    expect(s.carrying).toBeUndefined();
    expect(engine.visibleEntities(s).find(e => e.entity.id === "crate")).toMatchObject({ x: 3, y: 11 });
    expect(engine.evaluate({ entityAt: { entity: "crate", map: "ruins", x: 3, y: 11 } }, s)).toBe(true);
    const back = engine.run(s, [{ type: "teleport", mapId: "village", x: 3, y: 11 }]).state;
    expect(engine.visibleEntities(back).some(e => e.entity.id === "crate")).toBe(false);
  });

  it("moveEntity can send an entity to another map", () => {
    const engine = withMap("village", m => ({ ...m, entities: [...m.entities, crate] }));
    let s = begin(engine, { mapId: "ruins", x: 2, y: 11 });
    s = engine.run(s, [{ type: "moveEntity", entity: "crate", mapId: "ruins", x: 5, y: 11 }]).state;
    expect(engine.visibleEntities(s).find(e => e.entity.id === "crate")).toMatchObject({ x: 5, y: 11 });
  });
});

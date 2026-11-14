import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadProjectFromDisk } from "../../cli/src/load";
import type { Direction, GameContent, GameState } from "../../schema/src/index";
import sampleSystem from "../../../projects/sample-rpg/systems/abilities";
import { createEngine, DELTAS, makeSave, readSave, type Engine } from "./index";

let content: GameContent;
let engine: Engine;

beforeAll(async () => {
  const loaded = await loadProjectFromDisk(path.resolve(__dirname, "../../../projects/sample-rpg"));
  expect(loaded.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  content = loaded.content!;
  engine = createEngine(content, [sampleSystem]);
});

/** Shortest path on the current map using the engine's own passability. */
function route(state: GameState, target: { x: number; y: number }): Direction[] {
  const map = content.maps[state.mapId]!;
  const key = (x: number, y: number) => `${x},${y}`;
  const prev = new Map<string, { from: string; dir: Direction }>();
  const queue = [{ x: state.player.x, y: state.player.y }];
  const seen = new Set([key(state.player.x, state.player.y)]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.x === target.x && cur.y === target.y) break;
    for (const dir of ["up", "down", "left", "right"] as Direction[]) {
      const nx = cur.x + DELTAS[dir].x, ny = cur.y + DELTAS[dir].y;
      if (seen.has(key(nx, ny)) || nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const isTarget = nx === target.x && ny === target.y;
      if (!isTarget && !engine.isPassable(state, nx, ny)) continue;
      if (map.portals.some(p => p.x === nx && p.y === ny) && !isTarget) continue;
      seen.add(key(nx, ny));
      prev.set(key(nx, ny), { from: key(cur.x, cur.y), dir });
      queue.push({ x: nx, y: ny });
    }
  }
  const dirs: Direction[] = [];
  let k = key(target.x, target.y);
  if (!prev.has(k)) throw new Error(`no route to ${k} on ${state.mapId}`);
  while (prev.has(k)) { const p = prev.get(k)!; dirs.unshift(p.dir); k = p.from; }
  return dirs;
}

function winBattle(state: GameState): GameState {
  let guard = 0;
  while (state.scene.kind === "battle" && state.scene.battle.outcome === "ongoing") {
    if (++guard > 50) throw new Error("battle did not end");
    state = engine.step(state, { type: "battle", command: "attack" }).state;
  }
  if (state.scene.kind === "battle" && state.scene.battle.outcome === "defeat") throw new Error("lost a random battle");
  return engine.step(state, { type: "advance" }).state;
}

/** Walks to a cell, fighting random encounters on the way. */
function walkTo(state: GameState, target: { x: number; y: number }): GameState {
  for (let attempts = 0; attempts < 20; attempts++) {
    for (const dir of route(state, target)) {
      const before = state.mapId;
      state = engine.step(state, { type: "move", direction: dir }).state;
      if (state.scene.kind === "battle") { state = winBattle(engine.run(state, [{ type: "heal" }]).state); break; }
      if (state.mapId !== before) return state;
    }
    if (state.player.x === target.x && state.player.y === target.y) return state;
  }
  throw new Error("could not reach target");
}

function face(state: GameState, direction: Direction) { return engine.step(state, { type: "face", direction }).state; }
function advanceAll(state: GameState): GameState {
  let guard = 0;
  while (state.scene.kind === "message" || state.scene.kind === "dialogue") {
    if (++guard > 50) throw new Error("stuck in text");
    state = engine.step(state, { type: "advance" }).state;
  }
  return state;
}

describe("data-driven engine", () => {
  it("starts from project.json, not from engine constants", () => {
    const state = engine.newGame();
    expect(state.mapId).toBe("village");
    expect(state.player).toMatchObject({ x: 3, y: 9, hp: 18 });
    expect(state.flags).toEqual({ beastPathUnlocked: false, ruinsShortcutOpen: false, sentinelCalmed: false, questComplete: false });
    expect(state.abilities).toEqual(["unyielding-soul"]);
  });

  it("blocks the beast-trail gap until the event opens it, and the event needs the ability", () => {
    let state = engine.run(engine.newGame(), [{ type: "teleport", mapId: "ruins", x: 9, y: 9 }]).state;
    expect(engine.isPassable(state, 9, 8)).toBe(false);
    state = engine.step(face(state, "up"), { type: "interact" }).state;
    expect(state.scene).toMatchObject({ kind: "message", text: expect.stringContaining("通れそうにない") });
    state = advanceAll(state);
    expect(state.flags.ruinsShortcutOpen).toBe(false);
    expect(state.done).not.toContain("open-ruins-shortcut");
  });

  it("does not let a second lethal blow in the same battle be saved", () => {
    let state = engine.run(engine.newGame(), [{ type: "battle", enemy: "stone-sentinel", onDefeat: "continue" }]).state;
    // Attacking blindly: the turn-2 heavy blow is lethal and saved once; the turn-5 one is not.
    const notes: string[] = [];
    for (let i = 0; i < 8 && state.scene.kind === "battle" && state.scene.battle.outcome === "ongoing"; i++) {
      state = engine.step(state, { type: "battle", command: "attack" }).state;
      if (state.scene.kind === "battle") notes.push(...state.scene.battle.log);
    }
    expect(notes.join("\n")).toContain("不屈の魂");
    expect(state.scene.kind === "battle" && state.scene.battle.outcome).toBe("defeat");
    expect(state.scene.kind === "battle" && state.scene.battle.systemData["sample-abilities"]).toEqual({ unyieldingUsed: true });
    // A new battle resets the once-per-battle state.
    state = engine.step(state, { type: "advance" }).state;
    state = engine.run(state, [{ type: "heal" }, { type: "battle", enemy: "stone-sentinel" }]).state;
    expect(state.scene.kind === "battle" && state.scene.battle.systemData["sample-abilities"]).toEqual({ unyieldingUsed: false });
  });

  it("plays the whole sample: learn → shortcut → sentinel → save/restore → report", () => {
    let state = engine.newGame(7);

    // Learn the beast trail from Rio (5,8): stand below him and face up.
    state = walkTo(state, { x: 5, y: 9 });
    state = engine.step(face(state, "up"), { type: "interact" }).state;
    expect(state.scene).toMatchObject({ kind: "dialogue", dialogueId: "scout-dialog" });
    state = engine.step(engine.step(state, { type: "advance" }).state, { type: "advance" }).state;
    expect(state.scene.kind).toBe("choice");
    state = advanceAll(engine.step(state, { type: "choose", choiceId: "learn-trail" }).state);
    expect(state.abilities).toContain("beast-trail");
    expect(state.done).toContain("scout-dialog/learn-trail");

    // Talking again picks the conditional dialogue, and re-running the choice never duplicates the reward.
    state = engine.step(state, { type: "interact" }).state;
    expect(state.scene).toMatchObject({ kind: "dialogue", dialogueId: "rio-after" });
    state = advanceAll(state);
    const again = engine.run(state, [{ type: "dialogue", dialogue: "scout-dialog" }]).state;
    const chosen = engine.step(engine.step(engine.step(again, { type: "advance" }).state, { type: "advance" }).state, { type: "choose", choiceId: "learn-trail" });
    expect(chosen.log.join()).toContain("重複させません");
    expect(chosen.state.abilities.filter(a => a === "beast-trail")).toHaveLength(1);

    // Visit the elder for herbs.
    state = walkTo(state, { x: 8, y: 5 });
    expect(state.mapId).toBe("elder-house");
    state = walkTo(state, { x: 4, y: 3 });
    state = engine.step(face(state, "up"), { type: "interact" }).state;
    state = engine.step(engine.step(state, { type: "advance" }).state, { type: "advance" }).state;
    state = advanceAll(engine.step(state, { type: "choose", choiceId: "get-herbs" }).state);
    expect(state.items.herb).toBe(2);

    // Go to the ruins and open the gap.
    state = walkTo(state, { x: 4, y: 7 });
    expect(state.mapId).toBe("village");
    state = walkTo(state, { x: 18, y: 9 });
    expect(state.mapId).toBe("ruins");
    state = walkTo(state, { x: 9, y: 9 });
    state = advanceAll(engine.step(face(state, "up"), { type: "interact" }).state);
    expect(state.flags.ruinsShortcutOpen).toBe(true);
    expect(engine.isPassable(state, 9, 8)).toBe(true);
    expect(engine.tileIndex(state, engine.tileAt(content.maps.ruins!, 9, 8)!)).toBe(1);

    // Save in the field, then "restart" by restoring from JSON.
    const saved = JSON.parse(JSON.stringify(makeSave(content, state)));
    const restored = readSave(saved, content);
    expect(restored.ok).toBe(true);
    state = restored.ok ? restored.save.state : state;
    expect(state.flags.ruinsShortcutOpen).toBe(true);
    expect(state.abilities).toContain("beast-trail");

    // The shortcut leads straight to the sentinel.
    const shortcut = route(state, { x: 9, y: 6 });
    expect(shortcut.length).toBeLessThan(5);
    state = walkTo(state, { x: 9, y: 6 });
    state = engine.step(face(state, "up"), { type: "interact" }).state;
    state = engine.step(state, { type: "advance" }).state; // "石像の目に光が…"
    expect(state.scene.kind).toBe("battle");
    // Sensible play: guard after the wind-up telegraph, heal when low.
    for (let turn = 0; turn < 30 && state.scene.kind === "battle" && state.scene.battle.outcome === "ongoing"; turn++) {
      const log = state.scene.battle.log;
      const telegraphed = log.slice(-2).some(line => line.includes("ためて"));
      const action = telegraphed ? { command: "guard" as const }
        : state.player.hp <= 9 && (state.items.herb ?? 0) > 0 ? { command: "item" as const, item: "herb" } : { command: "attack" as const };
      state = engine.step(state, { type: "battle", ...action }).state;
    }
    expect(state.scene.kind === "battle" && state.scene.battle.outcome).toBe("victory");
    state = advanceAll(engine.step(state, { type: "advance" }).state);
    expect(state.flags.sentinelCalmed).toBe(true);
    expect(state.items["wind-shard"]).toBe(1);
    expect(state.done).toContain("sentinel-battle");
    expect(engine.visibleInteractables(state).some(i => i.id === "sentinel")).toBe(false);

    // Back to the village and report to the elder — reward only once.
    state = walkTo(state, { x: 9, y: 9 });
    state = walkTo(state, { x: 2, y: 9 });
    expect(state.mapId).toBe("village");
    state = walkTo(state, { x: 8, y: 5 });
    state = walkTo(state, { x: 4, y: 3 });
    state = advanceAll(engine.step(face(state, "up"), { type: "interact" }).state);
    expect(state.flags.questComplete).toBe(true);
    const herbs = state.items.herb ?? 0;
    state = advanceAll(engine.step(state, { type: "interact" }).state);
    expect(state.items.herb ?? 0).toBe(herbs);
  });

  it("is deterministic for the same seed and actions", () => {
    const play = () => {
      let s = engine.run(engine.newGame(99), [{ type: "battle", enemy: "cave-bat" }]).state;
      for (let i = 0; i < 4; i++) s = engine.step(s, { type: "battle", command: "attack" }).state;
      return s;
    };
    expect(play()).toEqual(play());
  });

  it("rejects saves from other projects or unknown formats without throwing", () => {
    const save = makeSave(content, engine.newGame());
    expect(readSave({ ...save, projectId: "other" }, content)).toMatchObject({ ok: false });
    expect(readSave({ ...save, formatVersion: 9 }, content)).toMatchObject({ ok: false, reason: expect.stringContaining("未対応") });
    expect(readSave("garbage", content)).toMatchObject({ ok: false });
    expect(() => makeSave(content, engine.run(engine.newGame(), [{ type: "message", text: "x" }]).state)).toThrow();
  });
});

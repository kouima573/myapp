import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadProjectFromDisk } from "../../cli/src/load";
import type { GameContent, GameState } from "../../schema/src/index";
import { createEngine } from "../../engine/src/index";
import { withModules } from "./index";
import { actionStatus, startAction, stepAction } from "./action";
import { fighterStatus, startFighter, stepFighter } from "./fighter";
import { build, defenseStatus, startDefense, stepDefense } from "./defense";
import { blocksStatus, resolveClears, startBlocks, stepBlocks } from "./blocks";
import { logicPress, logicSolved, startLogic, pictureClues } from "./logic";
import { physicsStatus, shoot, startPhysics, stepPhysics } from "./physics";
import { aimStatus, startAim, stepAim } from "./aim";
import { dungeonStatus, startDungeon, stepDungeon } from "./dungeon3d";
import { squadStatus, startSquad, stepSquad } from "./squad";
import { bet, compareHands, doSwap, scoreHand, startTable, type Card } from "./table";
import { melodyText, setNote, startComposer } from "./composer";
import { runProgram, ProgramArgsSchema } from "./program";
import { factoryStatus, setRecipe, startFactory, stepFactory } from "./factory";

let content: GameContent;
let state: GameState;
beforeAll(async () => {
  content = (await loadProjectFromDisk(path.resolve(__dirname, "../../../projects/sample-rpg"))).content!;
  state = createEngine(content, withModules(content, [])).newGame(1);
});
const ctx = () => ({ content, state });
function run<T>(d: T, step: (d: T, i: number) => T, status: (d: T) => string, max = 3000): [T, string] {
  let s = status(d);
  for (let i = 0; i < max && s === "playing"; i++) { d = step(d, i); s = status(d); }
  return [d, s];
}

describe("action: guns and stealth", () => {
  it("gun: shoots the chaser down from range", () => {
    const [, s] = run(startAction(ctx(), { view: "top", weapon: "gun", rows: ["##########", "#@      c#", "##########"], goal: "defeat", enemyHp: 10 }), d => stepAction(ctx(), d, ["fire"]), actionStatus, 600);
    expect(s).toBe("win");
  });
  it("stealth: a guard that faces you catches you; behind its back you are safe", () => {
    const [, caught] = run(startAction(ctx(), { view: "top", seen: "lose", rows: ["#########", "#@    g #", "#########"], goal: "exit" }), d => stepAction(ctx(), d, []), actionStatus, 60);
    expect(caught).toBe("lose");
    const [d, safe] = run(startAction(ctx(), { view: "top", seen: "lose", rows: ["##############", "#g        @  #", "#           G#", "##############"], goal: "exit" }), d => stepAction(ctx(), d, d.frame < 40 ? [] : ["down", "right"]), actionStatus, 200);
    expect(d.caught).toBe(false);
    expect(safe).toBe("win");
  });
});

describe("fighter", () => {
  it("hits land, the CPU loses HP, and the fight is deterministic", () => {
    const go = () => run(startFighter(ctx(), { opponent: { name: "木人", hp: 30, attack: 1 }, level: 1 }, false), (d, i) => stepFighter(d, i % 4 === 0 ? ["right", "fire"] : ["right"]), fighterStatus, 1800);
    const [a, s] = go();
    expect(a.p[1].hp).toBeLessThan(30);
    expect(go()[0]).toEqual(a);
    expect(s).toBe("win");
  });
  it("versus: player 2 is driven by p2 buttons", () => {
    const d = stepFighter(startFighter(ctx(), {}, true), ["p2left"]);
    expect(d.p[1].x).toBeLessThan(230);
  });
});

describe("defense", () => {
  it("towers along the road hold every wave", () => {
    let d = startDefense(ctx(), { rows: ["..........", "S========H", ".........."], gold: 200, waves: [{ count: 4, hp: 4, speed: 0.6, every: 30, reward: 1 }] });
    for (const x of [2, 4, 6]) d = build(d, x, 0);
    expect(d.towers.length).toBe(3);
    const [end, s] = run(d, x => stepDefense(x, []), defenseStatus);
    expect(s).toBe("win");
    expect(end.kills).toBe(4);
  });
  it("no towers: the base falls", () => {
    const [, s] = run(startDefense(ctx(), { rows: ["S==H", "...."], lives: 2, waves: [{ count: 3, hp: 5, speed: 2, every: 10, reward: 1 }] }), x => stepDefense(x, []), defenseStatus);
    expect(s).toBe("lose");
  });
});

describe("blocks", () => {
  it("clears groups of four and full rows", () => {
    const g = startBlocks(ctx(), { width: 4, height: 6, clear: "groups" });
    g.grid[5] = [1, 1, 1, 1];
    expect(resolveClears(g)).toBe(4);
    const r = startBlocks(ctx(), { width: 4, height: 6, clear: "rows" });
    r.grid[5] = [0, 1, 2, 3];
    expect(resolveClears(r)).toBe(1);
    expect(r.grid[5]).toEqual([-1, -1, -1, -1]);
  });
  it("hard-dropping forever eventually stacks up", () => {
    const [, s] = run(startBlocks(ctx(), { target: 999 }), (d, i) => stepBlocks(d, i % 2 ? ["fire"] : []), blocksStatus, 4000);
    expect(s).toBe("lose");
  });
});

describe("logic", () => {
  it("picture: filling the solution solves it; clues come from the drawing", () => {
    const solution = [".#.", "###", ".#."];
    expect(pictureClues(solution).rows).toEqual([[1], [3], [1]]);
    let d = startLogic({ kind: "picture", solution });
    solution.forEach((r, y) => Array.from(r).forEach((c, x) => { if (c === "#") d = logicPress(d, x, y); }));
    expect(logicSolved(d)).toBe(true);
  });
  it("lights and numbers", () => {
    expect(logicSolved(logicPress(startLogic({ kind: "lights", start: ["010", "111", "010"] }), 1, 1))).toBe(true);
    let n = startLogic({ kind: "numbers", givens: ["1.", ".."] });
    n = logicPress(n, 1, 0); n = logicPress(n, 1, 0);
    n = logicPress(n, 0, 1); n = logicPress(n, 0, 1);
    n = logicPress(n, 1, 1);
    expect(logicSolved(n)).toBe(true);
  });
});

describe("physics", () => {
  it("a straight putt sinks the ball", () => {
    let d = startPhysics({ view: "top", rows: ["#########", "#o.....O#", "#########"] });
    d = shoot({ ...d, angle: 0, power: 4 });
    const [, s] = run(d, x => stepPhysics(x, []), physicsStatus, 600);
    expect(s).toBe("win");
  });
  it("side view: gravity arcs the shot onto the target", () => {
    let best = "lose";
    for (let p = 3; p <= 9 && best !== "win"; p += 0.5) {
      let d = startPhysics({ view: "side", goal: "targets", shots: 1, rows: ["############", "#          #", "#          #", "#o        *#", "############"] });
      d = shoot({ ...d, angle: -0.5, power: p });
      best = run(d, x => stepPhysics(x, []), physicsStatus, 900)[1];
    }
    expect(best).toBe("win");
  });
});

describe("aim", () => {
  it("shooting every foe as it appears passes", () => {
    const [, s] = run(startAim(ctx(), { count: 8, ammo: 30 }), d => {
      const up = d.targets.find(t => t.state === "up" && t.kind !== "friend");
      return stepAim(ctx(), d, [], up && d.frame % 6 === 0 ? { x: up.x, y: up.y } : undefined);
    }, aimStatus);
    expect(s).toBe("win");
  });
});

describe("dungeon3d", () => {
  it("grid: two steps forward reach the exit", () => {
    let d = startDungeon(ctx(), { rows: ["#####", "#@.G#", "#####"], facing: "right" });
    d = stepDungeon(ctx(), d, ["up"]); d = stepDungeon(ctx(), d, []); d = stepDungeon(ctx(), d, ["up"]);
    expect(dungeonStatus(d)).toBe("win");
  });
  it("grid: monsters are fought with the sword", () => {
    const [, s] = run(startDungeon(ctx(), { rows: ["######", "#@.e.#", "######"], facing: "right", goal: "defeat", enemyHp: 8 }), (d, i) => stepDungeon(ctx(), d, i % 10 === 0 ? ["fire"] : []), dungeonStatus, 900);
    expect(s).toBe("win");
  });
});

describe("squad", () => {
  it("auto-battler: the stronger formation wins on its own", () => {
    const [, s] = run(startSquad(ctx(), { auto: true, rows: ["##########", "#@a    ee#", "#aa      #", "##########"], enemies: [{ name: "影", hp: 6, attack: 1 }] }), d => stepSquad(d, []), squadStatus);
    expect(s).toBe("win");
  });
  it("command: units only move when ordered", () => {
    let d = startSquad(ctx(), { rows: ["############", "#a        e#", "############"], enemies: [{ name: "影", hp: 1, attack: 0, speed: 0.01 }] });
    const x0 = d.units[0]!.x;
    d = stepSquad(d, [], { x: 1.5, y: 1.5 });
    d = stepSquad(d, [], { x: 9, y: 1.5 });
    const [end, s] = run(d, x => stepSquad(x, []), squadStatus, 2000);
    expect(end.units[0]!.x).toBeGreaterThan(x0);
    expect(s).toBe("win");
  });
});

describe("table", () => {
  it("ranks hands", () => {
    const hand = (...c: Card[]) => c;
    expect(scoreHand(hand([2, 0], [2, 1], [5, 2], [9, 3], [11, 0]))[0]).toBe(1);
    expect(scoreHand(hand([2, 0], [3, 0], [4, 0], [5, 0], [6, 0]))[0]).toBe(8);
    expect(scoreHand(hand([1, 0], [2, 1], [3, 2], [4, 3], [5, 0]))[0]).toBe(4);
    expect(compareHands(hand([13, 0], [13, 1], [2, 2], [3, 3], [4, 0]), hand([12, 0], [12, 1], [9, 2], [8, 3], [7, 0]))).toBeGreaterThan(0);
  });
  it("a round: swap, call, settle chips", () => {
    let d = startTable(ctx(), { rounds: 1, chips: 10, ante: 1 });
    d = doSwap({ ...d, swap: [true, false, false, false, false] });
    expect(d.phase).toBe("bet");
    const settled = bet(d, "call");
    expect(settled.phase).toBe("show");
    expect([9, 10, 11]).toContain(settled.chips);
  });
});

describe("composer, program, factory", () => {
  it("composer reproduces the target melody", () => {
    let d = startComposer({ steps: 4, target: "C4 . E4 G4" });
    d = setNote(d, 0, 0); d = setNote(d, 2, 2); d = setNote(d, 3, 3);
    expect(melodyText(d)).toBe("C4 . E4 G4");
  });
  it("program: loops and ×2 expand", () => {
    const args = ProgramArgsSchema.parse({ rows: ["#######", "#@.*.G#", "#######"], commands: ["F", "x2", "loop"] });
    expect(runProgram(args, ["F", "x2", "loop"]).ok).toBe(true);
    expect(runProgram(args, ["F"]).result).toContain("届かなかった");
    expect(runProgram(args, ["F", "x2", "loop", "F"]).ok).toBe(false);
  });
  it("factory: a chained line makes the goal in time", () => {
    let d = startFactory({ seconds: 120 });
    d = setRecipe(d, 0, 0); d = setRecipe(d, 1, 1); d = setRecipe(d, 2, 2); d = setRecipe(d, 3, 0);
    const [end, s] = run(d, x => stepFactory(x, []), factoryStatus, 120 * 30 + 5);
    expect(s).toBe("win");
    expect(end.made).toBeGreaterThanOrEqual(5);
  });
});

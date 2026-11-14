import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadProjectFromDisk } from "../../cli/src/load";
import type { GameContent, GameState } from "../../schema/src/index";
import { createEngine } from "../../engine/src/index";
import { MODULES, moduleDiagnostics, withModules } from "./index";
import { actionStatus, checkActionLevel, startAction, stepAction, type ActionData } from "./action";
import { startTactics, tacticsInput, tacticsStatus } from "./tactics";
import { findMatches, match3Status, startMatch3, swapGems, type Match3Data } from "./match3";
import { LANES, rhythmStatus, startRhythm, stepRhythm, accuracy } from "./rhythm";
import { useHotspot, type RoomData, RoomArgsSchema } from "./room";
import { deduceAct, DeduceArgsSchema, type DeduceData } from "./deduce";
import { runnerStatus, startRunner, stepRunner, placeOf } from "./runner";
import { answerQuiz, normalizeAnswer, quizStatus, QuizArgsSchema, type QuizData } from "./quiz";

const root = path.resolve(__dirname, "../../../projects/sample-rpg");
let content: GameContent;
let state: GameState;
beforeAll(async () => {
  content = (await loadProjectFromDisk(root)).content!;
  state = createEngine(content, withModules(content, [])).newGame(1);
});
const ctx = () => ({ content, state });

describe("genre engines", () => {
  it("every module validates its own arguments through moduleDiagnostics", () => {
    const project = { ...content.project, modules: Object.fromEntries(Object.keys(MODULES).map(id => [id, {}])) };
    const village = content.maps.village!;
    const broken: GameContent = { ...content, project, maps: { ...content.maps, village: { ...village, entities: [...village.entities, { id: "bad", x: 0, y: 0, states: [{ trigger: "action", effects: [
      { type: "startScene", system: "action", scene: "stage", args: { rows: ["#@#"], goal: "exit" } },
      { type: "startScene", system: "tactics", scene: "battle", args: { rows: ["@.."] } },
      { type: "startScene", system: "rhythm", scene: "play", args: { chart: ["...."] } },
      { type: "startScene", system: "room", scene: "explore", args: { rooms: [{ id: "a", title: "A", hotspots: [{ id: "x", label: "x", x: 1, y: 1, goto: "nowhere" }] }] } },
      { type: "startScene", system: "quiz", scene: "ask", args: { questions: [{ q: "?", choices: ["a"], answer: 3 }] } },
    ] }] } as never] } },
    };
    const text = moduleDiagnostics(broken).map(d => d.message).join("\n");
    expect(text).toContain("ゴール G");
    expect(text).toContain("敵（e か B）");
    expect(text).toContain("ノーツ");
    expect(text).toContain("'nowhere'");
    expect(text).toContain("choices の番号");
  });

  it("action (side view): run right, collect the coin, reach the goal", () => {
    expect(checkActionLevel(["#@  G#"], "exit")).toEqual([]);
    let d: ActionData = startAction(ctx(), { rows: ["#           #", "#@   *    G #", "#############"], goal: "exit" });
    let status = actionStatus(d);
    for (let i = 0; i < 300 && status === "playing"; i++) { d = stepAction(ctx(), d, ["right"]); status = actionStatus(d); }
    expect(status).toBe("win");
    expect(d.coins.length).toBe(1);
  });

  it("action (side view): jumps over a gap", () => {
    let d = startAction(ctx(), { rows: ["#             #", "#             #", "#             #", "#@         G  #", "#####  ########"], goal: "exit" });
    let status = actionStatus(d);
    for (let i = 0; i < 400 && status === "playing"; i++) { d = stepAction(ctx(), d, i > 12 && i < 24 ? ["right", "up"] : ["right"]); status = actionStatus(d); }
    expect(status).toBe("win");
  });

  it("action (top view): defeat a chaser with the sword, deterministically", () => {
    const run = () => {
      let d = startAction(ctx(), { view: "top", rows: ["########", "#@    c#", "########"], goal: "defeat", enemyHp: 8 });
      let status = actionStatus(d);
      for (let i = 0; i < 600 && status === "playing"; i++) { d = stepAction(ctx(), d, i % 2 ? ["right", "fire"] : ["right"]); status = actionStatus(d); }
      return { status, frame: d.frame, hp: d.hp };
    };
    const a = run();
    expect(a.status).toBe("win");
    expect(run()).toEqual(a);
  });

  it("tactics: select the hero, move next to the enemy, strike", () => {
    let d = startTactics(ctx(), { rows: ["#######", "#@...e#", "#######"], enemy: { hp: 3, attack: 1 } });
    d = tacticsInput(d, "confirm");
    expect(d.mode).toBe("move");
    for (let i = 0; i < 3; i++) d = tacticsInput(d, "right");
    d = tacticsInput(d, "confirm");
    expect(d.mode).toBe("target");
    d = tacticsInput(d, "confirm");
    expect(tacticsStatus(d)).toBe("win");
  });

  it("tactics: enemies advance and attack on their phase", () => {
    let d = startTactics(ctx(), { rows: ["########", "#@....e#", "########"], enemy: { hp: 30, attack: 3, move: 4 } });
    const hp = d.units.find(u => u.hero)!.hp;
    d = tacticsInput(d, "custom", { end: true });
    expect(d.turn).toBe(2);
    const enemy = d.units.find(u => u.side === "enemy")!;
    expect(enemy.x).toBeLessThan(6);
    d = tacticsInput(d, "custom", { end: true });
    expect(d.units.find(u => u.hero)!.hp).toBeLessThan(hp);
  });

  it("match3: valid swaps clear runs and score; boards start without matches", () => {
    let d: Match3Data = startMatch3(ctx(), { target: 12, moves: 40 });
    expect(findMatches(d.board).some(r => r.some(Boolean))).toBe(false);
    for (let guard = 0; guard < 40 && match3Status(d) === "playing"; guard++) {
      let moved = false;
      outer: for (let y = 0; y < d.args.height; y++) for (let x = 0; x < d.args.width; x++) for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const next = swapGems(ctx(), d, { x, y }, { x: x + dx, y: y + dy });
        if (next.moves > d.moves) { d = next; moved = true; break outer; }
      }
      if (!moved) break;
    }
    expect(match3Status(d)).toBe("win");
    expect(d.score).toBeGreaterThanOrEqual(12);
  });

  it("rhythm: hitting every note on time passes with 100%", () => {
    let d = startRhythm(ctx(), { bpm: 120, chart: ["x...", ".x..", "..x.", "...x", "x..x"], leadIn: 2 });
    for (let i = 0; i < 400 && rhythmStatus(d) === "playing"; i++) {
      const due = d.notes.filter(n => !n.hit && n.t === d.frame + 1).map(n => LANES[n.lane]!);
      d = stepRhythm(ctx(), d, due);
    }
    expect(rhythmStatus(d)).toBe("win");
    expect(accuracy(d)).toBe(100);
  });

  it("room: the locked door needs the item, then opens the way out", () => {
    const itemId = content.database.items[0]!.id;
    const args = RoomArgsSchema.parse({ rooms: [{ id: "cell", title: "牢", hotspots: [{ id: "door", label: "扉", x: 40, y: 20, needs: itemId, exit: true, text: "扉が開いた" }, { id: "pot", label: "壺", x: 10, y: 60, effects: [{ type: "giveItem", item: itemId }], once: true }] }] });
    let d: RoomData = { args, room: "cell", cursor: 0, message: "", used: [], found: [], visited: ["cell"] };
    const locked = useHotspot(ctx(), d, "door");
    expect(locked.exit).toBe(false);
    expect(locked.data.message).toContain("必要");
    const pot = useHotspot(ctx(), d, "pot");
    expect(pot.apply).toEqual([{ type: "giveItem", item: itemId }]);
    expect(useHotspot(ctx(), pot.data, "pot").apply).toEqual([]);
    d = { ...pot.data, item: itemId };
    expect(useHotspot(ctx(), d, "door").exit).toBe(true);
  });

  it("deduce: wrong evidence costs a life, the right one breaks the statement, then the answer solves it", () => {
    const args = DeduceArgsSchema.parse({ evidence: [{ id: "mud", label: "泥" }, { id: "key", label: "鍵" }], statements: [{ speaker: "番人", text: "一晩中ここにいた", contradiction: "mud" }], question: { prompt: "犯人は？", options: [{ id: "guard", label: "番人" }, { id: "cat", label: "猫" }], answer: "guard" } });
    let d: DeduceData = { args, phase: "statements", cursor: 0, evidence: 0, broken: [], lives: 3, message: "", speaker: "" };
    d = deduceAct(ctx(), d, { present: "key" });
    expect(d.lives).toBe(2);
    d = deduceAct(ctx(), d, { present: "mud" });
    expect(d.phase).toBe("question");
    expect(deduceAct(ctx(), d, { answer: "cat" }).lives).toBe(1);
    expect(deduceAct(ctx(), d, { answer: "guard" }).message).toBe("solved");
  });

  it("runner: obstacles hurt, jumping clears them, rivals set the place", () => {
    let d = startRunner(ctx(), { lanes: 3, length: 20, track: ["...", ".#.", "...", "*.."], rivals: [{ name: "亀", speed: 2 }], hitDamage: 1 });
    for (let i = 0; i < 1000 && runnerStatus(d) === "playing"; i++) d = stepRunner(d, []);
    expect(runnerStatus(d)).toBe("win");
    expect(placeOf(d)).toBe(1);
    expect(d.hits).toBeGreaterThan(0);
    let j = startRunner(ctx(), { lanes: 3, length: 20, track: ["...", ".#.", "...", "..."], hitDamage: 1 });
    for (let i = 0; i < 1000 && runnerStatus(j) === "playing"; i++) j = stepRunner(j, i % 6 === 0 ? ["fire"] : []);
    expect(j.hits).toBeLessThan(d.hits);
  });

  it("quiz: typed answers ignore width and kana; enough right answers pass", () => {
    expect(normalizeAnswer(" カゼ ")).toBe("かぜ");
    expect(normalizeAnswer("ＡＢＣ")).toBe("abc");
    const args = QuizArgsSchema.parse({ questions: [{ q: "吹くものは？", answer: ["かぜ"] }, { q: "1+1", choices: ["1", "2"], answer: 1 }], pass: 2 });
    let d: QuizData = { args, index: 0, asked: 0, correct: 0, choice: 0, message: "", hp: 10, maxHp: 10, attack: 5, defense: 1, enemyHp: 0, enemyMaxHp: 0, battle: false };
    d = answerQuiz(ctx(), d, "カゼ").data;
    d = answerQuiz(ctx(), d, 1).data;
    expect(quizStatus(d)).toBe("win");
  });
});

describe("genre atlas", () => {
  it("is generated, refers only to real modules, and has unique ids", async () => {
    const { GENRES, genreAtlasMarkdown } = await import("./genres");
    const fs = await import("node:fs/promises");
    expect(new Set(GENRES.map(g => g.id)).size).toBe(GENRES.length);
    for (const g of GENRES) for (const m of g.modules) expect(MODULES[m], `${g.id} → ${m}`).toBeDefined();
    expect(GENRES.length).toBeGreaterThan(90);
    const doc = await fs.readFile(path.resolve(__dirname, "../../../docs/genre-atlas.md"), "utf8");
    expect(doc, "pnpm rpg genres --write で docs/genre-atlas.md を更新してください").toBe(genreAtlasMarkdown());
  });
});

import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadProjectFromDisk } from "../../cli/src/load";
import { loadSystems, runProjectScenarios } from "../../cli/src/index";
import type { Effect, GameContent, GameState, Rule } from "../../schema/src/index";
import { createEngine, evalExpr, evaluate, interpolate, makeSave, readSave, type Engine, type GameSystem } from "./index";

const root = path.resolve(__dirname, "../../../projects/sample-rpg");
let content: GameContent;
let systems: GameSystem[];
let engine: Engine;

beforeAll(async () => {
  const loaded = await loadProjectFromDisk(root);
  expect(loaded.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  content = loaded.content!;
  systems = await loadSystems(root, content);
  engine = createEngine(content, systems);
});

function start(race: "dwarf" | "beastfolk" | "human", seed = 1): GameState {
  let state = engine.newGame(seed);
  while (state.scene.kind === "message") state = engine.step(state, { type: "advance" }).state;
  expect(state.scene.kind).toBe("prompt");
  state = engine.step(state, { type: "choose", choiceId: race }).state;
  while (state.scene.kind === "message") state = engine.step(state, { type: "advance" }).state;
  return state;
}

/** Content with extra global rules, for testing rule behaviour in isolation. */
function withRules(rules: Rule[]): Engine {
  return createEngine({ ...content, rules: [...content.rules, ...rules] }, systems);
}
const rule = (r: Partial<Rule> & Pick<Rule, "id" | "on">): Rule => ({ repeat: false, priority: 0, effects: [], ...r });

describe("expressions and conditions", () => {
  it("evaluates arithmetic, variables, stats and nested conditions", () => {
    const state = { ...start("dwarf"), vars: { gold: 17, spirit: 3, victories: 0, loot: 0 } };
    const env = { content };
    expect(evalExpr({ add: [{ var: "gold" }, 3] }, state, env)).toBe(20);
    expect(evalExpr({ div: [{ var: "gold" }, 5] }, state, env)).toBe(3);
    expect(evalExpr({ mod: [-1, 8] }, state, env)).toBe(7);
    expect(evalExpr({ percent: [{ stat: "maxHp" }, 50] }, state, env)).toBe(11);
    expect(evalExpr({ if: { trait: "dwarf" }, then: 1, else: 2 }, state, env)).toBe(1);
    expect(evaluate({ var: "gold", op: ">=", value: { mul: [3, 5] } }, state, env)).toBe(true);
    expect(evaluate({ all: [{ ability: "unyielding-soul" }, { not: { trait: "human" } }] }, state, env)).toBe(true);
    expect(interpolate("{{name}}({{trait.種族}}) {{var.gold}}G HP{{hp}}/{{maxHp}} {{unknown}}", state, env)).toBe("アオ(小人) 17G HP22/22 {{unknown}}");
  });
});

describe("races as data (traits)", () => {
  it("each race changes stats, abilities and starting gifts", () => {
    const dwarf = start("dwarf");
    expect(engine.stats(dwarf)).toEqual({ maxHp: 22, attack: 5, defense: 2 });
    expect(dwarf.player.hp).toBe(22);
    expect(engine.abilities(dwarf)).toEqual(expect.arrayContaining(["unyielding-soul", "earth-ward"]));
    const beast = start("beastfolk");
    expect(engine.stats(beast).attack).toBe(6);
    expect(engine.abilities(beast)).toContain("beast-trail");
    const human = start("human");
    expect(human.items.herb).toBe(2);
    expect(human.vars.gold).toBe(10);
  });

  it("removing a trait removes its abilities and clamps HP", () => {
    let state = start("dwarf");
    state = engine.run(state, [{ type: "removeTrait", trait: "dwarf" }]).state;
    expect(engine.abilities(state)).not.toContain("unyielding-soul");
    expect(state.player.hp).toBe(18);
  });

  it("the beast-trail gap needs the ability (from a trait or learned)", () => {
    let state = engine.run(start("dwarf"), [{ type: "teleport", mapId: "ruins", x: 9, y: 9, facing: "up" }]).state;
    state = engine.step(state, { type: "interact" }).state;
    expect(state.scene).toMatchObject({ kind: "message", text: expect.stringContaining("通れそうにない") });
    let beast = engine.run(start("beastfolk"), [{ type: "teleport", mapId: "ruins", x: 9, y: 9, facing: "up" }]).state;
    beast = engine.step(beast, { type: "interact" }).state;
    expect(beast.flags.ruinsShortcutOpen).toBe(true);
    expect(engine.isPassable(beast, 9, 8)).toBe(true);
  });
});

describe("rules", () => {
  it("lethalDamage with once:battle saves only once per battle, and resets next battle", () => {
    // HP 1 makes every hit lethal regardless of the dice. Sentinel: tackle, wind-up (no damage), smash.
    let state = engine.run(start("dwarf"), [{ type: "damage", target: "player", amount: 100 }, { type: "battle", enemy: "stone-sentinel", onDefeat: "continue" }]).state;
    expect(state.player.hp).toBe(1);
    state = engine.step(state, { type: "battle", command: "attack" }).state; // tackle → saved
    expect(state.player.hp).toBe(1);
    expect(state.scene.kind === "battle" && state.scene.battle.log.join()).toContain("不屈の魂");
    state = engine.step(state, { type: "battle", command: "attack" }).state; // wind-up
    state = engine.step(state, { type: "battle", command: "attack" }).state; // smash → not saved
    expect(state.scene.kind === "battle" && state.scene.battle.outcome).toBe("defeat");
    state = engine.step(state, { type: "advance" }).state;
    state = engine.run(state, [{ type: "battle", enemy: "stone-sentinel", onDefeat: "continue" }]).state;
    state = engine.step(state, { type: "battle", command: "attack" }).state;
    expect(state.player.hp).toBe(1);
    expect(state.scene.kind === "battle" && state.scene.battle.outcome).toBe("ongoing");
  });

  it("auto rules fire once when their condition becomes true; repeat re-arms", () => {
    const e = withRules([
      rule({ id: "rich", on: "auto", when: { var: "gold", op: ">=", value: 50 }, effects: [{ type: "giveItem", item: "herb" }] }),
      rule({ id: "broke", on: "auto", repeat: true, when: { var: "gold", op: "==", value: 0 }, effects: [{ type: "setVar", var: "loot", op: "add", value: 1 }] }),
    ]);
    let state = start("dwarf");
    state = e.run(state, []).state;
    expect(state.vars.loot).toBe(1); // gold is 0 at start
    state = e.run(state, [{ type: "setVar", var: "gold", value: 60 }]).state;
    expect(state.items.herb).toBe(1);
    state = e.run(state, [{ type: "setVar", var: "gold", value: 0 }]).state;
    state = e.run(state, [{ type: "setVar", var: "gold", value: 70 }]).state;
    expect(state.items.herb).toBe(1); // once per game
    state = e.run(state, [{ type: "setVar", var: "gold", value: 0 }]).state;
    expect(state.vars.loot).toBe(3); // repeat fired each time gold returned to 0
  });

  it("playAmbient sets and clears the ambient loop (null = stop, unset = the map's own)", () => {
    let state = start("dwarf");
    expect(state.ambient).toBeUndefined();
    state = engine.run(state, [{ type: "playAmbient", sound: "sfx-cursor" }]).state;
    expect(state.ambient).toBe("sfx-cursor");
    state = engine.run(state, [{ type: "playAmbient", sound: null }]).state;
    expect(state.ambient).toBeNull();
  });

  it("the sample's veteran rule raises attack after 3 victories, and loot uses {{var}} text", () => {
    let state = start("beastfolk", 5);
    for (let i = 0; i < 3; i++) {
      state = engine.run(state, [{ type: "heal" }, { type: "battle", enemy: "moss-slime" }]).state;
      for (let t = 0; t < 20 && state.scene.kind === "battle" && state.scene.battle.outcome === "ongoing"; t++) state = engine.step(state, { type: "battle", command: "attack" }).state;
      state = engine.step(state, { type: "advance" }).state;
      expect(state.scene).toMatchObject({ kind: "message", text: expect.stringMatching(/^[2-5]ゴールドを拾った。$/) });
      while (state.scene.kind === "message") state = engine.step(state, { type: "advance" }).state;
    }
    expect(state.vars.victories).toBe(3);
    expect(state.flags.veteran).toBe(true);
    expect(engine.stats(state).attack).toBe(7);
    expect(state.vars.gold).toBeGreaterThanOrEqual(6);
  });

  it("dealDamage rules can multiply damage with a chance, deterministically per seed", () => {
    const e = withRules([rule({ id: "triple", on: "dealDamage", modify: { damage: { mul: [{ ctx: "damage" }, 3] } } })]);
    let state = e.run(start("dwarf"), [{ type: "battle", enemy: "stone-sentinel" }]).state;
    state = e.step(state, { type: "battle", command: "attack" }).state;
    const hp = state.scene.kind === "battle" ? state.scene.battle.enemyHp : -1;
    expect(16 - hp).toBeGreaterThanOrEqual(9); // 3..5 damage tripled
  });

  it("step rules use expressions on the step counter", () => {
    let state = start("dwarf");
    const before = state.vars.spirit!;
    state = engine.run(state, [{ type: "teleport", mapId: "village", x: 2, y: 9 }]).state;
    for (let i = 0; i < 8; i++) state = engine.step(state, { type: "move", direction: i % 2 ? "left" : "right" }).state;
    expect(state.steps).toBe(8);
    expect(state.vars.spirit).toBe(before + 1);
  });
});

describe("world changes", () => {
  it("overlays follow flags and setTile persists in saves", () => {
    let state = start("dwarf");
    state = engine.run(state, [{ type: "teleport", mapId: "ruins", x: 3, y: 9 }]).state;
    expect(engine.isPassable(state, 11, 9)).toBe(false);
    state = engine.run(state, [{ type: "setFlag", flag: "sentinelCalmed" }]).state;
    expect(engine.isPassable(state, 11, 9)).toBe(true);
    expect(engine.rowsFor(state, "ruins")[9]![11]).toBe("i");
    state = engine.run(state, [{ type: "setTile", x: 4, y: 9, code: "R" }]).state;
    expect(engine.isPassable(state, 4, 9)).toBe(false);
    const restored = readSave(JSON.parse(JSON.stringify(makeSave(content, state))), content);
    expect(restored.ok && engine.isPassable(restored.save.state, 4, 9)).toBe(false);
  });

  it("choice prompts filter options by condition (shop)", () => {
    let state = start("dwarf");
    state = engine.run(state, [{ type: "event", event: "elder-shop" }]).state;
    expect(state.scene.kind === "prompt" && state.scene.options.map(o => o.id)).toEqual(["leave"]);
    state = engine.step(state, { type: "choose", choiceId: "leave" }).state;
    state = engine.run(state, [{ type: "setVar", var: "gold", value: 25 }, { type: "event", event: "elder-shop" }]).state;
    expect(state.scene.kind === "prompt" && state.scene.prompt).toContain("25G");
    state = engine.step(state, { type: "choose", choiceId: "buy-charm" }).state;
    expect(state.vars.gold).toBe(5);
    expect(engine.stats(state).attack).toBe(6);
  });

  it("skills check and pay their cost", () => {
    let state = engine.run(start("beastfolk"), [{ type: "setVar", var: "spirit", value: 3 }, { type: "battle", enemy: "stone-sentinel" }]).state;
    expect(engine.usables(state, "battle").find(u => u.id === "bite")?.blocked).toBeUndefined();
    state = engine.step(state, { type: "battle", command: "skill", ability: "bite" }).state;
    expect(state.vars.spirit).toBe(1);
    expect(state.scene.kind === "battle" && state.scene.battle.enemyHp).toBe(4); // 16 - 6*2
    expect(engine.usables(state, "battle").find(u => u.id === "bite")?.blocked).toContain("気力");
  });

  it("TypeScript systems are called from data", () => {
    let state = engine.run(start("human"), [{ type: "event", event: "read-diary" }]).state;
    expect(state.scene).toMatchObject({ kind: "message", text: expect.stringContaining("旅の日誌 — アオ（人間）") });
    state = engine.step(state, { type: "advance" }).state;
    expect(state.scene.kind).toBe("message");
  });
});

describe("determinism and saves", () => {
  it("is deterministic for the same seed and actions", () => {
    const play = () => {
      let s = engine.run(start("beastfolk", 99), [{ type: "battle", enemy: "cave-bat" }]).state;
      for (let i = 0; i < 4; i++) s = engine.step(s, { type: "battle", command: "attack" }).state;
      return s;
    };
    expect(play()).toEqual(play());
  });

  it("rejects saves from other projects or unknown formats without throwing", () => {
    const save = makeSave(content, start("dwarf"));
    expect(readSave({ ...save, projectId: "other" }, content)).toMatchObject({ ok: false });
    expect(readSave({ ...save, formatVersion: 9 }, content)).toMatchObject({ ok: false, reason: expect.stringContaining("未対応") });
    expect(readSave("garbage", content)).toMatchObject({ ok: false });
    expect(() => makeSave(content, engine.newGame())).toThrow(); // intro prompt is open
  });

  it("older v2 saves without the new fields still load", () => {
    const save = makeSave(content, start("dwarf")) as unknown as { state: Record<string, unknown> };
    for (const key of ["traits", "vars", "tileOverrides", "fired"]) delete save.state[key];
    const result = readSave(save, content);
    expect(result.ok).toBe(true);
  });
});

describe("attached scripts", () => {
  it("binds one script instance per enemy (stable slot) when identical enemies appear", () => {
    const seen: Array<{ id: string; index?: number }> = [];
    const enemy = content.database.enemies[0]!;
    const taggedContent: GameContent = {
      ...content,
      database: {
        ...content.database,
        enemies: content.database.enemies.map((e, i) => (i === 0 ? { ...e, script: "multi-foe" } : e)),
      },
    };
    const multiEngine = createEngine(taggedContent, [
      ...systems,
      {
        id: "multi-foe",
        scope: "attached",
        enemyTurn(ctx) {
          seen.push({ id: ctx.self?.id ?? "", index: ctx.self?.index });
          return undefined;
        },
      },
    ]);
    let state = multiEngine.newGame(1);
    while (state.scene.kind === "message") state = multiEngine.step(state, { type: "advance" }).state;
    state = multiEngine.step(state, { type: "choose", choiceId: "dwarf" }).state;
    while (state.scene.kind === "message") state = multiEngine.step(state, { type: "advance" }).state;
    state = multiEngine.run(state, [{ type: "battle", enemy: enemy.id, with: [enemy.id] }]).state;
    const activeIds = multiEngine.activeSystems(state).map(s => s.id);
    expect(activeIds).toContain(`multi-foe@enemy:${enemy.id}#0`);
    expect(activeIds).toContain(`multi-foe@enemy:${enemy.id}#1`);
    multiEngine.step(state, { type: "battle", command: "guard" });
    // Both enemies act through their own binding, each keeping its start-of-battle slot.
    expect(seen).toEqual([{ id: enemy.id, index: 0 }, { id: enemy.id, index: 1 }]);
  });
});

describe("battle: all-target, multi-hit, critical, evasion, speed order (065-067)", () => {
  const foeId = () => content.database.enemies.find(e => !e.battle && e.stats.maxHp >= 6)!.id;
  const boot = (eng: Engine) => {
    let state = eng.newGame(1);
    while (state.scene.kind === "message") state = eng.step(state, { type: "advance" }).state;
    state = eng.step(state, { type: "choose", choiceId: "dwarf" }).state;
    while (state.scene.kind === "message") state = eng.step(state, { type: "advance" }).state;
    return state;
  };
  const withEnemy = (patch: Record<string, unknown>, project: Record<string, unknown> = {}): GameContent => ({
    ...content,
    project: { ...content.project, battle: { ...content.project.battle, ...project } },
    database: { ...content.database, enemies: content.database.enemies.map(e => (e.id === foeId() ? { ...e, ...patch } : e)) },
  });
  const log = (state: GameState) => (state.scene.kind === "battle" ? state.scene.battle.log.join("\n") : "");

  it("an enemy with 100% evasion dodges every attack; a 100% critical chance multiplies damage", () => {
    let eng = createEngine(withEnemy({ evasion: 100 }), systems);
    let state = eng.run(boot(eng), [{ type: "battle", enemy: foeId() }]).state;
    state = eng.step(state, { type: "battle", command: "attack" }).state;
    expect(log(state)).toContain("ひらりとかわした");
    eng = createEngine(withEnemy({ stats: { maxHp: 999, attack: 0, defense: 0 } }, { critical: { chance: 100, multiplier: 300 } }), systems);
    state = eng.run(boot(eng), [{ type: "battle", enemy: foeId() }]).state;
    state = eng.step(state, { type: "battle", command: "attack" }).state;
    expect(log(state)).toContain("会心の一撃！");
    const hp = state.scene.kind === "battle" ? state.scene.battle.enemyHp : 0;
    expect(999 - hp).toBeGreaterThanOrEqual(3 * Math.max(1, eng.stats(state).attack - 1));
  });

  it("damage to all enemies hits each one; hits repeats", () => {
    const eng = createEngine(withEnemy({ stats: { maxHp: 50, attack: 0, defense: 0 } }), systems);
    let state = eng.run(boot(eng), [{ type: "battle", enemy: foeId(), with: [foeId(), foeId()] }]).state;
    state = eng.run(state, [{ type: "damage", target: "enemies", amount: 4, hits: 2 }]).state;
    const b = state.scene.kind === "battle" ? state.scene.battle : undefined;
    expect([b!.enemyHp, ...b!.foes!.map(f => f.hp)]).toEqual([42, 42, 42]);
    state = eng.run(state, [{ type: "damage", target: "enemy", amount: 5, hits: 3 }]).state;
    expect(state.scene.kind === "battle" && state.scene.battle.enemyHp).toBe(27);
  });

  it("an enemy attack on everyone with 2 hits strikes the hero twice", () => {
    const foe = content.database.enemies.find(e => e.id === foeId())!;
    const eng = createEngine(withEnemy({ actions: [{ ...foe.actions.find(a => a.power > 0)!, when: undefined, target: "all", hits: 2, effects: [] }] }), systems);
    let state = eng.run(boot(eng), [{ type: "battle", enemy: foeId() }]).state;
    state = eng.step(state, { type: "battle", command: "guard" }).state;
    expect(log(state).match(/のダメージを受けた/g)?.length).toBe(2);
  });

  it("with order 'speed' a faster enemy acts before the hero, and turnOrder shows it", () => {
    const eng = createEngine(withEnemy({ speed: 50 }, { order: "speed", playerSpeed: 5 }), systems);
    const state = eng.run(boot(eng), [{ type: "battle", enemy: foeId() }]).state;
    expect(eng.turnOrder(state).map(a => a.kind)).toEqual(["enemy", "player"]);
    const fixed = createEngine(withEnemy({ speed: 50 }), systems);
    expect(fixed.turnOrder(fixed.run(boot(fixed), [{ type: "battle", enemy: foeId() }]).state).map(a => a.kind)).toEqual(["player", "enemy"]);
  });
});

describe("map layers", () => {
  it("objects on lower layers block; upper layers (above the characters) never do", () => {
    const blocking = content.tileset.tiles.find(t => !t.passable)!.code;
    const mapId = content.project.start.mapId;
    const base = content.maps[mapId]!;
    const empty = Array.from({ length: base.height }, () => " ".repeat(base.width));
    const put = (rows: string[], x: number, y: number) => rows.map((r, i) => (i === y ? Array.from(r).map((c, j) => (j === x ? blocking : c)).join("") : r));
    const { x, y } = content.project.start;
    const tx = x + 1;
    const withLayers = (above: boolean): GameContent => ({ ...content, maps: { ...content.maps, [mapId]: { ...base, layers: [{ id: "l", above, rows: put(empty, tx, y) }] } } });
    const state = createEngine(content, systems).newGame(1);
    expect(createEngine(content, systems).isPassable(state, tx, y)).toBe(createEngine(content, systems).isPassable(state, tx, y));
    expect(createEngine(withLayers(false), systems).isPassable(state, tx, y)).toBe(false);
    const plain = createEngine(content, systems).isPassable(state, tx, y);
    expect(createEngine(withLayers(true), systems).isPassable(state, tx, y)).toBe(plain);
  });
});

describe("leveling (project.leveling)", () => {
  it("winning gives experience, levels up stats / HP and teaches abilities; gainExp works in the field", () => {
    const ability = content.database.abilities[0]!.id;
    const leveled: GameContent = { ...content, project: { ...content.project, leveling: { maxLevel: 5, base: 3, growth: 1, gains: { maxHp: 5, attack: 2, defense: 1 }, learn: [{ level: 3, ability }], fullHeal: false } } };
    const eng = createEngine(leveled, systems);
    let state = eng.newGame(1);
    while (state.scene.kind === "message") state = eng.step(state, { type: "advance" }).state;
    state = eng.step(state, { type: "choose", choiceId: "human" }).state;
    while (state.scene.kind !== "field") state = eng.step(state, { type: "advance" }).state;
    state = { ...state, abilities: state.abilities.filter(a => a !== ability) };
    const before = state.player.stats;
    // 7 exp with 3 per level: 1→2 (3), 2→3 (3), 1 left over.
    state = eng.run(state, [{ type: "gainExp", amount: 7 }]).state;
    expect(state.player.level).toBe(3);
    expect(state.player.exp).toBe(1);
    expect(state.player.stats).toEqual({ maxHp: before.maxHp + 10, attack: before.attack + 4, defense: before.defense + 2 });
    expect(state.abilities).toContain(ability);
    expect(eng.levelInfo(state)).toEqual({ level: 3, exp: 1, next: 3 });
    // Battles give each enemy's exp (or the formula) on victory.
    const enemy = leveled.database.enemies[0]!;
    expect(state.scene.kind).toBe("message"); // "…の経験値を手に入れた。" / "レベル…に上がった！" / "…を覚えた！"
    while (state.scene.kind === "message") state = eng.step(state, { type: "advance" }).state;
    state = eng.run(state, [{ type: "battle", enemy: enemy.id }]).state;
    if (state.scene.kind !== "battle") throw new Error(`battle expected, got ${state.scene.kind}`);
    state = { ...state, scene: { ...state.scene, battle: { ...state.scene.battle, enemyHp: 1 } } };
    for (let i = 0; i < 10 && state.scene.kind === "battle" && (state.scene.battle.outcome === "ongoing"); i++) state = eng.step(state, { type: "battle", command: "attack" }).state;
    expect(state.scene.kind === "battle" && state.scene.battle.log.some(l => l.includes("経験値"))).toBe(true);
    expect((state.player.level ?? 1) >= 3).toBe(true);
  });
});

describe("sample scenarios", () => {
  it("all tests/*.scenario.json pass", async () => {
    const results = await runProjectScenarios(root, content, systems);
    expect(results.filter(r => !r.ok)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(5);
  });
});

// Keep the Effect type referenced so editors show it when reading this file as an example.
export type { Effect };

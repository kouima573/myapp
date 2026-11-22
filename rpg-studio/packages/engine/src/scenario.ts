/**
 * Data-driven play-tests: `projects/<id>/tests/*.scenario.json`.
 * Lets Codex / Claude Code verify gameplay headlessly (`pnpm rpg test`) after changing data or systems.
 */
import { z } from "zod";
import { DirectionSchema, EffectSchema, IdSchema, type Direction, type GameContent, type GameState } from "../../schema/src/formats";
import { createEngine, DELTAS, type Engine } from "./game";
import type { GameSystem } from "./systems";

const ExpectSchema = z.object({
  mapId: IdSchema.optional(),
  at: z.object({ x: z.number().int(), y: z.number().int() }).strict().optional(),
  scene: z.enum(["field", "message", "dialogue", "choice", "prompt", "battle", "custom", "ending"]).optional(),
  /** Each listed value must be in the set. */
  sets: z.record(z.string(), z.array(z.string())).optional(),
  lacksInSets: z.record(z.string(), z.array(z.string())).optional(),
  cycle: z.number().int().positive().optional(),
  entities: z.record(z.string(), z.object({ x: z.number().int(), y: z.number().int() }).strict().nullable()).optional(),
  regions: z.array(IdSchema).optional(),
  flags: z.record(z.string(), z.boolean()).optional(),
  abilities: z.array(IdSchema).optional(),
  lacksAbilities: z.array(IdSchema).optional(),
  items: z.record(z.string(), z.number().int().nonnegative()).optional(),
  done: z.array(z.string()).optional(),
  notDone: z.array(z.string()).optional(),
  hpAtLeast: z.number().int().optional(),
  /** Statuses the hero has / does not have (database.statuses). */
  statuses: z.array(IdSchema).optional(),
  lacksStatuses: z.array(IdSchema).optional(),
  /** Skill boards: learned panels ("board/node") and unspent points per owner. */
  skillsLearned: z.array(z.string()).optional(),
  skillPoints: z.record(z.string(), z.number().int()).optional(),
  /** Achievements unlocked (project.achievements). */
  achievements: z.array(IdSchema).optional(),
  /** Monster book: enemies met / beaten at least this many times (project.book). */
  bookSeen: z.array(IdSchema).optional(),
  bookDefeated: z.record(IdSchema, z.number().int()).optional(),
  /** project.leveling: the hero's level. */
  level: z.number().int().positive().optional(),
  vars: z.record(z.string(), z.number().int()).optional(),
  traits: z.array(IdSchema).optional(),
  lacksTraits: z.array(IdSchema).optional(),
  stats: z.object({ maxHp: z.number().int().optional(), attack: z.number().int().optional(), defense: z.number().int().optional() }).strict().optional(),
  passable: z.array(z.object({ x: z.number().int(), y: z.number().int(), is: z.boolean() }).strict()).optional(),
  battleOutcome: z.enum(["ongoing", "victory", "defeat", "fled"]).optional(),
  textIncludes: z.string().optional(),
  /** Who the player currently is (after setPlayer). */
  player: z.object({ name: z.string().optional(), sprite: z.string().nullable().optional() }).strict().optional(),
  /** Verbs usable right now (subset) / not usable. */
  /** Companions in the party (and ones that must not be). */
  party: z.array(IdSchema).optional(),
  lacksParty: z.array(IdSchema).optional(),
  /** HP of each enemy in the current battle, in order (primary first). */
  enemiesHp: z.array(z.number().int()).optional(),
  /** Equipment by slot (null = empty). */
  equipped: z.record(z.string(), z.string().nullable()).optional(),
  /** Entity the player carries (null = nothing). */
  carrying: z.string().nullable().optional(),
  verbs: z.array(IdSchema).optional(),
  lacksVerbs: z.array(IdSchema).optional(),
}).strict();

/** Buttons a realtime scene can see held (player 2: "p2" prefix). */
const HeldSchema = z.enum(["up", "down", "left", "right", "fire", "focus", "p2up", "p2down", "p2left", "p2right", "p2fire", "p2focus"]);

const StepSchema = z.union([
  z.object({ walkTo: z.object({ x: z.number().int(), y: z.number().int() }).strict() }).strict(),
  z.object({ face: DirectionSchema }).strict(),
  z.object({ move: DirectionSchema, times: z.number().int().positive().optional() }).strict(),
  z.object({ interact: z.literal(true) }).strict(),
  z.object({ advance: z.enum(["once", "all"]) }).strict(),
  z.object({ choose: IdSchema }).strict(),
  /** Learn a skill-board panel: "board/node". */
  z.object({ learnSkill: z.string().regex(/^[^/]+\/[^/]+$/) }).strict(),
  /** さいきょう装備 (the hero, or a companion id). */
  z.object({ optimize: z.string() }).strict(),
  /** 転職 from the menu (a selectable trait). */
  z.object({ chooseTrait: IdSchema }).strict(),
  /** Type text into an input window (effect "input"). */
  z.object({ input: z.string() }).strict(),
  /** target: which enemy to attack (0 = the first, 1 = the next of `with`…). */
  z.object({ battle: z.enum(["attack", "guard", "flee"]), target: z.number().int().min(0).max(7).optional() }).strict(),
  z.object({ battleItem: IdSchema }).strict(),
  z.object({ skill: IdSchema }).strict(),
  z.object({ tick: z.number().int().positive() }).strict(),
  /** Equip (or take off) an item from the inventory. */
  z.object({ equip: IdSchema, companion: IdSchema.optional() }).strict(),
  /** Tell a companion which of its actions to use this turn (index in its actions). */
  z.object({ battleOrder: z.object({ companion: IdSchema, action: z.number().int().min(0) }).strict() }).strict(),
  /** Run moveRoute cutscenes to the end (as the runtime does a few steps per second). */
  z.object({ routes: z.literal("finish") }).strict(),
  /** A command added by a script (battle or field menu), by its id (and label or source when ids clash). */
  z.object({ command: z.string().min(1), source: z.string().optional() }).strict(),
  /** Use a self-made verb (project.json › verbs). */
  z.object({ verb: IdSchema }).strict(),
  /** Realtime scenes (shooting): run up to `frames` simulation steps holding these buttons; stops when the scene ends. */
  z.object({ frames: z.number().int().positive().max(100000), hold: z.array(HeldSchema).default([]) }).strict(),
  /** Realtime scenes: repeat a pattern of held buttons (e.g. run, then jump) until the scene ends or `repeat` runs out. */
  z.object({ framesLoop: z.array(z.object({ frames: z.number().int().positive().max(10000), hold: z.array(HeldSchema).default([]) }).strict()).min(1), repeat: z.number().int().positive().max(10000).default(1) }).strict(),
  /** Send a sequence of inputs, repeated up to `repeat` times, until the custom scene closes. */
  z.object({ sceneInputs: z.array(z.enum(["up", "down", "left", "right", "confirm", "cancel"])).min(1), repeat: z.number().int().positive().max(1000).default(1) }).strict(),
  z.object({ sceneInput: z.union([z.enum(["up", "down", "left", "right", "confirm", "cancel"]), z.object({ custom: z.unknown() }).strict()]) }).strict(),
  z.object({ useItem: IdSchema }).strict(),
  z.object({ useAbility: IdSchema }).strict(),
  /** Simple AI: guard after a telegraph (power-0 move), heal under 1/2 HP, otherwise attack; then close the battle. */
  z.object({ fight: z.literal("auto") }).strict(),
  z.object({ effects: z.array(EffectSchema) }).strict(),
  z.object({ saveAndLoad: z.literal(true) }).strict(),
  z.object({ expect: ExpectSchema }).strict(),
]);

export const ScenarioSchema = z.object({
  name: z.string().min(1),
  seed: z.number().int().nonnegative().default(1),
  /** Random encounters make walking nondeterministic for humans reading the test; off by default. */
  encounters: z.boolean().default(false),
  steps: z.array(StepSchema).min(1),
}).strict();
export type Scenario = z.infer<typeof ScenarioSchema>;

export interface ScenarioResult {
  name: string;
  ok: boolean;
  failedStep?: number;
  message?: string;
  steps: number;
  /** The game state where it stopped (the failing step, or the end): the studio can open it in the play-test. */
  state?: GameState;
}

class ScenarioError extends Error {}

function textOf(engine: Engine, state: GameState): string {
  const scene = state.scene;
  if (scene.kind === "message") return scene.text;
  if (scene.kind === "dialogue") return engine.dialogueLines(state, scene.dialogueId)[scene.line] ?? "";
  if (scene.kind === "choice") return engine.dialogueLines(state, scene.dialogueId).at(-1) ?? "";
  if (scene.kind === "prompt") return [scene.prompt ?? "", ...scene.options.map(o => o.label)].join("\n");
  if (scene.kind === "battle") return scene.battle.log.join("\n");
  return "";
}

export function routeTo(engine: Engine, state: GameState, target: { x: number; y: number }): Direction[] | null {
  const map = engine.content.maps[state.mapId];
  if (!map) return null;
  const key = (x: number, y: number) => y * map.width + x;
  const prev = new Map<number, { from: number; dir: Direction }>();
  const queue: Array<{ x: number; y: number }> = [{ x: state.player.x, y: state.player.y }];
  const seen = new Set([key(state.player.x, state.player.y)]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.x === target.x && cur.y === target.y) break;
    for (const dir of ["up", "down", "left", "right"] as Direction[]) {
      const nx = cur.x + DELTAS[dir].x, ny = cur.y + DELTAS[dir].y;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height || seen.has(key(nx, ny))) continue;
      const isTarget = nx === target.x && ny === target.y;
      if (!engine.isPassable(state, nx, ny)) continue;
      // Don't route through portals or touch triggers unless they are the destination.
      if (!isTarget && (map.portals.some(p => p.x === nx && p.y === ny) || map.interactables.some(i => i.trigger === "touch" && i.x === nx && i.y === ny))) continue;
      seen.add(key(nx, ny));
      prev.set(key(nx, ny), { from: key(cur.x, cur.y), dir });
      queue.push({ x: nx, y: ny });
    }
  }
  let k = key(target.x, target.y);
  if (!prev.has(k)) return state.player.x === target.x && state.player.y === target.y ? [] : null;
  const dirs: Direction[] = [];
  while (prev.has(k)) { const p = prev.get(k)!; dirs.unshift(p.dir); k = p.from; }
  return dirs;
}

export function runScenario(content: GameContent, systems: GameSystem[], scenario: Scenario): ScenarioResult {
  const playable: GameContent = scenario.encounters ? content : {
    ...content,
    maps: Object.fromEntries(Object.entries(content.maps).map(([id, map]) => [id, { ...map, encounters: undefined }])),
  };
  const engine = createEngine(playable, systems);
  let state = engine.newGame(scenario.seed);
  const step = (action: Parameters<Engine["step"]>[1]) => { state = engine.step(state, action).state; };

  const autoFight = () => {
    for (let turn = 0; turn < 200 && state.scene.kind === "battle" && state.scene.battle.outcome === "ongoing"; turn++) {
      const battle = state.scene.battle;
      const enemy = content.database.enemies.find(e => e.id === battle.enemyId)!;
      const next = enemy.actions[battle.turn % enemy.actions.length]!;
      const previous = enemy.actions[(battle.turn + enemy.actions.length - 1) % enemy.actions.length]!;
      const herb = content.database.items.find(i => i.heal && (state.items[i.id] ?? 0) > 0);
      if (battle.turn > 0 && previous.power === 0 && next.power > 0) step({ type: "battle", command: "guard" });
      else if (herb && state.player.hp * 2 < state.player.stats.maxHp) step({ type: "battle", command: "item", item: herb.id });
      else step({ type: "battle", command: "attack" });
    }
    if (state.scene.kind === "custom" && state.scene.battle) throw new ScenarioError(`fight: この敵は戦闘モード ${state.scene.system}.${state.scene.scene} です。sceneInput / frames で操作してください`);
    if (state.scene.kind !== "battle") throw new ScenarioError("fight: 戦闘中ではありません");
    const outcome = state.scene.battle.outcome;
    step({ type: "advance" });
    if (outcome !== "victory") throw new ScenarioError(`fight: 戦闘に勝てませんでした (${outcome})`);
  };

  const check = (expect: z.infer<typeof ExpectSchema>) => {
    const fail = (message: string) => { throw new ScenarioError(message); };
    if (expect.mapId && state.mapId !== expect.mapId) fail(`mapId: 期待 ${expect.mapId} / 実際 ${state.mapId}`);
    if (expect.at && (state.player.x !== expect.at.x || state.player.y !== expect.at.y)) fail(`at: 期待 (${expect.at.x}, ${expect.at.y}) / 実際 (${state.player.x}, ${state.player.y})`);
    if (expect.scene && state.scene.kind !== expect.scene) fail(`scene: 期待 ${expect.scene} / 実際 ${state.scene.kind}`);
    for (const [flag, value] of Object.entries(expect.flags ?? {})) if ((state.flags[flag] ?? false) !== value) fail(`flags.${flag}: 期待 ${value} / 実際 ${state.flags[flag] ?? false}`);
    const abilities = engine.abilities(state);
    for (const id of expect.abilities ?? []) if (!abilities.includes(id)) fail(`能力 ${id} がありません`);
    for (const id of expect.lacksAbilities ?? []) if (abilities.includes(id)) fail(`能力 ${id} を持っています`);
    for (const id of expect.party ?? []) if (!state.party?.some(m => m.id === id)) fail(`party: ${id} が仲間にいません`);
    for (const id of expect.lacksParty ?? []) if (state.party?.some(m => m.id === id)) fail(`lacksParty: ${id} が仲間にいます`);
    if (expect.enemiesHp) {
      const b = state.scene.kind === "battle" ? state.scene.battle : null;
      const hp = b ? [b.enemyHp, ...(b.foes ?? []).map(f => f.hp)] : [];
      if (JSON.stringify(hp) !== JSON.stringify(expect.enemiesHp)) fail(`enemiesHp: 期待 [${expect.enemiesHp.join(", ")}] / 実際 [${hp.join(", ")}]`);
    }
    for (const [slot, item] of Object.entries(expect.equipped ?? {})) if ((state.equipment?.[slot] ?? null) !== item) fail(`equipped.${slot}: 期待 ${item} / 実際 ${state.equipment?.[slot] ?? "なし"}`);
    if (expect.carrying !== undefined && (state.carrying?.id ?? null) !== expect.carrying) fail(`carrying: 期待 ${expect.carrying} / 実際 ${state.carrying?.id ?? "なし"}`);
        if (expect.verbs || expect.lacksVerbs) {
      const usable = engine.usableVerbs(state);
      for (const v of expect.verbs ?? []) if (!usable.includes(v)) fail(`verbs: 「${v}」が使えません（使える: ${usable.join(", ") || "なし"}）`);
      for (const v of expect.lacksVerbs ?? []) if (usable.includes(v)) fail(`lacksVerbs: 「${v}」が使えてしまいます`);
    }
    if (expect.player?.name !== undefined) { const name = state.player.name ?? content.project.player.name; if (name !== expect.player.name) fail(`player.name: 期待 ${expect.player.name} / 実際 ${name}`); }
    if (expect.player?.sprite !== undefined) { const sprite = state.player.sprite ?? null; if (sprite !== expect.player.sprite) fail(`player.sprite: 期待 ${expect.player.sprite} / 実際 ${sprite}`); }
    for (const key of expect.skillsLearned ?? []) if (!state.skills?.learned.includes(key)) fail(`skillsLearned: ${key} を覚えていません`);
    for (const [who, n] of Object.entries(expect.skillPoints ?? {})) if ((state.skills?.points[who] ?? 0) !== n) fail(`skillPoints.${who}: 期待 ${n} / 実際 ${state.skills?.points[who] ?? 0}`);
    for (const id of expect.achievements ?? []) if (!state.achievements?.includes(id)) fail(`achievements: 「${id}」が未達成です（達成: ${state.achievements?.join(", ") || "なし"}）`);
    for (const id of expect.bookSeen ?? []) if (!state.book?.seen.includes(id)) fail(`bookSeen: ${id} が図鑑にありません`);
    for (const [id, n] of Object.entries(expect.bookDefeated ?? {})) if ((state.book?.defeated[id] ?? 0) < n) fail(`bookDefeated.${id}: 期待 ${n}以上 / 実際 ${state.book?.defeated[id] ?? 0}`);
    for (const [id, count] of Object.entries(expect.items ?? {})) if ((state.items[id] ?? 0) !== count) fail(`items.${id}: 期待 ${count} / 実際 ${state.items[id] ?? 0}`);
    for (const id of expect.done ?? []) if (!state.done.includes(id)) fail(`done に ${id} がありません`);
    for (const id of expect.notDone ?? []) if (state.done.includes(id)) fail(`done に ${id} があります`);
    for (const [id, value] of Object.entries(expect.vars ?? {})) if ((state.vars[id] ?? 0) !== value) fail(`vars.${id}: 期待 ${value} / 実際 ${state.vars[id] ?? 0}`);
    for (const id of expect.traits ?? []) if (!state.traits.includes(id)) fail(`特性 ${id} がありません`);
    for (const id of expect.lacksTraits ?? []) if (state.traits.includes(id)) fail(`特性 ${id} を持っています`);
    for (const [set, values] of Object.entries(expect.sets ?? {})) for (const v of values) if (!(state.sets[set] ?? []).includes(v)) fail(`集合 ${set} に「${v}」がありません（実際: ${(state.sets[set] ?? []).join(", ") || "空"}）`);
    for (const [set, values] of Object.entries(expect.lacksInSets ?? {})) for (const v of values) if ((state.sets[set] ?? []).includes(v)) fail(`集合 ${set} に「${v}」があります`);
    if (expect.cycle !== undefined && state.cycle !== expect.cycle) fail(`cycle: 期待 ${expect.cycle} / 実際 ${state.cycle}`);
    for (const [id, pos] of Object.entries(expect.entities ?? {})) {
      const view = engine.visibleEntities(state).find(v => v.entity.id === id);
      if (pos === null) { if (view) fail(`エンティティ ${id} が見えています`); continue; }
      if (!view) fail(`エンティティ ${id} が見えません`);
      else if (view.x !== pos.x || view.y !== pos.y) fail(`エンティティ ${id}: 期待 (${pos.x}, ${pos.y}) / 実際 (${view.x}, ${view.y})`);
    }
    for (const id of expect.regions ?? []) if (!engine.regions(state).includes(id)) fail(`領域 ${id} の中にいません`);
    const eff = engine.stats(state);
    for (const [key, value] of Object.entries(expect.stats ?? {})) if (eff[key as "attack"] !== value) fail(`stats.${key}: 期待 ${value} / 実際 ${eff[key as "attack"]}`);
    for (const id of expect.statuses ?? []) if (!(state.player.statuses ?? []).some(s => s.id === id)) fail(`状態異常 '${id}' を期待 / 実際 ${(state.player.statuses ?? []).map(s => s.id).join(",") || "なし"}`);
    for (const id of expect.lacksStatuses ?? []) if ((state.player.statuses ?? []).some(s => s.id === id)) fail(`状態異常 '${id}' が残っている`);
    if (expect.level !== undefined && (state.player.level ?? 1) !== expect.level) fail(`レベル: ${expect.level} を期待 / 実際 ${state.player.level ?? 1}`);
    if (expect.hpAtLeast !== undefined && state.player.hp < expect.hpAtLeast) fail(`HP: ${expect.hpAtLeast}以上を期待 / 実際 ${state.player.hp}`);
    for (const cell of expect.passable ?? []) if (engine.isPassable(state, cell.x, cell.y) !== cell.is) fail(`(${cell.x}, ${cell.y}) の通行可否: 期待 ${cell.is}`);
    if (expect.battleOutcome && (state.scene.kind !== "battle" || state.scene.battle.outcome !== expect.battleOutcome)) fail(`戦闘結果: 期待 ${expect.battleOutcome}`);
    if (expect.textIncludes && !textOf(engine, state).includes(expect.textIncludes)) fail(`表示テキストに「${expect.textIncludes}」がありません（実際: 「${textOf(engine, state)}」）`);
  };

  for (let index = 0; index < scenario.steps.length; index++) {
    const s = scenario.steps[index]!;
    try {
      if ("walkTo" in s) {
        const path = routeTo(engine, state, s.walkTo);
        if (!path) throw new ScenarioError(`walkTo: ${state.mapId} の (${s.walkTo.x}, ${s.walkTo.y}) へ到達できません（現在地 (${state.player.x}, ${state.player.y})）`);
        for (const dir of path) {
          step({ type: "move", direction: dir });
          if (state.scene.kind === "battle") autoFight();
          if (state.scene.kind !== "field") break;
        }
      } else if ("face" in s) step({ type: "face", direction: s.face });
      else if ("move" in s) for (let i = 0; i < (s.times ?? 1); i++) step({ type: "move", direction: s.move });
      else if ("interact" in s) step({ type: "interact" });
      else if ("advance" in s) {
        if (s.advance === "once") step({ type: "advance" });
        else for (let guard = 0; guard < 100 && (state.scene.kind === "message" || state.scene.kind === "dialogue" || (state.scene.kind === "battle" && state.scene.battle.outcome !== "ongoing")); guard++) step({ type: "advance" });
      } else if ("learnSkill" in s) {
        const [board, node] = s.learnSkill.split("/") as [string, string];
        const status = engine.skillStatus(state, board, node);
        if (status !== "available") throw new ScenarioError(`learnSkill: ${s.learnSkill} は覚えられません（${{ learned: "覚え済み", short: "ポイント不足", locked: "隣のパネルが未習得", hidden: "まだ隠れている", available: "" }[status]}）`);
        step({ type: "learnSkill", board, node });
      } else if ("optimize" in s) {
        step(s.optimize === "hero" ? { type: "optimizeEquipment" } : { type: "optimizeEquipment", companion: s.optimize });
      } else if ("chooseTrait" in s) {
        const before = state;
        step({ type: "chooseTrait", trait: s.chooseTrait });
        if (state === before || !state.traits.includes(s.chooseTrait)) throw new ScenarioError(`chooseTrait: '${s.chooseTrait}' に転職できません（selectable と selectableWhen を確認）`);
      } else if ("input" in s) {
        if (state.scene.kind !== "input") throw new ScenarioError(`input: 文字入力の画面ではありません (scene=${state.scene.kind})`);
        step({ type: "submitText", text: s.input });
      } else if ("choose" in s) {
        if (state.scene.kind !== "choice" && state.scene.kind !== "prompt") throw new ScenarioError(`choose: 選択肢が表示されていません (scene=${state.scene.kind})`);
        const before = state;
        step({ type: "choose", choiceId: s.choose });
        if (state === before) throw new ScenarioError(`choose: 選択肢 '${s.choose}' は選べません`);
      } else if ("battle" in s) step(s.battle === "attack" ? { type: "battle", command: "attack", ...(s.target !== undefined ? { target: s.target } : {}) } : { type: "battle", command: s.battle });
      else if ("battleItem" in s) step({ type: "battle", command: "item", item: s.battleItem });
      else if ("skill" in s) step({ type: "battle", command: "skill", ability: s.skill });
      else if ("sceneInputs" in s) {
        if (state.scene.kind !== "custom") throw new ScenarioError(`sceneInputs: 独自画面が開いていません (scene=${state.scene.kind})`);
        outer: for (let r = 0; r < s.repeat; r++) for (const type of s.sceneInputs) {
          if (state.scene.kind !== "custom") break outer;
          step({ type: "sceneInput", input: { type } });
        }
      }
      else if ("framesLoop" in s) {
        if (state.scene.kind !== "custom") throw new ScenarioError(`framesLoop: リアルタイム画面が開いていません (scene=${state.scene.kind})`);
        const opened = state.scene;
        const same = () => state.scene.kind === "custom" && state.scene.system === opened.system && state.scene.scene === opened.scene;
        outer: for (let r = 0; r < s.repeat; r++) for (const part of s.framesLoop) for (let i = 0; i < part.frames; i++) {
          step({ type: "sceneInput", input: { type: "frame", held: part.hold } });
          if (!same()) break outer;
        }
      }
      else if ("frames" in s) {
        if (state.scene.kind !== "custom") throw new ScenarioError(`frames: リアルタイム画面が開いていません (scene=${state.scene.kind})`);
        const opened = state.scene;
        for (let i = 0; i < s.frames; i++) {
          step({ type: "sceneInput", input: { type: "frame", held: s.hold } });
          const now = state.scene;
          if (now.kind !== "custom" || now.system !== opened.system || now.scene !== opened.scene) break;
        }
      }
      else if ("equip" in s) {
        if (state.scene.kind !== "field") throw new ScenarioError(`equip: フィールドではありません (scene=${state.scene.kind})`);
        step({ type: "equip", item: s.equip, ...(s.companion ? { companion: s.companion } : {}) });
      }
      else if ("routes" in s) {
        for (let i = 0; i < 500 && state.routes?.length; i++) step({ type: "routeStep" });
        if (state.routes?.length) throw new ScenarioError("routes: 500歩で終わりませんでした");
      }
      else if ("command" in s) {
        const where = state.scene.kind === "battle" ? "battle" : "field";
        const all = engine.commands(state, where);
        const cmd = all.find(x => (x.id === s.command || x.label === s.command) && (!s.source || x.source === s.source || x.source.startsWith(`${s.source}@`)));
        if (!cmd) throw new ScenarioError(`command: '${s.command}' がありません（今あるコマンド: ${all.map(x => `${x.label}(${x.id})`).join("、") || "なし"}）`);
        if (cmd.blocked) throw new ScenarioError(`command: '${s.command}' は使えません: ${cmd.blocked}`);
        step(where === "battle" ? { type: "battle", command: "script", source: cmd.source, id: cmd.id } : { type: "command", source: cmd.source, id: cmd.id });
      }
      else if ("battleOrder" in s) step({ type: "battle", command: "order", companion: s.battleOrder.companion, action: s.battleOrder.action });
      else if ("verb" in s) {
        if (!content.project.verbs[s.verb]) throw new ScenarioError(`verb: 動詞 '${s.verb}' がありません`);
        if (state.scene.kind !== "field") throw new ScenarioError(`verb: フィールドではありません (scene=${state.scene.kind})`);
        step({ type: "verb", verb: s.verb });
      }
      else if ("tick" in s) for (let i = 0; i < s.tick && state.scene.kind === "field"; i++) step({ type: "tick" });
      else if ("sceneInput" in s) {
        if (state.scene.kind !== "custom") throw new ScenarioError(`sceneInput: 独自画面が開いていません (scene=${state.scene.kind})`);
        step({ type: "sceneInput", input: typeof s.sceneInput === "string" ? { type: s.sceneInput } : { type: "custom", value: s.sceneInput.custom } });
      }
      else if ("useItem" in s) step({ type: "useItem", item: s.useItem });
      else if ("useAbility" in s) step({ type: "useAbility", ability: s.useAbility });
      else if ("fight" in s) autoFight();
      else if ("effects" in s) state = engine.run(state, s.effects).state;
      else if ("saveAndLoad" in s) {
        if (state.scene.kind !== "field") throw new ScenarioError("saveAndLoad: フィールド以外ではセーブできません");
        state = JSON.parse(JSON.stringify(state)) as GameState;
      } else if ("expect" in s) check(s.expect);
    } catch (error) {
      return { name: scenario.name, ok: false, failedStep: index, steps: scenario.steps.length, message: error instanceof Error ? error.message : String(error), state };
    }
  }
  return { name: scenario.name, ok: true, steps: scenario.steps.length, state };
}

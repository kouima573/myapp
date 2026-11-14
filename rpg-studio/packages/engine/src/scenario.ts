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
  scene: z.enum(["field", "message", "dialogue", "choice", "battle"]).optional(),
  flags: z.record(z.string(), z.boolean()).optional(),
  abilities: z.array(IdSchema).optional(),
  lacksAbilities: z.array(IdSchema).optional(),
  items: z.record(z.string(), z.number().int().nonnegative()).optional(),
  done: z.array(z.string()).optional(),
  notDone: z.array(z.string()).optional(),
  hpAtLeast: z.number().int().optional(),
  passable: z.array(z.object({ x: z.number().int(), y: z.number().int(), is: z.boolean() }).strict()).optional(),
  battleOutcome: z.enum(["ongoing", "victory", "defeat", "fled"]).optional(),
  textIncludes: z.string().optional(),
}).strict();

const StepSchema = z.union([
  z.object({ walkTo: z.object({ x: z.number().int(), y: z.number().int() }).strict() }).strict(),
  z.object({ face: DirectionSchema }).strict(),
  z.object({ move: DirectionSchema, times: z.number().int().positive().optional() }).strict(),
  z.object({ interact: z.literal(true) }).strict(),
  z.object({ advance: z.enum(["once", "all"]) }).strict(),
  z.object({ choose: IdSchema }).strict(),
  z.object({ battle: z.enum(["attack", "guard", "flee"]) }).strict(),
  z.object({ battleItem: IdSchema }).strict(),
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
}

class ScenarioError extends Error {}

function textOf(content: GameContent, state: GameState): string {
  const scene = state.scene;
  if (scene.kind === "message") return scene.text;
  if (scene.kind === "dialogue") return content.dialogues[scene.dialogueId]?.lines[scene.line] ?? "";
  if (scene.kind === "choice") return content.dialogues[scene.dialogueId]?.lines.at(-1) ?? "";
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
    for (const id of expect.abilities ?? []) if (!state.abilities.includes(id)) fail(`能力 ${id} がありません`);
    for (const id of expect.lacksAbilities ?? []) if (state.abilities.includes(id)) fail(`能力 ${id} を持っています`);
    for (const [id, count] of Object.entries(expect.items ?? {})) if ((state.items[id] ?? 0) !== count) fail(`items.${id}: 期待 ${count} / 実際 ${state.items[id] ?? 0}`);
    for (const id of expect.done ?? []) if (!state.done.includes(id)) fail(`done に ${id} がありません`);
    for (const id of expect.notDone ?? []) if (state.done.includes(id)) fail(`done に ${id} があります`);
    if (expect.hpAtLeast !== undefined && state.player.hp < expect.hpAtLeast) fail(`HP: ${expect.hpAtLeast}以上を期待 / 実際 ${state.player.hp}`);
    for (const cell of expect.passable ?? []) if (engine.isPassable(state, cell.x, cell.y) !== cell.is) fail(`(${cell.x}, ${cell.y}) の通行可否: 期待 ${cell.is}`);
    if (expect.battleOutcome && (state.scene.kind !== "battle" || state.scene.battle.outcome !== expect.battleOutcome)) fail(`戦闘結果: 期待 ${expect.battleOutcome}`);
    if (expect.textIncludes && !textOf(content, state).includes(expect.textIncludes)) fail(`表示テキストに「${expect.textIncludes}」がありません（実際: 「${textOf(content, state)}」）`);
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
        else for (let guard = 0; guard < 100 && (state.scene.kind === "message" || state.scene.kind === "dialogue"); guard++) step({ type: "advance" });
      } else if ("choose" in s) {
        if (state.scene.kind !== "choice") throw new ScenarioError(`choose: 選択肢が表示されていません (scene=${state.scene.kind})`);
        const before = state;
        step({ type: "choose", choiceId: s.choose });
        if (state === before) throw new ScenarioError(`choose: 選択肢 '${s.choose}' は選べません`);
      } else if ("battle" in s) step({ type: "battle", command: s.battle });
      else if ("battleItem" in s) step({ type: "battle", command: "item", item: s.battleItem });
      else if ("fight" in s) autoFight();
      else if ("effects" in s) state = engine.run(state, s.effects).state;
      else if ("saveAndLoad" in s) {
        if (state.scene.kind !== "field") throw new ScenarioError("saveAndLoad: フィールド以外ではセーブできません");
        state = JSON.parse(JSON.stringify(state)) as GameState;
      } else if ("expect" in s) check(s.expect);
    } catch (error) {
      return { name: scenario.name, ok: false, failedStep: index, steps: scenario.steps.length, message: error instanceof Error ? error.message : String(error) };
    }
  }
  return { name: scenario.name, ok: true, steps: scenario.steps.length };
}

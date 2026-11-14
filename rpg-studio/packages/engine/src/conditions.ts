import type { CompareOp, Condition, CtxName, Expr, GameContent, GameState, Stats, StatMods } from "../../schema/src/formats";

/**
 * Evaluation environment. `content` is needed for trait abilities, stat modifiers and enemy data;
 * `ctx` carries trigger-specific numbers such as the damage being dealt.
 */
export interface EvalEnv {
  content?: GameContent;
  ctx?: Partial<Record<CtxName, number>>;
  /** Internal: evaluate {"stat"} as base stats (avoids recursion inside statMods). */
  baseStats?: boolean;
}

const MAX_DEPTH = 64;

/** Abilities held directly plus those granted by current traits. */
export function abilitiesOf(state: GameState, content?: GameContent): string[] {
  if (!content) return state.abilities;
  const set = new Set(state.abilities);
  for (const id of state.traits ?? []) for (const ability of content.database.traits.find(t => t.id === id)?.abilities ?? []) set.add(ability);
  return [...set];
}

/** Every stat-modifying source the player currently has: abilities, traits and carried items. */
export function modSources(state: GameState, content: GameContent): StatMods[] {
  const out: StatMods[] = [];
  for (const id of abilitiesOf(state, content)) { const a = content.database.abilities.find(x => x.id === id); if (a?.statMods) out.push(a.statMods); }
  for (const id of state.traits ?? []) { const t = content.database.traits.find(x => x.id === id); if (t?.statMods) out.push(t.statMods); }
  for (const id of Object.keys(state.items)) { const i = content.database.items.find(x => x.id === id); if (i?.statMods) out.push(i.statMods); }
  return out;
}

export function effectiveStats(state: GameState, content?: GameContent): Stats {
  const base = state.player.stats;
  if (!content) return { ...base };
  const env: EvalEnv = { content, baseStats: true };
  const result = { ...base };
  for (const mods of modSources(state, content)) {
    for (const key of ["maxHp", "attack", "defense"] as const) {
      const expr = mods[key];
      if (expr !== undefined) result[key] += evalExpr(expr, state, env);
    }
  }
  return { maxHp: Math.max(1, result.maxHp), attack: Math.max(0, result.attack), defense: Math.max(0, result.defense) };
}

function battleOf(state: GameState) {
  return state.scene.kind === "battle" ? state.scene.battle : null;
}

function ctxValue(name: CtxName, state: GameState, env: EvalEnv): number {
  const given = env.ctx?.[name];
  if (given !== undefined) return given;
  const battle = battleOf(state);
  if (!battle) return 0;
  const enemy = env.content?.database.enemies.find(e => e.id === battle.enemyId);
  switch (name) {
    case "turn": return battle.turn;
    case "enemyHp": return battle.enemyHp;
    case "enemyMaxHp": return enemy?.stats.maxHp ?? 0;
    case "enemyAttack": return enemy?.stats.attack ?? 0;
    case "enemyDefense": return enemy?.stats.defense ?? 0;
    default: return 0;
  }
}

export function evalExpr(expr: Expr, state: GameState, env: EvalEnv = {}, depth = 0): number {
  if (depth > MAX_DEPTH) throw new Error("式が深すぎます");
  if (typeof expr === "number") return Math.trunc(expr);
  const e = (x: Expr) => evalExpr(x, state, env, depth + 1);
  if ("var" in expr) return state.vars?.[expr.var] ?? env.content?.project.variables[expr.var]?.initial ?? 0;
  if ("count" in expr) return state.items[expr.count] ?? 0;
  if ("stat" in expr) return env.baseStats ? state.player.stats[expr.stat] : effectiveStats(state, env.content)[expr.stat];
  if ("hp" in expr) return state.player.hp;
  if ("steps" in expr) return state.steps;
  if ("ctx" in expr) return ctxValue(expr.ctx, state, env);
  if ("add" in expr) return expr.add.reduce<number>((sum, x) => sum + e(x), 0);
  if ("sub" in expr) return e(expr.sub[0]) - e(expr.sub[1]);
  if ("mul" in expr) return expr.mul.reduce<number>((p, x) => p * e(x), 1);
  if ("div" in expr) { const d = e(expr.div[1]); return d === 0 ? 0 : Math.floor(e(expr.div[0]) / d); }
  if ("mod" in expr) { const d = e(expr.mod[1]); return d === 0 ? 0 : ((e(expr.mod[0]) % d) + d) % d; }
  if ("min" in expr) return Math.min(...expr.min.map(e));
  if ("max" in expr) return Math.max(...expr.max.map(e));
  if ("percent" in expr) return Math.floor((e(expr.percent[0]) * e(expr.percent[1])) / 100);
  if ("if" in expr) return evaluate(expr.if, state, env) ? e(expr.then) : e(expr.else);
  return 0;
}

export function compare(left: number, op: CompareOp, right: number): boolean {
  switch (op) {
    case "==": return left === right;
    case "!=": return left !== right;
    case ">": return left > right;
    case ">=": return left >= right;
    case "<": return left < right;
    case "<=": return left <= right;
  }
}

export function evaluate(condition: Condition | undefined, state: GameState, env: EvalEnv = {}): boolean {
  if (!condition) return true;
  if ("all" in condition) return condition.all.every(c => evaluate(c, state, env));
  if ("any" in condition) return condition.any.some(c => evaluate(c, state, env));
  if ("not" in condition) return !evaluate(condition.not, state, env);
  if ("flag" in condition) return (state.flags[condition.flag] ?? false) === (condition.is ?? true);
  if ("var" in condition) return compare(evalExpr({ var: condition.var }, state, env), condition.op, evalExpr(condition.value, state, env));
  if ("compare" in condition) return compare(evalExpr(condition.compare[0], state, env), condition.compare[1], evalExpr(condition.compare[2], state, env));
  if ("ability" in condition) return abilitiesOf(state, env.content).includes(condition.ability);
  if ("trait" in condition) return (state.traits ?? []).includes(condition.trait);
  if ("item" in condition) return (state.items[condition.item] ?? 0) >= (condition.atLeast ?? 1);
  if ("done" in condition) return state.done.includes(condition.done);
  if ("map" in condition) return state.mapId === condition.map;
  if ("inBattle" in condition) return (state.scene.kind === "battle") === condition.inBattle;
  if ("enemy" in condition) return battleOf(state)?.enemyId === condition.enemy;
  if ("enemyTag" in condition) {
    const battle = battleOf(state);
    const enemy = battle && env.content?.database.enemies.find(e => e.id === battle.enemyId);
    return Boolean(enemy?.tags.includes(condition.enemyTag));
  }
  return false;
}

/**
 * Text templates: {{var.gold}} {{item.herb}} {{stat.attack}} {{hp}} {{maxHp}} {{name}} {{flag.x}} {{ctx.damage}} {{enemy}} {{trait.<category>}}
 * Unknown tokens are left as-is so mistakes are visible.
 */
export function interpolate(text: string, state: GameState, env: EvalEnv = {}): string {
  if (!text.includes("{{")) return text;
  return text.replace(/\{\{\s*([a-zA-Z]+)(?:\.([^}\s]+))?\s*\}\}/g, (whole, kind: string, key?: string) => {
    const content = env.content;
    switch (kind) {
      case "var": return key ? String(evalExpr({ var: key }, state, env)) : whole;
      case "item": return key ? String(state.items[key] ?? 0) : whole;
      case "stat": return key && ["maxHp", "attack", "defense"].includes(key) ? String(effectiveStats(state, content)[key as "attack"]) : whole;
      case "hp": return String(state.player.hp);
      case "maxHp": return String(effectiveStats(state, content).maxHp);
      case "name": return content?.project.player.name ?? whole;
      case "flag": return key ? (state.flags[key] ? "ON" : "OFF") : whole;
      case "ctx": return key ? String(ctxValue(key as CtxName, state, env)) : whole;
      case "enemy": { const b = battleOf(state); return b ? content?.database.enemies.find(e => e.id === b.enemyId)?.name ?? b.enemyId : whole; }
      case "trait": {
        if (!key || !content) return whole;
        const names = (state.traits ?? []).map(id => content.database.traits.find(t => t.id === id)).filter(t => t && t.category === key).map(t => t!.name);
        return names.join("・") || "なし";
      }
      default: return whole;
    }
  });
}

/** Deterministic PRNG (mulberry32). Returns [value in 0..1, next seed]. Seed lives in GameState so saves replay identically. */
export function nextRandom(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let r = Math.imul(next ^ (next >>> 15), next | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, next];
}

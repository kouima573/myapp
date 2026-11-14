import type { Condition, GameState } from "../../schema/src/formats";

export function evaluate(condition: Condition | undefined, state: GameState): boolean {
  if (!condition) return true;
  if ("all" in condition) return condition.all.every(c => evaluate(c, state));
  if ("any" in condition) return condition.any.some(c => evaluate(c, state));
  if ("not" in condition) return !evaluate(condition.not, state);
  if ("flag" in condition) return (state.flags[condition.flag] ?? false) === (condition.is ?? true);
  if ("ability" in condition) return state.abilities.includes(condition.ability);
  if ("item" in condition) return (state.items[condition.item] ?? 0) >= (condition.atLeast ?? 1);
  if ("done" in condition) return state.done.includes(condition.done);
  return false;
}

/** Deterministic PRNG (mulberry32). Returns [value in 0..1, next seed]. Seed lives in GameState so saves replay identically. */
export function nextRandom(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let r = Math.imul(next ^ (next >>> 15), next | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, next];
}

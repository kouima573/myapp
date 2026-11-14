import type { BattleState, Effect, Enemy, GameContent, GameMap, GameState, TileDef } from "../../schema/src/formats";

/**
 * Extension contract for project systems (`projects/<id>/systems/*.ts`).
 *
 * All hooks are synchronous and pure: they receive state and return values, never mutate.
 * Systems run in ascending `priority` (default 0), then by id. See docs/extension-api.md.
 */
export interface SystemContext {
  content: GameContent;
  state: GameState;
}

export interface DamageContext extends SystemContext {
  battle: BattleState;
  enemy: Enemy;
  /** Who receives the damage. */
  target: "player" | "enemy";
  /** Damage after the formula and earlier systems' modifyDamage. */
  amount: number;
  /** This system's per-battle scratch data (battle.systemData[system.id]). */
  battleData: unknown;
}

export interface LethalContext extends DamageContext {
  hpBefore: number;
}

export interface LethalOutcome {
  /** HP to commit instead of 0. Must be ≥ 0. */
  hp: number;
  message?: string;
  /** Replaces this system's per-battle scratch data. */
  battleData?: unknown;
}

export interface PassContext extends SystemContext {
  map: GameMap;
  x: number;
  y: number;
  tile: TileDef | undefined;
  /** Result of the data rules (tile passability, NPCs, solid objects). */
  passable: boolean;
}

export interface SystemActionResult {
  /** Replacement state (optional). */
  state?: GameState;
  /** Effects to run next (before anything already queued). */
  effects?: Effect[];
  /** Lines for the debug/studio log. */
  log?: string[];
}

export interface GameSystem {
  id: string;
  priority?: number;
  /** Step ②: adjust the computed damage (buffs, resistances). Return a number to replace it. */
  modifyDamage?(ctx: DamageContext): number | void;
  /** Step ③: called only when the damage would bring the player to 0 HP. First outcome wins. */
  onLethalDamage?(ctx: LethalContext): LethalOutcome | void;
  /** Override passability (e.g. swimming). Return undefined to keep the data rule. */
  canPass?(ctx: PassContext): boolean | void;
  /** Called after a battle is created; return initial per-battle data for this system. */
  onBattleStart?(ctx: SystemContext & { battle: BattleState; enemy: Enemy }): unknown;
  /** Custom actions invoked from data via `{ "type": "system", "system": id, "action": name }`. */
  actions?: Record<string, (ctx: SystemContext, args: Record<string, unknown>) => SystemActionResult>;
}

/** Identity helper that gives project code full type checking. */
export function defineSystem<T extends GameSystem>(system: T): T {
  return system;
}

export function sortSystems(systems: readonly GameSystem[]): GameSystem[] {
  return [...systems].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id));
}

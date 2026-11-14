import type { BattleState, Effect, Enemy, GameContent, GameMap, GameState, TileDef } from "../../schema/src/formats";

/**
 * Extension contract for project systems (`projects/<id>/systems/*.ts`).
 *
 * A system can add new conditions, expression functions, effects (actions), whole screens (scenes),
 * map overlays and HUD lines, and react to steps / ticks / damage. Logic hooks are synchronous and pure:
 * they receive state and return values, never mutate. Systems run in ascending `priority` (default 0), then by id.
 * See docs/extension-api.md.
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

/** Input delivered to a custom scene. Keys are mapped to the first six; buttons rendered by the scene can send anything. */
export type SceneInput =
  | { type: "up" | "down" | "left" | "right" | "confirm" | "cancel" }
  | { type: "custom"; value: unknown };

export interface SceneResult {
  /** New scene data (JSON). */
  data?: unknown;
  /** Close the scene and return to the field. */
  close?: boolean;
  /** Effects to run after closing (or immediately queued when not closing). */
  effects?: Effect[];
  /** Replacement game state (e.g. inventory changes). */
  state?: GameState;
  log?: string[];
}

export interface SceneView {
  data: unknown;
  state: GameState;
  content: GameContent;
  /** Send an input to `input()`; use for clickable buttons. */
  send(input: SceneInput): void;
  /** Resolve an asset id to a URL (images). */
  assetUrl(id: string): string | undefined;
}

/**
 * A whole screen: puzzle, card battle, crafting, map overview, rhythm minigame…
 * `start`/`input` are pure and run in tests; `render` only runs in the browser.
 */
export interface SceneDefinition {
  start?(ctx: SystemContext, args: Record<string, unknown>): unknown;
  input(ctx: SystemContext, data: unknown, input: SceneInput): SceneResult;
  render?(host: HTMLElement, view: SceneView): void;
}

export interface OverlayContext extends SystemContext {
  map: GameMap;
  /** Pixel offset of tile (0,0) on the canvas, and tile size in pixels. */
  originX: number;
  originY: number;
  tileSize: number;
  /** Player position in tiles (fractional while walking). */
  player: { x: number; y: number };
  width: number;
  height: number;
  time: number;
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
  /** Custom conditions: data `{ "custom": "<id>.<name>", "args": {...} }`. */
  conditions?: Record<string, (ctx: SystemContext, args: Record<string, unknown>) => boolean>;
  /** Custom expression functions: data `{ "fn": "<id>.<name>", "args": [expr, ...] }`. */
  functions?: Record<string, (ctx: SystemContext, args: number[]) => number>;
  /** Custom screens: data `{ "type": "startScene", "system": id, "scene": name, "args": {...} }`. */
  scenes?: Record<string, SceneDefinition>;
  /** After every successful player step (field). */
  onStep?(ctx: SystemContext): SystemActionResult | void;
  /** Every world tick (entities move on ticks; the runtime ticks ~3 times per second in the field). */
  onTick?(ctx: SystemContext): SystemActionResult | void;
  /** Draw on top of the map (lighting, weather, fog of war, highlights). Browser only. */
  drawOverlay?(ctx2d: CanvasRenderingContext2D, ctx: OverlayContext): void;
  /** Extra HUD lines in the field. */
  hud?(ctx: SystemContext): string[];
}

/** Identity helper that gives project code full type checking. */
export function defineSystem<T extends GameSystem>(system: T): T {
  return system;
}

export function sortSystems(systems: readonly GameSystem[]): GameSystem[] {
  return [...systems].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id));
}

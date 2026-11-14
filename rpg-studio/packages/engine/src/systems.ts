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

/** A player action as the engine receives it ({ type: "move", direction }, { type: "verb", verb }, { type: "interact" }…). */
export interface PlayerAction { type: string; [key: string]: unknown }

/** onAction may rewrite or swallow the player's action before the engine handles it. */
export interface ActionHookResult extends SystemActionResult {
  /** Handle this action instead (e.g. mirrored controls: move left → move right). */
  action?: PlayerAction;
  /** Swallow the action (state / effects / log still apply). */
  cancel?: boolean;
}

/** Input delivered to a custom scene. Keys are mapped to the first six; buttons rendered by the scene can send anything. */
export type SceneInput =
  | { type: "up" | "down" | "left" | "right" | "confirm" | "cancel" }
  | { type: "custom"; value: unknown }
  /** Realtime scenes: one fixed simulation step with the buttons currently held ("up","down","left","right","fire","focus"). */
  | { type: "frame"; held: string[] };

/** Click position sent to realtime scenes, in canvas pixels (the canvas size is included so scenes can map it). */
export interface SceneClick { x: number; y: number; width: number; height: number }

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
  /** Effects applied right now while the scene stays open (stats, variables, items…). Text and screen effects wait until it closes. */
  apply?: Effect[];
  /** Scenes started as a battle mode: how the battle ended. The RPG battle result (drops, rules, defeat) follows. */
  outcome?: "victory" | "defeat" | "fled";
  /** Lines for the RPG battle result screen. */
  battleLog?: string[];
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
  /** Short description shown in the studio and docs. */
  title?: string;
  start?(ctx: SystemContext, args: Record<string, unknown>): unknown;
  input(ctx: SystemContext, data: unknown, input: SceneInput): SceneResult;
  /** DOM screen (menus, novels, puzzles). Called after every input. */
  render?(host: HTMLElement, view: SceneView): void;
  /** Realtime scenes: the runtime sends {type:"frame"} `fps` times per second and calls `draw` every animation frame. */
  /**
   * Realtime scenes. `players: 2` = local two-player: player 1 uses WASD + F (fire) + G (focus), player 2 the arrows +
   * Enter/. (fire) + / (focus); held buttons for player 2 are prefixed "p2" ("p2left", "p2fire"…).
   * Clicks on the canvas arrive as { type: "custom", value: { click: { x, y, width, height } } } (canvas pixels).
   */
  realtime?: { fps: number; players?: 1 | 2 };
  draw?(ctx2d: CanvasRenderingContext2D, view: SceneView & { width: number; height: number; time: number }): void;
  /** Validates `args` (used by rpg validate for built-in modules). Return error messages. */
  checkArgs?(args: Record<string, unknown>, ctx: { content: GameContent }): string[];
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
  /**
   * Before the engine handles any player action. Rewrite it (`action`), swallow it (`cancel`), or add effects.
   * Use it to change the rules of control itself: mirrored worlds, ice floors, moving two characters at once,
   * turn-based time where every action costs something, a hero who cannot stop walking…
   */
  onAction?(ctx: SystemContext, action: PlayerAction): ActionHookResult | void;
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

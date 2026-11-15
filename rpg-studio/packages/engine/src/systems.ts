import { nextRandom } from "./conditions";
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
  /**
   * For scripts attached to data: what the script is attached to and the `args` written next to it
   * (`"script": { "id": "meteor", "args": { "power": 9 } }`). Undefined for project-wide systems.
   */
  self?: ScriptSelf;
}

/** What an attached script belongs to. `index` = position of the enemy in the battle (0 = first). */
export interface ScriptSelf {
  kind: "ability" | "item" | "trait" | "enemy" | "companion" | "map" | "entity" | "npc" | "interactable" | "region" | "effect" | "command";
  id: string;
  args: Record<string, unknown>;
  index?: number;
  /** Storage key of this attachment (state.systemData / battle.systemData). */
  key?: string;
}

/** An extra command a script adds to the battle menu and/or the field menu. */
export interface ScriptCommand {
  /** Name of the script's action to run (`actions[id]`), or "use" for `use`. */
  id: string;
  label: string;
  where?: "battle" | "field" | "both";
  /** Shown greyed out with this reason. */
  blocked?: string;
  /** Battle: whether it uses the hero's turn (default true). */
  endsTurn?: boolean;
  args?: Record<string, unknown>;
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
  /**
   * "attached" (scripts/*.ts): hooks run only while something that names the script in `script` is active.
   * Default "global" (systems listed in project.json): always active.
   */
  scope?: "global" | "attached";
  /** Ability / item use, or the data effect { "type": "script", "script": id }. Runs after the data `use.effects`. */
  use?(ctx: SystemContext, args: Record<string, unknown>): SystemActionResult | void;
  /** Extra commands for the battle menu / field menu (spells nobody planned for, combos, transformations…). */
  commands?(ctx: SystemContext & { where: "battle" | "field" }): ScriptCommand[];
  /** Replace one enemy's turn (it is the first enemy while acting). Return a result to replace the default action. */
  enemyTurn?(ctx: SystemContext & { battle: BattleState; enemy: Enemy }): SystemActionResult | void;
  /** Replace a companion's turn. `ctx.companion` is its id. */
  companionTurn?(ctx: SystemContext & { battle: BattleState; companion: string }): SystemActionResult | void;
  /** After every battle turn (after enemies acted). */
  onTurnEnd?(ctx: SystemContext & { battle: BattleState }): SystemActionResult | void;
  /** When a battle ends (victory / defeat / fled), before the result is applied. */
  onBattleEnd?(ctx: SystemContext & { battle: BattleState }): SystemActionResult | void;
  /** After entering a map (warp, door, start). */
  onMapEnter?(ctx: SystemContext): SystemActionResult | void;
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

/** For scripts/*.ts: the id defaults to the file name. Every GameSystem hook is available. */
export type ScriptDefinition = Omit<GameSystem, "id" | "scope"> & { id?: string };
export function defineScript<T extends ScriptDefinition>(script: T): T & { scope: "attached" } {
  return { ...script, scope: "attached" as const };
}

const HOOKS = ["modifyDamage", "onLethalDamage", "canPass", "onBattleStart", "onAction", "onStep", "onTick", "hud", "use", "commands", "enemyTurn", "companionTurn", "onTurnEnd", "onBattleEnd", "onMapEnter"] as const;

/** A copy of an attached script whose hooks see `ctx.self` (and keep their own per-battle data under `key`). */
export function bindScript(system: GameSystem, self: ScriptSelf, key: string): GameSystem {
  self = { ...self, key };
  const out: Record<string, unknown> = { ...system, id: key, scope: "attached" };
  const src = system as unknown as Record<string, unknown>;
  for (const hook of HOOKS) {
    const fn = src[hook];
    if (typeof fn === "function") out[hook] = (ctx: object, ...rest: unknown[]) => (fn as (...a: unknown[]) => unknown).call(system, { ...ctx, self }, ...rest);
  }
  if (typeof system.drawOverlay === "function") out.drawOverlay = (g: CanvasRenderingContext2D, ctx: OverlayContext) => system.drawOverlay!.call(system, g, { ...ctx, self });
  if (system.actions) out.actions = Object.fromEntries(Object.entries(system.actions).map(([name, fn]) => [name, (ctx: SystemContext, args: Record<string, unknown>) => fn.call(system, { ...ctx, self }, args)]));
  return out as unknown as GameSystem;
}

/* ------------------------------------------------------------------ memory helpers for scripts and systems */
const keyOf = (ctx: SystemContext, id?: string) => id ?? ctx.self?.key ?? ctx.self?.id ?? "script";
/** Saved with the game (state.systemData). */
export function memory<T>(ctx: SystemContext, fallback: T, id?: string): T {
  const value = ctx.state.systemData[keyOf(ctx, id)];
  return value === undefined ? fallback : (value as T);
}
export function remember(ctx: SystemContext, value: unknown, id?: string): GameState {
  return { ...ctx.state, systemData: { ...ctx.state.systemData, [keyOf(ctx, id)]: value } };
}
/** Reset every battle (battle.systemData). Outside a battle returns the fallback / unchanged state. */
export function battleMemory<T>(ctx: SystemContext, fallback: T, id?: string): T {
  const scene = ctx.state.scene;
  if (scene.kind !== "battle") return fallback;
  const value = scene.battle.systemData[keyOf(ctx, id)];
  return value === undefined ? fallback : (value as T);
}
export function rememberInBattle(ctx: SystemContext, value: unknown, id?: string): GameState {
  const scene = ctx.state.scene;
  if (scene.kind !== "battle") return ctx.state;
  return { ...ctx.state, scene: { ...scene, battle: { ...scene.battle, systemData: { ...scene.battle.systemData, [keyOf(ctx, id)]: value } } } };
}
/** Deterministic random number in [0, 1) and the state with the advanced seed. */
export function roll(state: GameState): [number, GameState] {
  const [value, rng] = nextRandom(state.rng);
  return [value, { ...state, rng }];
}
/** Change the HP of an enemy in the current battle (index 0 = first). Negative = damage. Victory is checked by the engine afterwards. */
export function changeEnemyHp(state: GameState, delta: number, index = 0): GameState {
  const scene = state.scene;
  if (scene.kind !== "battle") return state;
  const b = scene.battle;
  if (index === 0) return { ...state, scene: { ...scene, battle: { ...b, enemyHp: Math.max(0, b.enemyHp + delta) } } };
  const foes = (b.foes ?? []).map((f, i) => (i === index - 1 ? { ...f, hp: Math.max(0, f.hp + delta) } : f));
  return { ...state, scene: { ...scene, battle: { ...b, foes } } };
}
/** Add a line to the battle log. */
export function battleSay(state: GameState, line: string): GameState {
  const scene = state.scene;
  if (scene.kind !== "battle") return state;
  return { ...state, scene: { ...scene, battle: { ...scene.battle, log: [...scene.battle.log, line] } } };
}

/** Identity helper that gives project code full type checking. */
export function defineSystem<T extends GameSystem>(system: T): T {
  return system;
}

export function sortSystems(systems: readonly GameSystem[]): GameSystem[] {
  return [...systems].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id));
}

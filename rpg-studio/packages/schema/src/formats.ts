/**
 * Shared data contract for RPG projects (production data format v2) and player saves (save format v2).
 *
 * Everything a game needs is described as data here. The engine must never hard-code a sample's
 * IDs (flags, abilities, tiles, enemies). Project-specific rules belong in `projects/<id>/systems/*.ts`.
 */
import { z } from "zod";
import { SONG_WAVES, parseNotes, type Song, type SongEvent, type SongTrack, type SongWave } from "./song";
export { SONG_WAVES, parseNotes, type Song, type SongEvent, type SongTrack, type SongWave };

import { ENGINE_VERSION, PROJECT_FORMAT_VERSION, SAVE_FORMAT_VERSION } from "./constants";
export { ENGINE_VERSION, PROJECT_FORMAT_VERSION, SAVE_FORMAT_VERSION };

export const IdSchema = z.string().min(1).max(96).regex(/^[a-z0-9][a-z0-9._-]*$/i, "IDは英数字で始まり、英数字・._-のみ使えます");
/** "builtin" (command battle) or "<module or system id>.<scene>" e.g. "shooter.battle", "cards.battle". */
export const BattleModeSchema = z.string().regex(/^(builtin|[a-z0-9][a-z0-9._-]*\.[a-z0-9][a-z0-9_-]*)$/i, "戦闘モードは builtin か 'モジュールID.画面名' です");
const RelPathSchema = z.string().min(1).max(240).refine(value => !value.includes("\\") && !value.startsWith("/") && !value.split("/").some(part => part === "" || part === "." || part === ".."), "プロジェクト相対のPOSIXパスを指定してください");
const CoordSchema = z.number().int().nonnegative();
export const DirectionSchema = z.enum(["up", "down", "left", "right"]);
export type Direction = z.infer<typeof DirectionSchema>;

/* ------------------------------------------------------------------ Expressions */

export const STAT_NAMES = ["maxHp", "attack", "defense"] as const;
export type StatName = (typeof STAT_NAMES)[number];
export const CTX_NAMES = ["damage", "turn", "enemyHp", "enemyMaxHp", "enemyAttack", "enemyDefense", "attack", "defense", "power", "variance"] as const;
export type CtxName = (typeof CTX_NAMES)[number];
export const COMPARE_OPS = ["==", "!=", ">", ">=", "<", "<="] as const;
export type CompareOp = (typeof COMPARE_OPS)[number];

/**
 * Numeric expression (JSON, never eval'd). Integers result; division floors.
 *   12 | {"var":"gold"} | {"count":"herb"} | {"stat":"attack"} | {"hp":true} | {"steps":true} | {"ctx":"damage"} | {"level":true} | {"exp":true}
 *   {"add":[..]} {"sub":[a,b]} {"mul":[..]} {"div":[a,b]} {"mod":[a,b]} {"min":[..]} {"max":[..]} {"if":cond,"then":e,"else":e}
 *   {"percent":[value, pct]}  = floor(value * pct / 100)
 */
export type Expr =
  | number
  | { var: string }
  | { count: string }
  | { stat: StatName }
  | { hp: true }
  | { steps: true }
  | { level: true }
  | { exp: true }
  | { ctx: CtxName }
  | { add: Expr[] }
  | { sub: [Expr, Expr] }
  | { mul: Expr[] }
  | { div: [Expr, Expr] }
  | { mod: [Expr, Expr] }
  | { min: Expr[] }
  | { max: Expr[] }
  | { percent: [Expr, Expr] }
  | { size: string }
  | { cycle: true }
  | { ticks: true }
  | { fn: string; args?: Expr[] }
  | { if: Condition; then: Expr; else: Expr };

export const ExprSchema: z.ZodType<Expr> = z.lazy(() => z.union([
  z.number().finite(),
  z.object({ var: IdSchema }).strict(),
  z.object({ count: IdSchema }).strict(),
  z.object({ stat: z.enum(STAT_NAMES) }).strict(),
  z.object({ hp: z.literal(true) }).strict(),
  z.object({ steps: z.literal(true) }).strict(),
  z.object({ level: z.literal(true) }).strict(),
  z.object({ exp: z.literal(true) }).strict(),
  z.object({ ctx: z.enum(CTX_NAMES) }).strict(),
  z.object({ add: z.array(ExprSchema).min(1) }).strict(),
  z.object({ sub: z.tuple([ExprSchema, ExprSchema]) }).strict(),
  z.object({ mul: z.array(ExprSchema).min(1) }).strict(),
  z.object({ div: z.tuple([ExprSchema, ExprSchema]) }).strict(),
  z.object({ mod: z.tuple([ExprSchema, ExprSchema]) }).strict(),
  z.object({ min: z.array(ExprSchema).min(1) }).strict(),
  z.object({ max: z.array(ExprSchema).min(1) }).strict(),
  z.object({ percent: z.tuple([ExprSchema, ExprSchema]) }).strict(),
  z.object({ size: IdSchema }).strict(),
  z.object({ cycle: z.literal(true) }).strict(),
  z.object({ ticks: z.literal(true) }).strict(),
  z.object({ fn: z.string().regex(/^[a-z0-9][a-z0-9._-]*\.[a-z0-9][a-z0-9_-]*$/i, "fnは 'システムID.関数名' の形です"), args: z.array(ExprSchema).optional() }).strict(),
  z.object({ if: ConditionSchema, then: ExprSchema, else: ExprSchema }).strict(),
]));

/* ------------------------------------------------------------------ Conditions */

export type Condition =
  | { flag: string; is?: boolean }
  | { var: string; op: CompareOp; value: Expr }
  | { compare: [Expr, CompareOp, Expr] }
  | { ability: string }
  | { trait: string }
  | { status: string; target?: "player" | "enemy" }
  | { item: string; atLeast?: number }
  | { done: string }
  | { map: string }
  | { inBattle: boolean }
  | { enemy: string }
  | { enemyTag: string }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { set: string; has: string }
  | { inRegion: string }
  | { front: FrontCheck }
  | { target: string }
  | { entityAt: { entity: string; x?: number; y?: number; map?: string } }
  | { carrying: string }
  | { equipped: string }
  | { custom: string; args?: Record<string, unknown> };

/** What is in front of the player. Every given field must match. */
export interface FrontCheck { tile?: string; entity?: string; npc?: string; blocked?: boolean }

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() => z.union([
  z.object({ flag: IdSchema, is: z.boolean().optional() }).strict(),
  z.object({ var: IdSchema, op: z.enum(COMPARE_OPS), value: ExprSchema }).strict(),
  z.object({ compare: z.tuple([ExprSchema, z.enum(COMPARE_OPS), ExprSchema]) }).strict(),
  z.object({ ability: IdSchema }).strict(),
  z.object({ trait: IdSchema }).strict(),
  /** The hero (default) or the enemy being acted on has this status. */
  z.object({ status: IdSchema, target: z.enum(["player", "enemy"]).optional() }).strict(),
  z.object({ item: IdSchema, atLeast: z.number().int().positive().optional() }).strict(),
  z.object({ done: IdSchema }).strict(),
  z.object({ map: IdSchema }).strict(),
  z.object({ inBattle: z.boolean() }).strict(),
  z.object({ enemy: IdSchema }).strict(),
  z.object({ enemyTag: IdSchema }).strict(),
  z.object({ all: z.array(ConditionSchema).min(1) }).strict(),
  z.object({ any: z.array(ConditionSchema).min(1) }).strict(),
  z.object({ not: ConditionSchema }).strict(),
  z.object({ set: IdSchema, has: z.string().min(1) }).strict(),
  z.object({ inRegion: IdSchema }).strict(),
  /** The target chosen for the verb being used (verb.target). */
  z.object({ target: z.string().min(1) }).strict(),
  /** Where an entity is now (after moves, pushes, carrying). Omitted fields match anything. */
  z.object({ entityAt: z.object({ entity: IdSchema, x: CoordSchema.optional(), y: CoordSchema.optional(), map: IdSchema.optional() }).strict() }).strict(),
  /** This item is equipped. */
  z.object({ equipped: IdSchema }).strict(),
  /** The player is carrying this entity. */
  z.object({ carrying: IdSchema }).strict(),
  z.object({ front: z.object({ tile: z.string().length(1).optional(), entity: IdSchema.optional(), npc: IdSchema.optional(), blocked: z.boolean().optional() }).strict() }).strict(),
  z.object({ custom: z.string().regex(/^[a-z0-9][a-z0-9._-]*\.[a-z0-9][a-z0-9_-]*$/i, "customは 'システムID.条件名' の形です"), args: z.record(z.string(), z.unknown()).optional() }).strict(),
]));

/* ------------------------------------------------------------------ Effects */

export const VAR_OPS = ["set", "add", "sub", "mul", "div", "min", "max"] as const;
export type VarOp = (typeof VAR_OPS)[number];

export interface ChoiceOption { id?: string; label: string; when?: Condition; effects: Effect[] }
export interface InputAnswer { match: string[]; effects: Effect[] }

export type Effect =
  | { type: "message"; text: string; speaker?: string; portrait?: string; face?: number }
  | { type: "emote"; target: string; icon: string }
  | { type: "moveRoute"; target: string; steps: string[]; wait?: boolean; through?: boolean }
  | { type: "setFlag"; flag: string; value?: boolean }
  | { type: "setVar"; var: string; value: Expr; op?: VarOp }
  | { type: "random"; var: string; min: Expr; max: Expr }
  | { type: "chance"; percent: Expr; then: Effect[]; else?: Effect[] }
  | { type: "setStat"; stat: StatName; value: Expr; op?: VarOp }
  | { type: "unlockAbility"; ability: string }
  | { type: "removeAbility"; ability: string }
  | { type: "grantTrait"; trait: string }
  | { type: "removeTrait"; trait: string }
  | { type: "giveItem"; item: string; count?: number }
  | { type: "equip"; item: string; companion?: string }
  | { type: "unequip"; slot: string; companion?: string }
  | { type: "takeItem"; item: string; count?: number }
  | { type: "heal"; amount?: Expr; target?: "player" | "party" | "all" }
  | { type: "gainExp"; amount: Expr }
  | { type: "addStatus"; status: string; target?: "player" | "enemy" | "enemies" | "party"; turns?: number; chance?: Expr }
  | { type: "removeStatus"; status?: string; target?: "player" | "enemy" | "enemies" | "party" }
  | { type: "joinParty"; companion: string }
  | { type: "leaveParty"; companion: string }
  | { type: "damage"; target: "player" | "enemy" | "enemies" | "randomEnemy"; amount: Expr; text?: string; element?: string; hits?: number }
  | { type: "teleport"; mapId: string; x: number; y: number; facing?: Direction }
  | { type: "setTile"; mapId?: string; x: number; y: number; code: string }
  | { type: "dialogue"; dialogue: string }
  | { type: "choice"; prompt?: string; speaker?: string; options: ChoiceOption[] }
  | { type: "event"; event: string }
  | { type: "battle"; enemy: string; with?: string[]; waves?: Array<{ enemy: string; with?: string[] }>; onVictory?: Effect[]; onDefeat?: "respawn" | "continue"; canFlee?: boolean; mode?: string; args?: Record<string, unknown> }
  | { type: "battleLog"; text: string }
  | { type: "endBattle"; outcome: "victory" | "fled" }
  | { type: "markDone"; id: string }
  | { type: "playSfx"; sound: string }
  | { type: "addToSet"; set: string; value: string }
  | { type: "removeFromSet"; set: string; value: string }
  | { type: "clearSet"; set: string }
  | { type: "moveEntity"; entity: string; mapId?: string; x: number; y: number; facing?: Direction }
  | { type: "schedule"; id?: string; after: Expr; effects: Effect[] }
  | { type: "cancelSchedule"; id: string }
  | { type: "startScene"; system: string; scene: string; args?: Record<string, unknown> }
  | { type: "ending"; ending: string }
  | { type: "newCycle" }
  | { type: "playBgm"; music: string | null }
  | { type: "playAmbient"; sound: string | null }
  | { type: "showPicture"; slot?: string; image: string; at?: "center" | "left" | "right" | "full"; x?: number; y?: number; width?: number; opacity?: number; fadeMs?: number }
  | { type: "hidePicture"; slot?: string; fadeMs?: number }
  | { type: "unlockAchievement"; achievement: string }
  | { type: "camera"; focus?: "player" | { x: number; y: number }; zoom?: number; ms?: number; shake?: { power?: number; ms?: number } }
  | { type: "setFormation"; who: string; row?: "front" | "back"; reserve?: boolean }
  | { type: "input"; prompt?: string; speaker?: string; maxLength?: number; initial?: string; saveAs?: string; answers?: InputAnswer[]; otherwise?: Effect[] }
  | { type: "signal"; signal: string }
  | { type: "learnVerb"; verb: string }
  | { type: "forgetVerb"; verb: string }
  | { type: "useVerb"; verb: string; target?: string }
  | { type: "setPlayer"; name?: string | null; sprite?: string | null }
  | { type: "if"; when: Condition; then: Effect[]; else?: Effect[] }
  | { type: "system"; system: string; action: string; args?: Record<string, unknown> }
  | { type: "script"; script: string; call?: string; args?: Record<string, unknown> };

const ChoiceOptionSchema: z.ZodType<ChoiceOption> = z.lazy(() => z.object({
  id: IdSchema.optional(), label: z.string().min(1), when: ConditionSchema.optional(), effects: z.array(EffectSchema),
}).strict());

export const EffectSchema: z.ZodType<Effect> = z.lazy(() => z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), text: z.string().min(1), speaker: z.string().min(1).optional(), /** Face picture (portrait asset) and its frame (expression). */ portrait: IdSchema.optional(), face: z.number().int().min(0).optional() }).strict(),
  /** Speech-bubble icon over the hero ("player"), an NPC or an entity: "！" "？" "♪" "…" "♥" or any short text. */
  z.object({ type: z.literal("emote"), target: z.string().min(1), icon: z.string().min(1).max(4) }).strict(),
  /**
   * Walk the hero ("player") or an entity step by step: "up" "down" "left" "right", "face:left", "wait".
   * wait: true holds the following effects (and the player's input) until the route ends. through: ignore walls.
   */
  z.object({ type: z.literal("moveRoute"), target: z.string().min(1), steps: z.array(z.string().regex(/^(up|down|left|right|wait|face:(up|down|left|right))$/)).min(1).max(200), wait: z.boolean().optional(), through: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("setFlag"), flag: IdSchema, value: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("setVar"), var: IdSchema, value: ExprSchema, op: z.enum(VAR_OPS).optional() }).strict(),
  z.object({ type: z.literal("random"), var: IdSchema, min: ExprSchema, max: ExprSchema }).strict(),
  z.object({ type: z.literal("chance"), percent: ExprSchema, then: z.array(EffectSchema), else: z.array(EffectSchema).optional() }).strict(),
  z.object({ type: z.literal("setStat"), stat: z.enum(STAT_NAMES), value: ExprSchema, op: z.enum(VAR_OPS).optional() }).strict(),
  z.object({ type: z.literal("unlockAbility"), ability: IdSchema }).strict(),
  z.object({ type: z.literal("removeAbility"), ability: IdSchema }).strict(),
  z.object({ type: z.literal("grantTrait"), trait: IdSchema }).strict(),
  z.object({ type: z.literal("removeTrait"), trait: IdSchema }).strict(),
  z.object({ type: z.literal("giveItem"), item: IdSchema, count: z.number().int().positive().optional() }).strict(),
  z.object({ type: z.literal("takeItem"), item: IdSchema, count: z.number().int().positive().optional() }).strict(),
  /** target: "player" (default), "party" (companions, also revives the fallen) or "all". */
  z.object({ type: z.literal("heal"), amount: ExprSchema.optional(), target: z.enum(["player", "party", "all"]).optional() }).strict(),
  /** Experience points (project.leveling). Levels up as many times as needed. */
  z.object({ type: z.literal("gainExp"), amount: ExprSchema }).strict(),
  /** Status effects (database.statuses): poison, sleep, attack up… "enemy" = the one being acted on, "enemies" = all, "party" = hero and companions. chance in percent. */
  z.object({ type: z.literal("addStatus"), status: IdSchema, target: z.enum(["player", "enemy", "enemies", "party"]).optional(), turns: z.number().int().min(1).max(999).optional(), chance: ExprSchema.optional() }).strict(),
  z.object({ type: z.literal("removeStatus"), status: IdSchema.optional(), target: z.enum(["player", "enemy", "enemies", "party"]).optional() }).strict(),
  /** A companion joins / leaves the party (database › companions). */
  z.object({ type: z.literal("joinParty"), companion: IdSchema }).strict(),
  z.object({ type: z.literal("leaveParty"), companion: IdSchema }).strict(),
  z.object({
    type: z.literal("damage"),
    /** "enemies" = every enemy still standing (全体攻撃), "randomEnemy" = one standing enemy at random per hit. */
    target: z.enum(["player", "enemy", "enemies", "randomEnemy"]),
    amount: ExprSchema, text: z.string().optional(),
    /** project.elements: multiplied by the target's resist. */ element: IdSchema.optional(),
    /** Repeat the hit (連続攻撃). The amount is evaluated again for each hit. */
    hits: z.number().int().min(1).max(20).optional(),
  }).strict(),
  z.object({ type: z.literal("teleport"), mapId: IdSchema, x: CoordSchema, y: CoordSchema, facing: DirectionSchema.optional() }).strict(),
  z.object({ type: z.literal("setTile"), mapId: IdSchema.optional(), x: CoordSchema, y: CoordSchema, code: z.string().length(1) }).strict(),
  z.object({ type: z.literal("dialogue"), dialogue: IdSchema }).strict(),
  z.object({ type: z.literal("choice"), prompt: z.string().optional(), speaker: z.string().optional(), options: z.array(ChoiceOptionSchema).min(1) }).strict(),
  z.object({ type: z.literal("event"), event: IdSchema }).strict(),
  z.object({ type: z.literal("battle"), enemy: IdSchema, /** More enemies in the same battle (built-in battles). */ with: z.array(IdSchema).max(7).optional(),
    /** 連戦: after the first group falls, these groups come in turn (HP and statuses carry on; victory after the last). */
    waves: z.array(z.object({ enemy: IdSchema, with: z.array(IdSchema).max(7).optional() }).strict()).max(20).optional(), onVictory: z.array(EffectSchema).optional(), onDefeat: z.enum(["respawn", "continue"]).optional(), canFlee: z.boolean().optional(), mode: BattleModeSchema.optional(), args: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ type: z.literal("battleLog"), text: z.string().min(1) }).strict(),
  z.object({ type: z.literal("endBattle"), outcome: z.enum(["victory", "fled"]) }).strict(),
  z.object({ type: z.literal("markDone"), id: IdSchema }).strict(),
  z.object({ type: z.literal("playSfx"), sound: IdSchema }).strict(),
  z.object({ type: z.literal("addToSet"), set: IdSchema, value: z.string().min(1) }).strict(),
  z.object({ type: z.literal("removeFromSet"), set: IdSchema, value: z.string().min(1) }).strict(),
  z.object({ type: z.literal("clearSet"), set: IdSchema }).strict(),
  z.object({ type: z.literal("moveEntity"), entity: IdSchema, mapId: IdSchema.optional(), x: CoordSchema, y: CoordSchema, facing: DirectionSchema.optional() }).strict(),
  z.object({ type: z.literal("schedule"), id: IdSchema.optional(), after: ExprSchema, effects: z.array(EffectSchema) }).strict(),
  z.object({ type: z.literal("cancelSchedule"), id: IdSchema }).strict(),
  z.object({ type: z.literal("startScene"), system: IdSchema, scene: IdSchema, args: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ type: z.literal("ending"), ending: IdSchema }).strict(),
  z.object({ type: z.literal("newCycle") }).strict(),
  z.object({ type: z.literal("playBgm"), music: IdSchema.nullable() }).strict(),
  /** Environmental loop under the BGM (rain, fire, waves). null = silence, map default otherwise. */
  z.object({ type: z.literal("playAmbient"), sound: IdSchema.nullable() }).strict(),
  /**
   * A still picture over the map / battle (一枚絵・スチル): background / portrait / enemy art. `slot` names the layer
   * (default "main"; several slots stack in the order shown). Position by `at` or by `x` / `y` (centre, percent of the screen),
   * size by `width` (percent). Stays (and is saved) until hidePicture.
   */
  z.object({
    type: z.literal("showPicture"), slot: IdSchema.optional(), image: IdSchema,
    at: z.enum(["center", "left", "right", "full"]).optional(),
    x: z.number().min(-50).max(150).optional(), y: z.number().min(-50).max(150).optional(),
    width: z.number().min(1).max(300).optional(), opacity: z.number().min(0).max(1).optional(),
    fadeMs: z.number().int().min(0).max(10000).optional(),
  }).strict(),
  /**
   * Text input window (名前入力・合言葉). `saveAs: "name"` renames the hero; any other id keeps the text as {{text.<id>}}.
   * `answers`: the first whose `match` equals the text (spaces / case / full-width ignored) runs; otherwise `otherwise`.
   */
  z.object({
    type: z.literal("input"), prompt: z.string().optional(), speaker: z.string().optional(),
    maxLength: z.number().int().min(1).max(40).optional(), initial: z.string().max(40).optional(), saveAs: IdSchema.optional(),
    answers: z.array(z.lazy(() => z.object({ match: z.array(z.string().min(1)).min(1), effects: z.array(EffectSchema) }).strict())).optional(),
    otherwise: z.array(EffectSchema).optional(),
  }).strict(),
  /** 隊列: put the hero ("hero") or a companion in the front / back row, or into / out of the reserve. */
  z.object({ type: z.literal("setFormation"), who: z.string().min(1), row: z.enum(["front", "back"]).optional(), reserve: z.boolean().optional() }).strict(),
  /**
   * Camera (カメラ): `focus` a map cell (or back to "player"), `zoom` 1–3, over `ms`; `shake` the screen (power in pixels).
   * Stays (and is saved) until changed. A battle or map change keeps it; focus "player" + zoom 1 resets.
   */
  z.object({
    type: z.literal("camera"),
    focus: z.union([z.literal("player"), z.object({ x: z.number().int().min(0), y: z.number().int().min(0) }).strict()]).optional(),
    zoom: z.number().min(1).max(3).optional(), ms: z.number().int().min(0).max(10000).optional(),
    shake: z.object({ power: z.number().min(1).max(24).default(6), ms: z.number().int().min(50).max(5000).default(400) }).strict().optional(),
  }).strict(),
  /** Unlock an achievement now (project.achievements), even without its `when`. */
  z.object({ type: z.literal("unlockAchievement"), achievement: IdSchema }).strict(),
  /** Hide one picture slot, or every picture without `slot`. */
  z.object({ type: z.literal("hidePicture"), slot: IdSchema.optional(), fadeMs: z.number().int().min(0).max(10000).optional() }).strict(),
  /** Broadcast a self-made event: every rule with on "signal" and match = this id runs right here. */
  z.object({ type: z.literal("signal"), signal: IdSchema }).strict(),
  /** Put on an item you carry (it goes in its slot, replacing what was there) / take off a slot. */
  z.object({ type: z.literal("equip"), item: IdSchema, /** A party member instead of the hero. */ companion: IdSchema.optional() }).strict(),
  z.object({ type: z.literal("unequip"), slot: IdSchema, companion: IdSchema.optional() }).strict(),
  /** Teach / take away a verb (verbs with known: false start unlearned). */
  z.object({ type: z.literal("learnVerb"), verb: IdSchema }).strict(),
  z.object({ type: z.literal("forgetVerb"), verb: IdSchema }).strict(),
  /** Use a verb from data (with an optional target, skipping the target menu). */
  z.object({ type: z.literal("useVerb"), verb: IdSchema, target: z.string().min(1).optional() }).strict(),
  /** Change who the player is (transformation, possession, playing as the monster). null restores project.player. */
  z.object({ type: z.literal("setPlayer"), name: z.string().min(1).max(40).nullable().optional(), sprite: IdSchema.nullable().optional() }).strict(),
  z.object({ type: z.literal("if"), when: ConditionSchema, then: z.array(EffectSchema), else: z.array(EffectSchema).optional() }).strict(),
  z.object({ type: z.literal("system"), system: IdSchema, action: IdSchema, args: z.record(z.string(), z.unknown()).optional() }).strict(),
  /** Run code from scripts/<script>.ts: its `use` (or `actions[call]`). Anything the data cannot express. */
  z.object({ type: z.literal("script"), script: IdSchema, call: IdSchema.optional(), args: z.record(z.string(), z.unknown()).optional() }).strict(),
]));

/* ------------------------------------------------------------------ Rules (data-driven triggers) */

export const RULE_TRIGGERS = ["auto", "step", "tick", "mapEnter", "battleStart", "turnEnd", "dealDamage", "takeDamage", "lethalDamage", "victory", "defeat", "bump", "examine", "verb", "signal"] as const;
/** Triggers whose rules can be narrowed with `match` (verb id / signal id). */
export const MATCH_TRIGGERS: readonly RuleTrigger[] = ["verb", "signal"];
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];
export const BATTLE_TRIGGERS: readonly RuleTrigger[] = ["battleStart", "turnEnd", "dealDamage", "takeDamage", "lethalDamage"];

export const RuleSchema = z.object({
  id: IdSchema,
  /** 一時的に無効にする（コメントアウト）: true の間は無いものとして動く。検証で「無効化中」と知らせる。 */
  disabled: z.boolean().optional(),
  /** When this rule is checked. See docs/rules.md. */
  on: z.enum(RULE_TRIGGERS),
  /** on "verb": the verb id. on "signal": the signal id (required). */
  match: IdSchema.optional(),
  when: ConditionSchema.optional(),
  /** Percent chance (0-100) to fire when `when` holds. */
  chance: ExprSchema.optional(),
  /** "battle": once per battle, "map": once per map visit, "game": once per playthrough. */
  once: z.enum(["battle", "map", "game"]).optional(),
  /** auto rules only: fire again after `when` became false and true again. */
  repeat: z.boolean().default(false),
  priority: z.number().int().default(0),
  /** dealDamage/takeDamage: replace damage ({"ctx":"damage"} is the current value). lethalDamage: HP to keep instead of 0. */
  modify: z.object({ damage: ExprSchema.optional(), hp: ExprSchema.optional() }).strict().optional(),
  effects: z.array(EffectSchema).default([]),
  description: z.string().optional(),
}).strict();
export type Rule = z.infer<typeof RuleSchema>;

export const StatModsSchema = z.object({ maxHp: ExprSchema.optional(), attack: ExprSchema.optional(), defense: ExprSchema.optional() }).strict();
export type StatMods = z.infer<typeof StatModsSchema>;

/**
 * Code attached to a piece of data: scripts/<id>.ts. While the owner is active (ability known, item carried or
 * equipped, trait held, enemy in battle, companion in the party, current map, entity state shown) every hook of
 * the script runs — damage, movement, actions, drawing, HUD, extra commands… See docs/scripting.md.
 */
export const ScriptRefSchema = z.union([IdSchema, z.object({ id: IdSchema, args: z.record(z.string(), z.unknown()).default({}) }).strict()]);
export type ScriptRef = z.infer<typeof ScriptRefSchema>;

export const BATTLE_ANIMATIONS = ["slash", "pierce", "hit", "magic", "fire", "ice", "thunder", "heal", "explosion", "poison"] as const;
export type BattleAnimation = (typeof BATTLE_ANIMATIONS)[number];

export const UseSchema = z.object({
  where: z.enum(["battle", "field", "both"]).default("battle"),
  label: z.string().optional(),
  when: ConditionSchema.optional(),
  /** Variable costs, e.g. [{"var":"mp","amount":3}]. Not usable when short. */
  cost: z.array(z.object({ var: IdSchema, amount: ExprSchema }).strict()).default([]),
  /** HP cost (never kills: leaves at least 1). */
  hpCost: ExprSchema.optional(),
  effects: z.array(EffectSchema).min(1),
  /** Item only: remove one after use (default true). */
  consume: z.boolean().default(true),
  /** Battle animation played on the target (戦闘アニメ). */
  animation: z.enum(BATTLE_ANIMATIONS).optional(),
}).strict();
export type Use = z.infer<typeof UseSchema>;

/* ------------------------------------------------------------------ Project manifest */

export const VerbSchema = z.object({
  label: z.string().min(1).max(20),
  description: z.string().optional(),
  /** Keyboard key (a-z / 0-9) that performs it on the field. Avoid the movement / menu keys (w a s d z x). */
  key: z.string().regex(/^[a-z0-9]$/).refine(k => !"wasdzxm".includes(k), "w a s d z x m は移動・決定・メニューに使われています").optional(),
  /** Only shown and usable while this holds. */
  when: ConditionSchema.optional(),
  /** false: hidden until a learnVerb effect teaches it. */
  known: z.boolean().default(true),
  /**
   * Choose what to use it on first: an item you carry, an entry of a set (words, memories, names), or a fixed list.
   * The choice is available as the condition { "target": id } and the text {{target}} / {{targetLabel}}.
   */
  target: z.object({
    from: z.enum(["items", "set", "list"]),
    set: IdSchema.optional(),
    options: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) }).strict()).default([]),
    prompt: z.string().optional(),
    /** Message when there is nothing to choose. */
    none: z.string().default("使えるものがない。"),
  }).strict().optional(),
  effects: z.array(EffectSchema).default([]),
}).strict();
export type Verb = z.infer<typeof VerbSchema>;

const FileRefSchema = z.object({ id: IdSchema, path: RelPathSchema, title: z.string().min(1) }).strict();
/** "run" values reset on a new game / new cycle; "meta" values survive them (memories, endings seen, unlocks). */
export const PersistSchema = z.enum(["run", "meta"]).default("run");
export const FlagDeclSchema = z.object({ initial: z.boolean().default(false), description: z.string().optional(), persist: PersistSchema }).strict();
export const SetDeclSchema = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
  /** Show the collected entries in the game menu (e.g. a notebook of clues). */
  show: z.boolean().default(false),
  persist: PersistSchema,
  /** Optional display names for entries: value → text. */
  entries: z.record(z.string(), z.string()).default({}),
}).strict();
export type SetDecl = z.infer<typeof SetDeclSchema>;
export const VarDeclSchema = z.object({
  initial: z.number().int().default(0),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
  label: z.string().optional(),
  /** Show on the field HUD. */
  hud: z.boolean().default(false),
  description: z.string().optional(),
  persist: PersistSchema,
}).strict();
export type VarDecl = z.infer<typeof VarDeclSchema>;
export const StatsSchema = z.object({
  maxHp: z.number().int().positive().max(9999),
  attack: z.number().int().nonnegative().max(999),
  defense: z.number().int().nonnegative().max(999),
}).strict();
export type Stats = z.infer<typeof StatsSchema>;

export const SFX_CUES = ["cursor", "confirm", "cancel", "bump", "hit", "hurt", "heal", "encounter", "victory", "defeat", "door", "item", "save", "menu", "text"] as const;
export type SfxCue = (typeof SFX_CUES)[number];

export const AudioConfigSchema = z.object({
  /** BGM played in battles unless the enemy has its own. bgm/song asset id. */
  battle: IdSchema.optional(),
  /** Jingle (sfx/song) after victory. */
  victory: IdSchema.optional(),
  /** Which sound plays for each built-in cue. Unset cues use a tiny built-in beep. */
  sfx: z.partialRecord(z.enum(SFX_CUES), IdSchema).default({}),
  volume: z.object({ bgm: z.number().min(0).max(1).default(0.6), sfx: z.number().min(0).max(1).default(0.8) }).strict().default({ bgm: 0.6, sfx: 0.8 }),
  /** 文字送りの音: a short blip while messages type (sfx.text if set, else a built-in blip). Players can turn it off. */
  textSound: z.boolean().default(false),
}).strict();
export type AudioConfig = z.infer<typeof AudioConfigSchema>;

export const SOURCE_CATEGORIES = ["image", "bgm", "sfx", "song", "voice", "font"] as const;
export const AssetSourceSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  url: z.string().url().optional(),
  termsUrl: z.string().url().optional(),
  categories: z.array(z.enum(SOURCE_CATEGORIES)).min(1),
  origin: z.enum(["site", "purchased", "commission", "generated"]),
  /** Summary of the terms as last checked. Always re-read termsUrl before adding files. */
  summary: z.string(),
  /** What the agent/person must confirm for each file. */
  checklist: z.array(z.string()).default([]),
  creditRequired: z.enum(["yes", "no", "varies", "unknown"]),
  /** Raw files inside a shared template / sample project. */
  redistribution: z.enum(["allowed", "prohibited", "varies", "unknown"]),
  /** May an AI agent fetch files automatically, or must a person download them? */
  automatedDownload: z.enum(["allowed", "manual", "unknown"]),
  /** null = the summary has not been verified against the original terms page. */
  verifiedAt: z.string().nullable().default(null),
  defaultEnabled: z.boolean().default(false),
  notes: z.string().optional(),
  /**
   * How an AI agent works with this source:
   * api = an official API may be used to search (the person still chooses), link = the agent shows search / item
   * page URLs and the person downloads in their browser, manual = bought / commissioned by the person, avoid = not usable here.
   */
  integration: z.enum(["api", "link", "manual", "avoid"]).optional(),
  /** Search page for the agent to show, with {q} for the words (only where the URL form is known). */
  searchUrl: z.string().optional(),
  /** How the person can see / listen before choosing (item page, preview player…). */
  preview: z.string().optional(),
  /** Credit line format when credit is needed. */
  creditFormat: z.string().optional(),
  /** Points that change how the asset may be used in this tool's HTML5 builds or public repos. */
  cautions: z.array(z.string()).default([]),
  /** Where the summary came from: "original" (terms page read) or "secondary" (search snippets / articles only). */
  research: z.object({ method: z.enum(["original", "secondary"]), checkedAt: z.string(), urls: z.array(z.string()).default([]) }).strict().optional(),
  /** Where to ask the site when the terms are unclear. */
  contact: z.string().optional(),
}).strict();
export type AssetSource = z.infer<typeof AssetSourceSchema>;

export const AssetPolicySchema = z.object({
  /** This project is meant to be shared as a template/sample: only redistributable assets allowed. */
  shareable: z.boolean().default(false),
  /** Turn catalog sources on/off for this project (missing = the source's defaultEnabled). */
  sources: z.record(IdSchema, z.boolean()).default({}),
  /** Extra sites the user trusts (same shape as the catalog). */
  customSources: z.array(AssetSourceSchema).default([]),
  /** Preferred way to get each kind of asset, in order. */
  prefer: z.partialRecord(z.enum(SOURCE_CATEGORIES), z.array(z.enum(["generate", "site", "purchased", "commission"]))).default({}),
  budget: z.object({
    /** Warn above this total (MB) for the web build. */
    warnTotalMB: z.number().positive().default(100),
    /** Error above this total (MB). */
    maxTotalMB: z.number().positive().default(300),
    /** Error for any single file above this (MB). */
    maxFileMB: z.number().positive().default(20),
  }).strict().default({ warnTotalMB: 100, maxTotalMB: 300, maxFileMB: 20 }),
}).strict();
export type AssetPolicy = z.infer<typeof AssetPolicySchema>;

export const ProjectManifestSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  id: IdSchema,
  title: z.string().min(1).max(120),
  engineCompatibility: z.object({ min: z.string().min(1), max: z.string().optional() }).strict(),
  start: z.object({ mapId: IdSchema, x: CoordSchema, y: CoordSchema, facing: DirectionSchema.default("down") }).strict(),
  player: z.object({
    name: z.string().min(1).max(40),
    sprite: IdSchema.optional(),
    stats: StatsSchema,
    abilities: z.array(IdSchema).default([]),
    traits: z.array(IdSchema).default([]),
    items: z.record(IdSchema, z.number().int().positive()).default({}),
  }).strict(),
  /** Every flag used by data or systems must be declared. Typos then fail validation instead of silently never matching. */
  flags: z.record(IdSchema, FlagDeclSchema).default({}),
  /** Integer variables (gold, reputation, mp, counters…). Must be declared like flags. */
  variables: z.record(IdSchema, VarDeclSchema).default({}),
  /** Named sets of strings: knowledge, keywords, collected memories, visited places… */
  sets: z.record(IdSchema, SetDeclSchema).default({}),
  /** Endings the game can reach (recorded across cycles in the built-in meta set "endings"). */
  endings: z.record(IdSchema, z.object({ title: z.string().min(1), text: z.string().default("") }).strict()).default({}),
  /**
   * Party rules: `size` = companions fighting at once (the rest wait in reserve, swapped in the menu's 隊列),
   * back row: damage taken / dealt by normal attacks in percent.
   */
  party: z.object({ size: z.number().int().min(0).max(7).optional(), backRowTaken: z.number().int().min(0).max(100).default(50), backRowDealt: z.number().int().min(0).max(100).default(50) }).strict().optional(),
  /**
   * Field menu layout (メニューの並べ替え): `order` of section keys (party, traits, jobs, items, abilities, commands, verbs, records, set:<id>),
   * `hidden` keys, `when` = show a section only while a condition holds, `labels` = new titles.
   */
  menu: z.object({
    order: z.array(z.string()).default([]), hidden: z.array(z.string()).default([]),
    when: z.record(z.string(), ConditionSchema).optional(), labels: z.record(z.string(), z.string().min(1)).optional(),
  }).strict().optional(),
  /** Minimap in the corner of the field (N key / menu toggles it). Tile colours (tiles.json › color) are used. */
  minimap: z.object({ enabled: z.boolean().default(true), size: z.number().int().min(60).max(240).default(120) }).strict().optional(),
  /**
   * Monster / item book (図鑑) in the menu. Enemies count once met (stats shown after a win); items once held.
   * Kept across new games like the endings seen. `hidden`: ids never listed.
   */
  book: z.object({ enemies: z.boolean().default(true), items: z.boolean().default(true), hidden: z.array(IdSchema).default([]) }).strict().optional(),
  /** Achievements (実績): unlocked automatically when `when` holds (or by the unlockAchievement effect), with a notice. Kept across new games. */
  achievements: z.record(IdSchema, z.object({ title: z.string().min(1), description: z.string().default(""), when: ConditionSchema.optional(), hidden: z.boolean().default(false) }).strict()).default({}),
  /** Replace the battle maths with expressions. See docs/customization-guide.md. */
  battle: z.object({
    /** Player → enemy. ctx: attack, defense, power(0), variance(-1..1). */
    playerDamage: ExprSchema.optional(),
    /** Enemy → player (before guard halves it). ctx: attack, defense, power, variance. */
    enemyDamage: ExprSchema.optional(),
    /** Percent chance to flee. */
    fleeChance: ExprSchema.optional(),
    /** "fixed" = hero, companions, then enemies. "speed" = everyone by speed, fastest first (shown as the turn order). */
    order: z.enum(["fixed", "speed"]).default("fixed"),
    /** The hero's speed for order "speed" (e.g. {"add":[10,{"level":true}]}). Default 10. */
    playerSpeed: ExprSchema.optional(),
    /** Critical hits of the hero's attack: chance in percent (Expr) and damage multiplier in percent. */
    critical: z.object({ chance: ExprSchema, multiplier: z.number().int().min(100).max(1000).default(150) }).strict().optional(),
    /** Percent chance that an enemy's attack misses the hero (Expr). */
    playerEvasion: ExprSchema.optional(),
    /** Which built-in commands exist. */
    commands: z.object({ attack: z.boolean().default(true), guard: z.boolean().default(true), skills: z.boolean().default(true), items: z.boolean().default(true), flee: z.boolean().default(true) }).strict().default({ attack: true, guard: true, skills: true, items: true, flee: true }),
  }).strict().default({ order: "fixed", commands: { attack: true, guard: true, skills: true, items: true, flee: true } }),
  /** Self-made player actions ("listen", "rewind", "possess", "shout"…). Usable from the menu, a key, or touch. */
  verbs: z.record(IdSchema, VerbSchema).default({}),
  /** Equipment slots items can go in (item.slot). */
  equipmentSlots: z.record(IdSchema, z.object({ label: z.string().min(1) }).strict()).default({ weapon: { label: "武器" }, armor: { label: "防具" }, accessory: { label: "装飾品" } }),
  /** Elements for attacks and resistances (fire, ice, light…). Labels are shown in battle ("弱点！"). */
  elements: z.record(IdSchema, z.object({ label: z.string().min(1) }).strict()).default({}),
  /**
   * Experience and levels (optional: without it there are no levels). Winning gives each enemy's `exp`.
   * Needed to go from level L to L+1: expTable[L-1] if given, else round(base × growth^(L-1)).
   */
  leveling: z.object({
    maxLevel: z.number().int().min(2).max(999).default(50),
    base: z.number().positive().default(10),
    growth: z.number().min(1).max(5).default(1.35),
    /** Explicit amounts needed per level-up (index 0 = 1→2). Overrides base/growth where given. */
    expTable: z.array(z.number().int().positive()).optional(),
    /** Added to the base stats on every level-up (HP rises by the same amount). */
    gains: z.object({ maxHp: z.number().int().min(0).default(4), attack: z.number().int().min(0).default(1), defense: z.number().int().min(0).default(1) }).strict().default({ maxHp: 4, attack: 1, defense: 1 }),
    /** Abilities learned on reaching a level. */
    learn: z.array(z.object({ level: z.number().int().min(2), ability: IdSchema, message: z.string().optional() }).strict()).default([]),
    /** Restore all HP on level-up (default: only the HP gained). */
    fullHeal: z.boolean().default(false),
  }).strict().optional(),
  /** Self-made events. Rules listen with on "signal"; effects fire them with { "type": "signal" }. */
  signals: z.record(IdSchema, z.object({ description: z.string().optional() }).strict()).default({}),
  /** Effects run when a new game starts (e.g. race selection). */
  intro: z.array(EffectSchema).default([]),
  maps: z.array(FileRefSchema).min(1),
  tilesetPath: RelPathSchema,
  dialoguesPath: RelPathSchema,
  eventsPath: RelPathSchema,
  databasePath: RelPathSchema,
  /** Optional global rules file. */
  rulesPath: RelPathSchema.optional(),
  assetsPath: RelPathSchema,
  systems: z.array(FileRefSchema).default([]),
  audio: AudioConfigSchema.default({ sfx: {}, volume: { bgm: 0.6, sfx: 0.8 }, textSound: false }),
  assetPolicy: AssetPolicySchema.default({ shareable: false, sources: {}, customSources: [], prefer: {}, budget: { warnTotalMB: 100, maxTotalMB: 300, maxFileMB: 20 } }),
  /** Built-in genre modules enabled for this project (novel, puzzle, shooter, planner, cards…), with optional config. */
  modules: z.record(IdSchema, z.record(z.string(), z.unknown())).default({}),
  /** Extra lines for the credits screen (staff, thanks). Asset credits are added automatically. */
  credits: z.array(z.string()).default([]),
  /** Title screen of the built game (はじめから / つづきから). The studio's play view skips it. */
  titleScreen: z.object({
    enabled: z.boolean().default(true),
    subtitle: z.string().optional(),
    /** Background picture (background asset). */
    background: IdSchema.optional(),
  }).strict().default({ enabled: true }),
  /** Save automatically to the "オート" slot when entering a map (field, nothing pending). */
  autosave: z.boolean().default(true),
  /**
   * When the hero falls in a battle that does not continue (ゲームオーバー). "respawn": wake up at `respawn` (default the start)
   * with `message`; "screen": a GAME OVER screen (title / text / picture) with ロード・タイトルへ・`retry` (wake up as with respawn).
   * `penalty`: lose this percent of a variable (e.g. half the gold).
   */
  gameOver: z.object({
    mode: z.enum(["respawn", "screen"]).default("respawn"),
    message: z.string().default("目の前が暗くなった……。気がつくと、見慣れた場所に戻っていた。"),
    respawn: z.object({ mapId: IdSchema, x: z.number().int().min(0), y: z.number().int().min(0) }).strict().optional(),
    title: z.string().default("GAME OVER"),
    text: z.string().default(""),
    image: IdSchema.optional(),
    music: IdSchema.optional(),
    retry: z.boolean().default(true),
    penalty: z.object({ var: IdSchema, percent: z.number().int().min(0).max(100) }).strict().optional(),
  }).strict().optional(),
  /**
   * Look of the windows (ウィンドウのデザイン): colours (#hex / rgba), corner radius, font, and an optional frame picture
   * (a portrait/background asset drawn as a 9-slice border, `frameSlice` pixels from each edge).
   */
  ui: z.object({
    window: z.string().max(40).optional(), edge: z.string().max(40).optional(), text: z.string().max(40).optional(), accent: z.string().max(40).optional(),
    radius: z.number().int().min(0).max(30).optional(),
    font: z.enum(["dot", "gothic", "mincho", "rounded"]).optional(),
    frame: IdSchema.optional(), frameSlice: z.number().int().min(1).max(64).default(12),
  }).strict().optional(),
}).strict();
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

/* ------------------------------------------------------------------ Tileset */

export const TileDefSchema = z.object({
  code: z.string().length(1).refine(code => code !== " " && code !== "\"" && code !== "\\", "空白・引用符・バックスラッシュはタイルコードに使えません"),
  name: z.string().min(1),
  /** Tileset image for this tile (defaults to the tileset's `atlas`). Lets one project use many tile sheets. */
  atlas: IdSchema.optional(),
  /** Cell index in the atlas, row-major. */
  index: z.number().int().nonnegative(),
  /**
   * Stable name of the picture in its sheet (library tiles: e.g. "carpet-red-c"). `rpg library add --replace`
   * finds the tile by atlas + key and follows it if the sheet's numbering changes, so maps never show the wrong tile.
   */
  key: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i).optional(),
  passable: z.boolean(),
  /**
   * Walls on some edges of a passable tile (方向ごとの通行): ["down"] = a cliff edge — you cannot walk down off it,
   * nor walk up onto it from below. Fences, counters, one-sided ledges.
   */
  walls: z.array(z.enum(["up", "down", "left", "right"])).max(4).optional(),
  /** Chance of a random encounter per step on this tile (0..1), instead of the map's rate (tall grass 0.15, road 0). Needs map.encounters. */
  encounterRate: z.number().min(0).max(1).optional(),
  /** Sound when the hero steps on it (grass rustle, wooden floor). sfx asset. */
  footstep: IdSchema.optional(),
  /** Little effect where the hero walks: dust, splash (water), footprints (snow, sand), leaves. */
  stepEffect: z.enum(["dust", "splash", "footprints", "leaves"]).optional(),
  /** When this condition holds the tile is passable regardless of `passable`. */
  passableWhen: ConditionSchema.optional(),
  /** Atlas cell used while `passableWhen` holds (e.g. an opened gate). */
  openIndex: z.number().int().nonnegative().optional(),
  /** Fallback colour used when the atlas image is unavailable. */
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#63734f"),
  /** Animated tile: atlas cells shown in turn (water, torches, flags). */
  frames: z.array(z.number().int().nonnegative()).min(2).optional(),
  frameMs: z.number().int().min(50).max(5000).default(250),
  /**
   * Autotile: tiles of the same `group` connect. With `pieces` (atlas cells of a 9-slice: corners, edges, centre)
   * the right piece is drawn from the neighbours, so any rectangle can be painted with one code.
   * `border` draws a thin edge line (#hex) where the group ends (paths, water, cliffs without edge pictures).
   */
  autotile: z.object({
    group: IdSchema,
    pieces: z.object({ tl: z.number().int().nonnegative(), t: z.number().int().nonnegative(), tr: z.number().int().nonnegative(), l: z.number().int().nonnegative(), c: z.number().int().nonnegative(), r: z.number().int().nonnegative(), bl: z.number().int().nonnegative(), b: z.number().int().nonnegative(), br: z.number().int().nonnegative() }).strict().optional(),
    border: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  }).strict().optional(),
  /** Pressing the action key while facing this tile. Use `when` to make it investigable only after a flag/ability/knowledge. */
  inspect: z.object({ when: ConditionSchema.optional(), effects: z.array(EffectSchema).min(1), otherwise: z.array(EffectSchema).default([]) }).strict().optional(),
}).strict();
export type TileDef = z.infer<typeof TileDefSchema>;

export const TilesetSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  atlas: IdSchema,
  tiles: z.array(TileDefSchema).min(1),
}).strict().superRefine((tileset, ctx) => {
  const seen = new Set<string>();
  const keys = new Set<string>();
  tileset.tiles.forEach((tile, index) => {
    if (tile.key) {
      const k = `${tile.atlas ?? tileset.atlas}#${tile.key}`;
      if (keys.has(k)) ctx.addIssue({ code: "custom", path: ["tiles", index, "key"], message: `同じ画像の中でタイルのキーが重複しています: '${k}'` });
      keys.add(k);
    }
    if (seen.has(tile.code)) ctx.addIssue({ code: "custom", path: ["tiles", index, "code"], message: `タイルコードが重複しています: '${tile.code}'` });
    seen.add(tile.code);
  });
});
export type Tileset = z.infer<typeof TilesetSchema>;

/* ------------------------------------------------------------------ Maps */

export const NpcSchema = z.object({
  id: IdSchema,
  /** 一時的に無効にする（コメントアウト）: true の間は無いものとして動く。検証で「無効化中」と知らせる。 */
  disabled: z.boolean().optional(),
  name: z.string().min(1),
  x: CoordSchema,
  y: CoordSchema,
  facing: DirectionSchema.default("down"),
  sprite: IdSchema.optional(),
  /** First entry whose `when` holds is used. Put the unconditional default last. */
  dialogues: z.array(z.object({ when: ConditionSchema.optional(), dialogue: IdSchema }).strict()).min(1),
  /** NPC only appears while this holds. */
  visibleWhen: ConditionSchema.optional(),
  /** Code active while this is shown on the current map (regions: while the player stands inside). See docs/scripting.md. */
  script: ScriptRefSchema.optional(),
}).strict();
export type Npc = z.infer<typeof NpcSchema>;

export const PortalSchema = z.object({
  id: IdSchema,
  x: CoordSchema,
  y: CoordSchema,
  targetMapId: IdSchema,
  targetX: CoordSchema,
  targetY: CoordSchema,
  facing: DirectionSchema.optional(),
  when: ConditionSchema.optional(),
}).strict();
export type Portal = z.infer<typeof PortalSchema>;

export const InteractableSchema = z.object({
  id: IdSchema,
  /** 一時的に無効にする（コメントアウト）: true の間は無いものとして動く。検証で「無効化中」と知らせる。 */
  disabled: z.boolean().optional(),
  x: CoordSchema,
  y: CoordSchema,
  label: z.string().min(1),
  event: IdSchema,
  /** "action": player presses the action key facing / standing next to it. "touch": runs when the player steps on it. */
  trigger: z.enum(["action", "touch"]).default("action"),
  /** Blocks movement like an object (chests, statues). Touch triggers are never solid. */
  solid: z.boolean().default(false),
  marker: z.enum(["none", "sign", "chest", "sparkle", "statue"]).default("sparkle"),
  visibleWhen: ConditionSchema.optional(),
  /** Code active while this is shown on the current map (regions: while the player stands inside). See docs/scripting.md. */
  script: ScriptRefSchema.optional(),
}).strict();
export type Interactable = z.infer<typeof InteractableSchema>;

export const BehaviorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("still") }).strict(),
  /** Random steps within `radius` of the home position, one step every `every` ticks. */
  z.object({ type: z.literal("wander"), radius: z.number().int().min(1).default(3), every: z.number().int().min(1).default(3) }).strict(),
  /** Walk a path of points in a loop. */
  z.object({ type: z.literal("patrol"), path: z.array(z.object({ x: CoordSchema, y: CoordSchema }).strict()).min(1), every: z.number().int().min(1).default(2) }).strict(),
  /** Approach the player when within `range` (Manhattan); otherwise wait. */
  z.object({ type: z.literal("chase"), range: z.number().int().min(1).default(5), every: z.number().int().min(1).default(2) }).strict(),
  /** Keep away from the player within `range`. */
  z.object({ type: z.literal("flee"), range: z.number().int().min(1).default(4), every: z.number().int().min(1).default(2) }).strict(),
]);
export type Behavior = z.infer<typeof BehaviorSchema>;

export const EntityStateSchema = z.object({
  /** The first state whose `when` holds is active. If none holds the entity is absent. */
  when: ConditionSchema.optional(),
  name: z.string().optional(),
  sprite: IdSchema.optional(),
  marker: z.enum(["none", "sign", "chest", "sparkle", "statue"]).default("none"),
  facing: DirectionSchema.optional(),
  solid: z.boolean().default(true),
  /** action: press the action key facing it. touch: player bumps into it or it reaches the player. auto: runs once when this state becomes active. none: scenery. */
  trigger: z.enum(["action", "touch", "auto", "none"]).default("action"),
  dialogue: IdSchema.optional(),
  event: IdSchema.optional(),
  effects: z.array(EffectSchema).default([]),
  behavior: BehaviorSchema.default({ type: "still" }),
  /** Walking into it pushes it one tile (if the tile beyond is free): boulders, crates, statues. */
  pushable: z.boolean().optional(),
  /** The action key picks it up; pressing it again in front of a free tile puts it down (also on another map). */
  carryable: z.boolean().optional(),
  /** Effects after it was pushed or put down (check { "entityAt": … } here for switches). */
  onMoved: z.array(EffectSchema).optional(),
  /** Code active while this state is shown on the current map. */
  script: ScriptRefSchema.optional(),
}).strict();
export type EntityState = z.infer<typeof EntityStateSchema>;

export const EntitySchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  x: CoordSchema,
  y: CoordSchema,
  states: z.array(EntityStateSchema).min(1),
}).strict();
export type Entity = z.infer<typeof EntitySchema>;

export const RegionSchema = z.object({
  id: IdSchema,
  label: z.string().optional(),
  x: CoordSchema,
  y: CoordSchema,
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  /** Region effects only run while this holds. */
  when: ConditionSchema.optional(),
  onEnter: z.array(EffectSchema).default([]),
  onLeave: z.array(EffectSchema).default([]),
  onStep: z.array(EffectSchema).default([]),
  /** Action key inside the region (when nothing else is in front). */
  inspect: z.array(EffectSchema).default([]),
  /** Code active while this is shown on the current map (regions: while the player stands inside). See docs/scripting.md. */
  script: ScriptRefSchema.optional(),
}).strict();
export type Region = z.infer<typeof RegionSchema>;

export const GameMapSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  id: IdSchema,
  title: z.string().min(1),
  width: z.number().int().positive().max(128),
  height: z.number().int().positive().max(128),
  rows: z.array(z.string()),
  npcs: z.array(NpcSchema).default([]),
  portals: z.array(PortalSchema).default([]),
  interactables: z.array(InteractableSchema).default([]),
  /** Living things and objects with condition-dependent states and movement. */
  entities: z.array(EntitySchema).default([]),
  regions: z.array(RegionSchema).default([]),
  /** BGM (bgm or song asset) for this map. */
  bgm: IdSchema.optional(),
  /** Environmental sound looping under the BGM (rain, river, fire): a bgm or sfx asset. */
  ambient: IdSchema.optional(),
  /** Battle background image (background asset) for fights on this map. */
  /**
   * Far background (遠景) behind the map, moving slower than the map (speed 0 = fixed sky, 1 = with the map).
   * Base-layer cells written as " " (space) are see-through (and cannot be walked on): sky, clouds below a cliff, space.
   */
  parallax: z.object({ image: IdSchema, speed: z.number().min(0).max(2).default(0.3) }).strict().optional(),
  /** Fog / clouds / rain drawn over the whole map, drifting (pixels per second). */
  fog: z.object({ image: IdSchema, opacity: z.number().min(0).max(1).default(0.35), speedX: z.number().min(-200).max(200).default(8), speedY: z.number().min(-200).max(200).default(0) }).strict().optional(),
  /** Show this map on the minimap (project.minimap). false for mazes and secret places. */
  minimap: z.boolean().default(true),
  battleBackground: IdSchema.optional(),
  /** Code active while the player is on this map. */
  script: ScriptRefSchema.optional(),
  /**
   * Extra tile layers over `rows` (same size; " " = nothing). Lower layers (above: false) hold objects on top of the
   * ground — the same tree on grass or snow — and block movement if their tile is not passable. Upper layers
   * (above: true) are drawn over the characters: roofs, tree tops, arches.
   */
  layers: z.array(z.object({ id: IdSchema, name: z.string().optional(), above: z.boolean().default(false), rows: z.array(z.string()) }).strict()).default([]),
  /** Tiles that change while a condition holds (bridge built, rubble cleared…). Later overlays win. */
  overlays: z.array(z.object({
    when: ConditionSchema,
    cells: z.array(z.object({ x: CoordSchema, y: CoordSchema, w: z.number().int().positive().default(1), h: z.number().int().positive().default(1), code: z.string().length(1) }).strict()).min(1),
  }).strict()).default([]),
  encounters: z.object({
    /** Chance per step, 0..1. */
    rate: z.number().min(0).max(1),
    enemies: z.array(IdSchema).min(1),
    /** Only tiles with these codes trigger encounters. Empty = all passable tiles. */
    tiles: z.array(z.string().length(1)).default([]),
  }).strict().optional(),
}).strict().superRefine((map, ctx) => {
  if (map.rows.length !== map.height) ctx.addIssue({ code: "custom", path: ["rows"], message: `行数${map.rows.length}がheight(${map.height})と一致しません` });
  map.rows.forEach((row, y) => {
    if (Array.from(row).length !== map.width) ctx.addIssue({ code: "custom", path: ["rows", y], message: `行${y}の文字数${Array.from(row).length}がwidth(${map.width})と一致しません` });
  });
  const check = (kind: string, list: Array<{ id: string; x: number; y: number }>) => list.forEach((item, index) => {
    if (item.x >= map.width || item.y >= map.height) ctx.addIssue({ code: "custom", path: [kind, index], message: `${item.id}の座標(${item.x}, ${item.y})がマップ範囲外です` });
  });
  check("npcs", map.npcs); check("portals", map.portals); check("interactables", map.interactables); check("entities", map.entities);
  map.regions.forEach((r, i) => { if (r.x + r.w > map.width || r.y + r.h > map.height) ctx.addIssue({ code: "custom", path: ["regions", i], message: `領域 ${r.id} がマップ範囲外にはみ出しています` }); });
  const ids = new Set<string>();
  [...map.npcs, ...map.portals, ...map.interactables, ...map.entities, ...map.regions].forEach(item => {
    if (ids.has(item.id)) ctx.addIssue({ code: "custom", path: ["id"], message: `マップ内でIDが重複しています: ${item.id}` });
    ids.add(item.id);
  });
});
export type GameMap = z.infer<typeof GameMapSchema>;

/* ------------------------------------------------------------------ Dialogues */

export const DialogueChoiceSchema = z.object({
  id: IdSchema,
  label: z.string().min(1),
  when: ConditionSchema.optional(),
  effects: z.array(EffectSchema).default([]),
  /** Effects of a `once` choice run only the first time it is picked (rewards are never duplicated). */
  once: z.boolean().default(false),
}).strict();
export type DialogueChoice = z.infer<typeof DialogueChoiceSchema>;

export const DialogueSchema = z.object({
  id: IdSchema,
  speaker: z.string().min(1),
  /** Strings, or {"text","when"?,"face"?} for lines shown only when a condition holds / with an expression. Supports {{var.x}} etc. */
  lines: z.array(z.union([z.string().min(1), z.object({ text: z.string().min(1), when: ConditionSchema.optional(), /** Frame of the portrait (expression). */ face: z.number().int().min(0).optional() }).strict()])).min(1),
  /** Face picture shown next to the text (portrait asset; frames = expressions). */
  portrait: IdSchema.optional(),
  /** Effects after the last line when there are no choices (or before choices are shown). */
  effects: z.array(EffectSchema).default([]),
  choices: z.array(DialogueChoiceSchema).default([]),
}).strict();
export type Dialogue = z.infer<typeof DialogueSchema>;

export const DialogueBundleSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  dialogues: z.array(DialogueSchema),
}).strict();
export type DialogueBundle = z.infer<typeof DialogueBundleSchema>;

/* ------------------------------------------------------------------ Events */

export const GameEventSchema = z.object({
  id: IdSchema,
  /** 一時的に無効にする（コメントアウト）: true の間は無いものとして動く。検証で「無効化中」と知らせる。 */
  disabled: z.boolean().optional(),
  label: z.string().min(1),
  when: ConditionSchema.optional(),
  effects: z.array(EffectSchema).default([]),
  /** Runs when `when` does not hold. */
  otherwise: z.array(EffectSchema).default([]),
  /** A `once` event is recorded as done and afterwards runs `afterDone` (if any) instead. */
  once: z.boolean().default(false),
  afterDone: z.array(EffectSchema).default([]),
}).strict();
export type GameEvent = z.infer<typeof GameEventSchema>;

export const EventBundleSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  events: z.array(GameEventSchema),
}).strict();
export type EventBundle = z.infer<typeof EventBundleSchema>;

/* ------------------------------------------------------------------ Database */

export const AbilitySchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().default(""),
  /** Display grouping only. Behaviour comes from statMods / rules / use. */
  kind: z.enum(["passive", "field", "battle"]).default("passive"),
  /** Added to the player's stats while the ability is held. */
  statMods: StatModsSchema.optional(),
  /** Active while the ability is held. */
  rules: z.array(RuleSchema).default([]),
  /** Makes it a usable skill (battle command "わざ" / field menu). */
  use: UseSchema.optional(),
  script: ScriptRefSchema.optional(),
}).strict();
export type Ability = z.infer<typeof AbilitySchema>;

/** Races, classes, blessings, curses… anything the player "is". Category is free text. */
export const TraitSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  category: z.string().min(1).default("特性"),
  description: z.string().default(""),
  tags: z.array(IdSchema).default([]),
  statMods: StatModsSchema.optional(),
  /** Abilities the player has while holding the trait (removed with it). */
  abilities: z.array(IdSchema).default([]),
  rules: z.array(RuleSchema).default([]),
  /** Run once when the trait is granted. */
  onGrant: z.array(EffectSchema).default([]),
  /**
   * 職業・クラス: traits of the same `group` exclude each other (granting one removes the others, e.g. group "job").
   * `selectable`: the hero can switch to it from the menu (転職) while `selectableWhen` holds.
   */
  group: IdSchema.optional(),
  selectable: z.boolean().optional(),
  selectableWhen: ConditionSchema.optional(),
  script: ScriptRefSchema.optional(),
}).strict();
export type Trait = z.infer<typeof TraitSchema>;

export const ItemSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().default(""),
  /** Shorthand: usable in battle / field to heal this much. */
  heal: z.number().int().positive().optional(),
  /** General use (overrides `heal`). */
  use: UseSchema.optional(),
  /** Passive bonus while carried — or, for items with a `slot`, only while equipped. */
  statMods: StatModsSchema.optional(),
  /** Weapons: element of normal attacks while equipped (project.elements). */
  element: IdSchema.optional(),
  /** Armour / accessories: damage taken by element in percent while active ({ "fire": 50 }). */
  resist: z.record(IdSchema, z.number().int().min(0).max(1000)).optional(),
  /** Price in shops (shop.buy). Selling pays shop.sellRate of it. */
  price: z.number().int().min(0).optional(),
  /** Equipment slot (project.json › equipmentSlots, e.g. weapon / armor / accessory). Its statMods and rules count only while equipped. */
  /** Weapons: battle animation of the hero's normal attack (default "slash"). */
  animation: z.enum(BATTLE_ANIMATIONS).optional(),
  slot: IdSchema.optional(),
  rules: z.array(RuleSchema).default([]),
  key: z.boolean().default(false),
  script: ScriptRefSchema.optional(),
}).strict();
export type Item = z.infer<typeof ItemSchema>;

export const EnemyActionSchema = z.object({
  name: z.string().min(1),
  /** Added to the enemy attack before defence is subtracted. 0 = a non-damaging move (wind-up, taunt). */
  power: z.number().int().min(0).max(999),
  message: z.string().optional(),
  /** Only used while this holds (e.g. HP below half: {"compare":[{"ctx":"enemyHp"},"<",{"percent":[{"ctx":"enemyMaxHp"},50]}]}). */
  when: ConditionSchema.optional(),
  /** Applied after the move (curses, buffs, flags). */
  effects: z.array(EffectSchema).default([]),
  /** Battle animation on whoever it hits (default: none for 0 power, "hit" otherwise). */
  animation: z.enum(BATTLE_ANIMATIONS).optional(),
  /** "all" hits the hero and every companion standing (全体攻撃). */
  target: z.enum(["one", "all"]).optional(),
  /** Strikes this many times (連続攻撃). Default 1. */
  hits: z.number().int().min(1).max(20).optional(),
}).strict();

export const EnemySchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  sprite: IdSchema.optional(),
  tags: z.array(IdSchema).default([]),
  stats: StatsSchema,
  /** Each turn, the available actions (whose `when` holds) are used in order, cycling. */
  actions: z.array(EnemyActionSchema).min(1),
  drops: z.array(z.object({ item: IdSchema, count: z.number().int().positive().default(1) }).strict()).default([]),
  /** How this enemy is fought: a genre module scene instead of the command battle (e.g. shooter, cards). */
  battle: z.object({ mode: BattleModeSchema, args: z.record(z.string(), z.unknown()).default({}) }).strict().optional(),
  /** Battle music for this enemy (overrides audio.battle). */
  bgm: IdSchema.optional(),
  /** Battle background (overrides the map's battleBackground). */
  background: IdSchema.optional(),
  /** Rules active during battles with this enemy. */
  rules: z.array(RuleSchema).default([]),
  canFlee: z.boolean().default(true),
  /** Turn order with project.battle.order "speed" (higher acts first). Default 10. */
  speed: z.number().int().min(0).max(999).optional(),
  /** Percent chance the hero's attack misses it. */
  evasion: z.number().int().min(0).max(100).optional(),
  /** Percent chance its attacks are critical (×1.5). */
  critical: z.number().int().min(0).max(100).optional(),
  /** Damage taken by element in percent: { "fire": 150 } = weak, 50 = resists, 0 = immune (project.elements). */
  resist: z.record(IdSchema, z.number().int().min(0).max(1000)).default({}),
  /** Statuses it cannot get. */
  immune: z.array(IdSchema).default([]),
  /** Experience for defeating it (project.leveling). Missing = round((maxHp + 2×attack + 2×defense) / 3). */
  exp: z.number().int().min(0).optional(),
  /** Code active while this enemy is in the battle (its `enemyTurn` can replace how it acts). */
  script: ScriptRefSchema.optional(),
}).strict();
export type Enemy = z.infer<typeof EnemySchema>;

export const CompanionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(20),
  description: z.string().default(""),
  sprite: IdSchema.optional(),
  stats: StatsSchema,
  /** Turn order with project.battle.order "speed". Default 10. */
  speed: z.number().int().min(0).max(999).optional(),
  /** What it does each turn: heal is used when someone in the party is below half HP; otherwise attacks / guards in order. */
  actions: z.array(z.object({
    name: z.string().min(1),
    kind: z.enum(["attack", "heal", "guard"]).default("attack"),
    power: z.number().int().min(0).max(999).default(0),
    when: ConditionSchema.optional(),
    message: z.string().optional(),
  }).strict()).min(1).default([{ name: "攻撃", kind: "attack", power: 0 }]),
  /** Code active while it is in the party (its `companionTurn` can replace how it acts). */
  script: ScriptRefSchema.optional(),
}).strict();
export type Companion = z.infer<typeof CompanionSchema>;

/** A status effect (database.statuses). Everything is optional: combine what the status should do. */
export const StatusSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** Short tag shown next to names in battle (e.g. "毒"). Defaults to the name. */
  label: z.string().max(6).optional(),
  description: z.string().default(""),
  /** Turns it lasts (counted at the end of each battle turn). */
  turns: z.number().int().min(1).max(999).default(3),
  /** HP lost at the end of each turn (expressions see {"ctx":"enemyMaxHp"} / maxHp of the holder as {"ctx":"power"}). */
  damage: ExprSchema.optional(),
  /** HP regained at the end of each turn. */
  heal: ExprSchema.optional(),
  /** Chance (percent) to lose the turn: 100 = sleep / stop, 50 = paralysis. */
  skipChance: z.number().int().min(0).max(100).default(0),
  /** Taking damage removes it (sleep). */
  wakeOnHit: z.boolean().default(false),
  /** Cannot use skills (silence). */
  noSkills: z.boolean().default(false),
  /** Added to stats while it lasts (buffs / debuffs; numbers). */
  statMods: z.object({ maxHp: z.number().int().optional(), attack: z.number().int().optional(), defense: z.number().int().optional() }).strict().optional(),
  /** Removed when the battle ends (default). false = stays (poison until cured). */
  clearAfterBattle: z.boolean().default(true),
  /** Lines for the battle log. {{name}} = who has it. */
  onAdd: z.string().optional(),
  onEnd: z.string().optional(),
}).strict();
export type StatusDef = z.infer<typeof StatusSchema>;

export const DatabaseSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  abilities: z.array(AbilitySchema).default([]),
  traits: z.array(TraitSchema).default([]),
  items: z.array(ItemSchema).default([]),
  enemies: z.array(EnemySchema).default([]),
  /** Party members who can join the hero (joinParty) and fight on their own in built-in battles. */
  companions: z.array(CompanionSchema).default([]),
  /** Status effects: poison, sleep, paralysis, silence, attack up, guard down… (effects addStatus / removeStatus). */
  statuses: z.array(StatusSchema).default([]),
}).strict();
export type Database = z.infer<typeof DatabaseSchema>;

/* ------------------------------------------------------------------ Assets (format 1, unchanged) */

export const ASSET_MANIFEST_FORMAT_VERSION = 1;
export const ASSET_KINDS = ["tileset", "character", "enemy", "animation", "portrait", "background", "bgm", "sfx", "song"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const IMAGE_KINDS: readonly AssetKind[] = ["tileset", "character", "enemy", "animation", "portrait", "background"];
export const ASSET_ORIGINS = ["original", "generated", "site", "purchased", "commission"] as const;
export const AssetEntrySchema = z.object({
  id: IdSchema,
  path: RelPathSchema,
  kind: z.enum(ASSET_KINDS),
  mimeType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  /** Human readable origin (kept for v1 compatibility). */
  source: z.string().default("自作"),
  license: z.string().default("プロジェクト内素材"),
  /** Where it came from. "site" / "purchased" / "commission" require a sourceId and a terms check date. */
  origin: z.enum(ASSET_ORIGINS).default("original"),
  /** Id in the asset-source catalog (packages/schema/src/asset-sources.json or assetPolicy.customSources). */
  sourceId: IdSchema.optional(),
  /** Page the file was obtained from. */
  url: z.string().url().optional(),
  author: z.string().optional(),
  licenseUrl: z.string().url().optional(),
  /** Exact credit text to show in the game's credits. */
  credit: z.string().optional(),
  creditRequired: z.boolean().default(false),
  /** May the raw file be shipped inside a shared template / sample project? (Shipping inside your own game is separate.) */
  redistributable: z.boolean().default(true),
  /** YYYY-MM-DD when a person/agent read the terms for this file. */
  termsCheckedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Anything the creator said that matters (e.g. "クレジット推奨", "AI学習禁止"). */
  notes: z.string().optional(),
  /** Art request id this asset fulfils (art/requests.json). */
  request: IdSchema.optional(),
  /** How a generated asset was made (tool, preset, seed, prompt). */
  generator: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  tileWidth: z.number().int().positive().optional(),
  tileHeight: z.number().int().positive().optional(),
  margin: z.number().int().nonnegative().optional(),
  spacing: z.number().int().nonnegative().optional(),
  columns: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  frameDurationMs: z.number().int().positive().optional(),
  frameOrder: z.array(z.number().int().nonnegative()).optional(),
  loop: z.boolean().optional(),
  initialVolume: z.number().min(0).max(1).optional(),
  /** ME (短いジングル): while this sound plays the BGM is turned down, then comes back. */
  duck: z.boolean().optional(),
  /** BGM with an intro: after the end (or loopEnd) playback jumps back to loopStart (seconds). */
  loopStart: z.number().min(0).optional(),
  loopEnd: z.number().positive().optional(),
}).strict();
export type AssetEntry = z.infer<typeof AssetEntrySchema>;

export const AssetManifestSchema = z.object({
  formatVersion: z.literal(ASSET_MANIFEST_FORMAT_VERSION),
  assets: z.array(AssetEntrySchema),
}).strict().superRefine((manifest, ctx) => {
  const ids = new Set<string>();
  manifest.assets.forEach((asset, index) => {
    if (ids.has(asset.id)) ctx.addIssue({ code: "custom", path: ["assets", index, "id"], message: `素材IDが重複しています: ${asset.id}` });
    ids.add(asset.id);
    const at = (field: string) => ["assets", index, field];
    if (asset.origin === "site" || asset.origin === "purchased" || asset.origin === "commission") {
      if (!asset.sourceId) ctx.addIssue({ code: "custom", path: at("sourceId"), message: "外部から入手した素材には取得元(sourceId)が必要です" });
      if (!asset.termsCheckedAt) ctx.addIssue({ code: "custom", path: at("termsCheckedAt"), message: "外部素材には規約を確認した日(termsCheckedAt: YYYY-MM-DD)が必要です" });
      if (asset.origin === "site" && !asset.url) ctx.addIssue({ code: "custom", path: at("url"), message: "サイトから入手した素材には入手ページのURLが必要です" });
      if (!asset.license || asset.license === "プロジェクト内素材") ctx.addIssue({ code: "custom", path: at("license"), message: "外部素材には規約・ライセンス名を書いてください" });
    }
    if (asset.origin === "generated" && !asset.generator) ctx.addIssue({ code: "custom", path: at("generator"), message: "生成素材には生成方法(generator: ツール・プロンプト・シード等)を記録してください" });
    if (asset.creditRequired && !asset.credit) ctx.addIssue({ code: "custom", path: at("credit"), message: "クレジット表記が必要な素材には表示する文言(credit)を書いてください" });
    if (asset.kind === "song") {
      if (asset.mimeType !== "application/json" || !asset.path.toLowerCase().endsWith(".song.json")) ctx.addIssue({ code: "custom", path: at("mimeType"), message: "楽譜BGM(song)は .song.json と application/json で指定してください" });
      return;
    }
    if (IMAGE_KINDS.includes(asset.kind)) {
      if (asset.mimeType !== "image/png" || !asset.path.toLowerCase().endsWith(".png")) ctx.addIssue({ code: "custom", path: ["assets", index, "mimeType"], message: "画像素材はPNG形式で指定してください" });
      for (const field of ["tileWidth", "tileHeight", "columns", "rows"] as const) {
        if (!asset[field]) ctx.addIssue({ code: "custom", path: ["assets", index, field], message: `画像シートには${field}が必要です` });
      }
    } else {
      const audioTypes: Record<string, string> = { ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
      const extension = asset.path.slice(asset.path.lastIndexOf(".")).toLowerCase();
      if (audioTypes[extension] !== asset.mimeType) ctx.addIssue({ code: "custom", path: ["assets", index, "mimeType"], message: "音声素材はOGG／MP3／WAVの拡張子とMIMEを一致させてください" });
    }
  });
});
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

export const RuleBundleSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  rules: z.array(RuleSchema),
}).strict();
export type RuleBundle = z.infer<typeof RuleBundleSchema>;

/* ------------------------------------------------------------------ Loaded content */

/** Everything the engine needs, already parsed. Produced by `parseProjectFiles`. */
export interface GameContent {
  project: ProjectManifest;
  tileset: Tileset;
  maps: Record<string, GameMap>;
  dialogues: Record<string, Dialogue>;
  events: Record<string, GameEvent>;
  database: Database;
  assets: AssetManifest;
  /** Global rules (rulesPath). */
  rules: Rule[];
  /** Parsed .song.json files (when their text was available to the loader). */
  songs: Record<string, Song>;  /** Ids of scripts/*.ts (code attachable to data with "script"). */
  scripts?: string[];
}

/** scripts/<id>.ts — found automatically, no registration. */
export const SCRIPT_PATH = /^scripts\/([a-z0-9][a-z0-9_-]*)\.ts$/i;
export const scriptIdsOf = (paths: Iterable<string>): string[] => [...paths].map(p => SCRIPT_PATH.exec(p)?.[1]).filter((x): x is string => Boolean(x)).sort();


/* ------------------------------------------------------------------ Runtime state & saves */

export const BattleStateSchema = z.object({
  enemyId: IdSchema,
  enemyHp: z.number().int().nonnegative(),
  /** Orders for this turn: companion id → index in its actions. */
  orders: z.record(z.string(), z.number().int().nonnegative()).optional(),
  /** Other enemies in the same battle (with). */
  foes: z.array(z.object({ enemyId: IdSchema, hp: z.number().int().nonnegative(), /** Position at the start of the battle (stays with the enemy when the engine reorders). */ slot: z.number().int().nonnegative().optional() }).strict()).optional(),
  /** Status effects on enemies, by start-of-battle slot ("0", "1"…). */
  enemyStatuses: z.record(z.string(), z.array(z.object({ id: IdSchema, turns: z.number().int().min(0) }).strict())).optional(),
  /** Start-of-battle position of the current first enemy (0 when absent). */
  slot: z.number().int().nonnegative().optional(),
  turn: z.number().int().nonnegative(),
  guarding: z.boolean(),
  canFlee: z.boolean(),
  onDefeat: z.enum(["respawn", "continue"]),
  onVictory: z.array(EffectSchema),
  log: z.array(z.string()),
  /** Per-battle scratch space for systems, keyed by system id (e.g. "used once per battle"). */
  systemData: z.record(z.string(), z.unknown()),
  outcome: z.enum(["ongoing", "victory", "defeat", "fled"]),
  /** Keys of once:"battle" rules that already fired. */
  fired: z.array(z.string()).default([]),
  /** Effects from victory/defeat rules, run after the battle closes. */
  after: z.array(EffectSchema).default([]),
  /** Groups still to come (連戦) and the number of the current one (1 = first). */
  waves: z.array(z.object({ enemy: IdSchema, with: z.array(IdSchema).optional() }).strict()).optional(),
  wave: z.number().int().min(1).optional(),
}).strict();
export type BattleState = z.infer<typeof BattleStateSchema>;

export const SceneSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field") }).strict(),
  z.object({ kind: z.literal("message"), text: z.string(), speaker: z.string().optional(), portrait: z.string().optional(), face: z.number().int().optional() }).strict(),
  z.object({ kind: z.literal("dialogue"), dialogueId: IdSchema, line: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("choice"), dialogueId: IdSchema }).strict(),
  z.object({ kind: z.literal("prompt"), prompt: z.string().optional(), speaker: z.string().optional(), options: z.array(z.object({ id: z.string(), label: z.string(), effects: z.array(EffectSchema) }).strict()) }).strict(),
  /** Waiting for typed text (effect "input"). */
  z.object({
    kind: z.literal("input"), prompt: z.string().optional(), speaker: z.string().optional(), maxLength: z.number().int(), initial: z.string(), saveAs: z.string().optional(),
    answers: z.array(z.object({ match: z.array(z.string()), effects: z.array(EffectSchema) }).strict()).default([]), otherwise: z.array(EffectSchema).default([]),
  }).strict(),
  z.object({ kind: z.literal("battle"), battle: BattleStateSchema }).strict(),
  /** A screen provided by a project system (puzzle, card battle, minigame…). `data` is the system's JSON state. */
  z.object({ kind: z.literal("custom"), system: IdSchema, scene: IdSchema, data: z.unknown(), battle: BattleStateSchema.optional() }).strict(),
  z.object({ kind: z.literal("ending"), ending: IdSchema }).strict(),
  /** project.gameOver.mode "screen": waiting on the GAME OVER screen (advance = wake up again). */
  z.object({ kind: z.literal("gameover") }).strict(),
]);
export type Scene = z.infer<typeof SceneSchema>;

export const GameStateSchema = z.object({
  mapId: IdSchema,
  player: z.object({
    x: CoordSchema,
    y: CoordSchema,
    facing: DirectionSchema,
    hp: z.number().int().nonnegative(),
    stats: StatsSchema,
    /** Set by setPlayer (transformation). Missing = project.player. */
    name: z.string().optional(),
    /** 隊列: "back" takes and deals less damage with normal attacks (project.party). Missing = front. */
    row: z.enum(["front", "back"]).optional(),
    /** project.leveling: current level (missing = 1) and experience gathered toward the next level. */
    level: z.number().int().positive().optional(),
    /** Status effects on the hero (database.statuses) with the turns left. */
    statuses: z.array(z.object({ id: IdSchema, turns: z.number().int().min(0) }).strict()).optional(),
    exp: z.number().int().nonnegative().optional(),
    sprite: z.string().optional(),
  }).strict(),
  /** Abilities learned directly (trait abilities are added on top while the trait is held). */
  abilities: z.array(IdSchema),
  traits: z.array(IdSchema).default([]),
  items: z.record(z.string(), z.number().int().positive()),
  flags: z.record(z.string(), z.boolean()),
  vars: z.record(z.string(), z.number().int()).default({}),
  /** setTile changes: mapId → "x,y" → tile code. */
  tileOverrides: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  /** Keys of fired once:"game"/"map" rules and armed auto rules. */
  fired: z.array(z.string()).default([]),
  sets: z.record(z.string(), z.array(z.string())).default({}),
  /** Moved entities: mapId → entityId → position. */
  entities: z.record(z.string(), z.record(z.string(), z.object({ x: CoordSchema, y: CoordSchema, facing: DirectionSchema, step: z.number().int().nonnegative().optional(), map: z.string().optional() }).strict())).default({}),
  /** Companions with the hero and their HP. */
  party: z.array(z.object({
    id: z.string(), hp: z.number().int().nonnegative(), /** slot → item id */ equipment: z.record(z.string(), z.string()).optional(),
    /** 隊列 (front / back) and 控え (reserve: travels along but does not fight). */
    row: z.enum(["front", "back"]).optional(), reserve: z.boolean().optional(),
  }).strict()).optional(),
  /** Equipped items: slot → item id. */
  equipment: z.record(z.string(), z.string()).optional(),
  /** Entity being carried (carryable): its id and the map it was defined on. */
  carrying: z.object({ id: z.string(), home: z.string() }).strict().optional(),
  /** Pending `schedule` effects (fire when steps >= at). */
  timers: z.array(z.object({ id: z.string().optional(), at: z.number().int(), effects: z.array(EffectSchema) }).strict()).default([]),
  /** Playthrough number (1 = first). Survives newCycle. */
  cycle: z.number().int().positive().default(1),
  ticks: z.number().int().nonnegative().default(0),
  /** Verbs taught (learnVerb) / taken away (forgetVerb). */
  verbsLearned: z.array(z.string()).optional(),
  verbsForgotten: z.array(z.string()).optional(),
  /** Target chosen for the verb in use. */
  target: z.string().optional(),
  /** Regions the player is currently inside (for onEnter/onLeave). */
  regions: z.array(z.string()).default([]),
  /** playBgm override: asset id, null = silence, absent = map default. */
  music: IdSchema.nullable().optional(),
  /** playAmbient override (same rules as music). */
  ambient: IdSchema.nullable().optional(),
  /** Monster / item book: enemies met, wins per enemy, items ever held (project.book). */
  book: z.object({ seen: z.array(IdSchema), defeated: z.record(IdSchema, z.number().int()), items: z.array(IdSchema) }).strict().optional(),
  /** Unlocked achievements, in order (project.achievements). */
  achievements: z.array(IdSchema).optional(),
  /** Camera set by the camera effect (missing = follow the hero at zoom 1). */
  camera: z.object({ x: z.number().optional(), y: z.number().optional(), zoom: z.number().optional(), ms: z.number().int() }).strict().optional(),
  /** Texts typed into input windows ({{text.<id>}}). */
  texts: z.record(IdSchema, z.string()).optional(),
  /** Pictures shown by showPicture, by slot (in the order shown). */
  pictures: z.record(IdSchema, z.object({ image: IdSchema, x: z.number(), y: z.number(), width: z.number(), opacity: z.number(), fadeMs: z.number().int() }).strict()).optional(),
  /** Stable IDs of once-events, once-choices and markDone ids. */
  done: z.array(z.string()),
  scene: SceneSchema,
  /** Effects waiting for the current blocking scene (message/dialogue/battle) to finish. */
  queue: z.array(EffectSchema),
  /** Persistent scratch space for systems, keyed by system id. Must be JSON. */
  systemData: z.record(z.string(), z.unknown()),
  rng: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  /** moveRoute in progress (cutscenes). */
  routes: z.array(z.object({ target: z.string(), steps: z.array(z.string()), wait: z.boolean(), through: z.boolean() }).strict()).optional(),
}).strict();
export type GameState = z.infer<typeof GameStateSchema>;

export const GameSaveSchema = z.object({
  formatVersion: z.literal(SAVE_FORMAT_VERSION),
  projectId: IdSchema,
  savedAt: z.string().datetime(),
  state: GameStateSchema,
}).strict();
export type GameSave = z.infer<typeof GameSaveSchema>;

/* ------------------------------------------------------------------ Song (chiptune BGM written as text) */

export const SongSchema: z.ZodType<Song> = z.object({
  formatVersion: z.literal(1),
  title: z.string().min(1),
  /** Quarter notes per minute. */
  tempo: z.number().min(30).max(300),
  loop: z.boolean().default(true),
  tracks: z.array(z.object({
    name: z.string().optional(),
    wave: z.enum(SONG_WAVES),
    volume: z.number().min(0).max(1).default(0.2),
    /** Space separated: "C4/8 E4/8 G4/4. R/8 | x/16" — note+octave (or R rest, x hit) / 1 2 4 8 16 32, "." = dotted. "|" is ignored. */
    notes: z.string().min(1),
    transpose: z.number().int().min(-24).max(24).default(0),
  }).strict()).min(1).max(8),
}).strict();

/* ------------------------------------------------------------------ Art requests (requirements for generated / sourced images) */

export const ArtRequestSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  kind: z.enum(["tileset", "character", "enemy", "animation", "portrait", "background"]),
  status: z.enum(["draft", "approved", "in-progress", "done", "rejected"]).default("draft"),
  /** generate = AI image generation, site = find a commercially usable file, commission = ask a creator. */
  mode: z.enum(["generate", "site", "commission"]).default("generate"),
  purpose: z.string().default(""),
  description: z.string().min(1),
  mustHave: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  /** The user's own wishes and feedback on previous attempts. */
  userNotes: z.string().default(""),
  spec: z.object({
    cellWidth: z.number().int().positive(),
    cellHeight: z.number().int().positive(),
    columns: z.number().int().positive(),
    rows: z.number().int().positive(),
    layout: z.string().default(""),
    transparent: z.boolean().default(true),
  }).strict(),
  /** Asset id the result will be registered as. */
  assetId: IdSchema.optional(),
  candidates: z.array(z.object({ sourceId: IdSchema, url: z.string().url(), note: z.string().default("") }).strict()).default([]),
}).strict();
export type ArtRequest = z.infer<typeof ArtRequestSchema>;
export const ArtRequestBundleSchema = z.object({ formatVersion: z.literal(1), requests: z.array(ArtRequestSchema) }).strict();

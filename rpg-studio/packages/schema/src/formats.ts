/**
 * Shared data contract for RPG projects (production data format v2) and player saves (save format v2).
 *
 * Everything a game needs is described as data here. The engine must never hard-code a sample's
 * IDs (flags, abilities, tiles, enemies). Project-specific rules belong in `projects/<id>/systems/*.ts`.
 */
import { z } from "zod";

export const PROJECT_FORMAT_VERSION = 2;
export const SAVE_FORMAT_VERSION = 2;
export const ENGINE_VERSION = "0.2.0";

export const IdSchema = z.string().min(1).max(96).regex(/^[a-z0-9][a-z0-9._-]*$/i, "IDは英数字で始まり、英数字・._-のみ使えます");
const RelPathSchema = z.string().min(1).max(240).refine(value => !value.includes("\\") && !value.startsWith("/") && !value.split("/").some(part => part === "" || part === "." || part === ".."), "プロジェクト相対のPOSIXパスを指定してください");
const CoordSchema = z.number().int().nonnegative();
export const DirectionSchema = z.enum(["up", "down", "left", "right"]);
export type Direction = z.infer<typeof DirectionSchema>;

/* ------------------------------------------------------------------ Conditions */

export type Condition =
  | { flag: string; is?: boolean }
  | { ability: string }
  | { item: string; atLeast?: number }
  | { done: string }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() => z.union([
  z.object({ flag: IdSchema, is: z.boolean().optional() }).strict(),
  z.object({ ability: IdSchema }).strict(),
  z.object({ item: IdSchema, atLeast: z.number().int().positive().optional() }).strict(),
  z.object({ done: IdSchema }).strict(),
  z.object({ all: z.array(ConditionSchema).min(1) }).strict(),
  z.object({ any: z.array(ConditionSchema).min(1) }).strict(),
  z.object({ not: ConditionSchema }).strict(),
]));

/* ------------------------------------------------------------------ Effects */

export type Effect =
  | { type: "message"; text: string; speaker?: string }
  | { type: "setFlag"; flag: string; value?: boolean }
  | { type: "unlockAbility"; ability: string }
  | { type: "giveItem"; item: string; count?: number }
  | { type: "takeItem"; item: string; count?: number }
  | { type: "heal"; amount?: number }
  | { type: "teleport"; mapId: string; x: number; y: number; facing?: Direction }
  | { type: "dialogue"; dialogue: string }
  | { type: "battle"; enemy: string; onVictory?: Effect[]; onDefeat?: "respawn" | "continue"; canFlee?: boolean }
  | { type: "markDone"; id: string }
  | { type: "if"; when: Condition; then: Effect[]; else?: Effect[] }
  | { type: "system"; system: string; action: string; args?: Record<string, unknown> };

export const EffectSchema: z.ZodType<Effect> = z.lazy(() => z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), text: z.string().min(1), speaker: z.string().min(1).optional() }).strict(),
  z.object({ type: z.literal("setFlag"), flag: IdSchema, value: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("unlockAbility"), ability: IdSchema }).strict(),
  z.object({ type: z.literal("giveItem"), item: IdSchema, count: z.number().int().positive().optional() }).strict(),
  z.object({ type: z.literal("takeItem"), item: IdSchema, count: z.number().int().positive().optional() }).strict(),
  z.object({ type: z.literal("heal"), amount: z.number().int().positive().optional() }).strict(),
  z.object({ type: z.literal("teleport"), mapId: IdSchema, x: CoordSchema, y: CoordSchema, facing: DirectionSchema.optional() }).strict(),
  z.object({ type: z.literal("dialogue"), dialogue: IdSchema }).strict(),
  z.object({ type: z.literal("battle"), enemy: IdSchema, onVictory: z.array(EffectSchema).optional(), onDefeat: z.enum(["respawn", "continue"]).optional(), canFlee: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("markDone"), id: IdSchema }).strict(),
  z.object({ type: z.literal("if"), when: ConditionSchema, then: z.array(EffectSchema), else: z.array(EffectSchema).optional() }).strict(),
  z.object({ type: z.literal("system"), system: IdSchema, action: IdSchema, args: z.record(z.string(), z.unknown()).optional() }).strict(),
]));

/* ------------------------------------------------------------------ Project manifest */

const FileRefSchema = z.object({ id: IdSchema, path: RelPathSchema, title: z.string().min(1) }).strict();
export const FlagDeclSchema = z.object({ initial: z.boolean().default(false), description: z.string().optional() }).strict();
export const StatsSchema = z.object({
  maxHp: z.number().int().positive().max(9999),
  attack: z.number().int().nonnegative().max(999),
  defense: z.number().int().nonnegative().max(999),
}).strict();
export type Stats = z.infer<typeof StatsSchema>;

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
    items: z.record(IdSchema, z.number().int().positive()).default({}),
  }).strict(),
  /** Every flag used by data or systems must be declared. Typos then fail validation instead of silently never matching. */
  flags: z.record(IdSchema, FlagDeclSchema).default({}),
  maps: z.array(FileRefSchema).min(1),
  tilesetPath: RelPathSchema,
  dialoguesPath: RelPathSchema,
  eventsPath: RelPathSchema,
  databasePath: RelPathSchema,
  assetsPath: RelPathSchema,
  systems: z.array(FileRefSchema).default([]),
}).strict();
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

/* ------------------------------------------------------------------ Tileset */

export const TileDefSchema = z.object({
  code: z.string().length(1).refine(code => code !== " " && code !== "\"" && code !== "\\", "空白・引用符・バックスラッシュはタイルコードに使えません"),
  name: z.string().min(1),
  /** Cell index in the atlas, row-major. */
  index: z.number().int().nonnegative(),
  passable: z.boolean(),
  /** When this condition holds the tile is passable regardless of `passable`. */
  passableWhen: ConditionSchema.optional(),
  /** Atlas cell used while `passableWhen` holds (e.g. an opened gate). */
  openIndex: z.number().int().nonnegative().optional(),
  /** Fallback colour used when the atlas image is unavailable. */
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#63734f"),
}).strict();
export type TileDef = z.infer<typeof TileDefSchema>;

export const TilesetSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  atlas: IdSchema,
  tiles: z.array(TileDefSchema).min(1),
}).strict().superRefine((tileset, ctx) => {
  const seen = new Set<string>();
  tileset.tiles.forEach((tile, index) => {
    if (seen.has(tile.code)) ctx.addIssue({ code: "custom", path: ["tiles", index, "code"], message: `タイルコードが重複しています: '${tile.code}'` });
    seen.add(tile.code);
  });
});
export type Tileset = z.infer<typeof TilesetSchema>;

/* ------------------------------------------------------------------ Maps */

export const NpcSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  x: CoordSchema,
  y: CoordSchema,
  facing: DirectionSchema.default("down"),
  sprite: IdSchema.optional(),
  /** First entry whose `when` holds is used. Put the unconditional default last. */
  dialogues: z.array(z.object({ when: ConditionSchema.optional(), dialogue: IdSchema }).strict()).min(1),
  /** NPC only appears while this holds. */
  visibleWhen: ConditionSchema.optional(),
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
}).strict();
export type Interactable = z.infer<typeof InteractableSchema>;

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
  check("npcs", map.npcs); check("portals", map.portals); check("interactables", map.interactables);
  const ids = new Set<string>();
  [...map.npcs, ...map.portals, ...map.interactables].forEach(item => {
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
  lines: z.array(z.string().min(1)).min(1),
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
  /** "passive" abilities are implemented by systems; "field" abilities are checked by conditions. */
  kind: z.enum(["passive", "field", "battle"]).default("passive"),
}).strict();
export type Ability = z.infer<typeof AbilitySchema>;

export const ItemSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().default(""),
  /** Usable in battle / field to heal. */
  heal: z.number().int().positive().optional(),
  key: z.boolean().default(false),
}).strict();
export type Item = z.infer<typeof ItemSchema>;

export const EnemyActionSchema = z.object({
  name: z.string().min(1),
  /** Added to the enemy attack before defence is subtracted. 0 = a non-damaging move (wind-up, taunt). */
  power: z.number().int().min(0).max(999),
  message: z.string().optional(),
}).strict();

export const EnemySchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  sprite: IdSchema.optional(),
  stats: StatsSchema,
  /** Used in order, cycling, one per turn. */
  actions: z.array(EnemyActionSchema).min(1),
  drops: z.array(z.object({ item: IdSchema, count: z.number().int().positive().default(1) }).strict()).default([]),
  canFlee: z.boolean().default(true),
}).strict();
export type Enemy = z.infer<typeof EnemySchema>;

export const DatabaseSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  abilities: z.array(AbilitySchema).default([]),
  items: z.array(ItemSchema).default([]),
  enemies: z.array(EnemySchema).default([]),
}).strict();
export type Database = z.infer<typeof DatabaseSchema>;

/* ------------------------------------------------------------------ Assets (format 1, unchanged) */

export const ASSET_MANIFEST_FORMAT_VERSION = 1;
export const AssetEntrySchema = z.object({
  id: IdSchema,
  path: RelPathSchema,
  kind: z.enum(["tileset", "character", "enemy", "animation", "bgm", "sfx"]),
  mimeType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  source: z.string().default("自作"),
  license: z.string().default("プロジェクト内素材"),
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
    const image = asset.kind === "tileset" || asset.kind === "character" || asset.kind === "enemy" || asset.kind === "animation";
    if (image) {
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
}

/* ------------------------------------------------------------------ Runtime state & saves */

export const BattleStateSchema = z.object({
  enemyId: IdSchema,
  enemyHp: z.number().int().nonnegative(),
  turn: z.number().int().nonnegative(),
  guarding: z.boolean(),
  canFlee: z.boolean(),
  onDefeat: z.enum(["respawn", "continue"]),
  onVictory: z.array(EffectSchema),
  log: z.array(z.string()),
  /** Per-battle scratch space for systems, keyed by system id (e.g. "used once per battle"). */
  systemData: z.record(z.string(), z.unknown()),
  outcome: z.enum(["ongoing", "victory", "defeat", "fled"]),
}).strict();
export type BattleState = z.infer<typeof BattleStateSchema>;

export const SceneSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field") }).strict(),
  z.object({ kind: z.literal("message"), text: z.string(), speaker: z.string().optional() }).strict(),
  z.object({ kind: z.literal("dialogue"), dialogueId: IdSchema, line: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("choice"), dialogueId: IdSchema }).strict(),
  z.object({ kind: z.literal("battle"), battle: BattleStateSchema }).strict(),
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
  }).strict(),
  abilities: z.array(IdSchema),
  items: z.record(z.string(), z.number().int().positive()),
  flags: z.record(z.string(), z.boolean()),
  /** Stable IDs of once-events, once-choices and markDone ids. */
  done: z.array(z.string()),
  scene: SceneSchema,
  /** Effects waiting for the current blocking scene (message/dialogue/battle) to finish. */
  queue: z.array(EffectSchema),
  /** Persistent scratch space for systems, keyed by system id. Must be JSON. */
  systemData: z.record(z.string(), z.unknown()),
  rng: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
}).strict();
export type GameState = z.infer<typeof GameStateSchema>;

export const GameSaveSchema = z.object({
  formatVersion: z.literal(SAVE_FORMAT_VERSION),
  projectId: IdSchema,
  savedAt: z.string().datetime(),
  state: GameStateSchema,
}).strict();
export type GameSave = z.infer<typeof GameSaveSchema>;

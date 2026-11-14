import type { z } from "zod";
import {
  AssetManifestSchema, DatabaseSchema, DialogueBundleSchema, EventBundleSchema, GameMapSchema, PROJECT_FORMAT_VERSION,
  ProjectManifestSchema, TilesetSchema,
  type Condition, type Effect, type GameContent, type GameMap, type ProjectManifest,
} from "./formats";

export interface Diagnostic {
  severity: "error" | "warning";
  /** Project-relative file path. */
  file?: string;
  /** Human readable location inside the file, e.g. `npcs[scout].dialogues[0]`. */
  at?: string;
  message: string;
}

export interface LoadResult {
  content: GameContent | null;
  diagnostics: Diagnostic[];
}

/** Text content of project files keyed by project-relative POSIX path. Missing files are simply absent. */
export type ProjectFileTexts = Record<string, string>;

function zodDiagnostics(file: string, error: z.ZodError): Diagnostic[] {
  return error.issues.map(issue => ({
    severity: "error" as const,
    file,
    at: issue.path.length ? issue.path.map(String).join(".") : undefined,
    message: issue.message,
  }));
}

function parseJson(file: string, texts: ProjectFileTexts, diagnostics: Diagnostic[]): unknown {
  const text = texts[file];
  if (text === undefined) {
    diagnostics.push({ severity: "error", file, message: "ファイルが見つかりません" });
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    diagnostics.push({ severity: "error", file, message: `JSONとして読めません: ${error instanceof Error ? error.message : String(error)}` });
    return undefined;
  }
}

function parseWith<T>(schema: z.ZodType<T>, file: string, value: unknown, diagnostics: Diagnostic[]): T | null {
  if (value === undefined) return null;
  const result = schema.safeParse(value);
  if (!result.success) {
    diagnostics.push(...zodDiagnostics(file, result.error));
    return null;
  }
  return result.data;
}

/** Reads `formatVersion` from project.json without validating the rest. */
export function detectProjectFormat(projectJsonText: string): number | null {
  try {
    const value = JSON.parse(projectJsonText) as { formatVersion?: unknown };
    return typeof value.formatVersion === "number" ? value.formatVersion : null;
  } catch {
    return null;
  }
}

/** Lists every JSON file the manifest references (used by loaders to know what to read). */
export function referencedJsonFiles(manifest: Pick<ProjectManifest, "maps" | "tilesetPath" | "dialoguesPath" | "eventsPath" | "databasePath" | "assetsPath">): string[] {
  return ["project.json", manifest.tilesetPath, manifest.dialoguesPath, manifest.eventsPath, manifest.databasePath, manifest.assetsPath, ...manifest.maps.map(map => map.path)];
}

/**
 * Parses and cross-validates a whole project from its file texts.
 * Returns content only when there are no errors, so the runtime never receives a half-valid project.
 */
export function loadProjectContent(texts: ProjectFileTexts): LoadResult {
  const diagnostics: Diagnostic[] = [];
  const rawManifest = parseJson("project.json", texts, diagnostics);
  if (rawManifest === undefined) return { content: null, diagnostics };
  const version = (rawManifest as { formatVersion?: unknown })?.formatVersion;
  if (version !== PROJECT_FORMAT_VERSION) {
    const hint = typeof version === "number" && version < PROJECT_FORMAT_VERSION
      ? `旧形式です。\`pnpm rpg:migrate -- --project <folder>\`で差分を確認し、\`--write\`で移行してください（元ファイルはバックアップされます）。`
      : "このエンジンより新しいか不明な形式です。元ファイルは変更していません。";
    diagnostics.push({ severity: "error", file: "project.json", at: "formatVersion", message: `未対応の制作データ形式です (formatVersion=${String(version)}, 対応=${PROJECT_FORMAT_VERSION})。${hint}` });
    return { content: null, diagnostics };
  }
  const project = parseWith(ProjectManifestSchema, "project.json", rawManifest, diagnostics);
  if (!project) return { content: null, diagnostics };

  const tileset = parseWith(TilesetSchema, project.tilesetPath, parseJson(project.tilesetPath, texts, diagnostics), diagnostics);
  const dialogueBundle = parseWith(DialogueBundleSchema, project.dialoguesPath, parseJson(project.dialoguesPath, texts, diagnostics), diagnostics);
  const eventBundle = parseWith(EventBundleSchema, project.eventsPath, parseJson(project.eventsPath, texts, diagnostics), diagnostics);
  const database = parseWith(DatabaseSchema, project.databasePath, parseJson(project.databasePath, texts, diagnostics), diagnostics);
  const assets = parseWith(AssetManifestSchema, project.assetsPath, parseJson(project.assetsPath, texts, diagnostics), diagnostics);
  const maps: Record<string, GameMap> = {};
  const mapFiles: Record<string, string> = {};
  const seenMapIds = new Set<string>();
  project.maps.forEach((ref, index) => {
    if (seenMapIds.has(ref.id)) diagnostics.push({ severity: "error", file: "project.json", at: `maps[${index}].id`, message: `マップIDが重複しています: ${ref.id}` });
    seenMapIds.add(ref.id);
    const map = parseWith(GameMapSchema, ref.path, parseJson(ref.path, texts, diagnostics), diagnostics);
    if (!map) return;
    if (map.id !== ref.id) diagnostics.push({ severity: "error", file: ref.path, at: "id", message: `project.jsonのマップID '${ref.id}' とファイル内のID '${map.id}' が一致しません` });
    maps[ref.id] = map;
    mapFiles[ref.id] = ref.path;
  });
  const systemIds = new Set<string>();
  project.systems.forEach((system, index) => {
    if (systemIds.has(system.id)) diagnostics.push({ severity: "error", file: "project.json", at: `systems[${index}].id`, message: `システムIDが重複しています: ${system.id}` });
    systemIds.add(system.id);
    if (!/\.tsx?$/.test(system.path)) diagnostics.push({ severity: "error", file: "project.json", at: `systems[${index}].path`, message: "システムはTypeScriptファイル(.ts)で指定してください" });
    if (texts[system.path] === undefined) diagnostics.push({ severity: "error", file: system.path, message: "システムのソースファイルが見つかりません" });
  });

  if (!tileset || !dialogueBundle || !eventBundle || !database || !assets || Object.keys(maps).length !== project.maps.length || diagnostics.some(d => d.severity === "error")) {
    return { content: null, diagnostics };
  }
  const content: GameContent = {
    project,
    tileset,
    maps,
    dialogues: Object.fromEntries(dialogueBundle.dialogues.map(dialogue => [dialogue.id, dialogue])),
    events: Object.fromEntries(eventBundle.events.map(event => [event.id, event])),
    database,
    assets,
  };
  duplicateIds(project.dialoguesPath, "dialogues", dialogueBundle.dialogues, diagnostics);
  duplicateIds(project.eventsPath, "events", eventBundle.events, diagnostics);
  duplicateIds(project.databasePath, "abilities", database.abilities, diagnostics);
  duplicateIds(project.databasePath, "items", database.items, diagnostics);
  duplicateIds(project.databasePath, "enemies", database.enemies, diagnostics);
  diagnostics.push(...checkReferences(content, mapFiles));
  return { content: diagnostics.some(d => d.severity === "error") ? null : content, diagnostics };
}

function duplicateIds(file: string, at: string, list: Array<{ id: string }>, diagnostics: Diagnostic[]): void {
  const seen = new Set<string>();
  list.forEach((item, index) => {
    if (seen.has(item.id)) diagnostics.push({ severity: "error", file, at: `${at}[${index}].id`, message: `IDが重複しています: ${item.id}` });
    seen.add(item.id);
  });
}

/** Cross-file reference checks. Pure; usable from CLI, studio and tests. */
export function checkReferences(content: GameContent, mapFiles: Record<string, string> = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  const { project, tileset, maps, dialogues, events, database, assets } = content;
  const P = "project.json";
  const err = (file: string, at: string, message: string) => out.push({ severity: "error", file, at, message });
  const warn = (file: string, at: string, message: string) => out.push({ severity: "warning", file, at, message });
  const abilityIds = new Set(database.abilities.map(a => a.id));
  const itemIds = new Set(database.items.map(i => i.id));
  const enemyIds = new Set(database.enemies.map(e => e.id));
  const systemIds = new Set(project.systems.map(s => s.id));
  const assetById = new Map(assets.assets.map(a => [a.id, a]));
  const tileByCode = new Map(tileset.tiles.map(t => [t.code, t]));
  const flagIds = new Set(Object.keys(project.flags));

  // IDs that `done` conditions may refer to.
  const doneIds = new Set<string>();
  for (const event of Object.values(events)) doneIds.add(event.id);
  for (const dialogue of Object.values(dialogues)) for (const choice of dialogue.choices) doneIds.add(`${dialogue.id}/${choice.id}`);
  const collectMarkDone = (effects: Effect[]) => walkEffects(effects, effect => { if (effect.type === "markDone") doneIds.add(effect.id); });
  for (const event of Object.values(events)) { collectMarkDone(event.effects); collectMarkDone(event.otherwise); collectMarkDone(event.afterDone); }
  for (const dialogue of Object.values(dialogues)) { collectMarkDone(dialogue.effects); dialogue.choices.forEach(c => collectMarkDone(c.effects)); }

  const mapFile = (mapId: string) => mapFiles[mapId] ?? `maps/${mapId}.json`;
  const tileAt = (mapId: string, x: number, y: number) => {
    const map = maps[mapId];
    if (!map || x >= map.width || y >= map.height) return undefined;
    return tileByCode.get(Array.from(map.rows[y] ?? "")[x] ?? "");
  };
  const checkPosition = (file: string, at: string, mapId: string, x: number, y: number, label: string) => {
    const map = maps[mapId];
    if (!map) { err(file, at, `${label}のマップ '${mapId}' が存在しません`); return; }
    if (x >= map.width || y >= map.height) { err(file, at, `${label}の座標(${x}, ${y})がマップ '${mapId}' の範囲外です`); return; }
    const tile = tileAt(mapId, x, y);
    if (tile && !tile.passable && !tile.passableWhen) warn(file, at, `${label}の座標(${x}, ${y})は通行不可タイル「${tile.name}」です`);
  };

  const checkCondition = (file: string, at: string, condition: Condition | undefined) => {
    if (!condition) return;
    walkCondition(condition, c => {
      if ("flag" in c && !flagIds.has(c.flag)) err(file, at, `未宣言のフラグ '${c.flag}' を参照しています。project.jsonのflagsに宣言してください`);
      if ("ability" in c && !abilityIds.has(c.ability)) err(file, at, `未定義の能力 '${c.ability}' を参照しています`);
      if ("item" in c && !itemIds.has(c.item)) err(file, at, `未定義のアイテム '${c.item}' を参照しています`);
      if ("done" in c && !doneIds.has(c.done)) err(file, at, `完了IDとして不明な '${c.done}' を参照しています（イベントID、'会話ID/選択肢ID'、markDoneのID）`);
    });
  };
  const checkEffects = (file: string, at: string, effects: Effect[]) => {
    effects.forEach((effect, index) => {
      const here = `${at}[${index}]`;
      switch (effect.type) {
        case "setFlag": if (!flagIds.has(effect.flag)) err(file, here, `未宣言のフラグ '${effect.flag}' を設定しています`); break;
        case "unlockAbility": if (!abilityIds.has(effect.ability)) err(file, here, `未定義の能力 '${effect.ability}'`); break;
        case "giveItem": case "takeItem": if (!itemIds.has(effect.item)) err(file, here, `未定義のアイテム '${effect.item}'`); break;
        case "teleport": checkPosition(file, here, effect.mapId, effect.x, effect.y, "移動先"); break;
        case "dialogue": if (!dialogues[effect.dialogue]) err(file, here, `未定義の会話 '${effect.dialogue}'`); break;
        case "battle":
          if (!enemyIds.has(effect.enemy)) err(file, here, `未定義の敵 '${effect.enemy}'`);
          if (effect.onVictory) checkEffects(file, `${here}.onVictory`, effect.onVictory);
          break;
        case "if":
          checkCondition(file, `${here}.when`, effect.when);
          checkEffects(file, `${here}.then`, effect.then);
          if (effect.else) checkEffects(file, `${here}.else`, effect.else);
          break;
        case "system": if (!systemIds.has(effect.system)) err(file, here, `project.jsonのsystemsにないシステム '${effect.system}'`); break;
        default: break;
      }
    });
  };

  // Manifest.
  checkPosition(P, "start", project.start.mapId, project.start.x, project.start.y, "開始位置");
  if (project.player.sprite && assetById.get(project.player.sprite)?.kind !== "character") err(P, "player.sprite", `キャラクター素材 '${project.player.sprite}' がassets.jsonにありません`);
  project.player.abilities.forEach((id, i) => { if (!abilityIds.has(id)) err(P, `player.abilities[${i}]`, `未定義の能力 '${id}'`); });
  Object.keys(project.player.items).forEach(id => { if (!itemIds.has(id)) err(P, `player.items.${id}`, `未定義のアイテム '${id}'`); });

  // Tileset.
  const atlas = assetById.get(tileset.atlas);
  if (!atlas || atlas.kind !== "tileset") err(project.tilesetPath, "atlas", `タイルシート素材 '${tileset.atlas}' がassets.jsonにありません`);
  tileset.tiles.forEach((tile, index) => {
    const capacity = (atlas?.columns ?? 0) * (atlas?.rows ?? 0);
    for (const field of ["index", "openIndex"] as const) {
      const value = tile[field];
      if (atlas && value !== undefined && value >= capacity) err(project.tilesetPath, `tiles[${index}].${field}`, `アトラスの範囲外です (${value} >= ${capacity})`);
    }
    checkCondition(project.tilesetPath, `tiles[${index}].passableWhen`, tile.passableWhen);
  });

  // Maps.
  for (const map of Object.values(maps)) {
    const file = mapFile(map.id);
    map.rows.forEach((row, y) => Array.from(row).forEach((code, x) => {
      if (!tileByCode.has(code)) err(file, `rows[${y}]`, `タイルセットにないコード '${code}' (x=${x}, y=${y})`);
    }));
    const occupied = new Map<string, string>();
    const occupy = (id: string, x: number, y: number, at: string) => {
      const key = `${x},${y}`;
      const other = occupied.get(key);
      if (other) warn(file, at, `${id}と${other}が同じ座標(${x}, ${y})にあります`);
      occupied.set(key, id);
    };
    map.npcs.forEach((npc, i) => {
      const at = `npcs[${npc.id}]`;
      occupy(npc.id, npc.x, npc.y, at);
      if (npc.sprite && assetById.get(npc.sprite)?.kind !== "character") err(file, `${at}.sprite`, `キャラクター素材 '${npc.sprite}' がassets.jsonにありません`);
      npc.dialogues.forEach((entry, j) => {
        if (!dialogues[entry.dialogue]) err(file, `${at}.dialogues[${j}]`, `未定義の会話 '${entry.dialogue}'`);
        checkCondition(file, `${at}.dialogues[${j}].when`, entry.when);
      });
      if (npc.dialogues[npc.dialogues.length - 1]?.when) warn(file, `${at}.dialogues`, "最後の会話に条件があります。どれにも一致しないとき話しかけても反応しません");
      checkCondition(file, `${at}.visibleWhen`, npc.visibleWhen);
      void i;
    });
    map.portals.forEach(portal => {
      const at = `portals[${portal.id}]`;
      occupy(portal.id, portal.x, portal.y, at);
      checkPosition(file, `${at}.target`, portal.targetMapId, portal.targetX, portal.targetY, "出入口の行き先");
      checkCondition(file, `${at}.when`, portal.when);
    });
    map.interactables.forEach(item => {
      const at = `interactables[${item.id}]`;
      occupy(item.id, item.x, item.y, at);
      if (!events[item.event]) err(file, `${at}.event`, `未定義のイベント '${item.event}'`);
      checkCondition(file, `${at}.visibleWhen`, item.visibleWhen);
    });
    if (map.encounters) {
      map.encounters.enemies.forEach((id, i) => { if (!enemyIds.has(id)) err(file, `encounters.enemies[${i}]`, `未定義の敵 '${id}'`); });
      map.encounters.tiles.forEach((code, i) => { if (!tileByCode.has(code)) err(file, `encounters.tiles[${i}]`, `タイルセットにないコード '${code}'`); });
    }
  }

  // Dialogues & events.
  for (const dialogue of Object.values(dialogues)) {
    const at = `dialogues[${dialogue.id}]`;
    checkEffects(project.dialoguesPath, `${at}.effects`, dialogue.effects);
    dialogue.choices.forEach(choice => {
      checkCondition(project.dialoguesPath, `${at}.choices[${choice.id}].when`, choice.when);
      checkEffects(project.dialoguesPath, `${at}.choices[${choice.id}].effects`, choice.effects);
    });
  }
  for (const event of Object.values(events)) {
    const at = `events[${event.id}]`;
    checkCondition(project.eventsPath, `${at}.when`, event.when);
    checkEffects(project.eventsPath, `${at}.effects`, event.effects);
    checkEffects(project.eventsPath, `${at}.otherwise`, event.otherwise);
    checkEffects(project.eventsPath, `${at}.afterDone`, event.afterDone);
    if (event.afterDone.length && !event.once) warn(project.eventsPath, `${at}.afterDone`, "once=falseのイベントではafterDoneは使われません");
  }

  // Database.
  database.enemies.forEach(enemy => {
    if (enemy.sprite && assetById.get(enemy.sprite)?.kind !== "enemy" && assetById.get(enemy.sprite)?.kind !== "character") err(project.databasePath, `enemies[${enemy.id}].sprite`, `素材 '${enemy.sprite}' がassets.jsonにありません`);
    enemy.drops.forEach((drop, i) => { if (!itemIds.has(drop.item)) err(project.databasePath, `enemies[${enemy.id}].drops[${i}]`, `未定義のアイテム '${drop.item}'`); });
  });

  // Unreferenced content is not an error, but usually a mistake when an agent adds data.
  const usedEvents = new Set<string>();
  const usedDialogues = new Set<string>();
  for (const map of Object.values(maps)) {
    map.interactables.forEach(i => usedEvents.add(i.event));
    map.npcs.forEach(n => n.dialogues.forEach(d => usedDialogues.add(d.dialogue)));
  }
  const noteDialogueRefs = (effects: Effect[]) => walkEffects(effects, e => { if (e.type === "dialogue") usedDialogues.add(e.dialogue); });
  Object.values(events).forEach(e => { noteDialogueRefs(e.effects); noteDialogueRefs(e.otherwise); noteDialogueRefs(e.afterDone); });
  Object.values(dialogues).forEach(d => { noteDialogueRefs(d.effects); d.choices.forEach(c => noteDialogueRefs(c.effects)); });
  for (const id of Object.keys(events)) if (!usedEvents.has(id)) warn(project.eventsPath, `events[${id}]`, "どのマップからも参照されていないイベントです");
  for (const id of Object.keys(dialogues)) if (!usedDialogues.has(id)) warn(project.dialoguesPath, `dialogues[${id}]`, "どのNPC・イベントからも参照されていない会話です");
  return out;
}

export function walkCondition(condition: Condition, visit: (condition: Condition) => void): void {
  visit(condition);
  if ("all" in condition) condition.all.forEach(c => walkCondition(c, visit));
  else if ("any" in condition) condition.any.forEach(c => walkCondition(c, visit));
  else if ("not" in condition) walkCondition(condition.not, visit);
}

export function walkEffects(effects: Effect[], visit: (effect: Effect) => void): void {
  for (const effect of effects) {
    visit(effect);
    if (effect.type === "battle" && effect.onVictory) walkEffects(effect.onVictory, visit);
    if (effect.type === "if") { walkEffects(effect.then, visit); if (effect.else) walkEffects(effect.else, visit); }
  }
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = [d.file, d.at].filter(Boolean).join(" › ");
  return `${d.severity === "error" ? "ERROR" : "WARN "} ${where ? `${where}: ` : ""}${d.message}`;
}

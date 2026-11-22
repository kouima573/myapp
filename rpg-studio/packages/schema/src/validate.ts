import type { z } from "zod";
import { assetCategory, isSourceEnabled, sourcesFor } from "./sources";
import {
  scriptIdsOf, type ScriptRef,
  AssetManifestSchema, BATTLE_TRIGGERS, DatabaseSchema, IMAGE_KINDS, parseNotes, RuleBundleSchema, SongSchema, DialogueBundleSchema, EventBundleSchema, GameMapSchema, PROJECT_FORMAT_VERSION,
  ProjectManifestSchema, TilesetSchema,
  type Condition, type Effect, type Expr, type Song, type GameContent, type GameMap, type ProjectManifest, type Rule, type StatMods, type Use,
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
export function referencedJsonFiles(manifest: Pick<ProjectManifest, "maps" | "tilesetPath" | "dialoguesPath" | "eventsPath" | "databasePath" | "assetsPath" | "rulesPath">): string[] {
  return ["project.json", manifest.tilesetPath, manifest.dialoguesPath, manifest.eventsPath, manifest.databasePath, manifest.assetsPath, ...(manifest.rulesPath ? [manifest.rulesPath] : []), ...manifest.maps.map(map => map.path)];
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
  const ruleBundle = project.rulesPath ? parseWith(RuleBundleSchema, project.rulesPath, parseJson(project.rulesPath, texts, diagnostics), diagnostics) : { formatVersion: PROJECT_FORMAT_VERSION, rules: [] };
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

  const scripts = scriptIdsOf(Object.keys(texts));
  for (const id of scripts) if (systemIds.has(id)) diagnostics.push({ severity: "error", file: `scripts/${id}.ts`, message: `スクリプト '${id}' と同じIDのシステムが project.json の systems にあります` });

  if (!tileset || !dialogueBundle || !eventBundle || !database || !assets || !ruleBundle || Object.keys(maps).length !== project.maps.length || diagnostics.some(d => d.severity === "error")) {
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
    rules: ruleBundle.rules,
    songs: {},
    scripts,
  };
  for (const asset of assets.assets) {
    if (asset.kind !== "song" || texts[asset.path] === undefined) continue;
    const song = parseWith(SongSchema, asset.path, parseJson(asset.path, texts, diagnostics), diagnostics);
    if (!song) continue;
    song.tracks.forEach((track, i) => {
      try { parseNotes(track.notes, track.transpose); }
      catch (error) { diagnostics.push({ severity: "error", file: asset.path, at: `tracks[${i}].notes`, message: error instanceof Error ? error.message : String(error) }); }
    });
    content.songs[asset.id] = song as Song;
  }
  duplicateIds(project.dialoguesPath, "dialogues", dialogueBundle.dialogues, diagnostics);
  duplicateIds(project.eventsPath, "events", eventBundle.events, diagnostics);
  duplicateIds(project.databasePath, "abilities", database.abilities, diagnostics);
  duplicateIds(project.databasePath, "items", database.items, diagnostics);
  duplicateIds(project.databasePath, "statuses", database.statuses, diagnostics);
  duplicateIds(project.databasePath, "companions", database.companions, diagnostics);
  duplicateIds(project.databasePath, "enemies", database.enemies, diagnostics);
  duplicateIds(project.databasePath, "traits", database.traits, diagnostics);
  if (project.rulesPath) duplicateIds(project.rulesPath, "rules", ruleBundle.rules, diagnostics);
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
  const DB = project.databasePath;
  const err = (file: string, at: string, message: string) => out.push({ severity: "error", file, at, message });
  const warn = (file: string, at: string, message: string) => out.push({ severity: "warning", file, at, message });
  const abilityIds = new Set(database.abilities.map(a => a.id));
  const traitIds = new Set(database.traits.map(t => t.id));
  const statusIds = new Set(database.statuses.map(s => s.id));
  const elementIds = new Set(Object.keys(project.elements));
  const itemIds = new Set(database.items.map(i => i.id));
  const enemyIds = new Set(database.enemies.map(e => e.id));
  const enemyTags = new Set(database.enemies.flatMap(e => e.tags));
  const scriptIds = new Set(content.scripts ?? []);
  const systemIds = new Set([...project.systems.map(s => s.id), ...Object.keys(project.modules), ...scriptIds]);
  const checkScript = (file: string, at: string, ref: ScriptRef | undefined) => {
    const id = ref === undefined ? undefined : typeof ref === "string" ? ref : ref.id;
    if (id && !scriptIds.has(id)) err(file, `${at}.script`, `スクリプト '${id}' がありません（scripts/${id}.ts を作ってください）`);
  };
  const assetById = new Map(assets.assets.map(a => [a.id, a]));
  const tileByCode = new Map(tileset.tiles.map(t => [t.code, t]));
  const flagIds = new Set(Object.keys(project.flags));
  const varIds = new Set(Object.keys(project.variables));
  const setIds = new Set([...Object.keys(project.sets), "endings"]);
  const regionIds = new Set(Object.values(maps).flatMap(m => m.regions.map(r => r.id)));
  const entityIds = new Set(Object.values(maps).flatMap(m => m.entities.map(e => e.id)));
  const npcIds = new Set(Object.values(maps).flatMap(m => m.npcs.map(n => n.id)));
  const verbIds = new Set(Object.keys(content.project.verbs));
  const signalIds = new Set(Object.keys(content.project.signals));
  const endingIds = new Set(Object.keys(project.endings));
  const systemRef = (file: string, at: string, ref: string, what: string) => {
    const systemId = ref.slice(0, ref.lastIndexOf("."));
    if (!systemIds.has(systemId)) err(file, at, `${what} '${ref}' のシステム '${systemId}' が project.json の systems にありません`);
  };
  const A = project.assetsPath;
  const checkAudio = (file: string, at: string, id: string | null | undefined, kinds: string[], label: string) => {
    if (!id) return;
    const asset = assetById.get(id);
    if (!asset) err(file, at, `${label}の素材 '${id}' がassets.jsonにありません`);
    else if (!kinds.includes(asset.kind)) err(file, at, `${label}には ${kinds.join("/")} の素材を指定してください（'${id}' は ${asset.kind}）`);
  };
  const MUSIC = ["bgm", "song"], SOUND = ["sfx", "song", "bgm"];

  // IDs that `done` conditions may refer to.
  const doneIds = new Set<string>();
  for (const event of Object.values(events)) doneIds.add(event.id);
  for (const dialogue of Object.values(dialogues)) for (const choice of dialogue.choices) doneIds.add(`${dialogue.id}/${choice.id}`);
  forEachEffectList(content, (effects) => walkEffects(effects, effect => { if (effect.type === "markDone") doneIds.add(effect.id); }));

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
    if (tile && !tile.passable && !tile.passableWhen && !map.overlays.length) warn(file, at, `${label}の座標(${x}, ${y})は通行不可タイル「${tile.name}」です`);
  };
  const checkText = (file: string, at: string, text: string) => {
    for (const match of text.matchAll(/\{\{\s*([a-zA-Z]+)(?:\.([^}\s]+))?\s*\}\}/g)) {
      const [, kind, key] = match;
      if (kind === "var" && key && !varIds.has(key)) warn(file, at, `文中の {{var.${key}}} は未宣言の変数です`);
      else if (kind === "item" && key && !itemIds.has(key)) warn(file, at, `文中の {{item.${key}}} は未定義のアイテムです`);
      else if (kind === "flag" && key && !flagIds.has(key)) warn(file, at, `文中の {{flag.${key}}} は未宣言のフラグです`);
      else if (!["var", "item", "flag", "stat", "hp", "maxHp", "name", "ctx", "enemy", "trait", "set", "cycle", "target", "targetLabel", "text"].includes(kind!)) warn(file, at, `文中の {{${kind}}} は使えない差し込みです`);
    }
    // Text decoration [se=id] plays a sound while typing.
    for (const match of text.matchAll(/\[se=([A-Za-z0-9][A-Za-z0-9._-]*)\]/g)) {
      const kind = assetById.get(match[1]!)?.kind;
      if (kind !== "sfx" && kind !== "bgm") warn(file, at, `文中の [se=${match[1]}] は効果音の素材ではありません`);
    }
  };

  const checkExpr = (file: string, at: string, expr: Expr | undefined, ctxAllowed = false) => {
    if (expr === undefined) return;
    walkExpr(expr, e => {
      if (typeof e === "number") return;
      if ("var" in e && !varIds.has(e.var)) err(file, at, `未宣言の変数 '${e.var}' を参照しています。project.jsonのvariablesに宣言してください`);
      if ("count" in e && !itemIds.has(e.count)) err(file, at, `未定義のアイテム '${e.count}' を参照しています`);
      if ("ctx" in e && !ctxAllowed) warn(file, at, `{"ctx":"${e.ctx}"} は戦闘・ダメージのルール以外では常に0です`);
      if ("size" in e && !setIds.has(e.size)) err(file, at, `未宣言の集合 '${e.size}'（project.json の sets）`);
      if ("fn" in e) systemRef(file, at, e.fn, "関数");
    }, c => checkCondition(file, at, c, ctxAllowed));
  };
  function checkCondition(file: string, at: string, condition: Condition | undefined, ctxAllowed = false) {
    if (!condition) return;
    walkCondition(condition, c => {
      if ("flag" in c && !flagIds.has(c.flag)) err(file, at, `未宣言のフラグ '${c.flag}' を参照しています。project.jsonのflagsに宣言してください`);
      if ("var" in c) { if (!varIds.has(c.var)) err(file, at, `未宣言の変数 '${c.var}' を参照しています`); checkExpr(file, at, c.value, ctxAllowed); }
      if ("compare" in c) { checkExpr(file, at, c.compare[0], ctxAllowed); checkExpr(file, at, c.compare[2], ctxAllowed); }
      if ("ability" in c && !abilityIds.has(c.ability)) err(file, at, `未定義の能力 '${c.ability}' を参照しています`);
      if ("trait" in c && !traitIds.has(c.trait)) err(file, at, `未定義の特性 '${c.trait}' を参照しています`);
      if ("status" in c && !statusIds.has(c.status)) err(file, at, `未定義の状態異常 '${c.status}'（database.json の statuses）`);
      if ("item" in c && !itemIds.has(c.item)) err(file, at, `未定義のアイテム '${c.item}' を参照しています`);
      if ("done" in c && !doneIds.has(c.done)) err(file, at, `完了IDとして不明な '${c.done}' を参照しています（イベントID、'会話ID/選択肢ID'、markDoneのID）`);
      if ("map" in c && !maps[c.map]) err(file, at, `未定義のマップ '${c.map}'`);
      if ("enemy" in c && !enemyIds.has(c.enemy)) err(file, at, `未定義の敵 '${c.enemy}'`);
      if ("enemyTag" in c && !enemyTags.has(c.enemyTag)) warn(file, at, `どの敵にも付いていないタグ '${c.enemyTag}'`);
      if ("set" in c && !setIds.has(c.set)) err(file, at, `未宣言の集合 '${c.set}'（project.json の sets）`);
      if ("set" in c && c.set === "endings" && !endingIds.has(c.has)) err(file, at, `未宣言のエンディング '${c.has}'`);
      if ("inRegion" in c && !regionIds.has(c.inRegion)) err(file, at, `どのマップにもない領域 '${c.inRegion}'`);
      if ("entityAt" in c) {
        if (!entityIds.has(c.entityAt.entity)) err(file, at, `entityAt: どのマップにもないエンティティ '${c.entityAt.entity}'`);
        if (c.entityAt.map && !maps[c.entityAt.map]) err(file, at, `entityAt: 未定義のマップ '${c.entityAt.map}'`);
      }
      if ("equipped" in c && !itemIds.has(c.equipped)) err(file, at, `equipped: 未定義のアイテム '${c.equipped}'`);
      if ("carrying" in c && !entityIds.has(c.carrying)) err(file, at, `carrying: どのマップにもないエンティティ '${c.carrying}'`);
      if ("front" in c) {
        if (c.front.tile !== undefined && !tileByCode.has(c.front.tile)) err(file, at, `front.tile: タイルセットにないコード '${c.front.tile}'`);
        if (c.front.entity !== undefined && !entityIds.has(c.front.entity)) err(file, at, `front.entity: どのマップにもないエンティティ '${c.front.entity}'`);
        if (c.front.npc !== undefined && !npcIds.has(c.front.npc)) err(file, at, `front.npc: どのマップにもないNPC '${c.front.npc}'`);
      }
      if ("custom" in c) systemRef(file, at, c.custom, "条件");
    });
  }
  const checkEffects = (file: string, at: string, effects: Effect[], ctxAllowed = false) => {
    effects.forEach((effect, index) => {
      const here = `${at}[${index}]`;
      switch (effect.type) {
        case "message": case "battleLog":
          checkText(file, here, effect.text);
          if (effect.type === "message" && effect.portrait && !["portrait", "character"].includes(assetById.get(effect.portrait)?.kind ?? "")) err(file, here, `顔グラフィックの素材 '${effect.portrait}' がありません（portrait か character）`);
          break;
        case "setFlag": if (!flagIds.has(effect.flag)) err(file, here, `未宣言のフラグ '${effect.flag}' を設定しています`); break;
        case "setVar": if (!varIds.has(effect.var)) err(file, here, `未宣言の変数 '${effect.var}' を設定しています`); checkExpr(file, here, effect.value, ctxAllowed); break;
        case "random": if (!varIds.has(effect.var)) err(file, here, `未宣言の変数 '${effect.var}'`); checkExpr(file, here, effect.min, ctxAllowed); checkExpr(file, here, effect.max, ctxAllowed); break;
        case "input":
          (effect.answers ?? []).forEach((a, i) => checkEffects(file, `${here}.answers[${i}]`, a.effects, ctxAllowed));
          if (effect.otherwise) checkEffects(file, `${here}.otherwise`, effect.otherwise, ctxAllowed);
          if (effect.prompt) checkText(file, here, effect.prompt);
          break;
        case "chance": checkExpr(file, here, effect.percent, ctxAllowed); checkEffects(file, `${here}.then`, effect.then, ctxAllowed); if (effect.else) checkEffects(file, `${here}.else`, effect.else, ctxAllowed); break;
        case "setStat": checkExpr(file, here, effect.value, ctxAllowed); break;
        case "unlockAbility": case "removeAbility": if (!abilityIds.has(effect.ability)) err(file, here, `未定義の能力 '${effect.ability}'`); break;
        case "grantTrait": case "removeTrait": if (!traitIds.has(effect.trait)) err(file, here, `未定義の特性 '${effect.trait}'`); break;
        case "emote": case "moveRoute": if (effect.target !== "player" && !entityIds.has(effect.target) && !(effect.type === "emote" && npcIds.has(effect.target))) err(file, here, `'${effect.target}' は ${effect.type === "emote" ? "player・NPC・エンティティ" : "player・エンティティ（NPCは動かせないのでエンティティで置く）"} のどれでもありません`); break;
        case "addStatus": if (!statusIds.has(effect.status)) err(file, here, `未定義の状態異常 '${effect.status}'（database.json の statuses）`); break;
        case "removeStatus": if (effect.status && !statusIds.has(effect.status)) err(file, here, `未定義の状態異常 '${effect.status}'`); break;
        case "giveItem": case "takeItem": if (!itemIds.has(effect.item)) err(file, here, `未定義のアイテム '${effect.item}'`); break;
        case "heal": checkExpr(file, here, effect.amount, ctxAllowed); break;
        case "damage":
          checkExpr(file, here, effect.amount, ctxAllowed);
          if (effect.text) checkText(file, here, effect.text);
          if (effect.element && !elementIds.has(effect.element)) err(file, here, `未定義の属性 '${effect.element}'（project.json の elements）`);
          break;
        case "teleport": checkPosition(file, here, effect.mapId, effect.x, effect.y, "移動先"); break;
        case "setTile": {
          if (!tileByCode.has(effect.code)) err(file, here, `タイルセットにないコード '${effect.code}'`);
          const map = effect.mapId ? maps[effect.mapId] : undefined;
          if (effect.mapId && !map) err(file, here, `未定義のマップ '${effect.mapId}'`);
          if (map && (effect.x >= map.width || effect.y >= map.height)) err(file, here, `座標(${effect.x}, ${effect.y})がマップ範囲外です`);
          break;
        }
        case "dialogue": if (!dialogues[effect.dialogue]) err(file, here, `未定義の会話 '${effect.dialogue}'`); break;
        case "choice":
          if (effect.prompt) checkText(file, here, effect.prompt);
          effect.options.forEach((option, i) => { checkCondition(file, `${here}.options[${i}].when`, option.when); checkText(file, `${here}.options[${i}]`, option.label); checkEffects(file, `${here}.options[${i}].effects`, option.effects); });
          break;
        case "event": if (!events[effect.event]) err(file, here, `未定義のイベント '${effect.event}'`); break;
        case "battle":
          if (!enemyIds.has(effect.enemy)) err(file, here, `未定義の敵 '${effect.enemy}'`);
          for (const extra of effect.with ?? []) if (!enemyIds.has(extra)) err(file, here, `with: 未定義の敵 '${extra}'`);
          (effect.waves ?? []).forEach((w, i) => { for (const id of [w.enemy, ...(w.with ?? [])]) if (!enemyIds.has(id)) err(file, `${here}.waves[${i}]`, `未定義の敵 '${id}'`); });
          if (effect.waves?.length && effect.mode && effect.mode !== "builtin") warn(file, here, "waves（連戦）は標準の戦闘だけで使われます");
          if (effect.with?.length && effect.mode && effect.mode !== "builtin") warn(file, here, "with（複数の敵）は標準の戦闘だけで使われます。戦闘モードでは最初の敵だけと戦います");
          if (effect.mode && effect.mode !== "builtin" && !systemIds.has(effect.mode.slice(0, effect.mode.lastIndexOf(".")))) err(file, here, `戦闘モード '${effect.mode}' のモジュール・システムがありません`);
          if (effect.onVictory) checkEffects(file, `${here}.onVictory`, effect.onVictory);
          break;
        case "if":
          checkCondition(file, `${here}.when`, effect.when, ctxAllowed);
          checkEffects(file, `${here}.then`, effect.then, ctxAllowed);
          if (effect.else) checkEffects(file, `${here}.else`, effect.else, ctxAllowed);
          break;
        case "system": if (!systemIds.has(effect.system)) err(file, here, `project.jsonのsystemsにないシステム '${effect.system}'`); break;
        case "script": if (!scriptIds.has(effect.script)) err(file, here, `スクリプト '${effect.script}' がありません（scripts/${effect.script}.ts）`); break;
        case "playSfx": checkAudio(file, here, effect.sound, SOUND, "効果音"); break;
        case "unlockAchievement": if (!content.project.achievements[effect.achievement]) err(file, here, `未定義の実績 '${effect.achievement}'（project.json の achievements）`); break;
        case "showPicture": if (!["background", "portrait", "enemy", "character"].includes(assetById.get(effect.image)?.kind ?? "")) err(file, here, `一枚絵の素材 '${effect.image}' がありません（background・portrait・enemy・character）`); break;
        case "addToSet": case "removeFromSet": case "clearSet": if (!setIds.has(effect.set)) err(file, here, `未宣言の集合 '${effect.set}'`); break;
        case "moveEntity": {
          const map = effect.mapId ? maps[effect.mapId] : undefined;
          if (effect.mapId && !map) err(file, here, `未定義のマップ '${effect.mapId}'`);
          if (!entityIds.has(effect.entity)) err(file, here, `どのマップにもないエンティティ '${effect.entity}'`);
          break;
        }
        case "schedule": checkExpr(file, here, effect.after, ctxAllowed); checkEffects(file, `${here}.effects`, effect.effects); break;
        case "startScene":
          for (const [i, list] of nestedEffectLists(effect.args ?? {}).entries()) checkEffects(file, `${here}.args(効果${i})`, list);
          for (const cond of nestedConditions(effect.args ?? {})) checkCondition(file, `${here}.args.when`, cond);
          if (!systemIds.has(effect.system)) err(file, here, `'${effect.system}' は project.json の systems にも modules にもありません`); break;
        case "ending": if (!endingIds.has(effect.ending)) err(file, here, `未宣言のエンディング '${effect.ending}'（project.json の endings）`); break;
        case "playBgm": checkAudio(file, here, effect.music, MUSIC, "BGM"); break;
        case "playAmbient": checkAudio(file, here, effect.sound, ["bgm", "sfx"], "環境音"); break;
        case "joinParty": case "leaveParty": if (!content.database.companions.some(x => x.id === effect.companion)) err(file, here, `未定義の仲間 '${effect.companion}'（database.json の companions）`); break;
        case "equip": { const it = content.database.items.find(i => i.id === effect.item); if (!it) err(file, here, `未定義のアイテム '${effect.item}'`); else if (!it.slot) err(file, here, `'${effect.item}' は装備品ではありません（slot がない）`); if (effect.companion && !content.database.companions.some(x => x.id === effect.companion)) err(file, here, `未定義の仲間 '${effect.companion}'`); break; }
        case "unequip": if (effect.companion && !content.database.companions.some(x => x.id === effect.companion)) err(file, here, `未定義の仲間 '${effect.companion}'`); if (!content.project.equipmentSlots[effect.slot]) err(file, here, `未定義の装備枠 '${effect.slot}'（project.json の equipmentSlots）`); break;
        case "learnVerb": case "forgetVerb": case "useVerb": if (!verbIds.has(effect.verb)) err(file, here, `未定義の動詞 '${effect.verb}'（project.json の verbs）`); break;
        case "signal": if (!signalIds.has(effect.signal)) err(file, here, `未宣言のシグナル '${effect.signal}'（project.json の signals）`); break;
        case "setPlayer": if (effect.sprite && assetById.get(effect.sprite)?.kind !== "character") err(file, here, `キャラクター素材 '${effect.sprite}' がassets.jsonにありません`); break;
        default: break;
      }
    });
  };
  const checkRules = (file: string, at: string, rules: Rule[]) => {
    rules.forEach(rule => {
      const here = at === "rules" ? `rules[${rule.id}]` : `${at}.rules[${rule.id}]`;
      const battleTrigger = BATTLE_TRIGGERS.includes(rule.on);
      const ctxOk = battleTrigger || rule.on === "victory" || rule.on === "defeat";
      checkCondition(file, `${here}.when`, rule.when, ctxOk);
      checkExpr(file, `${here}.chance`, rule.chance, ctxOk);
      checkEffects(file, `${here}.effects`, rule.effects, ctxOk);
      if (rule.modify?.damage !== undefined && rule.on !== "dealDamage" && rule.on !== "takeDamage") warn(file, here, "modify.damage は on が dealDamage / takeDamage のときだけ使われます");
      if (rule.modify?.hp !== undefined && rule.on !== "lethalDamage") warn(file, here, "modify.hp は on が lethalDamage のときだけ使われます");
      checkExpr(file, `${here}.modify`, rule.modify?.damage, true);
      checkExpr(file, `${here}.modify`, rule.modify?.hp, true);
      if (rule.once === "battle" && !battleTrigger) warn(file, here, `once:"battle" は戦闘中のトリガー以外では効きません（on=${rule.on}）`);
      if (rule.repeat && rule.on !== "auto") warn(file, here, "repeat は on が auto のときだけ使われます");
      if (rule.on === "auto" && !rule.when) warn(file, here, "条件(when)のないautoルールは開始直後に1回だけ発動します");
      if (rule.on === "signal" && !rule.match) err(file, here, "on が signal のルールには match（シグナルID）が必要です");
      if (rule.on === "signal" && rule.match && !signalIds.has(rule.match)) err(file, here, `未宣言のシグナル '${rule.match}'（project.json の signals）`);
      if (rule.on === "verb" && rule.match && !verbIds.has(rule.match)) err(file, here, `未定義の動詞 '${rule.match}'（project.json の verbs）`);
      if (rule.match && rule.on !== "verb" && rule.on !== "signal") warn(file, here, `match は on が verb / signal のときだけ使われます（on=${rule.on}）`);
    });
  };
  const checkStatMods = (file: string, at: string, mods: StatMods | undefined) => {
    if (!mods) return;
    for (const value of Object.values(mods)) checkExpr(file, `${at}.statMods`, value);
  };
  const checkUse = (file: string, at: string, use: Use | undefined) => {
    if (!use) return;
    checkCondition(file, `${at}.use.when`, use.when);
    use.cost.forEach((cost, i) => { if (!varIds.has(cost.var)) err(file, `${at}.use.cost[${i}]`, `未宣言の変数 '${cost.var}'`); checkExpr(file, `${at}.use.cost[${i}]`, cost.amount); });
    checkExpr(file, `${at}.use.hpCost`, use.hpCost);
    checkEffects(file, `${at}.use.effects`, use.effects, use.where !== "field");
  };

  // Manifest.
  checkPosition(P, "start", project.start.mapId, project.start.x, project.start.y, "開始位置");
  if (project.player.sprite && assetById.get(project.player.sprite)?.kind !== "character") err(P, "player.sprite", `キャラクター素材 '${project.player.sprite}' がassets.jsonにありません`);
  project.player.abilities.forEach((id, i) => { if (!abilityIds.has(id)) err(P, `player.abilities[${i}]`, `未定義の能力 '${id}'`); });
  project.leveling?.learn.forEach((l, i) => { if (!abilityIds.has(l.ability)) err(P, `leveling.learn[${i}].ability`, `未定義の能力 '${l.ability}'`); });
  if (project.leveling?.learn.some(l => l.level > project.leveling!.maxLevel)) warn(P, "leveling.learn", "maxLevel より上のレベルで覚える能力があります");
  database.enemies.forEach(e => {
    for (const el of Object.keys(e.resist)) if (!elementIds.has(el)) err(DB, `enemies[${e.id}].resist.${el}`, `未定義の属性 '${el}'（project.json の elements）`);
    e.immune.forEach((id, i) => { if (!statusIds.has(id)) err(DB, `enemies[${e.id}].immune[${i}]`, `未定義の状態異常 '${id}'`); });
  });
  database.items.forEach(it => {
    if (it.element && !elementIds.has(it.element)) err(DB, `items[${it.id}].element`, `未定義の属性 '${it.element}'`);
    for (const el of Object.keys(it.resist ?? {})) if (!elementIds.has(el)) err(DB, `items[${it.id}].resist.${el}`, `未定義の属性 '${el}'`);
  });
  project.player.traits.forEach((id, i) => { if (!traitIds.has(id)) err(P, `player.traits[${i}]`, `未定義の特性 '${id}'`); });
  Object.keys(project.player.items).forEach(id => { if (!itemIds.has(id)) err(P, `player.items.${id}`, `未定義のアイテム '${id}'`); });
  for (const [id, decl] of Object.entries(project.variables)) {
    if (decl.min !== undefined && decl.max !== undefined && decl.min > decl.max) err(P, `variables.${id}`, "min が max より大きいです");
    if ((decl.min !== undefined && decl.initial < decl.min) || (decl.max !== undefined && decl.initial > decl.max)) err(P, `variables.${id}`, "initial が min〜max の範囲外です");
    if (flagIds.has(id)) warn(P, `variables.${id}`, "同じ名前のフラグがあります。紛らわしいので別名にしてください");
  }
  checkEffects(P, "intro", project.intro);
  for (const [id, a] of Object.entries(project.achievements)) if (a.when) checkCondition(P, `achievements.${id}.when`, a.when);
  const verbKeys = new Map<string, string>();
  for (const [id, verb] of Object.entries(project.verbs)) {
    checkCondition(P, `verbs.${id}.when`, verb.when);
    checkEffects(P, `verbs.${id}.effects`, verb.effects);
    if (verb.target?.from === "set" && !setIds.has(verb.target.set ?? "")) err(P, `verbs.${id}.target.set`, `未宣言の集合 '${verb.target.set ?? ""}'（target.from が set のときは set が必要）`);
    if (verb.target?.from === "list" && !verb.target.options.length) err(P, `verbs.${id}.target.options`, "target.from が list のときは options が必要です");
    if (verb.key) { const other = verbKeys.get(verb.key); if (other) err(P, `verbs.${id}.key`, `キー '${verb.key}' は動詞 '${other}' と重複しています`); verbKeys.set(verb.key, id); }
  }
  for (const [key, expr] of Object.entries({ playerDamage: project.battle.playerDamage, enemyDamage: project.battle.enemyDamage, fleeChance: project.battle.fleeChance })) checkExpr(P, `battle.${key}`, expr, true);
  for (const [id, decl] of Object.entries(project.sets)) {
    if (flagIds.has(id) || varIds.has(id)) warn(P, `sets.${id}`, "同じ名前のフラグ・変数があります。紛らわしいので別名にしてください");
    if (id === "endings") warn(P, `sets.${id}`, "endings は組み込みの集合（到達したエンディング）です");
    void decl;
  }
  if (project.rulesPath) checkRules(project.rulesPath, "rules", content.rules.length ? content.rules : []);

  // Audio.
  checkAudio(P, "audio.battle", project.audio.battle, MUSIC, "戦闘BGM");
  checkAudio(P, "audio.victory", project.audio.victory, SOUND, "勝利の音");
  for (const [cue, id] of Object.entries(project.audio.sfx)) checkAudio(P, `audio.sfx.${cue}`, id, SOUND, "効果音");
  for (const map of Object.values(maps)) {
    checkAudio(mapFile(map.id), "bgm", map.bgm, MUSIC, "BGM");
    checkAudio(mapFile(map.id), "ambient", map.ambient, ["bgm", "sfx"], "環境音");
    checkAudio(mapFile(map.id), "battleBackground", map.battleBackground, ["background"], "戦闘背景");
  }
  for (const enemy of database.enemies) checkAudio(DB, `enemies[${enemy.id}].background`, enemy.background, ["background"], "戦闘背景");
  for (const enemy of database.enemies) checkAudio(DB, `enemies[${enemy.id}].bgm`, enemy.bgm, MUSIC, "戦闘BGM");

  // Asset provenance and the project's source policy.
  const sources = sourcesFor(project);
  for (const asset of assets.assets) {
    const at = `assets[${asset.id}]`;
    if (asset.sourceId) {
      const source = sources.find(s => s.id === asset.sourceId);
      if (!source) { err(A, `${at}.sourceId`, `取得元 '${asset.sourceId}' がカタログにもassetPolicy.customSourcesにもありません`); continue; }
      if (!isSourceEnabled(project, source)) err(A, `${at}.sourceId`, `取得元「${source.name}」はこのプロジェクトで無効です（project.json の assetPolicy.sources で有効にするか、素材を差し替えてください）`);
      if (!source.categories.includes(assetCategory(asset.kind))) warn(A, at, `取得元「${source.name}」は ${source.categories.join("/")} 用です（この素材は ${asset.kind}）`);
      if (source.creditRequired === "yes" && !asset.creditRequired) warn(A, at, `取得元「${source.name}」はクレジット表記が必要とされています。creditRequired と credit を確認してください`);
      if (project.assetPolicy.shareable && source.redistribution === "prohibited") err(A, at, `共有用プロジェクト(assetPolicy.shareable)に、再配布が禁止されている取得元「${source.name}」の素材は入れられません`);
    }
    if (project.assetPolicy.shareable && !asset.redistributable) err(A, at, "共有用プロジェクト(assetPolicy.shareable)に再配布できない素材(redistributable: false)は入れられません");
  }

  // Tileset (each tile may use its own sheet).
  const atlas = assetById.get(tileset.atlas);
  if (!atlas || atlas.kind !== "tileset") err(project.tilesetPath, "atlas", `タイルシート素材 '${tileset.atlas}' がassets.jsonにありません`);
  tileset.tiles.forEach((tile, index) => {
    const sheet = tile.atlas ? assetById.get(tile.atlas) : atlas;
    if (tile.atlas && sheet?.kind !== "tileset") { err(project.tilesetPath, `tiles[${index}].atlas`, `タイルシート素材 '${tile.atlas}' がassets.jsonにありません`); return; }
    const capacity = (sheet?.columns ?? 0) * (sheet?.rows ?? 0);
    for (const field of ["index", "openIndex"] as const) {
      const value = tile[field];
      if (sheet && value !== undefined && value >= capacity) err(project.tilesetPath, `tiles[${index}].${field}`, `アトラスの範囲外です (${value} >= ${capacity})`);
    }
    const extra: Array<[string, number]> = [...(tile.frames ?? []).map((v, i) => [`frames[${i}]`, v] as [string, number]), ...Object.entries(tile.autotile?.pieces ?? {}).map(([k, v]) => [`autotile.pieces.${k}`, v] as [string, number])];
    for (const [at, value] of extra) if (sheet && value >= capacity) err(project.tilesetPath, `tiles[${index}].${at}`, `アトラスの範囲外です (${value} >= ${capacity})`);
    checkCondition(project.tilesetPath, `tiles[${index}].passableWhen`, tile.passableWhen);
    if (tile.inspect) {
      checkCondition(project.tilesetPath, `tiles[${index}].inspect.when`, tile.inspect.when);
      checkEffects(project.tilesetPath, `tiles[${index}].inspect.effects`, tile.inspect.effects);
      checkEffects(project.tilesetPath, `tiles[${index}].inspect.otherwise`, tile.inspect.otherwise);
    }
  });

  // Maps.
  for (const map of Object.values(maps)) {
    const file = mapFile(map.id);
    map.rows.forEach((row, y) => Array.from(row).forEach((code, x) => {
      if (!tileByCode.has(code)) err(file, `rows[${y}]`, `タイルセットにないコード '${code}' (x=${x}, y=${y})`);
    }));
    const layerIds = new Set<string>();
    map.layers.forEach((layer, i) => {
      if (layerIds.has(layer.id)) err(file, `layers[${i}].id`, `レイヤーIDが重複しています: ${layer.id}`);
      layerIds.add(layer.id);
      if (layer.rows.length !== map.height) err(file, `layers[${i}].rows`, `レイヤー '${layer.id}' の行数 ${layer.rows.length} がマップの高さ ${map.height} と違います`);
      layer.rows.forEach((row, y) => {
        const cells = Array.from(row);
        if (cells.length !== map.width) err(file, `layers[${i}].rows[${y}]`, `レイヤー '${layer.id}' の幅 ${cells.length} がマップの幅 ${map.width} と違います`);
        cells.forEach((code, x) => { if (code !== " " && !tileByCode.has(code)) err(file, `layers[${i}].rows[${y}]`, `タイルセットにないコード '${code}' (x=${x}, y=${y})`); });
      });
    });
    map.overlays.forEach((overlay, i) => {
      checkCondition(file, `overlays[${i}].when`, overlay.when);
      overlay.cells.forEach((cell, j) => {
        if (!tileByCode.has(cell.code)) err(file, `overlays[${i}].cells[${j}]`, `タイルセットにないコード '${cell.code}'`);
        if (cell.x + cell.w > map.width || cell.y + cell.h > map.height) err(file, `overlays[${i}].cells[${j}]`, "マップ範囲外です");
      });
    });
    const occupied = new Map<string, string>();
    const occupy = (id: string, x: number, y: number, at: string) => {
      const key = `${x},${y}`;
      const other = occupied.get(key);
      if (other) warn(file, at, `${id}と${other}が同じ座標(${x}, ${y})にあります`);
      occupied.set(key, id);
    };
    map.npcs.forEach(npc => {
      const at = `npcs[${npc.id}]`;
      occupy(npc.id, npc.x, npc.y, at);
      if (npc.sprite && assetById.get(npc.sprite)?.kind !== "character") err(file, `${at}.sprite`, `キャラクター素材 '${npc.sprite}' がassets.jsonにありません`);
      npc.dialogues.forEach((entry, j) => {
        if (!dialogues[entry.dialogue]) err(file, `${at}.dialogues[${j}]`, `未定義の会話 '${entry.dialogue}'`);
        checkCondition(file, `${at}.dialogues[${j}].when`, entry.when);
      });
      if (npc.dialogues[npc.dialogues.length - 1]?.when) warn(file, `${at}.dialogues`, "最後の会話に条件があります。どれにも一致しないとき話しかけても反応しません");
      checkCondition(file, `${at}.visibleWhen`, npc.visibleWhen);
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
    map.entities.forEach(entity => {
      const at = `entities[${entity.id}]`;
      occupy(entity.id, entity.x, entity.y, at);
      entity.states.forEach((st, i) => {
        const here = `${at}.states[${i}]`;
        checkCondition(file, `${here}.when`, st.when);
        if (st.sprite && assetById.get(st.sprite)?.kind !== "character") err(file, `${here}.sprite`, `キャラクター素材 '${st.sprite}' がassets.jsonにありません`);
        if (st.dialogue && !dialogues[st.dialogue]) err(file, `${here}.dialogue`, `未定義の会話 '${st.dialogue}'`);
        if (st.event && !events[st.event]) err(file, `${here}.event`, `未定義のイベント '${st.event}'`);
        checkEffects(file, `${here}.effects`, st.effects);
        if (st.onMoved) checkEffects(file, `${here}.onMoved`, st.onMoved);
        if (st.trigger !== "none" && !st.dialogue && !st.event && !st.effects.length && !st.pushable && !st.carryable) warn(file, here, `trigger=${st.trigger} ですが、会話・イベント・効果がありません`);
        if (st.behavior.type === "patrol") st.behavior.path.forEach((pt, j) => { if (pt.x >= map.width || pt.y >= map.height) err(file, `${here}.behavior.path[${j}]`, "マップ範囲外です"); });
        if (!st.sprite && st.marker === "none" && st.trigger !== "auto" && st.trigger !== "none") warn(file, here, "見た目(sprite / marker)がないので、プレイヤーから見えません");
      });
      if (entity.states[entity.states.length - 1]?.when) void 0; // last state may be conditional: entity then disappears — intended.
    });
    map.regions.forEach(region => {
      const at = `regions[${region.id}]`;
      checkCondition(file, `${at}.when`, region.when);
      for (const key of ["onEnter", "onLeave", "onStep", "inspect"] as const) checkEffects(file, `${at}.${key}`, region[key]);
    });
    if (map.encounters) {
      map.encounters.enemies.forEach((id, i) => { if (!enemyIds.has(id)) err(file, `encounters.enemies[${i}]`, `未定義の敵 '${id}'`); });
      map.encounters.tiles.forEach((code, i) => { if (!tileByCode.has(code)) err(file, `encounters.tiles[${i}]`, `タイルセットにないコード '${code}'`); });
    }
  }

  // Dialogues & events.
  for (const dialogue of Object.values(dialogues)) {
    if (dialogue.portrait && !["portrait", "character"].includes(assetById.get(dialogue.portrait)?.kind ?? "")) err(project.dialoguesPath, `dialogues[${dialogue.id}].portrait`, `顔グラフィックの素材 '${dialogue.portrait}' がありません（portrait か character）`);
    const at = `dialogues[${dialogue.id}]`;
    dialogue.lines.forEach((line, i) => {
      if (typeof line === "string") checkText(project.dialoguesPath, `${at}.lines[${i}]`, line);
      else { checkText(project.dialoguesPath, `${at}.lines[${i}]`, line.text); checkCondition(project.dialoguesPath, `${at}.lines[${i}].when`, line.when); }
    });
    checkEffects(project.dialoguesPath, `${at}.effects`, dialogue.effects);
    dialogue.choices.forEach(choice => {
      checkCondition(project.dialoguesPath, `${at}.choices[${choice.id}].when`, choice.when);
      checkText(project.dialoguesPath, `${at}.choices[${choice.id}]`, choice.label);
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
  database.abilities.forEach(a => checkScript(DB, `abilities[${a.id}]`, a.script));
  database.traits.forEach(a => checkScript(DB, `traits[${a.id}]`, a.script));
  database.items.forEach(a => checkScript(DB, `items[${a.id}]`, a.script));
  database.enemies.forEach(a => checkScript(DB, `enemies[${a.id}]`, a.script));
  database.companions.forEach(a => checkScript(DB, `companions[${a.id}]`, a.script));
  for (const [id, map] of Object.entries(maps)) {
    checkScript(mapFiles[id] ?? id, "", map.script);
    map.entities.forEach(e => e.states.forEach((st, i) => checkScript(mapFiles[id] ?? id, `entities[${e.id}].states[${i}]`, st.script)));
    map.npcs.forEach(n => checkScript(mapFiles[id] ?? id, `npcs[${n.id}]`, n.script));
    map.interactables.forEach(n => checkScript(mapFiles[id] ?? id, `interactables[${n.id}]`, n.script));
    map.regions.forEach(n => checkScript(mapFiles[id] ?? id, `regions[${n.id}]`, n.script));
  }
  database.abilities.forEach(a => { const at = `abilities[${a.id}]`; checkStatMods(DB, at, a.statMods); checkRules(DB, at, a.rules); checkUse(DB, at, a.use); });
  database.traits.forEach(t => {
    const at = `traits[${t.id}]`;
    t.abilities.forEach((id, i) => { if (!abilityIds.has(id)) err(DB, `${at}.abilities[${i}]`, `未定義の能力 '${id}'`); });
    checkStatMods(DB, at, t.statMods); checkRules(DB, at, t.rules); checkEffects(DB, `${at}.onGrant`, t.onGrant);
  });
  database.companions.forEach(comp => comp.actions.forEach((a, i) => checkCondition(DB, `companions[${comp.id}].actions[${i}].when`, a.when)));
  database.companions.forEach(comp => { if (comp.sprite && assetById.get(comp.sprite)?.kind !== "character") err(DB, `companions[${comp.id}].sprite`, `キャラクター素材 '${comp.sprite}' がありません`); });
  database.items.forEach(i => { const at = `items[${i.id}]`; checkStatMods(DB, at, i.statMods); checkRules(DB, at, i.rules); checkUse(DB, at, i.use); if (i.slot && !project.equipmentSlots[i.slot]) err(DB, `${at}.slot`, `未定義の装備枠 '${i.slot}'（project.json の equipmentSlots）`); });
  database.enemies.forEach(enemy => {
    const at = `enemies[${enemy.id}]`;
    if (enemy.battle) for (const list of nestedEffectLists(enemy.battle.args)) checkEffects(DB, `${at}.battle.args`, list);
    if (enemy.battle && enemy.battle.mode !== "builtin" && !systemIds.has(enemy.battle.mode.slice(0, enemy.battle.mode.lastIndexOf(".")))) err(DB, `${at}.battle.mode`, `戦闘モード '${enemy.battle.mode}' のモジュール・システムがありません（project.json の modules を確認）`);
    if (enemy.sprite && assetById.get(enemy.sprite)?.kind !== "enemy" && assetById.get(enemy.sprite)?.kind !== "character") err(DB, `${at}.sprite`, `素材 '${enemy.sprite}' がassets.jsonにありません`);
    enemy.drops.forEach((drop, i) => { if (!itemIds.has(drop.item)) err(DB, `${at}.drops[${i}]`, `未定義のアイテム '${drop.item}'`); });
    enemy.actions.forEach((action, i) => { checkCondition(DB, `${at}.actions[${i}].when`, action.when, true); checkEffects(DB, `${at}.actions[${i}].effects`, action.effects, true); if (action.message) checkText(DB, `${at}.actions[${i}]`, action.message); });
    if (enemy.actions.every(a => a.when)) warn(DB, `${at}.actions`, "すべての行動に条件があります。どれも満たさないターンは何もしません");
    checkRules(DB, at, enemy.rules);
    enemy.rules.forEach(rule => { if (!BATTLE_TRIGGERS.includes(rule.on) && rule.on !== "victory" && rule.on !== "defeat") warn(DB, `${at}.rules[${rule.id}]`, `敵のルールは戦闘中だけ有効です（on=${rule.on} は発動しません）`); });
  });

  // Unreferenced content is not an error, but usually a mistake when an agent adds data.
  const usedEvents = new Set<string>();
  const usedDialogues = new Set<string>();
  for (const map of Object.values(maps)) {
    map.interactables.forEach(i => usedEvents.add(i.event));
    map.npcs.forEach(n => n.dialogues.forEach(d => usedDialogues.add(d.dialogue)));
    map.entities.forEach(e => e.states.forEach(st => { if (st.dialogue) usedDialogues.add(st.dialogue); if (st.event) usedEvents.add(st.event); }));
  }
  forEachEffectList(content, effects => walkEffects(effects, e => {
    if (e.type === "dialogue") usedDialogues.add(e.dialogue);
    if (e.type === "event") usedEvents.add(e.event);
  }));
  for (const id of Object.keys(events)) if (!usedEvents.has(id)) warn(project.eventsPath, `events[${id}]`, "どのマップ・効果からも参照されていないイベントです");
  for (const id of Object.keys(dialogues)) if (!usedDialogues.has(id)) warn(project.dialoguesPath, `dialogues[${id}]`, "どのNPC・効果からも参照されていない会話です");
  return out;
}

/** Calls `visit` with every list of effects anywhere in the project. */
export function forEachEffectList(content: GameContent, visit: (effects: Effect[]) => void): void {
  const rules = (list: Rule[]) => list.forEach(r => visit(r.effects));
  visit(content.project.intro);
  for (const verb of Object.values(content.project.verbs)) visit(verb.effects);
  rules(content.rules);
  for (const event of Object.values(content.events)) { visit(event.effects); visit(event.otherwise); visit(event.afterDone); }
  for (const dialogue of Object.values(content.dialogues)) { visit(dialogue.effects); dialogue.choices.forEach(c => visit(c.effects)); }
  for (const a of content.database.abilities) { rules(a.rules); if (a.use) visit(a.use.effects); }
  for (const t of content.database.traits) { rules(t.rules); visit(t.onGrant); }
  for (const i of content.database.items) { rules(i.rules); if (i.use) visit(i.use.effects); }
  for (const e of content.database.enemies) { rules(e.rules); e.actions.forEach(a => visit(a.effects)); if (e.battle) nestedEffectLists(e.battle.args).forEach(visit); }
  for (const t of content.tileset.tiles) if (t.inspect) { visit(t.inspect.effects); visit(t.inspect.otherwise); }
  for (const m of Object.values(content.maps)) {
    m.entities.forEach(e => e.states.forEach(st => { visit(st.effects); if (st.onMoved) visit(st.onMoved); }));
    m.regions.forEach(r => { visit(r.onEnter); visit(r.onLeave); visit(r.onStep); visit(r.inspect); });
  }
}

/** Effect lists hidden inside module arguments (any array of objects with a string "type"). */
export function nestedEffectLists(value: unknown, out: Effect[][] = []): Effect[][] {
  if (Array.isArray(value)) {
    if (value.length && value.every(v => v && typeof v === "object" && typeof (v as { type?: unknown }).type === "string")) out.push(value as Effect[]);
    else value.forEach(v => nestedEffectLists(v, out));
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) nestedEffectLists(child, out);
  }
  return out;
}

/** Conditions hidden inside module arguments (values of "when" keys). */
export function nestedConditions(value: unknown, out: Condition[] = []): Condition[] {
  if (Array.isArray(value)) value.forEach(v => nestedConditions(v, out));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "when" && child && typeof child === "object") out.push(child as Condition);
      else nestedConditions(child, out);
    }
  }
  return out;
}

export function walkExpr(expr: Expr, visit: (expr: Expr) => void, onCondition?: (condition: Condition) => void): void {
  visit(expr);
  if (typeof expr === "number") return;
  const children: Expr[] =
    "add" in expr ? expr.add : "mul" in expr ? expr.mul : "min" in expr ? expr.min : "max" in expr ? expr.max
    : "sub" in expr ? expr.sub : "div" in expr ? expr.div : "mod" in expr ? expr.mod : "percent" in expr ? expr.percent
    : "if" in expr ? [expr.then, expr.else] : [];
  if ("if" in expr) onCondition?.(expr.if);
  children.forEach(child => walkExpr(child, visit, onCondition));
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
    if (effect.type === "if" || effect.type === "chance") { walkEffects(effect.then, visit); if (effect.else) walkEffects(effect.else, visit); }
    if (effect.type === "input") { for (const a of effect.answers ?? []) walkEffects(a.effects, visit); if (effect.otherwise) walkEffects(effect.otherwise, visit); }
    if (effect.type === "choice") effect.options.forEach(option => walkEffects(option.effects, visit));
    if (effect.type === "schedule") walkEffects(effect.effects, visit);
    if (effect.type === "startScene" && effect.args) for (const list of nestedEffectLists(effect.args)) walkEffects(list, visit);
    if (effect.type === "battle" && effect.args) for (const list of nestedEffectLists(effect.args)) walkEffects(list, visit);
  }
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = [d.file, d.at].filter(Boolean).join(" › ");
  return `${d.severity === "error" ? "ERROR" : "WARN "} ${where ? `${where}: ` : ""}${d.message}`;
}

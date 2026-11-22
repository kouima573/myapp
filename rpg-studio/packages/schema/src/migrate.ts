/**
 * Deterministic, one-step format migrations. Pure functions: file texts in, file texts out.
 * Writing, backup and user confirmation are handled by the CLI (`rpg migrate`).
 */
import { PROJECT_FORMAT_VERSION, SAVE_FORMAT_VERSION } from "./constants";
import type { Condition, Effect, GameContent, GameSave, GameState } from "./formats";
import type { ProjectFileTexts } from "./validate";

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  /** Complete new file set (path → text). Files not listed are unchanged. */
  files: ProjectFileTexts;
  /** Files that exist only in the old format and should be removed. */
  removed: string[];
  /** Things a human / agent must still do by hand (e.g. TypeScript systems). */
  manualSteps: string[];
}

/* v1 engine behaviour that was hard-coded in TypeScript and now has to become data. */
const V1_TILE_CODES = [".", ":", "s", "~", "T", "*", "h", "r", "d", "f", "b", "w", "i", "g"] as const;
const V1_TILE_NAMES: Record<string, string> = {
  ".": "草地", ":": "土の道", s: "石畳", "~": "水辺", T: "樹冠", "*": "草花", h: "漆喰壁", r: "屋根", d: "木戸", f: "柵", b: "橋", w: "遺跡の石壁", i: "遺跡の床", g: "獣道の封印門",
};
const V1_TILE_COLORS: Record<string, string> = {
  ".": "#627a4c", ":": "#9b8054", s: "#8f927f", "~": "#4d7f91", T: "#294538", "*": "#718557", h: "#8b684b", r: "#934f3f", d: "#d3a15f", f: "#876a44", b: "#ad8756", w: "#555e5b", i: "#797b6c", g: "#83785d",
};
const V1_BLOCKED = new Set(["~", "T", "h", "r", "f", "w"]);
const V1_START = { x: 3, y: 9 };
const V1_PLAYER = { maxHp: 18, attack: 5, defense: 0 };
const V1_DEFAULT_ABILITIES = ["unyielding-soul"];
const V1_DEFAULT_FLAGS = ["beastPathUnlocked", "ruinsShortcutOpen"];
const V1_GATE_FLAG = "ruinsShortcutOpen";
const V1_ENEMY = { id: "v1-enemy", name: "敵", stats: { maxHp: 12, attack: 0, defense: 0 }, actions: [{ name: "攻撃", power: 22 }] };

type Json = Record<string, any>;

const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function readJson(texts: ProjectFileTexts, path: string): Json {
  const text = texts[path];
  if (text === undefined) throw new Error(`移行に必要なファイルがありません: ${path}`);
  return JSON.parse(text) as Json;
}

export function migrateProjectV1toV2(texts: ProjectFileTexts): MigrationResult {
  const project = readJson(texts, "project.json");
  if (project.formatVersion !== 1) throw new Error(`v1→v2移行の入力はformatVersion=1である必要があります (現在: ${String(project.formatVersion)})`);
  const manualSteps: string[] = [];
  const files: ProjectFileTexts = {};
  const removed: string[] = [];

  const dialogues = readJson(texts, project.dialoguesPath);
  const events = readJson(texts, project.eventsPath);
  const assets = readJson(texts, project.assetsPath);
  const maps = (project.maps as Json[]).map(ref => ({ ref, map: readJson(texts, ref.path) }));

  // Collect every flag / ability the v1 data refers to so they can be declared.
  const flags = new Set<string>(V1_DEFAULT_FLAGS);
  const abilities = new Set<string>(V1_DEFAULT_ABILITIES);
  for (const d of dialogues.dialogues ?? []) for (const c of d.choices ?? []) { if (c.setFlag) flags.add(c.setFlag); if (c.unlockAbilityId) abilities.add(c.unlockAbilityId); }
  for (const e of events.events ?? []) { if (e.setFlag) flags.add(e.setFlag); if (e.requiredAbilityId) abilities.add(e.requiredAbilityId); }
  for (const { map } of maps) for (const p of map.portals ?? []) if (p.requiresFlag) flags.add(p.requiresFlag);
  const usesBattle = (events.events ?? []).some((e: Json) => e.kind === "battle");

  const tilesetAsset = (assets.assets ?? []).find((a: Json) => a.kind === "tileset");
  const tilesetPath = "tiles.json";
  const databasePath = "database.json";
  files[tilesetPath] = pretty({
    formatVersion: PROJECT_FORMAT_VERSION,
    atlas: tilesetAsset?.id ?? "tiles",
    tiles: V1_TILE_CODES.map((code, index) => ({
      code,
      name: V1_TILE_NAMES[code],
      index,
      passable: !V1_BLOCKED.has(code) && code !== "g",
      ...(code === "g" ? { passableWhen: { flag: V1_GATE_FLAG } } : {}),
      color: V1_TILE_COLORS[code],
    })),
  });
  files[databasePath] = pretty({
    formatVersion: PROJECT_FORMAT_VERSION,
    abilities: [...abilities].sort().map(id => ({ id, name: id, description: "v1から移行。名前と説明を設定してください。", kind: "passive" })),
    items: [],
    enemies: usesBattle ? [{ ...V1_ENEMY, drops: [], canFlee: true }] : [],
  });
  manualSteps.push(`${databasePath}: 能力の表示名・説明・kindを設定してください（v1には定義がありません）。`);

  const migratedProject: Json = {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: project.id,
    title: project.title,
    engineCompatibility: { min: "0.2.0" },
    start: { mapId: project.startMapId, x: V1_START.x, y: V1_START.y, facing: "down" },
    player: { name: "主人公", sprite: (assets.assets ?? []).some((a: Json) => a.id === "adventurer") ? "adventurer" : undefined, stats: V1_PLAYER, abilities: V1_DEFAULT_ABILITIES, items: {} },
    flags: Object.fromEntries([...flags].sort().map(flag => [flag, { initial: false }])),
    maps: project.maps,
    tilesetPath,
    dialoguesPath: project.dialoguesPath,
    eventsPath: project.eventsPath,
    databasePath,
    assetsPath: project.assetsPath,
    systems: project.systems ?? [],
  };
  if (!migratedProject.player.sprite) delete migratedProject.player.sprite;
  files["project.json"] = pretty(migratedProject);
  if ((project.systems ?? []).length) {
    manualSteps.push("systems/*.ts: v1の固有フック(unlockBeastTrail等)は廃止されました。`defineSystem`のフック(onLethalDamage等)へ書き換えてください。docs/extension-api.md参照。");
  }

  for (const { ref, map } of maps) {
    files[ref.path] = pretty({
      formatVersion: PROJECT_FORMAT_VERSION,
      id: map.id,
      title: map.title,
      width: map.width,
      height: map.height,
      rows: map.rows,
      npcs: (map.npcs ?? []).map((npc: Json) => ({
        id: npc.id, name: npc.name, x: npc.x, y: npc.y, facing: "down",
        ...(npc.sprite ? { sprite: npc.sprite } : {}),
        dialogues: [{ dialogue: npc.dialogueId }],
      })),
      portals: (map.portals ?? []).map((portal: Json) => ({
        id: portal.id, x: portal.x, y: portal.y, targetMapId: portal.targetMapId, targetX: portal.targetX, targetY: portal.targetY,
        ...(portal.requiresFlag ? { when: { flag: portal.requiresFlag } } : {}),
      })),
      interactables: (map.interactables ?? []).map((item: Json) => ({
        id: item.id, x: item.x, y: item.y, label: item.label, event: item.eventId, trigger: "action", solid: false, marker: "sparkle",
      })),
    });
  }

  files[project.dialoguesPath] = pretty({
    formatVersion: PROJECT_FORMAT_VERSION,
    dialogues: (dialogues.dialogues ?? []).map((d: Json) => ({
      id: d.id,
      speaker: d.speaker,
      lines: d.lines,
      effects: [],
      choices: (d.choices ?? []).map((c: Json) => {
        const effects: Effect[] = [];
        if (c.unlockAbilityId) effects.push({ type: "unlockAbility", ability: c.unlockAbilityId });
        if (c.setFlag) effects.push({ type: "setFlag", flag: c.setFlag });
        return { id: c.id, label: c.label, effects, once: Boolean(d.once) && effects.length > 0 };
      }),
    })),
  });

  files[project.eventsPath] = pretty({
    formatVersion: PROJECT_FORMAT_VERSION,
    events: (events.events ?? []).map((e: Json) => {
      const effects: Effect[] = [];
      if (e.kind === "battle") effects.push({ type: "battle", enemy: V1_ENEMY.id });
      if (e.setFlag) effects.push({ type: "setFlag", flag: e.setFlag });
      effects.push({ type: "message", text: `${e.label}。` });
      const when: Condition | undefined = e.requiredAbilityId ? { ability: e.requiredAbilityId } : undefined;
      return {
        id: e.id,
        label: e.label,
        ...(when ? { when } : {}),
        effects,
        otherwise: e.requiredAbilityId ? [{ type: "message", text: `能力「${e.requiredAbilityId}」が必要です。` }] : [],
        once: e.once !== false,
        afterDone: [],
      };
    }),
  });

  return { fromVersion: 1, toVersion: PROJECT_FORMAT_VERSION, files, removed, manualSteps };
}

/** Migrates a v1 player save. Needs the (already v2) content for stats and once-choice keys. */
export function migrateSaveV1toV2(raw: unknown, content: GameContent): GameSave {
  const save = raw as Json;
  if (save?.formatVersion !== 1) throw new Error("v1セーブではありません");
  const state = save.state as Json;
  const done = new Set<string>();
  for (const id of state.completedEvents ?? []) {
    const dialogue = content.dialogues[id];
    if (dialogue) {
      // v1 stored the dialogue id; v2 records which once-choice was taken.
      const rewarded = dialogue.choices.filter(choice => choice.once);
      if (rewarded.length === 1) done.add(`${dialogue.id}/${rewarded[0]!.id}`);
    } else {
      done.add(id);
    }
  }
  const stats = { ...content.project.player.stats, maxHp: Number(state.player?.maxHp) || content.project.player.stats.maxHp };
  const migrated: GameState = {
    mapId: state.mapId,
    player: { x: state.player.x, y: state.player.y, facing: "down", hp: Math.min(stats.maxHp, Math.max(1, Number(state.player.hp) || 1)), stats },
    abilities: [...new Set<string>(state.abilities ?? [])],
    traits: [],
    items: {},
    vars: Object.fromEntries(Object.entries(content.project.variables).map(([id, decl]) => [id, decl.initial])),
    tileOverrides: {},
    fired: [],
    sets: {},
    entities: {},
    timers: [],
    cycle: 1,
    ticks: 0,
    regions: [],
    flags: { ...Object.fromEntries(Object.entries(content.project.flags).map(([id, decl]) => [id, decl.initial])), ...(state.flags ?? {}) },
    done: [...done].sort(),
    scene: { kind: "field" },
    queue: [],
    systemData: {},
    rng: 1,
    steps: 0,
  };
  return { formatVersion: SAVE_FORMAT_VERSION, projectId: save.projectId, savedAt: save.savedAt, state: migrated };
}

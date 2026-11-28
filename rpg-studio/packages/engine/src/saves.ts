import { SAVE_FORMAT_VERSION } from "../../schema/src/constants";
import type { GameContent, GameSave, GameState } from "../../schema/src/formats";
import { migrateSaveV1toV2 } from "../../schema/src/migrate";

/** notes: what was adjusted so an older save works with the current (updated) game. */
export type SaveReadResult = { ok: true; save: GameSave; migrated: boolean; notes: string[] } | { ok: false; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

function validateSaveShape(raw: unknown): string | null {
  if (!isRecord(raw)) return "セーブデータが壊れています";
  if (raw.formatVersion !== SAVE_FORMAT_VERSION) return "formatVersionが不正です";
  if (typeof raw.projectId !== "string" || !raw.projectId) return "projectIdが不正です";
  if (typeof raw.savedAt !== "string" || Number.isNaN(Date.parse(raw.savedAt))) return "savedAtが不正です";
  const st = raw.state;
  if (!isRecord(st)) return "stateがありません";
  if (typeof st.mapId !== "string" || !st.mapId) return "mapIdが不正です";
  if (!isRecord(st.player)) return "playerがありません";
  if (!isInt(st.player.x) || st.player.x < 0 || !isInt(st.player.y) || st.player.y < 0) return "player座標が不正です";
  if (!isInt(st.player.hp) || st.player.hp < 0) return "player.hpが不正です";
  if (!isRecord(st.player.stats) || !isInt(st.player.stats.maxHp) || st.player.stats.maxHp < 1) return "player.statsが不正です";
  if (!isRecord(st.flags) || !isRecord(st.items)) return "flags/itemsが不正です";
  if (!Array.isArray(st.abilities) || !Array.isArray(st.done)) return "abilities/doneが不正です";
  if (!isRecord(st.scene) || typeof st.scene.kind !== "string") return "sceneが不正です";
  return null;
}

export function makeSave(content: GameContent, state: GameState, savedAt = new Date()): GameSave {
  if (state.scene.kind !== "field" || state.queue.length) throw new Error("会話・戦闘・イベントの途中ではセーブできません");
  return { formatVersion: SAVE_FORMAT_VERSION, projectId: content.project.id, savedAt: savedAt.toISOString(), ...(content.project.version ? { gameVersion: content.project.version } : {}), state };
}

/**
 * Validates a stored save against the current project. Never throws and never rewrites the stored data;
 * callers decide whether to start a new game.
 */
export function readSave(raw: unknown, content: GameContent): SaveReadResult {
  try {
    const record = raw as { formatVersion?: unknown; projectId?: unknown };
    if (!record || typeof record !== "object") return { ok: false, reason: "セーブデータが壊れています" };
    if (record.projectId !== content.project.id) return { ok: false, reason: `別のプロジェクト(${String(record.projectId)})のセーブです` };
    let migrated = false;
    let candidate: unknown = raw;
    if (record.formatVersion === 1) { candidate = migrateSaveV1toV2(raw, content); migrated = true; }
    else if (record.formatVersion !== SAVE_FORMAT_VERSION) return { ok: false, reason: `未対応のセーブ形式です (formatVersion=${String(record.formatVersion)})` };
    const shapeError = validateSaveShape(candidate);
    if (shapeError) return { ok: false, reason: `セーブデータが壊れています: ${shapeError}` };
    const parsed = candidate as GameSave;
    const state = parsed.state;
    const map = content.maps[state.mapId];
    if (!map) return { ok: false, reason: `セーブ地点のマップ '${state.mapId}' が現在のプロジェクトにありません` };
    if (state.player.x >= map.width || state.player.y >= map.height) return { ok: false, reason: "セーブ地点がマップ範囲外です（マップが縮小された可能性があります）" };
    const { state: adjusted, notes } = adjustForUpdate(state, content);
    return { ok: true, save: { ...parsed, state: adjusted }, migrated, notes };
  } catch (error) {
    return { ok: false, reason: `セーブを読めません: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * セーブ互換（ゲームを更新したあとに古いセーブを読む）: 新しく宣言したフラグ・変数・集合は初期値を足し、
 * 消した・名前を変えたアイテム・技・特性・仲間・依頼・スキルの記録は外す（ゲームが止まらないように）。
 * 何をしたかは notes に残す。セーブの元データは書き換えない。
 */
export function adjustForUpdate(state: GameState, content: GameContent): { state: GameState; notes: string[] } {
  const notes: string[] = [];
  const db = content.database;
  const has = (list: Array<{ id: string }>) => { const ids = new Set(list.map(x => x.id)); return (id: string) => ids.has(id); };
  const item = has(db.items), ability = has(db.abilities), trait = has(db.traits), companion = has(db.companions ?? []);
  const dropped = (what: string, ids: string[]) => { if (ids.length) notes.push(`${what}（${ids.join(", ")}）は今の版にないため外しました`); };
  const flags = { ...Object.fromEntries(Object.entries(content.project.flags).map(([id, decl]) => [id, decl.initial])), ...state.flags };
  const vars = { ...Object.fromEntries(Object.entries(content.project.variables).map(([id, decl]) => [id, decl.initial])), ...state.vars };
  const sets = { ...Object.fromEntries(Object.keys(content.project.sets ?? {}).map(id => [id, [] as string[]])), ...state.sets };
  const items = Object.fromEntries(Object.entries(state.items).filter(([id]) => item(id)));
  dropped("アイテム", Object.keys(state.items).filter(id => !item(id)));
  const abilities = state.abilities.filter(ability);
  dropped("技・能力", state.abilities.filter(id => !ability(id)));
  const traits = (state.traits ?? []).filter(trait);
  dropped("特性", (state.traits ?? []).filter(id => !trait(id)));
  const equipment = state.equipment ? Object.fromEntries(Object.entries(state.equipment).filter(([, id]) => item(id))) : undefined;
  const party = state.party?.filter(m => companion(m.id)).map(m => (m.equipment ? { ...m, equipment: Object.fromEntries(Object.entries(m.equipment).filter(([, id]) => item(id))) } : m));
  dropped("仲間", (state.party ?? []).filter(m => !companion(m.id)).map(m => m.id));
  const quests = state.quests ? Object.fromEntries(Object.entries(state.quests).filter(([id]) => content.project.quests?.[id])) : undefined;
  if (state.quests) dropped("依頼", Object.keys(state.quests).filter(id => !content.project.quests?.[id]));
  const boards = new Map((db.skillBoards ?? []).map(b => [b.id, new Set(b.nodes.map(n => n.id))] as const));
  const skills = state.skills ? { ...state.skills, learned: state.skills.learned.filter(k => { const [b, n] = k.split("/"); return Boolean(b && n && boards.get(b)?.has(n)); }) } : undefined;
  if (state.skills) dropped("スキルボードのパネル", state.skills.learned.filter(k => !skills!.learned.includes(k)));
  const map = content.maps[state.mapId];
  const row = map?.rows[state.player.y];
  const code = row ? Array.from(row)[state.player.x] : undefined;
  const tile = content.tileset.tiles.find(t => t.code === code);
  if (tile && !tile.passable && !tile.passableWhen) notes.push(`セーブ地点（${state.mapId} ${state.player.x},${state.player.y}）が通れないタイルになっています。マップを直すか、そこから歩けるか確かめてください`);
  return {
    notes,
    state: {
      ...state, flags, vars, sets, items, abilities, traits,
      ...(state.equippedPassives ? { equippedPassives: state.equippedPassives.filter(ability) } : {}),
      ...(equipment ? { equipment } : {}), ...(party ? { party } : {}), ...(quests ? { quests } : {}), ...(skills ? { skills } : {}),
    },
  };
}

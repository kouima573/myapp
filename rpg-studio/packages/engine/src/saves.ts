import { SAVE_FORMAT_VERSION } from "../../schema/src/constants";
import type { GameContent, GameSave, GameState } from "../../schema/src/formats";
import { migrateSaveV1toV2 } from "../../schema/src/migrate";

export type SaveReadResult = { ok: true; save: GameSave; migrated: boolean } | { ok: false; reason: string };

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
  return { formatVersion: SAVE_FORMAT_VERSION, projectId: content.project.id, savedAt: savedAt.toISOString(), state };
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
    // Flags declared after the save was made get their initial value.
    const flags = { ...Object.fromEntries(Object.entries(content.project.flags).map(([id, decl]) => [id, decl.initial])), ...state.flags };
    return { ok: true, save: { ...parsed, state: { ...state, flags } }, migrated };
  } catch (error) {
    return { ok: false, reason: `セーブを読めません: ${error instanceof Error ? error.message : String(error)}` };
  }
}

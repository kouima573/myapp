import { GameSaveSchema, SAVE_FORMAT_VERSION, migrateSaveV1toV2, type GameContent, type GameSave, type GameState } from "../../schema/src/index";

export type SaveReadResult = { ok: true; save: GameSave; migrated: boolean } | { ok: false; reason: string };

export function makeSave(content: GameContent, state: GameState, savedAt = new Date()): GameSave {
  if (state.scene.kind !== "field" || state.queue.length) throw new Error("会話・戦闘・イベントの途中ではセーブできません");
  return GameSaveSchema.parse({ formatVersion: SAVE_FORMAT_VERSION, projectId: content.project.id, savedAt: savedAt.toISOString(), state });
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
    const parsed = GameSaveSchema.safeParse(candidate);
    if (!parsed.success) return { ok: false, reason: `セーブデータが壊れています: ${parsed.error.issues[0]?.message ?? "不明"}` };
    const state = parsed.data.state;
    const map = content.maps[state.mapId];
    if (!map) return { ok: false, reason: `セーブ地点のマップ '${state.mapId}' が現在のプロジェクトにありません` };
    if (state.player.x >= map.width || state.player.y >= map.height) return { ok: false, reason: "セーブ地点がマップ範囲外です（マップが縮小された可能性があります）" };
    // Flags declared after the save was made get their initial value.
    const flags = { ...Object.fromEntries(Object.entries(content.project.flags).map(([id, decl]) => [id, decl.initial])), ...state.flags };
    return { ok: true, save: { ...parsed.data, state: { ...state, flags } }, migrated };
  } catch (error) {
    return { ok: false, reason: `セーブを読めません: ${error instanceof Error ? error.message : String(error)}` };
  }
}

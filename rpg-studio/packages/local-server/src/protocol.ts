/** Wire types shared by the local server and the studio UI. */
export const LOCAL_TOKEN_HEADER = "x-rpg-studio-token";
export const LOCAL_TOKEN_META = "rpg-studio-token";

export interface ProjectSnapshot {
  projectDir: string;
  /** project-relative path → UTF-8 text (JSON data, TS/TSX sources, docs, scenario tests). */
  texts: Record<string, string>;
  /** project-relative path → SHA-256 hex of the bytes on disk. */
  hashes: Record<string, string>;
  /** Absolute path of the rpg-studio folder (local only), for "open in editor" links. */
  repoRoot?: string;
}

export interface SaveRequest { path: string; content: string; expectedHash: string }
export interface SaveResponse { path: string; hash: string }
/** PNG drawn in the studio (pixel editor). Only assets/<folder>/<name>.png; expectedHash "" creates, otherwise sha256 of the current bytes. */
export interface ImageSaveRequest { path: string; base64: string; expectedHash: string }
export interface ImageConflictResponse { error: "conflict"; path: string; latestHash: string }
export interface ConflictResponse { error: "conflict"; path: string; latestContent: string; latestHash: string }

export interface ChangeEvent { seq: number; path: string; kind: "add" | "change" | "unlink"; hash?: string; summary?: string[] }
export interface HistoryEntryView { id: string; file: string; at: string; source: "studio" | "outside" | "restore"; beforeHash: string; afterHash: string; summary: string[] }
export interface ChangesResponse { cursor: number; changes: ChangeEvent[]; build: BuildStatus }

export interface BuildStatus {
  state: "idle" | "building" | "ready" | "error";
  /** Version of the last successful build (kept while a newer build fails). */
  version: string | null;
  /** Problems of the latest attempt, formatted `ERROR file › at: message`. */
  diagnostics: string[];
  /** True when `version` is older than the current sources (latest build failed or is running). */
  stale: boolean;
  finishedAt: string | null;
}

export interface ScenarioReport { file: string; name: string; ok: boolean; failedStep?: number; message?: string; steps: number }
export interface TestResponse { ok: boolean; results: ScenarioReport[]; diagnostics: string[] }

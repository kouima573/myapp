/**
 * Where the studio reads and writes project files.
 *  - LocalSource: `pnpm studio` — the local server on 127.0.0.1 (real files, conflict detection, builds).
 *  - PreviewSource: `pnpm dev` / hosted preview — the bundled sample, edits stay in memory only.
 */
import type { AssetEntry } from "@rpg/schema";
import type { GameSystem } from "@rpg/engine";
import {
  LOCAL_TOKEN_HEADER, LOCAL_TOKEN_META,
  type BuildStatus, type ChangesResponse, type HistoryEntryView, type ConflictResponse, type ProjectSnapshot, type SaveResponse, type TestResponse,
} from "../../../packages/local-server/src/protocol";

export type SaveOutcome = { ok: true; hash: string } | { ok: false; conflict: ConflictResponse } | { ok: false; error: string };

export interface ProjectSource {
  kind: "local" | "preview";
  load(): Promise<ProjectSnapshot>;
  save(path: string, content: string, expectedHash: string): Promise<SaveOutcome>;
  assetUrl(asset: AssetEntry): Promise<string>;
  /** Long-running poll for external file changes and build status. */
  changes?(after: number): Promise<ChangesResponse>;
  requestBuild?(): Promise<BuildStatus>;
  loadSystems(version: string | null): Promise<GameSystem[]>;
  runTests?(): Promise<TestResponse>;
  /** PNG from the pixel editor (assets/<folder>/<name>.png). expectedHash "" = new file. */
  saveImage?(path: string, png: Blob, expectedHash: string): Promise<{ ok: true; hash: string; bytes: number } | { ok: false; error: string; conflict?: boolean }>;
  /** Import one user-selected image/audio/font and add its provenance record to assets.json. */
  importAsset?(file: Blob, entry: Record<string, unknown>): Promise<{ ok: true; asset: AssetEntry } | { ok: false; error: string }>;
  /** sha256 of an asset's current bytes (for saveImage). */
  assetHash?(path: string): Promise<string>;
  /** Shared generated asset library (library/library.json). */
  library?(): Promise<LibraryCatalogView>;
  libraryImageUrl?(path: string): Promise<string>;
  libraryAdd?(ids: string[]): Promise<boolean>;
  /** Save history (newest first) and restoring a file to how it was before / after one change. */
  history?(file?: string): Promise<HistoryEntryView[]>;
  historyText?(id: string, side: "before" | "after"): Promise<string | null>;
  restoreHistory?(id: string, side: "before" | "after"): Promise<{ ok: boolean; error?: string }>;
}

export interface LibraryTileView { key: string; name: string; index: number; passable: boolean; color: string; tags: string[] }
export interface LibraryItemView { id: string; kind: "tileset" | "character" | "enemy" | "background"; title: string; path: string; tags: string[]; tileWidth: number; tileHeight: number; columns: number; rows: number; tiles?: LibraryTileView[] }
export interface LibraryCatalogView { license: string; items: LibraryItemView[] }

export async function sha256Bytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

class LocalApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class LocalSource implements ProjectSource {
  readonly kind = "local" as const;
  private assetCache = new Map<string, string>();
  constructor(private readonly token: string) {}

  private async call<T>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> {
    const response = await fetch(url, {
      method,
      headers: { [LOCAL_TOKEN_HEADER]: this.token, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const json = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok && response.status !== 409) throw new LocalApiError(response.status, json.error ?? `HTTP ${response.status}`);
    return { status: response.status, json };
  }

  async load() { return (await this.call<ProjectSnapshot>("GET", "/api/project")).json; }

  async save(path: string, content: string, expectedHash: string): Promise<SaveOutcome> {
    try {
      const { status, json } = await this.call<SaveResponse | ConflictResponse>("PUT", "/api/file", { path, content, expectedHash });
      if (status === 409) return { ok: false, conflict: json as ConflictResponse };
      return { ok: true, hash: (json as SaveResponse).hash };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async assetUrl(asset: AssetEntry): Promise<string> {
    const cached = this.assetCache.get(asset.path);
    if (cached) return cached;
    const response = await fetch(`/api/asset?path=${encodeURIComponent(asset.path)}`, { headers: { [LOCAL_TOKEN_HEADER]: this.token }, cache: "no-store" });
    if (!response.ok) throw new Error(`素材を読めません: ${asset.path}`);
    const url = URL.createObjectURL(await response.blob());
    this.assetCache.set(asset.path, url);
    return url;
  }

  forgetAsset(path: string) {
    const url = this.assetCache.get(path);
    if (url) URL.revokeObjectURL(url);
    this.assetCache.delete(path);
  }

  async saveImage(path: string, png: Blob, expectedHash: string) {
    const bytes = new Uint8Array(await png.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    try {
      const { status, json } = await this.call<{ hash?: string; bytes?: number; error?: string }>("PUT", "/api/image", { path, base64: btoa(binary), expectedHash });
      if (status === 409) return { ok: false as const, conflict: true, error: "画像が外部で変更されています（読み込み直してから描いてください）" };
      if (status !== 200) return { ok: false as const, error: json.error ?? `保存できません (${status})` };
      this.forgetAsset(path);
      return { ok: true as const, hash: json.hash!, bytes: json.bytes ?? bytes.length };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async importAsset(file: Blob, entry: Record<string, unknown>) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    try {
      const { json } = await this.call<{ asset?: AssetEntry }>("POST", "/api/asset/import", { entry, base64: btoa(binary) });
      if (!json.asset) return { ok: false as const, error: "素材の登録結果を取得できませんでした" };
      return { ok: true as const, asset: json.asset };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async library() { return (await this.call<LibraryCatalogView>("GET", "/api/library")).json; }
  async libraryImageUrl(path: string): Promise<string> {
    const key = `library:${path}`;
    const cached = this.assetCache.get(key);
    if (cached) return cached;
    const response = await fetch(`/api/library/image?path=${encodeURIComponent(path)}`, { headers: { [LOCAL_TOKEN_HEADER]: this.token } });
    if (!response.ok) throw new Error(`ライブラリの画像を読めません: ${path}`);
    const url = URL.createObjectURL(await response.blob());
    this.assetCache.set(key, url);
    return url;
  }
  async libraryAdd(ids: string[]) {
    const { status } = await this.call<{ ok: boolean }>("POST", "/api/library/add", { ids }).catch(() => ({ status: 500 }));
    return status === 200;
  }

  async assetHash(path: string): Promise<string> {
    const response = await fetch(`/api/asset?path=${encodeURIComponent(path)}`, { headers: { [LOCAL_TOKEN_HEADER]: this.token }, cache: "no-store" });
    if (!response.ok) throw new Error(`素材を読めません: ${path}`);
    return sha256Bytes(await response.arrayBuffer());
  }

  async history(file?: string) { return (await this.call<{ entries: HistoryEntryView[] }>("GET", `/api/history${file ? `?file=${encodeURIComponent(file)}` : ""}`)).json.entries ?? []; }
  async historyText(id: string, side: "before" | "after") { return (await this.call<{ text: string | null }>("GET", `/api/history/content?id=${encodeURIComponent(id)}&side=${side}`)).json.text ?? null; }
  async restoreHistory(id: string, side: "before" | "after") {
    const { status, json } = await this.call<{ error?: string }>("POST", "/api/history/restore", { id, side });
    return status === 200 ? { ok: true } : { ok: false, error: json.error ?? `戻せません (${status})` };
  }
  async changes(after: number) { return (await this.call<ChangesResponse>("GET", `/api/changes?after=${after}`)).json; }
  async requestBuild() { return (await this.call<BuildStatus>("POST", "/api/build", {})).json; }
  async runTests() { return (await this.call<TestResponse>("POST", "/api/test", {})).json; }

  async loadSystems(version: string | null): Promise<GameSystem[]> {
    if (!version) return [];
    const response = await fetch("/api/build/systems.js", { headers: { [LOCAL_TOKEN_HEADER]: this.token }, cache: "no-store" });
    if (!response.ok) throw new Error("ビルド済みのシステムを取得できません");
    const url = URL.createObjectURL(new Blob([await response.text()], { type: "text/javascript" }));
    try {
      const module = await import(/* @vite-ignore */ url) as { systems?: GameSystem[] };
      return module.systems ?? [];
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/* ------------------------------------------------------------ preview (bundled sample) */
const SAMPLE_ROOT = "../../../projects/sample-rpg/";
const sampleTexts = import.meta.glob("../../../projects/sample-rpg/**/*.{json,ts,md}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const sampleAssets = import.meta.glob("../../../projects/sample-rpg/assets/**/*.{png,wav,ogg,mp3,json}", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const sampleSystems = import.meta.glob("../../../projects/sample-rpg/systems/*.ts", { eager: true }) as Record<string, { default?: GameSystem }>;
const sampleScripts = import.meta.glob("../../../projects/sample-rpg/scripts/*.ts", { eager: true }) as Record<string, { default?: object }>;

export class PreviewSource implements ProjectSource {
  readonly kind = "preview" as const;
  async load(): Promise<ProjectSnapshot> {
    const texts: Record<string, string> = {};
    const hashes: Record<string, string> = {};
    for (const [key, text] of Object.entries(sampleTexts)) {
      const relative = key.slice(SAMPLE_ROOT.length);
      texts[relative] = text;
      hashes[relative] = await sha256Hex(text);
    }
    return { projectDir: "projects/sample-rpg (Preview)", texts, hashes };
  }
  async save(_path: string, content: string): Promise<SaveOutcome> {
    return { ok: true, hash: await sha256Hex(content) };
  }
  async assetUrl(asset: AssetEntry): Promise<string> {
    const url = sampleAssets[`${SAMPLE_ROOT}${asset.path}`];
    if (!url) throw new Error(`素材がありません: ${asset.path}`);
    return url;
  }
  async loadSystems(): Promise<GameSystem[]> {
    const systems = Object.values(sampleSystems).map(module => module.default).filter((s): s is GameSystem => Boolean(s));
    const scripts = Object.entries(sampleScripts).flatMap(([file, module]) => module.default ? [{ ...module.default, id: file.split("/").pop()!.replace(/\.ts$/, ""), scope: "attached" } as GameSystem] : []);
    return [...systems, ...scripts];
  }
}

export function detectSource(): ProjectSource {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${LOCAL_TOKEN_META}"]`);
  return meta?.content ? new LocalSource(meta.content) : new PreviewSource();
}

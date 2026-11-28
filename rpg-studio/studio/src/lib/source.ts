/**
 * Where the studio reads and writes project files.
 *  - LocalSource: `pnpm studio` — the local server on 127.0.0.1 (real files, conflict detection, builds).
 *  - PreviewSource: `pnpm dev` / 公開サイトの工房 — ブラウザ版。見本から始め、編集はこのブラウザ（IndexedDB）に保存。
 */
import { AssetEntrySchema, AssetManifestSchema, ExperienceProjectSchema, type AssetEntry } from "@rpg/schema";
import type { GameSystem } from "@rpg/engine";
import { askPersistent, currentProjectId, freeId, getProject, putProject, setCurrentProjectId, type BrowserProject } from "./browserProjects";
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
/** Where imported files go in a browser RPG project (same layout as the sample). */
const RPG_ASSET_FOLDERS: Record<AssetEntry["kind"], string> = {
  tileset: "assets/tiles", character: "assets/characters", enemy: "assets/enemies", animation: "assets/animations", portrait: "assets/portraits",
  background: "assets/backgrounds", bgm: "assets/audio/bgm", sfx: "assets/audio/sfx", song: "assets/audio/songs", font: "assets/fonts",
};
const EXPERIENCE_ASSET_FOLDERS: Record<AssetEntry["kind"], string> = {
  tileset: "assets/tilesets", character: "assets/characters", enemy: "assets/enemies", animation: "assets/animations",
  portrait: "assets/portraits", background: "assets/backgrounds", bgm: "assets/audio/bgm", sfx: "assets/audio/sfx",
  song: "assets/audio/songs", font: "assets/fonts",
};

function sniffAsset(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.subarray(0, 8).join(",") === "137,80,78,71,13,10,26,10") return { mime: "image/png", extension: ".png" };
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WAVE") return { mime: "audio/wav", extension: ".wav" };
  const head = new TextDecoder().decode(bytes.subarray(0, 4));
  if (head === "OggS") return { mime: "audio/ogg", extension: ".ogg" };
  if (head === "wOF2") return { mime: "font/woff2", extension: ".woff2" };
  if (head === "wOFF") return { mime: "font/woff", extension: ".woff" };
  if (head === "OTTO") return { mime: "font/otf", extension: ".otf" };
  if (head === "\0\u0001\0\0" || head === "true") return { mime: "font/ttf", extension: ".ttf" };
  if (new TextDecoder().decode(bytes.subarray(0, 3)) === "ID3" || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return { mime: "audio/mpeg", extension: ".mp3" };
  return null;
}

/** The bundled sample's texts (project-relative paths). */
export function sampleProjectTexts(): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const [key, text] of Object.entries(sampleTexts)) texts[key.slice(SAMPLE_ROOT.length)] = text;
  return texts;
}
/** URL of a bundled sample asset (images and sounds the browser projects borrow). */
export const sampleAssetUrl = (path: string): string | undefined => sampleAssets[`${SAMPLE_ROOT}${path}`];

/**
 * Preview / ブラウザ版: the bundled sample to start with; once edited, the project lives in this browser (IndexedDB)
 * and can be switched, exported as a ZIP and imported again (see BrowserPanel).
 */
export class PreviewSource implements ProjectSource {
  readonly kind = "preview" as const;
  /** The browser project being edited (null = the untouched sample). */
  project: BrowserProject | null = null;
  private saveTimer: number | undefined;
  private urls = new Map<string, string>();
  onSaved?: (state: "saving" | "saved" | "error", message?: string) => void;

  async load(): Promise<ProjectSnapshot> {
    const id = currentProjectId();
    // The copy in memory is the newest (saving to IndexedDB is delayed a little): only read the stored copy when
    // opening a different project, so a reload right after an edit (e.g. importing a file) does not lose it.
    if (!this.project || this.project.id !== id) this.project = id ? (await getProject(id).catch(() => undefined)) ?? null : null;
    if (id && !this.project) setCurrentProjectId(null);
    const texts = this.project ? { ...this.project.texts } : sampleProjectTexts();
    const hashes: Record<string, string> = {};
    for (const [path, text] of Object.entries(texts)) hashes[path] = await sha256Hex(text);
    return { projectDir: this.project ? `${this.project.title}（このブラウザに保存）` : "見本（編集するとこのブラウザに保存されます）", texts, hashes };
  }

  /** Every edit goes into the browser project (the first edit of the sample makes a copy of it). */
  async save(path: string, content: string): Promise<SaveOutcome> {
    if (!this.project) {
      const now = new Date().toISOString();
      const texts = sampleProjectTexts();
      const title = (() => { try { return String((JSON.parse(texts["project.json"]!) as { title?: string }).title ?? "見本"); } catch { return "見本"; } })();
      this.project = { id: await freeId("sample-copy"), title: `${title}（見本のコピー）`, origin: "sample", texts, files: {}, createdAt: now, updatedAt: now };
      setCurrentProjectId(this.project.id);
      void askPersistent();
    }
    this.project.texts[path] = content;
    if (path === "project.json" || path === "experience.json") { try { this.project.title = String((JSON.parse(content) as { title?: string }).title ?? this.project.title); } catch { /* broken JSON: keep the title */ } }
    this.schedule();
    return { ok: true, hash: await sha256Hex(content) };
  }

  private schedule() {
    window.clearTimeout(this.saveTimer);
    this.onSaved?.("saving");
    this.saveTimer = window.setTimeout(() => {
      if (!this.project) return;
      putProject(this.project).then(() => this.onSaved?.("saved"), error => this.onSaved?.("error", error instanceof Error ? error.message : String(error)));
    }, 400);
  }

  async assetUrl(asset: AssetEntry): Promise<string> {
    const blob = this.project?.files[asset.path];
    if (blob) {
      const cached = this.urls.get(asset.path);
      if (cached) return cached;
      const url = URL.createObjectURL(blob);
      this.urls.set(asset.path, url);
      return url;
    }
    const url = sampleAssetUrl(asset.path);
    if (!url) throw new Error(`素材がありません: ${asset.path}`);
    return url;
  }

  /** True when the asset is borrowed from the bundled sample (the sample itself, or a sample file kept in a new game). */
  isSampleAsset(asset: AssetEntry): boolean {
    if (this.project?.files[asset.path]) return false;
    if (asset.kind === "song" && this.project && this.project.texts[asset.path] !== sampleProjectTexts()[asset.path]) return false;
    return Boolean(sampleAssetUrl(asset.path));
  }

  async assetHash(path: string): Promise<string> {
    const blob = this.project?.files[path];
    if (blob) return sha256Bytes(await blob.arrayBuffer());
    const url = sampleAssetUrl(path);
    return url ? sha256Bytes(await (await fetch(url)).arrayBuffer()) : "";
  }

  /** Pixel editor: the PNG is kept in the browser project. */
  async saveImage(path: string, png: Blob) {
    if (!this.project) await this.save("project.json", sampleProjectTexts()["project.json"]!);
    this.project!.files[path] = png;
    const old = this.urls.get(path);
    if (old) URL.revokeObjectURL(old);
    this.urls.delete(path);
    this.schedule();
    return { ok: true as const, hash: await sha256Bytes(await png.arrayBuffer()), bytes: png.size };
  }

  /** Import one local image/audio/font and persist its provenance with the browser project (独立作品 and RPG). */
  async importAsset(file: Blob, input: Record<string, unknown>) {
    if (!this.project) await this.save("project.json", sampleProjectTexts()["project.json"]!);
    if (!this.project) return { ok: false as const, error: "先にブラウザ版の作品を作成または開いてください" };
    try {
      const isExperience = this.project.texts["experience.json"] !== undefined;
      let assetsPath: string;
      if (isExperience) {
        const project = ExperienceProjectSchema.safeParse(JSON.parse(this.project.texts["experience.json"] ?? ""));
        if (!project.success) throw new Error("experience.json を確認してください");
        assetsPath = project.data.assetsPath;
      } else {
        const manifest = JSON.parse(this.project.texts["project.json"] ?? "{}") as { assetsPath?: unknown };
        assetsPath = typeof manifest.assetsPath === "string" ? manifest.assetsPath : "assets.json";
      }
      const folders = isExperience ? EXPERIENCE_ASSET_FOLDERS : RPG_ASSET_FOLDERS;
      const parsedAssets = AssetManifestSchema.safeParse(JSON.parse(this.project.texts[assetsPath] ?? ""));
      if (!parsedAssets.success) throw new Error(`${assetsPath} を確認してください`);
      if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("素材は20MBまでです");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = sniffAsset(bytes);
      if (!format) throw new Error("PNG・OGG・MP3・WAV・WOFF2・WOFF・TTF・OTFに対応しています");
      if (format.mime === "image/png" && file.size > 3 * 1024 * 1024) throw new Error("画像は3MBまでです");
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const kind = input.kind as AssetEntry["kind"];
      if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(id)) throw new Error("素材IDは英数字で始め、英数字・._-で指定してください");
      if (parsedAssets.data.assets.some(asset => asset.id === id)) throw new Error(`素材ID「${id}」は既に使われています`);
      const imageKinds = new Set<AssetEntry["kind"]>(["tileset", "character", "enemy", "animation", "portrait", "background"]);
      const isImage = imageKinds.has(kind);
      const isAudio = kind === "bgm" || kind === "sfx";
      if ((!isImage && !isAudio && kind !== "font") || (isImage && format.mime !== "image/png") || (isAudio && !format.mime.startsWith("audio/")) || (kind === "font" && !format.mime.startsWith("font/"))) {
        throw new Error(`素材の種類「${String(kind)}」とファイル形式 ${format.mime} が合いません`);
      }
      if (format.mime === "image/png") {
        if (bytes.length < 24 || new TextDecoder().decode(bytes.subarray(12, 16)) !== "IHDR") throw new Error("PNG画像のヘッダーが正しくありません");
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const width = view.getUint32(16), height = view.getUint32(20);
        if (!width || !height || width > 4096 || height > 4096) throw new Error("画像の大きさは4096×4096までです");
        input = { ...input, tileWidth: input.tileWidth ?? width, tileHeight: input.tileHeight ?? height, columns: input.columns ?? 1, rows: input.rows ?? 1 };
      }
      const origin = input.origin;
      const entryInput = {
        ...input, id, kind, mimeType: format.mime, bytes: bytes.length,
        path: `${folders[kind]}/${id}${format.extension}`,
        source: typeof input.source === "string" ? input.source : origin === "generated" ? "生成" : origin === "original" ? "自作" : typeof input.sourceId === "string" ? input.sourceId : "外部素材",
        license: typeof input.license === "string" && input.license ? input.license : "プロジェクト内素材",
        ...(isAudio ? { loop: input.loop ?? kind === "bgm" } : {}),
      };
      const asset = AssetEntrySchema.safeParse(entryInput);
      if (!asset.success) throw new Error(asset.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join(" ／ "));
      const nextManifest = AssetManifestSchema.safeParse({ ...parsedAssets.data, assets: [...parsedAssets.data.assets, asset.data] });
      if (!nextManifest.success) throw new Error(nextManifest.error.issues.map(issue => issue.message).join(" ／ "));
      this.project.files[asset.data.path] = new Blob([bytes as BlobPart], { type: format.mime });
      const oldUrl = this.urls.get(asset.data.path);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      this.urls.delete(asset.data.path);
      this.project.texts[assetsPath] = `${JSON.stringify(nextManifest.data, null, 2)}\n`;
      this.schedule();
      return { ok: true as const, asset: asset.data };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Systems and scripts run only while their code is the sample's own (code cannot be compiled in the browser). */
  async loadSystems(): Promise<GameSystem[]> {
    const texts = this.project?.texts ?? sampleProjectTexts();
    const same = (key: string) => texts[key.slice(SAMPLE_ROOT.length)] === sampleTexts[key];
    const systems = Object.entries(sampleSystems).filter(([file]) => same(file)).map(([, module]) => module.default).filter((s): s is GameSystem => Boolean(s));
    const scripts = Object.entries(sampleScripts).filter(([file]) => same(file)).flatMap(([file, module]) => module.default ? [{ ...module.default, id: file.split("/").pop()!.replace(/\.ts$/, ""), scope: "attached" } as GameSystem] : []);
    return [...systems, ...scripts];
  }

  /** True when the game ZIP can be made in the browser: no own code, or exactly the sample's code. */
  canExportInBrowser(): boolean {
    const texts = this.project?.texts ?? sampleProjectTexts();
    const hasCode = Object.keys(texts).some(f => /^(systems|scripts)\/.*\.ts$/.test(f));
    return !hasCode || this.codeIsSample();
  }

  /** True when the project's systems / scripts are exactly the sample's (so the sample's built game code can run it). */
  codeIsSample(): boolean {
    const texts = this.project?.texts ?? sampleProjectTexts();
    const code = (t: Record<string, string>) => Object.keys(t).filter(f => /^(systems|scripts)\/.*\.ts$/.test(f)).sort();
    const sample = sampleProjectTexts();
    const mine = code(texts), theirs = code(sample);
    return mine.length === theirs.length && mine.every((f, i) => f === theirs[i] && texts[f] === sample[f]);
  }
}

export function detectSource(): ProjectSource {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${LOCAL_TOKEN_META}"]`);
  return meta?.content ? new LocalSource(meta.content) : new PreviewSource();
}

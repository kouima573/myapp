import fs from "node:fs/promises";
import path from "node:path";
import {
  detectProjectFormat, loadProjectContent, referencedJsonFiles,
  type AssetEntry, type Diagnostic, type GameContent, type ProjectFileTexts, type ProjectManifest,
} from "../../schema/src/index";

export interface LoadedProject {
  root: string;
  texts: ProjectFileTexts;
  content: GameContent | null;
  diagnostics: Diagnostic[];
  formatVersion: number | null;
}

/** Rejects absolute paths, `..` and backslashes so manifests can never point outside the project. */
export function resolveInside(root: string, relative: string): string {
  if (!relative || relative.includes("\\") || relative.startsWith("/") || relative.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`プロジェクト相対パスではありません: ${relative}`);
  }
  const target = path.resolve(root, ...relative.split("/"));
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`プロジェクト外を指しています: ${relative}`);
  return target;
}

async function readTextIfExists(root: string, relative: string): Promise<string | undefined> {
  try {
    const file = resolveInside(root, relative);
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return undefined;
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/** Reads project.json and every JSON / system file it references. */
export async function readProjectTexts(root: string): Promise<{ texts: ProjectFileTexts; formatVersion: number | null }> {
  const texts: ProjectFileTexts = {};
  const manifestText = await readTextIfExists(root, "project.json");
  if (manifestText === undefined) return { texts, formatVersion: null };
  texts["project.json"] = manifestText;
  const formatVersion = detectProjectFormat(manifestText);
  let manifest: Partial<ProjectManifest> & Record<string, unknown>;
  try { manifest = JSON.parse(manifestText); } catch { return { texts, formatVersion }; }
  const paths = new Set<string>();
  const add = (value: unknown) => { if (typeof value === "string") paths.add(value); };
  if (formatVersion === 2) {
    try { referencedJsonFiles(manifest as ProjectManifest).forEach(add); } catch { /* malformed manifest: schema reports it */ }
  } else {
    // v1 layout, read so `migrate` can work from the same loader.
    add(manifest.eventsPath); add(manifest.dialoguesPath); add(manifest.assetsPath);
    if (Array.isArray(manifest.maps)) manifest.maps.forEach(m => add((m as { path?: unknown }).path));
  }
  if (Array.isArray(manifest.systems)) manifest.systems.forEach(s => add((s as { path?: unknown }).path));
  for (const relative of paths) {
    if (relative === "project.json") continue;
    const text = await readTextIfExists(root, relative).catch(() => undefined);
    if (text !== undefined) texts[relative] = text;
  }
  // Text-score songs live in assets.json; read them so validation can check the notes.
  const assetsPath = typeof manifest.assetsPath === "string" ? manifest.assetsPath : undefined;
  if (assetsPath && texts[assetsPath]) {
    try {
      for (const asset of (JSON.parse(texts[assetsPath]!) as { assets?: Array<{ kind?: string; path?: unknown }> }).assets ?? []) {
        if (asset.kind === "song" && typeof asset.path === "string") { const text = await readTextIfExists(root, asset.path); if (text !== undefined) texts[asset.path] = text; }
      }
    } catch { /* schema reports broken assets.json */ }
  }
  // Art requirements (not game data, but shown in the studio and validated by the CLI).
  for (const relative of ["art/requests.json", "art/style-guide.md", "IDEA.md", "README.md", "mods.json"]) {
    const text = await readTextIfExists(root, relative);
    if (text !== undefined) texts[relative] = text;
  }
  return { texts, formatVersion };
}

function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** File-level checks that need disk access: existence, byte size, PNG signature and sheet dimensions. */
export async function checkAssetFiles(root: string, assets: AssetEntry[], assetsPath: string, maxFileBytes = 0, total = { bytes: 0 }): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  for (const asset of assets) {
    const at = `assets[${asset.id}]`;
    let bytes: Buffer;
    try {
      const file = resolveInside(root, asset.path);
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) { out.push({ severity: "error", file: assetsPath, at, message: `シンボリックリンクの素材は使えません: ${asset.path}` }); continue; }
      bytes = await fs.readFile(file);
    } catch {
      out.push({ severity: "error", file: assetsPath, at, message: `素材ファイルがありません: ${asset.path}` });
      continue;
    }
    if (maxFileBytes && bytes.length > maxFileBytes) out.push({ severity: "error", file: assetsPath, at, message: `${(bytes.length / 1048576).toFixed(1)}MB は1ファイルの上限(assetPolicy.budget.maxFileMB)を超えています。音声はOGG 96〜128kbps、画像は分割・減色を検討してください` });
    total.bytes += bytes.length;
    if (bytes.length !== asset.bytes) out.push({ severity: "warning", file: assetsPath, at: `${at}.bytes`, message: `bytes=${asset.bytes} ですが実ファイルは${bytes.length}バイトです` });
    if (asset.mimeType === "image/png") {
      const size = pngSize(bytes);
      if (!size) { out.push({ severity: "error", file: assetsPath, at, message: `PNGとして読めません: ${asset.path}` }); continue; }
      const margin = asset.margin ?? 0, spacing = asset.spacing ?? 0;
      const expectedW = margin * 2 + (asset.columns ?? 0) * (asset.tileWidth ?? 0) + Math.max(0, (asset.columns ?? 1) - 1) * spacing;
      const expectedH = margin * 2 + (asset.rows ?? 0) * (asset.tileHeight ?? 0) + Math.max(0, (asset.rows ?? 1) - 1) * spacing;
      if (size.width !== expectedW || size.height !== expectedH) {
        out.push({ severity: "error", file: assetsPath, at, message: `画像サイズ${size.width}×${size.height}がメタデータから計算した${expectedW}×${expectedH}と一致しません` });
      }
    }
  }
  return out;
}

export async function loadProjectFromDisk(root: string): Promise<LoadedProject> {
  const { texts, formatVersion } = await readProjectTexts(root);
  if (texts["project.json"] === undefined) {
    return { root, texts, content: null, formatVersion, diagnostics: [{ severity: "error", file: "project.json", message: `${root} にproject.jsonがありません` }] };
  }
  const result = loadProjectContent(texts);
  const diagnostics = [...result.diagnostics];
  if (result.content) {
    const budget = result.content.project.assetPolicy.budget;
    const total = { bytes: Object.values(texts).reduce((sum, text) => sum + Buffer.byteLength(text), 0) };
    diagnostics.push(...await checkAssetFiles(root, result.content.assets.assets, result.content.project.assetsPath, budget.maxFileMB * 1048576, total));
    const mb = total.bytes / 1048576;
    if (mb > budget.maxTotalMB) diagnostics.push({ severity: "error", file: "project.json", at: "assetPolicy.budget", message: `プロジェクトの合計 ${mb.toFixed(1)}MB が上限 ${budget.maxTotalMB}MB を超えています（pnpm rpg asset report で内訳を確認）` });
    else if (mb > budget.warnTotalMB) diagnostics.push({ severity: "warning", file: "project.json", at: "assetPolicy.budget", message: `プロジェクトの合計 ${mb.toFixed(1)}MB が目安 ${budget.warnTotalMB}MB を超えています。Web公開・スマホでの読み込みが重くなります` });
  }
  if (result.content) {
    const { moduleDiagnostics } = await import("../../modules/src/index");
    diagnostics.push(...moduleDiagnostics(result.content));
  }
  if (texts["art/requests.json"] !== undefined) {
    const { ArtRequestBundleSchema } = await import("../../schema/src/index");
    let parsed: unknown;
    try { parsed = JSON.parse(texts["art/requests.json"]!); } catch (error) { diagnostics.push({ severity: "error", file: "art/requests.json", message: `JSONとして読めません: ${String(error)}` }); }
    if (parsed !== undefined) {
      const result = ArtRequestBundleSchema.safeParse(parsed);
      if (!result.success) for (const issue of result.error.issues) diagnostics.push({ severity: "error", file: "art/requests.json", at: issue.path.join("."), message: issue.message });
      else for (const request of result.data.requests) {
        if (request.status === "done" && !(request.assetId && (await assetExists(root, texts, request.assetId)))) diagnostics.push({ severity: "warning", file: "art/requests.json", at: `requests[${request.id}]`, message: `完了(done)ですが素材 '${request.assetId ?? "(assetId未設定)"}' がassets.jsonにありません` });
      }
    }
  }
  const hasError = diagnostics.some(d => d.severity === "error");
  return { root, texts, formatVersion, content: hasError ? null : result.content, diagnostics };
}

async function assetExists(_root: string, texts: ProjectFileTexts, id: string): Promise<boolean> {
  const manifest = JSON.parse(texts["project.json"] ?? "{}") as { assetsPath?: string };
  try { return (JSON.parse(texts[manifest.assetsPath ?? "assets.json"] ?? "{}") as { assets?: Array<{ id: string }> }).assets?.some(a => a.id === id) ?? false; } catch { return false; }
}

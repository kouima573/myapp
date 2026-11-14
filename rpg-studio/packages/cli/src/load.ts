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
  return { texts, formatVersion };
}

function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** File-level checks that need disk access: existence, byte size, PNG signature and sheet dimensions. */
export async function checkAssetFiles(root: string, assets: AssetEntry[], assetsPath: string): Promise<Diagnostic[]> {
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
  if (result.content) diagnostics.push(...await checkAssetFiles(root, result.content.assets.assets, result.content.project.assetsPath));
  const hasError = diagnostics.some(d => d.severity === "error");
  return { root, texts, formatVersion, content: hasError ? null : result.content, diagnostics };
}

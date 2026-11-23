/**
 * ブラウザ版の工房の書き出し・読み込み:
 *  - プロジェクトをZIPで書き出す（手元の工房・Codex・Claude Code でそのまま開ける形。見本から借りた絵や音も同梱）
 *  - ZIPからプロジェクトを読み込む
 *  - 遊べる形で書き出す（公開サイトの共通ゲームエンジン ../runtime/ と、検証済みデータ・素材を1つのZIPに）
 */
import { loadProjectContent, normalizedDataFiles, type GameContent } from "@rpg/schema";
import { creditsMarkdown } from "../../../packages/runtime/src/credits";
import { freeId, type BrowserProject } from "./browserProjects";
import { sampleAssetUrl, sampleProjectTexts } from "./source";
import { readZip, writeZip, type ZipEntry } from "./zip";

const enc = new TextEncoder();
const TEXT = /\.(json|md|ts)$/i;

async function assetBytes(project: { files: Record<string, Blob> } | null, path: string): Promise<Uint8Array | undefined> {
  const blob = project?.files[path];
  if (blob) return new Uint8Array(await blob.arrayBuffer());
  const url = sampleAssetUrl(path);
  if (!url) return undefined;
  const response = await fetch(url);
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
}

function assetPaths(texts: Record<string, string>): string[] {
  try {
    const manifest = JSON.parse(texts["project.json"] ?? "{}") as { assetsPath?: string };
    const assets = JSON.parse(texts[manifest.assetsPath ?? "assets.json"] ?? "{}") as { assets?: Array<{ path?: string; kind?: string }> };
    return (assets.assets ?? []).filter(a => a.path && a.kind !== "song").map(a => a.path!);
  } catch { return []; }
}

export function download(name: string, bytes: Uint8Array, type = "application/zip") {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Project files + every asset it lists, under "<id>/". */
export async function projectZip(id: string, texts: Record<string, string>, project: { files: Record<string, Blob> } | null): Promise<{ bytes: Uint8Array; missing: string[] }> {
  const entries: ZipEntry[] = Object.entries(texts).sort(([a], [b]) => a.localeCompare(b)).map(([name, text]) => ({ name: `${id}/${name}`, data: enc.encode(text) }));
  const missing: string[] = [];
  const paths = new Set([...assetPaths(texts), ...Object.keys(project?.files ?? {})]);
  for (const path of [...paths].sort()) {
    const data = await assetBytes(project, path);
    if (data) entries.push({ name: `${id}/${path}`, data }); else missing.push(path);
  }
  return { bytes: writeZip(entries), missing };
}

/** Reads a project ZIP (from this studio, `rpg build`'s source folder zipped, or a whole project folder zipped). */
export async function projectFromZip(file: Blob): Promise<BrowserProject> {
  const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
  const manifests = entries.filter(e => /(^|\/)project\.json$/.test(e.name) && !e.name.includes("__MACOSX")).sort((a, b) => a.name.split("/").length - b.name.split("/").length);
  if (!manifests.length) throw new Error("ZIPの中に project.json がありません（プロジェクトのフォルダをZIPにしたものを選んでください）");
  const prefix = manifests[0]!.name.slice(0, -"project.json".length);
  const texts: Record<string, string> = {}, files: Record<string, Blob> = {};
  const dec = new TextDecoder();
  for (const e of entries) {
    if (!e.name.startsWith(prefix) || e.name.includes("__MACOSX") || /(^|\/)\./.test(e.name.slice(prefix.length))) continue;
    const rel = e.name.slice(prefix.length);
    if (!rel || rel.startsWith("node_modules/") || rel.startsWith("dist/")) continue;
    if (TEXT.test(rel)) texts[rel] = dec.decode(e.data);
    else files[rel] = new Blob([e.data as BlobPart]);
  }
  let title = "読み込んだゲーム", baseId = "imported";
  try { const p = JSON.parse(texts["project.json"]!) as { title?: string; id?: string }; title = p.title ?? title; baseId = p.id ?? baseId; } catch { /* validate reports it */ }
  const now = new Date().toISOString();
  return { id: await freeId(baseId), title, origin: "import", texts, files, createdAt: now, updatedAt: now };
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * A playable game as a ZIP: index.html at the archive root + game.js + data/ (validated content with defaults) + assets + CREDITS.md.
 * Root-relative paths make the ZIP directly uploadable to HTML5 hosts such as itch.io.
 */
export async function playableZip(texts: Record<string, string>, project: { files: Record<string, Blob> } | null, codeIsSample: boolean): Promise<{ bytes: Uint8Array; name: string; files: number; totalBytes: number }> {
  const loaded = loadProjectContent(texts);
  const errors = loaded.diagnostics.filter(d => d.severity === "error");
  if (!loaded.content || errors.length) throw new Error(`検証のエラーを先に直してください（${errors.length}件。「検証」画面）`);
  const content: GameContent = loaded.content;
  const hasCode = content.project.systems.length > 0 || Object.keys(texts).some(f => /^scripts\/.*\.ts$/.test(f));
  let base: string;
  if (!hasCode) base = "../runtime/";
  else if (codeIsSample) {
    const sampleModules = Object.keys((JSON.parse(sampleProjectTexts()["project.json"]!) as { modules?: Record<string, unknown> }).modules ?? {});
    if (Object.keys(content.project.modules).some(m => !sampleModules.includes(m))) throw new Error("見本のコードを使うゲームでは、見本にないジャンルモジュールは書き出せません（手元の工房で pnpm rpg build を使ってください）");
    base = "../play/";
  } else throw new Error("独自のコード（systems・scripts）を書き換えたゲームは、ブラウザでは書き出せません。「プロジェクトをZIPで書き出す」で保存し、手元の工房で pnpm rpg build を使ってください");

  const get = async (file: string) => {
    const response = await fetch(new URL(base + file, location.href), { cache: "no-store" });
    if (!response.ok) throw new Error(`共通のゲームエンジン（${base}${file}）を取得できません。公開サイトの工房から書き出してください（pnpm dev では使えません）`);
    return response;
  };
  const id = content.project.id, title = esc(content.project.title);
  let html = await (await get("index.html")).text();
  html = base === "../runtime/" ? html.split("__RPG_TITLE__").join(title) : html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`).replace(/<h1>[^<]*<\/h1>/, `<h1>${title}</h1>`);
  // No service worker / install files in the export: drop the links so nothing 404s.
  html = html.replace(/<link rel="manifest"[^>]*>\n?/, "").replace(/<link rel="icon"[^>]*>\n?/, "");
  const entries: ZipEntry[] = [
    { name: "index.html", data: enc.encode(html) },
    { name: "game.js", data: new Uint8Array(await (await get("game.js")).arrayBuffer()) },
    { name: "sw.js", data: enc.encode("// オフライン用の仕組みは、このZIPには含めていません\n") },
    { name: "CREDITS.md", data: enc.encode(creditsMarkdown(content)) },
    { name: "README.txt", data: enc.encode(`${content.project.title}\n\nRPGシステム工房で作ったブラウザRPGです。\n\nこのZIPをアップロードする場合は、index.html がZIPの直下にあることを確認してください。\n\n遊び方: Webサーバーに置いて index.html を開きます（ファイルをダブルクリックしただけでは動きません）。\n- itch.io: 「HTML」のゲームとして、このZIPをアップロード\n- 静的サイト: ZIPを展開し、index.html・game.js・data/ を同じ公開フォルダーに置く\n- 手元で試す: 展開したフォルダーで npx serve を実行して、表示されたURLを開く\n\n素材のクレジットは CREDITS.md にあります。\n`) },
  ];
  for (const [path, value] of Object.entries(normalizedDataFiles(content))) entries.push({ name: `data/${path}`, data: enc.encode(JSON.stringify(value)) });
  const missing: string[] = [];
  for (const asset of content.assets.assets) {
    if (asset.kind === "song") continue;
    const data = await assetBytes(project, asset.path);
    if (data) entries.push({ name: `data/${asset.path}`, data }); else missing.push(asset.path);
  }
  if (missing.length) throw new Error(`素材のファイルが見つかりません: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " ほか" : ""}`);
  const names = entries.map(entry => entry.name);
  const required = ["index.html", "game.js", "CREDITS.md", "README.txt", ...Object.keys(normalizedDataFiles(content)).map(path => `data/${path}`)];
  const absent = required.filter(name => !names.includes(name));
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (absent.length) throw new Error(`公開ZIPに必要なファイルがありません: ${absent.join(", ")}`);
  if (duplicates.length) throw new Error(`公開ZIP内でファイル名が重複しています: ${[...new Set(duplicates)].join(", ")}`);
  const bytes = writeZip(entries);
  const packed = await readZip(bytes);
  const packedNames = new Set(packed.map(entry => entry.name));
  const unreadable = required.filter(name => !packedNames.has(name));
  if (unreadable.length) throw new Error(`ZIPの展開確認に失敗しました: ${unreadable.join(", ")}`);
  return { bytes, name: `${id}-game.zip`, files: entries.length, totalBytes: entries.reduce((sum, entry) => sum + entry.data.byteLength, 0) };
}

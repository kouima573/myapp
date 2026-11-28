import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import ts from "typescript";
import type { Diagnostic } from "../../schema/src/index";
import { checkAssetFiles, loadProjectFromDisk, resolveInside } from "./load";
import { creditsMarkdown, ENGINE_BANNER, ENGINE_CREDITS_SECTION } from "../../runtime/src/credits";
import { demoContent, normalizedDataFiles, type AssetManifest, type ExperienceProject, type GameContent } from "../../schema/src/index";
import { MODULES } from "../../modules/src/index";
import { loadExperienceProject } from "./experience";


export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RUNTIME_ENTRY = path.join(REPO_ROOT, "packages/runtime/src/standalone.ts");
const ENGINE_INDEX = path.join(REPO_ROOT, "packages/engine/src/index.ts");

/** Import names project code may use regardless of where the project folder lives. */
export const PACKAGE_ALIASES: Record<string, string> = {
  "@rpg/engine": ENGINE_INDEX,
  "@rpg/schema": path.join(REPO_ROOT, "packages/schema/src/index.ts"),
  "@rpg/modules": path.join(REPO_ROOT, "packages/modules/src/kit.ts"),
};

export interface BuildResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Directory with the finished game (only when ok). */
  outDir?: string;
  version?: string;
  /** Bundled systems module for the studio (ESM, exports `systems`). */
  systemsBundle?: string;
  zipPath?: string;
  sizeSummary?: { totalBytes: number; jsBytes: number; dataBytes: number; assetBytes: number; metadataBytes?: number };
}

const posix = (p: string) => p.split(path.sep).join("/");

/** Generated entry: imports the runtime and each project system, then boots the game. */
function entrySource(systemFiles: string[], mode: "game" | "systems", moduleIds: string[] = [], scripts: Array<{ id: string; file: string }> = []): string {
  const imports = [
    ...systemFiles.map((file, i) => `import system${i} from ${JSON.stringify(posix(file))};`),
    ...scripts.map((s, i) => `import script${i} from ${JSON.stringify(posix(s.file))};`),
  ].join("\n");
  // Scripts take their id from the file name and only run while attached to something active.
  const list = `[${[...systemFiles.map((_, i) => `system${i}`), ...scripts.map((s, i) => `{ ...(script${i} as object), id: ${JSON.stringify(s.id)}, scope: "attached" } as GameSystem`)].join(", ")}]`;
  // Only the genre modules the project enables are bundled into the game.
  const moduleImports = moduleIds.map((id, i) => `import module${i} from ${JSON.stringify(posix(path.join(REPO_ROOT, "packages/modules/src", `${id}.ts`)))};`).join("\n");
  const moduleList = `[${moduleIds.map((_, i) => `module${i}`).join(", ")}]`;
  if (mode === "systems") {
    return `import type { GameSystem } from ${JSON.stringify(posix(ENGINE_INDEX))};\n${imports}\nexport const systems: GameSystem[] = ${list};\n`;
  }
  return `import { bootStandalone } from ${JSON.stringify(posix(RUNTIME_ENTRY))};\nimport type { GameSystem } from ${JSON.stringify(posix(ENGINE_INDEX))};\n${imports}\n${moduleImports}\nconst projectSystems: GameSystem[] = ${list};\nconst ids = new Set(projectSystems.map(s => s.id));\nconst systems: GameSystem[] = [...(${moduleList} as GameSystem[]).filter(m => !ids.has(m.id)), ...projectSystems];\nvoid bootStandalone({ systems });\n`;
}

/** Type-checks the generated entry (and so every system file, the engine and the runtime). */
export function typecheck(entryFile: string, projectRoot: string): Diagnostic[] {
  const program = ts.createProgram([entryFile], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    isolatedModules: true,
    types: [],
    baseUrl: REPO_ROOT,
    paths: Object.fromEntries(Object.entries(PACKAGE_ALIASES).map(([name, file]) => [name, [file]])),
  });
  return ts.getPreEmitDiagnostics(program)
    .filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      if (!d.file || d.start === undefined) return { severity: "error" as const, message };
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      const abs = path.resolve(d.file.fileName);
      const rel = abs.startsWith(projectRoot + path.sep) ? posix(path.relative(projectRoot, abs)) : posix(path.relative(REPO_ROOT, abs));
      return { severity: "error" as const, file: rel, at: `${line + 1}:${character + 1}`, message };
    });
}

function gameHtml(title: string): string {
  const safe = title.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'">
<title>${safe}</title>
<link rel="manifest" href="./manifest.webmanifest">
<link rel="icon" href="./icon.svg" type="image/svg+xml">
<meta name="theme-color" content="#0d110e">
<meta property="og:type" content="website">
<meta property="og:title" content="${safe}">
<meta property="og:description" content="${safe} — RPGシステム工房で制作されたブラウザRPG">
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; min-height: 100%; background: #0d110e; color: #e9e2cb; font-family: system-ui, sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  h1 { margin: 4px 0 0; font-size: 17px; letter-spacing: .08em; font-weight: 600; color: #f0c36a; }
  #boot-status { white-space: pre-wrap; padding: 24px; border: 1px solid #3a4637; border-radius: 8px; color: #a9b09d; }
  #boot-status.is-error { color: #ffb4a2; border-color: #a0503c; }
  footer { font-size: 12px; color: #7f8778; line-height: 1.7; }
  kbd { padding: 0 4px; border: 1px solid #4d5a47; border-radius: 3px; background: #1d241c; font-size: 11px; }
</style>
</head>
<body>
<main>
  <h1>${safe}</h1>
  <div id="game"><div id="boot-status">読み込み中…</div></div>
  <footer><kbd>←↑↓→</kbd>/<kbd>WASD</kbd> 移動　<kbd>Enter</kbd>/<kbd>Z</kbd> 調べる・決定　<kbd>Esc</kbd>/<kbd>X</kbd> メニュー・戻る　（スマートフォンは画面下のボタン）</footer>
</main>
<script type="module" src="./game.js"></script>
</body>
</html>
`;
}

/** Lets phones "add to home screen" and keeps the game playable offline once it has been opened. */
async function writePwaFiles(stage: string, title: string, version: string) {
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0d110e"/><path d="M14 46 32 14l18 32z" fill="#f0c36a"/><rect x="28" y="34" width="8" height="12" fill="#0d110e"/></svg>\n`;
  await fs.writeFile(path.join(stage, "icon.svg"), icon);
  await fs.writeFile(path.join(stage, "manifest.webmanifest"), `${JSON.stringify({
    name: title, short_name: [...title].slice(0, 12).join(""), start_url: "./", scope: "./", display: "standalone",
    background_color: "#0d110e", theme_color: "#0d110e", icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  }, null, 2)}\n`);
  const files: string[] = ["./"];
  const walk = async (dir: string, rel: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), r);
      else if (!/^(CREDITS\.md|sw\.js)$/.test(r)) files.push(`./${r}`);
    }
  };
  await walk(stage, "");
  files.sort();
  await fs.writeFile(path.join(stage, "sw.js"), `// 自動生成（rpg build）。ネット優先・オフライン時は保存分。版が変わると古いキャッシュを消します。
const CACHE = ${JSON.stringify(`rpg-${version}`)};
const FILES = ${JSON.stringify(files)};
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("rpg-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== location.origin) return;
  // ネットを先に見る: 公開し直したら次に開いたときから新しい版。つながらないときだけ保存しておいた分で遊ぶ。
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || Response.error())));
});
`);
}

async function copyFile(projectRoot: string, relative: string, outData: string) {
  const source = resolveInside(projectRoot, relative);
  const target = path.join(outData, ...relative.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

export interface BuildOptions {
  /** Final location; default dist/game/<project id>. */
  outDir?: string;
  minify?: boolean;
  /** Also package dist/game/<id>.zip for upload to itch.io etc. */
  zip?: boolean;
  /** Run a static project's configured command. Only set by the explicit --run-project-build CLI flag. */
  runProjectBuild?: boolean;
  /** 体験版: end at project.demo.endWhen (output dist/game/<id>-demo by default). */
  demo?: boolean;
}

function runCreatorBuildCommand(command: string, projectRoot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write("INFO experience.json の build.command を明示許可により実行します\n");
    const child = spawn(command, { cwd: projectRoot, shell: true, stdio: "inherit", windowsHide: true });
    child.once("error", error => reject(new Error(`ビルドコマンドを起動できません: ${String(error)}`)));
    child.once("close", (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`ビルドコマンドが失敗しました（終了コード ${code ?? signal ?? "不明"}）`)));
  });
}

async function buildOutputDirectory(projectRoot: string, relative: string): Promise<string> {
  let current = path.resolve(projectRoot);
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]!);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`ビルド成果物フォルダーにシンボリックリンクは使えません: ${parts.slice(0, index + 1).join("/")}`);
    if (!stat.isDirectory()) throw new Error(`ビルド成果物のパスがフォルダーではありません: ${parts.slice(0, index + 1).join("/")}`);
  }
  return current;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function writeStoreZip(dir: string, outFile: string) {
  const files: Array<{ name: string; data: Buffer }> = [];
  const walk = async (cur: string, rel = "") => {
    for (const e of (await fs.readdir(cur, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(cur, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(p, r);
      else files.push({ name: r, data: await fs.readFile(p) });
    }
  };
  await walk(dir);
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, f.data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(f.data.length, 20); cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + f.data.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16);
  await fs.writeFile(outFile, Buffer.concat([...parts, ...central, eocd]));
}

/**
 * Generic game runtime for the browser studio's "遊べる形で書き出す": every genre module bundled, no project systems.
 * index.html has the title placeholder __RPG_TITLE__ (the studio fills it in).
 */
export async function buildRuntime(outDir: string): Promise<void> {
  const work = path.join(REPO_ROOT, ".rpg-studio", `runtime-${crypto.randomBytes(6).toString("hex")}`);
  await fs.mkdir(work, { recursive: true });
  try {
    const entry = path.join(work, "runtime-entry.ts");
    await fs.writeFile(entry, `import { bootStandalone } from ${JSON.stringify(posix(RUNTIME_ENTRY))};\nimport { modulesFor } from ${JSON.stringify(posix(path.join(REPO_ROOT, "packages/modules/src/index.ts")))};\nvoid bootStandalone({ systems: [], systemsFor: content => modulesFor(content) });\n`);
    await fs.mkdir(outDir, { recursive: true });
    await esbuild.build({ alias: PACKAGE_ALIASES, bundle: true, format: "esm", target: "es2020", platform: "browser", logLevel: "silent", legalComments: "none", banner: { js: ENGINE_BANNER }, minify: true, entryPoints: [entry], outfile: path.join(outDir, "game.js") });
    await fs.writeFile(path.join(outDir, "index.html"), gameHtml("__RPG_TITLE__"));
    await fs.writeFile(path.join(outDir, "systems.js"), "export const systems = [];\n");
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

function experienceHtml(title: string): string {
  const safe = title.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' https: blob: data:; media-src 'self' https: blob:; font-src 'self' https: data:; worker-src 'self' blob:; style-src 'self' https: 'unsafe-inline'; script-src 'self'; connect-src 'self' https: wss: http://localhost:* ws://localhost:*">
<title>${safe}</title>
<link rel="manifest" href="./manifest.webmanifest">
<link rel="icon" href="./icon.svg" type="image/svg+xml">
<meta name="theme-color" content="#101315">
<meta property="og:type" content="website">
<meta property="og:title" content="${safe}">
<meta property="og:description" content="${safe}">
<style>html,body,#experience-root{margin:0;min-height:100%;width:100%;}html{min-height:100dvh;background:#101315;color:#f5f0df;}body{min-height:100dvh;background:#101315;color:#f5f0df;}#experience-root{min-height:100dvh;outline:none;}</style>
</head>
<body>
<div id="experience-root" tabindex="-1"></div>
<script type="module" src="./game.js"></script>
</body>
</html>
`;
}

function experienceCreditsMarkdown(title: string, manifest: AssetManifest): string {
  const rows = manifest.assets.map(a => `| ${a.id} | ${a.kind} | ${a.author ?? ""} | ${a.license} | ${a.url ?? a.sourceId ?? a.source} | ${a.termsCheckedAt ?? ""} |`);
  const credits = manifest.assets.flatMap(a => a.credit ? [`- ${a.credit}`] : []);
  if (manifest.assets.some(a => !a.redistributable || a.sourceId === "dova-syndrome")) credits.push("- 収録素材ファイルの抽出・転用・再配布は禁止です。各素材の利用条件を守ってください。");
  return `# ${title} — クレジット\n\n${credits.length ? credits.join("\n") : "素材の個別クレジットはありません。"}\n\n## 素材一覧\n\n| ID | 種類 | 作者 | 規約・ライセンス | 入手元 | 規約確認日 |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n\nMade with RPGシステム工房\n\n${ENGINE_CREDITS_SECTION}`;
}

/** Copy creator-owned web projects as-is. No RPG or Experience host is added to static runtime output. */
async function buildStaticExperienceProject(projectRoot: string, manifest: ExperienceProject, assets: AssetManifest, options: BuildOptions, diagnostics: Diagnostic[]): Promise<BuildResult> {
  const outDir = path.resolve(options.outDir ?? path.join(REPO_ROOT, "dist/game", manifest.id));
  const relativeProject = path.relative(outDir, projectRoot);
  const outputContainsProject = !relativeProject || (!relativeProject.startsWith(`..${path.sep}`) && relativeProject !== ".." && !path.isAbsolute(relativeProject));
  if (outputContainsProject) return { ok: false, diagnostics: [...diagnostics, { severity: "error", file: "experience.json", message: "出力先に作品フォルダー自体またはその親は指定できません" }] };
  if (options.runProjectBuild && !manifest.build) return { ok: false, diagnostics: [...diagnostics, { severity: "error", file: "experience.json", message: "build.command がありません。experience.json に静的サイトのビルド設定を追加してください" }] };
  if (manifest.build && !options.runProjectBuild) diagnostics.push({ severity: "warning", file: "experience.json", message: "設定コマンドは実行せず、既存の成果物だけを配布します。明示実行には --run-project-build を付けてください" });
  const zipPath = options.zip ? `${outDir}.zip` : undefined;
  const isSamePath = (a: string, b: string) => path.relative(a, b) === "";
  const sourceRoot = manifest.build ? resolveInside(projectRoot, manifest.build.outputDir) : projectRoot;
  const work = path.join(REPO_ROOT, ".rpg-studio", `static-${manifest.id}-${crypto.randomBytes(6).toString("hex")}`);
  const stage = path.join(work, "out");
  await fs.mkdir(stage, { recursive: true });
  try {
    if (manifest.build && options.runProjectBuild) await runCreatorBuildCommand(manifest.build.command, projectRoot);
    if (manifest.build) await buildOutputDirectory(projectRoot, manifest.build.outputDir).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`ビルド成果物フォルダー '${manifest.build?.outputDir}' がありません。明示的にコマンドを実行するには pnpm rpg build --project <dir> --run-project-build を使ってください`);
      throw error;
    });
    if (manifest.build) {
      const assetErrors = (await checkAssetFiles(sourceRoot, assets.assets, manifest.assetsPath)).filter(diagnostic => diagnostic.severity === "error");
      if (assetErrors.length) return { ok: false, diagnostics: [...diagnostics, ...assetErrors] };
    }
    const ignoredDirectories = new Set([".git", "node_modules", ".rpg-studio", ".rpg-backup"]);
    const copyTree = async (sourceDir: string, relativeDir = "") => {
      const entries = (await fs.readdir(sourceDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (relativeDir === "" && ignoredDirectories.has(entry.name)) continue;
        if (entry.name === ".env" || entry.name.startsWith(".env.")) continue;
        const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (relative.split("/").some(part => part === "" || part === "." || part === "..")) throw new Error(`不正な相対パス: ${relative}`);
        const source = path.join(sourceDir, entry.name);
        if (isSamePath(source, outDir) || (zipPath && isSamePath(source, zipPath))) continue;
        const target = path.join(stage, ...relative.split("/"));
        if (entry.isSymbolicLink()) throw new Error(`シンボリックリンクを含められません: ${relative}`);
        if (entry.isDirectory()) {
          if (ignoredDirectories.has(entry.name)) continue;
          await fs.mkdir(target, { recursive: true });
          await copyTree(source, relative);
        } else if (entry.isFile()) {
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.copyFile(source, target);
        }
      }
    };
    await copyTree(sourceRoot);
    try {
      const entryStat = await fs.lstat(path.join(stage, manifest.entry));
      if (!entryStat.isFile() || entryStat.isSymbolicLink()) throw new Error("index.html が通常のファイルではありません");
    } catch (error) {
      throw new Error(`出力フォルダーに ${manifest.entry} がありません: ${String(error)}`);
    }
    const hash = crypto.createHash("sha256");
    let totalBytes = 0, jsBytes = 0, dataBytes = 0, assetBytes = 0;
    const assetPaths = new Set(assets.assets.map(asset => asset.path));
    const fingerprint = async (dir: string, relative = "") => {
      const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) { await fingerprint(file, name); continue; }
        const bytes = await fs.readFile(file);
        hash.update(name).update(bytes);
        totalBytes += bytes.length;
        const extension = path.extname(name).toLowerCase();
        if ([".js", ".mjs", ".cjs"].includes(extension)) jsBytes += bytes.length;
        else if ([".json", ".webmanifest"].includes(extension)) dataBytes += bytes.length;
        if (assetPaths.has(name)) assetBytes += bytes.length;
      }
    };
    await fingerprint(stage);
    const version = hash.digest("hex").slice(0, 12);
    const metadataBytes = totalBytes - jsBytes - dataBytes - assetBytes;
    await fs.mkdir(path.dirname(outDir), { recursive: true });
    const previous = `${outDir}.previous-${crypto.randomBytes(4).toString("hex")}`;
    let moved = false;
    try { await fs.rename(outDir, previous); moved = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    try { await fs.rename(stage, outDir); }
    catch (error) { if (moved) await fs.rename(previous, outDir).catch(() => {}); throw error; }
    if (moved) await fs.rm(previous, { recursive: true, force: true });
    if (zipPath) await writeStoreZip(outDir, zipPath);
    return { ok: true, diagnostics, outDir, version, ...(zipPath ? { zipPath } : {}), sizeSummary: { totalBytes, jsBytes, dataBytes, assetBytes, metadataBytes } };
  } catch (error) {
    return { ok: false, diagnostics: [...diagnostics, { severity: "error", file: "experience.json", message: `独自サイトの準備に失敗しました: ${String(error)}` }] };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/** Build a complete game experience without loading the RPG project schema or runner. */
export async function buildExperienceProject(projectRoot: string, options: BuildOptions = {}): Promise<BuildResult> {
  projectRoot = path.resolve(projectRoot);
  const loaded = await loadExperienceProject(projectRoot);
  const diagnostics = [...loaded.diagnostics];
  const manifest = loaded.manifest;
  const assets = loaded.assets;
  if (!manifest || !assets || (manifest.runtime !== "static" && !loaded.entryFile) || (manifest.runtime === "static" && !manifest.build && !loaded.entryFile)) return { ok: false, diagnostics };
  if (options.runProjectBuild && manifest.runtime !== "static") return { ok: false, diagnostics: [...diagnostics, { severity: "error", file: "experience.json", message: "--run-project-build は static runtime の作品でのみ使えます" }] };
  if (manifest.runtime === "static") return buildStaticExperienceProject(projectRoot, manifest, assets, options, diagnostics);

  let definition: { default?: { id?: string; checkArgs?: (args: Record<string, unknown>) => string[] } };
  try { definition = await importSystemModule(loaded.entryFile!) as typeof definition; }
  catch (error) {
    diagnostics.push({ severity: "error", file: manifest.entry, message: `ExperienceDefinitionを読み込めません: ${String(error)}` });
    return { ok: false, diagnostics };
  }
  if (!definition.default || definition.default.id !== manifest.id) {
    diagnostics.push({ severity: "error", file: manifest.entry, message: `default exportのidは experience.json の '${manifest.id}' と一致させてください` });
    return { ok: false, diagnostics };
  }
  try {
    for (const message of definition.default.checkArgs?.(manifest.args) ?? []) diagnostics.push({ severity: "error", file: manifest.entry, at: "checkArgs", message });
  } catch (error) { diagnostics.push({ severity: "error", file: manifest.entry, at: "checkArgs", message: String(error) }); }
  if (diagnostics.some(d => d.severity === "error")) return { ok: false, diagnostics };

  const work = path.join(REPO_ROOT, ".rpg-studio", `experience-${manifest.id}-${crypto.randomBytes(6).toString("hex")}`);
  await fs.mkdir(work, { recursive: true });
  try {
    const entry = path.join(work, "entry.ts");
    const entryPath = JSON.stringify(posix(loaded.entryFile!));
    const runtimePath = JSON.stringify(posix(path.join(REPO_ROOT, "packages/runtime/src/experience.ts")));
    const enginePath = JSON.stringify(posix(ENGINE_INDEX));
    const assetPaths = Object.fromEntries(assets.assets.map(asset => [asset.id, asset.path]));
    await fs.writeFile(entry, `import { mountExperience } from ${runtimePath};
import type { ExperienceDefinition } from ${enginePath};
import experienceModule from ${entryPath};
const experience = experienceModule as ExperienceDefinition;
const paths: Record<string, string> = ${JSON.stringify(assetPaths)};
void mountExperience(document.getElementById("experience-root")!, experience, {
  projectId: ${JSON.stringify(manifest.id)}, args: ${JSON.stringify(manifest.args)},
  saveEnabled: ${JSON.stringify(manifest.save.enabled)}, autosave: ${JSON.stringify(manifest.save.autosave)},
  assetUrl: id => paths[id] ? new URL(paths[id]!, document.baseURI).href : undefined,
});
if ("serviceWorker" in navigator) void navigator.serviceWorker.register("./sw.js").catch(() => undefined);
`);
    const typeErrors = typecheck(entry, projectRoot);
    if (typeErrors.length) return { ok: false, diagnostics: [...diagnostics, ...typeErrors] };

    const stage = path.join(work, "out");
    await fs.mkdir(stage, { recursive: true });
    try {
      await esbuild.build({ alias: PACKAGE_ALIASES, bundle: true, format: "esm", target: "es2020", platform: "browser", logLevel: "silent", legalComments: "none", banner: { js: ENGINE_BANNER }, minify: options.minify ?? true, sourcemap: false, entryPoints: [entry], outfile: path.join(stage, "game.js") });
    } catch (error) {
      const errors = (error as esbuild.BuildFailure).errors ?? [];
      return { ok: false, diagnostics: [...diagnostics, ...(errors.length ? errors : [{ text: String(error) }]).map(e => ({ severity: "error" as const, file: (e as esbuild.Message).location?.file, at: (e as esbuild.Message).location ? `${(e as esbuild.Message).location!.line}:${(e as esbuild.Message).location!.column + 1}` : undefined, message: e.text }))] };
    }
    await fs.writeFile(path.join(stage, "index.html"), experienceHtml(manifest.title));
    await fs.writeFile(path.join(stage, "assets.json"), JSON.stringify(assets, null, 2) + "\n");
    await fs.writeFile(path.join(stage, "CREDITS.md"), experienceCreditsMarkdown(manifest.title, assets));
    for (const asset of assets.assets) await copyFile(projectRoot, asset.path, stage);

    const hash = crypto.createHash("sha256");
    const fingerprint = async (dir: string, relative = "") => {
      const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await fingerprint(file, name);
        else hash.update(name).update(await fs.readFile(file));
      }
    };
    // Fingerprint every deterministic output input, including artwork, audio and display metadata.
    // The timestamped version.json and PWA cache files are written after this point.
    await fingerprint(stage);
    const version = hash.digest("hex").slice(0, 12);
    await fs.writeFile(path.join(stage, "version.json"), `${JSON.stringify({ version, project: manifest.id, builtAt: new Date().toISOString() }, null, 2)}\n`);
    await writePwaFiles(stage, manifest.title, version);

    const outDir = path.resolve(options.outDir ?? path.join(REPO_ROOT, "dist/game", manifest.id));
    await fs.mkdir(path.dirname(outDir), { recursive: true });
    const previous = `${outDir}.previous-${crypto.randomBytes(4).toString("hex")}`;
    let moved = false;
    try { await fs.rename(outDir, previous); moved = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    try { await fs.rename(stage, outDir); }
    catch (error) { if (moved) await fs.rename(previous, outDir).catch(() => {}); throw error; }
    if (moved) await fs.rm(previous, { recursive: true, force: true });

    let totalBytes = 0;
    const sumDir = async (dir: string) => {
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isDirectory()) await sumDir(file);
        else totalBytes += (await fs.stat(file)).size;
      }
    };
    await sumDir(outDir);
    const jsBytes = (await fs.stat(path.join(outDir, "game.js"))).size;
    const dataBytes = (await fs.stat(path.join(outDir, "assets.json"))).size;
    const packedAssetPaths = new Set(assets.assets.map(asset => asset.path));
    let assetBytes = 0;
    for (const relative of packedAssetPaths) assetBytes += (await fs.stat(path.join(outDir, ...relative.split("/")))).size;
    const metadataBytes = totalBytes - jsBytes - dataBytes - assetBytes;
    const sizeSummary = { totalBytes, jsBytes, dataBytes, assetBytes, metadataBytes };
    const zipPath = options.zip ? `${outDir}.zip` : undefined;
    if (zipPath) await writeStoreZip(outDir, zipPath);
    return { ok: true, diagnostics, outDir, version, ...(zipPath ? { zipPath } : {}), sizeSummary };
  } catch (error) {
    return { ok: false, diagnostics: [...diagnostics, { severity: "error", file: "experience.json", message: String(error) }] };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/** Writes the runtime JSON files from the parsed content (schema defaults applied), at the paths project.json names. */
async function writeNormalizedData(content: GameContent, outData: string) {
  for (const [relative, value] of Object.entries(normalizedDataFiles(content))) {
    const target = path.join(outData, ...relative.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(value));
  }
}

/**
 * validate → typecheck → bundle into a staging directory → swap into place.
 * The previous build stays untouched unless every step succeeds.
 */
export async function buildProject(projectRoot: string, options: BuildOptions = {}): Promise<BuildResult> {
  projectRoot = path.resolve(projectRoot);
  try {
    await fs.lstat(path.join(projectRoot, "experience.json"));
    return buildExperienceProject(projectRoot, options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (options.runProjectBuild) return { ok: false, diagnostics: [{ severity: "error", file: "experience.json", message: "--run-project-build は static runtime の作品でのみ使えます" }] };
  const loaded = await loadProjectFromDisk(projectRoot);
  const diagnostics = [...loaded.diagnostics];
  if (options.demo && loaded.content && !loaded.content.project.demo) return { ok: false, diagnostics: [...diagnostics, { severity: "error", file: "project.json", at: "demo", message: "体験版には project.json の demo（終わる条件 endWhen）が必要です" }] };
  const content = loaded.content && options.demo ? demoContent(loaded.content) : loaded.content;
  if (!content) return { ok: false, diagnostics };

  const work = path.join(REPO_ROOT, ".rpg-studio", `build-${content.project.id}-${crypto.randomBytes(6).toString("hex")}`);
  await fs.mkdir(work, { recursive: true });
  try {
    const systemFiles = content.project.systems.map(system => resolveInside(projectRoot, system.path));
    const gameEntry = path.join(work, "entry.ts");
    const systemsEntry = path.join(work, "systems-entry.ts");
    const moduleIds = Object.keys(content.project.modules).filter(id => /^[a-z0-9]+$/.test(id) && MODULES[id]);
    const scripts = (content.scripts ?? []).map(id => ({ id, file: resolveInside(projectRoot, `scripts/${id}.ts`) }));
    await fs.writeFile(gameEntry, entrySource(systemFiles, "game", moduleIds, scripts));
    await fs.writeFile(systemsEntry, entrySource(systemFiles, "systems", [], scripts));
    const typeErrors = typecheck(gameEntry, projectRoot);
    if (typeErrors.length) return { ok: false, diagnostics: [...diagnostics, ...typeErrors] };

    const stage = path.join(work, "out");
    await fs.mkdir(path.join(stage, "data"), { recursive: true });
    const common: esbuild.BuildOptions = { alias: PACKAGE_ALIASES, bundle: true, format: "esm", target: "es2020", platform: "browser", logLevel: "silent", legalComments: "none", banner: { js: ENGINE_BANNER }, minify: options.minify ?? true, sourcemap: false };
    try {
      await esbuild.build({ ...common, entryPoints: [gameEntry], outfile: path.join(stage, "game.js") });
      await esbuild.build({ ...common, entryPoints: [systemsEntry], outfile: path.join(stage, "systems.js") });
    } catch (error) {
      const errors = (error as esbuild.BuildFailure).errors ?? [];
      return { ok: false, diagnostics: [...diagnostics, ...(errors.length ? errors : [{ text: String(error) }]).map(e => ({ severity: "error" as const, file: (e as esbuild.Message).location?.file, at: (e as esbuild.Message).location ? `${(e as esbuild.Message).location!.line}:${(e as esbuild.Message).location!.column + 1}` : undefined, message: e.text }))] };
    }
    await fs.writeFile(path.join(stage, "index.html"), gameHtml(content.project.title));
    await fs.writeFile(path.join(stage, "CREDITS.md"), creditsMarkdown(content));
    for (const asset of content.assets.assets) await copyFile(projectRoot, asset.path, path.join(stage, "data"));
    // The game loads data without Zod, so it gets the validated content with every default filled in
    // (e.g. an entity state without "solid" must still be solid in the built game, as in tests and the studio).
    await writeNormalizedData(content, path.join(stage, "data"));

    const hash = crypto.createHash("sha256");
    for (const name of ["game.js", ...Object.keys(loaded.texts).sort()]) {
      const file = name === "game.js" ? path.join(stage, name) : resolveInside(projectRoot, name);
      hash.update(name).update(await fs.readFile(file));
    }
    const version = hash.digest("hex").slice(0, 12);
    await fs.writeFile(path.join(stage, "version.json"), `${JSON.stringify({ version, project: content.project.id, builtAt: new Date().toISOString() }, null, 2)}\n`);
    await writePwaFiles(stage, content.project.title, version);

    const outDir = path.resolve(options.outDir ?? path.join(REPO_ROOT, "dist/game", `${content.project.id}${options.demo ? "-demo" : ""}`));
    await fs.mkdir(path.dirname(outDir), { recursive: true });
    const previous = `${outDir}.previous-${crypto.randomBytes(4).toString("hex")}`;
    let moved = false;
    try { await fs.rename(outDir, previous); moved = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    try {
      await fs.rename(stage, outDir);
    } catch (error) {
      if (moved) await fs.rename(previous, outDir).catch(() => {});
      throw error;
    }
    if (moved) await fs.rm(previous, { recursive: true, force: true });
    const systemsBundle = await fs.readFile(path.join(outDir, "systems.js"), "utf8");
    const jsBytes = (await fs.stat(path.join(outDir, "game.js"))).size;
    let dataBytes = 0, assetBytes = 0;
    const sumDir = async (d: string) => {
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await sumDir(p);
        else { const sz = (await fs.stat(p)).size; if (e.name.endsWith(".json")) dataBytes += sz; else assetBytes += sz; }
      }
    };
    await sumDir(path.join(outDir, "data")).catch(() => {});
    const sizeSummary = { totalBytes: jsBytes + dataBytes + assetBytes, jsBytes, dataBytes, assetBytes };
    let zipPath: string | undefined;
    if (options.zip) { zipPath = `${outDir}.zip`; await writeStoreZip(outDir, zipPath); }
    return { ok: true, diagnostics, outDir, version, systemsBundle, zipPath, sizeSummary };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/** Compiles one system file for Node (used by `rpg test` and the studio server) and imports it. */
export async function importSystemModule(file: string): Promise<unknown> {
  const out = path.join(REPO_ROOT, ".rpg-studio", `system-${crypto.randomBytes(6).toString("hex")}.mjs`);
  await fs.mkdir(path.dirname(out), { recursive: true });
  try {
    await esbuild.build({ entryPoints: [file], outfile: out, bundle: true, format: "esm", platform: "node", target: "node22", alias: PACKAGE_ALIASES, logLevel: "silent" });
    return await import(pathToFileURL(out).href);
  } finally {
    await fs.rm(out, { force: true });
  }
}

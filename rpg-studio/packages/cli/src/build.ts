import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import ts from "typescript";
import type { Diagnostic } from "../../schema/src/index";
import { loadProjectFromDisk, resolveInside } from "./load";
import { creditsMarkdown } from "../../runtime/src/credits";
import { normalizedDataFiles, type GameContent } from "../../schema/src/index";
import { MODULES } from "../../modules/src/index";


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
  sizeSummary?: { totalBytes: number; jsBytes: number; dataBytes: number; assetBytes: number };
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
    await esbuild.build({ alias: PACKAGE_ALIASES, bundle: true, format: "esm", target: "es2020", platform: "browser", logLevel: "silent", legalComments: "none", minify: true, entryPoints: [entry], outfile: path.join(outDir, "game.js") });
    await fs.writeFile(path.join(outDir, "index.html"), gameHtml("__RPG_TITLE__"));
    await fs.writeFile(path.join(outDir, "systems.js"), "export const systems = [];\n");
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
  const loaded = await loadProjectFromDisk(projectRoot);
  const diagnostics = [...loaded.diagnostics];
  const content = loaded.content;
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
    const common: esbuild.BuildOptions = { alias: PACKAGE_ALIASES, bundle: true, format: "esm", target: "es2020", platform: "browser", logLevel: "silent", legalComments: "none", minify: options.minify ?? true, sourcemap: false };
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

    const outDir = path.resolve(options.outDir ?? path.join(REPO_ROOT, "dist/game", content.project.id));
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

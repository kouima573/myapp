import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import ts from "typescript";
import type { Diagnostic } from "../../schema/src/index";
import { loadProjectFromDisk, resolveInside } from "./load";
import { creditLines } from "../../runtime/src/credits";
import type { GameContent } from "../../schema/src/index";

/** Credits plus the provenance of every bundled asset, shipped next to the game. */
function creditsMarkdown(content: GameContent): string {
  const rows = content.assets.assets.map(a => `| ${a.id} | ${a.kind} | ${a.origin} | ${a.author ?? ""} | ${a.license} | ${a.url ?? a.sourceId ?? a.source} | ${a.termsCheckedAt ?? ""} |`);
  return `# ${content.project.title} — クレジット\n\n${creditLines(content).map(l => `- ${l}`).join("\n")}\n\n## 素材一覧\n\n| ID | 種類 | 出どころ | 作者 | 規約・ライセンス | 入手元 | 規約確認日 |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`;
}

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RUNTIME_ENTRY = path.join(REPO_ROOT, "packages/runtime/src/standalone.ts");
const ENGINE_INDEX = path.join(REPO_ROOT, "packages/engine/src/index.ts");

/** Import names project code may use regardless of where the project folder lives. */
export const PACKAGE_ALIASES: Record<string, string> = {
  "@rpg/engine": ENGINE_INDEX,
  "@rpg/schema": path.join(REPO_ROOT, "packages/schema/src/index.ts"),
};

export interface BuildResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Directory with the finished game (only when ok). */
  outDir?: string;
  version?: string;
  /** Bundled systems module for the studio (ESM, exports `systems`). */
  systemsBundle?: string;
}

const posix = (p: string) => p.split(path.sep).join("/");

/** Generated entry: imports the runtime and each project system, then boots the game. */
function entrySource(systemFiles: string[], mode: "game" | "systems"): string {
  const imports = systemFiles.map((file, i) => `import system${i} from ${JSON.stringify(posix(file))};`).join("\n");
  const list = `[${systemFiles.map((_, i) => `system${i}`).join(", ")}]`;
  if (mode === "systems") {
    return `import type { GameSystem } from ${JSON.stringify(posix(ENGINE_INDEX))};\n${imports}\nexport const systems: GameSystem[] = ${list};\n`;
  }
  return `import { bootStandalone } from ${JSON.stringify(posix(RUNTIME_ENTRY))};\nimport type { GameSystem } from ${JSON.stringify(posix(ENGINE_INDEX))};\n${imports}\nconst systems: GameSystem[] = ${list};\nvoid bootStandalone({ systems });\n`;
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
    await fs.writeFile(gameEntry, entrySource(systemFiles, "game"));
    await fs.writeFile(systemsEntry, entrySource(systemFiles, "systems"));
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
    for (const relative of Object.keys(loaded.texts)) if (relative.endsWith(".json")) await copyFile(projectRoot, relative, path.join(stage, "data"));
    for (const asset of content.assets.assets) await copyFile(projectRoot, asset.path, path.join(stage, "data"));

    const hash = crypto.createHash("sha256");
    for (const name of ["game.js", ...Object.keys(loaded.texts).sort()]) {
      const file = name === "game.js" ? path.join(stage, name) : resolveInside(projectRoot, name);
      hash.update(name).update(await fs.readFile(file));
    }
    const version = hash.digest("hex").slice(0, 12);
    await fs.writeFile(path.join(stage, "version.json"), `${JSON.stringify({ version, project: content.project.id, builtAt: new Date().toISOString() }, null, 2)}\n`);

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
    return { ok: true, diagnostics, outDir, version, systemsBundle };
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

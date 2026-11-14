#!/usr/bin/env node
/**
 * Non-interactive CLI. Exit code 0 = success, 1 = problems found, 2 = usage error.
 * Every line that reports a problem starts with ERROR or WARN so agents can grep it.
 */
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatDiagnostic, migrateProjectV1toV2, type Diagnostic, type GameContent } from "../../schema/src/index";
import type { GameSystem } from "../../engine/src/index";
import { runScenario, ScenarioSchema, type ScenarioResult } from "../../engine/src/scenario";
import { buildProject, importSystemModule, REPO_ROOT } from "./build";
import { loadProjectFromDisk, readProjectTexts, resolveInside } from "./load";

const USAGE = `RPG Studio CLI

  rpg validate --project <dir>          形式・参照・素材を検証
  rpg test     --project <dir>          検証 + システム読込 + tests/*.scenario.json の自動プレイ
  rpg build    --project <dir> [--out <dir>]  型検査・bundleして dist/game/<id>/ に静的ゲームを出力
  rpg dev      --project <dir> [--port 4174]  ビルドして127.0.0.1で配信、変更で自動再ビルド
  rpg migrate  --project <dir> [--write]      旧形式を移行（既定は差分表示のみ。--writeでバックアップ後に保存）
`;

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--") continue;
    if (!arg.startsWith("--")) throw new Error(`不明な引数: ${arg}`);
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags[key] = next; i++; } else flags[key] = true;
  }
  return { command, flags };
}

function projectDir(flags: Record<string, string | boolean>): string {
  const value = typeof flags.project === "string" ? flags.project : "projects/sample-rpg";
  return path.resolve(process.cwd(), value);
}

function report(diagnostics: Diagnostic[]): { errors: number; warnings: number } {
  for (const d of diagnostics) console.log(formatDiagnostic(d));
  const errors = diagnostics.filter(d => d.severity === "error").length;
  return { errors, warnings: diagnostics.length - errors };
}

export async function loadSystems(root: string, content: GameContent): Promise<GameSystem[]> {
  const systems: GameSystem[] = [];
  for (const ref of content.project.systems) {
    let module: { default?: GameSystem };
    try { module = await importSystemModule(resolveInside(root, ref.path)) as { default?: GameSystem }; }
    catch (error) {
      const errors = (error as { errors?: Array<{ text: string; location?: { file: string; line: number; column: number } }> }).errors;
      const detail = errors?.length ? errors.map(e => `${e.location ? `${e.location.file}:${e.location.line}:${e.location.column + 1} ` : ""}${e.text}`).join("; ") : String(error);
      throw new Error(`${ref.path}: 読み込めません: ${detail}`);
    }
    const system = module.default;
    if (!system || typeof system !== "object" || system.id !== ref.id) {
      throw new Error(`${ref.path}: default exportは id='${ref.id}' のGameSystem（defineSystem({...})）である必要があります`);
    }
    systems.push(system);
  }
  return systems;
}

export async function runProjectScenarios(root: string, content: GameContent, systems: GameSystem[]): Promise<Array<ScenarioResult & { file: string }>> {
  const dir = path.join(root, "tests");
  let files: string[] = [];
  try { files = (await fs.readdir(dir)).filter(name => name.endsWith(".scenario.json")).sort(); } catch { return []; }
  const results: Array<ScenarioResult & { file: string }> = [];
  for (const name of files) {
    const file = `tests/${name}`;
    let raw: unknown;
    try { raw = JSON.parse(await fs.readFile(path.join(dir, name), "utf8")); } catch (error) {
      results.push({ file, name, ok: false, steps: 0, message: `JSONとして読めません: ${String(error)}` });
      continue;
    }
    const parsed = ScenarioSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({ file, name, ok: false, steps: 0, message: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") });
      continue;
    }
    results.push({ file, ...runScenario(content, systems, parsed.data) });
  }
  return results;
}

async function cmdValidate(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectDir(flags);
  const loaded = await loadProjectFromDisk(root);
  const { errors, warnings } = report(loaded.diagnostics);
  if (errors) { console.log(`FAILED validate: ${errors} error(s), ${warnings} warning(s) — ${path.relative(process.cwd(), root) || "."}`); return 1; }
  const c = loaded.content!;
  console.log(`OK validate: ${c.project.id} — maps ${Object.keys(c.maps).length}, dialogues ${Object.keys(c.dialogues).length}, events ${Object.keys(c.events).length}, enemies ${c.database.enemies.length}, assets ${c.assets.assets.length}, ${warnings} warning(s)`);
  return 0;
}

async function cmdTest(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectDir(flags);
  const loaded = await loadProjectFromDisk(root);
  const { errors } = report(loaded.diagnostics);
  if (errors || !loaded.content) { console.log("FAILED test: validation errors"); return 1; }
  let systems: GameSystem[];
  try { systems = await loadSystems(root, loaded.content); } catch (error) { console.log(`ERROR ${String(error instanceof Error ? error.message : error)}`); console.log("FAILED test: system load"); return 1; }
  const results = await runProjectScenarios(root, loaded.content, systems);
  let failed = 0;
  for (const result of results) {
    if (result.ok) console.log(`PASS  ${result.file} — ${result.name} (${result.steps} steps)`);
    else { failed++; console.log(`ERROR ${result.file} › steps[${result.failedStep ?? "?"}]: ${result.message} — ${result.name}`); }
  }
  if (!results.length) console.log("WARN  tests/*.scenario.json がありません。自動プレイテストを追加すると変更の確認が楽になります");
  if (failed) { console.log(`FAILED test: ${failed}/${results.length} scenario(s)`); return 1; }
  console.log(`OK test: ${results.length} scenario(s) passed`);
  return 0;
}

async function cmdBuild(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectDir(flags);
  const result = await buildProject(root, { outDir: typeof flags.out === "string" ? path.resolve(flags.out) : undefined });
  const { errors } = report(result.diagnostics);
  if (!result.ok || errors) { console.log("FAILED build: 前回のビルド成果物はそのまま残っています"); return 1; }
  console.log(`OK build: ${path.relative(process.cwd(), result.outDir!)} (version ${result.version})`);
  console.log("   静的HTTPサーバーで配信して遊べます。例: pnpm rpg dev --project <dir>  または  npx serve <outDir>");
  return 0;
}

async function cmdMigrate(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectDir(flags);
  const { texts, formatVersion } = await readProjectTexts(root);
  if (formatVersion === null) { console.log("ERROR project.json を読めません"); return 1; }
  if (formatVersion === 2) { console.log("OK migrate: すでに最新形式(2)です。変更はありません"); return 0; }
  if (formatVersion !== 1) { console.log(`ERROR formatVersion=${formatVersion} からの移行手順はありません。元ファイルは変更していません`); return 1; }
  const result = migrateProjectV1toV2(texts);
  for (const [file, text] of Object.entries(result.files)) {
    const before = texts[file];
    console.log(`${before === undefined ? "+ 新規" : before === text ? "  同一" : "~ 変更"} ${file}`);
  }
  for (const step of result.manualSteps) console.log(`WARN  手作業: ${step}`);
  // Validate the result before anything is written.
  const { loadProjectContent } = await import("../../schema/src/index");
  const check = loadProjectContent({ ...texts, ...result.files });
  const errors = check.diagnostics.filter(d => d.severity === "error");
  if (errors.length) { report(errors); console.log("FAILED migrate: 移行結果が新形式の検証を通りません。何も書き込んでいません"); return 1; }
  if (!flags.write) { console.log("DRY-RUN migrate: 書き込むには --write を付けて再実行してください（元ファイルは .rpg-backup/ に保存されます）"); return 0; }
  const backup = path.join(root, ".rpg-backup", `v1-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const written: string[] = [];
  try {
    for (const file of Object.keys(texts)) {
      const target = path.join(backup, ...file.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, texts[file]!);
    }
    for (const [file, text] of Object.entries(result.files)) {
      const target = resolveInside(root, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(`${target}.migrating`, text);
      written.push(file);
    }
    for (const file of written) { const target = resolveInside(root, file); await fs.rename(`${target}.migrating`, target); }
  } catch (error) {
    // Roll back: restore originals and remove partial files.
    for (const file of written) { const target = resolveInside(root, file); await fs.rm(`${target}.migrating`, { force: true }); if (texts[file] !== undefined) await fs.writeFile(target, texts[file]!); }
    console.log(`ERROR 移行中に失敗したため元に戻しました: ${String(error)}`);
    return 1;
  }
  console.log(`OK migrate: v1 → v2 (バックアップ: ${path.relative(process.cwd(), backup)})`);
  return 0;
}

async function cmdDev(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectDir(flags);
  const port = Number(flags.port ?? 4174);
  let outDir = "";
  let version = "";
  let building = false, pending = false;
  const rebuild = async () => {
    if (building) { pending = true; return; }
    building = true;
    const result = await buildProject(root, { minify: false });
    report(result.diagnostics.filter(d => d.severity === "error"));
    if (result.ok) { outDir = result.outDir!; version = result.version!; console.log(`OK build ${version} ${new Date().toLocaleTimeString()}`); }
    else console.log("FAILED build: 直前の正常版を配信し続けます");
    building = false;
    if (pending) { pending = false; await rebuild(); }
  };
  await rebuild();
  if (!outDir) return 1;
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/__version") { res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" }); res.end(version); return; }
    const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname).slice(1);
    if (rel.split("/").some(part => part === ".." || part.startsWith("."))) { res.writeHead(404); res.end(); return; }
    try {
      let body: Buffer | string = await fs.readFile(path.join(outDir, ...rel.split("/")));
      if (rel === "index.html") body = body.toString("utf8").replace("</body>", `<script type="module" src="./__reload.js"></script></body>`);
      res.writeHead(200, { "content-type": types[path.extname(rel)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      if (rel === "__reload.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(`let v=${JSON.stringify(version)};setInterval(async()=>{try{const n=await (await fetch('/__version')).text();if(n&&n!==v)location.reload()}catch{}},1000);`);
        return;
      }
      res.writeHead(404); res.end();
    }
  });
  server.listen(port, "127.0.0.1", () => console.log(`dev: http://127.0.0.1:${port}/ （保存すると自動で再ビルド・再読込）`));
  const { watch } = await import("chokidar");
  const watcher = watch([root, path.join(REPO_ROOT, "packages/engine/src"), path.join(REPO_ROOT, "packages/runtime/src"), path.join(REPO_ROOT, "packages/schema/src")], {
    ignoreInitial: true, ignored: (p: string) => /(^|[\\/])(\.rpg-backup|node_modules|\.git)([\\/]|$)/.test(p) || p.endsWith(".test.ts"),
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
  });
  let timer: NodeJS.Timeout | undefined;
  watcher.on("all", () => { clearTimeout(timer); timer = setTimeout(() => void rebuild(), 200); });
  await new Promise<void>(resolve => { process.once("SIGINT", () => { void watcher.close(); server.close(); resolve(); }); });
  return 0;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try { parsed = parseArgs(argv); } catch (error) { console.error(String(error)); console.error(USAGE); return 2; }
  switch (parsed.command) {
    case "validate": return cmdValidate(parsed.flags);
    case "test": return cmdTest(parsed.flags);
    case "build": return cmdBuild(parsed.flags);
    case "dev": return cmdDev(parsed.flags);
    case "migrate": return cmdMigrate(parsed.flags);
    default: console.log(USAGE); return parsed.command && parsed.command !== "help" && parsed.command !== "--help" ? 2 : 0;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, error => { console.error(`ERROR ${error instanceof Error ? error.stack : String(error)}`); process.exitCode = 1; });
}

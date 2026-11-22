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
import { auditProject, catalog, jsonSchemas } from "./catalog";
import { cmdArt, cmdAsset } from "./assets";
import { loadProjectFromDisk, readProjectTexts, resolveInside } from "./load";
import { newProject, type ProjectTheme } from "./scaffold";
import { cmdMod } from "./mods";
import { cmdPacks } from "./packs";
import { cmdLibrary } from "./library";
import { genreAtlasMarkdown, GENRES, LEVEL_LABEL, searchGenres } from "../../modules/src/genres";

const USAGE = `RPG Studio CLI

  rpg new      <id> [--title <名前>] [--theme default|fantasy|mystery|scifi|minimal] [--dir projects]  新しいプロジェクトを作る
  rpg genres   [--query <言葉>] [--write]  ジャンル地図（どのジャンルをどう作るか）。--write で docs/genre-atlas.md を更新
  rpg mod      <list|add|export> [<id>] --project <dir>  作り手の仕組み（mod）を共有: 一覧・取り込み・書き出し（出どころは mods.json）
  rpg validate --project <dir>          形式・参照・素材を検証
  rpg test     --project <dir>          検証 + システム読込 + tests/*.scenario.json の自動プレイ
  rpg build    --project <dir> [--out <dir>] [--zip]  型検査・bundleして dist/game/<id>/ に静的ゲームを出力（--zipで公開用ZIPも作成）
  rpg audit    --project <dir>          未到達マップ・未使用会話・未使用イベントを検出
  rpg dev      --project <dir> [--port 4174]  ビルドして127.0.0.1で配信、変更で自動再ビルド
  rpg migrate  --project <dir> [--write]      旧形式を移行（既定は差分表示のみ。--writeでバックアップ後に保存）
  rpg catalog  --project <dir>          定義済みのID・フラグ・変数・特性・ルールの一覧（Markdown）
  rpg schema   [--check]                schema/*.schema.json（エディター・AI向けJSON Schema）を生成／最新か確認
  rpg asset    <sources|enable|disable|add|gen-sfx|report|credits> --project <dir>   素材の取得元・追加・生成・容量・クレジット
  rpg art      <list|prompt|check> --project <dir>                                   画像の要件定義（art/requests.json）から生成用プロンプト・納品チェック
  rpg art      generate [--out library] [--only tiles,characters,monsters,backgrounds] [--no-previews]   内蔵ジェネレーターで共有素材ライブラリを（再）生成
  rpg library  <list|add|preview> [<id...>] [--kind …] [--query …] --project <dir>  共有素材ライブラリを探す・番号つき見本画像・取り込む（タイル定義も追加）
  rpg packs    <list|add|files|use|remove>                                     買った・DLした素材パックをこのPCの台帳でまとめて管理（パスワードは保存しない）
  rpg asset find --kind <bgm|sfx|image…> --words "<言葉>"                        AIが会話で候補を出す用（内蔵素材・取得元の検索URL・条件）
`;

const SUBCOMMANDS = new Set(["new", "genres", "mod", "asset", "art", "library", "packs", "help", "--help"]);

function parseArgs(argv: string[]) {
  const [command, ...afterCommand] = argv;
  const takesSub = command !== undefined && SUBCOMMANDS.has(command);
  const sub = takesSub && afterCommand[0] && !afterCommand[0].startsWith("--") ? afterCommand[0] : undefined;
  const rest = sub ? afterCommand.slice(1) : afterCommand;
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--") continue;
    if (!arg.startsWith("--")) {
      if (!takesSub) throw new Error(`不明な引数: ${arg}（プロジェクトは --project <dir> で指定してください）`);
      if ((positional.length && command !== "library") || !sub) throw new Error(`不明な引数: ${arg}`);
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags[key] = next; i++; } else flags[key] = true;
  }
  return { command, sub, flags, arg: positional[0], args: positional };
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
  for (const id of content.scripts ?? []) {
    const file = `scripts/${id}.ts`;
    let module: { default?: object };
    try { module = await importSystemModule(resolveInside(root, file)) as { default?: object }; }
    catch (error) { throw new Error(`${file}: 読み込めません: ${String(error)}`); }
    if (!module.default || typeof module.default !== "object") throw new Error(`${file}: default export に defineScript({...}) を書いてください`);
    systems.push({ ...module.default, id, scope: "attached" } as GameSystem);
  }
  const { withModules } = await import("../../modules/src/index");
  return withModules(content, systems);
}

/** Finds every {"custom"}, {"fn"}, startScene and system-action reference in the data and checks the loaded systems define it. */
export function systemRefDiagnostics(texts: Record<string, string>, systems: GameSystem[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const byId = new Map(systems.map(s => [s.id, s]));
  const split = (ref: string) => [ref.slice(0, ref.lastIndexOf(".")), ref.slice(ref.lastIndexOf(".") + 1)] as const;
  const visit = (file: string, node: unknown, at: string) => {
    if (Array.isArray(node)) { node.forEach((child, i) => visit(file, child, `${at}[${i}]`)); return; }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o.custom === "string") { const [id, name] = split(o.custom); if (!byId.get(id)?.conditions?.[name]) out.push({ severity: "error", file, at, message: `条件 '${o.custom}' が ${id} の conditions にありません` }); }
    if (typeof o.fn === "string") { const [id, name] = split(o.fn); if (!byId.get(id)?.functions?.[name]) out.push({ severity: "error", file, at, message: `関数 '${o.fn}' が ${id} の functions にありません` }); }
    if (o.type === "startScene" && typeof o.system === "string" && typeof o.scene === "string" && !byId.get(o.system)?.scenes?.[o.scene]) out.push({ severity: "error", file, at, message: `画面 '${o.system}.${o.scene}' が scenes にありません` });
    if (o.type === "system" && typeof o.system === "string" && typeof o.action === "string" && !byId.get(o.system)?.actions?.[o.action]) out.push({ severity: "error", file, at, message: `アクション '${o.system}.${o.action}' が actions にありません` });
    for (const [key, child] of Object.entries(o)) visit(file, child, at ? `${at}.${key}` : key);
  };
  for (const [file, text] of Object.entries(texts)) {
    if (!file.endsWith(".json")) continue;
    try { visit(file, JSON.parse(text), ""); } catch { /* reported by validate */ }
  }
  return out;
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
  const refErrors = systemRefDiagnostics(loaded.texts, systems);
  report(refErrors);
  const results = await runProjectScenarios(root, loaded.content, systems);
  let failed = refErrors.length;
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
  const result = await buildProject(root, { outDir: typeof flags.out === "string" ? path.resolve(flags.out) : undefined, zip: Boolean(flags.zip) });
  const { errors } = report(result.diagnostics);
  if (!result.ok || errors) { console.log("FAILED build: 前回のビルド成果物はそのまま残っています"); return 1; }
  const kb = (b: number) => `${(b / 1024).toFixed(1)}KB`;
  const s = result.sizeSummary;
  console.log(`OK build: ${path.relative(process.cwd(), result.outDir!)} (version ${result.version})${s ? ` — 合計 ${kb(s.totalBytes)}（game.js ${kb(s.jsBytes)} / JSON ${kb(s.dataBytes)} / 素材 ${kb(s.assetBytes)}）` : ""}`);
  if (result.zipPath) console.log(`OK zip: ${path.relative(process.cwd(), result.zipPath)}`);
  console.log("   静的HTTPサーバーで配信して遊べます。例: pnpm rpg dev --project <dir>  または  npx serve <outDir>");
  return 0;
}

async function cmdAudit(flags: Record<string, string | boolean>): Promise<number> {
  const loaded = await loadProjectFromDisk(projectDir(flags));
  if (!loaded.content) { report(loaded.diagnostics); console.log("FAILED audit: 先に validate のエラーを直してください"); return 1; }
  const a = auditProject(loaded.content);
  if (!a.unreachableMaps.length && !a.unusedDialogues.length && !a.unusedEvents.length) {
    console.log("OK audit: 未到達マップ・未使用会話・未使用イベントはありません");
    return 0;
  }
  if (a.unreachableMaps.length) console.log(`WARN  未到達マップ: ${a.unreachableMaps.join(", ")}`);
  if (a.unusedDialogues.length) console.log(`WARN  未使用会話: ${a.unusedDialogues.join(", ")}`);
  if (a.unusedEvents.length) console.log(`WARN  未使用イベント: ${a.unusedEvents.join(", ")}`);
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
    if (!rel || rel.includes("\\") || rel.includes("\0") || rel.split("/").some(part => !part || part === "." || part === ".." || part.startsWith("."))) { res.writeHead(404); res.end(); return; }
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

async function cmdCatalog(flags: Record<string, string | boolean>): Promise<number> {
  const loaded = await loadProjectFromDisk(projectDir(flags));
  if (!loaded.content) { report(loaded.diagnostics); console.log("FAILED catalog: 先に validate のエラーを直してください"); return 1; }
  process.stdout.write(catalog(loaded.content));
  return 0;
}

async function cmdSchema(flags: Record<string, string | boolean>): Promise<number> {
  const dir = path.join(REPO_ROOT, "schema");
  let stale = 0;
  for (const [name, schema] of Object.entries(jsonSchemas())) {
    const text = `${JSON.stringify(schema, null, 2)}\n`;
    const file = path.join(dir, name);
    const current = await fs.readFile(file, "utf8").catch(() => "");
    if (current === text) continue;
    stale++;
    if (flags.check) console.log(`ERROR schema/${name} が古くなっています。pnpm rpg schema で再生成してください`);
    else { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(file, text); console.log(`wrote schema/${name}`); }
  }
  if (flags.check && stale) return 1;
  console.log(`OK schema: ${flags.check ? "最新です" : `${stale}件更新`}`);
  return 0;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try { parsed = parseArgs(argv); } catch (error) { console.error(String(error)); console.error(USAGE); return 2; }
  switch (parsed.command) {
    case "new": {
      if (!parsed.sub) { console.error("ERROR rpg new <id> の形で、プロジェクトIDを指定してください"); return 2; }
      try {
        const theme = (typeof parsed.flags.theme === "string" ? parsed.flags.theme : "default") as ProjectTheme;
        if (!["default", "fantasy", "mystery", "scifi", "minimal"].includes(theme)) { console.error("ERROR --theme は default|fantasy|mystery|scifi|minimal から選んでください"); return 2; }
        const dir = await newProject(parsed.sub, typeof parsed.flags.title === "string" ? parsed.flags.title : parsed.sub, typeof parsed.flags.dir === "string" ? path.resolve(process.cwd(), parsed.flags.dir) : undefined, theme);
        const rel = path.relative(process.cwd(), dir);
        console.log(`OK new: ${rel}\n次に ${rel}/IDEA.md に発想を書き、AIに「IDEA.md の発想を形にして」と頼んでください。\n  pnpm rpg test --project ${rel}`);
        return 0;
      } catch (error) { console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`); return 1; }
    }
    case "genres": {
      if (parsed.flags.write) { await fs.writeFile(path.join(REPO_ROOT, "docs", "genre-atlas.md"), genreAtlasMarkdown()); console.log(`OK genres: docs/genre-atlas.md（${GENRES.length}ジャンル）`); return 0; }
      const query = typeof parsed.flags.query === "string" ? parsed.flags.query : parsed.sub;
      const list = query ? searchGenres(query) : GENRES;
      for (const g of list) console.log(`${g.family} / ${g.name} [${g.id}] — ${LEVEL_LABEL[g.level]}${g.modules.length ? `（${g.modules.join(", ")}）` : ""}\n    ${g.recipe}`);
      console.log(`${list.length}件${query ? `（"${query}"）` : ""}。詳しくは docs/genre-atlas.md と docs/genre-modules.md`);
      return 0;
    }
    case "mod": return cmdMod(parsed.sub, projectDir(parsed.flags), parsed.flags, parsed.arg);
    case "validate": return cmdValidate(parsed.flags);
    case "test": return cmdTest(parsed.flags);
    case "build": return cmdBuild(parsed.flags);
    case "dev": return cmdDev(parsed.flags);
    case "migrate": return cmdMigrate(parsed.flags);
    case "catalog": return cmdCatalog(parsed.flags);
    case "audit": return cmdAudit(parsed.flags);
    case "schema": return cmdSchema(parsed.flags);
    case "asset": return cmdAsset(parsed.sub, projectDir(parsed.flags), parsed.flags);
    case "art": {
      if (parsed.sub !== "generate") return cmdArt(parsed.sub, projectDir(parsed.flags), parsed.flags);
      const { generateLibrary } = await import("./artgen/library");
      const out = typeof parsed.flags.out === "string" ? path.resolve(process.cwd(), parsed.flags.out) : path.join(REPO_ROOT, "library");
      const kinds = ["tiles", "characters", "monsters", "backgrounds"] as const;
      const only = typeof parsed.flags.only === "string" ? parsed.flags.only.split(",").map(s => s.trim()) : [];
      const bad = only.filter(k => !(kinds as readonly string[]).includes(k));
      if (bad.length) { console.log(`ERROR --only は ${kinds.join(",")} から選んでください: ${bad.join(",")}`); return 2; }
      await generateLibrary(out, { only: only as Array<(typeof kinds)[number]>, previews: !parsed.flags["no-previews"], log: line => console.log(line) });
      return 0;
    }
    case "library": return cmdLibrary(parsed.sub, parsed.flags, parsed.args, () => projectDir(parsed.flags));
    case "packs": return cmdPacks(parsed.sub, parsed.flags, parsed.args, () => projectDir(parsed.flags));
    default: {
      if (parsed.command && parsed.command !== "help" && parsed.command !== "--help") {
        const cmds = ["new", "genres", "mod", "validate", "test", "build", "dev", "migrate", "catalog", "audit", "schema", "asset", "art", "library", "packs"];
        const dist = (a: string, b: string) => {
          const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
          for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
          for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
            dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
          }
          return dp[a.length]![b.length]!;
        };
        const near = cmds.map(c => ({ c, d: dist(parsed.command!, c) })).sort((x, y) => x.d - y.d)[0];
        if (near && near.d <= 3) console.error(`不明なコマンド "${parsed.command}" です。もしかして: pnpm rpg ${near.c}`);
      }
      console.log(USAGE);
      return parsed.command && parsed.command !== "help" && parsed.command !== "--help" ? 2 : 0;
    }
  }
}

const sameEntry = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && sameEntry(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  main().then(code => { process.exitCode = code; }, error => { console.error(`ERROR ${error instanceof Error ? error.stack : String(error)}`); process.exitCode = 1; });
}

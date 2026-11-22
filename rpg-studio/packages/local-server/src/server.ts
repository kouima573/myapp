/**
 * Local studio service. Binds to 127.0.0.1 only and exposes a fixed set of operations on ONE project folder.
 * There is deliberately no endpoint that runs commands, scripts or arbitrary paths.
 *
 * Security layers (each request): Host allow-list → Origin check (no CORS) → per-launch token header →
 * normalized project-relative path → extension allow-list → no symlink in any path component → size limit.
 */
import crypto from "node:crypto";
import { constants as FS } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { formatDiagnostic, SCRIPT_PATH } from "../../schema/src/index";
import { buildProject, REPO_ROOT } from "../../cli/src/build";
import { loadSystems, runProjectScenarios, systemRefDiagnostics } from "../../cli/src/index";
import { loadProjectFromDisk, readProjectTexts } from "../../cli/src/load";
import { add as libraryAdd, DEFAULT_LIBRARY, loadLibrary } from "../../cli/src/library";
import { History } from "./history";
import {
  LOCAL_TOKEN_HEADER, LOCAL_TOKEN_META,
  type BuildStatus, type ChangeEvent, type ProjectSnapshot, type ImageSaveRequest, type SaveRequest, type TestResponse,
} from "./protocol";

const TEXT_EXT = new Set([".json", ".ts", ".md"]);
const BINARY_EXT: Record<string, string> = { ".png": "image/png", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
const MAX_TEXT = 4 * 1024 * 1024;
const MAX_BINARY = 20 * 1024 * 1024;
const MAX_IMAGE = 3 * 1024 * 1024;
const IMAGE_PATH = /^assets\/[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_.-]*\.png$/i;
const IGNORED = /(^|\/)(\.git|node_modules|dist|\.rpg-backup|\.rpg-studio)(\/|$)/;

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface ServerOptions {
  projectDir: string;
  port: number;
  /** Directory with the built studio UI (index.html etc). */
  uiDir?: string;
  /** Inject a fixed token (tests). Default: random per launch. */
  token?: string;
  watch?: boolean;
  /** Build on start (default true). */
  buildOnStart?: boolean;
  /** Where save history is kept (default <repo>/.rpg-studio/history/<project>-<hash>). null = off. */
  historyDir?: string | null;
}

export interface RunningServer {
  url: string;
  token: string;
  server: http.Server;
  close(): Promise<void>;
  /** Resolves when the build queue is idle (tests). */
  idle(): Promise<void>;
}

const sha256 = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");

export function isSafeRelative(relative: string): boolean {
  return typeof relative === "string" && relative.length > 0 && relative.length < 300 && !relative.includes("\\") && !relative.includes("\0")
    && !relative.startsWith("/") && !/^[a-z]:/i.test(relative)
    && relative.split("/").every(part => part !== "" && part !== "." && part !== ".." && !part.startsWith("."));
}

/** Resolves a project-relative path, refusing escapes and any symlink / junction on the way. */
export async function securePath(root: string, relative: string, opts: { allowMissing?: boolean } = {}): Promise<string> {
  if (!isSafeRelative(relative)) throw new HttpError(400, "プロジェクト相対の正規化済みパスを指定してください");
  const ext = path.extname(relative).toLowerCase();
  if (!TEXT_EXT.has(ext) && !BINARY_EXT[ext]) throw new HttpError(415, `拡張子 ${ext || "(なし)"} は扱えません`);
  const realRoot = await fs.realpath(root);
  let current = realRoot;
  const parts = relative.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]!);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new HttpError(403, `シンボリックリンク／ジャンクションは拒否します: ${relative}`);
      if (i < parts.length - 1 && !stat.isDirectory()) throw new HttpError(400, "パスの途中がディレクトリではありません");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && opts.allowMissing) break;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, `ファイルがありません: ${relative}`);
      throw error;
    }
  }
  const target = path.join(realRoot, ...parts);
  const rel = path.relative(realRoot, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new HttpError(403, "プロジェクト外へのアクセスは拒否します");
  return target;
}

async function readNoFollow(file: string, limit: number): Promise<Buffer> {
  const noFollow = process.platform === "win32" ? 0 : FS.O_NOFOLLOW;
  const handle = await fs.open(file, FS.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new HttpError(400, "通常ファイルではありません");
    if (stat.size > limit) throw new HttpError(413, "ファイルが大きすぎます");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const root = await fs.realpath(path.resolve(options.projectDir));
  const token = options.token ?? crypto.randomBytes(32).toString("base64url");
  const allowedHosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${options.port}`, `http://localhost:${options.port}`]);
  const uiDir = options.uiDir ?? path.join(REPO_ROOT, "dist/studio");

  /* ------------------------------------------------------------ change feed */
  const changes: ChangeEvent[] = [];
  let seq = 0;
  const pushChange = (relative: string, kind: ChangeEvent["kind"], hash?: string, summary?: string[]) => {
    changes.push({ seq: ++seq, path: relative, kind, ...(hash ? { hash } : {}), ...(summary ? { summary } : {}) });
    if (changes.length > 500) changes.splice(0, changes.length - 500);
  };

  /* ------------------------------------------------------------ save history */
  const history = options.historyDir === null ? undefined
    : new History(options.historyDir ?? path.join(REPO_ROOT, ".rpg-studio", "history", `${path.basename(root)}-${crypto.createHash("sha256").update(root).digest("hex").slice(0, 8)}`));
  /** Last known text of every project text file, so a change from outside can be kept and summarised. */
  const known = new Map<string, string>();
  const isText = (relative: string) => TEXT_EXT.has(path.extname(relative).toLowerCase());
  const readText = async (relative: string) => { try { return (await readNoFollow(await securePath(root, relative), MAX_TEXT)).toString("utf8"); } catch { return undefined; } };

  /* ------------------------------------------------------------ build queue */
  let build: BuildStatus = { state: "idle", version: null, diagnostics: [], stale: false, finishedAt: null };
  let systemsBundle = "";
  let revision = 0;
  let queue: Promise<void> = Promise.resolve();
  let scheduled: NodeJS.Timeout | undefined;
  const requestBuild = () => {
    clearTimeout(scheduled);
    scheduled = setTimeout(() => { queue = queue.then(runBuild, runBuild); }, 150);
  };
  async function runBuild(): Promise<void> {
    const startedAt = revision;
    build = { ...build, state: "building", stale: build.version !== null };
    const result = await buildProject(root).catch(error => ({ ok: false as const, diagnostics: [{ severity: "error" as const, message: String(error) }] }));
    if (revision !== startedAt) { requestBuild(); return; } // inputs changed mid-build: discard and retry
    if (result.ok && "version" in result) {
      systemsBundle = result.systemsBundle ?? "";
      build = { state: "ready", version: result.version!, diagnostics: result.diagnostics.map(formatDiagnostic), stale: false, finishedAt: new Date().toISOString() };
    } else {
      build = { state: "error", version: build.version, diagnostics: result.diagnostics.filter(d => d.severity === "error").map(formatDiagnostic), stale: build.version !== null, finishedAt: new Date().toISOString() };
    }
  }

  /* ------------------------------------------------------------ watcher */
  let watcher: FSWatcher | undefined;
  if (options.watch !== false) {
    const sources = ["engine", "runtime", "schema"].map(name => path.join(REPO_ROOT, "packages", name, "src"));
    watcher = watch([root, ...sources], {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (p: string) => IGNORED.test(p.split(path.sep).join("/")) || /\.tmp$/.test(p),
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    });
    watcher.on("all", async (event, file) => {
      if (!["add", "change", "unlink"].includes(event)) return;
      revision++;
      const inProject = path.relative(root, file);
      if (!inProject.startsWith("..") && !path.isAbsolute(inProject)) {
        const relative = inProject.split(path.sep).join("/");
        let hash: string | undefined;
        let summary: string[] | undefined;
        if (event !== "unlink") { try { hash = sha256(await readNoFollow(await securePath(root, relative), MAX_BINARY)); } catch { /* not a served file */ } }
        if (isText(relative)) {
          const after = event === "unlink" ? undefined : await readText(relative);
          const before = known.get(relative);
          if (after !== before) {
            const entry = await history?.record(relative, before, after, "outside").catch(() => undefined);
            summary = entry?.summary;
            if (after === undefined) known.delete(relative); else known.set(relative, after);
          }
        }
        pushChange(relative, event as ChangeEvent["kind"], hash, summary);
      } else {
        pushChange(`engine:${path.relative(REPO_ROOT, file).split(path.sep).join("/")}`, event as ChangeEvent["kind"]);
      }
      requestBuild();
    });
  }

  /* ------------------------------------------------------------ handlers */
  const writeLocks = new Map<string, Promise<unknown>>();
  async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = writeLocks.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    writeLocks.set(key, next.catch(() => undefined));
    return next;
  }

  async function snapshot(): Promise<ProjectSnapshot> {
    const { texts } = await readProjectTexts(root);
    // Also expose scenario tests so the studio can list them.
    try {
      for (const name of await fs.readdir(path.join(root, "tests"))) {
        if (name.endsWith(".scenario.json")) texts[`tests/${name}`] = (await readNoFollow(await securePath(root, `tests/${name}`), MAX_TEXT)).toString("utf8");
      }
    } catch { /* no tests folder */ }
    const hashes: Record<string, string> = {};
    for (const [file, text] of Object.entries(texts)) hashes[file] = sha256(Buffer.from(text, "utf8"));
    return { projectDir: path.relative(REPO_ROOT, root).split(path.sep).join("/") || root, texts, hashes, repoRoot: REPO_ROOT };
  }

  async function save(body: SaveRequest, source: "studio" | "restore" = "studio") {
    if (!body || typeof body.path !== "string" || typeof body.content !== "string" || typeof body.expectedHash !== "string") throw new HttpError(400, "{path, content, expectedHash} が必要です");
    const ext = path.extname(body.path).toLowerCase();
    if (!TEXT_EXT.has(ext)) throw new HttpError(415, "工房から保存できるのはテキスト(.json/.ts/.md)のみです");
    if (Buffer.byteLength(body.content, "utf8") > MAX_TEXT) throw new HttpError(413, "内容が大きすぎます");
    if (ext === ".json") { try { JSON.parse(body.content); } catch { throw new HttpError(422, "JSONとして正しくない内容は保存しません"); } }
    // expectedHash "" = create a new file (only inside an existing folder, never over an existing file).
    const creating = body.expectedHash === "";
    const target = await securePath(root, body.path, { allowMissing: creating });
    if (creating) {
      // The scripts/ folder (code attached to data) may be created on demand, one level directly under the project.
      if (SCRIPT_PATH.test(body.path)) await fs.mkdir(path.join(await fs.realpath(root), "scripts")).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
      const parent = await fs.lstat(path.dirname(target)).catch(() => null);
      if (!parent?.isDirectory() || parent.isSymbolicLink()) throw new HttpError(400, "新しいファイルは既存のフォルダの中にだけ作れます");
    }
    return withLock(target, async () => {
      if (creating) {
        const exists = await fs.lstat(target).then(() => true, () => false);
        if (exists) {
          const current = await readNoFollow(await securePath(root, body.path), MAX_TEXT);
          return { status: 409, json: { error: "conflict", path: body.path, latestContent: current.toString("utf8"), latestHash: sha256(current) } };
        }
        const bytes = Buffer.from(body.content, "utf8");
        const handle = await fs.open(target, "wx", 0o644);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        const hash = sha256(bytes);
        known.set(body.path, body.content);
        await history?.record(body.path, undefined, body.content, source).catch(() => undefined);
        revision++;
        pushChange(body.path, "add", hash);
        requestBuild();
        return { status: 200, json: { path: body.path, hash } };
      }
      const current = await readNoFollow(await securePath(root, body.path), MAX_TEXT);
      const currentHash = sha256(current);
      if (currentHash !== body.expectedHash) return { status: 409, json: { error: "conflict", path: body.path, latestContent: current.toString("utf8"), latestHash: currentHash } };
      const temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
      const bytes = Buffer.from(body.content, "utf8");
      try {
        const handle = await fs.open(temp, "wx", 0o644);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await securePath(root, body.path); // re-check right before replacing
        await fs.rename(temp, target);
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => {});
        throw error;
      }
      const hash = sha256(bytes);
      known.set(body.path, body.content);
      await history?.record(body.path, current.toString("utf8"), body.content, source).catch(() => undefined);
      revision++;
      pushChange(body.path, "change", hash);
      requestBuild();
      return { status: 200, json: { path: body.path, hash } };
    });
  }

  /** PNG from the studio's pixel editor: assets/<folder>/<name>.png only, real PNG, bounded size, atomic replace. */
  async function saveImage(body: ImageSaveRequest) {
    if (!body || typeof body.path !== "string" || typeof body.base64 !== "string" || typeof body.expectedHash !== "string") throw new HttpError(400, "{path, base64, expectedHash} が必要です");
    if (!IMAGE_PATH.test(body.path)) throw new HttpError(400, "画像は assets/<フォルダ>/<名前>.png にだけ保存できます");
    const bytes = Buffer.from(body.base64, "base64");
    if (bytes.length > MAX_IMAGE) throw new HttpError(413, "画像が大きすぎます（3MBまで）");
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.subarray(12, 16).toString("latin1") !== "IHDR") throw new HttpError(422, "PNG画像ではありません");
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width > 4096 || height > 4096) throw new HttpError(422, "画像の大きさは4096×4096までです");
    const creating = body.expectedHash === "";
    if (creating) {
      const folder = path.join(await fs.realpath(root), ...body.path.split("/").slice(0, 2));
      await fs.mkdir(folder).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    }
    const target = await securePath(root, body.path, { allowMissing: creating });
    return withLock(target, async () => {
      if (creating) {
        const handle = await fs.open(target, "wx", 0o644).catch((error: NodeJS.ErrnoException) => { if (error.code === "EEXIST") throw new HttpError(409, "同じ名前の画像があります"); throw error; });
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      } else {
        const currentHash = sha256(await readNoFollow(await securePath(root, body.path), MAX_BINARY));
        if (currentHash !== body.expectedHash) return { status: 409, json: { error: "conflict", path: body.path, latestHash: currentHash } };
        const temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
        try {
          const handle = await fs.open(temp, "wx", 0o644);
          try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
          await securePath(root, body.path);
          await fs.rename(temp, target);
        } catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
      }
      const hash = sha256(bytes);
      revision++;
      pushChange(body.path, creating ? "add" : "change", hash);
      requestBuild();
      return { status: 200, json: { path: body.path, hash, bytes: bytes.length } };
    });
  }

  async function runTests(): Promise<TestResponse> {
    const loaded = await loadProjectFromDisk(root);
    const diagnostics = loaded.diagnostics.map(formatDiagnostic);
    if (!loaded.content) return { ok: false, results: [], diagnostics };
    try {
      const systems = await loadSystems(root, loaded.content);
      const refs = systemRefDiagnostics(loaded.texts, systems).map(formatDiagnostic);
      const results = (await runProjectScenarios(root, loaded.content, systems)).map(({ state: _state, ...report }) => report);
      return { ok: results.every(r => r.ok) && !refs.length, results, diagnostics: [...diagnostics, ...refs] };
    } catch (error) {
      return { ok: false, results: [], diagnostics: [...diagnostics, `ERROR ${error instanceof Error ? error.message : String(error)}`] };
    }
  }

  async function serveUi(pathname: string, res: http.ServerResponse) {
    const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    if (!isSafeRelative(relative)) throw new HttpError(404, "not found");
    const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
    let file = path.join(uiDir, ...relative.split("/"));
    let body: Buffer;
    try {
      const real = await fs.realpath(file);
      if (path.relative(await fs.realpath(uiDir), real).startsWith("..")) throw new HttpError(403, "forbidden");
      body = await fs.readFile(real);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (path.extname(relative)) throw new HttpError(404, "not found");
      file = path.join(uiDir, "index.html");
      try { body = await fs.readFile(file); } catch { throw new HttpError(503, "工房UIがビルドされていません。`pnpm studio` で起動してください"); }
    }
    if (file.endsWith(".html")) {
      const meta = `<meta name="${LOCAL_TOKEN_META}" content="${token}">`;
      body = Buffer.from(body.toString("utf8").replace(/<head>/i, `<head>\n    ${meta}`));
    }
    res.writeHead(200, {
      "content-type": types[path.extname(file)] ?? "application/octet-stream",
      "cache-control": file.endsWith(".html") ? "no-store" : "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'",
    });
    res.end(body);
  }

  async function readBody(req: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_TEXT + 4096) throw new HttpError(413, "リクエストが大きすぎます");
      chunks.push(chunk as Buffer);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "JSON本文が必要です"); }
  }

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    try {
      const host = (req.headers.host ?? "").toLowerCase();
      if (!allowedHosts.has(host)) throw new HttpError(403, "Hostが許可されていません");
      const origin = req.headers.origin;
      if (origin !== undefined && !allowedOrigins.has(origin)) throw new HttpError(403, "Originが一致しません");
      const rawUrl = req.url ?? "/";
      if (!rawUrl.startsWith("/") || rawUrl.startsWith("//")) throw new HttpError(400, "不正なリクエストURLです");
      const url = new URL(rawUrl, `http://${host}`);
      if (!url.pathname.startsWith("/api/")) {
        if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method not allowed");
        await serveUi(url.pathname, res);
        return;
      }
      if (req.headers[LOCAL_TOKEN_HEADER] !== token) throw new HttpError(401, "セッショントークンが必要です");
      const mutating = req.method !== "GET";
      if (mutating && origin === undefined) throw new HttpError(403, "更新系の操作にはOriginが必要です");
      if (mutating && !String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "application/json が必要です");

      const route = `${req.method} ${url.pathname}`;
      switch (route) {
        case "GET /api/project": return json(res, 200, await snapshot());
        case "GET /api/asset": {
          const relative = url.searchParams.get("path") ?? "";
          const ext = path.extname(relative).toLowerCase();
          if (!BINARY_EXT[ext]) throw new HttpError(415, "素材は画像・音声のみ取得できます");
          const bytes = await readNoFollow(await securePath(root, relative), MAX_BINARY);
          res.writeHead(200, { "content-type": BINARY_EXT[ext]!, "cache-control": "no-store", "x-content-type-options": "nosniff" });
          res.end(bytes);
          return;
        }
        case "GET /api/library": return json(res, 200, await loadLibrary());
        case "GET /api/library/image": {
          // Only files the catalogue lists (and their previews) — never arbitrary paths.
          const wanted = url.searchParams.get("path") ?? "";
          const catalog = await loadLibrary();
          if (!catalog.items.some(item => item.path === wanted)) throw new HttpError(404, "ライブラリにない画像です");
          const bytes = await fs.readFile(path.join(DEFAULT_LIBRARY, ...wanted.split("/")));
          res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=3600", "x-content-type-options": "nosniff" });
          res.end(bytes);
          return;
        }
        case "POST /api/library/add": {
          const body = await readBody(req) as { ids?: unknown; tiles?: unknown };
          const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string" && /^[a-z0-9][a-z0-9_-]*$/i.test(x)) : [];
          if (!ids.length || ids.length > 50) throw new HttpError(400, "ids（1〜50件）が必要です");
          const tiles = typeof body?.tiles === "string" ? body.tiles : Array.isArray(body?.tiles) ? body.tiles.filter((x): x is string => typeof x === "string").join(",") : undefined;
          const code = await libraryAdd(DEFAULT_LIBRARY, tiles ? { tiles } : {}, ids, root);
          return json(res, code === 0 ? 200 : 422, { ok: code === 0 });
        }
        case "PUT /api/image": {
          const result = await saveImage(await readBody(req) as ImageSaveRequest);
          return json(res, result.status, result.json);
        }
        case "PUT /api/file": {
          const result = await save(await readBody(req) as SaveRequest);
          return json(res, result.status, result.json);
        }
        case "GET /api/history": {
          if (!history) throw new HttpError(404, "履歴は無効です");
          const file = url.searchParams.get("file") ?? undefined;
          return json(res, 200, { entries: (await history.list(file)).slice(0, 200) });
        }
        case "GET /api/history/content": {
          if (!history) throw new HttpError(404, "履歴は無効です");
          const side = url.searchParams.get("side") === "after" ? "after" : "before";
          const found = await history.content(url.searchParams.get("id") ?? "", side);
          if (!found) throw new HttpError(404, "その履歴はありません");
          return json(res, 200, { entry: found.entry, text: found.text ?? null });
        }
        case "POST /api/history/restore": {
          if (!history) throw new HttpError(404, "履歴は無効です");
          const body = await readBody(req) as { id?: unknown; side?: unknown };
          const found = await history.content(typeof body?.id === "string" ? body.id : "", body?.side === "after" ? "after" : "before");
          if (!found) throw new HttpError(404, "その履歴はありません");
          if (found.text === undefined) throw new HttpError(422, "その時点ではファイルがありませんでした（削除は手作業で行ってください）");
          const current = await readText(found.entry.file);
          const result = await save({ path: found.entry.file, content: found.text, expectedHash: current === undefined ? "" : sha256(Buffer.from(current, "utf8")) }, "restore");
          return json(res, result.status, result.json);
        }
        case "GET /api/changes": {
          const after = Number(url.searchParams.get("after") ?? 0);
          if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400, "invalid cursor");
          return json(res, 200, { cursor: seq, changes: changes.filter(c => c.seq > after), build });
        }
        case "GET /api/build": return json(res, 200, build);
        case "POST /api/build": { revision++; requestBuild(); return json(res, 202, { ...build, state: "building" }); }
        case "GET /api/build/systems.js": {
          if (!systemsBundle) throw new HttpError(404, "まだ成功したビルドがありません");
          res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
          res.end(systemsBundle);
          return;
        }
        case "POST /api/test": return json(res, 200, await runTests());
        default: throw new HttpError(404, "unknown endpoint");
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      if (!res.headersSent) json(res, status, { error: error instanceof Error ? error.message : String(error) });
      else res.end();
    }
  });

  for (const [file, text] of Object.entries((await snapshot()).texts)) known.set(file, text);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolve());
  });
  if (options.buildOnStart !== false) { revision++; queue = queue.then(runBuild); }

  return {
    url: `http://127.0.0.1:${options.port}`,
    token,
    server,
    idle: async () => { await new Promise(r => setTimeout(r, 200)); await queue; },
    close: async () => {
      clearTimeout(scheduled);
      await watcher?.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections?.();
    },
  };
}

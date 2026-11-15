/**
 * `rpg library …`: browse the shared, generated asset library (library/library.json) and copy chosen
 * assets into a project. Registration goes through `rpg asset add` (same checks, provenance, budget);
 * tile sheets can also append their tile definitions to tiles.json (per-tile `atlas`, so existing
 * indices and codes are never touched).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { addAsset } from "./assets";
import { REPO_ROOT } from "./build";
import { ARTGEN_VERSION, LIBRARY_LICENSE, type LibraryCatalog, type LibraryItem } from "./artgen/library";

type Flags = Record<string, string | boolean>;
const str = (flags: Flags, key: string) => (typeof flags[key] === "string" ? (flags[key] as string) : undefined);

export const DEFAULT_LIBRARY = path.join(REPO_ROOT, "library");

export async function loadLibrary(dir = DEFAULT_LIBRARY): Promise<LibraryCatalog> {
  try { return JSON.parse(await fs.readFile(path.join(dir, "library.json"), "utf8")) as LibraryCatalog; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`${path.join(dir, "library.json")} がありません（pnpm rpg art generate で作れます）`);
    throw error;
  }
}

const KIND_ALIASES: Record<string, LibraryItem["kind"] | "tile"> = { tileset: "tileset", tilesets: "tileset", tiles: "tileset", tile: "tile", character: "character", characters: "character", chara: "character", enemy: "enemy", enemies: "enemy", monster: "enemy", monsters: "enemy", background: "background", backgrounds: "background", bg: "background" };

function matches(text: string, query: string) { const q = query.toLowerCase(); return text.toLowerCase().includes(q); }

/** Characters usable as one-character tile codes, in the order they are handed out. */
export function codePool(): string[] {
  const ascii: string[] = [];
  for (let c = 33; c < 127; c++) { const ch = String.fromCharCode(c); if (ch !== "\"" && ch !== "\\") ascii.push(ch); }
  const letters = ascii.filter(c => /[A-Za-z0-9]/.test(c)), symbols = ascii.filter(c => !/[A-Za-z0-9]/.test(c));
  const kana: string[] = [];
  for (let c = 0x3041; c <= 0x3093; c++) kana.push(String.fromCharCode(c)); // ぁ..ん
  for (let c = 0x30a1; c <= 0x30f3; c++) kana.push(String.fromCharCode(c)); // ァ..ン
  const greek: string[] = [];
  for (let c = 0x03b1; c <= 0x03c9; c++) if (c !== 0x03c2) greek.push(String.fromCharCode(c));
  const kanji: string[] = [];
  for (let c = 0x4e00; c < 0x4e00 + 2000; c++) kanji.push(String.fromCharCode(c));
  return [...letters, ...symbols, ...greek, ...kana, ...kanji];
}

export async function cmdLibrary(sub: string | undefined, flags: Flags, args: string[], projectRoot: () => string): Promise<number> {
  const dir = str(flags, "library") ? path.resolve(str(flags, "library")!) : DEFAULT_LIBRARY;
  if (sub === "list") return list(dir, flags);
  if (sub === "add") return add(dir, flags, args, projectRoot());
  console.log(`rpg library list [--kind tileset|tile|character|enemy|background] [--query <言葉>] [--json]
rpg library add <id...> --project <dir> [--tiles <key,key…>] [--no-tiles] [--replace]
  内蔵ジェネレーターで作った共有素材（library/library.json）を探して、プロジェクトに取り込みます。
  タイルシートを取り込むと、tiles.json にタイル定義（atlas 付き）を空いている1文字コードで追加します。
  再生成: pnpm rpg art generate [--out library]`);
  return sub ? 2 : 0;
}

async function list(dir: string, flags: Flags): Promise<number> {
  const catalog = await loadLibrary(dir);
  const kindFlag = str(flags, "kind");
  const kind = kindFlag ? KIND_ALIASES[kindFlag] : undefined;
  if (kindFlag && !kind) { console.log(`ERROR --kind は tileset / tile / character / enemy / background のどれかです`); return 2; }
  const query = str(flags, "query");
  const rows: string[] = [];
  const json: unknown[] = [];
  for (const item of catalog.items) {
    if (kind === "tile") {
      for (const tile of item.tiles ?? []) {
        if (query && !matches(`${item.id} ${tile.key} ${tile.name} ${tile.tags.join(" ")}`, query)) continue;
        rows.push(`${`${item.id}#${tile.key}`.padEnd(40)} ${tile.passable ? "通行可" : "通行不可"}  ${tile.name}  [${tile.tags.join(", ")}]`);
        json.push({ sheet: item.id, ...tile });
      }
      continue;
    }
    if (kind && item.kind !== kind) continue;
    const haystack = `${item.id} ${item.title} ${item.tags.join(" ")} ${(item.tiles ?? []).map(t => `${t.key} ${t.name}`).join(" ")}`;
    if (query && !matches(haystack, query)) continue;
    const extra = item.tiles ? `（タイル${item.tiles.length}種）` : "";
    rows.push(`${item.id.padEnd(28)} ${item.kind.padEnd(10)} ${item.title}${extra}  [${item.tags.join(", ")}]`);
    json.push(item);
  }
  if (flags.json) console.log(JSON.stringify(json, null, 2));
  else {
    console.log(`# 共有素材ライブラリ ${path.relative(process.cwd(), dir) || "."}（${catalog.license}）`);
    for (const row of rows) console.log(row);
    console.log(`${rows.length}件。取り込み: pnpm rpg library add <id...> --project <dir>　見本: library/previews/*.png`);
  }
  return 0;
}

async function add(dir: string, flags: Flags, ids: string[], root: string): Promise<number> {
  if (!ids.length) { console.log("ERROR 取り込む素材IDを指定してください（rpg library list で一覧）"); return 2; }
  const catalog = await loadLibrary(dir);
  const byId = new Map(catalog.items.map(item => [item.id, item]));
  const missing = ids.filter(id => !byId.has(id));
  if (missing.length) { console.log(`ERROR ライブラリにない素材ID: ${missing.join(", ")}`); return 1; }
  const project = JSON.parse(await fs.readFile(path.join(root, "project.json"), "utf8")) as { assetsPath: string; tilesetPath: string };
  const manifestFile = path.join(root, project.assetsPath);
  let failed = 0;
  for (const id of ids) {
    const item = byId.get(id)!;
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8")) as { assets: Array<{ id: string }> };
    const exists = manifest.assets.some(a => a.id === id);
    if (exists && !flags.replace) { console.log(`SKIP ${id}: 既に assets.json にあります（置き換えるなら --replace）`); }
    else {
      const code = await addAsset(root, {
        file: path.join(dir, item.path), id, kind: item.kind,
        tile: `${item.tileWidth}x${item.tileHeight}`, columns: String(item.columns), rows: String(item.rows),
        ...(item.frameDurationMs ? { "frame-ms": String(item.frameDurationMs) } : {}),
        origin: "generated", source: "builtin-art", license: LIBRARY_LICENSE,
        notes: `共有素材ライブラリ（library/）の「${item.title}」。内蔵ジェネレーターによるオリジナル生成物。`,
        ...(exists ? { replace: true } : {}),
      }, {
        generator: { tool: "rpg art generate", version: ARTGEN_VERSION, libraryId: id },
        ...(item.frameOrder ? { frameOrder: item.frameOrder } : {}),
        ...(item.loop !== undefined ? { loop: item.loop } : {}),
      });
      if (code !== 0) { failed++; continue; }
    }
    if (item.kind === "tileset" && item.tiles && !flags["no-tiles"]) {
      const wanted = typeof flags.tiles === "string" ? new Set(flags.tiles.split(",").map(s => s.trim()).filter(Boolean)) : undefined;
      if (wanted) { const unknown = [...wanted].filter(k => !item.tiles!.some(t => t.key === k)); if (unknown.length) { console.log(`ERROR ${id} にないタイル: ${unknown.join(", ")}`); failed++; continue; } }
      await appendTiles(root, project.tilesetPath, id, item.tiles.filter(t => !wanted || wanted.has(t.key)));
    }
  }
  if (failed) { console.log(`FAILED library add: ${failed}件を取り込めませんでした`); return 1; }
  console.log(`OK library add: ${ids.length}件。続けて pnpm rpg validate --project ${path.relative(process.cwd(), root) || "."}`);
  return 0;
}

async function appendTiles(root: string, tilesetPath: string, atlas: string, tiles: NonNullable<LibraryItem["tiles"]>) {
  const file = path.join(root, tilesetPath);
  const tileset = JSON.parse(await fs.readFile(file, "utf8")) as { atlas: string; tiles: Array<{ code: string; atlas?: string; index: number; name: string }> };
  const used = new Set(tileset.tiles.map(t => t.code));
  const already = new Set(tileset.tiles.filter(t => (t.atlas ?? tileset.atlas) === atlas).map(t => t.index));
  const pool = codePool().filter(c => !used.has(c));
  const added: string[] = [];
  for (const tile of tiles) {
    if (already.has(tile.index)) continue;
    const code = pool.shift();
    if (!code) throw new Error("空いているタイルコードがありません");
    tileset.tiles.push({ code, name: tile.name, atlas, index: tile.index, passable: tile.passable, color: tile.color } as (typeof tileset.tiles)[number]);
    added.push(`${code}=${tile.name}`);
  }
  await fs.writeFile(file, `${JSON.stringify(tileset, null, 2)}\n`);
  console.log(added.length ? `OK tiles.json に ${added.length} 個追加（${atlas}）: ${added.join(" ")}` : `tiles.json: ${atlas} のタイルは追加済みです`);
}

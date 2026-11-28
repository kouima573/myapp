/**
 * `rpg library …`: browse the shared, generated asset library (library/library.json) and copy chosen
 * assets into a project. Registration goes through `rpg asset add` (same checks, provenance, budget);
 * tile sheets can also append their tile definitions to tiles.json (per-tile `atlas`, so existing
 * indices and codes are never touched).
 */
import fs from "node:fs/promises";
import { mergeTiles } from "./tileMerge";
import path from "node:path";
import { addAsset } from "./assets";
import { REPO_ROOT } from "./build";
import { ARTGEN_VERSION, LIBRARY_LICENSE, type LibraryCatalog, type LibraryItem } from "./artgen/library";
import { Img } from "./artgen/core";
import { decodePng, encodePng } from "./artgen/png";

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

export { codePool } from "./tileMerge";

export async function cmdLibrary(sub: string | undefined, flags: Flags, args: string[], projectRoot: () => string): Promise<number> {
  const dir = str(flags, "library") ? path.resolve(str(flags, "library")!) : DEFAULT_LIBRARY;
  if (sub === "list") return list(dir, flags);
  if (sub === "add") return add(dir, flags, args, projectRoot());
  if (sub === "preview") return preview(dir, flags, args);
  console.log(`rpg library list [--kind tileset|tile|character|enemy|background] [--query <言葉>] [--json]
rpg library add <id...> --project <dir> [--tiles <key,key…>] [--no-tiles] [--replace]
rpg library preview [--kind …] [--query <言葉>] [id...] [--out <png>]   番号つきの見本画像（AIが候補として見せる用）
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

export async function add(dir: string, flags: Flags, ids: string[], root: string): Promise<number> {
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
  const { tileset, added, moved } = mergeTiles(JSON.parse(await fs.readFile(file, "utf8")), atlas, tiles);
  await fs.writeFile(file, `${JSON.stringify(tileset, null, 2)}\n`);
  console.log(added.length ? `OK tiles.json に ${added.length} 個追加（${atlas}）: ${added.join(" ")}` : `tiles.json: ${atlas} のタイルは追加済みです`);
  if (moved.length) console.log(`OK 素材の並びが変わったタイルの番号を追従（マップの記号はそのまま）: ${moved.join(" ")}`);
}

/* ------------------------------------------------------------------ numbered preview sheet */

const DIGITS: Record<string, string[]> = {
  0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"], 2: ["111", "001", "111", "100", "111"], 3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "111", "001", "111"], 6: ["111", "100", "111", "101", "111"], 7: ["111", "001", "010", "010", "010"],
  8: ["111", "101", "111", "101", "111"], 9: ["111", "101", "111", "001", "111"],
};
function label(img: Img, n: number, x0: number, y0: number) {
  const text = String(n), k = 3, w = text.length * 4 * k + k, h = 7 * k;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.set(x0 + x, y0 + y, 0x1a1a22);
  [...text].forEach((d, i) => DIGITS[d]!.forEach((row, ry) => [...row].forEach((bit, rx) => {
    if (bit === "1") for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) img.set(x0 + k + i * 4 * k + rx * k + xx, y0 + k + ry * k + yy, 0xffe9a8);
  })));
}

/**
 * A numbered contact sheet of library items or single tiles, so an agent can show candidates in the chat
 * ("1〜12 のどれにしますか？") and the person answers with numbers. Writes .rpg-studio/library-preview.png by default.
 */
async function preview(dir: string, flags: Flags, ids: string[]): Promise<number> {
  const catalog = await loadLibrary(dir);
  const kindFlag = str(flags, "kind"), query = str(flags, "query");
  const kind = kindFlag ? KIND_ALIASES[kindFlag] : undefined;
  const cells: Array<{ name: string; ref: string; img: Img }> = [];
  const sheet = new Map<string, Img>();
  const image = async (item: LibraryItem) => { if (!sheet.has(item.id)) sheet.set(item.id, decodePng(await fs.readFile(path.join(dir, item.path)))); return sheet.get(item.id)!; };
  for (const item of catalog.items) {
    if (ids.length && !ids.includes(item.id)) continue;
    if (kind === "tile") {
      for (const tile of item.tiles ?? []) {
        if (query && !matches(`${tile.key} ${tile.name} ${tile.tags.join(" ")}`, query)) continue;
        const img = await image(item);
        cells.push({ name: tile.name, ref: `${item.id}#${tile.key}`, img: img.crop((tile.index % item.columns) * item.tileWidth, Math.floor(tile.index / item.columns) * item.tileHeight, item.tileWidth, item.tileHeight) });
      }
      continue;
    }
    if (kind && item.kind !== kind) continue;
    if (query && !matches(`${item.id} ${item.title} ${item.tags.join(" ")} ${(item.tiles ?? []).map(t => t.name).join(" ")}`, query)) continue;
    const img = await image(item);
    // Characters / enemies: first frame. Tile sheets / backgrounds: the whole picture shrunk to fit.
    const first = item.kind === "character" || item.kind === "enemy" ? img.crop(0, 0, item.tileWidth, item.tileHeight) : img;
    cells.push({ name: item.title, ref: item.id, img: first });
  }
  if (!cells.length) { console.log("見つかりませんでした（rpg library list で一覧）"); return 1; }
  const shown = cells.slice(0, 48);
  const size = 128, cols = Math.min(6, shown.length), rows = Math.ceil(shown.length / cols);
  const out = new Img(cols * size, rows * size);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) out.set(x, y, (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 0x2c3330 : 0x343c38);
  shown.forEach((cell, i) => {
    const x0 = (i % cols) * size, y0 = Math.floor(i / cols) * size;
    const k = Math.max(1, Math.floor(Math.min((size - 8) / cell.img.w, (size - 8) / cell.img.h) * 100) / 100);
    const scaled = k >= 1 ? cell.img.scale(Math.floor(k)) : shrink(cell.img, size - 8);
    out.draw(scaled, x0 + Math.floor((size - scaled.w) / 2), y0 + Math.floor((size - scaled.h) / 2));
    label(out, i + 1, x0 + 2, y0 + 2);
  });
  const file = path.resolve(str(flags, "out") ?? path.join(REPO_ROOT, ".rpg-studio", "library-preview.png"));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, encodePng(out));
  console.log(`# 見本画像: ${file}`);
  shown.forEach((cell, i) => console.log(`${String(i + 1).padStart(2)}. ${cell.name}  (${cell.ref})`));
  if (cells.length > shown.length) console.log(`…ほか${cells.length - shown.length}件（--query で絞り込めます）`);
  console.log("取り込み: pnpm rpg library add <id...> --project <dir>（タイルだけなら --tiles <key,…>）");
  return 0;
}

function shrink(img: Img, max: number): Img {
  const k = Math.min(max / img.w, max / img.h), w = Math.max(1, Math.round(img.w * k)), h = Math.max(1, Math.round(img.h * k));
  const out = new Img(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = Math.floor(x / k), sy = Math.floor(y / k); if (img.alpha(sx, sy)) out.set(x, y, img.get(sx, sy)); }
  return out;
}


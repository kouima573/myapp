/**
 * Builds the shared asset library (`library/`): every generated PNG plus `library.json`, a catalogue
 * with ids, layout, tags and — for tile sheets — suggested tile definitions. Fully deterministic.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Img } from "./core";
import { encodePng } from "./png";
import { average } from "./paint";
import { renderTile, SHEETS, TILE_SCALE } from "./tiles";
import { CHARACTERS, drawCharacterFrame, FACINGS, renderCharacterSheet } from "./characters";
import { MONSTERS, renderMonsterSheet } from "./monsters";
import { BACKGROUNDS, renderBackground } from "./backgrounds";

/** Bump when the drawing code changes in a way that alters output. */
export const ARTGEN_VERSION = 1;
export const LIBRARY_FORMAT_VERSION = 1;
export const SHEET_COLUMNS = 8;

export interface LibraryTile { key: string; name: string; index: number; passable: boolean; color: string; tags: string[] }
export interface LibraryItem {
  id: string;
  kind: "tileset" | "character" | "enemy" | "background";
  title: string;
  path: string;
  tags: string[];
  bytes: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  frameDurationMs?: number;
  frameOrder?: number[];
  loop?: boolean;
  tiles?: LibraryTile[];
}
export interface LibraryCatalog {
  formatVersion: number;
  generator: { tool: string; version: number };
  license: string;
  origin: "generated";
  note: string;
  items: LibraryItem[];
}

export const LIBRARY_LICENSE = "MIT（rpg-studio リポジトリのライセンス。内蔵ジェネレーターによるオリジナル生成物）";

type Kind = "tiles" | "characters" | "monsters" | "backgrounds";
export interface GenerateOptions { only?: Kind[]; previews?: boolean; log?: (line: string) => void }

interface Rendered { item: Omit<LibraryItem, "bytes">; png: Buffer }

export function renderTileSheet(sheetIndex: number): { img: Img; tiles: LibraryTile[] } {
  const sheet = SHEETS[sheetIndex]!;
  const cell = 32 * TILE_SCALE;
  const rows = Math.ceil(sheet.tiles.length / SHEET_COLUMNS);
  const img = new Img(SHEET_COLUMNS * cell, rows * cell);
  const tiles: LibraryTile[] = sheet.tiles.map((spec, index) => {
    const tile = renderTile(spec, sheet.id);
    img.draw(tile, (index % SHEET_COLUMNS) * cell, Math.floor(index / SHEET_COLUMNS) * cell);
    return { key: spec.key, name: spec.name, index, passable: spec.passable, color: average(tile), tags: spec.tags };
  });
  return { img, tiles };
}

function* renderAll(only: Set<Kind>): Generator<Rendered> {
  if (only.has("tiles")) for (let i = 0; i < SHEETS.length; i++) {
    const sheet = SHEETS[i]!;
    const { img, tiles } = renderTileSheet(i);
    yield { png: encodePng(img), item: { id: sheet.id, kind: "tileset", title: sheet.title, path: `tilesets/${sheet.id}.png`, tags: sheet.tags, tileWidth: 64, tileHeight: 64, columns: SHEET_COLUMNS, rows: img.h / 64, tiles } };
  }
  if (only.has("characters")) for (const spec of CHARACTERS) {
    yield { png: encodePng(renderCharacterSheet(spec)), item: { id: `chr-${spec.id}`, kind: "character", title: spec.name, path: `characters/chr-${spec.id}.png`, tags: spec.tags, tileWidth: 64, tileHeight: 64, columns: 4, rows: 4, frameDurationMs: 160, frameOrder: [0, 1, 2, 3], loop: true } };
  }
  if (only.has("monsters")) for (const spec of MONSTERS) {
    yield { png: encodePng(renderMonsterSheet(spec)), item: { id: `mon-${spec.id}`, kind: "enemy", title: spec.name, path: `enemies/mon-${spec.id}.png`, tags: [spec.family, ...spec.tags.filter(t => t !== spec.family)], tileWidth: 64, tileHeight: 64, columns: 4, rows: 1, frameDurationMs: 220, loop: true } };
  }
  if (only.has("backgrounds")) for (const spec of BACKGROUNDS) {
    yield { png: encodePng(renderBackground(spec)), item: { id: spec.id, kind: "background", title: spec.name, path: `backgrounds/${spec.id}.png`, tags: spec.tags, tileWidth: 640, tileHeight: 448, columns: 1, rows: 1 } };
  }
}

/* ------------------------------------------------------------------ contact sheets */

function checker(img: Img, size: number, a: number, b: number) {
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) img.set(x, y, (Math.floor(x / size) + Math.floor(y / size)) % 2 ? a : b);
}
function previews(): Record<string, Img> {
  const out: Record<string, Img> = {};
  // all tile sheets stacked, 8px gap
  const sheets = SHEETS.map((_, i) => renderTileSheet(i).img);
  const tiles = new Img(SHEET_COLUMNS * 64, sheets.reduce((s, i) => s + i.h + 8, -8));
  checker(tiles, 8, 0x30303a, 0x3a3a44);
  let y = 0; for (const s of sheets) { tiles.draw(s, 0, y); y += s.h + 8; }
  out.tiles = tiles;
  // characters: every sheet's walk cycle facing down + one frame of each other facing (7 cells of 64px)
  const cols = 2;
  const chars = new Img(cols * 7 * 64, Math.ceil(CHARACTERS.length / cols) * 64);
  checker(chars, 16, 0x7a9060, 0x86a06a);
  CHARACTERS.forEach((spec, i) => {
    const x0 = (i % cols) * 7 * 64, y0 = Math.floor(i / cols) * 64;
    const frames = [0, 1, 2, 3].map(f => drawCharacterFrame(spec, "down", f)).concat(FACINGS.slice(1).map(face => drawCharacterFrame(spec, face, 0)));
    frames.forEach((frame, k) => chars.draw(frame.scale(2), x0 + k * 64, y0));
  });
  out.characters = chars;
  const mcols = 8;
  const mons = new Img(mcols * 128, Math.ceil(MONSTERS.length / mcols) * 128);
  checker(mons, 64, 0x5a6a78, 0x66768a);
  MONSTERS.forEach((spec, i) => mons.draw(renderMonsterSheet(spec).crop(0, 0, 64, 64).scale(2), (i % mcols) * 128, Math.floor(i / mcols) * 128));
  out.monsters = mons;
  const bcols = 3;
  const bgs = new Img(bcols * 320, Math.ceil(BACKGROUNDS.length / bcols) * 224);
  BACKGROUNDS.forEach((spec, i) => { const full = renderBackground(spec); const half = new Img(320, 224); for (let yy = 0; yy < 224; yy++) for (let xx = 0; xx < 320; xx++) half.set(xx, yy, full.get(xx * 2, yy * 2)); bgs.draw(half, (i % bcols) * 320, Math.floor(i / bcols) * 224); });
  out.backgrounds = bgs;
  return out;
}

/* ------------------------------------------------------------------ main */

export async function generateLibrary(outDir: string, options: GenerateOptions = {}): Promise<LibraryCatalog> {
  const log = options.log ?? (() => {});
  const only = new Set<Kind>(options.only?.length ? options.only : ["tiles", "characters", "monsters", "backgrounds"]);
  const catalogFile = path.join(outDir, "library.json");
  // Partial runs keep the other kinds' entries.
  let previous: LibraryItem[] = [];
  if (options.only?.length) { try { previous = (JSON.parse(await fs.readFile(catalogFile, "utf8")) as LibraryCatalog).items; } catch { previous = []; } }
  const kindOf: Record<LibraryItem["kind"], Kind> = { tileset: "tiles", character: "characters", enemy: "monsters", background: "backgrounds" };
  const items: LibraryItem[] = previous.filter(item => !only.has(kindOf[item.kind]));
  for (const { item, png } of renderAll(only)) {
    const file = path.join(outDir, item.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, png);
    items.push({ ...item, bytes: png.length });
  }
  const order: LibraryItem["kind"][] = ["tileset", "character", "enemy", "background"];
  items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const catalog: LibraryCatalog = {
    formatVersion: LIBRARY_FORMAT_VERSION,
    generator: { tool: "rpg art generate", version: ARTGEN_VERSION },
    license: LIBRARY_LICENSE,
    origin: "generated",
    note: "すべて packages/cli/src/artgen のコードが手続き的に描いたオリジナル素材です（第三者素材・既存作品の模写なし）。pnpm rpg art generate で同じ結果を再生成できます。プロジェクトへは pnpm rpg library add <id...> --project <dir> で取り込みます。",
    items,
  };
  await fs.writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);
  if (options.previews !== false) {
    const dir = path.join(outDir, "previews");
    await fs.mkdir(dir, { recursive: true });
    for (const [name, img] of Object.entries(previews())) await fs.writeFile(path.join(dir, `${name}.png`), encodePng(img));
  }
  const counts = order.map(kind => `${kind} ${items.filter(i => i.kind === kind).length}`).join(" / ");
  const tiles = items.reduce((s, i) => s + (i.tiles?.length ?? 0), 0);
  log(`OK art generate: ${outDir}（${counts}、タイル ${tiles} 種、${(items.reduce((s, i) => s + i.bytes, 0) / 1024 / 1024).toFixed(2)}MB）`);
  return catalog;
}

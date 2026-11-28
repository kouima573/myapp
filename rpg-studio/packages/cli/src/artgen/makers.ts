/**
 * 素材作り（敵・タイル）: 内蔵ジェネレーターの部品を選んで、自分だけの敵やタイル集を作る。純粋関数（工房とCLIで共用）。
 * できたものは内蔵ジェネレーター製（MIT）なので、ゲームに使うのも、素材として配る・売るのも自由。
 */
import { Img, rng } from "./core";
import { average } from "./paint";
import { MONSTERS, renderMonsterSheet, type MonsterSpec } from "./monsters";
import { SHEETS, TILE_SCALE, type TileSpec } from "./tiles";
import { applyStyle, type ArtStyle } from "./style";
import type { MergeTile } from "../tileMerge";

/* ------------------------------------------------------------------ 敵 */

export const MONSTER_FAMILIES = [...new Set(MONSTERS.map(m => m.family))];
/** Extras each family can draw (taken from the built-in monsters). */
export const MONSTER_EXTRAS: Record<string, string[]> = Object.fromEntries(MONSTER_FAMILIES.map(f => [f, [...new Set(MONSTERS.filter(m => m.family === f && m.extra).map(m => m.extra!))]]));
export const FAMILY_LABELS: Record<string, string> = {
  bat: "コウモリ", bee: "ハチ", beetle: "甲虫", bird: "鳥", dragon: "竜", elemental: "精霊", eye: "目玉", ghost: "幽霊", goblin: "小鬼", golem: "巨人",
  mushroom: "キノコ", plant: "植物", skeleton: "骸骨", slime: "スライム", snake: "ヘビ", spider: "クモ", wolf: "獣",
};
export const EXTRA_LABELS: Record<string, string> = {
  crown: "王冠", tusks: "牙", sword: "剣", shield: "盾", robe: "ローブ", lantern: "灯火", vine: "つる", mandrake: "根っこ", wings: "翼",
  fire: "炎", water: "水", wind: "風", thunder: "雷", earth: "岩", helmet: "かぶと",
};

export function monsterSpec(o: { id: string; name: string; from?: string; family?: string; pal?: Partial<MonsterSpec["pal"]>; extra?: string | null }): MonsterSpec {
  const base = o.from ? MONSTERS.find(m => m.id === o.from) : MONSTERS.find(m => m.family === (o.family ?? "slime"));
  if (!base) throw new Error(o.from ? `見本の敵 '${o.from}' はありません` : `種類 '${o.family}' はありません（${MONSTER_FAMILIES.join(", ")}）`);
  const family = o.family ?? base.family;
  if (!MONSTER_FAMILIES.includes(family)) throw new Error(`種類 '${family}' はありません（${MONSTER_FAMILIES.join(", ")}）`);
  const extra = o.extra === null ? undefined : o.extra ?? (family === base.family ? base.extra : undefined);
  if (extra && !MONSTER_EXTRAS[family]!.includes(extra)) throw new Error(`「${FAMILY_LABELS[family] ?? family}」に付けられる飾りは ${MONSTER_EXTRAS[family]!.join(", ") || "ありません"}`);
  return { id: o.id, name: o.name, tags: [family, "custom"], family, pal: { ...base.pal, ...o.pal }, ...(extra ? { extra } : {}) };
}

export function randomMonster(seed: number | string, id = "custom", name = "おまかせの敵"): MonsterSpec {
  const r = rng(seed);
  const family = r.pick(MONSTER_FAMILIES);
  const hue = () => `#${[0, 0, 0].map(() => r.int(40, 230).toString(16).padStart(2, "0")).join("")}`;
  const extras = MONSTER_EXTRAS[family]!;
  return monsterSpec({ id, name, family, pal: { body: hue(), accent: hue() }, extra: extras.length && r.chance(0.5) ? r.pick(extras) : null });
}

export { renderMonsterSheet };

/* ------------------------------------------------------------------ タイル */

/** One tile of a custom set: a built-in tile, with its own pattern (seed), colour turn and brightness. */
export interface CustomTile { from: string; name?: string; seed?: number; hue?: number; light?: number; passable?: boolean }

const ALL_TILES = SHEETS.flatMap(sheet => sheet.tiles.map(t => ({ ref: `${sheet.id}/${t.key}`, sheet: sheet.id, tile: t })));
/** Animation frames after the first and autotile pieces: they come along with their main tile. */
const COMPANIONS = new Set(SHEETS.flatMap(s => s.tiles.flatMap(t => [...(t.frames?.slice(1) ?? []), ...Object.values(t.autotile?.pieces ?? {})]).map(k => `${s.id}/${k}`)));
export const TILE_CATALOG = ALL_TILES.map(({ ref, sheet, tile }) => ({ ref, sheet, key: tile.key, name: tile.name, passable: tile.passable, tags: tile.tags, animated: Boolean(tile.frames), autotile: Boolean(tile.autotile), companion: COMPANIONS.has(ref) }));
export const SHEET_TITLES: Record<string, string> = Object.fromEntries(SHEETS.map(s => [s.id, s.title]));

function find(ref: string): { sheet: string; tile: TileSpec } {
  const hit = ALL_TILES.find(t => t.ref === ref);
  if (!hit) throw new Error(`タイル '${ref}' はありません（「シートID/キー」で指定。例: lib-tiles-field/grass）`);
  return { sheet: hit.sheet, tile: hit.tile };
}

/** Rotate hue (degrees) and change lightness (-50..50) of every opaque pixel. */
function recolor(img: Img, hue = 0, light = 0) {
  if (!hue && !light) return;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = d[i]! / 255, g = d[i + 1]! / 255, b = d[i + 2]! / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const dd = max - min;
      s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
      h = max === r ? ((g - b) / dd + (g < b ? 6 : 0)) : max === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
      h /= 6;
    }
    h = (((h + hue / 360) % 1) + 1) % 1;
    l = Math.max(0, Math.min(1, l + light / 100));
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t: number) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    if (s === 0) { r = g = b = l; } else { r = f(h + 1 / 3); g = f(h); b = f(h - 1 / 3); }
    d[i] = Math.round(r * 255); d[i + 1] = Math.round(g * 255); d[i + 2] = Math.round(b * 255);
  }
}

function paintTile(tile: TileSpec, sheet: string, t: CustomTile, style: ArtStyle): Img {
  const img = new Img(32, 32);
  tile.paint(img, rng(t.seed !== undefined ? `${sheet}/${tile.key}#${t.seed}` : `${sheet}/${tile.key}`));
  recolor(img, t.hue, t.light);
  return applyStyle(img.scale(TILE_SCALE), style);
}

export function renderCustomTile(t: CustomTile, style: ArtStyle = "standard"): Img {
  const { sheet, tile } = find(t.from);
  return paintTile(tile, sheet, t, style);
}

/**
 * A tile sheet (8 columns, 64px cells) of the chosen tiles. Animated tiles bring their frames and autotiles their
 * 9 pieces (same pattern, colour and brightness), so the set works in maps right away.
 */
export function customTileSheet(chosen: CustomTile[], style: ArtStyle = "standard", setId = "custom"): { img: Img; tiles: MergeTile[] } {
  type Cell = { key: string; name: string; passable: boolean; img: Img; frames?: string[]; autotile?: { group: string; pieces: Record<string, string> } };
  const cells: Cell[] = [];
  const keyOf = (i: number, k: string) => `${setId}-${i}-${k}`;
  chosen.forEach((t, i) => {
    const { sheet, tile } = find(t.from);
    const spec = SHEETS.find(s => s.id === sheet)!;
    const add = (k: string, primary: boolean) => {
      const key = keyOf(i, k);
      if (cells.some(c => c.key === key)) return;
      const src = spec.tiles.find(x => x.key === k)!;
      cells.push({ key, name: primary ? (t.name ?? src.name) : src.name, passable: t.passable ?? src.passable, img: paintTile(src, sheet, t, style) });
    };
    add(tile.key, true);
    const main = cells.find(c => c.key === keyOf(i, tile.key))!;
    if (tile.frames) { for (const f of tile.frames) add(f, false); main.frames = tile.frames.map(f => keyOf(i, f)); }
    if (tile.autotile) {
      for (const k of Object.values(tile.autotile.pieces)) add(k, false);
      main.autotile = { group: `${setId}-${i}-${tile.autotile.group}`, pieces: Object.fromEntries(Object.entries(tile.autotile.pieces).map(([p, k]) => [p, keyOf(i, k)])) };
    }
  });
  const cell = 32 * TILE_SCALE, columns = 8;
  const img = new Img(columns * cell, Math.max(1, Math.ceil(cells.length / columns)) * cell);
  cells.forEach((c, i) => img.draw(c.img, (i % columns) * cell, Math.floor(i / columns) * cell));
  const indexOf = (key: string) => cells.findIndex(c => c.key === key);
  const tiles: MergeTile[] = cells.map((c, index) => ({
    key: c.key, name: c.name, index, passable: c.passable, color: average(c.img),
    ...(c.frames ? { frames: c.frames.map(indexOf) } : {}),
    ...(c.autotile ? { autotile: { group: c.autotile.group, pieces: Object.fromEntries(Object.entries(c.autotile.pieces).map(([p, k]) => [p, indexOf(k)])) } } : {}),
  }));
  return { img, tiles };
}

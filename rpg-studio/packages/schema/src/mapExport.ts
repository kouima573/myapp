/**
 * マップを工房の外へ: 「マップだけ」の作品として、Tiled 形式（.tmj。多くのゲームエンジンが読める）と1枚の画像にする。
 * ゲーム内の描画（runtime/render.ts）と同じ規則でタイルを決める（オートタイルの9分割・動くタイルは最初のコマ・閉じた状態）。
 * 純粋関数: 画像の読み書きは呼び出し側（CLI は PNG のデコード、工房は canvas）。
 */
import type { AssetEntry, GameContent, GameMap, TileDef } from "./formats";

export interface MapCell { sheet: string; index: number }
export interface MapLayerCells { id: string; name: string; above: boolean; cells: Array<Array<MapCell | null>> }

/** Which sheet cell each map square shows, layer by layer (base first). */
export function resolveMapLayers(content: GameContent, map: GameMap): MapLayerCells[] {
  const tiles = new Map(content.tileset.tiles.map(t => [t.code, t] as const));
  const resolve = (rows: string[], base: boolean): Array<Array<MapCell | null>> => {
    const grid = rows.map(r => Array.from(r));
    return Array.from({ length: map.height }, (_, y) => Array.from({ length: map.width }, (_, x) => {
      const code = grid[y]?.[x] ?? "";
      if (!base && (code === " " || code === "")) return null;
      const tile: TileDef | undefined = tiles.get(code);
      if (!tile) return null;
      let index = tile.frames?.[0] ?? tile.index;
      const auto = tile.autotile;
      if (auto?.pieces) {
        const same = (dx: number, dy: number) => { const n = tiles.get(grid[y + dy]?.[x + dx] ?? ""); return Boolean(n?.autotile && n.autotile.group === auto.group); };
        const v = !same(0, -1) ? "t" : !same(0, 1) ? "b" : "", h = !same(-1, 0) ? "l" : !same(1, 0) ? "r" : "";
        index = auto.pieces[(v + h || "c") as keyof typeof auto.pieces] ?? index;
      }
      return { sheet: tile.atlas ?? content.tileset.atlas, index };
    }));
  };
  return [
    { id: "ground", name: "地面", above: false, cells: resolve(map.rows, true) },
    ...(map.layers ?? []).map(l => ({ id: l.id, name: l.name ?? l.id, above: l.above, cells: resolve(l.rows, false) })),
  ];
}

export interface TiledExport { tmj: Record<string, unknown>; sheets: AssetEntry[]; tileWidth: number; tileHeight: number; warnings: string[] }

/**
 * Tiled map (JSON, .tmj). `imagePath(sheet)` = where the sheet image will be, relative to the .tmj file.
 * Characters, exits and objects become an object layer (points with name and kind) so they are not lost.
 */
export function mapToTiled(content: GameContent, mapId: string, imagePath: (sheet: AssetEntry) => string): TiledExport {
  const map = content.maps[mapId];
  if (!map) throw new Error(`マップ '${mapId}' がありません`);
  const layers = resolveMapLayers(content, map);
  const warnings: string[] = [];
  const used = [...new Set(layers.flatMap(l => l.cells.flat().filter((c): c is MapCell => c !== null).map(c => c.sheet)))];
  const sheets = used.map(id => content.assets.assets.find(a => a.id === id)).filter((a): a is AssetEntry => Boolean(a));
  for (const id of used) if (!sheets.some(s => s.id === id)) warnings.push(`タイル画像 '${id}' が assets.json にありません`);
  const tileWidth = sheets[0]?.tileWidth ?? 32, tileHeight = sheets[0]?.tileHeight ?? 32;
  if (sheets.some(s => (s.tileWidth ?? tileWidth) !== tileWidth || (s.tileHeight ?? tileHeight) !== tileHeight)) warnings.push("タイル画像ごとに1マスの大きさが違います（Tiled では最初の画像の大きさで並びます）");
  let firstgid = 1;
  const tilesets = sheets.map(s => {
    const columns = s.columns ?? 1, rows = s.rows ?? 1;
    const entry = { firstgid, name: s.id, image: imagePath(s), imagewidth: columns * (s.tileWidth ?? tileWidth) + (s.margin ?? 0) * 2 + (s.spacing ?? 0) * (columns - 1), imageheight: rows * (s.tileHeight ?? tileHeight) + (s.margin ?? 0) * 2 + (s.spacing ?? 0) * (rows - 1), tilewidth: s.tileWidth ?? tileWidth, tileheight: s.tileHeight ?? tileHeight, columns, tilecount: columns * rows, margin: s.margin ?? 0, spacing: s.spacing ?? 0 };
    firstgid += columns * rows;
    return entry;
  });
  const gid = (c: MapCell | null) => { if (!c) return 0; const t = tilesets.find(ts => ts.name === c.sheet); return t ? t.firstgid + c.index : 0; };
  let layerId = 1;
  const tileLayers = layers.map(l => ({ id: layerId++, name: l.name, type: "tilelayer", width: map.width, height: map.height, x: 0, y: 0, opacity: 1, visible: true, data: l.cells.flat().map(gid), properties: [{ name: "above", type: "bool", value: l.above }] }));
  let objectId = 1;
  const point = (kind: string, name: string, x: number, y: number) => ({ id: objectId++, name, type: kind, x: (x + 0.5) * tileWidth, y: (y + 0.5) * tileHeight, width: 0, height: 0, point: true, rotation: 0, visible: true });
  const objects = [
    ...map.npcs.map(n => point("npc", n.name ?? n.id, n.x, n.y)),
    ...map.portals.map(p => point("portal", `${p.id} → ${p.targetMapId}`, p.x, p.y)),
    ...map.interactables.map(i => point("interactable", i.label ?? i.id, i.x, i.y)),
    ...map.entities.map(e => point("entity", e.id, e.x, e.y)),
  ];
  const objectLayer = { id: layerId++, name: "人物・出入口・仕掛け", type: "objectgroup", draworder: "topdown", x: 0, y: 0, opacity: 1, visible: true, objects };
  const tmj = {
    type: "map", version: "1.10", tiledversion: "1.10.2", orientation: "orthogonal", renderorder: "right-down", infinite: false,
    width: map.width, height: map.height, tilewidth: tileWidth, tileheight: tileHeight,
    nextlayerid: layerId, nextobjectid: objectId, compressionlevel: -1,
    properties: [{ name: "title", type: "string", value: map.title }, { name: "madeWith", type: "string", value: "RPGシステム工房" }],
    tilesets, layers: [...tileLayers.filter((_, i) => !layers[i]!.above), objectLayer, ...tileLayers.filter((_, i) => layers[i]!.above)],
  };
  return { tmj, sheets, tileWidth, tileHeight, warnings };
}

export interface RgbaImage { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

/** One picture of the whole map (all tile layers, no characters), `tileSize` px per square. */
export function composeMapImage(content: GameContent, mapId: string, sheetImage: (sheetId: string) => RgbaImage | undefined, tileSize?: number): RgbaImage {
  const map = content.maps[mapId];
  if (!map) throw new Error(`マップ '${mapId}' がありません`);
  const layers = resolveMapLayers(content, map);
  const assets = new Map(content.assets.assets.map(a => [a.id, a] as const));
  const first = assets.get(content.tileset.atlas);
  const size = tileSize ?? first?.tileWidth ?? 32;
  const out = new Uint8ClampedArray(map.width * size * map.height * size * 4);
  const W = map.width * size;
  for (const layer of layers.filter(l => !l.above).concat(layers.filter(l => l.above))) {
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const cell = layer.cells[y]![x];
      if (!cell) continue;
      const img = sheetImage(cell.sheet), a = assets.get(cell.sheet);
      if (!img || !a) continue;
      const cols = a.columns ?? 1, tw = a.tileWidth ?? Math.floor(img.width / cols), th = a.tileHeight ?? Math.floor(img.height / (a.rows ?? 1));
      const sx0 = (a.margin ?? 0) + (cell.index % cols) * (tw + (a.spacing ?? 0)), sy0 = (a.margin ?? 0) + Math.floor(cell.index / cols) * (th + (a.spacing ?? 0));
      for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
        const sx = sx0 + Math.floor((px * tw) / size), sy = sy0 + Math.floor((py * th) / size);
        if (sx >= img.width || sy >= img.height) continue;
        const si = (sy * img.width + sx) * 4, di = ((y * size + py) * W + x * size + px) * 4;
        const alpha = img.data[si + 3]! / 255;
        if (alpha <= 0) continue;
        for (let k = 0; k < 3; k++) out[di + k] = Math.round(img.data[si + k]! * alpha + out[di + k]! * (1 - alpha));
        out[di + 3] = Math.max(out[di + 3]!, img.data[si + 3]!);
      }
    }
  }
  return { width: W, height: map.height * size, data: out };
}

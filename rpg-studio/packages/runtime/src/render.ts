/**
 * Canvas 2D renderer shared by the studio editor, the studio play-test and the static game build.
 * All drawing goes through here so the three views always look the same.
 */
import type { AssetEntry, Direction, GameContent, GameMap, GameState, Interactable, Npc, TileDef } from "../../schema/src/formats";
import { evaluate } from "../../engine/src/conditions";
import type { Point } from "./movement";

export const TILE = 32;
const DIRECTION_ROWS: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };

export type ImageMap = Record<string, HTMLImageElement | undefined>;

export interface ActorDraw {
  id: string;
  x: number;
  y: number;
  facing: Direction;
  sprite?: string;
  frame?: number;
  label?: string;
  kind: "player" | "npc";
  /** Speech-bubble icon (emote effect). */
  emote?: string;
}

export interface RenderView {
  /** Top-left of the viewport in tile units (may be fractional while scrolling). */
  camera: Point;
  /** Viewport size in tiles. */
  cols: number;
  rows: number;
}

function ready(image: HTMLImageElement | undefined): image is HTMLImageElement {
  return Boolean(image && image.complete && image.naturalWidth > 0);
}

function sheetCell(asset: AssetEntry | undefined, image: HTMLImageElement, index: number) {
  const columns = asset?.columns ?? 1;
  const tw = asset?.tileWidth ?? image.naturalWidth / columns;
  const th = asset?.tileHeight ?? image.naturalHeight / (asset?.rows ?? 1);
  const margin = asset?.margin ?? 0, spacing = asset?.spacing ?? 0;
  return { sx: margin + (index % columns) * (tw + spacing), sy: margin + Math.floor(index / columns) * (th + spacing), sw: tw, sh: th };
}

function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp((n >> 16) + amount), g = clamp(((n >> 8) & 255) + amount), b = clamp((n & 255) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Fallback when the atlas is missing: a flat colour with a little deterministic texture. */
function fallbackTile(ctx: CanvasRenderingContext2D, tile: TileDef, px: number, py: number, x: number, y: number) {
  ctx.fillStyle = tile.color;
  ctx.fillRect(px, py, TILE, TILE);
  const seed = (x * 17 + y * 31) % 13;
  ctx.fillStyle = shade(tile.color, tile.passable ? 14 : -18);
  ctx.fillRect(px + 4 + seed, py + 6 + (seed * 3) % 16, 4, 2);
  ctx.fillRect(px + 18 - (seed % 7), py + 20 - (seed % 5), 3, 2);
  if (!tile.passable) {
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.fillRect(px, py + TILE - 4, TILE, 4);
  }
}

export interface DrawMapOptions {
  content: GameContent;
  map: GameMap;
  images: ImageMap;
  view: RenderView;
  /** When given, conditional tiles/objects are drawn for this state; otherwise as authored (editor). */
  state?: GameState;
  actors: ActorDraw[];
  interactables: Interactable[];
  /** Entity markers (chests, signs… on entities). */
  markers?: Array<{ x: number; y: number; marker: Interactable["marker"] }>;
  /** Editor overlays. */
  editor?: {
    grid: boolean;
    selected?: Point | null;
    hovered?: Point | null;
    showEntities: boolean;
    showPassability: boolean;
    /** Layer ids not drawn (editor: show only the layer being painted, or hide the roofs). */
    hiddenLayers?: string[];
    startPoint?: Point | null;
  };
  time: number;
}

/** Draws the map; returns where tile (0,0) landed so overlays can align. */
export function drawMap(ctx: CanvasRenderingContext2D, o: DrawMapOptions): { originX: number; originY: number } {
  const { content, map, images, view, state } = o;
  const assetById = new Map(content.assets.assets.map(a => [a.id, a]));
  const tiles = new Map(content.tileset.tiles.map(t => [t.code, t]));
  const width = view.cols * TILE, height = view.rows * TILE;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0e120f";
  ctx.fillRect(0, 0, width, height);
  // Centre maps smaller than the viewport.
  const offsetX = map.width < view.cols ? Math.floor((view.cols - map.width) / 2) * TILE : -Math.round(view.camera.x * TILE);
  const offsetY = map.height < view.rows ? Math.floor((view.rows - map.height) / 2) * TILE : -Math.round(view.camera.y * TILE);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  const x0 = Math.max(0, Math.floor(-offsetX / TILE)), y0 = Math.max(0, Math.floor(-offsetY / TILE));
  const x1 = Math.min(map.width, x0 + view.cols + 2), y1 = Math.min(map.height, y0 + view.rows + 2);
  /** Draws one layer of tile codes (" " = empty on upper layers). Autotiles connect within the same layer. */
  const drawLayer = (layerRows: string[], base: boolean) => {
    const grid = layerRows.map(r => Array.from(r));
    for (let y = y0; y < y1; y++) {
      const row = grid[y] ?? [];
      for (let x = x0; x < x1; x++) {
        const code = row[x] ?? "";
        if (!base && (code === " " || code === "")) continue;
        const tile = tiles.get(code);
        const px = x * TILE, py = y * TILE;
        if (!tile) { ctx.fillStyle = "#ff00aa"; ctx.fillRect(px, py, TILE, TILE); continue; }
        const open = state && tile.passableWhen && evaluate(tile.passableWhen, state);
        let index = open && tile.openIndex !== undefined ? tile.openIndex : tile.index;
        if (tile.frames) index = tile.frames[Math.floor((o.time ?? 0) / tile.frameMs) % tile.frames.length]!;
        const auto = tile.autotile;
        const same = auto ? (dx: number, dy: number) => { const n = tiles.get(grid[y + dy]?.[x + dx] ?? ""); return Boolean(n?.autotile && n.autotile.group === auto.group); } : undefined;
        if (auto?.pieces && same) {
          // 9-slice by neighbours: no tile of the group above → top row, none below → bottom row (thin strips use the outer pieces).
          const n = same(0, -1), s = same(0, 1), w = same(-1, 0), e = same(1, 0);
          const v = !n ? "t" : !s ? "b" : "", h = !w ? "l" : !e ? "r" : "";
          index = auto.pieces[(v + h || "c") as keyof typeof auto.pieces];
        }
        const sheetId = tile.atlas ?? content.tileset.atlas;
        const atlas = images[sheetId];
        if (ready(atlas)) {
          const cell = sheetCell(assetById.get(sheetId), atlas, index);
          ctx.drawImage(atlas, cell.sx, cell.sy, cell.sw, cell.sh, px, py, TILE, TILE);
        } else {
          fallbackTile(ctx, open ? { ...tile, passable: true, color: shade(tile.color, 30) } : tile, px, py, x, y);
        }
        if (auto?.border && same) {
          ctx.fillStyle = auto.border;
          if (!same(0, -1)) ctx.fillRect(px, py, TILE, 2);
          if (!same(0, 1)) ctx.fillRect(px, py + TILE - 2, TILE, 2);
          if (!same(-1, 0)) ctx.fillRect(px, py, 2, TILE);
          if (!same(1, 0)) ctx.fillRect(px + TILE - 2, py, 2, TILE);
        }
        if (o.editor?.showPassability) {
          const passable = tile.passable || Boolean(open);
          if (!passable) { ctx.fillStyle = tile.passableWhen ? "rgba(237,196,119,.35)" : "rgba(216,127,106,.38)"; ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2); }
        }
      }
    }
  };
  const hidden = o.editor?.hiddenLayers ?? [];
  drawLayer(map.rows, true);
  for (const layer of map.layers ?? []) if (!layer.above && !hidden.includes(layer.id)) drawLayer(layer.rows, false);

  for (const item of o.interactables) drawMarker(ctx, item, o.time);
  for (const item of o.markers ?? []) drawMarker(ctx, item as Interactable, o.time);

  const sorted = [...o.actors].sort((a, b) => a.y - b.y || (a.kind === "player" ? 1 : -1));
  for (const actor of sorted) drawActor(ctx, content, images, actor);
  // Layers above the characters: roofs, tree tops, bridges seen from below.
  for (const layer of map.layers ?? []) if (layer.above && !hidden.includes(layer.id)) drawLayer(layer.rows, false);

  if (o.editor) drawEditorOverlay(ctx, map, o.editor);
  ctx.restore();
  return { originX: offsetX, originY: offsetY };
}

function drawMarker(ctx: CanvasRenderingContext2D, item: Interactable, time: number) {
  const px = item.x * TILE, py = item.y * TILE;
  switch (item.marker) {
    case "none": return;
    case "sign":
      ctx.fillStyle = "#5b3d22"; ctx.fillRect(px + 14, py + 14, 4, 16);
      ctx.fillStyle = "#b8874f"; ctx.fillRect(px + 5, py + 6, 22, 12);
      ctx.fillStyle = "#7a5530"; ctx.fillRect(px + 5, py + 17, 22, 2);
      ctx.fillStyle = "#5b3d22"; ctx.fillRect(px + 9, py + 10, 14, 1); ctx.fillRect(px + 9, py + 13, 10, 1);
      return;
    case "chest":
      ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.fillRect(px + 5, py + 25, 22, 4);
      ctx.fillStyle = "#7c4a24"; ctx.fillRect(px + 5, py + 12, 22, 14);
      ctx.fillStyle = "#9c6232"; ctx.fillRect(px + 5, py + 8, 22, 7);
      ctx.fillStyle = "#e1b553"; ctx.fillRect(px + 5, py + 14, 22, 2); ctx.fillRect(px + 14, py + 13, 4, 6);
      return;
    case "statue": {
      ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(px + 4, py + 26, 24, 5);
      ctx.fillStyle = "#6d7369"; ctx.fillRect(px + 7, py + 8, 18, 20);
      ctx.fillStyle = "#858c80"; ctx.fillRect(px + 9, py + 2, 14, 10); ctx.fillRect(px + 4, py + 12, 5, 10); ctx.fillRect(px + 23, py + 12, 5, 10);
      const glow = 0.45 + 0.35 * Math.sin(time / 300);
      ctx.fillStyle = `rgba(255, 196, 92, ${glow.toFixed(2)})`; ctx.fillRect(px + 11, py + 6, 3, 2); ctx.fillRect(px + 18, py + 6, 3, 2);
      return;
    }
    case "sparkle": {
      const phase = Math.floor(time / 180) % 4;
      ctx.fillStyle = "rgba(255, 238, 170, .9)";
      const s = [2, 3, 4, 3][phase]!;
      ctx.fillRect(px + 16 - s, py + 15, s * 2, 2); ctx.fillRect(px + 15, py + 16 - s, 2, s * 2);
      return;
    }
  }
}

function drawActor(ctx: CanvasRenderingContext2D, content: GameContent, images: ImageMap, actor: ActorDraw) {
  const px = actor.x * TILE, py = actor.y * TILE;
  ctx.fillStyle = "rgba(10, 14, 12, .3)";
  ctx.beginPath(); ctx.ellipse(px + 16, py + 28, 10, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  const image = actor.sprite ? images[actor.sprite] : undefined;
  if (ready(image)) {
    const asset = content.assets.assets.find(a => a.id === actor.sprite);
    const columns = asset?.columns ?? 1, rows = asset?.rows ?? 1;
    const row = Math.min(rows - 1, DIRECTION_ROWS[actor.facing]);
    const column = Math.min(columns - 1, Math.max(0, actor.frame ?? 0));
    const cell = sheetCell(asset, image, row * columns + column);
    ctx.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, px, py, TILE, TILE);
  } else {
    drawPixelPerson(ctx, px, py, actor.kind === "player" ? "#355b67" : "#4f7467", actor.kind === "player" ? "#bd8155" : "#b88d5e", actor.facing);
  }
  if (actor.label) {
    ctx.font = "bold 9px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    const w = Math.max(26, ctx.measureText(actor.label).width + 8);
    ctx.fillStyle = "rgba(18, 23, 20, .85)"; ctx.fillRect(px + 16 - w / 2, py - 11, w, 12);
    ctx.fillStyle = "#f1e4c2"; ctx.fillText(actor.label, px + 16, py);
  }
  if (actor.emote) {
    ctx.font = "bold 13px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const w = Math.max(20, ctx.measureText(actor.emote).width + 10), bx = px + 16 - w / 2, by = py - 24;
    ctx.fillStyle = "#fbf6e8"; ctx.strokeStyle = "#2a241c"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(bx, by, w, 18, 6); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + 12, by + 18); ctx.lineTo(px + 16, by + 23); ctx.lineTo(px + 20, by + 18); ctx.fillStyle = "#fbf6e8"; ctx.fill();
    ctx.fillStyle = "#2a241c"; ctx.fillText(actor.emote, px + 16, by + 9.5);
  }
}

function drawPixelPerson(ctx: CanvasRenderingContext2D, sx: number, sy: number, color: string, accent: string, facing: Direction) {
  ctx.fillStyle = color; ctx.fillRect(sx + 10, sy + 10, 13, 13);
  ctx.fillStyle = accent; ctx.fillRect(sx + 8, sy + 13, 17, 8);
  ctx.fillStyle = "#e7d0a5"; ctx.fillRect(sx + 12, sy + 4, 10, 9);
  ctx.fillStyle = "#493b33"; ctx.fillRect(sx + 11, sy + 3, 12, 4);
  if (facing === "left") ctx.fillRect(sx + 12, sy + 7, 2, 2);
  else if (facing === "right") ctx.fillRect(sx + 20, sy + 7, 2, 2);
  else if (facing === "down") { ctx.fillRect(sx + 13, sy + 7, 2, 2); ctx.fillRect(sx + 19, sy + 7, 2, 2); }
  ctx.fillStyle = "#514331"; ctx.fillRect(sx + 11, sy + 23, 4, 6); ctx.fillRect(sx + 19, sy + 23, 4, 6);
}

function drawEditorOverlay(ctx: CanvasRenderingContext2D, map: GameMap, editor: NonNullable<DrawMapOptions["editor"]>) {
  const width = map.width * TILE, height = map.height * TILE;
  if (editor.grid) {
    ctx.strokeStyle = "rgba(242, 198, 108, .16)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= map.width; x++) { ctx.moveTo(x * TILE + .5, 0); ctx.lineTo(x * TILE + .5, height); }
    for (let y = 0; y <= map.height; y++) { ctx.moveTo(0, y * TILE + .5); ctx.lineTo(width, y * TILE + .5); }
    ctx.stroke();
  }
  if (editor.showEntities) {
    for (const region of map.regions) {
      ctx.fillStyle = "rgba(111,168,220,.10)"; ctx.fillRect(region.x * TILE, region.y * TILE, region.w * TILE, region.h * TILE);
      ctx.strokeStyle = "rgba(111,168,220,.7)"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.strokeRect(region.x * TILE + 1, region.y * TILE + 1, region.w * TILE - 2, region.h * TILE - 2); ctx.setLineDash([]);
      ctx.font = "9px system-ui"; ctx.fillStyle = "#a9cdf0"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(region.label ?? region.id, region.x * TILE + 3, region.y * TILE + 3);
    }
    for (const entity of map.entities) badge(ctx, entity.x, entity.y, "#85ad7b", entity.states.length > 1 ? String(entity.states.length) : "E");
    for (const portal of map.portals) badge(ctx, portal.x, portal.y, "#6fa8dc", "⇄");
    for (const item of map.interactables) badge(ctx, item.x, item.y, item.trigger === "touch" ? "#ae9bd2" : "#edc477", item.trigger === "touch" ? "▣" : "!");
    if (map.encounters) {
      ctx.font = "10px system-ui"; ctx.fillStyle = "rgba(216,127,106,.95)"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(`エンカウント ${Math.round(map.encounters.rate * 100)}%`, 4, 4);
    }
  }
  if (editor.startPoint) badge(ctx, editor.startPoint.x, editor.startPoint.y, "#85ad7b", "S");
  if (editor.hovered) {
    ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 2;
    ctx.strokeRect(editor.hovered.x * TILE + 1, editor.hovered.y * TILE + 1, TILE - 2, TILE - 2);
  }
  if (editor.selected) {
    ctx.strokeStyle = "#efbb64"; ctx.lineWidth = 3;
    ctx.strokeRect(editor.selected.x * TILE + 1.5, editor.selected.y * TILE + 1.5, TILE - 3, TILE - 3);
  }
}

function badge(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, text: string) {
  const px = x * TILE, py = y * TILE;
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
  ctx.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
  ctx.setLineDash([]);
  ctx.fillStyle = color; ctx.fillRect(px + TILE - 13, py + 1, 12, 12);
  ctx.fillStyle = "#121713"; ctx.font = "bold 9px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, px + TILE - 7, py + 7.5);
}

/** Procedural battle portrait used until an enemy sprite is provided. Deterministic per enemy id. */
export function drawEnemyPortrait(ctx: CanvasRenderingContext2D, enemyId: string, size: number, time: number, image?: HTMLImageElement, asset?: AssetEntry) {
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  const bob = Math.round(Math.sin(time / 280) * 2);
  if (ready(image)) {
    const cell = sheetCell(asset, image, Math.floor(time / (asset?.frameDurationMs ?? 400)) % Math.max(1, asset?.columns ?? 1));
    ctx.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, 0, bob, size, size);
    return;
  }
  let hash = 0;
  for (const ch of enemyId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const u = size / 16;
  const px = (x: number, y: number, w: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x * u), Math.round(y * u + bob), Math.ceil(w * u), Math.ceil(h * u)); };
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath(); ctx.ellipse(size / 2, size - u * 1.5, size * 0.34, u * 1.2, 0, 0, Math.PI * 2); ctx.fill();
  const shape = hash % 3;
  const body = `hsl(${hue} 32% 46%)`, dark = `hsl(${hue} 34% 30%)`, light = `hsl(${hue} 40% 62%)`;
  if (/sentinel|statue|golem|stone/.test(enemyId) || shape === 0) {
    px(4, 3, 8, 11, dark); px(5, 2, 6, 4, body); px(2, 6, 3, 6, body); px(11, 6, 3, 6, body); px(5, 6, 6, 7, body); px(6, 3, 4, 1, light);
    const glow = 0.6 + 0.4 * Math.sin(time / 200);
    px(6, 4, 1, 1, `rgba(255,200,90,${glow})`); px(9, 4, 1, 1, `rgba(255,200,90,${glow})`);
  } else if (/bat|wing|bird/.test(enemyId) || shape === 1) {
    const flap = Math.floor(time / 160) % 2;
    px(6, 6, 4, 4, dark); px(6, 5, 1, 1, dark); px(9, 5, 1, 1, dark);
    px(1, 5 + flap, 5, 2, body); px(10, 5 + flap, 5, 2, body); px(2, 7 + flap, 3, 1, dark); px(11, 7 + flap, 3, 1, dark);
    px(7, 7, 1, 1, "#f6e27a"); px(8, 7, 1, 1, "#f6e27a");
  } else {
    px(3, 8, 10, 6, body); px(4, 6, 8, 3, body); px(5, 5, 6, 1, light); px(3, 13, 10, 1, dark);
    px(6, 9, 1, 2, "#1a1d1a"); px(9, 9, 1, 2, "#1a1d1a"); px(5, 6, 2, 1, light);
  }
}

export function npcActors(content: GameContent, map: GameMap, npcs: Npc[], options: { labels?: boolean; facingOverride?: Record<string, Direction> } = {}): ActorDraw[] {
  void content; void map;
  return npcs.map(npc => ({
    id: npc.id, x: npc.x, y: npc.y, kind: "npc" as const, sprite: npc.sprite,
    facing: options.facingOverride?.[npc.id] ?? npc.facing,
    ...(options.labels ? { label: npc.name } : {}),
  }));
}

/** Loads every image asset; resolves even when some fail (the renderer falls back). */
export function loadImages(content: GameContent, resolve: (asset: AssetEntry) => string | Promise<string>, onUpdate?: () => void): ImageMap {
  const images: ImageMap = {};
  for (const asset of content.assets.assets) {
    if (!asset.mimeType.startsWith("image/")) continue;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => onUpdate?.();
    image.onerror = () => onUpdate?.();
    images[asset.id] = image;
    Promise.resolve(resolve(asset)).then(url => { image.src = url; }).catch(() => onUpdate?.());
  }
  return images;
}

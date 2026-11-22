import { useEffect, useMemo, useRef, useState } from "react";
import { Brush, Circle, Copy, Eraser, FlipHorizontal2, PaintBucket, Pipette, Redo2, Save, Slash, Square, SquareDashedMousePointer, Undo2 } from "lucide-react";
import { ellipsePoints, linePoints, rectPoints, replaceColor, shiftHue, usedColors, type Point } from "../lib/pixelshapes";
import type { AssetEntry, GameContent, TileDef } from "@rpg/schema";
import type { ImageMap } from "../../../packages/runtime/src/render";
import type { ProjectStore } from "../lib/useProject";

interface Props { store: ProjectStore; content: GameContent; images: ImageMap }

type Tool = "pen" | "eraser" | "fill" | "picker" | "line" | "rect" | "ellipse" | "select";
const SHAPES = new Set<Tool>(["line", "rect", "ellipse"]);
type Target =
  | { mode: "tile"; base?: string }
  | { mode: "new"; kind: "character" | "enemy" | "background" | "portrait" }
  | { mode: "edit"; assetId: string };

const PALETTE = [
  "#1b1b25", "#3a3a4f", "#6b6b84", "#a3a3b8", "#e6e6ef", "#ffffff",
  "#5a2e22", "#8f4a2f", "#c9784a", "#f0b27a", "#ffe0b8", "#7a1f2b",
  "#c0392b", "#ec6b5e", "#f4a261", "#e9c46a", "#fff3a3", "#2d4a22",
  "#4f7d32", "#86b04f", "#c5e17a", "#1e4d5c", "#2f8f9d", "#7fd1d9",
  "#1d3461", "#3f6cb5", "#8fb5f0", "#3d2459", "#7a4fa3", "#c79ae6",
  "#5c4033", "#8a6a4f", "#b89773", "#e0cfa8", "#4a5a3a", "#6f7f55",
];
const NEW_SIZES: Record<"character" | "enemy" | "background" | "portrait", { w: number; h: number; fw: number; fh: number; label: string; folder: string }> = {
  character: { w: 256, h: 256, fw: 64, fh: 64, label: "キャラ（4方向×歩き4コマ、64×64）", folder: "characters" },
  enemy: { w: 256, h: 64, fw: 64, fh: 64, label: "敵（待機4コマ、64×64）", folder: "enemies" },
  portrait: { w: 128, h: 128, fw: 128, fh: 128, label: "立ち絵・顔（128×128）", folder: "portraits" },
  background: { w: 320, h: 224, fw: 320, fh: 224, label: "戦闘背景（320×224。拡大して表示）", folder: "backgrounds" },
};
const ROW_NAMES = ["下向き", "左向き", "右向き", "上向き"];
const TILE_CODES = Array.from("0123456789!#$%&()+,-;<=>?@[]^_`{|}abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZあいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん");

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
const rgb = (color: string) => [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)] as const;

function imageToData(image: HTMLImageElement): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const g = canvas.getContext("2d")!;
  g.drawImage(image, 0, 0);
  return g.getImageData(0, 0, canvas.width, canvas.height);
}
const cloneData = (d: ImageData) => new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
function toBlob(data: ImageData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = data.width; canvas.height = data.height;
  canvas.getContext("2d")!.putImageData(data, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("PNGにできません"))), "image/png"));
}

/** A small pixel-art editor: new tiles appended to the project's tileset, new character / enemy sheets, or edits of existing images. */
export default function PixelEditor({ store, content, images }: Props) {
  const imageAssets = content.assets.assets.filter(a => ["tileset", "character", "enemy", "portrait", "background", "animation"].includes(a.kind));
  const atlas = content.assets.assets.find(a => a.id === content.tileset.atlas);
  const [target, setTarget] = useState<Target>({ mode: "tile" });
  const [data, setData] = useState<ImageData | null>(null);
  const [frame, setFrame] = useState({ w: 64, h: 64 });
  const [current, setCurrent] = useState(0);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#4f7d32");
  const [recent, setRecent] = useState<string[]>([]);
  const [pixel, setPixel] = useState(4);
  const [mirror, setMirror] = useState(false);
  const [undo, setUndo] = useState<ImageData[]>([]);
  const [redo, setRedo] = useState<ImageData[]>([]);
  const [busy, setBusy] = useState(false);
  const [baseHash, setBaseHash] = useState<string>("");
  const [newId, setNewId] = useState("");
  const [tileName, setTileName] = useState("新しいタイル");
  const [tilePassable, setTilePassable] = useState(true);
  const [copyTo, setCopyTo] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  /** Shape being dragged (line / rect / ellipse) or a selection being moved: where it started and the picture before. */
  const shape = useRef<{ start: Point; base: ImageData; moving?: boolean } | null>(null);
  const [filled, setFilled] = useState(false);
  const [onion, setOnion] = useState(true);
  const [sel, setSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [palettes, setPalettes] = useState<Array<{ name: string; colors: string[] }>>(() => { try { return JSON.parse(localStorage.getItem("rpg-studio:palettes") ?? "[]"); } catch { return []; } });
  const [replaceFrom, setReplaceFrom] = useState<string | null>(null);
  const [variantId, setVariantId] = useState("");
  // Pointer events can arrive faster than React re-renders: always paint on the newest pixels.
  const dataRef = useRef<ImageData | null>(null);
  dataRef.current = data;
  const local = store.source.kind === "local";

  const cols = data ? Math.max(1, Math.floor(data.width / frame.w)) : 1;
  const rows = data ? Math.max(1, Math.floor(data.height / frame.h)) : 1;
  const frameX = (current % cols) * frame.w, frameY = Math.floor(current / cols) * frame.h;
  const zoom = Math.max(2, Math.floor(512 / Math.max(frame.w, frame.h)));
  const usedCodes = useMemo(() => new Set(content.tileset.tiles.map(t => t.code)), [content.tileset.tiles]);
  const freeCode = TILE_CODES.find(c => !usedCodes.has(c));

  /* ------------------------------------------------ (re)start */
  useEffect(() => {
    let blank: ImageData | null = null;
    setUndo([]); setRedo([]); setCurrent(0); setBaseHash("");
    if (target.mode === "tile") {
      const tw = atlas?.tileWidth ?? 64, th = atlas?.tileHeight ?? 64;
      blank = new ImageData(tw, th);
      const base = target.base ? content.tileset.tiles.find(t => t.code === target.base) : undefined;
      // The base tile may live on another sheet (tiles can name their own atlas).
      const sheet = base ? content.assets.assets.find(a => a.id === (base.atlas ?? content.tileset.atlas)) : undefined;
      const img = sheet ? images[sheet.id] : undefined;
      if (base && sheet && img?.complete && img.naturalWidth && sheet.columns && (sheet.tileWidth ?? tw) === tw && (sheet.tileHeight ?? th) === th) {
        const all = imageToData(img);
        const sx = (base.index % sheet.columns) * tw, sy = Math.floor(base.index / sheet.columns) * th;
        for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) for (let k = 0; k < 4; k++) blank.data[(y * tw + x) * 4 + k] = all.data[((sy + y) * all.width + sx + x) * 4 + k]!;
      }
      setFrame({ w: tw, h: th });
      setPixel(tw >= 64 ? 4 : 2);
    } else if (target.mode === "new") {
      const s = NEW_SIZES[target.kind];
      blank = new ImageData(s.w, s.h);
      setFrame({ w: s.fw, h: s.fh });
      setPixel(target.kind === "background" ? 2 : 4);
    } else {
      const asset = content.assets.assets.find(a => a.id === target.assetId);
      const img = asset ? images[asset.id] : undefined;
      if (asset && img?.complete && img.naturalWidth) {
        if (img.naturalWidth > 1024 || img.naturalHeight > 1024) { store.log("warn", "1024×1024より大きい画像はこのエディターでは編集できません"); blank = null; }
        else {
          blank = imageToData(img);
          setFrame({ w: asset.tileWidth ?? img.naturalWidth, h: asset.tileHeight ?? img.naturalHeight });
          setPixel(1);
          void store.source.assetHash?.(asset.path).then(setBaseHash).catch(() => setBaseHash(""));
        }
      }
    }
    setData(blank);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------ drawing on screen */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    canvas.width = frame.w * zoom; canvas.height = frame.h * zoom;
    const g = canvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    // checkerboard for transparency
    for (let y = 0; y < frame.h; y += 4) for (let x = 0; x < frame.w; x += 4) { g.fillStyle = ((x + y) / 4) % 2 ? "#2a2f2a" : "#222622"; g.fillRect(x * zoom, y * zoom, 4 * zoom, 4 * zoom); }
    const tmp = document.createElement("canvas");
    tmp.width = frame.w; tmp.height = frame.h;
    // オニオンスキン: the previous frame shows through faintly under the one being drawn.
    if (onion && current > 0) {
      const px = ((current - 1) % cols) * frame.w, py = Math.floor((current - 1) / cols) * frame.h;
      tmp.getContext("2d")!.putImageData(data, -px, -py);
      g.globalAlpha = 0.3;
      g.drawImage(tmp, 0, 0, frame.w * zoom, frame.h * zoom);
      g.globalAlpha = 1;
      tmp.getContext("2d")!.clearRect(0, 0, frame.w, frame.h);
    }
    tmp.getContext("2d")!.putImageData(data, -frameX, -frameY);
    g.drawImage(tmp, 0, 0, frame.w * zoom, frame.h * zoom);
    g.strokeStyle = "rgba(255,255,255,.08)";
    g.lineWidth = 1;
    for (let i = 0; i <= frame.w; i += pixel) { g.beginPath(); g.moveTo(i * zoom + .5, 0); g.lineTo(i * zoom + .5, frame.h * zoom); g.stroke(); }
    for (let i = 0; i <= frame.h; i += pixel) { g.beginPath(); g.moveTo(0, i * zoom + .5); g.lineTo(frame.w * zoom, i * zoom + .5); g.stroke(); }
    if (mirror) { g.strokeStyle = "rgba(240,180,80,.6)"; g.beginPath(); g.moveTo(frame.w * zoom / 2, 0); g.lineTo(frame.w * zoom / 2, frame.h * zoom); g.stroke(); }
    const ov = overviewRef.current;
    if (ov) {
      const scale = Math.max(1, Math.min(3, Math.floor(360 / data.width)));
      ov.width = data.width * scale; ov.height = data.height * scale;
      const og = ov.getContext("2d")!;
      og.imageSmoothingEnabled = false;
      og.fillStyle = "#1a1d1a"; og.fillRect(0, 0, ov.width, ov.height);
      const full = document.createElement("canvas");
      full.width = data.width; full.height = data.height;
      full.getContext("2d")!.putImageData(data, 0, 0);
      og.drawImage(full, 0, 0, ov.width, ov.height);
      og.strokeStyle = "#f0b450"; og.lineWidth = 2;
      og.strokeRect(frameX * scale + 1, frameY * scale + 1, frame.w * scale - 2, frame.h * scale - 2);
    }
  }, [data, frame, zoom, pixel, mirror, current, frameX, frameY, onion, cols]);

  useEffect(() => {
    const anim = animRef.current;
    if (!anim || !data || cols * rows <= 1) return;
    anim.width = frame.w; anim.height = frame.h;
    const ag = anim.getContext("2d")!;
    ag.imageSmoothingEnabled = false;
    let step = 0;
    const draw = () => {
      const rowStart = Math.floor(current / cols) * cols;
      const f = rowStart + (step % cols);
      const sx = (f % cols) * frame.w, sy = Math.floor(f / cols) * frame.h;
      ag.clearRect(0, 0, frame.w, frame.h);
      const tmp = document.createElement("canvas");
      tmp.width = data.width; tmp.height = data.height;
      tmp.getContext("2d")!.putImageData(data, 0, 0);
      ag.drawImage(tmp, sx, sy, frame.w, frame.h, 0, 0, frame.w, frame.h);
      step++;
    };
    draw();
    const timer = window.setInterval(draw, 180);
    return () => window.clearInterval(timer);
  }, [data, frame, cols, rows, current]);

  /* ------------------------------------------------ editing */
  const commit = (next: ImageData) => { dataRef.current = next; setData(next); };
  const snapshot = () => { if (data) { setUndo(u => [...u.slice(-49), cloneData(data)]); setRedo([]); } };
  const setBlock = (d: ImageData, gx: number, gy: number, value: readonly [number, number, number, number]) => {
    for (let y = 0; y < pixel; y++) for (let x = 0; x < pixel; x++) {
      const px = frameX + gx * pixel + x, py = frameY + gy * pixel + y;
      if (px >= frameX + frame.w || py >= frameY + frame.h) continue;
      const i = (py * d.width + px) * 4;
      d.data[i] = value[0]; d.data[i + 1] = value[1]; d.data[i + 2] = value[2]; d.data[i + 3] = value[3];
    }
  };
  const getBlock = (d: ImageData, gx: number, gy: number) => {
    const i = ((frameY + gy * pixel) * d.width + frameX + gx * pixel) * 4;
    return [d.data[i]!, d.data[i + 1]!, d.data[i + 2]!, d.data[i + 3]!] as const;
  };
  const gridW = Math.ceil(frame.w / pixel), gridH = Math.ceil(frame.h / pixel);
  const paintAt = (clientX: number, clientY: number, first: boolean) => {
    const canvas = canvasRef.current;
    const data = dataRef.current;
    if (!canvas || !data) return;
    const rect = canvas.getBoundingClientRect();
    const gx = Math.floor((clientX - rect.left) / rect.width * gridW), gy = Math.floor((clientY - rect.top) / rect.height * gridH);
    if (gx < 0 || gy < 0 || gx >= gridW || gy >= gridH) return;
    if (tool === "picker") {
      const [r, g, b, a] = getBlock(data, gx, gy);
      if (a > 0) { setColor(hex(r, g, b)); setTool("pen"); }
      return;
    }
    const value = tool === "eraser" ? [0, 0, 0, 0] as const : [...rgb(color), 255] as const;
    // Shapes: redraw from the picture as it was when the drag started, so the preview follows the pointer.
    if (SHAPES.has(tool)) {
      if (first) { snapshot(); shape.current = { start: { x: gx, y: gy }, base: cloneData(data) }; }
      const s = shape.current;
      if (!s) return;
      const next = cloneData(s.base);
      const pts = tool === "line" ? linePoints(s.start.x, s.start.y, gx, gy) : tool === "rect" ? rectPoints(s.start.x, s.start.y, gx, gy, filled) : ellipsePoints(s.start.x, s.start.y, gx, gy, filled);
      for (const p of pts) { setBlock(next, p.x, p.y, value); if (mirror) setBlock(next, gridW - 1 - p.x, p.y, value); }
      commit(next);
      return;
    }
    // Select: drag to choose a rectangle; drag inside it to move what is in it.
    if (tool === "select") {
      if (first) {
        const inside = sel && gx >= sel.x && gx < sel.x + sel.w && gy >= sel.y && gy < sel.y + sel.h;
        if (inside) snapshot();
        shape.current = { start: { x: gx, y: gy }, base: cloneData(data), moving: Boolean(inside) };
        if (!inside) setSel({ x: gx, y: gy, w: 1, h: 1 });
        return;
      }
      const s = shape.current;
      if (!s) return;
      if (!s.moving) { setSel({ x: Math.min(s.start.x, gx), y: Math.min(s.start.y, gy), w: Math.abs(gx - s.start.x) + 1, h: Math.abs(gy - s.start.y) + 1 }); return; }
      if (!sel) return;
      const dx = gx - s.start.x, dy = gy - s.start.y;
      const next = cloneData(s.base);
      const block: Array<readonly [number, number, number, number]> = [];
      for (let y = 0; y < sel.h; y++) for (let x = 0; x < sel.w; x++) { block.push(getBlock(s.base, sel.x + x, sel.y + y)); setBlock(next, sel.x + x, sel.y + y, [0, 0, 0, 0]); }
      for (let y = 0; y < sel.h; y++) for (let x = 0; x < sel.w; x++) {
        const tx = sel.x + x + dx, ty = sel.y + y + dy;
        if (tx >= 0 && ty >= 0 && tx < gridW && ty < gridH && block[y * sel.w + x]![3] > 0) setBlock(next, tx, ty, block[y * sel.w + x]!);
      }
      commit(next);
      return;
    }
    if (first) snapshot();
    const next = cloneData(data);
    if (tool === "fill") {
      const from = getBlock(next, gx, gy).join(",");
      if (from === value.join(",")) return;
      const stack = [[gx, gy]];
      const seen = new Set<string>();
      while (stack.length) {
        const [x, y] = stack.pop()!;
        const key = `${x},${y}`;
        if (x! < 0 || y! < 0 || x! >= gridW || y! >= gridH || seen.has(key) || getBlock(next, x!, y!).join(",") !== from) continue;
        seen.add(key);
        setBlock(next, x!, y!, value);
        stack.push([x! + 1, y!], [x! - 1, y!], [x!, y! + 1], [x!, y! - 1]);
      }
    } else {
      // Connect to the previous point so quick strokes have no gaps.
      const from = !first && last.current ? last.current : { x: gx, y: gy };
      const steps = Math.max(Math.abs(gx - from.x), Math.abs(gy - from.y), 1);
      for (let k = 0; k <= steps; k++) {
        const x = Math.round(from.x + (gx - from.x) * k / steps), y = Math.round(from.y + (gy - from.y) * k / steps);
        setBlock(next, x, y, value);
        if (mirror) setBlock(next, gridW - 1 - x, y, value);
      }
      last.current = { x: gx, y: gy };
    }
    if (tool === "pen") setRecent(r => (r[0] === color ? r : [color, ...r.filter(c => c !== color)].slice(0, 8)));
    commit(next);
  };
  const doUndo = () => { const prev = undo.at(-1); if (!prev || !data) return; setRedo(r => [...r, cloneData(data)]); setUndo(u => u.slice(0, -1)); setData(prev); };
  const doRedo = () => { const next = redo.at(-1); if (!next || !data) return; setUndo(u => [...u, cloneData(data)]); setRedo(r => r.slice(0, -1)); setData(next); };
  const copyFrame = (to: number, flip: boolean) => {
    if (!data || to === current) return;
    snapshot();
    const next = cloneData(data);
    const tx = (to % cols) * frame.w, ty = Math.floor(to / cols) * frame.h;
    for (let y = 0; y < frame.h; y++) for (let x = 0; x < frame.w; x++) {
      const sx = frameX + (flip ? frame.w - 1 - x : x);
      const si = ((frameY + y) * data.width + sx) * 4, di = ((ty + y) * data.width + tx + x) * 4;
      for (let k = 0; k < 4; k++) next.data[di + k] = data.data[si + k]!;
    }
    setData(next);
  };
  const copyToAll = () => {
    if (!data) return;
    snapshot();
    const next = cloneData(data);
    for (let f = 0; f < cols * rows; f++) {
      if (f === current) continue;
      const tx = (f % cols) * frame.w, ty = Math.floor(f / cols) * frame.h;
      for (let y = 0; y < frame.h; y++) for (let x = 0; x < frame.w; x++) {
        const si = ((frameY + y) * data.width + frameX + x) * 4, di = ((ty + y) * data.width + tx + x) * 4;
        for (let k = 0; k < 4; k++) next.data[di + k] = data.data[si + k]!;
      }
    }
    setData(next);
  };
  /** Moves the whole frame by (dx, dy) pixels (walk bob, idle bounce). */
  const shiftFrame = (dx: number, dy: number) => {
    if (!data) return;
    snapshot();
    const next = cloneData(data);
    for (let y = 0; y < frame.h; y++) for (let x = 0; x < frame.w; x++) {
      const sx = x - dx, sy = y - dy;
      const di = ((frameY + y) * data.width + frameX + x) * 4;
      if (sx < 0 || sy < 0 || sx >= frame.w || sy >= frame.h) { next.data[di + 3] = 0; continue; }
      const si = ((frameY + sy) * data.width + frameX + sx) * 4;
      for (let k = 0; k < 4; k++) next.data[di + k] = data.data[si + k]!;
    }
    setData(next);
  };

  /* ------------------------------------------------ saving */
  const assetsPath = content.project.assetsPath;
  async function save() {
    if (!data || !store.source.saveImage) return;
    setBusy(true);
    try {
      if (target.mode === "tile") await saveTile();
      else if (target.mode === "new") await saveNew(target.kind);
      else await saveEdit(target.assetId);
    } catch (error) {
      store.log("error", error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }
  async function saveNew(kind: "character" | "enemy" | "background" | "portrait") {
    const id = newId.trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id) || content.assets.assets.some(a => a.id === id)) { store.log("error", "素材IDは英数字と - _ で、既存と重ならないものを（例: my-knight）"); return; }
    const s = NEW_SIZES[kind];
    const path = `assets/${s.folder}/${id}.png`;
    const result = await store.source.saveImage!(path, await toBlob(data!), "");
    if (!result.ok) { store.log("error", result.error); return; }
    const entry: AssetEntry = {
      id, path, kind, mimeType: "image/png", bytes: result.bytes, source: "工房のドット絵エディターで作成", license: "プロジェクト内素材", origin: "original",
      creditRequired: false, redistributable: true, tileWidth: s.fw, tileHeight: s.fh, columns: s.w / s.fw, rows: s.h / s.fh,
      ...(kind === "character" || kind === "enemy" ? { frameOrder: [0, 1, 2, 3], frameDurationMs: 160, loop: true } : {}),
    };
    store.updateJson<{ assets: AssetEntry[] }>(assetsPath, f => { f.assets.push(entry); });
    store.log("ok", `${path} を保存し、素材 ${id} として登録しました`);
    setTarget({ mode: "edit", assetId: id });
  }
  /** 色違い: the current picture saved as a new asset (same size and frames); for an enemy, a copy of the enemy uses it. */
  async function saveVariant(base: AssetEntry) {
    const id = (variantId.trim() || `${base.id}-alt`);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id) || content.assets.assets.some(a => a.id === id)) { store.log("error", `素材ID '${id}' は使えません（英数字と - _、既存と重ならないもの）`); return; }
    setBusy(true);
    try {
      const path = base.path.replace(/[^/]+\.png$/, `${id}.png`);
      const result = await store.source.saveImage!(path, await toBlob(data!), "");
      if (!result.ok) { store.log("error", result.error); return; }
      const { id: _i, path: _p, bytes: _b, sha256: _s, ...rest } = base as AssetEntry & { sha256?: string };
      store.updateJson<{ assets: AssetEntry[] }>(assetsPath, f => { f.assets.push({ ...rest, id, path, bytes: result.bytes, origin: "original", source: `工房のドット絵エディターで ${base.id} の色違いとして作成`, license: "プロジェクト内素材", creditRequired: false, redistributable: true } as AssetEntry); });
      if (base.kind === "enemy") {
        const enemy = content.database.enemies.find(e => e.sprite === base.id);
        if (enemy && !content.database.enemies.some(e => e.id === id)) {
          store.updateJson<{ enemies: Array<Record<string, unknown>> }>(content.project.databasePath, f => { f.enemies.push({ ...structuredClone(enemy), id, name: `${enemy.name}（色違い）`, sprite: id }); });
          store.log("ok", `色違いの敵 ${id}（${enemy.name}（色違い））を追加しました。能力値は「敵・アイテム・仲間」で調整してください`);
        }
      }
      store.log("ok", `${path} を色違い ${id} として保存しました`);
    } finally { setBusy(false); }
  }
  async function saveEdit(assetId: string) {
    const asset = content.assets.assets.find(a => a.id === assetId)!;
    const result = await store.source.saveImage!(asset.path, await toBlob(data!), baseHash);
    if (!result.ok) { store.log("error", result.error); return; }
    setBaseHash(result.hash);
    store.updateJson<{ assets: AssetEntry[] }>(assetsPath, f => { const a = f.assets.find(x => x.id === assetId); if (a) a.bytes = result.bytes; });
    store.log("ok", `${asset.path} を上書き保存しました`);
  }
  async function saveTile() {
    if (!atlas || !atlas.columns || !atlas.tileWidth || !atlas.tileHeight) { store.log("error", "tiles.json の atlas 素材に tileWidth / columns がありません"); return; }
    if (!freeCode) { store.log("error", "使える1文字のタイル記号が残っていません"); return; }
    const img = images[atlas.id];
    if (!img?.complete || !img.naturalWidth) { store.log("error", "タイルセット画像を読み込み中です。少し待ってからもう一度"); return; }
    const hash = await store.source.assetHash!(atlas.path);
    const used = content.tileset.tiles.filter(t => !t.atlas || t.atlas === atlas.id).flatMap(t => [t.index, ...(t.openIndex !== undefined ? [t.openIndex] : [])]);
    const index = Math.max(-1, ...used) + 1;
    const tw = atlas.tileWidth, th = atlas.tileHeight;
    const rowsNow = atlas.rows ?? Math.ceil(img.naturalHeight / th);
    const rowsNeeded = Math.max(rowsNow, Math.floor(index / atlas.columns) + 1);
    const canvas = document.createElement("canvas");
    canvas.width = atlas.columns * tw; canvas.height = rowsNeeded * th;
    const g = canvas.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const cx = (index % atlas.columns) * tw, cy = Math.floor(index / atlas.columns) * th;
    g.clearRect(cx, cy, tw, th);
    const tile = document.createElement("canvas");
    tile.width = tw; tile.height = th;
    tile.getContext("2d")!.putImageData(data!, 0, 0);
    g.drawImage(tile, cx, cy);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("PNGにできません"))), "image/png"));
    const result = await store.source.saveImage!(atlas.path, blob, hash);
    if (!result.ok) { store.log("error", result.error); return; }
    // Average colour for the minimap / fallback drawing.
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < data!.data.length; i += 4) if (data!.data[i + 3]! > 0) { r += data!.data[i]!; gg += data!.data[i + 1]!; b += data!.data[i + 2]!; n++; }
    const def: TileDef = { code: freeCode, name: tileName.trim() || "新しいタイル", index, passable: tilePassable, color: n ? hex(Math.round(r / n), Math.round(gg / n), Math.round(b / n)) : "#808080" } as TileDef;
    store.updateJson<{ assets: AssetEntry[] }>(assetsPath, f => { const a = f.assets.find(x => x.id === atlas.id); if (a) { a.bytes = result.bytes; a.rows = rowsNeeded; } });
    store.updateJson<{ tiles: TileDef[] }>(content.project.tilesetPath, f => { f.tiles.push(def); });
    store.log("ok", `タイル「${def.name}」（記号 ${freeCode}・番号 ${index}）をタイルセットに追加しました。マップのパレットから塗れます`);
    setTarget({ mode: "tile" });
  }

  const frameLabel = (f: number) => (target.mode === "new" && target.kind === "character") || (target.mode === "edit" && content.assets.assets.find(a => a.id === target.assetId)?.kind === "character" && rows === 4)
    ? `${ROW_NAMES[Math.floor(f / cols)] ?? ""} ${f % cols + 1}コマ目` : `${f + 1}コマ目`;

  return <div className="pixel-editor">
    <aside className="card pixel-side">
      <header><h3>ドット絵</h3></header>
      {!local && <p className="muted small">Preview では保存できません（pnpm studio で開くと保存できます）。</p>}
      <div className="field"><span className="field-label">何を描く？</span>
        <select value={target.mode === "tile" ? "tile" : target.mode === "new" ? `new:${target.kind}` : `edit:${target.assetId}`} onChange={e => {
          const v = e.target.value;
          if (v === "tile") setTarget({ mode: "tile" });
          else if (v.startsWith("new:")) setTarget({ mode: "new", kind: v.slice(4) as "character" });
          else setTarget({ mode: "edit", assetId: v.slice(5) });
        }}>
          <option value="tile">新しいタイル（タイルセットに追加）</option>
          {Object.entries(NEW_SIZES).map(([k, s]) => <option key={k} value={`new:${k}`}>新しい{s.label}</option>)}
          <optgroup label="既存の画像を描き直す">{imageAssets.map(a => <option key={a.id} value={`edit:${a.id}`}>{a.id}（{a.kind}）</option>)}</optgroup>
        </select>
      </div>
      {target.mode === "tile" && <>
        <div className="field"><span className="field-label">元にするタイル（コピーして描き始める）</span>
          <select value={target.base ?? ""} onChange={e => setTarget({ mode: "tile", base: e.target.value || undefined })}>
            <option value="">（白紙）</option>{content.tileset.tiles.map(t => <option key={t.code} value={t.code}>{t.name}（{t.code}）</option>)}
          </select></div>
        <div className="field"><span className="field-label">名前</span><input value={tileName} onChange={e => setTileName(e.target.value)} /></div>
        <label className="small"><input type="checkbox" checked={tilePassable} onChange={e => setTilePassable(e.target.checked)} /> 歩いて通れる</label>
        <p className="muted small">保存するとタイルセット画像の空き番号に追加され、記号「{freeCode ?? "なし"}」で tiles.json に登録されます。</p>
      </>}
      {target.mode === "new" && <div className="field"><span className="field-label">素材ID</span><input placeholder="例: my-knight" value={newId} onChange={e => setNewId(e.target.value)} /></div>}
      <div className="field"><span className="field-label">道具</span>
        <div className="chips">
          {([["pen", Brush, "ペン"], ["eraser", Eraser, "消す"], ["fill", PaintBucket, "塗りつぶし"], ["picker", Pipette, "スポイト"], ["line", Slash, "直線"], ["rect", Square, "四角"], ["ellipse", Circle, "円"], ["select", SquareDashedMousePointer, "範囲を動かす"]] as const).map(([id, Icon, label]) =>
            <button key={id} className={`chip ${tool === id ? "is-on" : ""}`} onClick={() => { setTool(id); if (id !== "select") setSel(null); }}><Icon size={12} />{label}</button>)}
        </div>
        {(tool === "rect" || tool === "ellipse") && <label className="small"><input type="checkbox" checked={filled} onChange={e => setFilled(e.target.checked)} /> 中を塗る</label>}
        {tool === "select" && <p className="muted small">ドラッグで範囲を選び、範囲の中からドラッグすると中身を動かせます。</p>}
      </div>
      <div className="field"><span className="field-label">ドットの大きさ（{frame.w}×{frame.h} を {Math.ceil(frame.w / pixel)}×{Math.ceil(frame.h / pixel)} マスで描く）</span>
        <div className="chips">{[1, 2, 4, 8].map(n => <button key={n} className={`chip ${pixel === n ? "is-on" : ""}`} onClick={() => setPixel(n)}>{n}px</button>)}</div>
      </div>
      <label className="small"><input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} /> 左右対称に描く</label>
      <div className="field"><span className="field-label">色</span>
        <div className="palette">{PALETTE.map(c => <button key={c} className={`swatch ${color === c ? "is-on" : ""}`} style={{ background: c }} onClick={() => { setColor(c); if (tool === "eraser" || tool === "picker") setTool("pen"); }} title={c} />)}</div>
        <div className="form-row"><input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: 48, padding: 0 }} /><code className="small">{color}</code></div>
        {recent.length > 0 && <div className="palette">{recent.map(c => <button key={c} className="swatch" style={{ background: c }} onClick={() => setColor(c)} />)}</div>}
      </div>
      <div className="field"><span className="field-label">色替え（この画像で使っている色。クリック → 新しい色を選んで「置き換え」）</span>
        <div className="palette">{data && usedColors(data.data).map(c => <button key={c} className={`swatch ${replaceFrom === c ? "is-on" : ""}`} style={{ background: c }} title={c} onClick={() => setReplaceFrom(replaceFrom === c ? null : c)} />)}</div>
        <div className="form-row wrap">
          <button className="button" disabled={!replaceFrom || !data} onClick={() => { if (!data || !replaceFrom) return; snapshot(); const next = cloneData(data); const n = replaceColor(next.data, replaceFrom, color); commit(next); store.log("info", `${replaceFrom} → ${color}（${n}ドット）`); setReplaceFrom(null); }}>選んだ色 → いまの色に置き換え</button>
          {[60, 120, 180, 240, 300].map(d => <button key={d} className="button" disabled={!data} onClick={() => { if (!data) return; snapshot(); const next = cloneData(data); shiftHue(next.data, d); commit(next); }}>色相 +{d}°</button>)}
        </div>
        <div className="form-row wrap">
          <button className="button" disabled={!data} onClick={() => { if (!data) return; const name = window.prompt("パレットの名前", `パレット${palettes.length + 1}`); if (!name) return; const next = [...palettes.filter(p => p.name !== name), { name, colors: usedColors(data.data, 48) }]; setPalettes(next); try { localStorage.setItem("rpg-studio:palettes", JSON.stringify(next)); } catch { /* optional */ } }}>この画像の色をパレットに保存</button>
        </div>
        {palettes.map(p => <div key={p.name}><span className="small muted">{p.name}</span><div className="palette">{p.colors.map(c => <button key={c} className="swatch" style={{ background: c }} title={c} onClick={() => { setColor(c); if (tool === "eraser" || tool === "picker") setTool("pen"); }} />)}</div></div>)}
        {target.mode === "edit" && (() => { const a = content.assets.assets.find(x => x.id === target.assetId); return a && (a.kind === "enemy" || a.kind === "character") ? <div className="form-row wrap">
          <input placeholder={`${a.id}-alt`} value={variantId} onChange={e => setVariantId(e.target.value)} style={{ width: "10em" }} />
          <button className="button" disabled={!data || busy || !local} onClick={() => void saveVariant(a)}>色違いとして保存{a.kind === "enemy" ? "（敵も複製）" : ""}</button>
        </div> : null; })()}
      </div>
      <div className="form-row">
        <button className="button" disabled={!undo.length} onClick={doUndo}><Undo2 size={12} />戻す</button>
        <button className="button" disabled={!redo.length} onClick={doRedo}><Redo2 size={12} />やり直す</button>
      </div>
      <button className="button primary" disabled={!data || busy || !local} onClick={() => void save()}><Save size={13} />{busy ? "保存中…" : target.mode === "tile" ? "タイルとして追加" : target.mode === "new" ? "保存して素材に登録" : "上書き保存"}</button>
    </aside>
    <section className="pixel-main card">
      {!data && <div className="empty">画像を読み込み中、または編集できない画像です。</div>}
      {data && <>
        <div className="pixel-stage"><div className="pixel-wrap">
          <canvas ref={canvasRef} className="pixel-canvas"
            onPointerDown={e => { drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); paintAt(e.clientX, e.clientY, true); }}
            onPointerMove={e => { if (drawing.current && tool !== "fill" && tool !== "picker") paintAt(e.clientX, e.clientY, false); }}
            onPointerUp={e => {
              // A moved selection follows its pixels.
              const s = shape.current;
              if (tool === "select" && s?.moving && sel) {
                const r = e.currentTarget.getBoundingClientRect();
                const gx = Math.floor((e.clientX - r.left) / r.width * gridW), gy = Math.floor((e.clientY - r.top) / r.height * gridH);
                setSel({ ...sel, x: sel.x + gx - s.start.x, y: sel.y + gy - s.start.y });
              }
              drawing.current = false; last.current = null; shape.current = null;
            }} onPointerCancel={() => { drawing.current = false; last.current = null; shape.current = null; }} />
          {sel && tool === "select" && <div className="pixel-selection" style={{ left: `${sel.x / gridW * 100}%`, top: `${sel.y / gridH * 100}%`, width: `${sel.w / gridW * 100}%`, height: `${sel.h / gridH * 100}%` }} />}</div>
        </div>
        {cols * rows > 1 && <div className="pixel-frames">
          <div className="form-row"><span className="field-label">コマ（全体図をクリックで選ぶ）: {frameLabel(current)}</span><label className="small"><input type="checkbox" checked={onion} onChange={e => setOnion(e.target.checked)} /> 前のコマを透かす</label><span className="spacer" /><canvas ref={animRef} title="アニメーションプレビュー" style={{ width: 48, height: 48, imageRendering: "pixelated", border: "1px solid rgba(255,255,255,.15)", borderRadius: 4 }} /></div>
          <canvas ref={overviewRef} className="pixel-overview" onClick={e => {
            const r = e.currentTarget.getBoundingClientRect();
            const fx = Math.floor((e.clientX - r.left) / r.width * cols), fy = Math.floor((e.clientY - r.top) / r.height * rows);
            setCurrent(Math.max(0, Math.min(cols * rows - 1, fy * cols + fx)));
          }} />
          <div className="form-row wrap">
            <select value={copyTo} onChange={e => setCopyTo(Number(e.target.value))}>{Array.from({ length: cols * rows }, (_, f) => <option key={f} value={f}>{frameLabel(f)}</option>)}</select>
            <button className="button" onClick={() => copyFrame(copyTo, false)}><Copy size={12} />へコピー</button>
            <button className="button" onClick={() => copyFrame(copyTo, true)}><FlipHorizontal2 size={12} />へ左右反転コピー</button>
            <button className="button" onClick={copyToAll}>全コマへ複製</button>
            <button className="button" onClick={() => shiftFrame(0, -pixel)}>↑ずらす</button>
            <button className="button" onClick={() => shiftFrame(0, pixel)}>↓ずらす</button>
          </div>
          <p className="muted small">歩き: 1コマ描いたら「全コマへ複製」→ 2・4コマ目を少し上へずらすと足踏みになります。左向きを描いたら右向きへ「左右反転コピー」。</p>
        </div>}
        {cols * rows <= 1 && <canvas ref={overviewRef} style={{ display: "none" }} />}
      </>}
    </section>
  </div>;
}

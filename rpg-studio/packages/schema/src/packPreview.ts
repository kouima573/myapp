/**
 * 素材パックの見本画像（preview.png）: 収録した画像素材を番号つきの小さな枠に並べた一覧。
 * 販売ページの1枚目や、買った人が中身を見渡すのに使う。キャラクター・敵・顔グラフィックは最初の1コマ、
 * タイル・背景は画像全体を枠に収める。RGBA を受け取って RGBA を返す純粋関数（CLI と工房で共用）。
 */
import type { RgbaImage } from "./mapExport";

export interface PreviewCell {
  /** null: could not be read (drawn as an empty cell with its number, so the numbers stay the same). */
  image: RgbaImage | null;
  /** Only the top-left frame of this size (sprite sheets). */
  frame?: { w: number; h: number };
}

export const PREVIEW_CELL = 128;
const GAP = 8, PAD = 12, INSET = 6;

// 3×5 digits.
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001010010010", "111101111101111", "111101111001111"];

export function composePackPreview(cells: PreviewCell[], options: { columns?: number } = {}): RgbaImage {
  const n = Math.max(1, cells.length);
  const cols = Math.max(1, Math.min(options.columns ?? 6, n));
  const rows = Math.ceil(n / cols);
  const width = PAD * 2 + cols * PREVIEW_CELL + (cols - 1) * GAP;
  const height = PAD * 2 + rows * PREVIEW_CELL + (rows - 1) * GAP;
  const data = new Uint8ClampedArray(width * height * 4);
  const put = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    const k = a / 255;
    data[i] = Math.round(r * k + data[i]! * (1 - k)); data[i + 1] = Math.round(g * k + data[i + 1]! * (1 - k)); data[i + 2] = Math.round(b * k + data[i + 2]! * (1 - k)); data[i + 3] = 255;
  };
  const rect = (x: number, y: number, w: number, h: number, c: [number, number, number]) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, ...c); };
  rect(0, 0, width, height, [36, 38, 42]);

  // Visible area of each picture (sprite frames are trimmed to what is drawn, with a little margin).
  const areas = cells.map(cell => {
    const img = cell.image;
    if (!img || img.width <= 0 || img.height <= 0) return null;
    let x = 0, y = 0, w = Math.min(img.width, cell.frame?.w ?? img.width), h = Math.min(img.height, cell.frame?.h ?? img.height);
    if (cell.frame) {
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (img.data[(yy * img.width + xx) * 4 + 3]) { x0 = Math.min(x0, xx); y0 = Math.min(y0, yy); x1 = Math.max(x1, xx); y1 = Math.max(y1, yy); }
      if (x1 >= 0) { x = Math.max(0, x0 - 2); y = Math.max(0, y0 - 2); w = Math.min(w, x1 + 3) - x; h = Math.min(h, y1 + 3) - y; }
    }
    return { x, y, w, h };
  });
  const box = PREVIEW_CELL - INSET * 2;
  const fitOf = (a: { w: number; h: number }) => Math.min(box / a.w, box / a.h);
  // Frames of the same size share one scale, so characters keep their sizes relative to each other.
  const groupFit = new Map<string, number>();
  cells.forEach((cell, i) => { const a = areas[i]; if (cell.frame && a) { const key = `${cell.frame.w}x${cell.frame.h}`; groupFit.set(key, Math.min(groupFit.get(key) ?? Infinity, fitOf(a))); } });

  cells.forEach((cell, index) => {
    const cx = PAD + (index % cols) * (PREVIEW_CELL + GAP), cy = PAD + Math.floor(index / cols) * (PREVIEW_CELL + GAP);
    // Checkerboard so transparent parts are visible.
    for (let y = 0; y < PREVIEW_CELL; y++) for (let x = 0; x < PREVIEW_CELL; x++) { const v = ((x >> 3) + (y >> 3)) % 2 ? 70 : 82; put(cx + x, cy + y, v, v + 2, v + 6); }
    const img = cell.image, area = areas[index];
    if (img && area) {
      const fit = cell.frame ? groupFit.get(`${cell.frame.w}x${cell.frame.h}`)! : fitOf(area);
      const scale = fit >= 1 ? Math.floor(fit * 2) / 2 : fit; // whole or half steps keep pixel art even
      const dw = Math.max(1, Math.round(area.w * scale)), dh = Math.max(1, Math.round(area.h * scale));
      const ox = cx + Math.floor((PREVIEW_CELL - dw) / 2), oy = cy + Math.floor((PREVIEW_CELL - dh) / 2);
      for (let y = 0; y < dh; y++) {
        const sy = Math.min(area.h - 1, Math.floor(y / scale));
        for (let x = 0; x < dw; x++) {
          const sx = Math.min(area.w - 1, Math.floor(x / scale));
          const i = ((area.y + sy) * img.width + area.x + sx) * 4;
          const a = img.data[i + 3]!;
          if (a) put(ox + x, oy + y, img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, a);
        }
      }
    } else {
      // Unreadable: a simple cross.
      for (let t = 24; t < PREVIEW_CELL - 24; t++) { put(cx + t, cy + t, 140, 140, 150); put(cx + PREVIEW_CELL - 1 - t, cy + t, 140, 140, 150); }
    }
    // Number badge (top-left).
    const label = String(index + 1);
    const bw = label.length * 8 + 6, bh = 14;
    rect(cx, cy, bw, bh, [20, 22, 26]);
    [...label].forEach((d, k) => {
      const bits = DIGITS[Number(d)]!;
      for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (bits[y * 3 + x] === "1") rect(cx + 4 + k * 8 + x * 2, cy + 2 + y * 2, 2, 2, [246, 231, 193]);
    });
  });
  return { width, height, data };
}

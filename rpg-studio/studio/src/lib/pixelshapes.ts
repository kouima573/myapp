/**
 * Pixel editor helpers (roadmap 129 / 130): grid points of lines, rectangles and ellipses, and colour edits
 * (replace one colour, rotate hue for 色違い). Pure functions on {x, y} grids and RGBA arrays — testable without a browser.
 */
export type Point = { x: number; y: number };

/** Bresenham line, both ends included. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Point[] {
  const out: Point[] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    out.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}

export function rectPoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): Point[] {
  const [l, r] = [Math.min(x0, x1), Math.max(x0, x1)], [t, b] = [Math.min(y0, y1), Math.max(y0, y1)];
  const out: Point[] = [];
  for (let y = t; y <= b; y++) for (let x = l; x <= r; x++) if (filled || x === l || x === r || y === t || y === b) out.push({ x, y });
  return out;
}

/** Ellipse inside the box (x0,y0)-(x1,y1): outline or filled. */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): Point[] {
  const [l, r] = [Math.min(x0, x1), Math.max(x0, x1)], [t, b] = [Math.min(y0, y1), Math.max(y0, y1)];
  const cx = (l + r) / 2, cy = (t + b) / 2, rx = (r - l) / 2 + 0.5, ry = (b - t) / 2 + 0.5;
  const inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const out: Point[] = [];
  for (let y = t; y <= b; y++) for (let x = l; x <= r; x++) {
    if (!inside(x, y)) continue;
    if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) out.push({ x, y });
  }
  return out;
}

/** Distinct opaque colours (#rrggbb) in an RGBA area, most used first. */
export function usedColors(data: Uint8ClampedArray, limit = 32): string[] {
  const counts = new Map<string, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const c = `#${[data[i]!, data[i + 1]!, data[i + 2]!].map(v => v.toString(16).padStart(2, "0")).join("")}`;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c);
}

/** Replace every pixel of colour `from` with `to` (alpha kept). Returns how many changed. */
export function replaceColor(data: Uint8ClampedArray, from: string, to: string): number {
  const f = [1, 3, 5].map(i => parseInt(from.slice(i, i + 2), 16)), t = [1, 3, 5].map(i => parseInt(to.slice(i, i + 2), 16));
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0 || data[i] !== f[0] || data[i + 1] !== f[1] || data[i + 2] !== f[2]) continue;
    data[i] = t[0]!; data[i + 1] = t[1]!; data[i + 2] = t[2]!; n++;
  }
  return n;
}

/** Rotate the hue of every opaque pixel (色違い): degrees, keeping lightness and saturation. Greys stay grey. */
export function shiftHue(data: Uint8ClampedArray, degrees: number): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const r = data[i]! / 255, g = data[i + 1]! / 255, b = data[i + 2]! / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (d === 0) continue;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (((h * 60 + degrees) % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [rr, gg, bb] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    data[i] = Math.round((rr + m) * 255); data[i + 1] = Math.round((gg + m) * 255); data[i + 2] = Math.round((bb + m) * 255);
  }
}

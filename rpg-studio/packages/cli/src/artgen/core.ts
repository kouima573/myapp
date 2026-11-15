/**
 * Pixel-art toolkit for the procedural asset generator: seeded RNG, tileable noise, colour ramps,
 * an RGBA image with masks, volume shading with ordered dithering, and selective outlines.
 * Everything is pure and deterministic (no Math.random, no time).
 */

/* ------------------------------------------------------------------ RNG */

export type Rng = {
  (): number;
  int(min: number, max: number): number;
  pick<T>(list: readonly T[]): T;
  chance(p: number): boolean;
  range(min: number, max: number): number;
};

export function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic on every platform. */
export function rng(seed: number | string): Rng {
  let a = (typeof seed === "string" ? hashString(seed) : seed >>> 0) || 0x9e3779b9;
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.int = (min, max) => min + Math.floor(next() * (max - min + 1));
  next.pick = list => list[Math.floor(next() * list.length)]!;
  next.chance = p => next() < p;
  next.range = (min, max) => min + next() * (max - min);
  return next;
}

/* ------------------------------------------------------------------ noise */

/** Value noise that wraps every `period` lattice cells, so a texture of size period*cell tiles seamlessly. */
export function tileNoise(seed: number | string, period: number) {
  const r = rng(seed);
  const lattice = Array.from({ length: period * period }, () => r());
  const at = (x: number, y: number) => lattice[(((y % period) + period) % period) * period + (((x % period) + period) % period)]!;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Fractal noise over an image of size `size`, seamless at the borders. Returns 0..1. */
export function fbm(seed: number | string, size: number, octaves: Array<[period: number, weight: number]>) {
  const layers = octaves.map(([period, weight], i) => ({ n: tileNoise(`${seed}:${i}`, period), scale: period / size, weight }));
  const total = octaves.reduce((s, [, w]) => s + w, 0);
  return (x: number, y: number) => layers.reduce((s, l) => s + l.n(x * l.scale, y * l.scale) * l.weight, 0) / total;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Ordered-dither threshold in [0,1) for a pixel. */
export const bayer = (x: number, y: number) => (BAYER4[((y & 3) << 2) | (x & 3)]! + 0.5) / 16;

/* ------------------------------------------------------------------ colour */

export type Color = number; // 0xRRGGBB

export const rgb = (c: Color) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const;
export const pack = (r: number, g: number, b: number): Color => {
  const k = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (k(r) << 16) | (k(g) << 8) | k(b);
};
export const hex = (c: Color) => `#${c.toString(16).padStart(6, "0")}`;
export const parseHex = (s: string): Color => Number.parseInt(s.replace("#", ""), 16);
export function mix(a: Color, b: Color, t: number): Color {
  const [ar, ag, ab] = rgb(a), [br, bg, bb] = rgb(b);
  return pack(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

function toHsl(c: Color): [number, number, number] {
  const [r, g, b] = rgb(c).map(v => v / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number): Color {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return pack((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Lighten (amount > 0) or darken with a hue shift: shadows drift towards violet, highlights towards warm yellow. */
export function shift(c: Color, amount: number): Color {
  const [h, s, l] = toHsl(c);
  if (amount === 0) return c;
  const target = amount > 0 ? 55 : 255;
  let dh = target - h; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
  const hueMove = Math.min(Math.abs(dh), Math.abs(amount) * (s < 0.08 ? 0 : 45)) * Math.sign(dh);
  return fromHsl(h + hueMove, s + (amount > 0 ? -0.12 : 0.1) * Math.abs(amount) * (s < 0.08 ? 0 : 1), l + amount * 0.55 * (amount > 0 ? 1 - l : l) * 1.6);
}

/** A ramp of `n` shades, darkest first, with the base colour in the middle. */
export function ramp(base: Color | string, n = 5, spread = 1): Color[] {
  const c = typeof base === "string" ? parseHex(base) : base;
  const mid = (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => shift(c, ((i - mid) / mid) * 0.5 * spread));
}

/* ------------------------------------------------------------------ image */

export class Img {
  readonly data: Uint8ClampedArray;
  constructor(readonly w: number, readonly h: number) { this.data = new Uint8ClampedArray(w * h * 4); }

  inside(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  alpha(x: number, y: number) { return this.inside(x, y) ? this.data[(y * this.w + x) * 4 + 3]! : 0; }
  get(x: number, y: number): Color { const i = (y * this.w + x) * 4; return pack(this.data[i]!, this.data[i + 1]!, this.data[i + 2]!); }

  set(x: number, y: number, c: Color, a = 255) {
    x = Math.round(x); y = Math.round(y);
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    if (a >= 255) { this.data[i] = (c >> 16) & 255; this.data[i + 1] = (c >> 8) & 255; this.data[i + 2] = c & 255; this.data[i + 3] = 255; return; }
    if (a <= 0) return;
    const da = this.data[i + 3]! / 255, sa = a / 255, oa = sa + da * (1 - sa);
    const [r, g, b] = rgb(c);
    this.data[i] = (r * sa + this.data[i]! * da * (1 - sa)) / oa;
    this.data[i + 1] = (g * sa + this.data[i + 1]! * da * (1 - sa)) / oa;
    this.data[i + 2] = (b * sa + this.data[i + 2]! * da * (1 - sa)) / oa;
    this.data[i + 3] = oa * 255;
  }
  /** Wrapping set (for seamless ground textures). */
  wset(x: number, y: number, c: Color, a = 255) { this.set(((Math.round(x) % this.w) + this.w) % this.w, ((Math.round(y) % this.h) + this.h) % this.h, c, a); }
  clear(x: number, y: number) { if (this.inside(x, y)) this.data.fill(0, (y * this.w + x) * 4, (y * this.w + x) * 4 + 4); }

  rect(x: number, y: number, w: number, h: number, c: Color, a = 255) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, a);
  }
  hline(x0: number, x1: number, y: number, c: Color, a = 255) { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c, a); }
  vline(x: number, y0: number, y1: number, c: Color, a = 255) { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c, a); }
  line(x0: number, y0: number, x1: number, y1: number, c: Color, a = 255) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  /** Darken/lighten what is already there. */
  tint(x: number, y: number, amount: number) {
    if (!this.inside(x, y) || this.alpha(x, y) === 0) return;
    this.set(x, y, shift(this.get(x, y), amount), this.alpha(x, y));
  }

  draw(src: Img, ox: number, oy: number, opts: { flipX?: boolean; alpha?: number } = {}) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const sx = opts.flipX ? src.w - 1 - x : x;
      const a = src.alpha(sx, y);
      if (a) this.set(ox + x, oy + y, src.get(sx, y), opts.alpha === undefined ? a : (a * opts.alpha));
    }
  }
  /** Nearest-neighbour upscale (keeps crisp pixels when the engine halves the size again). */
  scale(k: number): Img {
    const out = new Img(this.w * k, this.h * k);
    for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
      const si = (Math.floor(y / k) * this.w + Math.floor(x / k)) * 4, di = (y * out.w + x) * 4;
      out.data[di] = this.data[si]!; out.data[di + 1] = this.data[si + 1]!; out.data[di + 2] = this.data[si + 2]!; out.data[di + 3] = this.data[si + 3]!;
    }
    return out;
  }
  clone(): Img { const out = new Img(this.w, this.h); out.data.set(this.data); return out; }
  crop(x: number, y: number, w: number, h: number): Img {
    const out = new Img(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (this.inside(x + i, y + j)) { const a = this.alpha(x + i, y + j); if (a) out.set(i, j, this.get(x + i, y + j), a); }
    return out;
  }
  shifted(dx: number, dy: number): Img { const out = new Img(this.w, this.h); out.draw(this, dx, dy); return out; }
}

/* ------------------------------------------------------------------ masks */

export class Mask {
  readonly m: Uint8Array;
  constructor(readonly w: number, readonly h: number) { this.m = new Uint8Array(w * h); }
  has(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.m[y * this.w + x] === 1; }
  on(x: number, y: number) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.m[y * this.w + x] = 1; }
  off(x: number, y: number) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.m[y * this.w + x] = 0; }
  ellipse(cx: number, cy: number, rx: number, ry: number, value = 1) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) value ? this.on(x, y) : this.off(x, y);
    }
    return this;
  }
  rect(x: number, y: number, w: number, h: number, value = 1) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) value ? this.on(x + i, y + j) : this.off(x + i, y + j);
    return this;
  }
  /** Rounded rectangle (r = corner radius in px). */
  rrect(x: number, y: number, w: number, h: number, r: number, value = 1) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const cx = i < r ? r - i - 0.5 : i >= w - r ? i - (w - r) + 0.5 : 0, cy = j < r ? r - j - 0.5 : j >= h - r ? j - (h - r) + 0.5 : 0;
      if (cx * cx + cy * cy <= r * r + 0.3) value ? this.on(x + i, y + j) : this.off(x + i, y + j);
    }
    return this;
  }
  poly(points: Array<[number, number]>, value = 1) {
    const ys = points.map(p => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const py = y + 0.5, xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i]!, [x1, y1] = points[(i + 1) % points.length]!;
        if ((y0 <= py && y1 > py) || (y1 <= py && y0 > py)) xs.push(x0 + ((py - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]! - 0.5); x <= Math.floor(xs[k + 1]! - 0.5); x++) value ? this.on(x, y) : this.off(x, y);
    }
    return this;
  }
  /** Thick line (capsule). */
  stroke(x0: number, y0: number, x1: number, y1: number, r: number, value = 1) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= steps; s++) this.ellipse(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, r, r, value);
    return this;
  }
  union(other: Mask) { for (let i = 0; i < this.m.length; i++) this.m[i] = this.m[i]! | other.m[i]!; return this; }
  subtract(other: Mask) { for (let i = 0; i < this.m.length; i++) if (other.m[i]) this.m[i] = 0; return this; }
  intersect(other: Mask) { for (let i = 0; i < this.m.length; i++) this.m[i] = this.m[i]! & other.m[i]!; return this; }
  clone() { const out = new Mask(this.w, this.h); out.m.set(this.m); return out; }
  mirrorX() { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w / 2; x++) if (this.has(x, y) || this.has(this.w - 1 - x, y)) { this.on(x, y); this.on(this.w - 1 - x, y); } return this; }
  each(fn: (x: number, y: number) => void) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.m[y * this.w + x]) fn(x, y); }
  bounds() {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    this.each((x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    return { x0, y0, x1, y1, cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2, rx: Math.max(1, (x1 - x0 + 1) / 2), ry: Math.max(1, (y1 - y0 + 1) / 2) };
  }
  /** Chamfer distance to the outside of the mask. */
  distance(): Float32Array {
    const { w, h } = this, d = new Float32Array(w * h);
    const INF = 1e6;
    for (let i = 0; i < d.length; i++) d[i] = this.m[i] ? INF : 0;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (d[i]) d[i] = Math.min(d[i]!, at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4, at(x + 1, y - 1) + 1.4); }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (d[i]) d[i] = Math.min(d[i]!, at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4, at(x - 1, y + 1) + 1.4); }
    return d;
  }
}

/* ------------------------------------------------------------------ shading */

export interface ShadeOptions {
  /** How rounded the volume looks (px of bevel). Defaults to a third of the smaller radius. */
  bevel?: number;
  /** Extra global roundness from the bounding ellipse (0..1). */
  round?: number;
  /** Shift the result brighter (+) or darker (−), in ramp steps. */
  bias?: number;
  /** Ordered dithering between ramp steps. */
  dither?: boolean;
  /** Darken the bottom-right rim by one step. */
  rim?: boolean;
  /** Add a specular highlight pixel cluster at the brightest point. */
  gloss?: boolean;
  alpha?: number;
}

const LIGHT = (() => { const v = [-0.55, -0.65, 0.75]; const l = Math.hypot(...v); return v.map(x => x / l) as [number, number, number]; })();

/** Fills `mask` on `img` with a ramp, lit from the top-left, using a distance-field height map. */
export function shade(img: Img, mask: Mask, colors: Color[], opts: ShadeOptions = {}) {
  const b = mask.bounds();
  if (b.x1 < 0) return;
  const dist = mask.distance();
  const bevel = opts.bevel ?? Math.max(1.5, Math.min(b.rx, b.ry) * 0.55);
  const round = opts.round ?? 0.6;
  const height = (x: number, y: number) => {
    if (!mask.has(x, y)) return 0;
    const d = Math.min(dist[y * mask.w + x]!, bevel) / bevel;
    return Math.sqrt(1 - (1 - d) * (1 - d));
  };
  const n = colors.length;
  let best = -Infinity, bx = 0, by = 0;
  mask.each((x, y) => {
    const gx = (height(x + 1, y) - height(x - 1, y)) * 0.5, gy = (height(x, y + 1) - height(x, y - 1)) * 0.5;
    const ex = (x + 0.5 - b.cx) / b.rx, ey = (y + 0.5 - b.cy) / b.ry;
    let nx = -gx * 1.6 + ex * round * 0.6, ny = -gy * 1.6 + ey * round * 0.6, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    let l = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
    // flat-facing surface ≈ middle of the ramp
    let v = 0.5 + (l - LIGHT[2]) * 1.25 + (opts.bias ?? 0) / n;
    if (opts.rim !== false && !mask.has(x + 1, y + 1) && (!mask.has(x, y + 1) || !mask.has(x + 1, y))) v -= 1.0 / n;
    const t = opts.dither === false ? 0.5 : bayer(x, y);
    const idx = Math.max(0, Math.min(n - 1, Math.floor(v * (n - 1) + t)));
    img.set(x, y, colors[idx]!, opts.alpha ?? 255);
    if (v > best) { best = v; bx = x; by = y; }
  });
  if (opts.gloss) { const hi = shift(colors[n - 1]!, 0.5); img.set(bx, by, hi, opts.alpha ?? 255); if (mask.has(bx + 1, by)) img.set(bx + 1, by, hi, opts.alpha ?? 255); }
}

/** Flat fill of a mask. */
export function fill(img: Img, mask: Mask, c: Color, a = 255) { mask.each((x, y) => img.set(x, y, c, a)); }

/**
 * Selective outline: every transparent pixel touching an opaque one becomes a darkened version of its neighbour.
 * `fixed` forces one colour (e.g. a near-black outline for characters).
 */
export function outline(img: Img, opts: { fixed?: Color; amount?: number; diagonal?: boolean } = {}) {
  const src = img.clone();
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (src.alpha(x, y) > 0) continue;
    const near: Array<[number, number]> = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    if (opts.diagonal) near.push([x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]);
    let found: Color | undefined;
    for (const [nx, ny] of near) if (src.alpha(nx, ny) > 128) { found = src.get(nx, ny); break; }
    if (found !== undefined) img.set(x, y, opts.fixed ?? shift(mix(found, 0x1a1420, 0.55), -(opts.amount ?? 0.5)));
  }
}

/** Inner line where two differently coloured opaque regions meet is left to the painter; this darkens pixels under a mask edge (contact shadow). */
export function dropShadow(img: Img, cx: number, cy: number, rx: number, ry: number, strength = 0.35) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d = dx * dx + dy * dy;
    if (d <= 1 && (d < 0.55 || bayer(x, y) > 0.45)) img.tint(x, y, -strength);
  }
}

/** Composite with a contact shadow and outline: the standard way to place an object layer on a tile. */
export function placeObject(base: Img, layer: Img, opts: { shadow?: [number, number, number, number]; outline?: boolean; outlineColor?: Color } = {}) {
  if (opts.shadow) dropShadow(base, ...opts.shadow);
  if (opts.outline !== false) outline(layer, { fixed: opts.outlineColor });
  base.draw(layer, 0, 0);
}

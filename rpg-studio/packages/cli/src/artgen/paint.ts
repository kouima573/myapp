/**
 * Shared painting helpers and the house palette used by tiles, characters, monsters and backgrounds.
 * Drawing happens at a small logical resolution (32×32 for tiles/characters) and is upscaled 2× so the
 * engine's 32px map view shows every pixel exactly.
 */
import { bayer, fbm, Img, Mask, ramp, shade, shift, type Color, type Rng, type ShadeOptions } from "./core";

export const S = 32; // logical tile size

/** House palette: every generator picks from these bases so sheets look like one game. */
export const P = {
  grass: "#5c9a3e", grassDark: "#467f35", leaf: "#3f8a3a", leafDark: "#2f6e3c", pine: "#2f6b48", olive: "#7c8a3a",
  dirt: "#a27a4c", soil: "#7a5534", sand: "#dcc283", snow: "#e6eef6", ice: "#9fd3ea", mud: "#6c4e33", swamp: "#556b3b",
  water: "#3b7cc2", deep: "#2a559a", lava: "#e2561d", cave: "#6d6058", stone: "#8b8a85", stoneDark: "#5f6066", cobble: "#9a958a",
  wood: "#a86d3b", woodDark: "#6f4426", woodLight: "#c99a62", brick: "#a85a40", plaster: "#e4d3ab", slate: "#5e6878",
  gold: "#e6b43c", iron: "#7d8794", red: "#c0413b", blue: "#3f63b8", green: "#3d8b4a", purple: "#7a4aa8", white: "#f2efe6",
  black: "#262230", skin1: "#f3d2b0", skin2: "#e0ab82", skin3: "#b97a52", skin4: "#7e4f34", skin5: "#f0c8a0",
  crystal: "#5fc8e8", amethyst: "#a46ae0", ruby: "#e0465a", bone: "#e8e0c8", straw: "#d6b45a", cloth: "#b84a4a",
} as const;

export const R = (c: keyof typeof P | string | Color, n = 5, spread = 1) => ramp(typeof c === "number" ? c : c in P ? P[c as keyof typeof P] : c, n, spread);

export const layer = (w = S, h = S) => new Img(w, h);
export const mask = (w = S, h = S) => new Mask(w, h);

export function ball(img: Img, cx: number, cy: number, rx: number, ry: number, colors: Color[], opts: ShadeOptions = {}) {
  const m = mask(img.w, img.h).ellipse(cx, cy, rx, ry);
  shade(img, m, colors, opts);
  return m;
}
export function box(img: Img, x: number, y: number, w: number, h: number, colors: Color[], opts: ShadeOptions = {}) {
  const m = mask(img.w, img.h).rect(x, y, w, h);
  shade(img, m, colors, { bevel: 1.5, round: 0.15, ...opts });
  return m;
}
export function rbox(img: Img, x: number, y: number, w: number, h: number, r: number, colors: Color[], opts: ShadeOptions = {}) {
  const m = mask(img.w, img.h).rrect(x, y, w, h, r);
  shade(img, m, colors, { bevel: 2, round: 0.3, ...opts });
  return m;
}
export function poly(img: Img, points: Array<[number, number]>, colors: Color[], opts: ShadeOptions = {}) {
  const m = mask(img.w, img.h).poly(points);
  shade(img, m, colors, opts);
  return m;
}

/** Noise-driven ground texture using the middle shades of a ramp, seamless at the tile border. */
export function ground(img: Img, seed: string, colors: Color[], opts: { lo?: number; hi?: number; octaves?: Array<[number, number]>; contrast?: number } = {}) {
  const n = fbm(seed, img.w, opts.octaves ?? [[4, 1], [8, 0.6], [16, 0.3]]);
  const lo = opts.lo ?? 1, hi = opts.hi ?? colors.length - 2, contrast = opts.contrast ?? 1.6;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const v = Math.max(0, Math.min(0.999, 0.5 + (n(x, y) - 0.5) * contrast));
    const idx = Math.max(lo, Math.min(hi, lo + Math.floor(v * (hi - lo + 1) + (bayer(x, y) - 0.5) * 0.9)));
    img.set(x, y, colors[idx]!);
  }
}

/** Scatter seamless specks: a light pixel with a dark one below (pebbles, sparkles…). */
export function specks(img: Img, r: Rng, count: number, light: Color, dark?: Color) {
  for (let i = 0; i < count; i++) {
    const x = r.int(0, img.w - 1), y = r.int(0, img.h - 1);
    img.wset(x, y, light);
    if (dark !== undefined) img.wset(x, y + 1, dark);
  }
}

/** Grass tufts: two-pixel blades, seamless. */
export function tufts(img: Img, r: Rng, count: number, cols: Color[]) {
  for (let i = 0; i < count; i++) {
    const x = r.int(0, img.w - 1), y = r.int(0, img.h - 1);
    img.wset(x, y + 1, cols[1]!);
    img.wset(x, y, cols[3]!); img.wset(x, y - 1, cols[4]!);
    if (r.chance(0.6)) { img.wset(x + 2, y + 1, cols[1]!); img.wset(x + 2, y, cols[3]!); img.wset(x + 1, y, cols[3]!); }
  }
}

/** A bevelled rectangle drawn directly (for slabs, bricks, planks): light top-left edge, dark bottom-right edge. */
export function slab(img: Img, x: number, y: number, w: number, h: number, cols: Color[], base = 2, opts: { grout?: Color; wrap?: boolean } = {}) {
  const set = (px: number, py: number, c: Color) => (opts.wrap ? img.wset(px, py, c) : img.set(px, py, c));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let c = cols[base]!;
    if (j === 0 || i === 0) c = cols[Math.min(cols.length - 1, base + 1)]!;
    if (j === h - 1 || i === w - 1) c = cols[Math.max(0, base - 1)]!;
    set(x + i, y + j, c);
  }
  if (opts.grout !== undefined) { for (let i = -1; i < w; i++) set(x + i, y - 1, opts.grout); for (let j = -1; j < h; j++) set(x - 1, y + j, opts.grout); }
}

/** Subtle tint over a region using noise (for dirt / moss on top of masonry). */
export function stain(img: Img, seed: string, color: Color, strength: number, threshold = 0.6) {
  const n = fbm(seed, img.w, [[4, 1], [8, 0.5]]);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const v = n(x, y);
    if (v > threshold && bayer(x, y) < (v - threshold) * strength * 6) img.set(x, y, color);
  }
}

export const darker = (c: Color, k = 0.3) => shift(c, -k);
export const lighter = (c: Color, k = 0.3) => shift(c, k);

/** Average colour (for tiles.json fallback colours). */
export function average(img: Img): string {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3]! > 0) { r += img.data[i]!; g += img.data[i + 1]!; b += img.data[i + 2]!; n++; }
  const k = (v: number) => Math.round(v / Math.max(1, n)).toString(16).padStart(2, "0");
  return `#${k(r)}${k(g)}${k(b)}`;
}

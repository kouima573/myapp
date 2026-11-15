/**
 * Tile painters. Each tile is painted at 32×32 and exported at 64×64 (2× nearest), which the engine
 * draws back at 32px — so every painted pixel survives. Ground tiles wrap seamlessly; objects are painted
 * on their own layer with an outline and a contact shadow, then composited onto a ground.
 */
import { bayer, dropShadow, fbm, Img, mix, outline, parseHex, rng, shade, type Color, type Rng } from "./core";
import { ball, box, darker, ground, layer, lighter, mask, P, poly, R, rbox, S, slab, specks, stain, tufts } from "./paint";

export interface TileSpec {
  key: string;
  name: string;
  passable: boolean;
  tags: string[];
  paint: (img: Img, r: Rng) => void;
}
export interface SheetSpec { id: string; title: string; tags: string[]; tiles: TileSpec[] }

type Paint = (img: Img, r: Rng) => void;

/* ================================================================== grounds */

const G = {
  grass(img: Img, r: Rng, base: string = P.grass) {
    const c = R(base);
    ground(img, `grass:${base}:${r.int(0, 999)}`, c, { lo: 1, hi: 3, contrast: 1.4 });
    tufts(img, r, 14, c);
  },
  tallGrass(img: Img, r: Rng) {
    const c = R(P.grassDark);
    ground(img, `tall:${r.int(0, 999)}`, c, { lo: 0, hi: 2 });
    for (let row = 0; row < 8; row++) for (let i = 0; i < 6; i++) {
      const x = i * 6 + (row % 2) * 3 + r.int(-1, 1), y = row * 4 + 3;
      const h = r.int(4, 6);
      for (let k = 0; k < h; k++) { img.wset(x + (k > h - 2 ? 1 : 0), y - k, k > h - 3 ? c[4]! : c[3]!); img.wset(x + 1, y - k + 1, c[1]!); }
      img.wset(x - 1, y - h + 2, c[3]!);
    }
  },
  dirt(img: Img, r: Rng) {
    const c = R(P.dirt);
    ground(img, `dirt:${r.int(0, 999)}`, c, { lo: 1, hi: 3 });
    specks(img, r, 9, c[4]!, c[0]!);
    for (let i = 0; i < 3; i++) { const x = r.int(0, 31), y = r.int(0, 31); img.wset(x, y, c[3]!); img.wset(x + 1, y, c[4]!); img.wset(x, y + 1, c[1]!); img.wset(x + 1, y + 1, c[0]!); }
  },
  soil(img: Img, r: Rng) {
    const c = R(P.soil);
    ground(img, `soil:${r.int(0, 999)}`, c, { lo: 1, hi: 2 });
    for (let y = 2; y < 32; y += 8) for (let x = 0; x < 32; x++) { img.set(x, y, c[3]!); img.set(x, y + 1, c[2]!); img.set(x, y + 4, c[0]!); img.set(x, y + 5, c[1]!); }
  },
  sand(img: Img, r: Rng) {
    const c = R(P.sand, 5, 0.6);
    ground(img, `sand:${r.int(0, 999)}`, c, { lo: 1, hi: 3, octaves: [[4, 1], [16, 0.8]] });
    for (let i = 0; i < 4; i++) { const x = r.int(0, 31), y = r.int(0, 31); for (let k = 0; k < 5; k++) img.wset(x + k, y + (k === 2 ? -1 : 0), c[4]!); }
    specks(img, r, 12, c[0]!);
  },
  snow(img: Img, r: Rng) {
    const c = R(P.snow, 5, 0.5);
    ground(img, `snow:${r.int(0, 999)}`, c, { lo: 2, hi: 4, octaves: [[4, 1], [8, 0.5]] });
    for (let i = 0; i < 4; i++) { const x = r.int(0, 31), y = r.int(0, 31); for (let k = 0; k < 4; k++) img.wset(x + k, y, c[1]!); img.wset(x + 1, y - 1, c[4]!); }
    specks(img, r, 6, 0xffffff);
  },
  ice(img: Img, r: Rng) {
    const c = R(P.ice, 5, 0.8);
    ground(img, `ice:${r.int(0, 999)}`, c, { lo: 1, hi: 3, octaves: [[2, 1], [8, 0.4]] });
    for (let i = 0; i < 3; i++) { const x = r.int(0, 31), y = r.int(0, 31), len = r.int(4, 9); for (let k = 0; k < len; k++) img.wset(x + k, y - k, c[4]!); }
    let x = r.int(0, 31), y = r.int(0, 31);
    for (let k = 0; k < 14; k++) { img.wset(x, y, c[0]!); x += r.int(0, 1); y += r.int(0, 1) ? 1 : 0; if (k % 3 === 0) x++; }
  },
  mud(img: Img, r: Rng) {
    const c = R(P.mud);
    ground(img, `mud:${r.int(0, 999)}`, c, { lo: 1, hi: 3 });
    for (let i = 0; i < 3; i++) {
      const cx = r.int(0, 31), cy = r.int(0, 31), rx = r.int(3, 5), ry = r.int(1, 2);
      for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) img.wset(cx + x, cy + y, y <= -ry + 0 ? c[0]! : c[1]!);
      img.wset(cx - 1, cy, c[4]!); img.wset(cx, cy, c[3]!);
    }
  },
  swamp(img: Img, r: Rng) {
    const c = R(P.swamp);
    ground(img, `swamp:${r.int(0, 999)}`, c, { lo: 0, hi: 2, contrast: 2 });
    const algae = R(P.olive);
    for (let i = 0; i < 18; i++) { const x = r.int(0, 31), y = r.int(0, 31); img.wset(x, y, algae[3]!); img.wset(x + 1, y, algae[2]!); }
    for (let i = 0; i < 4; i++) { const x = r.int(0, 31), y = r.int(0, 31); img.wset(x, y, c[4]!); img.wset(x + 1, y, c[4]!); }
  },
  water(img: Img, r: Rng, base: string = P.water, waves = 10) {
    const c = R(base, 5, 0.8);
    ground(img, `water:${base}:${r.int(0, 999)}`, c, { lo: 1, hi: 2, octaves: [[4, 1], [8, 0.6]], contrast: 2 });
    for (let i = 0; i < waves; i++) {
      const x = r.int(0, 31), y = r.int(0, 31), len = r.int(3, 6);
      for (let k = 0; k < len; k++) img.wset(x + k, y, c[k === 0 || k === len - 1 ? 3 : 4]!);
      for (let k = 1; k < len - 1; k++) img.wset(x + k, y + 1, c[0]!);
    }
  },
  lava(img: Img, r: Rng) {
    const crust = R("#4a2420"), hot = R(P.lava, 5, 1.1);
    const n = fbm(`lava:${r.int(0, 999)}`, 32, [[4, 1], [8, 0.5]]);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const v = n(x, y), ridge = Math.abs(v - 0.5);
      const t = ridge + (bayer(x, y) - 0.5) * 0.05;
      img.set(x, y, t < 0.04 ? hot[4]! : t < 0.08 ? hot[3]! : t < 0.12 ? hot[2]! : t < 0.17 ? crust[3]! : crust[v > 0.5 ? 2 : 1]!);
    }
  },
  cave(img: Img, r: Rng) {
    const c = R(P.cave);
    ground(img, `cave:${r.int(0, 999)}`, c, { lo: 1, hi: 3 });
    for (let i = 0; i < 5; i++) { const x = r.int(0, 31), y = r.int(0, 31); img.wset(x, y, c[3]!); img.wset(x + 1, y, c[4]!); img.wset(x, y + 1, c[0]!); img.wset(x + 1, y + 1, c[1]!); }
    specks(img, r, 8, c[0]!);
  },
  stoneFloor(img: Img, r: Rng, base: string = P.stone) {
    const c = R(base);
    const grout = c[0]!;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) img.set(x, y, grout);
    for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) slab(img, bx * 16 + 1, by * 16 + 1, 15, 15, c, r.int(2, 3) - (r.chance(0.3) ? 1 : 0));
    stain(img, `sf:${r.int(0, 99)}`, c[1]!, 0.4, 0.62);
    specks(img, r, 5, c[1]!);
  },
  cobble(img: Img, r: Rng, base: string = P.cobble) {
    const c = R(base);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) img.set(x, y, c[0]!);
    const rows = [0, 6, 11, 17, 22, 27];
    rows.forEach((y, i) => {
      const h = (rows[i + 1] ?? 32) - y - 1;
      let x = i % 2 ? -3 : 0;
      while (x < 32) { const w = r.int(5, 8); slab(img, x, y, w - 1, h, c, r.int(2, 3), { wrap: true }); x += w; }
    });
    specks(img, r, 4, c[1]!);
  },
  brickRoad(img: Img, r: Rng) {
    const c = R("#b0745a");
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) img.set(x, y, c[0]!);
    for (let row = 0; row < 8; row++) for (let i = 0; i < 4; i++) slab(img, i * 8 + (row % 2) * 4, row * 4, 7, 3, c, r.int(2, 3), { wrap: true });
  },
  wood(img: Img, r: Rng, base: string = P.wood) {
    const c = R(base, 5, 0.9);
    for (let row = 0; row < 4; row++) {
      const y0 = row * 8, seam = (row * 13 + 5) % 32;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) {
        let idx = 2 + (((x * 7 + row * 5) >> 3) % 2 === 0 && bayer(x, y) > 0.8 ? -1 : 0);
        if (y === 0) idx = 3; if (y === 7) idx = 0; if (y === 6) idx = 1;
        img.set(x, y0 + y, c[idx]!);
      }
      for (let y = 0; y < 7; y++) { img.wset(seam, y0 + y, c[0]!); img.wset(seam + 1, y0 + y, c[3]!); }
      for (let k = 0; k < 2; k++) { const gx = r.int(0, 31), gy = y0 + r.int(2, 5), len = r.int(3, 7); for (let i = 0; i < len; i++) img.wset(gx + i, gy, c[1]!); }
    }
  },
  tatami(img: Img) {
    const c = R("#b8b06a", 5, 0.6);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) img.set(x, y, c[(y % 2 === 0 ? 2 : 3) - (x % 8 === 0 ? 1 : 0)]!);
    const edge = R("#3d5a3a");
    for (let x = 0; x < 32; x++) { img.set(x, 0, edge[2]!); img.set(x, 1, edge[1]!); img.set(x, 16, edge[2]!); img.set(x, 17, edge[1]!); }
  },
  carpet(img: Img, r: Rng, base: string = P.red) {
    const c = R(base, 5, 0.8), gold = R(P.gold);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const d = (Math.abs(((x + 8) % 16) - 8) + Math.abs(((y + 8) % 16) - 8));
      img.set(x, y, d === 6 ? gold[2]! : d < 3 ? c[3]! : c[(x + y) % 2 === 0 && bayer(x, y) > 0.7 ? 1 : 2]!);
    }
    void r;
  },
  checker(img: Img, _r: Rng, a: string = "#e8e2d4", b: string = "#4a4a58") {
    const ca = R(a, 5, 0.4), cb = R(b, 5, 0.6);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const dark = ((x >> 3) + (y >> 3)) % 2 === 1, c = dark ? cb : ca, lx = x % 8, ly = y % 8;
      img.set(x, y, c[lx === 0 || ly === 0 ? 3 : lx === 7 || ly === 7 ? 1 : 2]!);
    }
  },
  dungeon(img: Img, r: Rng) { G.stoneFloor(img, r, P.stoneDark); },
  moss(img: Img, r: Rng) {
    G.stoneFloor(img, r, "#7a8070");
    stain(img, `moss:${r.int(0, 99)}`, parseHex("#5a7a3a"), 1.2, 0.5);
    stain(img, `moss2:${r.int(0, 99)}`, parseHex("#6f9446"), 1, 0.62);
  },
};

/* ================================================================== walls */

const W = {
  brick(img: Img, r: Rng, base: string = P.brick) {
    const c = R(base);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) img.set(x, y, mix(c[0]!, 0x9a8a78, 0.35));
    for (let row = 0; row < 8; row++) for (let i = 0; i < 3; i++) slab(img, i * 11 + (row % 2) * 5, row * 4, 10, 3, c, r.int(1, 3), { wrap: true });
  },
  stone(img: Img, r: Rng, base: string = P.stone) {
    const c = R(base);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) img.set(x, y, c[0]!);
    for (let row = 0; row < 4; row++) { let x = row % 2 ? -6 : 0; while (x < 32) { const w = r.int(9, 13); slab(img, x, row * 8, w - 1, 7, c, r.int(2, 3), { wrap: true }); x += w; } }
    stain(img, `sw:${r.int(0, 99)}`, c[1]!, 0.5, 0.6);
  },
  plank(img: Img, r: Rng, base: string = P.wood) {
    const c = R(base);
    for (let i = 0; i < 4; i++) for (let y = 0; y < 32; y++) for (let x = 0; x < 8; x++) img.set(i * 8 + x, y, c[x === 0 ? 3 : x === 7 ? 0 : x === 6 ? 1 : 2]!);
    for (let i = 0; i < 4; i++) { const y = r.int(3, 28); img.set(i * 8 + 3, y, c[0]!); img.set(i * 8 + 4, y, c[1]!); }
    for (let x = 0; x < 32; x++) { img.set(x, 4, c[1]!); img.set(x, 27, c[1]!); }
    for (let i = 0; i < 4; i++) { img.set(i * 8 + 2, 4, c[4]!); img.set(i * 8 + 2, 27, c[4]!); }
  },
  plaster(img: Img, r: Rng) {
    const c = R(P.plaster, 5, 0.6), beam = R(P.woodDark);
    ground(img, `pl:${r.int(0, 99)}`, c, { lo: 2, hi: 3 });
    const beamAt = (x0: number, y0: number, w: number, h: number) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.set(x0 + x, y0 + y, beam[y === 0 || x === 0 ? 3 : y === h - 1 || x === w - 1 ? 1 : 2]!); };
    beamAt(0, 0, 32, 3); beamAt(0, 29, 32, 3); beamAt(0, 0, 3, 32); beamAt(29, 0, 3, 32);
  },
  cave(img: Img, r: Rng) {
    const c = R(P.cave, 6);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) img.set(x, y, c[0]!);
    const lumps: Array<[number, number, number, number]> = [];
    for (let row = 0; row < 4; row++) for (let i = 0; i < 3; i++) lumps.push([i * 11 + (row % 2) * 5 + r.int(-1, 1), row * 8 + 4 + r.int(-1, 1), r.int(6, 8), r.int(4, 5)]);
    for (const [cx, cy, rx, ry] of lumps) for (const ox of [-32, 0, 32]) { const m = mask().ellipse(cx + ox, cy, rx, ry); shade(img, m, c.slice(0, 5), { bevel: 3 }); }
    specks(img, r, 6, c[0]!);
  },
  dungeon(img: Img, r: Rng) {
    const c = R("#5c5a66");
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) img.set(x, y, c[0]!);
    for (let row = 0; row < 4; row++) for (let i = 0; i < 3; i++) slab(img, i * 12 + (row % 2) * 6, row * 8, 11, 7, c, r.int(1, 2), { wrap: true });
    stain(img, `dw:${r.int(0, 99)}`, parseHex("#4c6a46"), 0.7, 0.66);
  },
  ice(img: Img, r: Rng) {
    const c = R("#7fb8dc", 6, 0.9);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) img.set(x, y, c[1]!);
    for (let row = 0; row < 4; row++) { let x = row % 2 ? -5 : 0; while (x < 32) { const w = r.int(8, 12); slab(img, x, row * 8, w - 1, 7, c, 3, { wrap: true }); for (let k = 1; k < 5; k++) img.wset(x + k + 1, row * 8 + 5 - k, c[5]!); x += w; } }
  },
  sandstone(img: Img, r: Rng) { W.stone(img, r, "#c8a46a"); },
};

/* ================================================================== object helpers */

/** Paint an object layer and composite it onto a ground with outline + contact shadow. */
function obj(groundPaint: Paint, draw: (l: Img, r: Rng) => void, shadow?: [number, number, number, number]): Paint {
  return (img, r) => {
    groundPaint(img, r);
    const l = layer();
    draw(l, r);
    if (shadow) dropShadow(img, ...shadow);
    outline(l);
    img.draw(l, 0, 0);
  };
}

const onGrass: Paint = (img, r) => G.grass(img, r);
const onDark: Paint = (img, r) => G.grass(img, r, P.grassDark);
const onWood: Paint = (img, r) => G.wood(img, r);
const onStone: Paint = (img, r) => G.dungeon(img, r);
const onCobble: Paint = (img, r) => G.cobble(img, r);
const onSand: Paint = (img, r) => G.sand(img, r);
const onSnow: Paint = (img, r) => G.snow(img, r);

function clumpCanopy(l: Img, r: Rng, cols: Color[], clumps: Array<[number, number, number]>) {
  // back (top) to front (bottom) so lower clumps overlap upper ones
  for (const [cx, cy, rad] of [...clumps].sort((a, b) => a[1] - b[1])) {
    const m = mask().ellipse(cx, cy, rad, rad * 0.9);
    shade(l, m, cols, { bevel: rad * 0.8, round: 0.8 });
    // leaf texture: a few darker notches
    for (let i = 0; i < 3; i++) { const x = Math.round(cx + r.range(-rad, rad) * 0.6), y = Math.round(cy + r.range(0, rad) * 0.6); if (m.has(x, y)) { l.set(x, y, cols[1]!); l.set(x + 1, y - 1, cols[1]!); } }
  }
}

const trunk = (l: Img, x: number, y0: number, y1: number, w = 4, base: string = P.woodDark) => {
  const c = R(base);
  for (let y = y0; y <= y1; y++) for (let i = 0; i < w; i++) l.set(x + i, y, c[i === 0 ? 3 : i === w - 1 ? 0 : 2 - (y % 3 === 0 && i === 1 ? 1 : 0)]!);
  l.set(x - 1, y1, c[1]!); l.set(x + w, y1, c[0]!);
};

const T = {
  broadleaf: (leaf: string = P.leaf, fruit?: string) => (l: Img, r: Rng) => {
    trunk(l, 14, 20, 29);
    clumpCanopy(l, r, R(leaf), [[16, 7, 7], [9, 12, 6], [23, 12, 6], [12, 17, 6], [21, 17, 6], [16, 13, 7]]);
    if (fruit) { const f = R(fruit); for (const [x, y] of [[10, 12], [20, 9], [22, 17], [14, 18], [17, 6]] as const) { l.set(x, y, f[3]!); l.set(x + 1, y, f[2]!); l.set(x, y + 1, f[1]!); l.set(x + 1, y + 1, f[1]!); l.set(x, y, f[4]!); } }
  },
  pine: (cap = false) => (l: Img) => {
    trunk(l, 14, 25, 30, 4);
    const c = R(P.pine), snow = R(P.snow, 5, 0.4);
    const tiers: Array<[number, number, number]> = [[3, 12, 6], [8, 18, 9], [13, 24, 11], [18, 28, 13]];
    for (const [top, bottom, half] of tiers) {
      const m = mask().poly([[16, top], [16 + half, bottom], [16 - half, bottom]]);
      shade(l, m, c, { bevel: 3, round: 0.5 });
      for (let x = 16 - half + 2; x < 16 + half - 1; x += 3) l.set(x, bottom - 1, c[0]!);
      if (cap) m.each((x, y) => { if (y < top + (bottom - top) * 0.45 + (x % 3 === 0 ? 1 : 0)) l.set(x, y, snow[y < top + 2 ? 4 : x > 16 ? 2 : 3]!); });
    }
  },
  palm: (l: Img) => {
    const t = R("#9a7448");
    for (let i = 0; i < 20; i++) {
      const y = 29 - i, x = 13 + Math.round(Math.sin(i / 7) * 3 + i * 0.15);
      for (let k = 0; k < 4; k++) l.set(x + k, y, t[i % 3 === 0 ? (k === 0 ? 2 : 1) : k === 0 ? 4 : k === 3 ? 1 : 3]!);
    }
    const f = R(P.leaf);
    const fronds: Array<[number, number]> = [[-12, 6], [12, 7], [-9, 11], [10, 12], [-3, 12], [4, 10]];
    for (const [dx, dy] of fronds) {
      const m = mask();
      for (let s = 0; s <= 10; s++) { const t2 = s / 10; m.ellipse(17 + dx * t2, 9 - 4 * t2 + dy * t2 * t2, 2.2 * (1 - t2 * 0.7), 1.6); }
      shade(l, m, f, { bevel: 1.5 });
    }
    ball(l, 16, 11, 2, 2, R("#7a5a2a")); ball(l, 19, 11, 2, 2, R("#7a5a2a"));
  },
  dead: (l: Img) => {
    const c = R("#7a6a5a");
    const m = mask();
    m.stroke(16, 30, 16, 14, 2); m.stroke(16, 18, 9, 9, 1); m.stroke(16, 16, 24, 7, 1); m.stroke(16, 14, 15, 4, 1); m.stroke(11, 12, 6, 12, 0.8); m.stroke(21, 11, 26, 12, 0.8); m.stroke(13, 30, 11, 31, 1); m.stroke(18, 30, 21, 31, 1);
    shade(l, m, c, { bevel: 1.5 });
  },
  bush: (berries?: string) => (l: Img, r: Rng) => {
    clumpCanopy(l, r, R(P.leaf), [[11, 18, 6], [21, 18, 6], [16, 14, 6], [16, 21, 6]]);
    if (berries) { const b = R(berries); for (const [x, y] of [[10, 17], [15, 13], [20, 19], [17, 22], [22, 15]] as const) { l.set(x, y, b[2]!); l.set(x + 1, y, b[1]!); l.set(x, y - 1, b[4]!); } }
  },
};

function rock(l: Img, r: Rng, cx: number, cy: number, rx: number, ry: number, base: string = P.stone) {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; const k = r.range(0.8, 1.05); pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k * (Math.sin(a) > 0 ? 0.8 : 1)]); }
  const m = mask().poly(pts);
  shade(l, m, R(base), { bevel: Math.min(rx, ry) * 0.7, round: 0.9 });
  // a crack
  const x = Math.round(cx + r.range(-rx, rx) * 0.3); let y = Math.round(cy - ry * 0.4);
  for (let k = 0; k < ry * 0.8; k++) { if (m.has(x + (k % 2), y)) l.set(x + (k % 2), y, darker(parseHex(base), 0.45)); y++; }
  return m;
}

function chest(l: Img, open: boolean, base: string = P.wood, trim: string = P.gold) {
  const w = R(base), g = R(trim);
  if (open) {
    box(l, 7, 8, 18, 6, R(darker(parseHex(base), 0.15)));
    l.rect(8, 13, 16, 3, parseHex("#2a1a14"));
    for (const x of [11, 15, 19]) { l.set(x, 14, g[4]!); l.set(x + 1, 14, g[3]!); }
  } else {
    rbox(l, 7, 9, 18, 7, 3, w, { bevel: 2 });
  }
  box(l, 7, 15, 18, 11, w);
  for (const x of [9, 22]) for (let y = open ? 15 : 9; y < 26; y++) { l.set(x, y, g[3]!); l.set(x + 1, y, g[1]!); }
  for (let x = 7; x < 25; x++) { l.set(x, 15, g[2]!); }
  if (!open) { box(l, 15, 14, 3, 4, g); l.set(16, 16, parseHex("#2a1a14")); }
}

function barrel(l: Img, base: string = P.wood) {
  const m = mask().rrect(9, 8, 14, 21, 4);
  shade(l, m, R(base), { round: 1, bevel: 3 });
  for (let x = 10; x < 22; x += 3) for (let y = 10; y < 28; y++) if (m.has(x, y) && bayer(x, y) < 0.5) l.tint(x, y, -0.15);
  const hoop = R(P.iron);
  for (const y of [11, 24]) for (let x = 9; x < 23; x++) if (m.has(x, y)) { l.set(x, y, hoop[x < 13 ? 4 : x > 19 ? 1 : 3]!); l.set(x, y + 1, hoop[1]!); }
  const top = mask().ellipse(16, 9.5, 6, 2);
  shade(l, top, R(lighter(parseHex(base), 0.15)), { bevel: 1 });
}

function crate(l: Img, base: string = P.woodLight) {
  const c = R(base);
  box(l, 7, 9, 18, 18, c);
  const d = c[1]!;
  for (let y = 9; y < 27; y += 6) for (let x = 7; x < 25; x++) l.set(x, y, d);
  for (let k = 0; k < 16; k++) { l.set(8 + k, 25 - k, c[3]!); l.set(9 + k, 25 - k, d); }
  for (const x of [7, 24]) for (let y = 9; y < 27; y++) l.set(x, y, c[x === 7 ? 3 : 0]!);
}

function pot(l: Img, base: string = "#b8683c") {
  const c = R(base);
  ball(l, 16, 20, 7, 7, c, { round: 1, gloss: true });
  box(l, 13, 10, 6, 4, c);
  ball(l, 16, 10, 5, 1.6, R(darker(parseHex(base), 0.2)));
  for (let x = 10; x < 23; x++) if (l.alpha(x, 18)) l.set(x, 18, c[1]!);
}

function torchFlame(l: Img, x: number, y: number) {
  const f = R(P.lava, 5, 1.2);
  const m = mask().poly([[x, y - 6], [x + 3, y], [x, y + 2], [x - 3, y]]);
  shade(l, m, f.slice(2), { bevel: 2, rim: false });
  l.set(x, y - 1, 0xfff6c0); l.set(x, y, 0xfff6c0);
}

/* ================================================================== sheets */

const t = (key: string, name: string, passable: boolean, tags: string[], paint: Paint): TileSpec => ({ key, name, passable, tags, paint });

const ROOF_COLORS: Array<[string, string, string]> = [["red", "赤", "#b04a3a"], ["blue", "青", "#3e62a8"], ["green", "緑", "#4a8a4a"], ["brown", "茶", "#8a5a3a"], ["slate", "灰", "#5e6878"], ["purple", "紫", "#74508e"]];

function roof(base: string): Paint {
  return (img, r) => {
    const c = R(base);
    for (let row = 0; row < 8; row++) {
      const y0 = row * 4, off = (row % 2) * 3;
      for (let x = -6; x < 38; x += 6) {
        for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) {
          const px = x + off + i, py = y0 + j;
          const curve = j === 3 || (j === 2 && (i === 0 || i === 5));
          img.wset(px, py, c[curve ? 0 : j === 0 ? 3 : i === 0 ? 3 : i >= 4 ? 1 : 2]!);
        }
      }
    }
    stain(img, `roof:${base}:${r.int(0, 9)}`, c[1]!, 0.4, 0.68);
  };
}

function thatch(img: Img, r: Rng) {
  const c = R(P.straw);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) img.set(x, y, c[2]!);
  for (let i = 0; i < 90; i++) { const x = r.int(0, 31), y = r.int(0, 31), len = r.int(3, 6); for (let k = 0; k < len; k++) img.wset(x, y + k, c[k === 0 ? 4 : k === len - 1 ? 0 : 3 - (i % 2)]!); }
  for (const y of [7, 15, 23, 31]) for (let x = 0; x < 32; x++) img.set(x, y, c[0]!);
}

function door(wall: Paint, kind: "wood" | "iron" | "arch"): Paint {
  return (img, r) => {
    wall(img, r);
    const frame = R(kind === "iron" ? P.stoneDark : P.stone), body = R(kind === "iron" ? P.iron : P.wood);
    const l = layer();
    if (kind === "arch") { const m = mask().rect(7, 10, 18, 22).union(mask().ellipse(16, 11, 9, 7)); shade(l, m, frame, { bevel: 1.5 }); const d = mask().rect(9, 12, 14, 20).union(mask().ellipse(16, 12, 7, 5)); shade(l, d, body, { bevel: 1, round: 0 }); for (const x of [12, 16, 20]) for (let y = 7; y < 32; y++) if (d.has(x, y)) l.set(x, y, body[0]!); }
    else {
      box(l, 6, 4, 20, 28, frame);
      box(l, 8, 6, 16, 26, body, { bevel: 1, round: 0 });
      for (const x of [12, 16, 20]) for (let y = 7; y < 32; y++) l.set(x, y, body[0]!);
      if (kind === "iron") for (const y of [9, 18, 27]) for (let x = 8; x < 24; x++) { l.set(x, y, body[3]!); if (x % 4 === 1) l.set(x, y, body[4]!); }
    }
    const k = R(P.gold); l.set(21, 20, k[3]!); l.set(21, 21, k[1]!);
    outline(l); img.draw(l, 0, 0);
    for (let x = 8; x < 24; x++) img.set(x, 31, parseHex("#2a2020"));
  };
}

function windowTile(wall: Paint, lit: boolean): Paint {
  return (img, r) => {
    wall(img, r);
    const l = layer(), f = R(P.woodDark);
    box(l, 7, 7, 18, 17, f);
    const glass = R(lit ? "#f0c860" : "#6ea8d8", 5, 0.8);
    for (let y = 9; y < 22; y++) for (let x = 9; x < 23; x++) l.set(x, y, glass[(x - y + 40) % 9 < 2 ? 4 : y < 13 ? 3 : 2]!);
    for (let y = 9; y < 22; y++) l.set(16, y, f[2]!); for (let x = 9; x < 23; x++) l.set(x, 15, f[2]!);
    box(l, 6, 23, 20, 3, R(P.woodLight));
    outline(l); img.draw(l, 0, 0);
  };
}

function stairs(down: boolean, base: string, floor: Paint): Paint {
  return (img, r) => {
    floor(img, r);
    const c = R(base, 6);
    const dark = parseHex("#141018");
    for (let s = 0; s < 6; s++) {
      const y = 2 + s * 5;
      // depth: up-stairs get lighter towards the top, down-stairs sink into darkness towards the bottom
      const fade = down ? s / 6 : (5 - s) / 10;
      for (let x = 5; x < 27; x++) for (let j = 0; j < 5; j++) {
        let col = j < 3 ? c[j === 0 ? 5 : 4]! : c[j === 3 ? 1 : 0]!;
        if (x === 5) col = c[3]!; if (x === 26) col = c[1]!;
        if (bayer(x, y + j) < fade * (down ? 1.1 : 0.6)) col = down ? dark : c[1]!;
        img.set(x, y + j, col);
      }
    }
    for (let y = 1; y < 32; y++) { for (const x of [2, 3, 4]) img.set(x, y, c[x === 2 ? 4 : 2]!); for (const x of [27, 28, 29]) img.set(x, y, c[x === 29 ? 0 : 1]!); }
    for (let x = 2; x < 30; x++) img.set(x, 1, c[5]!);
  };
}

function bridge(vertical: boolean): Paint {
  return (img, r) => {
    G.water(img, r);
    const c = R(P.wood);
    const l = layer();
    for (let k = 0; k < 8; k++) for (let a = 0; a < 4; a++) for (let b = 5; b < 27; b++) {
      const along = k * 4 + a; const idx = a === 0 ? 3 : a === 3 ? 0 : 2;
      vertical ? l.set(b, along, c[idx]!) : l.set(along, b, c[idx]!);
    }
    const rail = R(P.woodDark);
    for (let s = 0; s < 32; s++) for (const p of [4, 27]) { vertical ? l.set(p, s, rail[p === 4 ? 3 : 1]!) : l.set(s, p, rail[p === 4 ? 3 : 1]!); }
    for (const s of [2, 17]) for (const p of [3, 27]) { vertical ? box(l, p, s, 2, 4, rail) : box(l, s, p - 1, 4, 3, rail); }
    img.draw(l, 0, 0);
    for (let s = 0; s < 32; s++) { vertical ? (img.set(3, s, c[0]!), img.set(28, s, 0x1e2a40)) : (img.set(s, 28, 0x1e2a40)); }
  };
}

function shore(side: "n" | "s" | "e" | "w"): Paint {
  return (img, r) => {
    G.water(img, r);
    const grass = layer(); G.grass(grass, r);
    const sand = R(P.sand);
    const n = fbm(`shore:${side}`, 32, [[4, 1]]);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const along = side === "n" || side === "s" ? x : y, depth = side === "n" ? y : side === "s" ? 31 - y : side === "w" ? x : 31 - x;
      const edge = 11 + n(along, 0) * 4;
      if (depth < edge) img.set(x, y, grass.get(x, y));
      else if (depth < edge + 2) img.set(x, y, sand[depth < edge + 1 ? 3 : 2]!);
      else if (depth < edge + 3) img.set(x, y, 0xcfe6f0);
    }
  };
}

export const SHEETS: SheetSpec[] = [
  {
    id: "lib-tiles-field", title: "野外（地面・木・水辺）", tags: ["field", "nature", "outdoor"],
    tiles: [
      t("grass", "草地", true, ["grass", "ground"], (i, r) => G.grass(i, r)),
      t("grass-2", "草地2", true, ["grass", "ground"], (i, r) => { G.grass(i, r); specks(i, r, 6, parseHex("#9ccc6a")); }),
      t("grass-dark", "濃い草地", true, ["grass", "ground"], (i, r) => G.grass(i, r, P.grassDark)),
      t("tall-grass", "背の高い草", true, ["grass", "encounter"], G.tallGrass),
      t("flowers-red", "草花（赤・黄）", true, ["grass", "flower"], (i, r) => { G.grass(i, r); for (let k = 0; k < 7; k++) { const x = r.int(1, 30), y = r.int(1, 30), c = R(k % 2 ? P.red : P.gold); i.wset(x, y - 1, c[3]!); i.wset(x - 1, y, c[3]!); i.wset(x + 1, y, c[2]!); i.wset(x, y + 1, c[1]!); i.wset(x, y, 0xfff4d0); } }),
      t("flowers-blue", "草花（青・白）", true, ["grass", "flower"], (i, r) => { G.grass(i, r); for (let k = 0; k < 7; k++) { const x = r.int(1, 30), y = r.int(1, 30), c = R(k % 2 ? "#6a8ae0" : "#f0f0f0", 5, 0.5); i.wset(x, y - 1, c[3]!); i.wset(x - 1, y, c[3]!); i.wset(x + 1, y, c[2]!); i.wset(x, y + 1, c[1]!); i.wset(x, y, 0xf8e070); } }),
      t("dirt", "土の道", true, ["path", "ground"], G.dirt),
      t("dirt-2", "土の道2", true, ["path", "ground"], (i, r) => { G.dirt(i, r); const c = R(P.dirt); for (let x = 0; x < 32; x++) { i.set(x, 10 + Math.round(Math.sin(x / 5) * 1.5), c[1]!); i.set(x, 22 + Math.round(Math.cos(x / 5) * 1.5), c[1]!); } }),
      t("sand", "砂地", true, ["sand", "desert", "beach"], G.sand),
      t("sand-shells", "貝殻の砂浜", true, ["sand", "beach"], (i, r) => { G.sand(i, r); for (let k = 0; k < 3; k++) { const x = r.int(2, 28), y = r.int(2, 28); i.set(x, y, 0xf6e8e0); i.set(x + 1, y, 0xe8b8b0); i.set(x, y + 1, 0xd89890); i.set(x + 1, y + 1, 0xb87870); } }),
      t("snow", "雪原", true, ["snow", "winter"], G.snow),
      t("snow-2", "雪原2", true, ["snow", "winter"], (i, r) => { G.snow(i, r); const c = R(P.snow, 5, 0.5); for (let k = 0; k < 5; k++) { const x = r.int(0, 31), y = r.int(0, 31); i.wset(x, y, c[1]!); i.wset(x + 2, y + 1, c[1]!); } }),
      t("ice", "氷の床", true, ["ice", "winter"], G.ice),
      t("mud", "ぬかるみ", true, ["mud"], G.mud),
      t("swamp", "沼", true, ["swamp", "encounter"], G.swamp),
      t("soil", "耕した畑", true, ["farm", "ground"], G.soil),
      t("water", "浅い水", false, ["water"], (i, r) => G.water(i, r)),
      t("water-deep", "深い水", false, ["water"], (i, r) => G.water(i, r, P.deep, 5)),
      t("lava", "溶岩", false, ["lava", "volcano"], G.lava),
      t("shore-n", "岸辺（上が陸）", false, ["water", "shore"], shore("n")),
      t("shore-s", "岸辺（下が陸）", false, ["water", "shore"], shore("s")),
      t("shore-w", "岸辺（左が陸）", false, ["water", "shore"], shore("w")),
      t("shore-e", "岸辺（右が陸）", false, ["water", "shore"], shore("e")),
      t("lily", "蓮の葉の水面", false, ["water"], (i, r) => { G.water(i, r); const l = layer(); for (const [x, y] of [[9, 10], [22, 20], [12, 24]] as const) { const m = mask().ellipse(x, y, 4, 3); m.rect(x, y - 3, 1, 3, 0); shade(l, m, R(P.leaf), { bevel: 2 }); } l.set(10, 9, 0xf0a0c0); l.set(11, 9, 0xf8d0e0); outline(l); i.draw(l, 0, 0); }),
      t("reeds", "葦の水辺", false, ["water", "swamp"], (i, r) => { G.water(i, r); const c = R(P.olive); for (let k = 0; k < 9; k++) { const x = 4 + k * 3 + r.int(-1, 1), h = r.int(8, 16); for (let y = 0; y < h; y++) { i.set(x, 30 - y, c[y > h - 3 ? 4 : 2]!); i.set(x + 1, 30 - y, c[1]!); } if (k % 3 === 0) { i.set(x, 30 - h, 0x6a4a2a); i.set(x, 29 - h, 0x8a6a3a); } } }),
      t("tree", "広葉樹", false, ["tree", "forest"], obj(onGrass, T.broadleaf(), [16, 28, 8, 3])),
      t("tree-fruit", "実のなる木", false, ["tree", "forest"], obj(onGrass, T.broadleaf(P.leaf, P.red), [16, 28, 8, 3])),
      t("tree-autumn", "紅葉の木", false, ["tree", "forest", "autumn"], obj(onGrass, T.broadleaf("#c8642c"), [16, 28, 8, 3])),
      t("pine", "針葉樹", false, ["tree", "forest"], obj(onDark, T.pine(), [16, 29, 9, 3])),
      t("pine-snow", "雪の針葉樹", false, ["tree", "winter"], obj(onSnow, T.pine(true), [16, 29, 9, 3])),
      t("palm", "ヤシの木", false, ["tree", "beach", "desert"], obj(onSand, T.palm, [16, 29, 6, 2])),
      t("dead-tree", "枯れ木", false, ["tree", "wasteland"], obj((i, r) => G.dirt(i, r), T.dead, [16, 30, 6, 2])),
      t("bush", "茂み", false, ["bush"], obj(onGrass, T.bush(), [16, 25, 10, 3])),
      t("bush-berry", "木の実の茂み", false, ["bush"], obj(onGrass, T.bush("#4a5ad0"), [16, 25, 10, 3])),
      t("hedge", "生け垣", false, ["hedge", "town"], (i, r) => { G.grass(i, r); const l = layer(); clumpCanopy(l, r, R(P.leafDark), [[-2, 12, 6], [6, 11, 6], [14, 12, 6], [22, 11, 6], [30, 12, 6], [2, 20, 7], [12, 21, 7], [22, 20, 7], [32, 21, 7]]); for (let x = 0; x < 32; x++) for (let y = 24; y < 28; y++) if (!l.alpha(x, y)) l.set(x, y, R(P.leafDark)[0]!); outline(l); i.draw(l, 0, 0); }),
      t("rock", "小岩", false, ["rock"], obj(onGrass, (l, r) => rock(l, r, 16, 19, 8, 6), [16, 24, 9, 3])),
      t("boulder", "大岩", false, ["rock", "pushable"], obj(onGrass, (l, r) => rock(l, r, 16, 17, 12, 11), [16, 26, 13, 4])),
      t("stump", "切り株", false, ["tree"], obj(onGrass, l => { const c = R(P.wood); box(l, 9, 14, 14, 11, R(P.woodDark), { round: 1 }); ball(l, 16, 14, 7, 3, c, { bevel: 2 }); l.set(16, 14, c[1]!); l.set(15, 14, c[3]!); l.set(18, 13, c[1]!); l.set(13, 15, c[1]!); }, [16, 25, 9, 3])),
      t("log", "倒木", false, ["tree"], obj(onGrass, l => { const c = R(P.woodDark); box(l, 4, 15, 22, 9, c, { round: 1 }); ball(l, 26, 19.5, 3, 4.5, R(P.woodLight)); l.set(26, 19, R(P.wood)[1]!); }, [16, 25, 13, 3])),
      t("mushrooms", "キノコの群生", true, ["forest"], obj(onDark, l => { for (const [x, y, s] of [[10, 18, 5], [21, 14, 6], [20, 25, 4]] as const) { box(l, x - 1, y, 3, s + 1, R(P.bone)); ball(l, x + 0.5, y, s, s * 0.7, R(P.red), { gloss: true }); l.set(x - 2, y - 1, 0xffffff); l.set(x + 2, y - 2, 0xffffff); } })),
      t("cactus", "サボテン", false, ["desert"], obj(onSand, l => { const c = R("#4a9a4a"); const m = mask().rrect(13, 6, 6, 23, 3).union(mask().rrect(7, 12, 4, 8, 2)).union(mask().rect(9, 18, 5, 3)).union(mask().rrect(21, 9, 4, 8, 2)).union(mask().rect(18, 15, 5, 3)); shade(l, m, c, { bevel: 2 }); for (let y = 8; y < 28; y += 3) l.set(15, y, c[4]!); }, [16, 29, 6, 2])),
      t("desert-rock", "砂岩", false, ["desert", "rock"], obj(onSand, (l, r) => rock(l, r, 16, 18, 11, 9, "#b88a5a"), [16, 25, 12, 3])),
      t("snow-rock", "雪をかぶった岩", false, ["winter", "rock"], obj(onSnow, (l, r) => { const m = rock(l, r, 16, 18, 11, 9, P.slate); const s = R(P.snow, 5, 0.4); m.each((x, y) => { if (y < 14 + (x % 4 === 0 ? 1 : 0)) l.set(x, y, s[y < 11 ? 4 : 3]!); }); }, [16, 25, 12, 3])),
      t("crops-wheat", "麦畑", false, ["farm"], (i, r) => { G.soil(i, r); const c = R(P.straw); for (let row = 0; row < 4; row++) for (let k = 0; k < 5; k++) { const bx = k * 7 + (row % 2) * 3 - 1, by = row * 8 + 8; for (const dx of [0, 2, 4]) { const h = 6 + ((dx + k + row) % 3); for (let y = 0; y < h; y++) i.wset(bx + dx, by - y, c[y > h - 3 ? 4 : 1 + (dx === 0 ? 1 : 0)]!); i.wset(bx + dx + 1, by - h + 1, c[3]!); i.wset(bx + dx + 1, by - h + 2, c[2]!); i.wset(bx + dx - 1, by - h + 2, c[3]!); } } }),
      t("crops-cabbage", "キャベツ畑", false, ["farm"], (i, r) => { G.soil(i, r); const l = layer(); for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) ball(l, k * 8 + 4 + (row % 2) * 2, row * 8 + 4, 3, 2.6, R("#7cbc4a")); outline(l); i.draw(l, 0, 0); }),
      t("cliff", "崖", false, ["cliff", "rock"], (i, r) => { const c = R("#8a7a66", 6); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) i.set(x, y, c[2]!); for (let band = 0; band < 4; band++) { const y0 = band * 8; for (let x = 0; x < 32; x++) { const off = Math.round(Math.sin((x + band * 7) / 3) * 1); i.set(x, y0 + 6 + off, c[0]!); i.set(x, y0 + 5 + off, c[1]!); i.set(x, y0 + off + 1, c[4]!); } for (let k = 0; k < 4; k++) { const x = r.int(0, 31); for (let y = 1; y < 6; y++) i.wset(x, y0 + y, c[1]!); i.wset(x + 1, y0 + 1, c[3]!); } } }),
      t("cliff-top", "崖の上（草）", false, ["cliff"], (i, r) => { const c = R("#8a7a66", 6); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) i.set(x, y, c[2 - (y > 24 ? 1 : 0)]!); const g = layer(); G.grass(g, r); for (let y = 0; y < 14; y++) for (let x = 0; x < 32; x++) if (y < 11 + Math.round(Math.sin(x / 2.5))) i.set(x, y, g.get(x, y)); for (let x = 0; x < 32; x++) { const yy = 11 + Math.round(Math.sin(x / 2.5)); i.set(x, yy, R(P.grass)[0]!); i.set(x, yy + 1, c[0]!); } for (let k = 0; k < 5; k++) { const x = r.int(0, 31); for (let y = 15; y < 30; y++) i.wset(x, y, c[1]!); } }),
    ],
  },
  {
    id: "lib-tiles-town", title: "町（道・壁・屋根・建具）", tags: ["town", "village", "building"],
    tiles: [
      t("cobble", "石畳", true, ["path", "town"], (i, r) => G.cobble(i, r)),
      t("cobble-warm", "石畳（暖色）", true, ["path", "town"], (i, r) => G.cobble(i, r, "#b09a7a")),
      t("brick-road", "レンガ道", true, ["path", "town"], G.brickRoad),
      t("plaza", "広場の敷石", true, ["path", "town"], (i, r) => G.stoneFloor(i, r, "#b0aa98")),
      t("brick-wall", "レンガ壁", false, ["wall"], (i, r) => W.brick(i, r)),
      t("stone-wall", "石壁", false, ["wall", "castle"], (i, r) => W.stone(i, r)),
      t("sandstone-wall", "砂岩の壁", false, ["wall", "desert"], W.sandstone),
      t("plank-wall", "板壁", false, ["wall"], (i, r) => W.plank(i, r)),
      t("plaster-wall", "漆喰と木組みの壁", false, ["wall"], W.plaster),
      ...ROOF_COLORS.map(([key, name, base]) => t(`roof-${key}`, `屋根（${name}）`, false, ["roof"], roof(base))),
      t("roof-thatch", "わら屋根", false, ["roof"], thatch),
      t("door-wood", "木の扉", true, ["door"], door(W.plaster, "wood")),
      t("door-brick", "レンガ壁の扉", true, ["door"], door((i, r) => W.brick(i, r), "wood")),
      t("door-arch", "アーチの扉", true, ["door", "castle"], door((i, r) => W.stone(i, r), "arch")),
      t("window", "窓", false, ["window"], windowTile(W.plaster, false)),
      t("window-lit", "明かりの窓", false, ["window", "night"], windowTile(W.plaster, true)),
      t("window-brick", "レンガ壁の窓", false, ["window"], windowTile((i, r) => W.brick(i, r), false)),
      t("stairs-up", "上り階段", true, ["stairs"], stairs(false, P.stone, (i, r) => G.cobble(i, r))),
      t("stairs-down", "下り階段", true, ["stairs"], stairs(true, P.stone, (i, r) => G.cobble(i, r))),
      t("bridge-h", "橋（横）", true, ["bridge", "water"], bridge(false)),
      t("bridge-v", "橋（縦）", true, ["bridge", "water"], bridge(true)),
      t("fence", "木の柵", false, ["fence"], obj(onGrass, l => { const c = R(P.woodLight); for (const y of [13, 21]) box(l, 0, y, 32, 3, c, { rim: false }); for (const x of [4, 20]) { box(l, x, 9, 5, 19, R(P.wood)); l.set(x + 1, 9, c[4]!); } })),
      t("fence-iron", "鉄柵", false, ["fence", "town"], obj(onCobble, l => { const c = R(P.iron); for (let x = 1; x < 32; x += 5) { box(l, x, 8, 2, 20, c, { rim: false }); l.set(x, 7, c[4]!); l.set(x + 1, 6, c[3]!); } box(l, 0, 12, 32, 2, c); box(l, 0, 23, 32, 2, c); })),
      t("well", "井戸", false, ["town"], obj(onGrass, l => { const s = R(P.stone); const ring = mask().ellipse(16, 20, 11, 8); shade(l, ring, s, { bevel: 3 }); const hole = mask().ellipse(16, 18, 7, 4.5); shade(l, hole, R("#284868"), { bias: -1 }); for (let x = 6; x < 27; x += 4) { l.set(x, 23, s[0]!); } const w = R(P.woodDark); box(l, 5, 3, 2, 18, w); box(l, 25, 3, 2, 18, w); box(l, 4, 2, 24, 3, R(P.red)); l.vline(16, 5, 12, 0x8a7a5a); box(l, 14, 12, 4, 4, R(P.wood)); }, [16, 26, 12, 4])),
      t("signpost", "立て札", false, ["sign"], obj(onGrass, l => { box(l, 15, 14, 3, 15, R(P.woodDark)); box(l, 6, 6, 21, 10, R(P.woodLight)); const c = R(P.woodDark); for (const y of [9, 12]) for (let x = 9; x < 24; x += 1) if (x % 5 !== 0) l.set(x, y, c[1]!); }, [16, 29, 6, 2])),
      t("lamp", "街灯", false, ["town", "light"], obj(onCobble, l => { const c = R(P.black); box(l, 15, 10, 3, 19, c); box(l, 12, 27, 9, 3, c); box(l, 11, 2, 11, 9, c); const g = R(P.gold); for (let y = 4; y < 9; y++) for (let x = 13; x < 20; x++) l.set(x, y, g[y < 6 ? 4 : 3]!); }, [16, 29, 6, 2])),
      t("fountain", "噴水", false, ["town", "water"], obj(onCobble, l => { const s = R("#b8b4a8"); shade(l, mask().ellipse(16, 21, 14, 9), s, { bevel: 3 }); const w = mask().ellipse(16, 20, 11, 6.5); shade(l, w, R(P.water), { bevel: 3 }); box(l, 14, 8, 4, 12, s); ball(l, 16, 8, 4, 2, s); for (const [x, y] of [[13, 5], [19, 5], [16, 3], [11, 9], [21, 9]] as const) { l.set(x, y, 0xd8f0ff); l.set(x, y + 1, 0x8ac0e8); } }, [16, 28, 14, 3])),
      t("bench", "ベンチ", false, ["town"], obj(onCobble, l => { const c = R(P.wood); box(l, 3, 10, 26, 5, c); box(l, 3, 16, 26, 5, R(P.woodLight)); for (const x of [5, 25]) box(l, x, 20, 2, 7, R(P.woodDark)); }, [16, 27, 13, 3])),
      t("planter", "花壇", false, ["town", "flower"], obj(onCobble, (l, r) => { box(l, 3, 16, 26, 11, R(P.brick)); clumpCanopy(l, r, R(P.leaf), [[8, 15, 4], [16, 14, 5], [24, 15, 4]]); for (const [x, y, c] of [[7, 13, P.red], [15, 11, P.gold], [23, 13, "#e070b0"], [12, 15, "#f0f0f0"], [20, 15, P.red]] as const) { const k = R(c); l.set(x, y, k[4]!); l.set(x + 1, y, k[2]!); l.set(x, y + 1, k[1]!); } }, [16, 28, 14, 2])),
      t("market-stall", "露店", false, ["town", "shop"], obj(onCobble, l => { const a = R(P.red), w = R(P.white); for (let x = 2; x < 30; x++) for (let y = 3; y < 11; y++) l.set(x, y, ((x >> 2) % 2 ? a : w)[y === 3 ? 4 : y > 8 ? 1 : 3]!); for (let x = 2; x < 30; x += 4) { l.set(x + 1, 11, a[1]!); l.set(x + 2, 11, a[1]!); } box(l, 4, 11, 2, 16, R(P.woodDark)); box(l, 26, 11, 2, 16, R(P.woodDark)); box(l, 3, 18, 26, 9, R(P.wood)); for (const [x, c] of [[8, P.red], [13, "#e8a030"], [18, "#7cbc4a"], [23, P.purple]] as const) ball(l, x, 17, 2.4, 2, R(c)); }, [16, 28, 14, 3])),
      t("hay", "干し草", false, ["farm"], obj(onGrass, (l, r) => { const c = R(P.straw); const m = mask().rrect(5, 10, 22, 17, 5); shade(l, m, c, { bevel: 4 }); for (let k = 0; k < 30; k++) { const x = r.int(6, 26), y = r.int(11, 26); if (m.has(x, y)) l.set(x, y, c[k % 2 ? 1 : 4]!); } }, [16, 27, 12, 3])),
      t("gravestone", "墓石", false, ["grave", "graveyard"], obj(onDark, l => { const s = R("#9a9aa0"); const m = mask().rect(9, 12, 14, 16).union(mask().ellipse(16, 12, 7, 6)); shade(l, m, s, { bevel: 2 }); for (let y = 10; y < 22; y++) l.set(16, y, s[0]!); for (let x = 12; x < 21; x++) l.set(x, 14, s[0]!); box(l, 7, 26, 18, 3, R("#7a7a80")); }, [16, 29, 10, 2])),
      t("statue", "石像", false, ["statue"], obj(onCobble, l => { const s = R("#a8a8a0"); box(l, 7, 22, 18, 8, s); const m = mask().ellipse(16, 7, 4, 4).union(mask().rrect(11, 10, 10, 12, 3)).union(mask().stroke(11, 12, 7, 18, 1.5)).union(mask().stroke(21, 12, 24, 4, 1.5)); shade(l, m, s, { bevel: 2 }); box(l, 23, 1, 2, 6, R(P.iron)); }, [16, 30, 11, 2])),
      t("banner-wall", "旗のかかった壁", false, ["wall", "castle"], (i, r) => { W.stone(i, r); const l = layer(); const c = R(P.blue), g = R(P.gold); const m = mask().poly([[9, 2], [23, 2], [23, 26], [16, 22], [9, 26]]); shade(l, m, c, { bevel: 2, round: 0.2 }); for (let y = 9; y < 15; y++) for (let x = 13; x < 20; x++) if (Math.abs(x - 16) + Math.abs(y - 12) < 4) l.set(x, y, g[3]!); box(l, 7, 1, 18, 2, g); outline(l); i.draw(l, 0, 0); }),
      t("barrel-out", "樽（屋外）", false, ["container"], obj(onCobble, l => barrel(l), [16, 29, 8, 2])),
      t("crate-out", "木箱（屋外）", false, ["container", "pushable"], obj(onCobble, l => crate(l), [16, 28, 10, 2])),
      t("anvil", "金床", false, ["town", "shop"], obj(onCobble, l => { const c = R(P.iron); box(l, 6, 12, 20, 5, c); box(l, 3, 12, 5, 3, c); box(l, 12, 17, 8, 6, c); box(l, 9, 23, 14, 4, c); }, [16, 28, 11, 2])),
    ],
  },
  {
    id: "lib-tiles-interior", title: "屋内（床・家具）", tags: ["interior", "house", "shop"],
    tiles: [
      t("floor-wood", "板張りの床", true, ["floor"], (i, r) => G.wood(i, r)),
      t("floor-wood-dark", "濃い板張りの床", true, ["floor"], (i, r) => G.wood(i, r, "#7a4c2c")),
      t("floor-wood-light", "白木の床", true, ["floor"], (i, r) => G.wood(i, r, "#c8a070")),
      t("carpet-red", "赤い絨毯", true, ["floor", "carpet"], (i, r) => G.carpet(i, r)),
      t("carpet-blue", "青い絨毯", true, ["floor", "carpet"], (i, r) => G.carpet(i, r, P.blue)),
      t("carpet-green", "緑の絨毯", true, ["floor", "carpet"], (i, r) => G.carpet(i, r, P.green)),
      t("floor-checker", "市松模様の床", true, ["floor"], (i, r) => G.checker(i, r)),
      t("floor-tile", "タイルの床", true, ["floor"], (i, r) => G.checker(i, r, "#d8d4c8", "#b8b4a8")),
      t("tatami", "畳", true, ["floor", "japanese"], i => G.tatami(i)),
      t("wall-wallpaper", "壁紙の壁", false, ["wall"], (i, r) => { const c = R("#c8b08a", 5, 0.5); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) i.set(x, y, c[(x % 8 === 0 ? 3 : 2) - (((x + 4) % 8 === 0 && y % 4 === 2) ? 1 : 0)]!); const w = R(P.woodDark); for (let x = 0; x < 32; x++) for (let y = 24; y < 32; y++) i.set(x, y, w[y === 24 ? 4 : y === 25 ? 1 : x % 8 === 0 ? 1 : 2]!); void r; }),
      t("wall-stone-in", "石造りの内壁", false, ["wall"], (i, r) => W.stone(i, r, "#9a9488")),
      t("table", "テーブル", false, ["furniture"], obj(onWood, l => { const c = R(P.woodLight); box(l, 3, 8, 26, 12, c); box(l, 3, 19, 26, 3, R(P.wood)); for (const x of [5, 25]) box(l, x, 22, 2, 7, R(P.woodDark)); }, [16, 28, 13, 3])),
      t("table-cloth", "クロスのテーブル", false, ["furniture"], obj(onWood, l => { const c = R(P.white, 5, 0.5); box(l, 3, 8, 26, 16, c); for (let x = 3; x < 29; x += 3) l.set(x, 23, c[1]!); ball(l, 16, 13, 3, 2, R(P.gold)); box(l, 9, 10, 2, 4, R(P.red)); box(l, 22, 10, 2, 4, R(P.red)); }, [16, 27, 13, 3])),
      t("chair", "椅子", false, ["furniture"], obj(onWood, l => { const c = R(P.wood); box(l, 10, 5, 12, 12, c); for (let y = 7; y < 16; y++) l.set(16, y, c[1]!); box(l, 9, 16, 14, 5, R(P.woodLight)); for (const x of [10, 20]) box(l, x, 21, 2, 7, R(P.woodDark)); }, [16, 28, 8, 2])),
      t("stool", "丸椅子", false, ["furniture"], obj(onWood, l => { ball(l, 16, 16, 7, 3, R(P.woodLight)); for (const x of [11, 20]) box(l, x, 18, 2, 9, R(P.woodDark)); }, [16, 28, 8, 2])),
      t("bed", "ベッド", false, ["furniture", "rest"], obj(onWood, l => { const w = R(P.wood); box(l, 5, 1, 22, 6, w); box(l, 5, 6, 22, 24, R(P.woodLight)); rbox(l, 8, 6, 16, 6, 2, R(P.white, 5, 0.5)); box(l, 6, 12, 20, 16, R(P.blue)); for (let x = 6; x < 26; x++) l.set(x, 13, R(P.white, 5, 0.5)[3]!); }, [16, 30, 12, 2])),
      t("bed-red", "ベッド（赤）", false, ["furniture", "rest"], obj(onWood, l => { const w = R(P.woodDark); box(l, 5, 1, 22, 6, w); box(l, 5, 6, 22, 24, R(P.wood)); rbox(l, 8, 6, 16, 6, 2, R(P.white, 5, 0.5)); box(l, 6, 12, 20, 16, R(P.red)); for (let x = 6; x < 26; x++) l.set(x, 13, R(P.gold)[3]!); }, [16, 30, 12, 2])),
      t("bookshelf", "本棚", false, ["furniture", "book"], (i, r) => { G.wood(i, r); const l = layer(); const w = R(P.woodDark); box(l, 2, 0, 28, 31, w); const colors = [P.red, P.blue, P.green, P.gold, P.purple, "#c87a3a", "#3a8a8a"]; for (const y0 of [2, 12, 22]) { for (let x = 4; x < 28;) { const bw = r.int(2, 3), bh = r.int(6, 8), c = R(r.pick(colors)); for (let y = 0; y < bh; y++) for (let k = 0; k < bw; k++) l.set(x + k, y0 + 9 - bh + y, c[k === 0 ? 3 : k === bw - 1 ? 1 : 2]!); l.set(x, y0 + 9 - bh + 2, c[4]!); x += bw; } for (let x = 3; x < 29; x++) { l.set(x, y0 + 9, w[3]!); l.set(x, y0 + 8 + 2, w[1]!); } } outline(l); i.draw(l, 0, 0); }),
      t("counter", "カウンター", false, ["furniture", "shop"], (i, r) => { G.wood(i, r); const l = layer(); box(l, 0, 8, 32, 6, R(P.woodLight), { rim: false }); box(l, 0, 14, 32, 14, R(P.wood), { rim: false }); for (let x = 3; x < 32; x += 8) for (let y = 16; y < 26; y++) l.set(x, y, R(P.wood)[1]!); i.draw(l, 0, 0); for (let x = 0; x < 32; x++) { i.set(x, 7, R(P.woodDark)[0]!); i.set(x, 28, R(P.woodDark)[0]!); } }),
      t("cupboard", "食器棚", false, ["furniture"], (i, r) => { G.wood(i, r); const l = layer(); const w = R(P.wood); box(l, 4, 1, 24, 29, w); box(l, 6, 3, 9, 12, R("#8ab8d8")); box(l, 17, 3, 9, 12, R("#8ab8d8")); for (const x of [8, 11, 19, 23]) { ball(l, x, 8, 1.5, 1.5, R(P.white, 5, 0.5)); } box(l, 6, 17, 20, 11, w); l.set(15, 22, R(P.gold)[3]!); l.set(17, 22, R(P.gold)[3]!); outline(l); i.draw(l, 0, 0); }),
      t("wardrobe", "衣装箪笥", false, ["furniture"], (i, r) => { G.wood(i, r); const l = layer(); const w = R(P.woodDark); box(l, 4, 0, 24, 30, w); box(l, 6, 2, 9, 26, R(P.wood)); box(l, 17, 2, 9, 26, R(P.wood)); l.set(14, 15, R(P.gold)[3]!); l.set(18, 15, R(P.gold)[3]!); outline(l); i.draw(l, 0, 0); }),
      t("fireplace", "暖炉", false, ["furniture", "light"], (i, r) => { W.brick(i, r, "#8a6a5a"); const l = layer(); const s = R(P.stone); box(l, 2, 6, 28, 25, s); box(l, 0, 4, 32, 4, s); box(l, 7, 13, 18, 18, R("#2a1c1c"), { bias: -2 }); for (const [x, h] of [[11, 8], [16, 11], [21, 7]] as const) torchFlame(l, x, 30 - Math.round(h / 3)); box(l, 9, 28, 14, 2, R(P.woodDark)); i.draw(l, 0, 0); }),
      t("stove", "かまど", false, ["furniture", "kitchen"], obj(onWood, l => { const c = R("#5a5a62"); box(l, 4, 8, 24, 21, c); box(l, 8, 17, 16, 8, R("#2a1c1c")); torchFlame(l, 16, 23); ball(l, 12, 9, 4, 2, R(P.black)); ball(l, 22, 9, 3, 2, R(P.iron)); }, [16, 29, 13, 2])),
      t("pot", "壺", false, ["container"], obj(onWood, l => pot(l), [16, 28, 8, 2])),
      t("barrel", "樽", false, ["container"], obj(onWood, l => barrel(l), [16, 29, 8, 2])),
      t("crate", "木箱", false, ["container", "pushable"], obj(onWood, l => crate(l), [16, 28, 10, 2])),
      t("chest", "宝箱", false, ["chest", "container"], obj(onWood, l => chest(l, false, "#b0442e"), [16, 27, 11, 2])),
      t("chest-open", "開いた宝箱", false, ["chest", "container"], obj(onWood, l => chest(l, true, "#b0442e"), [16, 27, 11, 2])),
      t("rug", "敷物", true, ["floor", "carpet"], (i, r) => { G.wood(i, r); const c = R("#a04a5a"), g = R(P.gold); const m = mask().ellipse(16, 16, 14, 11); shade(i, m, c, { bevel: 1, round: 0, dither: true }); m.each((x, y) => { const d = ((x - 16) / 14) ** 2 + ((y - 16) / 11) ** 2; if (d > 0.7 && d < 0.8) i.set(x, y, g[3]!); if (d < 0.12) i.set(x, y, g[2]!); }); }),
      t("plant", "鉢植え", false, ["furniture", "plant"], obj(onWood, (l, r) => { box(l, 11, 19, 10, 9, R("#b8683c")); clumpCanopy(l, r, R(P.leaf), [[12, 14, 5], [20, 14, 5], [16, 9, 6]]); }, [16, 28, 7, 2])),
      t("candle-table", "燭台の小卓", false, ["furniture", "light"], obj(onWood, l => { box(l, 8, 16, 16, 5, R(P.woodLight)); box(l, 10, 21, 2, 7, R(P.woodDark)); box(l, 20, 21, 2, 7, R(P.woodDark)); box(l, 15, 9, 3, 7, R(P.white, 5, 0.5)); torchFlame(l, 16, 7); }, [16, 28, 9, 2])),
      t("clock", "柱時計", false, ["furniture"], (i, r) => { G.wood(i, r); const l = layer(); box(l, 9, 1, 14, 30, R(P.woodDark)); ball(l, 16, 8, 5, 5, R(P.white, 5, 0.4)); l.line(16, 8, 16, 5, 0x262230); l.line(16, 8, 18, 9, 0x262230); box(l, 12, 15, 8, 13, R("#3a2a2a")); ball(l, 16, 24, 2, 2, R(P.gold)); l.vline(16, 15, 22, 0xc89a3a); outline(l); i.draw(l, 0, 0); }),
      t("desk", "書き物机", false, ["furniture", "book"], obj(onWood, l => { box(l, 3, 10, 26, 10, R(P.wood)); box(l, 3, 19, 6, 9, R(P.woodDark)); box(l, 23, 19, 6, 9, R(P.woodDark)); box(l, 7, 11, 9, 6, R(P.white, 5, 0.4)); for (const y of [13, 15]) l.hline(8, 14, y, 0x8a8a9a); box(l, 20, 9, 3, 5, R(P.black)); l.line(21, 9, 24, 4, 0xf0f0f0); }, [16, 28, 13, 2])),
      t("stairs-up-in", "上り階段（屋内）", true, ["stairs"], stairs(false, P.wood, (i, r) => G.wood(i, r))),
      t("stairs-down-in", "下り階段（屋内）", true, ["stairs"], stairs(true, P.wood, (i, r) => G.wood(i, r))),
      t("door-in", "部屋の扉", true, ["door"], door((i, r) => { const c = R("#c8b08a", 5, 0.5); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) i.set(x, y, c[x % 8 === 0 ? 3 : 2]!); void r; }, "wood")),
      t("window-in", "屋内の窓", false, ["window"], windowTile((i, r) => { const c = R("#c8b08a", 5, 0.5); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) i.set(x, y, c[x % 8 === 0 ? 3 : 2]!); void r; }, false)),
    ],
  },
  {
    id: "lib-tiles-dungeon", title: "ダンジョン（洞窟・遺跡・城）", tags: ["dungeon", "cave", "ruins", "castle"],
    tiles: [
      t("dungeon-floor", "ダンジョンの床", true, ["floor"], G.dungeon),
      t("dungeon-floor-cracked", "ひび割れた床", true, ["floor"], (i, r) => { G.dungeon(i, r); const c = R(P.stoneDark); let x = r.int(4, 10), y = 2; while (y < 30) { i.set(x, y, c[0]!); i.set(x + 1, y, c[3]!); y++; x += r.int(-1, 1); if (y % 7 === 0) { for (let k = 1; k < 5; k++) i.set(x + k, y + (k >> 1), c[0]!); } } }),
      t("moss-floor", "苔むした床", true, ["floor", "ruins"], G.moss),
      t("cave-floor", "洞窟の床", true, ["floor", "cave"], G.cave),
      t("cave-floor-2", "洞窟の床2", true, ["floor", "cave"], (i, r) => { G.cave(i, r); const l = layer(); for (const [x, y] of [[8, 9], [23, 14], [12, 24]] as const) rock(l, r, x, y, 4.5, 3.5, "#8a7c70"); outline(l); i.draw(l, 0, 0); }),
      t("castle-floor", "城の床", true, ["floor", "castle"], (i, r) => G.stoneFloor(i, r, "#a09a90")),
      t("cave-wall", "洞窟の壁", false, ["wall", "cave"], W.cave),
      t("dungeon-wall", "ダンジョンの壁", false, ["wall"], W.dungeon),
      t("ice-wall", "氷の壁", false, ["wall", "ice"], W.ice),
      t("wall-torch", "松明の壁", false, ["wall", "light"], (i, r) => { W.dungeon(i, r); const l = layer(); box(l, 14, 14, 4, 10, R(P.woodDark)); box(l, 12, 13, 8, 3, R(P.iron)); torchFlame(l, 16, 10); outline(l); for (let y = 0; y < 20; y++) for (let x = 6; x < 27; x++) { const d = Math.hypot(x - 16, y - 9); if (d < 9 && bayer(x, y) < (9 - d) / 14) i.tint(x, y, 0.25); } i.draw(l, 0, 0); }),
      t("pillar", "石柱", false, ["pillar", "ruins", "castle"], obj((i, r) => G.stoneFloor(i, r, "#a09a90"), l => { const s = R("#b8b2a4"); box(l, 7, 25, 18, 5, s); box(l, 7, 1, 18, 5, s); const m = mask().rect(10, 5, 12, 21); shade(l, m, s, { round: 1, bevel: 3 }); for (const x of [12, 15, 18]) for (let y = 6; y < 25; y++) l.tint(x, y, -0.15); }, [17, 30, 10, 2])),
      t("pillar-broken", "崩れた石柱", false, ["pillar", "ruins"], obj(G.moss, (l, r) => { const s = R("#b8b2a4"); box(l, 7, 24, 18, 6, s); const m = mask().poly([[10, 24], [10, 12], [14, 9], [17, 13], [22, 10], [22, 24]]); shade(l, m, s, { round: 1, bevel: 3 }); rock(l, r, 25, 27, 3, 2, "#b8b2a4"); }, [16, 30, 11, 2])),
      t("altar", "祭壇", false, ["altar", "temple"], obj((i, r) => G.stoneFloor(i, r, "#a09a90"), l => { const s = R("#c8c0b0"); box(l, 4, 12, 24, 16, s); box(l, 2, 10, 28, 4, s); const cl = R(P.purple); box(l, 10, 10, 12, 14, cl); for (let x = 10; x < 22; x++) l.set(x, 23, R(P.gold)[3]!); for (const x of [5, 25]) { box(l, x, 5, 2, 5, R(P.white, 5, 0.4)); torchFlame(l, x + 1, 3); } ball(l, 16, 7, 3, 3, R(P.crystal), { gloss: true }); }, [16, 29, 14, 2])),
      t("statue-dungeon", "守護像", false, ["statue"], obj(G.dungeon, l => { const s = R("#7a7a86"); box(l, 6, 23, 20, 7, s); const m = mask().ellipse(16, 8, 5, 5).union(mask().rrect(10, 11, 12, 13, 3)).union(mask().poly([[9, 13], [3, 9], [6, 18]])).union(mask().poly([[23, 13], [29, 9], [26, 18]])); shade(l, m, s, { bevel: 2 }); l.set(14, 8, 0xe85040); l.set(18, 8, 0xe85040); }, [16, 30, 12, 2])),
      t("crystal-blue", "青い結晶", false, ["crystal", "cave"], obj(G.cave, l => crystals(l, P.crystal), [16, 28, 11, 3])),
      t("crystal-purple", "紫の結晶", false, ["crystal", "cave"], obj(G.cave, l => crystals(l, P.amethyst), [16, 28, 11, 3])),
      t("crystal-red", "赤い結晶", false, ["crystal", "cave"], obj(G.cave, l => crystals(l, P.ruby), [16, 28, 11, 3])),
      t("chest-dungeon", "宝箱（ダンジョン）", false, ["chest"], obj(onStone, l => chest(l, false, "#8a3a3a"), [16, 27, 11, 2])),
      t("chest-dungeon-open", "開いた宝箱（ダンジョン）", false, ["chest"], obj(onStone, l => chest(l, true, "#8a3a3a"), [16, 27, 11, 2])),
      t("chest-iron", "鉄の宝箱", false, ["chest"], obj(onStone, l => chest(l, false, P.iron, P.gold), [16, 27, 11, 2])),
      t("stairs-down-stone", "下り階段（石）", true, ["stairs"], stairs(true, P.stoneDark, G.dungeon)),
      t("stairs-up-stone", "上り階段（石）", true, ["stairs"], stairs(false, P.stoneDark, G.dungeon)),
      t("door-iron", "鉄の扉", true, ["door"], door(W.dungeon, "iron")),
      t("gate", "鉄格子", false, ["door", "gate"], (i, r) => { G.dungeon(i, r); const l = layer(); const c = R(P.iron); for (let x = 2; x < 32; x += 5) box(l, x, 0, 3, 32, c, { rim: false }); for (const y of [4, 26]) box(l, 0, y, 32, 3, c); outline(l); i.draw(l, 0, 0); }),
      t("gate-open", "開いた鉄格子", true, ["door", "gate"], (i, r) => { G.dungeon(i, r); const l = layer(); const c = R(P.iron); box(l, 0, 0, 32, 4, c); for (let x = 2; x < 32; x += 5) box(l, x, 3, 3, 3, c); outline(l); i.draw(l, 0, 0); }),
      t("pit", "穴", false, ["hole"], (i, r) => { G.dungeon(i, r); const m = mask().rrect(3, 4, 26, 25, 6); m.each((x, y) => { const d = y - 4; i.set(x, y, d < 2 ? 0x3a3440 : d < 4 && bayer(x, y) < 0.5 ? 0x2a2430 : 0x0e0c12); }); }),
      t("chasm", "奈落", false, ["hole"], i => { for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) i.set(x, y, bayer(x, y) < 0.08 ? 0x1a1824 : 0x0a0910); }),
      t("spikes", "とげの罠", true, ["trap"], (i, r) => { G.dungeon(i, r); const l = layer(); const c = R(P.iron); for (let row = 0; row < 3; row++) for (let k = 0; k < 4; k++) { const x = 4 + k * 7 + (row % 2) * 3, y = 6 + row * 9; poly(l, [[x, y], [x + 2.5, y + 7], [x - 2.5, y + 7]], c, { bevel: 1 }); } outline(l); i.draw(l, 0, 0); }),
      t("pressure-plate", "感圧板", true, ["trap", "switch"], (i, r) => { G.dungeon(i, r); const l = layer(); box(l, 7, 7, 18, 18, R("#8a8478")); box(l, 10, 10, 12, 12, R("#a09a8a")); outline(l); i.draw(l, 0, 0); }),
      t("lever", "レバー", false, ["switch"], (i, r) => { W.dungeon(i, r); const l = layer(); box(l, 11, 16, 10, 8, R(P.iron)); l.line(16, 18, 21, 8, 0x5a4a3a); l.line(17, 18, 22, 8, 0x7a6a5a); ball(l, 22, 7, 2.5, 2.5, R(P.red), { gloss: true }); outline(l); i.draw(l, 0, 0); }),
      t("bones", "骨の散らばる床", true, ["floor", "graveyard"], obj(G.cave, l => { const b = R(P.bone); const m = mask().stroke(6, 22, 14, 18, 1).union(mask().ellipse(6, 22, 1.8, 1.8)).union(mask().ellipse(14, 18, 1.8, 1.8)).union(mask().stroke(18, 26, 26, 24, 1)); shade(l, m, b, { bevel: 1 }); ball(l, 21, 13, 4, 3.5, b); l.set(19, 13, 0x2a2420); l.set(22, 13, 0x2a2420); l.hline(19, 23, 16, b[1]!); })),
      t("cobweb", "クモの巣", true, ["floor"], (i, r) => { G.dungeon(i, r); for (let k = 0; k < 6; k++) i.line(0, 0, Math.round(Math.cos(k * 0.3) * 20), Math.round(Math.sin(k * 0.3) * 20), 0xd8d8e0, 160); for (const d of [6, 11, 16]) for (let k = 0; k <= 10; k++) { const a = (k / 10) * (Math.PI / 2) * 0.55; i.set(Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d), 0xe8e8f0, 170); } }),
      t("rubble", "瓦礫", false, ["ruins", "rock"], obj(G.dungeon, (l, r) => { for (const [x, y, s] of [[16, 12, 6], [8, 15, 5], [24, 16, 6], [11, 22, 7], [21, 23, 7]] as const) rock(l, r, x, y, s, s * 0.8, "#9a9488"); }, [16, 25, 13, 4])),
      t("magic-circle", "魔法陣", true, ["magic", "warp"], (i, r) => { G.dungeon(i, r); const c = R("#8ae0ff", 5, 0.8); for (let a = 0; a < 360; a += 2) { const rad = (a * Math.PI) / 180; i.set(16 + Math.round(Math.cos(rad) * 13), 16 + Math.round(Math.sin(rad) * 11), c[3]!); i.set(16 + Math.round(Math.cos(rad) * 9), 16 + Math.round(Math.sin(rad) * 7.5), c[2]!); } for (let k = 0; k < 6; k++) { const a1 = (k / 6) * Math.PI * 2, a2 = ((k + 2) / 6) * Math.PI * 2; i.line(16 + Math.cos(a1) * 9, 16 + Math.sin(a1) * 7.5, 16 + Math.cos(a2) * 9, 16 + Math.sin(a2) * 7.5, c[4]!); } i.set(16, 16, 0xffffff); }),
      t("sealed-door", "封印の扉", false, ["door", "magic"], (i, r) => { door(W.dungeon, "iron")(i, r); const c = R(P.purple, 5, 1); for (let a = 0; a < 360; a += 4) { const rad = (a * Math.PI) / 180; i.set(16 + Math.round(Math.cos(rad) * 6), 18 + Math.round(Math.sin(rad) * 6), c[4]!); } i.line(12, 14, 20, 22, c[3]!); i.line(20, 14, 12, 22, c[3]!); }),
      t("water-pool", "地底の泉", false, ["water", "cave"], (i, r) => { G.cave(i, r); const w = layer(); G.water(w, r, "#2c6a9a", 6); const m = mask().rrect(2, 3, 28, 26, 8); m.each((x, y) => i.set(x, y, w.get(x, y))); m.each((x, y) => { if (!m.has(x, y - 1)) { i.set(x, y, 0x1e2a3a); i.set(x, y + 1, 0x24486a); } }); }),
      t("lava-crack", "溶岩の裂け目", false, ["lava", "volcano"], (i, r) => { G.cave(i, r); const h = R(P.lava, 5, 1.1); let x = 4; for (let y = 0; y < 32; y++) { x += r.int(-1, 1); x = Math.max(2, Math.min(28, x)); for (let k = -2; k <= 2; k++) i.set(x + 12 + k, y, Math.abs(k) === 2 ? 0x3a1a14 : h[Math.abs(k) === 1 ? 3 : 4]!); } }),
      t("sarcophagus", "石棺", false, ["graveyard", "ruins"], obj(G.dungeon, l => { const s = R("#9a9488"); rbox(l, 7, 3, 18, 26, 4, s); rbox(l, 9, 5, 14, 22, 3, R("#b0aa9a")); for (let y = 9; y < 22; y++) l.set(16, y, s[1]!); for (let x = 12; x < 21; x++) l.set(x, 12, s[1]!); }, [16, 29, 10, 2])),
      t("brazier", "かがり火", false, ["light"], obj(G.dungeon, l => { const c = R(P.iron); ball(l, 16, 15, 8, 4, c); box(l, 14, 18, 4, 9, c); box(l, 10, 26, 12, 3, c); for (const [x, s] of [[12, 0], [16, -3], [20, 0]] as const) torchFlame(l, x, 11 + s); }, [16, 29, 8, 2])),
    ],
  },
];

function crystals(l: Img, base: string) {
  const c = R(base, 5, 1.1);
  const shards: Array<[number, number, number, number]> = [[16, 4, 4, 24], [10, 12, 3, 25], [22, 10, 3, 25], [6, 18, 2, 26], [26, 17, 2, 26]];
  for (const [x, top, half, bottom] of shards) {
    const m = mask().poly([[x, top], [x + half, top + half + 1], [x + half, bottom], [x - half, bottom], [x - half, top + half + 1]]);
    m.each((px, py) => l.set(px, py, c[px < x ? 4 : px === x ? 3 : 1]!));
    m.each((px, py) => { if (py < top + half + 2 && px < x) l.set(px, py, 0xffffff); });
  }
}

export const TILE_SCALE = 2;

/** Paints one tile at logical size and returns it upscaled to the sheet cell size. */
export function renderTile(spec: TileSpec, sheetId: string): Img {
  const img = new Img(S, S);
  spec.paint(img, rng(`${sheetId}/${spec.key}`));
  return img.scale(TILE_SCALE);
}

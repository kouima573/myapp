/**
 * Battle backgrounds, 640×448 (painted at 320×224, exported 2×). Layered: dithered sky gradient, clouds or
 * stars, far ridges with haze, mid ridges, a perspective ground and theme props.
 */
import { bayer, fbm, Img, Mask, mix, parseHex, rng, shade, tileNoise, type Rng } from "./core";
import { R } from "./paint";

const W = 320, H = 224;
const HORIZON = 132;

export interface BackgroundSpec { id: string; name: string; tags: string[]; paint: (img: Img, r: Rng) => void }

function gradient(img: Img, stops: Array<[number, string]>, y0 = 0, y1 = H) {
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0 - 1);
    let k = 0; while (k < stops.length - 2 && t > stops[k + 1]![0]) k++;
    const [ta, ca] = stops[k]!, [tb, cb] = stops[k + 1]!;
    const local = Math.max(0, Math.min(1, (t - ta) / Math.max(1e-6, tb - ta)));
    // quantise into 6 bands per segment and dither between them
    const bands = 6, q = local * bands, lo = Math.floor(q);
    for (let x = 0; x < W; x++) {
      const step = q - lo > bayer(x, y) ? lo + 1 : lo;
      img.set(x, y, mix(parseHex(ca), parseHex(cb), Math.min(1, step / bands)));
    }
  }
}

function ridge(img: Img, seed: string, base: number, amp: number, period: number, color: string, opts: { haze?: string; hazeAmt?: number; jag?: number; texture?: boolean } = {}) {
  const n = tileNoise(seed, period), n2 = tileNoise(`${seed}:b`, period * 4);
  const c = R(color, 5, 0.7);
  const tops: number[] = [];
  for (let x = 0; x < W; x++) {
    const v = n((x / W) * period, 0.5) * 0.75 + n2((x / W) * period * 4, 0.5) * 0.25 * (opts.jag ?? 1);
    tops.push(Math.round(base - v * amp));
  }
  const tex = fbm(`${seed}:t`, 64, [[8, 1], [16, 0.5]]);
  for (let x = 0; x < W; x++) for (let y = tops[x]!; y < H; y++) {
    let idx = 2;
    const slope = (tops[x + 1] ?? tops[x]!) - (tops[x - 1] ?? tops[x]!);
    if (y - tops[x]! < 3) idx = slope > 0 ? 3 : slope < 0 ? 1 : 2;
    if (opts.texture && tex(x % 64, y % 64) > 0.55 + bayer(x, y) * 0.1) idx -= 1;
    let col = c[Math.max(0, Math.min(4, idx))]!;
    if (opts.haze) { const t = Math.max(0, 1 - (y - tops[x]!) / 40) * (opts.hazeAmt ?? 0.4); col = mix(col, parseHex(opts.haze), t); }
    img.set(x, y, col);
  }
  return tops;
}

function clouds(img: Img, r: Rng, y0: number, y1: number, color: string, count = 6) {
  const c = R(color, 4, 0.4);
  for (let i = 0; i < count; i++) {
    const cx = r.int(0, W), cy = r.int(y0, y1), w = r.int(30, 60);
    const m = new Mask(W, H).ellipse(cx, cy, w * 0.5, 6);
    for (let k = 0; k < 4; k++) m.ellipse(cx + (k - 1.5) * w * 0.22, cy - 4 - (k % 2) * 3, w * 0.16 + (k % 2) * 3, 7 + (k % 2) * 2);
    shade(img, m, c, { bevel: 4, rim: false, round: 0.3 });
  }
}

/** Perspective ground: texture rows get taller towards the viewer. */
function groundPlane(img: Img, seed: string, color: string, y0 = HORIZON, opts: { center?: string; stripes?: boolean } = {}) {
  const c = R(color, 6, 0.9);
  const n = fbm(seed, 128, [[8, 1], [16, 0.6], [32, 0.3]]);
  for (let y = y0; y < H; y++) {
    const depth = (y - y0 + 6) / (H - y0 + 6);
    const sy = 400 / (y - y0 + 6);
    for (let x = 0; x < W; x++) {
      const sx = (x - W / 2) * sy * 0.08;
      const v = n(((sx % 128) + 128) % 128, ((sy * 8) % 128 + 128) % 128);
      let idx = 1 + Math.floor((v * 1.6 - 0.3 + (bayer(x, y) - 0.5) * 0.35) * 3);
      idx += depth > 0.7 ? 1 : 0;
      if (opts.stripes && Math.floor(sy * 4) % 3 === 0) idx -= 1;
      let col = c[Math.max(0, Math.min(5, idx))]!;
      if (opts.center) { const d = Math.abs(x - W / 2) / (W * (0.12 + depth * 0.3)); if (d < 1 && bayer(x, y) < 1 - d * d) col = mix(col, parseHex(opts.center), 0.45); }
      if (y - y0 < 8) col = mix(col, img.get(x, y0 - 1), (8 - (y - y0)) / 16);
      img.set(x, y, col);
    }
  }
}

function treeSilhouette(img: Img, x: number, base: number, h: number, color: string, kind: "round" | "pine" = "round") {
  const m = new Mask(W, H);
  m.rect(Math.round(x - h * 0.05), Math.round(base - h * 0.45), Math.max(2, Math.round(h * 0.1)), Math.round(h * 0.45));
  if (kind === "pine") for (let k = 0; k < 4; k++) { const top = base - h + k * h * 0.18, w = h * (0.18 + k * 0.08); m.poly([[x, top], [x + w, top + h * 0.3], [x - w, top + h * 0.3]]); }
  else for (const [dx, dy, rr] of [[0, -0.75, 0.28], [-0.2, -0.58, 0.22], [0.2, -0.58, 0.22], [0, -0.5, 0.25]] as const) m.ellipse(x + dx * h, base + dy * h, rr * h, rr * h * 0.9);
  shade(img, m, R(color, 5, 0.8), { bevel: Math.max(2, h * 0.08), round: 0.6 });
}

function stars(img: Img, r: Rng, y1: number, count: number) {
  for (let i = 0; i < count; i++) { const x = r.int(0, W - 1), y = r.int(0, y1); const b = r.chance(0.15); img.set(x, y, b ? 0xffffff : 0xc8d0f0); if (b) { img.set(x + 1, y, 0x8890c0); img.set(x - 1, y, 0x8890c0); img.set(x, y - 1, 0x8890c0); img.set(x, y + 1, 0x8890c0); } }
}

function pillar(img: Img, x: number, top: number, bottom: number, w: number, color: string, broken = false) {
  const m = new Mask(W, H);
  m.rect(x, top, w, bottom - top);
  if (broken) for (let k = 0; k < w; k++) for (let y = top; y < top + ((k * 7) % 9); y++) m.off(x + k, y);
  shade(img, m, R(color, 6, 0.8), { bevel: w * 0.4, round: 1 });
  const cap = new Mask(W, H).rect(x - 3, bottom - 6, w + 6, 6);
  if (!broken) cap.rect(x - 3, top, w + 6, 6);
  shade(img, cap, R(color, 6, 0.8), { bevel: 2 });
  for (let k = 1; k < 4; k++) for (let y = top + 7; y < bottom - 7; y++) img.tint(x + Math.round((w * k) / 4), y, -0.12);
}


export const BACKGROUNDS: BackgroundSpec[] = [
  {
    id: "bg-field", name: "草原", tags: ["field", "day", "grass"],
    paint(img, r) {
      gradient(img, [[0, "#5a9ae8"], [0.6, "#a8d4f0"], [1, "#e8f0e0"]], 0, HORIZON);
      clouds(img, r, 20, 80, "#f4f8ff", 7);
      ridge(img, "field-far", HORIZON - 12, 40, 5, "#8aa8c8", { haze: "#c8dcf0", hazeAmt: 0.5 });
      ridge(img, "field-mid", HORIZON + 2, 22, 7, "#5a9a4a", { haze: "#a8d4f0", hazeAmt: 0.25 });
      groundPlane(img, "field-g", "#6aaa48", HORIZON + 6, { center: "#c8a868" });
      for (const [x, h] of [[18, 70], [52, 54], [292, 76], [262, 50]] as const) treeSilhouette(img, x, HORIZON + 10, h, "#3a7a3a");
    },
  },
  {
    id: "bg-forest", name: "深い森", tags: ["forest", "day"],
    paint(img, r) {
      gradient(img, [[0, "#6ab0a0"], [1, "#d0e8c0"]], 0, HORIZON + 20);
      for (let i = 0; i < 18; i++) treeSilhouette(img, r.int(0, W), HORIZON + 4, r.int(70, 110), "#5a8a6a", "pine");
      for (let x = 0; x < W; x++) for (let y = 0; y < HORIZON + 4; y++) if (img.get(x, y) !== 0 && bayer(x, y) < 0.35) img.set(x, y, mix(img.get(x, y), 0xd0e8c0, 0.35));
      for (let i = 0; i < 12; i++) treeSilhouette(img, r.int(0, W), HORIZON + 14, r.int(80, 130), "#2f6a40", i % 3 ? "round" : "pine");
      groundPlane(img, "forest-g", "#4a7a34", HORIZON + 10, { center: "#8a6a3a" });
      for (const x of [8, 40, 280, 312]) { const m = new Mask(W, H).rect(x - 8, 0, 16, H); shade(img, m, R("#4a3424", 5), { bevel: 6, round: 1 }); }
      for (let i = 0; i < 40; i++) { const x = r.int(0, W), y = r.int(0, 40); const m = new Mask(W, H).ellipse(x, y, r.int(14, 26), r.int(8, 14)); shade(img, m, R("#2a5a30", 5), { bevel: 5 }); }
      for (let i = 0; i < 14; i++) { const x = r.int(60, 260), y = r.int(30, HORIZON); for (let k = 0; k < 30; k++) if (bayer(x, y + k) < 0.3) img.set(x + Math.round(k * 0.3), y + k, 0xf0f0c0, 90); }
    },
  },
  {
    id: "bg-cave", name: "洞窟", tags: ["cave", "dungeon", "dark"],
    paint(img, r) {
      gradient(img, [[0, "#1a1418"], [1, "#3a3034"]], 0, H);
      const back = ridge(img, "cave-back", HORIZON + 30, 90, 6, "#4a3e3a", { texture: true });
      void back;
      groundPlane(img, "cave-g", "#5a4c44", HORIZON + 8, { center: "#7a6a5a" });
      for (let x = 0; x < W; x += r.int(10, 22)) { const len = r.int(14, 60), w = r.int(5, 12); const m = new Mask(W, H).poly([[x - w, 0], [x + w, 0], [x + 1, len]]); shade(img, m, R("#5a4c48", 5), { bevel: 3 }); }
      for (let x = 0; x < W; x += r.int(20, 40)) { const len = r.int(10, 30), w = r.int(6, 12); const m = new Mask(W, H).poly([[x - w, H - 30 + r.int(0, 20)], [x + w, H - 30 + r.int(0, 20)], [x, H - 30 - len]]); shade(img, m, R("#6a5a50", 5), { bevel: 3 }); }
      for (const [x, y, c] of [[60, 150, "#5fc8e8"], [250, 160, "#a46ae0"], [140, 170, "#5fc8e8"]] as const) { const m = new Mask(W, H).poly([[x, y - 22], [x + 6, y - 14], [x + 6, y], [x - 6, y], [x - 6, y - 14]]); shade(img, m, R(c, 5, 1.1), { bevel: 3, gloss: true }); for (let yy = y - 30; yy < y + 10; yy++) for (let xx = x - 24; xx < x + 24; xx++) { const d = Math.hypot(xx - x, (yy - y + 10) * 1.3); if (d < 24 && bayer(xx, yy) < (24 - d) / 60) img.set(xx, yy, parseHex(c), 120); } }
    },
  },
  {
    id: "bg-ruins", name: "古代遺跡", tags: ["ruins", "day"],
    paint(img, r) {
      gradient(img, [[0, "#e8b878"], [0.5, "#f0d8a8"], [1, "#f0e8d0"]], 0, HORIZON);
      clouds(img, r, 20, 70, "#f8e8d0", 4);
      ridge(img, "ruin-far", HORIZON - 4, 30, 4, "#b89a7a", { haze: "#f0d8a8", hazeAmt: 0.6 });
      groundPlane(img, "ruin-g", "#a8986a", HORIZON + 6, { center: "#c8b890" });
      for (const [x, top, broken] of [[20, 40, false], [70, 70, true], [236, 60, true], [280, 30, false]] as const) pillar(img, x, top, HORIZON + 26, 22, "#c8bea8", broken);
      const lintel = new Mask(W, H).rect(10, 34, 92, 10).rect(226, 24, 90, 10);
      shade(img, lintel, R("#c8bea8", 6, 0.8), { bevel: 3 });
      for (let i = 0; i < 6; i++) { const x = r.int(100, 220), y = r.int(HORIZON + 30, H - 10); const m = new Mask(W, H).rrect(x, y, r.int(10, 22), r.int(6, 10), 3); shade(img, m, R("#b8ae98", 5), { bevel: 3 }); }
      for (let i = 0; i < 30; i++) { const x = r.int(0, W), y = r.int(30, HORIZON + 26); if (img.get(x, y) !== img.get(x, 0)) { img.set(x, y, 0x5a8a3a); img.set(x + 1, y + 1, 0x4a7a32); } }
    },
  },
  {
    id: "bg-snow", name: "雪山", tags: ["snow", "winter", "mountain"],
    paint(img, r) {
      gradient(img, [[0, "#7aa0d0"], [0.7, "#c8dcf0"], [1, "#eef4fa"]], 0, HORIZON);
      const far = ridge(img, "snow-far", HORIZON - 10, 80, 4, "#8aa0c0", { haze: "#c8dcf0", hazeAmt: 0.5, jag: 2 });
      for (let x = 0; x < W; x++) for (let y = far[x]!; y < far[x]! + 16 + ((x * 7) % 9); y++) img.set(x, y, mix(0xf0f6ff, img.get(x, y), (y - far[x]!) / 30));
      ridge(img, "snow-mid", HORIZON + 6, 26, 6, "#d8e4f0", { haze: "#c8dcf0", hazeAmt: 0.3 });
      groundPlane(img, "snow-g", "#e0eaf4", HORIZON + 10, { center: "#c8d4e8" });
      for (const [x, h] of [[24, 80], [58, 60], [270, 84], [300, 64]] as const) { treeSilhouette(img, x, HORIZON + 20, h, "#2f5a4a", "pine"); }
      for (let i = 0; i < 160; i++) { const x = r.int(0, W), y = r.int(0, H); img.set(x, y, 0xffffff); if (r.chance(0.3)) img.set(x + 1, y, 0xe0e8f8); }
    },
  },
  {
    id: "bg-desert", name: "砂漠", tags: ["desert", "day", "hot"],
    paint(img, r) {
      gradient(img, [[0, "#3a8ad8"], [0.6, "#a8d0e8"], [1, "#f0e0b0"]], 0, HORIZON);
      const sun = new Mask(W, H).ellipse(250, 40, 18, 18); shade(img, sun, R("#fff0a0", 4, 0.5), { bevel: 6, rim: false });
      ridge(img, "desert-far", HORIZON - 2, 24, 3, "#d8a868", { haze: "#f0e0b0", hazeAmt: 0.6 });
      ridge(img, "desert-mid", HORIZON + 14, 30, 4, "#e8bc78", { haze: "#f0e0b0", hazeAmt: 0.2 });
      groundPlane(img, "desert-g", "#e0b878", HORIZON + 20, { stripes: true });
      for (const x of [40, 286]) { const m = new Mask(W, H).rrect(x - 5, HORIZON - 20, 10, 60, 5).rrect(x - 16, HORIZON - 6, 8, 22, 4).rect(x - 12, HORIZON + 10, 8, 5).rrect(x + 8, HORIZON - 12, 8, 20, 4).rect(x + 4, HORIZON + 4, 6, 5); shade(img, m, R("#4a9a4a", 5), { bevel: 3 }); }
      for (let i = 0; i < 5; i++) { const x = r.int(80, 240), y = r.int(HORIZON + 40, H - 8); const m = new Mask(W, H).ellipse(x, y, r.int(6, 12), r.int(4, 6)); shade(img, m, R("#b8885a", 5), { bevel: 3 }); }
      void r;
    },
  },
  {
    id: "bg-castle", name: "城の広間", tags: ["castle", "indoor", "throne"],
    paint(img, r) {
      const wall = R("#6a6470", 6);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img.set(x, y, wall[0]!);
      for (let row = 0; row < 12; row++) for (let i = -1; i < 12; i++) {
        const bx = i * 30 + (row % 2) * 15, by = row * 12;
        for (let y = 0; y < 11; y++) for (let x = 0; x < 29; x++) img.set(bx + x, by + y, wall[y === 0 || x === 0 ? 3 : y === 10 || x === 28 ? 1 : 2 - (bayer(bx + x, by + y) < 0.1 ? 1 : 0)]!);
      }
      for (const x of [40, 160, 280]) {
        const win = new Mask(W, H).rect(x - 14, 30, 28, 60).ellipse(x, 30, 14, 14);
        win.each((px, py) => img.set(px, py, mix(0x8ab8e8, 0xf0f0ff, (90 - py) / 80)));
        for (let y = 18; y < 90; y++) img.set(x, y, 0x3a3440); for (let px = x - 14; px < x + 14; px++) img.set(px, 58, 0x3a3440);
        for (let y = 90; y < 150; y++) for (let px = x - 18 - (y - 90) / 3; px < x + 18 + (y - 90) / 3; px++) if (bayer(Math.round(px), y) < 0.25 * (150 - y) / 60) img.set(Math.round(px), y, 0xf0f0d0, 90);
      }
      for (const x of [100, 220]) { const ban = new Mask(W, H).poly([[x - 12, 10], [x + 12, 10], [x + 12, 90], [x, 80], [x - 12, 90]]); shade(img, ban, R("#a82a3a", 5), { bevel: 3, round: 0.2 }); for (let y = 30; y < 50; y++) for (let k = -4; k <= 4; k++) if (Math.abs(k) + Math.abs(y - 40) < 8) img.set(x + k, y, 0xe8c050); }
      // floor: checker in perspective
      for (let y = 150; y < H; y++) {
        const sy = 600 / (y - 140);
        for (let x = 0; x < W; x++) {
          const sx = ((x - W / 2) * sy) / 60;
          const dark = (Math.floor(sx) + Math.floor(sy * 0.6)) % 2 === 0;
          let col = dark ? 0x4a4450 : 0xa8a0a8;
          if (Math.abs(x - W / 2) < 30 + (y - 150) * 1.2) col = dark ? 0x7a2a34 : 0x9a3440;
          if (y < 156) col = mix(col, 0x2a2430, 0.5);
          img.set(x, y, col);
        }
      }
      for (const x of [16, 304]) pillar(img, x - 11, 0, 160, 22, "#8a8490");
      void r;
    },
  },
  {
    id: "bg-night", name: "月夜の丘", tags: ["night", "field"],
    paint(img, r) {
      gradient(img, [[0, "#0e1230"], [0.7, "#2a3060"], [1, "#4a4a7a"]], 0, HORIZON);
      stars(img, r, HORIZON - 20, 140);
      const moon = new Mask(W, H).ellipse(80, 44, 16, 16); shade(img, moon, R("#f0ecd0", 4, 0.5), { bevel: 6, rim: false });
      for (const [x, y, rr] of [[75, 40, 3], [86, 50, 2], [82, 38, 1.5]] as const) { const c = new Mask(W, H).ellipse(x, y, rr, rr); c.each((px, py) => img.tint(px, py, -0.12)); }
      ridge(img, "night-far", HORIZON - 6, 40, 5, "#2a3050", { haze: "#3a4070", hazeAmt: 0.4 });
      ridge(img, "night-mid", HORIZON + 6, 20, 7, "#1e3a3a");
      groundPlane(img, "night-g", "#2a4a3a", HORIZON + 10, { center: "#3a4a4a" });
      for (const [x, h] of [[22, 80], [298, 90], [270, 56]] as const) treeSilhouette(img, x, HORIZON + 16, h, "#1a2a2a");
      for (let i = 0; i < 12; i++) { const x = r.int(20, 300), y = r.int(HORIZON, H - 10); img.set(x, y, 0xf0f080); img.set(x + 1, y, 0x9a9a40, 160); }
    },
  },
  {
    id: "bg-swamp", name: "霧の沼地", tags: ["swamp", "fog"],
    paint(img, r) {
      gradient(img, [[0, "#7a8a7a"], [1, "#c8d0b8"]], 0, HORIZON + 20);
      for (let i = 0; i < 10; i++) treeSilhouette(img, r.int(0, W), HORIZON + 4, r.int(60, 100), "#6a7a6a");
      groundPlane(img, "swamp-g", "#4a5a3a", HORIZON + 4);
      for (let i = 0; i < 6; i++) { const x = r.int(0, W), y = r.int(HORIZON + 20, H - 10); const m = new Mask(W, H).ellipse(x, y, r.int(30, 60), r.int(6, 12)); m.each((px, py) => img.set(px, py, mix(0x3a5a5a, 0x6a8a80, bayer(px, py) < 0.2 ? 1 : (py - y + 12) / 30))); }
      for (const x of [20, 300]) { const t = new Mask(W, H).stroke(x, H, x + 6, 40, 7).stroke(x + 4, 80, x + 30, 50, 2).stroke(x + 4, 100, x - 24, 70, 2); shade(img, t, R("#3a3a2e", 5), { bevel: 3 }); }
      for (let y = HORIZON - 30; y < H; y++) for (let x = 0; x < W; x++) if (bayer(x, y) < 0.18 * (1 - Math.abs(y - HORIZON) / 90)) img.set(x, y, 0xe0e8e0, 140);
    },
  },
  {
    id: "bg-volcano", name: "火山", tags: ["volcano", "fire", "lava"],
    paint(img, r) {
      gradient(img, [[0, "#2a1418"], [0.6, "#7a2a20"], [1, "#d8602a"]], 0, HORIZON);
      const v = new Mask(W, H).poly([[90, HORIZON + 4], [150, 40], [176, 40], [240, HORIZON + 4]]);
      shade(img, v, R("#3a2a2a", 5), { bevel: 10, round: 0.4 });
      for (let k = 0; k < 6; k++) { let x = 160 + r.int(-8, 8); for (let y = 42; y < HORIZON; y++) { x += r.int(-1, 1); if (bayer(x, y) < 0.9) img.set(x, y, 0xf08030); } }
      for (let i = 0; i < 10; i++) { const m = new Mask(W, H).ellipse(163 + r.int(-30, 30), 30 - i * 3, r.int(10, 18), r.int(6, 9)); shade(img, m, R("#4a3a3a", 4), { bevel: 4, alpha: 200 }); }
      ridge(img, "vol-mid", HORIZON + 8, 24, 6, "#2a2020");
      groundPlane(img, "vol-g", "#3a2a26", HORIZON + 10);
      const lava = tileNoise("vol-lava", 8);
      for (let y = HORIZON + 30; y < H; y++) for (let x = 0; x < W; x++) { const v2 = Math.abs(lava((x / W) * 8, (y / H) * 8 * 2) - 0.5); if (v2 < 0.035) img.set(x, y, v2 < 0.015 ? 0xffe070 : 0xf06a2a); }
      for (let i = 0; i < 40; i++) { const x = r.int(0, W), y = r.int(0, H); img.set(x, y, 0xffa040); }
    },
  },
  {
    id: "bg-beach", name: "海辺", tags: ["beach", "sea", "day"],
    paint(img, r) {
      gradient(img, [[0, "#3aa0e8"], [1, "#c8ecf8"]], 0, HORIZON - 30);
      clouds(img, r, 16, 60, "#ffffff", 5);
      const sea = R("#2a7ac0", 5, 0.7);
      for (let y = HORIZON - 30; y < HORIZON + 30; y++) for (let x = 0; x < W; x++) {
        const t = (y - HORIZON + 30) / 60;
        img.set(x, y, sea[Math.min(4, 1 + Math.floor(t * 2 + bayer(x, y) * 0.8))]!);
        if ((x * 3 + y * 17) % 41 === 0) for (let k = 0; k < 2 + t * 6; k++) img.set(x + k, y, sea[4]!);
      }
      groundPlane(img, "beach-g", "#e8d090", HORIZON + 30);
      for (let x = 0; x < W; x++) { const y = HORIZON + 30 + Math.round(Math.sin(x / 14) * 2); img.set(x, y, 0xffffff); img.set(x, y + 1, 0xd8f0f0); }
      for (const x of [30, 290]) { for (let i = 0; i < 70; i++) { const y = H - i, xx = x + Math.round(Math.sin(i / 20) * 8); for (let k = 0; k < 6; k++) img.set(xx + k, y, R("#9a7448")[k === 0 ? 3 : k > 3 ? 1 : 2]!); } for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const m = new Mask(W, H).stroke(x + 3, H - 72, x + 3 + Math.cos(a) * 30, H - 66 + Math.sin(a) * 12 + 8, 3); shade(img, m, R("#3a8a3a", 5), { bevel: 2 }); } }
    },
  },
  {
    id: "bg-dungeon", name: "地下迷宮", tags: ["dungeon", "indoor", "dark"],
    paint(img, r) {
      const wall = R("#4a4652", 6);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img.set(x, y, wall[0]!);
      for (let row = 0; row < 13; row++) for (let i = -1; i < 10; i++) {
        const bx = i * 36 + (row % 2) * 18, by = row * 12;
        for (let y = 0; y < 11; y++) for (let x = 0; x < 35; x++) img.set(bx + x, by + y, wall[y === 0 || x === 0 ? 3 : y === 10 || x === 34 ? 1 : 2]!);
      }
      const arch = new Mask(W, H).rect(120, 50, 80, 110).ellipse(160, 50, 40, 36);
      arch.each((x, y) => img.set(x, y, mix(0x0a080e, 0x2a2430, Math.max(0, (y - 20) / 200))));
      for (const x of [60, 260]) { const m = new Mask(W, H).rect(x - 3, 70, 6, 18); shade(img, m, R("#5a4030", 4), { bevel: 2 }); const f = new Mask(W, H).poly([[x, 54], [x + 6, 68], [x, 72], [x - 6, 68]]); shade(img, f, R("#f08030", 4, 1.2), { bevel: 3, rim: false }); for (let y = 30; y < 120; y++) for (let xx = x - 50; xx < x + 50; xx++) { const d = Math.hypot(xx - x, y - 66); if (d < 50 && bayer(xx, y) < (50 - d) / 120) img.set(xx, y, 0xf0a050, 70); } }
      groundPlane(img, "dun-g", "#5a5660", 160);
      for (let i = 0; i < 4; i++) { const x = r.int(20, 300), y = r.int(170, 214); const b = new Mask(W, H).stroke(x, y, x + 10, y - 2, 1.5).ellipse(x, y, 2, 2).ellipse(x + 10, y - 2, 2, 2); shade(img, b, R("#e8e0c8", 4), { bevel: 1 }); }
    },
  },
];

export function renderBackground(spec: BackgroundSpec): Img {
  const img = new Img(W, H);
  spec.paint(img, rng(`bg/${spec.id}`));
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  return img.scale(2);
}

/* ------------------------------------------------------------------ 戦闘背景作り（設定から組み立てる） */

/** A battle background built from settings (sky, clouds or stars, ridges, ground, trees, ruins). */
export interface BackgroundDesign {
  id: string;
  name: string;
  skyTop: string;
  skyHorizon: string;
  /** clouds = 雲, stars = 星, none = なし */
  sky: "clouds" | "stars" | "none";
  cloudColor?: string;
  /** 遠くの山（null = なし） */
  far?: string | null;
  /** 近くの丘（null = なし） */
  mid?: string | null;
  ground: string;
  /** 地面の中央の道（null = なし） */
  path?: string | null;
  trees?: { kind: "round" | "pine"; color: string; count: number } | null;
  /** 遺跡の柱 */
  pillars?: string | null;
  seed?: number;
}

export const BACKGROUND_PRESETS: BackgroundDesign[] = [
  { id: "meadow", name: "晴れた草原", skyTop: "#5a9ae8", skyHorizon: "#e8f0e0", sky: "clouds", cloudColor: "#f4f8ff", far: "#8aa8c8", mid: "#5a9a4a", ground: "#6aaa48", path: "#c8a868", trees: { kind: "round", color: "#3a7a3a", count: 4 } },
  { id: "night-woods", name: "夜の森", skyTop: "#0e1430", skyHorizon: "#3a3a6a", sky: "stars", far: "#2a3050", mid: "#1e3a2e", ground: "#22402a", path: null, trees: { kind: "pine", color: "#0e2418", count: 7 } },
  { id: "dusk-ruins", name: "夕暮れの遺跡", skyTop: "#5a3a7a", skyHorizon: "#f0a060", sky: "clouds", cloudColor: "#f0c0a0", far: "#7a5a7a", mid: null, ground: "#8a7a5a", path: "#b8a888", pillars: "#c8bca8" },
  { id: "snowfield", name: "雪原", skyTop: "#8ab0d8", skyHorizon: "#f0f4fa", sky: "clouds", cloudColor: "#ffffff", far: "#b8c8e0", mid: "#e0e8f0", ground: "#eef2f8", path: "#c8d0dc", trees: { kind: "pine", color: "#3a5a5a", count: 5 } },
  { id: "desert", name: "砂漠", skyTop: "#4a8ad8", skyHorizon: "#f0e0b8", sky: "none", far: "#d8b888", mid: "#e0c088", ground: "#e8c890", path: null },
];

export function renderBackgroundDesign(d: BackgroundDesign): Img {
  const img = new Img(W, H);
  const r = rng(`bg-design/${d.id}/${d.seed ?? 0}`);
  gradient(img, [[0, d.skyTop], [1, d.skyHorizon]], 0, HORIZON + 6);
  if (d.sky === "clouds") clouds(img, r, 20, 80, d.cloudColor ?? "#f4f8ff", 7);
  if (d.sky === "stars") stars(img, r, HORIZON - 20, 90);
  if (d.far) ridge(img, `${d.id}-far-${d.seed ?? 0}`, HORIZON - 12, 40, 5, d.far, { haze: d.skyHorizon, hazeAmt: 0.5 });
  if (d.mid) ridge(img, `${d.id}-mid-${d.seed ?? 0}`, HORIZON + 2, 22, 7, d.mid, { haze: d.skyHorizon, hazeAmt: 0.25 });
  groundPlane(img, `${d.id}-g-${d.seed ?? 0}`, d.ground, HORIZON + 6, d.path ? { center: d.path } : {});
  if (d.pillars) for (const [x, top, broken] of [[40, 50, false], [86, 74, true], [228, 60, true], [276, 46, false]] as const) pillar(img, x, top, HORIZON + 16, 14, d.pillars, broken);
  if (d.trees && d.trees.count > 0) {
    const xs = [18, 292, 52, 262, 86, 230, 120, 196].slice(0, Math.min(8, d.trees.count));
    xs.forEach((x, i) => treeSilhouette(img, x + r.int(-4, 4), HORIZON + 10, (d.trees!.kind === "pine" ? 64 : 56) + ((i * 37) % 22), d.trees!.color, d.trees!.kind));
  }
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  return img.scale(2);
}

/**
 * Monster sprites: 64×64 cells, 4 idle frames in one row (the layout drawEnemyPortrait cycles through).
 * Families are built from shaded masks; palette variants make the rest. Painted at native 64px.
 */
import { Img, Mask, outline, parseHex, shade, shift, type Color } from "./core";
import { P, R } from "./paint";

const N = 64;
const OUT = parseHex("#1f1822");
const m = () => new Mask(N, N);
type Pal = { body: string; dark?: string; accent?: string; eye?: string };
export interface MonsterSpec { id: string; name: string; tags: string[]; family: string; pal: Pal; extra?: string }

function sh(img: Img, mask: Mask, base: string | Color[], opts: Parameters<typeof shade>[3] = {}) {
  shade(img, mask, typeof base === "string" ? R(base, 6) : base, { bevel: 6, round: 0.7, ...opts });
}
function eye(img: Img, x: number, y: number, r: number, iris: string = "#2a2034", white = true) {
  if (white) sh(img, m().ellipse(x, y, r, r * 1.1), R("#f4f0f0", 4, 0.4), { bevel: 2, rim: false });
  const pr = white ? Math.max(1, r * 0.55) : r;
  sh(img, m().ellipse(x + (white ? 0.5 : 0), y + (white ? 0.5 : 0), pr, pr * 1.15), R(iris, 4), { bevel: 1, rim: false });
  img.set(Math.round(x - pr * 0.3), Math.round(y - pr * 0.4), 0xffffff);
}
function shadow(img: Img, cx: number, cy: number, rx: number, ry = 3) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
    if (d <= 1 && !img.alpha(x, y)) img.set(x, y, 0x101018, 80);
  }
}
const finish = (img: Img) => { outline(img, { fixed: OUT }); return img; };
const bobOf = (f: number) => [0, -1, -2, -1][f]!;
const flapOf = (f: number) => [0, 1, 2, 1][f]!;

const FAMILIES: Record<string, (f: number, p: Pal, extra?: string) => Img> = {
  slime(f, p, extra) {
    const img = new Img(N, N);
    const squash = [0, 1, 2, 1][f]!;
    const w = 20 + squash, h = 17 - squash;
    const base = 56;
    const body = m().ellipse(32, base - h, w, h + 2);
    for (let y = base; y < N; y++) for (let x = 0; x < N; x++) body.off(x, y);
    body.poly([[32 - 3, base - h * 2 - 1], [32 + 4, base - h * 2 - 6 + squash], [32 + 5, base - h * 2 + 2]]);
    sh(img, body, p.body, { bevel: 9, round: 0.9, gloss: true });
    // inner glossy highlight
    for (const [dx, dy] of [[-10, -9], [-9, -10], [-8, -10], [-11, -8], [-11, -7]] as const) img.set(32 + dx, base - h + dy + 2, 0xffffff, 220);
    eye(img, 25, base - h + 2, 3.2, p.eye ?? "#1a1420"); eye(img, 39, base - h + 2, 3.2, p.eye ?? "#1a1420");
    const mouth = R(p.dark ?? shiftHex(p.body, -0.6), 4);
    for (let x = 28; x <= 36; x++) img.set(x, base - h + 8 + (x === 28 || x === 36 ? -1 : 0), mouth[0]!);
    if (extra === "crown") { const c = m().rect(25, base - h * 2 - 4, 14, 5); for (const dx of [25, 30, 35]) c.poly([[dx, base - h * 2 - 4], [dx + 2, base - h * 2 - 9], [dx + 4, base - h * 2 - 4]]); sh(img, c, P.gold, { bevel: 2, gloss: true }); }
    shadow(img, 32, base + 2, w + 2);
    return finish(img);
  },
  bat(f, p) {
    const img = new Img(N, N);
    const y0 = 28 + bobOf(f) * 2, flap = [0, 6, 10, 6][f]!;
    for (const side of [-1, 1]) {
      const wing = m().poly([[32 + side * 6, y0 - 4], [32 + side * 26, y0 - 12 + flap], [32 + side * 28, y0 + 2 + flap * 0.6], [32 + side * 22, y0 + 0 + flap * 0.5], [32 + side * 18, y0 + 6 + flap * 0.4], [32 + side * 12, y0 + 2], [32 + side * 6, y0 + 6]]);
      sh(img, wing, p.dark ?? shiftHex(p.body, -0.3), { bevel: 3, round: 0.3 });
      for (const t of [0.45, 0.75]) img.line(32 + side * 7, y0 - 3, 32 + side * (6 + 22 * t), y0 + 4 + flap * 0.5 * t, R(p.body, 6)[0]!);
    }
    const body = m().ellipse(32, y0, 9, 10);
    body.poly([[24, y0 - 6], [26, y0 - 17], [30, y0 - 8]]).poly([[40, y0 - 6], [38, y0 - 17], [34, y0 - 8]]);
    sh(img, body, p.body, { bevel: 5 });
    eye(img, 28.5, y0 - 2, 2.5, p.eye ?? "#e83a3a", false); eye(img, 35.5, y0 - 2, 2.5, p.eye ?? "#e83a3a", false);
    img.set(30, y0 + 4, 0xffffff); img.set(34, y0 + 4, 0xffffff); img.set(30, y0 + 5, 0xd0d0d0); img.set(34, y0 + 5, 0xd0d0d0);
    shadow(img, 32, 58, 10, 2);
    return finish(img);
  },
  wolf(f, p, extra) {
    const img = new Img(N, N);
    const breathe = [0, 0, 1, 1][f]!;
    const tail = m().stroke(50, 36, 58, 24 - breathe * 2, 3.5);
    sh(img, tail, p.dark ?? p.body);
    for (const x of [44, 48]) sh(img, m().rect(x, 44, 5, 13), p.dark ?? shiftHex(p.body, -0.25), { bevel: 2 });
    const body = m().ellipse(38, 38 - breathe, 15, 10);
    sh(img, body, p.body, { bevel: 7 });
    for (const x of [24, 30]) sh(img, m().rect(x, 44, 5, 14), p.body, { bevel: 2 });
    const head = m().ellipse(22, 27 - breathe, 11, 10).poly([[10, 28 - breathe], [4, 33 - breathe], [12, 36 - breathe], [20, 34 - breathe]]);
    head.poly([[15, 22 - breathe], [16, 9 - breathe], [23, 18 - breathe]]).poly([[25, 19 - breathe], [30, 8 - breathe], [32, 21 - breathe]]);
    sh(img, head, p.body, { bevel: 5 });
    sh(img, m().ellipse(5.5, 32 - breathe, 2, 1.8), "#2a2026", { bevel: 1 });
    if (extra === "tusks") { sh(img, m().poly([[12, 35 - breathe], [8, 28 - breathe], [15, 34 - breathe]]), P.bone, { bevel: 1 }); }
    else for (let x = 8; x < 18; x += 3) { img.set(x, 35 - breathe, 0xffffff); }
    eye(img, 19, 25 - breathe, 2.2, p.eye ?? "#f0c030", false);
    if (p.accent) for (let k = 0; k < 6; k++) img.line(30 + k * 3, 30 - breathe, 28 + k * 3, 36 - breathe, R(p.accent, 6)[3]!);
    shadow(img, 36, 58, 22, 3);
    return finish(img);
  },
  bird(f, p) {
    const img = new Img(N, N);
    const y0 = 32 + bobOf(f), flap = [0, 5, 9, 5][f]!;
    sh(img, m().poly([[38, y0 + 4], [54, y0 + 12], [52, y0 + 16], [36, y0 + 10]]), p.dark ?? shiftHex(p.body, -0.3), { bevel: 2 });
    const back = m().poly([[34, y0 - 4], [56, y0 - 18 + flap * 1.6], [50, y0 + 2 + flap * 0.5], [36, y0 + 4]]);
    sh(img, back, p.dark ?? shiftHex(p.body, -0.3), { bevel: 3 });
    const body = m().ellipse(30, y0 + 2, 13, 11);
    sh(img, body, p.body, { bevel: 6, gloss: true });
    sh(img, m().ellipse(27, y0 + 6, 8, 6), p.accent ?? shiftHex(p.body, 0.5), { bevel: 3, rim: false });
    const head = m().ellipse(20, y0 - 9, 8, 7.5);
    head.poly([[18, y0 - 15], [22, y0 - 24], [25, y0 - 15]]);
    sh(img, head, p.body, { bevel: 4 });
    sh(img, m().poly([[13, y0 - 10], [4, y0 - 7], [13, y0 - 5]]), P.gold, { bevel: 1 });
    eye(img, 18, y0 - 10, 2.3, p.eye ?? "#1a1420");
    const front = m().poly([[30, y0 - 4], [12 - flap * 0.3, y0 - 20 + flap * 2.5], [18, y0 + 2 + flap * 0.4], [32, y0 + 6]]);
    sh(img, front, p.body, { bevel: 3 });
    for (const x of [26, 33]) { img.line(x, y0 + 12, x, y0 + 18, parseHex(P.gold)); img.line(x - 2, y0 + 19, x + 2, y0 + 19, parseHex(P.gold)); }
    shadow(img, 30, 58, 13, 2);
    return finish(img);
  },
  golem(f, p) {
    const img = new Img(N, N);
    const b = [0, 0, 1, 1][f]!;
    const stone = R(p.body, 6);
    const block = (x: number, y: number, w: number, h: number) => sh(img, m().rrect(x, y, w, h, 3), stone, { bevel: 4, round: 0.3 });
    block(18, 46, 10, 12); block(36, 46, 10, 12);
    block(14, 22 + b, 36, 26);
    block(4, 24 + b, 11, 22); block(49, 24 + b, 11, 22);
    block(22, 8 + b, 20, 16);
    for (const [x, y] of [[20, 30], [38, 36], [26, 42], [8, 32], [52, 38]] as const) { img.line(x, y + b, x + 4, y + b + 2, stone[0]!); img.line(x + 4, y + b + 2, x + 6, y + b + 1, stone[1]!); }
    const glow = R(p.eye ?? "#f0a030", 5, 1.1);
    for (const x of [27, 35]) { img.rect(x, 14 + b, 3, 2, glow[4]!); img.set(x + 1, 13 + b, glow[3]!); }
    if (p.accent) { const gem = m().poly([[32, 28 + b], [36, 33 + b], [32, 38 + b], [28, 33 + b]]); sh(img, gem, p.accent, { bevel: 2, gloss: true }); }
    shadow(img, 32, 59, 22, 3);
    return finish(img);
  },
  skeleton(f, p, extra) {
    const img = new Img(N, N);
    const b = [0, 0, 1, 1][f]!;
    const bone = R(p.body, 6, 0.8);
    const limb = (x0: number, y0: number, x1: number, y1: number, r = 2) => sh(img, m().stroke(x0, y0, x1, y1, r), bone, { bevel: 1.5 });
    limb(27, 40, 25, 57); limb(37, 40, 39, 57);
    sh(img, m().ellipse(32, 40 + b, 8, 4), bone, { bevel: 2 });
    sh(img, m().rect(31, 22 + b, 3, 18), bone, { bevel: 1 });
    for (let k = 0; k < 4; k++) sh(img, m().ellipse(32, 25 + b + k * 4, 9 - k, 1.6), bone, { bevel: 1 });
    limb(23, 23 + b, 17, 38 + b); limb(41, 23 + b, 47, 38 + b);
    const skull = m().ellipse(32, 13 + b, 9, 9).rect(27, 18 + b, 10, 5);
    sh(img, skull, bone, { bevel: 4 });
    for (const x of [28, 36]) sh(img, m().ellipse(x, 14 + b, 2.6, 3), R(p.eye ?? "#1a1418", 4), { bevel: 1, rim: false });
    for (const x of [28, 36]) img.set(x, 14 + b, parseHex(p.accent ?? "#f04030"));
    for (let x = 28; x <= 36; x += 2) img.set(x, 21 + b, 0x2a2020);
    if (extra === "sword") { sh(img, m().rect(48, 14 + b, 3, 26), R("#c8ccd4", 5), { bevel: 1 }); sh(img, m().rect(44, 37 + b, 11, 3), P.gold, { bevel: 1 }); }
    if (extra === "shield") sh(img, m().rrect(8, 26 + b, 14, 18, 4), R(P.iron, 6), { bevel: 3, gloss: true });
    if (extra === "robe") { const r = m().poly([[22, 24 + b], [42, 24 + b], [48, 58], [16, 58]]); sh(img, r, p.dark ?? "#3a2a4a", { bevel: 4, round: 0.4 }); sh(img, skull, bone, { bevel: 4 }); for (const x of [28, 36]) { sh(img, m().ellipse(x, 14 + b, 2.6, 3), R("#1a1418", 4), { bevel: 1, rim: false }); img.set(x, 14 + b, parseHex(p.accent ?? "#40e0f0")); } }
    shadow(img, 32, 59, 14, 2);
    return finish(img);
  },
  ghost(f, p, extra) {
    const img = new Img(N, N);
    const y0 = 26 + bobOf(f) * 2;
    const body = m().ellipse(32, y0, 15, 15).rect(17, y0, 30, 16);
    for (let x = 17; x < 48; x++) { const wave = Math.round(Math.sin((x + f * 3) / 3) * 2.5); for (let y = y0 + 13 + wave; y < N; y++) body.off(x, y); }
    body.stroke(18, y0 + 4, 9, y0 + 12 + flapOf(f), 3).stroke(46, y0 + 4, 55, y0 + 10 - flapOf(f), 3);
    sh(img, body, R(p.body, 6, 0.6), { bevel: 8, alpha: 200 });
    for (const x of [26, 38]) sh(img, m().ellipse(x, y0 - 2, 3, 4.5), R(p.eye ?? "#2a2038", 4), { bevel: 1, rim: false });
    sh(img, m().ellipse(32, y0 + 6, 3.5, 3 + (f % 2)), R("#2a2038", 4), { bevel: 1, rim: false });
    if (extra === "lantern") { sh(img, m().rect(53, y0 + 8, 6, 8), P.gold, { bevel: 2, gloss: true }); img.line(56, y0 + 2, 56, y0 + 8, 0x4a4a4a); }
    shadow(img, 32, 59, 10, 2);
    return finish(img);
  },
  plant(f, p, extra) {
    const img = new Img(N, N);
    const sway = [0, 1, 2, 1][f]!;
    const leaf = R(p.dark ?? P.leaf, 6);
    for (const side of [-1, 1]) sh(img, m().poly([[32, 52], [32 + side * 22, 44 - sway * side * 0.5], [32 + side * 14, 56]]), leaf, { bevel: 3 });
    sh(img, m().stroke(32, 56, 32 + sway, 30, 2.5), leaf, { bevel: 2 });
    if (extra === "vine") { for (const side of [-1, 1]) sh(img, m().stroke(32, 40, 32 + side * 18, 22 + sway * side, 2.2).ellipse(32 + side * 18, 22 + sway * side, 3, 3), leaf, { bevel: 2 }); }
    if (extra === "mandrake") {
      const root = m().ellipse(32, 46, 11, 12).stroke(26, 54, 22, 60, 2).stroke(38, 54, 42, 60, 2);
      sh(img, root, p.body, { bevel: 6 });
      eye(img, 28, 44, 1.8, "#1a1418", false); eye(img, 36, 44, 1.8, "#1a1418", false);
      sh(img, m().ellipse(32, 51, 3, 2 + (f % 2)), R("#2a1818", 4), { bevel: 1 });
      for (const dx of [-6, 0, 6]) sh(img, m().poly([[32, 34], [32 + dx - 3, 18 - sway], [32 + dx + 3, 18 - sway]]), leaf, { bevel: 2 });
      return finish(img);
    }
    const hx = 32 + sway, hy = 24;
    const petals = R(p.body, 6);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + f * 0.05; sh(img, m().ellipse(hx + Math.cos(a) * 11, hy + Math.sin(a) * 9, 7, 6), petals, { bevel: 3 }); }
    const mouth = m().ellipse(hx, hy, 9, 8);
    sh(img, mouth, R("#5a1a2a", 5), { bevel: 4, bias: -1 });
    for (let x = hx - 7; x <= hx + 7; x += 3) { img.set(x, hy - 5, 0xffffff); img.set(x + 1, hy - 4, 0xe8e8e8); img.set(x, hy + 5, 0xffffff); img.set(x + 1, hy + 4, 0xe8e8e8); }
    eye(img, hx, hy - 1, 2.5, p.eye ?? "#f0d040", false);
    shadow(img, 32, 58, 18, 3);
    return finish(img);
  },
  beetle(f, p) {
    const img = new Img(N, N);
    const b = f % 2;
    for (let k = 0; k < 3; k++) for (const side of [-1, 1]) img.line(32 + side * 12, 34 + k * 7, 32 + side * (24 + (k === 1 ? b : 0)), 42 + k * 7 - b, R(p.dark ?? "#2a2a2a", 4)[1]!);
    for (let k = 0; k < 3; k++) for (const side of [-1, 1]) img.line(32 + side * 12, 35 + k * 7, 32 + side * (24 + (k === 1 ? b : 0)), 43 + k * 7 - b, R(p.dark ?? "#2a2a2a", 4)[0]!);
    const shell = m().ellipse(32, 40, 17, 15);
    sh(img, shell, p.body, { bevel: 8, gloss: true });
    img.line(32, 26, 32, 54, R(p.body, 6)[0]!);
    const head = m().ellipse(32, 23, 9, 6);
    sh(img, head, p.dark ?? shiftHex(p.body, -0.4), { bevel: 3 });
    sh(img, m().stroke(32, 20, 32, 6 - b, 2).ellipse(32, 6 - b, 3.5, 2.5), p.dark ?? shiftHex(p.body, -0.4), { bevel: 2 });
    eye(img, 27, 23, 1.6, p.eye ?? "#f04040", false); eye(img, 37, 23, 1.6, p.eye ?? "#f04040", false);
    shadow(img, 32, 57, 18, 3);
    return finish(img);
  },
  bee(f, p) {
    const img = new Img(N, N);
    const y0 = 30 + bobOf(f) * 2;
    for (const side of [-1, 1]) sh(img, m().ellipse(32 + side * 12, y0 - 12 - (f % 2) * 3, 9, 6), R("#dff0ff", 4, 0.4), { bevel: 3, alpha: 190 });
    const abdomen = m().ellipse(38, y0 + 8, 11, 10);
    sh(img, abdomen, p.body, { bevel: 5 });
    abdomen.each((x, y) => { if (((y - y0) >> 2) % 2 === 0 && y > y0 + 2) img.set(x, y, R(p.dark ?? "#2a2420", 5)[(x < 38 ? 2 : 1)]!); });
    sh(img, m().poly([[44, y0 + 16], [50, y0 + 24], [46, y0 + 15]]), "#2a2420", { bevel: 1 });
    sh(img, m().ellipse(27, y0, 8, 7), p.dark ?? "#3a3020", { bevel: 3 });
    const head = m().ellipse(20, y0 - 4, 7, 7);
    sh(img, head, p.body, { bevel: 3 });
    eye(img, 17, y0 - 5, 2.5, "#1a1420", false);
    img.line(19, y0 - 10, 15, y0 - 17, 0x2a2420); img.line(22, y0 - 10, 24, y0 - 17, 0x2a2420);
    shadow(img, 32, 58, 10, 2);
    return finish(img);
  },
  spider(f, p) {
    const img = new Img(N, N);
    const b = f % 2;
    const legC = R(p.dark ?? shiftHex(p.body, -0.3), 5);
    for (let k = 0; k < 4; k++) for (const side of [-1, 1]) {
      const kx = 32 + side * (20 + k * 2), ky = 22 + k * 6 - (k + b) % 2 * 2;
      sh(img, m().stroke(32 + side * 6, 34 + k * 2, kx, ky, 1.6).union(m().stroke(kx, ky, 32 + side * (26 + k * 1.5), 54 - k, 1.4)), legC, { bevel: 1 });
    }
    sh(img, m().ellipse(32, 38, 13, 11), p.body, { bevel: 6, gloss: true });
    sh(img, m().ellipse(32, 26, 8, 7), p.body, { bevel: 4 });
    if (p.accent) sh(img, m().poly([[32, 32], [36, 38], [32, 44], [28, 38]]), p.accent, { bevel: 2 });
    for (const [x, y, r] of [[29, 24, 1.8], [35, 24, 1.8], [27, 27, 1.2], [37, 27, 1.2]] as const) eye(img, x, y, r, p.eye ?? "#e83030", false);
    shadow(img, 32, 57, 22, 3);
    return finish(img);
  },
  eye(f, p, extra) {
    const img = new Img(N, N);
    const y0 = 28 + bobOf(f) * 2;
    if (extra === "wings") for (const side of [-1, 1]) sh(img, m().poly([[32 + side * 10, y0 - 4], [32 + side * 30, y0 - 14 + flapOf(f) * 4], [32 + side * 26, y0 + 6], [32 + side * 12, y0 + 6]]), p.dark ?? "#5a3a6a", { bevel: 3 });
    else for (let k = 0; k < 4; k++) { const x0 = 22 + k * 7; const t = m(); for (let s = 0; s < 12; s++) t.ellipse(x0 + Math.sin((s + f * 2 + k) / 2.5) * 2.5, y0 + 12 + s * 1.6, 2.2 - s * 0.12, 1.5); sh(img, t, p.dark ?? shiftHex(p.body, -0.25), { bevel: 1.5 }); }
    sh(img, m().ellipse(32, y0, 16, 15), p.body, { bevel: 8 });
    sh(img, m().ellipse(32, y0, 11, 10), R("#f8f0f0", 5, 0.4), { bevel: 4, rim: false });
    const look = [0, 1, 0, -1][f]!;
    sh(img, m().ellipse(32 + look * 2, y0, 6.5, 7), R(p.eye ?? "#d83a3a", 5), { bevel: 3, rim: false });
    sh(img, m().ellipse(32 + look * 2, y0, 2.4, 4.5), R("#1a1018", 3), { bevel: 1, rim: false });
    img.set(30 + look * 2, y0 - 4, 0xffffff); img.set(29 + look * 2, y0 - 3, 0xffffff);
    shadow(img, 32, 59, 10, 2);
    return finish(img);
  },
  dragon(f, p) {
    const img = new Img(N, N);
    const b = [0, 0, 1, 1][f]!, flap = [0, 3, 6, 3][f]!;
    const wingC = R(p.dark ?? shiftHex(p.body, -0.3), 6);
    sh(img, m().poly([[36, 26], [60, 6 + flap], [58, 22 + flap], [50, 22 + flap * 0.7], [46, 32], [38, 34]]), wingC, { bevel: 3 });
    sh(img, m().stroke(44, 48, 60, 54, 3).poly([[58, 50], [63, 56], [57, 58]]), p.body, { bevel: 2 });
    sh(img, m().ellipse(38, 42 - b, 13, 11), p.body, { bevel: 7 });
    sh(img, m().ellipse(35, 46 - b, 7, 7), p.accent ?? "#e8d08a", { bevel: 3, rim: false });
    for (const x of [30, 42]) sh(img, m().rrect(x, 48, 7, 10, 2), p.body, { bevel: 2 });
    sh(img, m().stroke(30, 38 - b, 22, 24 - b, 5), p.body, { bevel: 3 });
    const head = m().ellipse(18, 20 - b, 9, 7).poly([[12, 18 - b], [2, 22 - b], [4, 26 - b], [14, 26 - b]]);
    head.poly([[18, 14 - b], [24, 4 - b], [24, 15 - b]]).poly([[13, 15 - b], [14, 6 - b], [19, 14 - b]]);
    sh(img, head, p.body, { bevel: 4 });
    sh(img, m().poly([[28, 26], [8, 6 + flap * 1.5], [12, 22 + flap], [20, 30]]), wingC, { bevel: 3 });
    eye(img, 16, 18 - b, 2, p.eye ?? "#f0d030", false);
    img.set(4, 23 - b, 0x2a2020);
    if (f === 2) for (let k = 0; k < 4; k++) img.set(1 - (k % 2), 24 + k - b, 0xffd060);
    shadow(img, 38, 59, 18, 3);
    return finish(img);
  },
  mushroom(f, p) {
    const img = new Img(N, N);
    const sq = [0, 1, 2, 1][f]!;
    sh(img, m().rrect(22, 30 + sq, 20, 26 - sq, 6), R(P.bone, 6, 0.7), { bevel: 5 });
    eye(img, 27, 40 + sq, 2.4, "#1a1418", false); eye(img, 37, 40 + sq, 2.4, "#1a1418", false);
    sh(img, m().ellipse(32, 47 + sq, 3, 2), R("#3a1a1a", 3), { bevel: 1, rim: false });
    const cap = m().ellipse(32, 26 + sq, 24 + sq * 0.5, 15 - sq * 0.5);
    for (let y = 31 + sq; y < N; y++) for (let x = 0; x < N; x++) cap.off(x, y);
    sh(img, cap, p.body, { bevel: 8, gloss: true });
    const spot = R(p.accent ?? "#f8f0e8", 4, 0.4);
    for (const [x, y, r] of [[22, 20, 3.5], [36, 15, 4], [44, 24, 3], [30, 26, 2.5]] as const) sh(img, m().ellipse(x, y + sq, r, r * 0.8), spot, { bevel: 1.5, rim: false });
    for (const side of [-1, 1]) sh(img, m().ellipse(32 + side * 13, 46 + sq, 3.5, 3), R(P.bone, 6, 0.7), { bevel: 1.5 });
    shadow(img, 32, 58, 16, 3);
    return finish(img);
  },
  elemental(f, p, extra) {
    const img = new Img(N, N);
    const c = R(p.body, 6, 1.1);
    if (extra === "fire") {
      const flick = [0, 2, -1, 1][f]!;
      const fl = m().ellipse(32, 40, 15, 14).poly([[18, 38], [24 + flick, 6], [30, 28]]).poly([[28, 34], [34 - flick, 0], [40, 30]]).poly([[36, 34], [46 + flick, 10], [46, 40]]);
      sh(img, fl, c, { bevel: 7, rim: false });
      sh(img, m().ellipse(32, 42, 8, 9).poly([[27, 40], [32 + flick, 22], [37, 40]]), R("#fff0a0", 4, 0.6), { bevel: 4, rim: false });
      eye(img, 28, 40, 2.2, "#3a1010", false); eye(img, 36, 40, 2.2, "#3a1010", false);
      return finish(img);
    }
    if (extra === "water") {
      const y0 = 8 + bobOf(f);
      const drop = m().ellipse(32, y0 + 32, 16, 17).poly([[19, y0 + 26], [32, y0], [45, y0 + 26]]);
      sh(img, drop, c, { bevel: 8, gloss: true, alpha: 225 });
      for (let k = 0; k < 6; k++) img.set(23 + k, y0 + 24 - k * 2, 0xffffff, 200);
      eye(img, 26, y0 + 32, 2.8, "#1a2a4a"); eye(img, 38, y0 + 32, 2.8, "#1a2a4a");
      shadow(img, 32, 59, 14, 2);
      return finish(img);
    }
    if (extra === "wind") {
      for (let k = 0; k < 3; k++) {
        const r = 22 - k * 6, cy = 18 + k * 12, ph = f * 0.8 + k;
        const ring = m();
        for (let a = 0; a < Math.PI * 1.7; a += 0.05) ring.ellipse(32 + Math.cos(a + ph) * r, cy + Math.sin(a + ph) * r * 0.35, 3.2 - a * 0.8, 2.2);
        sh(img, ring, c, { bevel: 2, alpha: 220 });
      }
      eye(img, 27, 30, 2.2, "#1a3a2a", false); eye(img, 37, 30, 2.2, "#1a3a2a", false);
      return finish(img);
    }
    if (extra === "thunder") {
      const y0 = 26 + bobOf(f);
      sh(img, m().ellipse(32, y0, 15, 15), c, { bevel: 7, gloss: true });
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + f * 0.4; let x = 32 + Math.cos(a) * 15, y = y0 + Math.sin(a) * 15; for (let s = 0; s < 4; s++) { const nx = x + Math.cos(a) * 3 + (s % 2 ? 2 : -2), ny = y + Math.sin(a) * 3; img.line(x, y, nx, ny, 0xfff8a0); x = nx; y = ny; } }
      eye(img, 27, y0, 2.6, "#2a2050"); eye(img, 37, y0, 2.6, "#2a2050");
      return finish(img);
    }
    // earth
    const b = [0, 0, 1, 1][f]!;
    const rock = m().poly([[14, 56], [10, 34], [20, 16 + b], [34, 10 + b], [48, 18 + b], [54, 38], [50, 56]]);
    sh(img, rock, c, { bevel: 8 });
    for (const [x, y] of [[20, 30], [40, 40], [30, 48]] as const) img.line(x, y, x + 6, y + 3, c[0]!);
    sh(img, m().ellipse(34, 18 + b, 9, 4), P.grass, { bevel: 2 });
    for (const x of [27, 39]) { img.rect(x, 30 + b, 3, 2, 0xf0c040); }
    shadow(img, 32, 59, 22, 3);
    return finish(img);
  },
  snake(f, p) {
    const img = new Img(N, N);
    const sway = [0, 1, 2, 1][f]!;
    const coil = m().ellipse(34, 50, 18, 7).ellipse(36, 44, 13, 6);
    sh(img, coil, p.body, { bevel: 4 });
    const neck = m();
    for (let s = 0; s <= 20; s++) { const t = s / 20; neck.ellipse(40 - t * 14 + Math.sin(t * 3 + sway * 0.4) * 3, 44 - t * 28, 5 - t, 5 - t); }
    sh(img, neck, p.body, { bevel: 3 });
    const belly = R(p.accent ?? "#e8d890", 5, 0.6);
    const head = m().ellipse(24, 14, 9, 6.5);
    sh(img, head, p.body, { bevel: 4 });
    for (const [x, y] of [[36, 47], [26, 51], [44, 52], [33, 38]] as const) { img.set(x, y, belly[3]!); img.set(x + 1, y, belly[2]!); }
    eye(img, 21, 12, 1.8, "#f0d030", false); eye(img, 28, 12, 1.8, "#f0d030", false);
    if (f % 2) { img.line(17, 18, 13, 20, 0xe83a4a); img.set(12, 19, 0xe83a4a); img.set(12, 21, 0xe83a4a); }
    shadow(img, 34, 58, 20, 3);
    return finish(img);
  },
  goblin(f, p, extra) {
    const img = new Img(N, N);
    const b = [0, 0, 1, 1][f]!;
    const skin = R(p.body, 6);
    for (const x of [25, 34]) sh(img, m().rrect(x, 44, 6, 13, 2), skin, { bevel: 2 });
    sh(img, m().rrect(21, 28 + b, 22, 20, 6), R(p.accent ?? "#7a5a3a", 6), { bevel: 5 });
    sh(img, m().stroke(22, 32 + b, 14, 42 + b, 3), skin, { bevel: 2 });
    sh(img, m().stroke(42, 32 + b, 48, 30 + b, 3), skin, { bevel: 2 });
    sh(img, m().stroke(48, 32 + b, 54, 10 + b, 2.5).ellipse(54, 10 + b, 5, 5), R(P.woodDark, 6), { bevel: 3 });
    const head = m().ellipse(32, 18 + b, 11, 10).poly([[22, 16 + b], [8, 10 + b], [22, 22 + b]]).poly([[42, 16 + b], [56, 10 + b], [42, 22 + b]]);
    sh(img, head, skin, { bevel: 5 });
    eye(img, 27, 17 + b, 2.6, p.eye ?? "#e8d020"); eye(img, 37, 17 + b, 2.6, p.eye ?? "#e8d020");
    for (let x = 27; x <= 37; x++) img.set(x, 25 + b, 0x2a1a1a);
    img.set(28, 26 + b, 0xffffff); img.set(36, 26 + b, 0xffffff);
    if (extra === "helmet") sh(img, m().ellipse(32, 11 + b, 11, 6).rect(21, 11 + b, 22, 2), R(P.iron, 6), { bevel: 3, gloss: true });
    shadow(img, 32, 58, 14, 3);
    return finish(img);
  },
};

const shiftHex = (h: string, k: number) => `#${shift(parseHex(h), k).toString(16).padStart(6, "0")}`;

export const MONSTERS: MonsterSpec[] = [
  { id: "slime-green", name: "スライム", tags: ["slime", "weak"], family: "slime", pal: { body: "#5cc85c" } },
  { id: "slime-blue", name: "アオスライム", tags: ["slime", "water"], family: "slime", pal: { body: "#4a8ae8" } },
  { id: "slime-red", name: "ヒノスライム", tags: ["slime", "fire"], family: "slime", pal: { body: "#e8503a", eye: "#3a1010" } },
  { id: "slime-metal", name: "はがねスライム", tags: ["slime", "rare"], family: "slime", pal: { body: "#b8c0cc" } },
  { id: "slime-gold", name: "コガネスライム", tags: ["slime", "rare"], family: "slime", pal: { body: "#e8c040" } },
  { id: "slime-poison", name: "ドクスライム", tags: ["slime", "poison"], family: "slime", pal: { body: "#9a5ac8" } },
  { id: "slime-king", name: "スライムの王", tags: ["slime", "boss"], family: "slime", pal: { body: "#40b0a0" }, extra: "crown" },
  { id: "bat", name: "コウモリ", tags: ["bat", "cave", "flying"], family: "bat", pal: { body: "#6a4a8a" } },
  { id: "bat-vampire", name: "吸血コウモリ", tags: ["bat", "night", "flying"], family: "bat", pal: { body: "#8a2a3a", eye: "#f0e040" } },
  { id: "bat-ice", name: "氷のコウモリ", tags: ["bat", "ice", "flying"], family: "bat", pal: { body: "#6aa8d8", eye: "#2a4aa8" } },
  { id: "wolf", name: "灰色狼", tags: ["beast", "wolf", "forest"], family: "wolf", pal: { body: "#8a8a96" } },
  { id: "wolf-fire", name: "炎の狼", tags: ["beast", "wolf", "fire"], family: "wolf", pal: { body: "#c85a2a", accent: "#f0c040" } },
  { id: "wolf-snow", name: "雪狼", tags: ["beast", "wolf", "ice"], family: "wolf", pal: { body: "#e0e8f0", eye: "#3a8ad8" } },
  { id: "wolf-shadow", name: "影の獣", tags: ["beast", "wolf", "dark"], family: "wolf", pal: { body: "#3a3448", eye: "#e83a5a", accent: "#7a3aa8" } },
  { id: "boar", name: "大猪", tags: ["beast", "forest"], family: "wolf", pal: { body: "#7a5a3a" }, extra: "tusks" },
  { id: "bird-blue", name: "青い鳥", tags: ["bird", "flying"], family: "bird", pal: { body: "#4a8ad8" } },
  { id: "bird-fire", name: "火の鳥", tags: ["bird", "fire", "flying"], family: "bird", pal: { body: "#e8603a", accent: "#f8d060" } },
  { id: "crow", name: "大ガラス", tags: ["bird", "dark", "flying"], family: "bird", pal: { body: "#3a3a4a", accent: "#5a5a6a", eye: "#e83a3a" } },
  { id: "golem-stone", name: "石の巨人", tags: ["golem", "ruins"], family: "golem", pal: { body: "#8a8478" } },
  { id: "golem-iron", name: "鉄の巨人", tags: ["golem", "machine"], family: "golem", pal: { body: "#7a8494", eye: "#40e0f0", accent: "#e84040" } },
  { id: "golem-crystal", name: "水晶の巨人", tags: ["golem", "crystal", "cave"], family: "golem", pal: { body: "#7ac8e8", eye: "#ffffff", accent: "#c060f0" } },
  { id: "golem-mud", name: "泥人形", tags: ["golem", "swamp"], family: "golem", pal: { body: "#7a5a3a", eye: "#e8e040" } },
  { id: "skeleton", name: "骸骨兵", tags: ["undead", "skeleton"], family: "skeleton", pal: { body: P.bone }, extra: "sword" },
  { id: "skeleton-guard", name: "骸骨の盾兵", tags: ["undead", "skeleton"], family: "skeleton", pal: { body: "#d8d0b8" }, extra: "shield" },
  { id: "lich", name: "死霊術師", tags: ["undead", "mage", "boss"], family: "skeleton", pal: { body: "#c8c8d8", dark: "#3a2a5a", accent: "#40f0e0" }, extra: "robe" },
  { id: "ghost", name: "ゴースト", tags: ["undead", "ghost"], family: "ghost", pal: { body: "#e8eef8" } },
  { id: "ghost-purple", name: "怨霊", tags: ["undead", "ghost", "dark"], family: "ghost", pal: { body: "#a880d8" } },
  { id: "ghost-lantern", name: "灯火の亡霊", tags: ["undead", "ghost"], family: "ghost", pal: { body: "#b8e0d8" }, extra: "lantern" },
  { id: "maneater", name: "人喰い花", tags: ["plant", "forest"], family: "plant", pal: { body: "#e04a6a" } },
  { id: "maneater-blue", name: "夜咲き花", tags: ["plant", "night"], family: "plant", pal: { body: "#5a6ae0", dark: "#2a5a4a" } },
  { id: "vine", name: "絡みつる", tags: ["plant", "forest"], family: "plant", pal: { body: "#e8c040", dark: "#3a7a3a" }, extra: "vine" },
  { id: "mandrake", name: "マンドラゴラ", tags: ["plant", "rare"], family: "plant", pal: { body: "#c8a070" }, extra: "mandrake" },
  { id: "beetle", name: "甲虫", tags: ["insect", "forest"], family: "beetle", pal: { body: "#3a6ab0" } },
  { id: "beetle-gold", name: "黄金虫", tags: ["insect", "rare"], family: "beetle", pal: { body: "#e8b030", dark: "#5a3a1a" } },
  { id: "bee", name: "大蜂", tags: ["insect", "flying"], family: "bee", pal: { body: "#f0c030" } },
  { id: "spider", name: "大蜘蛛", tags: ["insect", "cave"], family: "spider", pal: { body: "#4a3a4a", accent: "#e84030" } },
  { id: "spider-ice", name: "氷蜘蛛", tags: ["insect", "ice"], family: "spider", pal: { body: "#8ab8e0", accent: "#ffffff", eye: "#3a3ab0" } },
  { id: "eye", name: "浮遊眼", tags: ["eye", "magic"], family: "eye", pal: { body: "#a85a8a" } },
  { id: "eye-blue", name: "凍てつく眼", tags: ["eye", "ice"], family: "eye", pal: { body: "#5a8ab8", eye: "#3a8ae8" } },
  { id: "eye-bat", name: "邪眼", tags: ["eye", "dark", "flying"], family: "eye", pal: { body: "#6a4a7a", eye: "#e8c030" }, extra: "wings" },
  { id: "dragon-green", name: "森の竜", tags: ["dragon", "boss"], family: "dragon", pal: { body: "#4a9a4a" } },
  { id: "dragon-red", name: "火竜", tags: ["dragon", "fire", "boss"], family: "dragon", pal: { body: "#c83a2a" } },
  { id: "dragon-blue", name: "氷竜", tags: ["dragon", "ice", "boss"], family: "dragon", pal: { body: "#4a7ac8", accent: "#d8f0ff" } },
  { id: "mushroom", name: "おばけキノコ", tags: ["mushroom", "forest"], family: "mushroom", pal: { body: "#d8402a" } },
  { id: "mushroom-blue", name: "眠りキノコ", tags: ["mushroom", "cave"], family: "mushroom", pal: { body: "#4a6ad8" } },
  { id: "mushroom-purple", name: "毒キノコ", tags: ["mushroom", "poison"], family: "mushroom", pal: { body: "#8a4ab8", accent: "#c8f060" } },
  { id: "elemental-fire", name: "火の精", tags: ["elemental", "fire"], family: "elemental", pal: { body: "#f06a2a" }, extra: "fire" },
  { id: "elemental-water", name: "水の精", tags: ["elemental", "water"], family: "elemental", pal: { body: "#4aa0e8" }, extra: "water" },
  { id: "elemental-wind", name: "風の精", tags: ["elemental", "wind"], family: "elemental", pal: { body: "#8ae0b0" }, extra: "wind" },
  { id: "elemental-thunder", name: "雷の精", tags: ["elemental", "thunder"], family: "elemental", pal: { body: "#e8d040" }, extra: "thunder" },
  { id: "elemental-earth", name: "岩の精", tags: ["elemental", "earth"], family: "elemental", pal: { body: "#a08060" }, extra: "earth" },
  { id: "snake", name: "大蛇", tags: ["snake", "swamp"], family: "snake", pal: { body: "#5a9a4a" } },
  { id: "snake-purple", name: "毒蛇", tags: ["snake", "poison"], family: "snake", pal: { body: "#8a4aa8", accent: "#f0e070" } },
  { id: "goblin", name: "ゴブリン", tags: ["goblin", "humanoid"], family: "goblin", pal: { body: "#6aa84a" } },
  { id: "goblin-chief", name: "ゴブリンの長", tags: ["goblin", "humanoid", "boss"], family: "goblin", pal: { body: "#4a8a5a", accent: "#8a2a2a" }, extra: "helmet" },
];

/** Full sheet: 4 idle frames in one row, 64px cells. */
export function renderMonsterSheet(spec: MonsterSpec): Img {
  const family = FAMILIES[spec.family];
  if (!family) throw new Error(`unknown monster family ${spec.family}`);
  const sheet = new Img(N * 4, N);
  for (let f = 0; f < 4; f++) sheet.draw(family(f, spec.pal, spec.extra), f * N, 0);
  return sheet;
}

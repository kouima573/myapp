/**
 * Paper-doll character sprites. A character is a combination of body type, skin, hair, outfit, headgear,
 * extras (ears, tail, beard, cape) and a held item. Each sheet is 4 columns (walk frames: stand, step,
 * stand, other step) × 4 rows (facing down, left, right, up) — the layout the runtime expects — painted at
 * 32×32 per frame and exported at 64×64.
 */
import { Img, Mask, outline, parseHex, shade, shift, type Color } from "./core";
import { mask, P, R } from "./paint";

export type Facing = "down" | "left" | "right" | "up";
export const FACINGS: Facing[] = ["down", "left", "right", "up"]; // row order used by packages/runtime/src/render.ts

export type BodyType = "adult" | "child" | "stout" | "slim";
export type HairStyle = "short" | "long" | "ponytail" | "spiky" | "bob" | "bun" | "bald" | "twintails" | "messy";
export type Outfit = "tunic" | "robe" | "dress" | "armor" | "vest" | "coat" | "rags";
export type Headgear = "hat" | "wizard" | "hood" | "helmet" | "cap" | "crown" | "bandana" | "horns" | "veil" | "straw";
export type Item = "staff" | "sword" | "spear" | "bow" | "book" | "lantern" | "basket" | "shield" | "axe" | "pick";

export interface CharacterSpec {
  id: string;
  name: string;
  tags: string[];
  body?: BodyType;
  skin?: string;
  hair?: { style: HairStyle; color: string };
  outfit: { type: Outfit; main: string; accent?: string; pants?: string; shoes?: string };
  headgear?: { type: Headgear; color: string; accent?: string };
  cape?: string;
  beard?: string;
  ears?: "elf" | "cat" | "dog" | "rabbit";
  earColor?: string;
  tail?: string;
  item?: Item;
  special?: "ghost" | "robot" | "skeleton";
}

interface Geo { hx: number; hy: number; hrx: number; hry: number; ty: number; th: number; tw: number; ly: number }
const GEO: Record<BodyType, Geo> = {
  adult: { hx: 16, hy: 9.5, hrx: 7, hry: 6.4, ty: 15.5, th: 8, tw: 10, ly: 23 },
  slim: { hx: 16, hy: 9, hrx: 6.6, hry: 6.2, ty: 15, th: 8.5, tw: 9, ly: 23 },
  child: { hx: 16, hy: 13, hrx: 6.6, hry: 6, ty: 18, th: 6, tw: 9, ly: 24 },
  stout: { hx: 16, hy: 11.5, hrx: 7, hry: 6, ty: 17, th: 8, tw: 13, ly: 25 },
};
const FEET = 29; // shoes occupy rows 29..30

const OUTLINE = parseHex("#231b26");
const EYE = parseHex("#2a2034");

type Layer = { m: Mask; colors: Color[]; opts?: Parameters<typeof shade>[3] };

/** Draws one frame (32×32) of a character. */
export function drawCharacterFrame(spec: CharacterSpec, facing: Facing, frame: number): Img {
  const flip = facing === "right";
  const dir: "down" | "side" | "up" = facing === "down" ? "down" : facing === "up" ? "up" : "side";
  const img = new Img(32, 32);
  const body = spec.body ?? "adult";
  const g = { ...GEO[body] };
  const step = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  const ghost = spec.special === "ghost";
  const float = ghost ? [0, -1, -1, 0][frame]! : 0;
  const bob = !ghost && step !== 0 ? -1 : 0;
  const lift = float + bob;
  const hy = g.hy + lift, ty = g.ty + lift;
  const skin = R(spec.special === "skeleton" ? P.bone : spec.special === "robot" ? P.iron : (spec.skin ?? P.skin1), 5, 0.55);
  const main = R(spec.outfit.main), accent = R(spec.outfit.accent ?? spec.outfit.main), pants = R(spec.outfit.pants ?? "#4a4a5e"), shoes = R(spec.outfit.shoes ?? "#5a3a2a");
  const hair = spec.hair ? R(spec.hair.color) : undefined;
  const gear = spec.headgear ? R(spec.headgear.color) : undefined;
  const cx = g.hx;
  const layers: Layer[] = [];
  const add = (m: Mask, colors: Color[], opts?: Layer["opts"]) => layers.push({ m, colors, opts });
  const long = spec.outfit.type === "robe" || spec.outfit.type === "dress";

  /* ---- back layers ---- */
  if (spec.tail && dir !== "down") {
    const m = mask();
    const sx = dir === "side" ? cx + 4 : cx;
    const wag = frame % 2 ? 1 : 0;
    m.stroke(sx, ty + g.th - 2, sx + (dir === "side" ? 5 : 2 + wag), ty + g.th - 7 - wag, 1.6).ellipse(sx + (dir === "side" ? 5.5 : 2.5 + wag), ty + g.th - 8 - wag, 2, 2);
    add(m, R(spec.tail));
  }
  if (spec.cape && dir !== "up") {
    const m = mask();
    if (dir === "down") m.poly([[cx - g.tw / 2 - 1, ty + 1], [cx + g.tw / 2 + 1, ty + 1], [cx + g.tw / 2 + 3, 28], [cx - g.tw / 2 - 3, 28]]);
    else m.poly([[cx + 1, ty], [cx + 4, ty + 1], [cx + 7 + (step ? 1 : 0), 28], [cx, 28]]);
    add(m, R(darkenHex(spec.cape)));
  }
  if (hair && dir === "down" && (spec.hair!.style === "long")) add(mask().rect(cx - g.hrx, hy - 1, g.hrx * 2, g.hry + 6), R(darkenHex(spec.hair!.color)));
  if (spec.item && dir === "up") drawItem(spec.item, add, cx, ty, dir, step, true);
  if (dir === "side") {
    // far arm (behind the body)
    const ax = cx + 1 - step * 2;
    add(mask().stroke(cx + 1, ty + 2, ax, ty + g.th - 2, 1.3), shiftRamp(spec.outfit.type === "armor" ? R(P.iron) : main, -0.2));
  }

  /* ---- legs ---- */
  if (!ghost) {
    const legTop = g.ly + lift;
    if (dir === "side") {
      const front = mask(), back = mask();
      front.rect(cx - 2 - step * 2, legTop, 3, FEET - legTop);
      back.rect(cx + step * 2 - 1, legTop, 3, FEET - legTop);
      if (!long || true) { add(back, shiftRamp(pants, -0.15), { round: 0.3 }); add(front, pants, { round: 0.3 }); }
      add(mask().rect(cx + step * 2 - 2, FEET, 4, 2), shoes);
      add(mask().rect(cx - 3 - step * 2, FEET, 4, 2), shoes);
    } else {
      const lUp = step === 1 ? 1 : 0, rUp = step === -1 ? 1 : 0;
      const legW = body === "stout" ? 4 : 3;
      const lx = cx - 1 - legW, rx = cx + 1;
      add(mask().rect(lx, legTop, legW, FEET - legTop - lUp), pants, { round: 0.3 });
      add(mask().rect(rx, legTop, legW, FEET - legTop - rUp), pants, { round: 0.3 });
      add(mask().rect(lx - (dir === "down" ? 0 : 0), FEET - lUp, legW + 1, 2), shoes);
      add(mask().rect(rx - 1, FEET - rUp, legW + 1, 2), shoes);
    }
  }

  /* ---- torso / outfit ---- */
  const torso = mask();
  const tw = dir === "side" ? Math.max(7, g.tw - 3) : g.tw;
  const tx = cx - tw / 2;
  if (ghost) {
    const m = mask().ellipse(cx, hy + 2, g.hrx + 1.5, g.hry + 1.5).rect(cx - g.hrx - 1.5, hy + 2, g.hrx * 2 + 3, 30 - hy - 4);
    for (let x = 0; x < 32; x++) if ((x + frame) % 4 < 2) m.off(x, 28 + lift); else m.off(x, 29 + lift);
    for (let x = 0; x < 32; x++) for (let y = 29 + lift; y < 32; y++) m.off(x, y);
    add(m, R(spec.outfit.main, 5, 0.6), { bevel: 4, round: 0.8 });
  } else {
    torso.rrect(Math.round(tx), Math.round(ty), tw, g.th + 1, 2);
    if (long) {
      const skirt = mask().poly([[tx, ty + g.th - 3], [tx + tw, ty + g.th - 3], [tx + tw + (spec.outfit.type === "dress" ? 3 : 1.5), FEET], [tx - (spec.outfit.type === "dress" ? 3 : 1.5), FEET]]);
      torso.union(skirt);
    }
    add(torso, spec.outfit.type === "armor" ? R(P.iron) : main, { round: 0.6, bevel: 3 });
  }

  /* ---- outfit details as overlay layers ---- */
  const details: Array<() => void> = [];
  const T = Math.round(ty), X = Math.round(tx);
  if (!ghost) {
    const belt = () => { for (let x = X; x < X + tw; x++) { img.set(x, T + g.th - 2, accent[1]!); } if (dir === "down") img.set(cx, T + g.th - 2, parseHex(P.gold)); };
    switch (spec.outfit.type) {
      case "tunic": details.push(belt); break;
      case "vest": details.push(() => { for (let y = T + 1; y < T + g.th; y++) { for (const x of dir === "down" ? [X, X + 1, X + tw - 2, X + tw - 1] : dir === "up" ? [] : [X, X + 1, X + 2]) img.set(x, y, accent[y === T + 1 ? 3 : 2]!); } if (dir === "up") for (let y = T + 1; y < T + g.th; y++) for (let x = X; x < X + tw; x++) img.set(x, y, accent[x === X ? 3 : x === X + tw - 1 ? 1 : 2]!); belt(); }); break;
      case "coat": details.push(() => { if (dir === "down") for (let y = T + 1; y < FEET - 2; y++) img.set(cx, y, main[0]!); for (let y = T + g.th; y < FEET - 2 + lift; y++) for (let x = X; x < X + tw; x++) if (dir !== "side" || x > X + 1) img.set(x, y, main[x === X ? 3 : x === X + tw - 1 ? 1 : 2]!); }); break;
      case "robe": details.push(() => { if (dir === "down") for (let y = T + 1; y < FEET; y++) img.set(cx, y, accent[3]!); belt(); }); break;
      case "dress": details.push(() => { for (let x = X; x < X + tw; x++) img.set(x, T + g.th - 3, accent[3]!); if (dir === "down") { img.set(cx - 1, T + 1, accent[4]!); img.set(cx, T + 1, accent[4]!); } }); break;
      case "armor": details.push(() => {
        const a = R(P.iron);
        if (dir !== "side") { for (let y = T + 2; y < T + g.th - 2; y++) img.set(cx, y, a[dir === "down" ? 4 : 1]!); }
        for (let x = X; x < X + tw; x++) img.set(x, T + g.th - 2, accent[2]!);
        if (dir === "down" && spec.outfit.accent) { for (let y = T + 2; y < T + g.th - 3; y++) for (let x = cx - 2; x <= cx + 1; x++) img.set(x, y, accent[x === cx - 2 ? 3 : 2]!); }
      }); break;
      case "rags": details.push(() => { for (let x = X; x < X + tw; x += 3) { img.set(x, T + g.th, main[1]!); img.set(x + 1, T + 3, main[1]!); } }); break;
    }
  }

  /* ---- arms ---- */
  const sleeve = spec.outfit.type === "armor" ? R(P.iron) : main;
  const handC = spec.outfit.type === "armor" ? R(P.iron) : skin;
  const arms: Array<{ m: Mask; hand: Mask }> = [];
  if (!ghost) {
    if (dir === "side") {
      const ax = cx - 1 + step * 2;
      const m = mask().stroke(cx - 1, ty + 2, ax, ty + g.th - 2, 1.3);
      arms.push({ m, hand: mask().ellipse(ax, ty + g.th - 1, 1.5, 1.5) });
    } else {
      for (const side of [-1, 1]) {
        const swing = dir === "down" || dir === "up" ? side * step : 0;
        const ax = cx + side * (tw / 2 + 1);
        const m = mask().rect(Math.round(ax - (side < 0 ? 1.5 : 0.5)), Math.round(ty + 1), 2, g.th - 2 + swing);
        arms.push({ m, hand: mask().rect(Math.round(ax - (side < 0 ? 1.5 : 0.5)), Math.round(ty + g.th - 1 + swing), 2, 2) });
      }
    }
  }

  /* ---- head ---- */
  const head = mask().ellipse(cx, hy, g.hrx, g.hry);
  const ears: Mask[] = [];
  if (spec.ears === "elf") {
    if (dir === "down" || dir === "up") { ears.push(mask().poly([[cx - g.hrx + 1, hy - 1], [cx - g.hrx - 3, hy - 3], [cx - g.hrx + 1, hy + 2]]), mask().poly([[cx + g.hrx - 1, hy - 1], [cx + g.hrx + 3, hy - 3], [cx + g.hrx - 1, hy + 2]])); }
    else ears.push(mask().poly([[cx + 1, hy - 1], [cx + 5, hy - 4], [cx + 2, hy + 2]]));
  }

  /* ---- paint in order ---- */
  for (const l of layers) shade(img, l.m, l.colors, l.opts);
  for (const d of details) d();
  if (dir === "up") for (const a of arms) { shade(img, a.m, sleeve, { round: 0.4 }); shade(img, a.hand, handC); }
  else for (const a of arms) { shade(img, a.m, sleeve, { round: 0.4 }); shade(img, a.hand, handC); }
  if (spec.item === "shield" && dir !== "up") drawItem("shield", (m, c, o) => shade(img, m, c, o), cx, ty, dir, step, false);
  for (const e of ears) shade(img, e, skin, { bevel: 1 });
  shade(img, head, skin, { bevel: 4, round: 0.35, dither: false });

  // face
  if (dir !== "up" && spec.special !== "robot") {
    const ey = Math.round(hy + 1);
    const eyeColor = spec.special === "skeleton" ? parseHex("#1a1418") : ghost ? parseHex("#3a3050") : EYE;
    if (dir === "down") {
      for (const ex of [cx - 3, cx + 2]) { img.set(ex, ey, eyeColor); img.set(ex, ey - 1, eyeColor); if (spec.special === "skeleton") img.set(ex + (ex < cx ? -1 : 1), ey, eyeColor); }
      if (!ghost && spec.special !== "skeleton") { img.set(cx - 4, ey + 2, mixC(skin[2]!, 0xe07070, 0.35)); img.set(cx + 3, ey + 2, mixC(skin[2]!, 0xe07070, 0.35)); }
      if (spec.special === "skeleton") { img.set(cx - 1, ey + 3, eyeColor); img.set(cx + 1, ey + 3, eyeColor); img.set(cx, ey + 2, eyeColor); }
    } else {
      const ex = cx - 4;
      img.set(ex, ey, eyeColor); img.set(ex, ey - 1, eyeColor);
      if (spec.special === "skeleton") img.set(ex + 1, ey, eyeColor);
    }
  }
  if (spec.special === "robot") {
    const vis = R("#40e0d0");
    if (dir === "down") { for (let x = cx - 4; x <= cx + 3; x++) img.set(x, Math.round(hy), vis[x % 2 ? 4 : 3]!); }
    else if (dir === "side") { for (let x = cx - 6; x <= cx - 2; x++) img.set(x, Math.round(hy), vis[4]!); }
    const ant = mask().rect(cx, Math.round(hy - g.hry - 3), 1, 3); shade(img, ant, R(P.iron)); img.set(cx, Math.round(hy - g.hry - 4), parseHex(P.red));
  }

  // beard
  if (spec.beard && dir !== "up") {
    const m = mask().ellipse(dir === "down" ? cx : cx - 2, hy + 3.5, dir === "down" ? g.hrx - 1 : g.hrx - 2.5, 3.8);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (y < hy + 2) m.off(x, y);
    if (dir === "down") { m.off(cx - 1, Math.round(hy + 2)); m.off(cx, Math.round(hy + 2)); }
    shade(img, m, R(spec.beard), { bevel: 2 });
  }

  // hair
  if (hair) paintHair(img, spec.hair!.style, hair, dir, cx, hy, g, !!spec.headgear && spec.headgear.type !== "bandana" && spec.headgear.type !== "horns" && spec.headgear.type !== "crown", frame);

  // animal ears on top of hair
  if (spec.ears === "cat" || spec.ears === "dog" || spec.ears === "rabbit") {
    const ec = R(spec.earColor ?? spec.hair?.color ?? "#8a6a4a");
    const inner = parseHex("#e8a0a8");
    const top = hy - g.hry;
    const spots = dir === "side" ? [cx + 1] : [cx - 4, cx + 4];
    for (const ex of spots) {
      const m = mask();
      if (spec.ears === "rabbit") m.ellipse(ex, top - 3, 1.8, 4.5);
      else if (spec.ears === "dog") m.ellipse(ex + (ex < cx ? -2 : 2), top + 3, 2, 3.2);
      else m.poly([[ex - 2.5, top + 2], [ex + (ex < cx ? -0.5 : 0.5), top - 4], [ex + 2.5, top + 2]]);
      shade(img, m, ec, { bevel: 1.2 });
      if (dir === "down" && spec.ears !== "dog") { img.set(Math.round(ex), Math.round(top), inner); if (spec.ears === "rabbit") img.set(Math.round(ex), Math.round(top - 2), inner); }
    }
  }

  // headgear
  if (gear) paintHeadgear(img, spec.headgear!.type, gear, spec.headgear!.accent ? R(spec.headgear!.accent) : gear, dir, cx, hy, g);

  // cape over the back when facing up
  if (spec.cape && dir === "up") {
    const m = mask().poly([[cx - tw / 2 - 1, ty], [cx + tw / 2 + 1, ty], [cx + tw / 2 + 3 + (step === -1 ? 1 : 0), 28], [cx - tw / 2 - 3 - (step === 1 ? 1 : 0), 28]]);
    shade(img, m, R(spec.cape), { round: 0.4 });
    for (const x of [cx - 3, cx + 2]) for (let y = Math.round(ty) + 3; y < 27; y++) img.set(x, y, R(spec.cape)[1]!);
  }
  if (spec.tail && dir === "up") {
    const m = mask().stroke(cx, ty + g.th, cx + 3 + (frame % 2), ty + g.th + 4, 1.4);
    shade(img, m, R(spec.tail));
  }

  // held item in front
  if (spec.item && spec.item !== "shield" && dir !== "up") drawItem(spec.item, (m, c, o) => shade(img, m, c, o), cx, ty, dir, step, false);

  if (ghost) for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! > 0) img.data[i] = 215;
  outline(img, { fixed: ghost ? parseHex("#3a3a5a") : OUTLINE });
  return flip ? mirror(img) : img;
}

function paintHair(img: Img, style: HairStyle, c: Color[], dir: "down" | "side" | "up", cx: number, hy: number, g: Geo, hatted: boolean, frame: number) {
  if (style === "bald") return;
  const m = mask();
  const { hrx, hry } = g;
  const top = hy - hry;
  if (dir === "up") {
    m.ellipse(cx, hy - 0.3, hrx + 0.7, hry + 0.5);
    if (style === "long") m.rrect(Math.round(cx - hrx), Math.round(hy), Math.round(hrx * 2), 9, 2);
    if (style === "bob") m.rect(Math.round(cx - hrx - 0.5), Math.round(hy), Math.round(hrx * 2 + 1), 4);
  } else if (dir === "down") {
    m.ellipse(cx, hy - 1.2, hrx + 0.8, hry - 0.2);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const fringe = hy - 2 + ((x * 5 + 1) % 4 === 0 ? 1 : 0);
      if (y > fringe && Math.abs(x + 0.5 - cx) < hrx - 1.2) m.off(x, y);
    }
    const sideLen = style === "long" ? 9 : style === "bob" ? 6 : style === "short" || style === "spiky" || style === "messy" ? 3 : 4;
    m.rect(Math.round(cx - hrx - 0.8), Math.round(hy - 2), 2, sideLen).rect(Math.round(cx + hrx - 1.2), Math.round(hy - 2), 2, sideLen);
  } else {
    m.ellipse(cx + 0.5, hy - 1, hrx + 0.8, hry - 0.1);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (y > hy - 2 + (x % 3 === 0 ? 1 : 0) && x < cx - 1) m.off(x, y);
    if (style === "long") m.rrect(Math.round(cx - 1), Math.round(hy - 1), Math.round(hrx + 1.5), 10, 2);
    if (style === "bob") m.rect(Math.round(cx - 1), Math.round(hy - 1), Math.round(hrx + 1.5), 5);
    if (style !== "long" && style !== "bob") m.rect(Math.round(cx), Math.round(hy - 1), Math.round(hrx + 0.5), 4);
  }
  if (style === "spiky" && !hatted) for (const [dx, h] of [[-4, 3], [0, 4], [4, 3], [-2, 3.5], [2, 3.5]] as const) m.poly([[cx + dx - 2, top + 2], [cx + dx + (dir === "side" ? 1.5 : 0), top - h + 1], [cx + dx + 2, top + 2]]);
  if (style === "messy" && !hatted) for (const dx of [-5, -2, 1, 4]) m.ellipse(cx + dx, top + 1, 2, 1.8);
  if (style === "bun" && !hatted) m.ellipse(cx + (dir === "side" ? 3 : 0), top - 0.5, 3, 2.6);
  if (style === "ponytail" && dir !== "down") { const sway = frame % 2; m.stroke(cx + (dir === "side" ? hrx - 1 : 0), hy - 2, cx + (dir === "side" ? hrx + 2 : sway), hy + 6, 1.6); }
  if (style === "ponytail" && dir === "down") m.rect(Math.round(cx + hrx - 0.5), Math.round(hy - 1), 2, 6);
  if (style === "twintails") for (const side of dir === "side" ? [1] : [-1, 1]) m.stroke(cx + side * (hrx + 0.5), hy - 2, cx + side * (hrx + 2), hy + 5, 1.7);
  shade(img, m, c, { bevel: 2.5, round: 0.7 });
  // shine streak
  if (dir !== "up") for (let k = 0; k < 3; k++) { const x = Math.round(cx - 3 + k), y = Math.round(top + 2 - (k === 1 ? 1 : 0)); if (m.has(x, y)) img.set(x, y, c[4]!); }
}

function paintHeadgear(img: Img, type: Headgear, c: Color[], acc: Color[], dir: "down" | "side" | "up", cx: number, hy: number, g: Geo) {
  const { hrx, hry } = g;
  const top = hy - hry;
  const sx = dir === "side" ? 1 : 0;
  switch (type) {
    case "hat": case "straw": {
      shade(img, mask().rrect(Math.round(cx - 4 + sx), Math.round(top - 3), 8, 6, 2), c, { bevel: 2 });
      shade(img, mask().ellipse(cx + sx * 0.5, top + 3, hrx + 3.5, 2), c, { bevel: 1.5 });
      for (let x = Math.round(cx - 4 + sx); x < cx + 4 + sx; x++) img.set(x, Math.round(top + 1), acc[type === "straw" ? 1 : 2]!);
      break;
    }
    case "wizard": {
      const tipX = cx + (dir === "side" ? 6 : 5);
      shade(img, mask().poly([[cx - hrx + 1, top + 3], [cx + hrx - 1, top + 3], [tipX + 1, 0], [tipX - 1, 0]]), c, { bevel: 2, round: 0.5 });
      shade(img, mask().ellipse(cx, top + 3.5, hrx + 3, 1.8), c, { bevel: 1.2 });
      for (let x = Math.round(cx - hrx + 1); x < cx + hrx - 1; x++) img.set(x, Math.round(top + 2), acc[3]!);
      break;
    }
    case "hood": {
      const m = mask().ellipse(cx, hy - 0.5, hrx + 1.4, hry + 1);
      m.rect(Math.round(cx - hrx - 1), Math.round(hy), Math.round(hrx * 2 + 2), Math.round(hry + 1));
      if (dir === "down") m.subtract(mask().ellipse(cx, hy + 1.5, hrx - 1.5, hry - 1.5));
      if (dir === "side") m.subtract(mask().ellipse(cx - 3, hy + 1.5, hrx - 3, hry - 1.8));
      shade(img, m, c, { bevel: 2.5, round: 0.6 });
      break;
    }
    case "helmet": {
      const m = mask().ellipse(cx, hy - 0.5, hrx + 1, hry + 0.5);
      if (dir === "down") { for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (y > hy - 1 && Math.abs(x + 0.5 - cx) < hrx - 1.5) m.off(x, y); }
      if (dir === "side") { for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (y > hy - 1 && x < cx - 1) m.off(x, y); }
      shade(img, m, c, { bevel: 2.5, round: 0.8, gloss: true });
      const crest = mask().rect(Math.round(cx - (dir === "side" ? 0 : 1)), Math.round(top - 3), dir === "side" ? 5 : 2, 4);
      shade(img, crest, acc, { bevel: 1 });
      break;
    }
    case "cap": {
      shade(img, mask().ellipse(cx, top + 2, hrx + 0.6, 3.5), c, { bevel: 2 });
      if (dir === "down") shade(img, mask().ellipse(cx, top + 5, hrx - 1, 1.2), acc, { bevel: 1 });
      if (dir === "side") shade(img, mask().rect(Math.round(cx - hrx - 2), Math.round(top + 4), 5, 2), acc, { bevel: 1 });
      break;
    }
    case "crown": {
      const m = mask().rect(Math.round(cx - 4), Math.round(top - 1), 8, 3);
      for (const dx of [-4, -1, 2]) m.poly([[cx + dx, top - 1], [cx + dx + 1, top - 4], [cx + dx + 2, top - 1]]);
      shade(img, m, R(P.gold), { bevel: 1, gloss: true });
      if (dir !== "up") img.set(cx, Math.round(top), parseHex(P.ruby));
      break;
    }
    case "bandana": {
      const m = mask().rect(Math.round(cx - hrx), Math.round(top + 2), Math.round(hrx * 2 + 1), 2);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (!mask().ellipse(cx, hy, hrx + 0.6, hry + 0.6).has(x, y)) m.off(x, y);
      if (dir !== "down") m.stroke(cx + hrx - 1, top + 3, cx + hrx + 2, top + 6, 0.8);
      shade(img, m, c, { bevel: 1 });
      break;
    }
    case "horns": {
      for (const side of dir === "side" ? [1] : [-1, 1]) shade(img, mask().poly([[cx + side * 2, top + 2], [cx + side * 5, top + 2], [cx + side * 6, top - 4]]), c, { bevel: 1 });
      break;
    }
    case "veil": {
      const m = mask().ellipse(cx, hy - 1, hrx + 1.2, hry + 0.4);
      m.rect(Math.round(cx - hrx - 1), Math.round(hy - 1), Math.round(hrx * 2 + 2), 10);
      if (dir === "down") m.subtract(mask().ellipse(cx, hy + 1, hrx - 1.4, hry - 1.2)).subtract(mask().rect(Math.round(cx - hrx + 1), Math.round(hy + 1), Math.round(hrx * 2 - 2), 10));
      if (dir === "side") m.subtract(mask().ellipse(cx - 3, hy + 1, hrx - 3, hry - 1.5)).subtract(mask().rect(0, Math.round(hy + 1), Math.round(cx - 1), 10));
      shade(img, m, c, { bevel: 2, round: 0.4 });
      break;
    }
  }
}

function drawItem(item: Item, paint: (m: Mask, c: Color[], o?: Layer["opts"]) => void, cx: number, ty: number, dir: "down" | "side" | "up", step: number, behind: boolean) {
  const hx = dir === "down" ? cx + 7 : dir === "side" ? cx - 3 + step * 2 : cx - 7;
  const hy = ty + 7;
  const wood = R(P.woodDark), metal = R("#c8ccd4");
  switch (item) {
    case "staff": paint(mask().rect(Math.round(hx), Math.round(hy - 12), 1, 17), wood); paint(mask().ellipse(hx + 0.5, hy - 13, 2, 2), R(P.crystal, 5, 1.1), { gloss: true }); break;
    case "spear": paint(mask().rect(Math.round(hx), Math.round(hy - 13), 1, 18), wood); paint(mask().poly([[hx - 1.5, hy - 13], [hx + 0.5, hy - 18], [hx + 2.5, hy - 13]]), metal); break;
    case "sword": if (dir === "up" && !behind) return; paint(mask().rect(Math.round(hx), Math.round(hy - 8), 1, 8), metal); paint(mask().rect(Math.round(hx - 1), Math.round(hy), 3, 1), R(P.gold)); paint(mask().rect(Math.round(hx), Math.round(hy + 1), 1, 2), wood); break;
    case "axe": paint(mask().rect(Math.round(hx), Math.round(hy - 8), 1, 11), wood); paint(mask().ellipse(hx + 2, hy - 7, 2.5, 2.5).rect(Math.round(hx), Math.round(hy - 8), 2, 3), metal); break;
    case "pick": paint(mask().rect(Math.round(hx), Math.round(hy - 7), 1, 10), wood); paint(mask().poly([[hx - 4, hy - 6], [hx + 0.5, hy - 9], [hx + 5, hy - 6], [hx + 0.5, hy - 7.5]]), metal); break;
    case "bow": { const m = mask(); for (let k = -6; k <= 6; k++) m.on(hx + 1 - Math.round((36 - k * k) / 14), hy - 2 + k); m.rect(Math.round(hx + 1), Math.round(hy - 8), 1, 13, 1); paint(m, wood); break; }
    case "book": if (dir === "up") return; paint(mask().rect(Math.round(cx - 3 + (dir === "side" ? -3 : 0)), Math.round(hy - 2), 6, 4), R(P.red)); break;
    case "lantern": paint(mask().rect(Math.round(hx - 1), Math.round(hy), 3, 4), R(P.gold, 5, 1.2), { gloss: true }); break;
    case "basket": if (dir === "up") return; paint(mask().ellipse(hx, hy + 1, 3, 2.2).rect(Math.round(hx - 3), Math.round(hy - 1), 6, 2, 0), R(P.straw)); break;
    case "shield": {
      const sx = dir === "down" ? cx - 7 : cx - 4;
      paint(mask().rrect(Math.round(sx - 2), Math.round(ty + 1), 5, 7, 2), R(P.blue), { gloss: true });
      break;
    }
  }
}

function mirror(img: Img): Img { const out = new Img(img.w, img.h); out.draw(img, 0, 0, { flipX: true }); return out; }
const darkenHex = (h: string) => `#${shift(parseHex(h), -0.25).toString(16).padStart(6, "0")}`;
const shiftRamp = (c: Color[], k: number) => c.map(x => shift(x, k));
const mixC = (a: Color, b: Color, t: number) => { const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255; return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t); };

/** Full sheet: 4 columns × 4 rows of 64px cells. */
export function renderCharacterSheet(spec: CharacterSpec): Img {
  const sheet = new Img(128, 128);
  FACINGS.forEach((facing, row) => { for (let frame = 0; frame < 4; frame++) sheet.draw(drawCharacterFrame(spec, facing, frame), frame * 32, row * 32); });
  return sheet.scale(2);
}

/* ------------------------------------------------------------------ the cast */

const H = { brown: "#7a4a2a", black: "#2e2a34", blond: "#e8c25a", red: "#c0482e", white: "#e8e4dc", grey: "#9a98a0", blue: "#4a6ad0", pink: "#e888b0", green: "#4a9a5a", silver: "#c8ccd8", auburn: "#9a3a2a", purple: "#8a5ac0" };

export const CHARACTERS: CharacterSpec[] = [
  { id: "hero-swordsman", name: "剣士の若者", tags: ["hero", "fighter"], hair: { style: "spiky", color: H.brown }, outfit: { type: "tunic", main: "#3a6ab0", accent: "#6a4a2a", pants: "#4a4038" }, cape: "#b84a3a", item: "sword" },
  { id: "hero-heroine", name: "旅の少女", tags: ["hero"], hair: { style: "ponytail", color: H.red }, outfit: { type: "tunic", main: "#5a9a4a", accent: "#6a4a2a", pants: "#5a4a3a" }, item: "sword" },
  { id: "knight", name: "騎士", tags: ["knight", "guard", "fighter"], outfit: { type: "armor", main: P.iron, accent: "#3a5ab0", pants: "#5a5a6a", shoes: "#5a5a6a" }, headgear: { type: "helmet", color: "#a8b0bc", accent: P.red }, cape: "#3a5ab0", item: "shield" },
  { id: "knight-dark", name: "黒騎士", tags: ["knight", "villain"], outfit: { type: "armor", main: "#4a4a5a", accent: "#7a2a3a", pants: "#3a3a44", shoes: "#3a3a44" }, headgear: { type: "helmet", color: "#4a4a5a", accent: "#7a2a3a" }, cape: "#5a1a2a", item: "sword" },
  { id: "guard", name: "門番", tags: ["guard", "town"], hair: { style: "short", color: H.black }, outfit: { type: "armor", main: P.iron, accent: "#8a3a2a", pants: "#4a4a5e" }, headgear: { type: "cap", color: "#8a3a2a", accent: P.iron }, item: "spear" },
  { id: "mage", name: "魔法使い", tags: ["mage", "magic"], hair: { style: "long", color: H.silver }, outfit: { type: "robe", main: "#4a3a9a", accent: P.gold }, headgear: { type: "wizard", color: "#4a3a9a", accent: P.gold }, item: "staff" },
  { id: "mage-red", name: "炎の魔導士", tags: ["mage", "magic"], hair: { style: "short", color: H.red }, outfit: { type: "robe", main: "#a83a2a", accent: P.gold }, headgear: { type: "wizard", color: "#a83a2a", accent: P.gold }, item: "staff" },
  { id: "witch", name: "森の魔女", tags: ["mage", "witch"], hair: { style: "long", color: H.purple }, outfit: { type: "dress", main: "#2e2a3a", accent: P.purple }, headgear: { type: "wizard", color: "#2e2a3a", accent: P.purple }, item: "book" },
  { id: "priest", name: "司祭", tags: ["priest", "church", "healer"], hair: { style: "short", color: H.grey }, outfit: { type: "robe", main: P.white, accent: P.gold }, item: "book" },
  { id: "nun", name: "修道女", tags: ["priest", "church", "healer"], outfit: { type: "dress", main: "#2e2e3e", accent: P.white }, headgear: { type: "veil", color: "#2e2e3e" } },
  { id: "thief", name: "盗賊", tags: ["thief", "rogue"], hair: { style: "messy", color: H.black }, outfit: { type: "vest", main: "#4a4a3a", accent: "#2e2a2a", pants: "#3a3a3a" }, headgear: { type: "bandana", color: "#8a2a2a" }, item: "sword" },
  { id: "hunter", name: "狩人", tags: ["hunter", "ranger"], hair: { style: "short", color: H.auburn }, outfit: { type: "vest", main: "#6a8a4a", accent: "#6a4a2a", pants: "#4a3a2a" }, headgear: { type: "hood", color: "#4a6a3a" }, item: "bow" },
  { id: "merchant", name: "商人", tags: ["merchant", "shop", "town"], body: "stout", hair: { style: "short", color: H.brown }, outfit: { type: "coat", main: "#8a5a2a", accent: P.gold, pants: "#4a3a2a" }, headgear: { type: "hat", color: "#5a3a2a", accent: P.red }, item: "basket" },
  { id: "shopkeeper", name: "道具屋", tags: ["merchant", "shop", "town"], hair: { style: "bun", color: H.brown }, outfit: { type: "dress", main: "#c87a4a", accent: P.white } },
  { id: "innkeeper", name: "宿屋の主人", tags: ["town", "inn"], body: "stout", hair: { style: "bald", color: H.brown }, beard: "#6a4a2a", outfit: { type: "vest", main: P.white, accent: "#6a4a2a", pants: "#4a4a5e" } },
  { id: "elder", name: "長老", tags: ["elder", "village"], hair: { style: "short", color: H.white }, beard: H.white, outfit: { type: "robe", main: "#7a6a4a", accent: "#4a3a2a" }, item: "staff" },
  { id: "old-woman", name: "おばあさん", tags: ["elder", "village"], hair: { style: "bun", color: H.grey }, outfit: { type: "dress", main: "#7a4a6a", accent: "#c8b088" } },
  { id: "villager-man", name: "村の男", tags: ["villager", "village"], hair: { style: "short", color: H.brown }, outfit: { type: "tunic", main: "#8a7a5a", accent: "#5a4a2a", pants: "#4a5a6a" } },
  { id: "villager-woman", name: "村の女", tags: ["villager", "village"], hair: { style: "long", color: H.auburn }, outfit: { type: "dress", main: "#5a8ab0", accent: P.white } },
  { id: "farmer", name: "農夫", tags: ["villager", "farm"], skin: P.skin2, hair: { style: "short", color: H.black }, outfit: { type: "tunic", main: "#c8a86a", accent: "#6a4a2a", pants: "#4a6a8a" }, headgear: { type: "straw", color: P.straw }, item: "pick" },
  { id: "child-boy", name: "男の子", tags: ["child", "village"], body: "child", hair: { style: "spiky", color: H.blond }, outfit: { type: "tunic", main: "#c84a3a", accent: "#4a3a2a", pants: "#4a5a8a" } },
  { id: "child-girl", name: "女の子", tags: ["child", "village"], body: "child", hair: { style: "twintails", color: H.brown }, outfit: { type: "dress", main: "#e888a8", accent: P.white } },
  { id: "noble", name: "貴族", tags: ["noble", "castle"], body: "slim", hair: { style: "short", color: H.blond }, outfit: { type: "coat", main: "#6a2a6a", accent: P.gold, pants: P.white }, cape: "#3a2a6a" },
  { id: "princess", name: "王女", tags: ["noble", "castle", "royal"], body: "slim", hair: { style: "long", color: H.blond }, outfit: { type: "dress", main: "#e88ab8", accent: P.gold }, headgear: { type: "crown", color: P.gold } },
  { id: "king", name: "王", tags: ["noble", "castle", "royal"], body: "stout", hair: { style: "short", color: H.white }, beard: H.white, outfit: { type: "robe", main: "#a82a3a", accent: P.gold }, headgear: { type: "crown", color: P.gold }, cape: "#a82a3a" },
  { id: "elf-archer", name: "エルフの弓使い", tags: ["elf", "ranger"], body: "slim", skin: P.skin5, ears: "elf", hair: { style: "long", color: H.blond }, outfit: { type: "tunic", main: "#3a8a5a", accent: "#6a4a2a", pants: "#4a5a3a" }, item: "bow" },
  { id: "elf-sage", name: "エルフの賢者", tags: ["elf", "mage"], body: "slim", ears: "elf", hair: { style: "long", color: H.silver }, outfit: { type: "robe", main: "#3a7a8a", accent: P.white }, item: "staff" },
  { id: "dwarf", name: "ドワーフの鍛冶師", tags: ["dwarf", "smith"], body: "stout", skin: P.skin2, hair: { style: "bald", color: H.red }, beard: H.red, outfit: { type: "vest", main: "#7a5a3a", accent: "#4a3a2a", pants: "#5a4a3a" }, headgear: { type: "helmet", color: "#a88a4a", accent: "#a88a4a" }, item: "axe" },
  { id: "miner", name: "鉱夫", tags: ["dwarf", "mine"], body: "stout", skin: P.skin3, hair: { style: "short", color: H.black }, beard: H.black, outfit: { type: "tunic", main: "#6a6a7a", accent: "#4a3a2a", pants: "#4a4038" }, headgear: { type: "cap", color: P.gold, accent: "#8a8a8a" }, item: "pick" },
  { id: "catfolk", name: "猫の獣人", tags: ["beastfolk", "cat"], hair: { style: "bob", color: "#e8a050" }, ears: "cat", tail: "#e8a050", outfit: { type: "vest", main: "#3a8a8a", accent: "#2a4a4a", pants: "#4a4a5e" } },
  { id: "wolffolk", name: "狼の獣人", tags: ["beastfolk", "wolf", "fighter"], skin: P.skin2, hair: { style: "messy", color: "#8a8a9a" }, ears: "cat", tail: "#8a8a9a", outfit: { type: "rags", main: "#6a5a4a", pants: "#4a3a2a" }, item: "axe" },
  { id: "rabbitfolk", name: "兎の獣人", tags: ["beastfolk", "rabbit"], body: "child", hair: { style: "bob", color: H.white }, ears: "rabbit", earColor: H.white, outfit: { type: "dress", main: "#8ab0e8", accent: P.white } },
  { id: "dogfolk", name: "犬の獣人", tags: ["beastfolk", "dog"], hair: { style: "short", color: "#a86a3a" }, ears: "dog", tail: "#a86a3a", outfit: { type: "tunic", main: "#c8a050", accent: "#6a4a2a", pants: "#4a4a5e" }, item: "lantern" },
  { id: "oni", name: "鬼の若者", tags: ["demon", "oni"], skin: "#d8806a", hair: { style: "messy", color: H.black }, headgear: { type: "horns", color: "#f0e8c8" }, outfit: { type: "vest", main: "#e8d8a0", accent: "#3a3a4a", pants: "#3a3a4a" } },
  { id: "demon", name: "魔族", tags: ["demon", "villain"], body: "slim", skin: "#d8d0e0", ears: "elf", hair: { style: "long", color: "#c83a4a" }, headgear: { type: "horns", color: "#3a2a2a" }, outfit: { type: "coat", main: "#3a2a4a", accent: "#a82a3a", pants: "#2a2a3a" }, cape: "#2a1a2a" },
  { id: "ninja", name: "忍び", tags: ["ninja", "rogue"], body: "slim", hair: { style: "ponytail", color: H.black }, outfit: { type: "tunic", main: "#2e2e3e", accent: "#8a2a2a", pants: "#2e2e3e", shoes: "#2e2e3e" }, headgear: { type: "bandana", color: "#2e2e3e" }, item: "sword" },
  { id: "samurai", name: "侍", tags: ["samurai", "fighter"], skin: P.skin2, hair: { style: "bun", color: H.black }, outfit: { type: "robe", main: "#3a4a7a", accent: "#c8b088" }, item: "sword" },
  { id: "sailor", name: "船乗り", tags: ["sailor", "port"], skin: P.skin3, hair: { style: "short", color: H.black }, outfit: { type: "tunic", main: "#e8e8f0", accent: "#3a5ab0", pants: "#3a5ab0" }, headgear: { type: "bandana", color: P.red } },
  { id: "pirate", name: "海賊", tags: ["pirate", "villain", "port"], skin: P.skin2, hair: { style: "messy", color: H.black }, beard: H.black, outfit: { type: "coat", main: "#8a2a2a", accent: P.gold, pants: "#3a3a4a" }, headgear: { type: "hat", color: "#2e2a2a", accent: P.gold }, item: "sword" },
  { id: "bard", name: "吟遊詩人", tags: ["bard", "town"], body: "slim", hair: { style: "bob", color: H.blond }, outfit: { type: "vest", main: "#c86a3a", accent: "#5a3a7a", pants: "#3a5a3a" }, headgear: { type: "hat", color: "#3a6a3a", accent: P.red } },
  { id: "scholar", name: "学者", tags: ["scholar", "library"], hair: { style: "short", color: H.grey }, outfit: { type: "coat", main: "#5a5a6a", accent: "#3a3a4a", pants: "#3a3a4a" }, item: "book" },
  { id: "dancer", name: "踊り子", tags: ["dancer", "town"], skin: P.skin3, body: "slim", hair: { style: "long", color: H.black }, outfit: { type: "dress", main: "#e8b03a", accent: P.red } },
  { id: "monk", name: "武闘家", tags: ["monk", "fighter"], skin: P.skin2, hair: { style: "bald", color: H.black }, outfit: { type: "tunic", main: "#e89a3a", accent: "#8a3a2a", pants: "#e89a3a" } },
  { id: "traveler", name: "フードの旅人", tags: ["traveler", "mystery"], outfit: { type: "robe", main: "#6a5a4a", accent: "#4a3a2a" }, headgear: { type: "hood", color: "#5a4a3a" }, item: "staff" },
  { id: "robot", name: "からくり人形", tags: ["robot", "machine"], special: "robot", outfit: { type: "armor", main: P.iron, accent: "#40a0c0", pants: "#6a7480", shoes: "#5a6470" }, headgear: { type: "helmet", color: "#9aa4b0", accent: "#40a0c0" } },
  { id: "ghost", name: "幽霊", tags: ["ghost", "undead"], special: "ghost", skin: "#e0e8f8", outfit: { type: "robe", main: "#d8e4f8" } },
  { id: "skeleton-npc", name: "骸骨の住人", tags: ["undead", "skeleton"], special: "skeleton", outfit: { type: "rags", main: "#5a4a5a", pants: "#4a3a4a", shoes: "#3a2a3a" } },
  { id: "doctor", name: "医者", tags: ["doctor", "town", "healer"], hair: { style: "short", color: H.brown }, outfit: { type: "coat", main: "#f0f0f0", accent: "#4a8a8a", pants: "#4a4a5e" }, item: "basket" },
  { id: "chef", name: "料理人", tags: ["chef", "inn"], body: "stout", hair: { style: "short", color: H.brown }, outfit: { type: "tunic", main: "#f0f0f0", accent: P.red, pants: "#4a4a5e" }, headgear: { type: "cap", color: "#f8f8f8", accent: "#f8f8f8" } },
  { id: "fairy-kid", name: "妖精の子", tags: ["fairy", "child"], body: "child", skin: P.skin5, ears: "elf", hair: { style: "bob", color: H.green }, outfit: { type: "dress", main: "#8ae0a0", accent: P.white } },
  { id: "blue-haired-mage", name: "青髪の魔術師", tags: ["mage", "hero"], body: "slim", hair: { style: "long", color: H.blue }, outfit: { type: "robe", main: "#2a4a6a", accent: "#e8d070" }, cape: "#1a2a4a", item: "book" },
  { id: "pink-healer", name: "癒し手", tags: ["healer", "hero"], hair: { style: "twintails", color: H.pink }, outfit: { type: "dress", main: P.white, accent: "#e888b0" }, item: "staff" },
  { id: "soldier", name: "兵士", tags: ["soldier", "guard"], skin: P.skin3, outfit: { type: "armor", main: P.iron, accent: "#4a6a3a", pants: "#4a5a3a" }, headgear: { type: "helmet", color: "#8a9488", accent: "#8a9488" }, item: "spear" },
];

/* ------------------------------------------------------------------ キャラクター作り（部品を選んで作る） */

export const BODY_TYPES: BodyType[] = ["adult", "slim", "child", "stout"];
export const HAIR_STYLES: HairStyle[] = ["short", "long", "ponytail", "spiky", "bob", "bun", "twintails", "messy", "bald"];
export const OUTFITS: Outfit[] = ["tunic", "robe", "dress", "armor", "vest", "coat", "rags"];
export const HEADGEARS: Headgear[] = ["hat", "wizard", "hood", "helmet", "cap", "crown", "bandana", "horns", "veil", "straw"];
export const ITEMS: Item[] = ["sword", "staff", "spear", "bow", "book", "lantern", "basket", "shield", "axe", "pick"];
export const EARS = ["elf", "cat", "dog", "rabbit"] as const;
export const SPECIALS = ["ghost", "robot", "skeleton"] as const;
export const PART_LABELS: Record<string, string> = {
  adult: "大人", slim: "細身", child: "子ども", stout: "がっしり",
  short: "短い", long: "長い", ponytail: "ポニーテール", spiky: "ツンツン", bob: "ボブ", bun: "おだんご", twintails: "ツインテール", messy: "ぼさぼさ", bald: "なし",
  tunic: "チュニック", robe: "ローブ", dress: "ドレス", armor: "よろい", vest: "ベスト", coat: "コート", rags: "ぼろ布",
  hat: "帽子", wizard: "とんがり帽子", hood: "フード", helmet: "かぶと", cap: "キャップ", crown: "王冠", bandana: "バンダナ", horns: "角", veil: "ベール", straw: "麦わら帽子",
  sword: "剣", staff: "杖", spear: "槍", bow: "弓", book: "本", lantern: "ランタン", basket: "かご", shield: "盾", axe: "斧", pick: "つるはし",
  elf: "とがった耳", cat: "ねこ耳", dog: "いぬ耳", rabbit: "うさぎ耳", ghost: "幽霊", robot: "ロボット", skeleton: "がいこつ",
};

const SKINS = ["#f2d0b0", "#e8b890", "#c89068", "#9a6a48", "#6a4a34", "#f6dcc8"];
const PALETTE = ["#3a6ab0", "#5a9a4a", "#a83a2a", "#4a3a9a", "#c89a3a", "#2e2a3a", "#8a5ac0", "#e888b0", "#3a8a8a", "#6a4a2a", "#e8e4dc", "#5a5a6a"];

/** おまかせ: a random but coherent character from a seed (same seed = same character). */
export function randomCharacter(seed: number | string, id = "custom", name = "おまかせの人"): CharacterSpec {
  let s = typeof seed === "number" ? seed >>> 0 : [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const r = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = <T,>(list: readonly T[]) => list[Math.floor(r() * list.length)]!;
  const outfit = pick(OUTFITS);
  const spec: CharacterSpec = {
    id, name, tags: ["custom"],
    body: pick(BODY_TYPES), skin: pick(SKINS),
    hair: { style: pick(HAIR_STYLES), color: pick(Object.values(H)) },
    outfit: { type: outfit, main: pick(PALETTE), accent: pick(PALETTE), pants: pick(["#4a4038", "#3a3a44", "#5a4a3a", "#2e2a34"]) },
  };
  if (r() < 0.45) spec.headgear = { type: pick(outfit === "armor" ? ["helmet", "cap", "bandana"] as Headgear[] : HEADGEARS), color: pick(PALETTE), accent: pick(PALETTE) };
  if (r() < 0.6) spec.item = pick(ITEMS);
  if (r() < 0.25) spec.cape = pick(PALETTE);
  if (r() < 0.15) { spec.ears = pick(EARS); spec.earColor = spec.hair!.color; if (spec.ears === "cat" || spec.ears === "dog") spec.tail = spec.hair!.color; }
  return spec;
}

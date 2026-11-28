/**
 * 顔グラフィック（会話の顔）: キャラクター作りと同じ部品（CharacterSpec）から、胸から上の絵を表情つきで描く。
 * 1コマ 96×96（48×48 を2倍）、表情は 普通・笑顔・怒り・悲しみ・驚き の5コマ（会話の face 0〜4）。
 * 内蔵ジェネレーターのオリジナル生成（MIT）。
 */
import { Img, Mask, outline, parseHex, shade, shift, type Color } from "./core";
import { P, R } from "./paint";
import type { CharacterSpec } from "./characters";

export const EXPRESSIONS = ["normal", "smile", "angry", "sad", "surprised"] as const;
export type Expression = (typeof EXPRESSIONS)[number];
export const EXPRESSION_LABELS: Record<Expression, string> = { normal: "普通", smile: "笑顔", angry: "怒り", sad: "悲しみ", surprised: "驚き" };

const S = 48;
const m = () => new Mask(S, S);
const OUTLINE = parseHex("#231b26");
const dark = (h: string, k = -0.25) => `#${shift(parseHex(h), k).toString(16).padStart(6, "0")}`;

export function drawPortrait(spec: CharacterSpec, expression: Expression = "normal"): Img {
  const img = new Img(S, S);
  const cx = 24;
  const child = spec.body === "child";
  const hy = child ? 22 : 20, hrx = child ? 10.5 : 9.5, hry = child ? 10.5 : 11;
  const skinHex = spec.special === "skeleton" ? P.bone : spec.special === "robot" ? P.iron : spec.skin ?? P.skin1;
  const skin = R(skinHex, 5, 0.55);
  const hairHex = spec.hair?.color;
  const hair = hairHex ? R(hairHex) : undefined;
  const top = hy - hry;

  /* ---- behind the head ---- */
  if (spec.cape) shade(img, m().poly([[2, 48], [6, 36], [16, 33], [32, 33], [42, 36], [46, 48]]), R(dark(spec.cape)), { bevel: 3 });
  if (hair) {
    const style = spec.hair!.style;
    const back = m();
    if (style === "long") back.rect(cx - hrx - 1, hy - 2, hrx * 2 + 2, 22).ellipse(cx, hy, hrx + 1.5, hry + 1);
    if (style === "ponytail") back.ellipse(cx + hrx - 1, hy + 4, 4, 8);
    if (style === "twintails") back.ellipse(cx - hrx - 2, hy + 6, 3.5, 9).ellipse(cx + hrx + 2, hy + 6, 3.5, 9);
    if (style === "bun") back.ellipse(cx, top - 1, 5, 4);
    if (style === "bob") back.rect(cx - hrx - 1, hy - 2, hrx * 2 + 2, 11).ellipse(cx, hy, hrx + 1.2, hry + 0.6);
    shade(img, back, R(dark(hairHex!, -0.12)), { bevel: 3 });
  }
  if (spec.ears && spec.ears !== "elf") {
    const c = R(spec.earColor ?? hairHex ?? skinHex);
    for (const side of [-1, 1]) {
      const ex = cx + side * (hrx - 2);
      const ear = spec.ears === "rabbit" ? m().ellipse(ex, top - 6, 2.6, 7.5) : spec.ears === "dog" ? m().ellipse(cx + side * (hrx + 3), top + 8, 3.4, 7) : m().poly([[ex - 4, top + 4], [ex + side * 2, top - 6], [ex + 4, top + 4]]);
      shade(img, ear, c, { bevel: 2 });
    }
  }

  /* ---- shoulders and neck ---- */
  const outfit = spec.outfit;
  const main = outfit.type === "armor" ? R(outfit.main, 6) : R(outfit.main);
  const acc = R(outfit.accent ?? outfit.main);
  if (spec.special !== "ghost") shade(img, m().rect(cx - 3, hy + hry - 3, 6, 8), R(dark(skinHex, -0.1), 5, 0.5), { bevel: 1 });
  const body = m().poly([[5, 48], [8, 39], [16, 35], [32, 35], [40, 39], [43, 48]]);
  shade(img, body, spec.special === "ghost" ? R(outfit.main, 5, 0.6) : main, { bevel: 4, round: 0.5 });
  const collar = m();
  if (outfit.type === "tunic" || outfit.type === "vest" || outfit.type === "rags") collar.poly([[cx - 5, 35], [cx, 42], [cx + 5, 35]]);
  else if (outfit.type === "robe" || outfit.type === "dress") collar.rect(cx - 7, 35, 14, 2).ellipse(cx, 36, 7, 2);
  else if (outfit.type === "coat") collar.poly([[cx - 6, 35], [cx - 1, 46], [cx - 3, 35]]).poly([[cx + 6, 35], [cx + 1, 46], [cx + 3, 35]]);
  else if (outfit.type === "armor") { collar.ellipse(9, 40, 5, 4).ellipse(39, 40, 5, 4); }
  shade(img, collar, outfit.type === "armor" ? R(P.iron, 6) : acc, { bevel: 2, gloss: outfit.type === "armor" });

  /* ---- head ---- */
  const head = m().ellipse(cx, hy, hrx, hry);
  if (spec.ears === "elf") for (const side of [-1, 1]) head.poly([[cx + side * (hrx - 1), hy - 2], [cx + side * (hrx + 5), hy - 6], [cx + side * (hrx - 1), hy + 3]]);
  shade(img, head, skin, { bevel: 4, round: 0.4, alpha: spec.special === "ghost" ? 200 : 255 });

  /* ---- face ---- */
  const ink = spec.special === "robot" ? parseHex("#40e0f0") : parseHex("#2a2034");
  const white = 0xffffff;
  const ey = hy + 1, exs = [cx - 4, cx + 4];
  const browY = expression === "surprised" ? ey - 5 : ey - 4;
  const browC = hairHex ? parseHex(dark(hairHex, -0.3)) : parseHex("#5a3e32"); // no hair: a neutral dark brown
  if (spec.special === "skeleton") {
    for (const x of exs) shade(img, m().ellipse(x, ey, 2.4, 2.6), R("#1a1418", 4), { bevel: 1 });
    for (let x = cx - 3; x <= cx + 3; x += 2) img.set(x, hy + 7, parseHex("#f0ead8"));
    img.set(cx, hy + 4, parseHex("#3a3030"));
  } else {
    for (const x of exs) {
      if (expression === "smile") { img.set(x - 1, ey + 1, ink); img.set(x, ey, ink); img.set(x + 1, ey + 1, ink); }
      else if (expression === "surprised") { for (let dy = -2; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) img.set(x + dx, ey + dy, ink); img.set(x - 1, ey - 2, white); }
      else { for (let dy = -1; dy <= 1; dy++) { img.set(x, ey + dy, ink); img.set(x + 1, ey + dy, ink); } img.set(x, ey - 1, white); }
      // eyebrows
      const inner = x < cx ? x + 2 : x - 1, outer = x < cx ? x - 2 : x + 3;
      const tilt = expression === "angry" ? 1 : expression === "sad" ? -1 : 0;
      for (let k = 0; k <= 3; k++) { const bx = outer + (inner - outer) * (k / 3); img.set(Math.round(bx), browY + Math.round(tilt * (k / 3) * 1.5), browC); }
    }
    img.set(cx, hy + 4, parseHex(dark(skinHex, -0.3)));
    const my = hy + 7;
    if (expression === "smile") { for (let dx = -3; dx <= 3; dx++) img.set(cx + dx, my + (Math.abs(dx) === 3 ? -1 : 0), ink); for (const x of [cx - 6, cx + 6]) img.set(x, hy + 4, parseHex("#f08aa0")); }
    else if (expression === "surprised") { for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) img.set(cx + dx, my + dy, ink); }
    else if (expression === "sad") { for (let dx = -2; dx <= 2; dx++) img.set(cx + dx, my + (Math.abs(dx) === 2 ? 1 : 0), ink); img.set(exs[0]! - 1, ey + 3, parseHex("#7ac0f0")); }
    else if (expression === "angry") { for (let dx = -2; dx <= 2; dx++) img.set(cx + dx, my + (Math.abs(dx) === 2 ? 1 : 0), ink); }
    else { for (let dx = -1; dx <= 1; dx++) img.set(cx + dx, my, ink); }
  }
  if (spec.beard) shade(img, m().ellipse(cx, hy + 9, 6, 4).rect(cx - 7, hy + 5, 2, 5).rect(cx + 5, hy + 5, 2, 5).subtract(m().rect(cx - 2, hy + 7, 5, 1)), R(spec.beard), { bevel: 2 });

  /* ---- front hair ---- */
  if (hair && spec.hair!.style !== "bald") {
    const style = spec.hair!.style;
    const front = m().ellipse(cx, hy - 3, hrx + 1, hry - 3);
    front.subtract(m().rect(0, hy - 2, S, S));
    if (style === "spiky") for (let k = -2; k <= 2; k++) front.poly([[cx + k * 4 - 3, top + 4], [cx + k * 4, top - 5 + Math.abs(k)], [cx + k * 4 + 3, top + 4]]);
    if (style === "messy") for (const [dx, dy] of [[-7, -1], [-2, -3], [4, -2], [8, 0]] as const) front.ellipse(cx + dx, top + 2 + dy, 3, 2.5);
    // bangs over the forehead
    for (let k = -2; k <= 2; k++) front.poly([[cx + k * 4 - 3, hy - 4], [cx + k * 4 - 1, hy - 1 + (k % 2 ? 0 : 1)], [cx + k * 4 + 2, hy - 4]]);
    if (style === "long" || style === "bob" || style === "twintails" || style === "ponytail") for (const side of [-1, 1]) front.rect(side < 0 ? cx - hrx - 1 : cx + hrx - 2, hy - 3, 3, style === "long" ? 14 : 8);
    shade(img, front, hair, { bevel: 3, gloss: true });
  }

  /* ---- headgear ---- */
  if (spec.headgear) {
    const c = R(spec.headgear.color), a = R(spec.headgear.accent ?? spec.headgear.color);
    switch (spec.headgear.type) {
      case "hat": case "straw": shade(img, m().ellipse(cx, top + 4, hrx + 6, 2.6), c, { bevel: 1 }); shade(img, m().ellipse(cx, top + 1, hrx - 1, 5).rect(cx - hrx + 1, top + 1, hrx * 2 - 2, 3), c, { bevel: 2 }); shade(img, m().rect(cx - hrx + 1, top + 2, hrx * 2 - 2, 2), a, { bevel: 1 }); break;
      case "wizard": shade(img, m().ellipse(cx, top + 4, hrx + 5, 2.4), c, { bevel: 1 }); shade(img, m().poly([[cx - hrx, top + 4], [cx + 5, top - 16], [cx + hrx, top + 4]]), c, { bevel: 2 }); shade(img, m().rect(cx - hrx + 1, top + 1, hrx * 2 - 2, 2), a, { bevel: 1 }); break;
      case "hood": shade(img, m().ellipse(cx, hy - 1, hrx + 3, hry + 2).rect(cx - hrx - 3, hy, hrx * 2 + 6, 14).subtract(m().ellipse(cx, hy + 1, hrx - 1, hry - 1.5)), c, { bevel: 3 }); break;
      case "helmet": shade(img, m().ellipse(cx, hy - 2, hrx + 1.5, hry - 1).subtract(m().rect(cx - hrx + 1, hy - 1, hrx * 2 - 2, 12)).rect(cx - hrx - 1, hy - 3, 3, 10).rect(cx + hrx - 2, hy - 3, 3, 10), R(spec.headgear.color, 6), { bevel: 3, gloss: true }); shade(img, m().rect(cx - 1, top - 3, 2, 5), a, { bevel: 1 }); break;
      case "cap": shade(img, m().ellipse(cx, top + 3, hrx + 1, 5).subtract(m().rect(0, top + 5, S, S)), c, { bevel: 2 }); shade(img, m().ellipse(cx, top + 5, hrx - 1, 1.6), a, { bevel: 1 }); break;
      case "crown": { const cm = m().rect(cx - 6, top - 1, 12, 4); for (const dx of [-6, -1, 4]) cm.poly([[cx + dx, top - 1], [cx + dx + 1, top - 6], [cx + dx + 2, top - 1]]); shade(img, cm, R(P.gold), { bevel: 1, gloss: true }); img.set(cx, top + 1, parseHex(P.ruby)); break; }
      case "bandana": shade(img, m().rect(cx - hrx, top + 4, hrx * 2 + 1, 3).intersect(m().ellipse(cx, hy, hrx + 0.6, hry + 0.6)), c, { bevel: 1 }); break;
      case "horns": for (const side of [-1, 1]) shade(img, m().poly([[cx + side * 3, top + 3], [cx + side * 8, top + 3], [cx + side * 10, top - 7]]), c, { bevel: 1 }); break;
      case "veil": shade(img, m().ellipse(cx, hy - 1, hrx + 2, hry + 1).rect(cx - hrx - 2, hy - 1, hrx * 2 + 4, 16).subtract(m().ellipse(cx, hy + 1, hrx - 1.5, hry - 1.6)).subtract(m().rect(cx - hrx + 1, hy + 1, hrx * 2 - 2, 20)), c, { bevel: 2, round: 0.4 }); break;
    }
  }
  outline(img, { fixed: OUTLINE });
  return img.scale(2);
}

/** 5 expressions side by side: 480×96 (columns 5, rows 1; face 0 = 普通 … 4 = 驚き). */
export function renderPortraitSheet(spec: CharacterSpec): Img {
  const sheet = new Img(96 * EXPRESSIONS.length, 96);
  EXPRESSIONS.forEach((e, i) => sheet.draw(drawPortrait(spec, e), i * 96, 0));
  return sheet;
}

export type { Color };

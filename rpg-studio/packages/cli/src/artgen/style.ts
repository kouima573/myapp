/**
 * 画風（roadmap 137）: colour treatments applied to everything the built-in generator draws, so the same
 * shapes can come out as a different look. Pure per-pixel functions — deterministic, alpha untouched.
 *   standard 標準 / retro 少ない色数のレトロ調 / pastel 淡いパステル調 / dusk 夕暮れ・夜の暗い色調 / mono 4階調の単色
 */
import type { Img } from "./core";

export const ART_STYLES = ["standard", "retro", "pastel", "dusk", "mono"] as const;
export type ArtStyle = (typeof ART_STYLES)[number];
export const ART_STYLE_LABELS: Record<ArtStyle, string> = {
  standard: "標準（64px 描き込み調）",
  retro: "レトロ（色数を減らした昔のゲーム機風）",
  pastel: "パステル（淡く明るい）",
  dusk: "夕暮れ（暗く紫がかった）",
  mono: "モノクロ緑（4階調の携帯ゲーム機風）",
};

const MONO = [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]] as const;
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function styleColor(style: ArtStyle, r: number, g: number, b: number, x = 0, y = 0): [number, number, number] {
  switch (style) {
    case "standard": return [r, g, b];
    case "retro": {
      // 4 levels per channel (64 colours) with a light ordered dither so gradients stay readable.
      const t = (BAYER[(y & 3) * 4 + (x & 3)]! / 16 - 0.5) * 40;
      const q = (v: number) => clamp(Math.round(clamp(v + t) / 85) * 85);
      return [q(r), q(g), q(b)];
    }
    case "pastel": {
      const grey = (r + g + b) / 3;
      const d = (v: number) => v + (grey - v) * 0.35;
      const l = (v: number) => v + (255 - v) * 0.3;
      return [clamp(l(d(r))), clamp(l(d(g))), clamp(l(d(b)))];
    }
    case "dusk": return [clamp(r * 0.62 + 18), clamp(g * 0.5 + 8), clamp(b * 0.72 + 34)];
    case "mono": {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const c = MONO[Math.min(3, Math.floor(lum / 64))]!;
      return [c[0], c[1], c[2]];
    }
  }
}

/** Applies the style in place and returns the image. */
export function applyStyle(img: Img, style: ArtStyle): Img {
  if (style === "standard") return img;
  const d = img.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i + 3] === 0) continue;
    const [r, g, b] = styleColor(style, d[i]!, d[i + 1]!, d[i + 2]!, p % img.w, Math.floor(p / img.w));
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  return img;
}

export function isArtStyle(value: string): value is ArtStyle { return (ART_STYLES as readonly string[]).includes(value); }

/** Saves an image made by the built-in generator into the project and records it in assets.json (内蔵ジェネレーター製・MIT). */
import type { AssetEntry, GameContent } from "@rpg/schema";
import type { Img } from "../../../packages/cli/src/artgen/core";
import { rgbaToPngBlob } from "./renderInBrowser";
import type { ProjectStore } from "./useProject";

export async function registerGenerated(store: ProjectStore, content: GameContent, o: {
  assetId: string; path: string; kind: AssetEntry["kind"]; img: Img; note: string; generator: Record<string, string | number | boolean>;
  grid: Pick<AssetEntry, "tileWidth" | "tileHeight" | "columns" | "rows" | "frameDurationMs" | "frameOrder" | "loop">;
}): Promise<AssetEntry> {
  if (!store.source.saveImage) throw new Error("この環境では画像を保存できません");
  const exists = content.assets.assets.some(a => a.id === o.assetId);
  const blob = await rgbaToPngBlob({ width: o.img.w, height: o.img.h, data: o.img.data });
  const expected = exists && store.source.assetHash ? await store.source.assetHash(o.path) : "";
  const saved = await store.source.saveImage(o.path, blob, expected);
  if (!saved.ok) throw new Error(saved.error);
  const entry: AssetEntry = {
    id: o.assetId, path: o.path, kind: o.kind, mimeType: "image/png", bytes: saved.bytes, source: "RPGシステム工房の内蔵ジェネレーター",
    license: "MIT（RPGシステム工房の内蔵ジェネレーター。オリジナル生成物）", origin: "generated", sourceId: "builtin-art", creditRequired: false, redistributable: true,
    notes: o.note, generator: o.generator, ...o.grid,
  };
  store.updateJson<{ assets: AssetEntry[] }>(content.project.assetsPath, data => { data.assets = [...data.assets.filter(a => a.id !== o.assetId), entry]; });
  return entry;
}

export function drawImg(canvas: HTMLCanvasElement | null, img: Img, scale = 1, dx = 0, dy = 0, crop?: { x: number; y: number; w: number; h: number }) {
  if (!canvas) return;
  const tmp = document.createElement("canvas"); tmp.width = img.w; tmp.height = img.h;
  tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const c = crop ?? { x: 0, y: 0, w: img.w, h: img.h };
  ctx.drawImage(tmp, c.x, c.y, c.w, c.h, dx, dy, c.w * scale, c.h * scale);
}

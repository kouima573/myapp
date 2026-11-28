/** Browser-side picture helpers for exports: a whole map as PNG, and generator images (artgen Img) as PNG. */
import { composeMapImage, mapToTiled, type AssetEntry, type GameContent, type RgbaImage } from "@rpg/schema";

async function rgbaOf(url: string): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return { width: bitmap.width, height: bitmap.height, data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
}

export function rgbaToPngBlob(image: RgbaImage): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("PNGにできません"))), "image/png"));
}

/** The whole map (all tile layers) as a PNG, drawn the same way as `rpg map export`. */
export async function mapPngBlob(content: GameContent, mapId: string, assetUrl: (asset: AssetEntry) => Promise<string>): Promise<Blob> {
  const sheets = new Map<string, RgbaImage>();
  for (const s of mapToTiled(content, mapId, a => a.path).sheets) sheets.set(s.id, await rgbaOf(await assetUrl(s)));
  return rgbaToPngBlob(composeMapImage(content, mapId, id => sheets.get(id)));
}

/**
 * `rpg map export <マップID> --project <dir> [--out <フォルダ>] [--tile 32]`
 * マップを Tiled 形式（<id>.tmj）と1枚の画像（<id>.png）に。使っているタイル画像も tilesets/ にコピーする。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { composeMapImage, mapToTiled, type GameContent } from "../../schema/src/index";
import { decodePng, encodePng } from "./artgen/png";
import { Img } from "./artgen/core";
import { loadProjectFromDisk, resolveInside } from "./load";

type Flags = Record<string, string | boolean>;

/** PNG bytes of a whole map (all tile layers), drawn from the project's tile sheet files. */
export async function renderMapPng(root: string, content: GameContent, mapId: string, tileSize?: number): Promise<Buffer> {
  const sheets = new Map<string, Img | null>();
  for (const s of mapToTiled(content, mapId, a => a.path).sheets) {
    try { sheets.set(s.id, decodePng(await fs.readFile(resolveInside(root, s.path)))); } catch { sheets.set(s.id, null); }
  }
  const pic = composeMapImage(content, mapId, id => { const img = sheets.get(id); return img ? { width: img.w, height: img.h, data: img.data } : undefined; }, tileSize);
  const img = new Img(pic.width, pic.height);
  img.data.set(pic.data);
  return encodePng(img);
}

export async function cmdMapExport(mapId: string | undefined, flags: Flags, root: string): Promise<number> {
  const loaded = await loadProjectFromDisk(root);
  if (!loaded.content) { console.log("FAILED map export: 先に validate のエラーを直してください"); return 1; }
  const content = loaded.content;
  const ids = mapId ? [mapId] : content.project.maps.map(m => m.id);
  if (mapId && !content.maps[mapId]) { console.log(`ERROR マップ '${mapId}' がありません（${content.project.maps.map(m => m.id).join(", ")}）`); return 1; }
  const out = path.resolve(typeof flags.out === "string" ? flags.out : path.join(root, "..", `${content.project.id}-maps`));
  await fs.mkdir(path.join(out, "tilesets"), { recursive: true });
  const decoded = new Map<string, Img | null>();
  const sheet = (id: string) => {
    if (!decoded.has(id)) decoded.set(id, null);
    return decoded.get(id) ?? undefined;
  };
  for (const id of ids) {
    const exp = mapToTiled(content, id, s => `tilesets/${path.basename(s.path)}`);
    for (const s of exp.sheets) {
      if (decoded.get(s.id)) continue;
      const bytes = await fs.readFile(resolveInside(root, s.path));
      await fs.writeFile(path.join(out, "tilesets", path.basename(s.path)), bytes);
      try { decoded.set(s.id, decodePng(bytes)); } catch { decoded.set(s.id, null); console.log(`WARN ${s.path}: 画像を読めないため、マップ画像では空白になります`); }
    }
    await fs.writeFile(path.join(out, `${id}.tmj`), `${JSON.stringify(exp.tmj, null, 1)}\n`);
    const size = typeof flags.tile === "string" ? Number(flags.tile) : undefined;
    const pic = composeMapImage(content, id, s => { const img = sheet(s); return img ? { width: img.w, height: img.h, data: img.data } : undefined; }, size);
    const img = new Img(pic.width, pic.height);
    img.data.set(pic.data);
    await fs.writeFile(path.join(out, `${id}.png`), encodePng(img));
    for (const w of exp.warnings) console.log(`WARN ${id}: ${w}`);
    console.log(`OK ${id}: ${id}.tmj（Tiled）・${id}.png（${pic.width}×${pic.height}）`);
  }
  console.log(`OK map export: ${path.relative(process.cwd(), out)}（タイル画像 ${[...decoded.keys()].length}枚を tilesets/ に）`);
  return 0;
}

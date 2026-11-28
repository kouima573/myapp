/**
 * `rpg asset pack --project <dir> --title "…" --author "…" [--ids a,b | --kinds character,bgm] [--license cc0|cc-by-4.0|terms --terms-file 規約.md] [--paid] [--out pack.zip]`
 * 素材だけの作品（キャラクターのみ・音楽のみ・タイルのみ…）を素材パックのZIPにする。素材のまま配ってよいもの（自作・内蔵生成）だけを入れる。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { composePackPreview, planAssetPack, writeZip, type PackLicense, type Song } from "../../schema/src/index";
import { Img } from "./artgen/core";
import { decodePng, encodePng } from "./artgen/png";
import { songToWav } from "../../runtime/src/songRender";
import { renderMapPng } from "./mapExport";
import { loadProjectFromDisk, resolveInside } from "./load";

type Flags = Record<string, string | boolean>;
const str = (flags: Flags, key: string) => (typeof flags[key] === "string" ? (flags[key] as string) : undefined);

export async function cmdAssetPack(root: string, flags: Flags): Promise<number> {
  const loaded = await loadProjectFromDisk(root);
  if (!loaded.content) { console.log("FAILED asset pack: 先に validate のエラーを直してください"); return 1; }
  const { project, assets, tileset } = loaded.content;
  const kinds = str(flags, "kinds")?.split(",").map(s => s.trim()).filter(Boolean);
  const ids = str(flags, "ids")?.split(",").map(s => s.trim()).filter(Boolean)
    ?? assets.assets.filter(a => !kinds || kinds.includes(a.kind)).map(a => a.id);
  const license = (str(flags, "license") ?? "cc-by-4.0") as PackLicense;
  if (!["cc0", "cc-by-4.0", "terms"].includes(license)) { console.log("ERROR --license は cc0 / cc-by-4.0 / terms から選んでください"); return 2; }
  const terms = str(flags, "terms-file") ? await fs.readFile(path.resolve(str(flags, "terms-file")!), "utf8") : undefined;
  const title = str(flags, "title") ?? "", author = str(flags, "author") ?? "";
  const id = (str(flags, "id") ?? `${project.id}-pack`).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const mapIds = str(flags, "maps")?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
  const plan = planAssetPack(project, assets.assets, str(flags, "ids") || kinds ? ids : mapIds.length ? [] : ids, { id, title, author, license, terms, paid: Boolean(flags.paid), description: str(flags, "description"), mapIds, content: loaded.content }, tileset);
  // Files / maps that cannot be packed are left out (and listed); missing title / author / nothing selected stops the export.
  for (const p of plan.problems.filter(p => p.startsWith("マップ "))) console.log(`SKIP ${p}`);
  const fatal = plan.problems.filter(p => !p.startsWith("マップ ") && !plan.refused.some(r => p.startsWith(`${r.id}:`)));
  for (const r of plan.refused) console.log(`SKIP ${r.id}: ${r.packReason}`);
  if (fatal.length || (!plan.included.length && !plan.files.some(f => "mapImage" in f.source))) { for (const p of fatal) console.log(`ERROR ${p}`); if (!plan.included.length) console.log("ERROR 素材のまま配れるもの（自作・内蔵ジェネレーター製）がありません"); return 1; }
  const entries = [];
  for (const f of plan.files) {
    const s = f.source;
    const data = "text" in s ? new TextEncoder().encode(s.text)
      : "songWav" in s ? songToWav(JSON.parse(await fs.readFile(resolveInside(root, s.songWav), "utf8")) as Song)
      : "mapImage" in s ? new Uint8Array(await renderMapPng(root, loaded.content, s.mapImage))
      : "preview" in s ? new Uint8Array(await renderPreviewPng(root, s.preview))
      : new Uint8Array(await fs.readFile(resolveInside(root, s.assetPath)));
    entries.push({ name: f.name, data });
  }
  const out = path.resolve(str(flags, "out") ?? path.join(root, "..", `${id}.zip`));
  await fs.writeFile(out, writeZip(entries));
  console.log(`OK asset pack: ${path.relative(process.cwd(), out)}（素材 ${plan.included.length}点${plan.refused.length ? `、除外 ${plan.refused.length}点` : ""}・${license}）`);
  return 0;
}

/** preview.png of a pack (numbered contact sheet). Images that are not PNG are drawn as an empty cell with their number. */
export async function renderPreviewPng(root: string, items: Array<{ assetPath: string; frame?: { w: number; h: number } }>): Promise<Buffer> {
  const cells = [];
  for (const item of items) {
    let image = null;
    try { const d = decodePng(await fs.readFile(resolveInside(root, item.assetPath))); image = { width: d.w, height: d.h, data: d.data }; } catch { /* not a PNG */ }
    cells.push({ image, frame: item.frame });
  }
  const pic = composePackPreview(cells);
  const img = new Img(pic.width, pic.height);
  img.data.set(pic.data);
  return encodePng(img);
}

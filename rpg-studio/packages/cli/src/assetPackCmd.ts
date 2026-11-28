/**
 * `rpg asset pack --project <dir> --title "…" --author "…" [--ids a,b | --kinds character,bgm] [--license cc0|cc-by-4.0|terms --terms-file 規約.md] [--paid] [--out pack.zip]`
 * 素材だけの作品（キャラクターのみ・音楽のみ・タイルのみ…）を素材パックのZIPにする。素材のまま配ってよいもの（自作・内蔵生成）だけを入れる。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { planAssetPack, writeZip, type PackLicense } from "../../schema/src/index";
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
  const plan = planAssetPack(project, assets.assets, ids, { id, title, author, license, terms, paid: Boolean(flags.paid), description: str(flags, "description") }, tileset);
  // Files that cannot be packed are left out (and listed); missing title / author / nothing selected stops the export.
  const fatal = plan.problems.filter(p => !plan.refused.some(r => p.startsWith(`${r.id}:`)));
  for (const r of plan.refused) console.log(`SKIP ${r.id}: ${r.packReason}`);
  if (fatal.length || !plan.included.length) { for (const p of fatal) console.log(`ERROR ${p}`); if (!plan.included.length) console.log("ERROR 素材のまま配れるもの（自作・内蔵ジェネレーター製）がありません"); return 1; }
  const entries = [];
  for (const f of plan.files) {
    const data = "text" in f.source ? new TextEncoder().encode(f.source.text) : new Uint8Array(await fs.readFile(resolveInside(root, f.source.assetPath)));
    entries.push({ name: f.name, data });
  }
  const out = path.resolve(str(flags, "out") ?? path.join(root, "..", `${id}.zip`));
  await fs.writeFile(out, writeZip(entries));
  console.log(`OK asset pack: ${path.relative(process.cwd(), out)}（素材 ${plan.included.length}点${plan.refused.length ? `、除外 ${plan.refused.length}点` : ""}・${license}）`);
  return 0;
}

/**
 * `rpg packs …`: one ledger, on this computer, of the asset packs the person bought or downloaded
 * (BOOTH, itch.io, Kenney, OpenTracks…). No passwords or cookies are ever stored: the person logs in
 * and downloads in their own browser; the ledger remembers where the files are, where they came from and
 * under which terms, so any project can pick files from them with the provenance filled in.
 *
 * Stored in $RPG_STUDIO_HOME/packs.json (default ~/.rpg-studio/packs.json), outside every repository.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SOURCE_CATALOG } from "../../schema/src/sources";
import { addAsset } from "./assets";

type Flags = Record<string, string | boolean>;
const str = (flags: Flags, key: string) => (typeof flags[key] === "string" ? (flags[key] as string) : undefined);

export interface Pack {
  id: string;
  name: string;
  source: string;
  url?: string;
  folder: string;
  license: string;
  licenseFile?: string;
  credit?: string;
  creditRequired: boolean;
  redistribute: boolean;
  termsChecked?: string;
  notes?: string;
  addedAt: string;
}

export const packsFile = () => path.join(process.env.RPG_STUDIO_HOME ?? path.join(os.homedir(), ".rpg-studio"), "packs.json");

export async function loadPacks(): Promise<Pack[]> {
  try { return (JSON.parse(await fs.readFile(packsFile(), "utf8")) as { packs: Pack[] }).packs; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
async function savePacks(packs: Pack[]) {
  await fs.mkdir(path.dirname(packsFile()), { recursive: true });
  await fs.writeFile(packsFile(), `${JSON.stringify({ formatVersion: 1, note: "素材パックの台帳（このPCだけ）。パスワード・Cookieは保存しません。", packs }, null, 2)}\n`);
}

const MEDIA = /\.(png|ogg|mp3|wav)$/i;
async function walk(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, base, out);
    else if (MEDIA.test(entry.name)) out.push(path.relative(base, full).split(path.sep).join("/"));
    if (out.length > 5000) break;
  }
  return out;
}

export async function cmdPacks(sub: string | undefined, flags: Flags, args: string[], projectRoot: () => string): Promise<number> {
  const packs = await loadPacks();
  switch (sub) {
    case "list": {
      if (!packs.length) { console.log(`台帳は空です（${packsFile()}）。pnpm rpg packs add で登録できます`); return 0; }
      for (const p of packs) console.log(`${p.id.padEnd(24)} ${p.name}（${p.source}・${p.license}${p.creditRequired ? "・クレジット要" : ""}${p.redistribute ? "" : "・共有テンプレート不可"}）\n${" ".repeat(25)}${p.folder}${p.url ? `  ${p.url}` : ""}`);
      return 0;
    }
    case "add": {
      const id = str(flags, "id"), name = str(flags, "name"), source = str(flags, "source"), folder = str(flags, "folder"), license = str(flags, "license");
      if (!id || !name || !source || !folder || !license) { console.log("ERROR --id --name --source --folder --license が必要です（--url --license-file --credit --credit-required --no-redistribute --terms-checked YYYY-MM-DD --notes も記録できます）"); return 2; }
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) { console.log("ERROR --id は英数字と - _"); return 2; }
      const known = SOURCE_CATALOG.find(s => s.id === source);
      const stat = await fs.stat(path.resolve(folder)).catch(() => null);
      if (!stat?.isDirectory()) { console.log(`ERROR フォルダがありません: ${folder}`); return 1; }
      const pack: Pack = {
        id, name, source, folder: path.resolve(folder), license,
        ...(str(flags, "url") ? { url: str(flags, "url")! } : {}),
        ...(str(flags, "license-file") ? { licenseFile: path.resolve(str(flags, "license-file")!) } : {}),
        ...(str(flags, "credit") ? { credit: str(flags, "credit")! } : {}),
        creditRequired: Boolean(flags["credit-required"]) || known?.creditRequired === "yes",
        redistribute: !flags["no-redistribute"] && known?.redistribution === "allowed",
        ...(str(flags, "terms-checked") ? { termsChecked: str(flags, "terms-checked")! } : {}),
        ...(str(flags, "notes") ? { notes: str(flags, "notes")! } : {}),
        addedAt: new Date().toISOString().slice(0, 10),
      };
      await savePacks([...packs.filter(p => p.id !== id), pack]);
      const count = (await walk(pack.folder)).length;
      console.log(`OK 台帳に ${id}（${count}ファイル）を登録しました: ${packsFile()}${known ? "" : `\n注: 取得元 '${source}' はカタログにありません（プロジェクトで使うときは assetPolicy.customSources に足すか、近い取得元を指定）`}`);
      return 0;
    }
    case "remove": {
      const id = args[0] ?? str(flags, "id");
      if (!packs.some(p => p.id === id)) { console.log(`ERROR 台帳にないパック: ${id}`); return 1; }
      await savePacks(packs.filter(p => p.id !== id));
      console.log(`OK ${id} を台帳から外しました（ファイルは消していません）`);
      return 0;
    }
    case "files": {
      const pack = packs.find(p => p.id === (args[0] ?? str(flags, "pack")));
      if (!pack) { console.log("ERROR rpg packs files <パックID> [--query <言葉>]"); return 2; }
      const query = str(flags, "query")?.toLowerCase();
      const files = (await walk(pack.folder)).filter(f => !query || f.toLowerCase().includes(query));
      files.slice(0, 200).forEach((f, i) => console.log(`${String(i + 1).padStart(3)}. ${f}`));
      if (files.length > 200) console.log(`…ほか${files.length - 200}件（--query で絞り込み）`);
      console.log(`取り込み: pnpm rpg packs use ${pack.id} --file <上のパス> --id <素材ID> --kind <kind> --project <dir>`);
      return 0;
    }
    case "use": {
      const pack = packs.find(p => p.id === (args[0] ?? str(flags, "pack")));
      const file = str(flags, "file");
      if (!pack || !file) { console.log("ERROR rpg packs use <パックID> --file <パック内のパス> --id <素材ID> --kind <kind> --project <dir>"); return 2; }
      const full = path.resolve(pack.folder, file);
      if (path.relative(pack.folder, full).startsWith("..")) { console.log("ERROR パックのフォルダの外は指定できません"); return 1; }
      const known = SOURCE_CATALOG.find(s => s.id === pack.source);
      return addAsset(projectRoot(), {
        ...flags, file: full,
        ...(known ? { source: pack.source } : {}),
        license: pack.license,
        ...(pack.url ? { url: pack.url } : {}),
        ...(pack.termsChecked ? { "terms-checked": pack.termsChecked } : {}),
        ...(pack.credit ? { credit: pack.credit } : {}),
        ...(pack.creditRequired ? { "credit-required": true } : {}),
        ...(pack.redistribute ? {} : { "no-redistribute": true }),
        notes: [`素材パック「${pack.name}」（${pack.id}）の ${file}`, pack.licenseFile ? `ライセンス文: ${pack.licenseFile}` : "", pack.notes ?? ""].filter(Boolean).join("。"),
      });
    }
    default:
      console.log(`rpg packs list | add | remove <id> | files <id> [--query] | use <id> --file <path> --id <素材ID> --kind <kind> --project <dir>
  買った・ダウンロードした素材パックを、このPCの台帳（${packsFile()}）でまとめて管理します。
  ログインと購入・ダウンロードはあなたのブラウザで。パスワード・Cookie・トークンは保存しません。
  add --id <id> --name <名前> --source <取得元ID> --folder <展開したフォルダ> --license <ライセンス名>
      [--url <商品・配布ページ> --license-file <同梱のライセンス文> --credit <表記> --credit-required --no-redistribute --terms-checked YYYY-MM-DD --notes <メモ>]`);
      return sub ? 2 : 0;
  }
}

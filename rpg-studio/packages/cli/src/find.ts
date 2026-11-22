/** `rpg find <text> --project <dir> [--regex] [--case] [--replace <new> [--write]]` — search (and replace) text across the project's data. */
import fs from "node:fs/promises";
import path from "node:path";
import { readProjectTexts } from "./load";
import { replaceTexts, searchTexts } from "./search";

type Flags = Record<string, string | boolean>;

export async function cmdFind(args: string[], flags: Flags, root: string): Promise<number> {
  const query = args[0];
  if (!query) { console.log("ERROR rpg find <探す文字> --project <dir> [--regex] [--case] [--replace <新しい文字> --write]"); return 2; }
  const { texts } = await readProjectTexts(root);
  try { for (const name of await fs.readdir(path.join(root, "tests"))) if (name.endsWith(".json")) texts[`tests/${name}`] = await fs.readFile(path.join(root, "tests", name), "utf8"); } catch { /* no tests */ }
  const opts = { regex: Boolean(flags.regex), caseSensitive: Boolean(flags.case) };
  if (typeof flags.replace === "string") {
    const changes = replaceTexts(texts, query, flags.replace, opts);
    if (!changes.length) { console.log(`「${query}」は見つかりません`); return 1; }
    for (const c of changes) console.log(`${flags.write ? "置換" : "置換予定"}: ${c.file}（${c.count}か所）`);
    if (!flags.write) { console.log("（まだ保存していません。--write で書き換えます）"); return 0; }
    for (const c of changes) await fs.writeFile(path.join(root, ...c.file.split("/")), c.text);
    console.log(`OK find --replace: ${changes.reduce((s, c) => s + c.count, 0)}か所。pnpm rpg validate / test で確認してください（IDの変更は rpg rename）`);
    return 0;
  }
  const hits = searchTexts(texts, query, opts);
  if (!hits.length) { console.log(`「${query}」は見つかりません`); return 1; }
  console.log(`# 「${query}」（${hits.reduce((s, h) => s + h.count, 0)}か所）`);
  for (const h of hits) console.log(`- ${h.file} › ${h.at}: ${h.value.length > 70 ? `${h.value.slice(0, 67)}…` : h.value}`);
  return 0;
}

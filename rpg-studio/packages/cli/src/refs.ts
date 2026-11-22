/**
 * `rpg refs <id>`   — where an id (flag, variable, item, map, enemy, asset, status…) is used across the project.
 * `rpg rename <old> <new> [--write]` — rename an id everywhere in the project's JSON (dry run by default).
 *
 * JSON is walked structurally: string values equal to the id, keys of id-keyed records (flags, variables,
 * items held, resistances, test expectations…) and {{var.id}} / {{flag.id}} templates in texts.
 * TypeScript (systems / scripts) is only searched and reported, never rewritten.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { readProjectTexts } from "./load";

export interface RefHit { file: string; at: string; kind: "value" | "key" | "text" | "code"; line?: number }

/** Records whose keys are ids (the rest of the keys in the data are field names and are never renamed). */
const ID_KEYED = [
  /(^|\.)flags$/, /(^|\.)variables$/, /(^|\.)sets$/, /^verbs$/, /^signals$/, /^endings$/, /^elements$/, /^equipmentSlots$/, /^modules$/,
  /(^|\.)items$/, /(^|\.)resist$/, /(^|\.)vars$/, /(^|\.)equipped$/, /(^|\.)entities$/, /^audio\.sfx$/, /(^|\.)stats$/,
];
const isIdKeyed = (at: string) => {
  if (/\]$/.test(at)) return false; // an object inside an array (a map's entity, an item…): its keys are field names
  const parent = at.replace(/\[\d+\]/g, "");
  return ID_KEYED.some(r => r.test(parent)) && !/(^|\.)stats$/.test(parent);
};

const textRef = (id: string) => new RegExp(`\\{\\{\\s*(var|flag|set|count|item)\\.${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "g");

function walk(node: unknown, at: string, id: string, file: string, out: RefHit[]) {
  if (Array.isArray(node)) { node.forEach((child, i) => walk(child, `${at}[${i}]`, id, file, out)); return; }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      const here = at ? `${at}.${key}` : key;
      if (key === id && isIdKeyed(at)) out.push({ file, at: here, kind: "key" });
      walk(value, here, id, file, out);
    }
    return;
  }
  if (typeof node === "string") {
    if (node === id) out.push({ file, at, kind: "value" });
    else if (textRef(id).test(node)) out.push({ file, at, kind: "text" });
  }
}

export async function findRefs(root: string, id: string): Promise<RefHit[]> {
  const { texts } = await readProjectTexts(root);
  const out: RefHit[] = [];
  const files = { ...texts };
  try { for (const name of await fs.readdir(path.join(root, "tests"))) if (name.endsWith(".json")) files[`tests/${name}`] = await fs.readFile(path.join(root, "tests", name), "utf8"); } catch { /* no tests */ }
  const word = new RegExp(`(^|[^A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_-])`);
  for (const [file, text] of Object.entries(files)) {
    if (file.endsWith(".json")) { try { walk(JSON.parse(text), "", id, file, out); } catch { /* broken JSON: validate reports it */ } }
    else if (file.endsWith(".ts")) text.split("\n").forEach((line, i) => { if (word.test(line)) out.push({ file, at: line.trim().slice(0, 100), kind: "code", line: i + 1 }); });
  }
  return out;
}

function renameIn(node: unknown, at: string, from: string, to: string, count: { n: number }): unknown {
  if (Array.isArray(node)) return node.map((child, i) => renameIn(child, `${at}[${i}]`, from, to, count));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const here = at ? `${at}.${key}` : key;
      const nextKey = key === from && isIdKeyed(at) ? (count.n++, to) : key;
      out[nextKey] = renameIn(value, here, from, to, count);
    }
    return out;
  }
  if (typeof node === "string") {
    if (node === from) { count.n++; return to; }
    const re = textRef(from);
    if (re.test(node)) { count.n++; return node.replace(textRef(from), m => m.replace(from, to)); }
  }
  return node;
}

type Flags = Record<string, string | boolean>;

export async function cmdRefs(args: string[], root: string): Promise<number> {
  const id = args[0];
  if (!id) { console.log("ERROR rpg refs <id> --project <dir>"); return 2; }
  const hits = await findRefs(root, id);
  if (!hits.length) { console.log(`'${id}' はどこからも参照されていません`); return 0; }
  console.log(`# '${id}' の参照（${hits.length}か所）`);
  for (const h of hits) console.log(`- ${h.file}${h.line ? `:${h.line}` : ""} › ${h.at}${h.kind === "key" ? "（キー）" : h.kind === "text" ? "（文中の差し込み）" : h.kind === "code" ? "（コード・自動では書き換えません）" : ""}`);
  return 0;
}

export async function cmdRename(args: string[], flags: Flags, root: string): Promise<number> {
  const [from, to] = args;
  if (!from || !to) { console.log("ERROR rpg rename <今のID> <新しいID> --project <dir> [--write]"); return 2; }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(to)) { console.log("ERROR 新しいIDは英数字で始まり、英数字・._- のみ"); return 2; }
  const existing = await findRefs(root, to);
  if (existing.some(h => h.kind !== "code")) { console.log(`ERROR '${to}' はすでに使われています（${existing.length}か所）。別の名前にしてください`); return 1; }
  const { texts } = await readProjectTexts(root);
  const files: Record<string, string> = { ...texts };
  try { for (const name of await fs.readdir(path.join(root, "tests"))) if (name.endsWith(".json")) files[`tests/${name}`] = await fs.readFile(path.join(root, "tests", name), "utf8"); } catch { /* no tests */ }
  const changes: Array<{ file: string; text: string; n: number }> = [];
  for (const [file, text] of Object.entries(files)) {
    if (!file.endsWith(".json")) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { continue; }
    const count = { n: 0 };
    const next = renameIn(parsed, "", from, to, count);
    if (count.n) changes.push({ file, text: `${JSON.stringify(next, null, 2)}\n`, n: count.n });
  }
  const code = (await findRefs(root, from)).filter(h => h.kind === "code");
  if (!changes.length && !code.length) { console.log(`'${from}' はどこからも参照されていません`); return 1; }
  for (const c of changes) console.log(`${flags.write ? "書き換え" : "変更予定"}: ${c.file}（${c.n}か所）`);
  for (const h of code) console.log(`要手作業: ${h.file}:${h.line} › ${h.at}`);
  if (!flags.write) { console.log(`（まだ保存していません。--write で書き換えます。続けて pnpm rpg validate で確認）`); return 0; }
  for (const c of changes) await fs.writeFile(path.join(root, ...c.file.split("/")), c.text);
  console.log(`OK rename: ${from} → ${to}（${changes.reduce((s, c) => s + c.n, 0)}か所）。pnpm rpg validate / test で確認してください`);
  return 0;
}

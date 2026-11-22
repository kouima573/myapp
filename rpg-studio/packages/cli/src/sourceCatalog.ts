/**
 * `rpg asset catalog <check|verify>` — keeping the asset-source catalog up to date (roadmap 136).
 *
 * The tool never contacts the sites itself. `check` lists which entries are due for a look (never verified
 * against the original terms page, or last looked at long ago) with the page to open and the points to confirm.
 * `verify` records that a *person* read the original terms today: it refuses to write `verifiedAt` unless
 * `--read-terms` is given, so a date is never filled in by a program on its own.
 * Built-in sources live in packages/schema/src/asset-sources.json; a project's own sources in project.json
 * (assetPolicy.customSources) are updated there instead.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { AssetSourceSchema, type AssetSource } from "../../schema/src/index";
import { REPO_ROOT } from "./build";

type Flags = Record<string, string | boolean>;
const str = (flags: Flags, key: string) => (typeof flags[key] === "string" ? (flags[key] as string) : undefined);
export const CATALOG_FILE = path.join(REPO_ROOT, "packages", "schema", "src", "asset-sources.json");

export interface DueSource { source: AssetSource; reasons: string[] }

const DAY = 24 * 60 * 60 * 1000;
const daysBetween = (from: string, to: string) => Math.floor((Date.parse(to) - Date.parse(from)) / DAY);

/** Which sources need a person to re-read the terms. Generated (built-in) sources are skipped: nothing external to check. */
export function dueSources(sources: AssetSource[], today: string, maxDays: number): DueSource[] {
  const out: DueSource[] = [];
  for (const source of sources) {
    if (source.origin === "generated" && !source.termsUrl && !source.url) continue;
    const reasons: string[] = [];
    if (!source.verifiedAt) reasons.push("規約の原文と未照合（verifiedAt なし）");
    else if (daysBetween(source.verifiedAt, today) > maxDays) reasons.push(`原文の確認から ${daysBetween(source.verifiedAt, today)} 日経過`);
    const research = (source as { research?: { checkedAt?: string } }).research;
    if (!source.verifiedAt && research?.checkedAt && daysBetween(research.checkedAt, today) > maxDays) reasons.push(`二次情報の調査から ${daysBetween(research.checkedAt, today)} 日経過`);
    if (reasons.length) out.push({ source, reasons });
  }
  return out;
}

const ENUMS = {
  creditRequired: ["yes", "no", "varies", "unknown"],
  redistribution: ["allowed", "prohibited", "varies", "unknown"],
  automatedDownload: ["allowed", "manual", "unknown"],
} as const;

export interface Verification { date: string; summary?: string; creditRequired?: string; redistribution?: string; automatedDownload?: string; notes?: string }

/** Returns the updated raw source object (keeps unknown keys such as research) or an error message. */
export function applyVerification(raw: Record<string, unknown>, v: Verification): { source: Record<string, unknown> } | { error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || Number.isNaN(Date.parse(v.date))) return { error: `日付は YYYY-MM-DD で指定してください: ${v.date}` };
  for (const key of Object.keys(ENUMS) as Array<keyof typeof ENUMS>) {
    const value = v[key];
    if (value !== undefined && !(ENUMS[key] as readonly string[]).includes(value)) return { error: `--${key} は ${ENUMS[key].join(" / ")} から選んでください: ${value}` };
  }
  const next: Record<string, unknown> = { ...raw, verifiedAt: v.date };
  if (v.summary) next.summary = v.summary;
  if (v.notes !== undefined) next.notes = v.notes;
  for (const key of Object.keys(ENUMS) as Array<keyof typeof ENUMS>) if (v[key] !== undefined) next[key] = v[key];
  const parsed = AssetSourceSchema.safeParse(next);
  if (!parsed.success) return { error: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { source: next };
}

const todayIso = () => new Date().toISOString().slice(0, 10);

async function readJson(file: string): Promise<Record<string, unknown>> { return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>; }

export async function cmdSourceCatalog(sub: string | undefined, args: string[], flags: Flags, root: string): Promise<number> {
  const catalog = await readJson(CATALOG_FILE);
  const builtin = (catalog.sources as Array<Record<string, unknown>>);
  let projectJson: Record<string, unknown> | undefined;
  try { projectJson = await readJson(path.join(root, "project.json")); } catch { projectJson = undefined; }
  const custom = ((projectJson?.assetPolicy as { customSources?: Array<Record<string, unknown>> } | undefined)?.customSources) ?? [];

  if (sub === "check") {
    const days = Number(flags.days) || 180;
    const all = [...builtin.filter(s => !custom.some(c => c.id === s.id)), ...custom].map(s => AssetSourceSchema.parse(s));
    const due = dueSources(all, str(flags, "today") ?? todayIso(), days);
    if (flags.json) { console.log(JSON.stringify(due.map(d => ({ id: d.source.id, name: d.source.name, termsUrl: d.source.termsUrl ?? d.source.url, reasons: d.reasons })), null, 2)); return 0; }
    if (!due.length) { console.log(`OK catalog check: 見直しが必要な取得元はありません（${days}日以内に原文を確認済み）`); return 0; }
    console.log(`# 取得元カタログの見直し（${due.length}件）\nこのツールはサイトに接続しません。規約ページをブラウザで開いて読み、内容が合っていれば\n  pnpm rpg asset catalog verify <id> --read-terms [--summary "…" --credit-required yes|no|varies --redistribution … --automated-download …]\nで「人が原文を読んだ日」を記録してください。読んでいないものに日付を入れないでください。\n`);
    for (const { source, reasons } of due) {
      console.log(`- ${source.id} — ${source.name}`);
      console.log(`    開く: ${source.termsUrl ?? source.url ?? "（URL未登録）"}`);
      console.log(`    理由: ${reasons.join(" / ")}`);
      console.log(`    いまの要約: ${source.summary}`);
      for (const item of source.checklist) console.log(`    □ ${item}`);
    }
    return 0;
  }

  if (sub === "verify") {
    const id = args[0] ?? str(flags, "source");
    if (!id) { console.log("ERROR 取得元のIDを指定してください（pnpm rpg asset catalog check で一覧）"); return 2; }
    if (flags["read-terms"] !== true) {
      console.log(`ERROR verify は「人が規約の原文を読んだ」記録です。読んだうえで --read-terms を付けてください。\n      読んでいない場合は記録しないでください（AIが自分で日付を入れることはしません）。`);
      return 2;
    }
    const inProject = custom.findIndex(s => s.id === id);
    const inBuiltin = builtin.findIndex(s => s.id === id);
    if (inProject < 0 && inBuiltin < 0) { console.log(`ERROR 取得元 '${id}' はカタログにありません`); return 1; }
    const raw = inProject >= 0 ? custom[inProject]! : builtin[inBuiltin]!;
    const result = applyVerification(raw, {
      date: str(flags, "date") ?? todayIso(),
      summary: str(flags, "summary"),
      creditRequired: str(flags, "credit-required"),
      redistribution: str(flags, "redistribution"),
      automatedDownload: str(flags, "automated-download"),
      notes: str(flags, "notes"),
    });
    if ("error" in result) { console.log(`ERROR ${result.error}`); return 2; }
    if (inProject >= 0) {
      custom[inProject] = result.source;
      await fs.writeFile(path.join(root, "project.json"), `${JSON.stringify(projectJson, null, 2)}\n`);
      console.log(`OK ${id}: project.json の customSources に確認日 ${String(result.source.verifiedAt)} を記録しました`);
    } else {
      builtin[inBuiltin] = result.source;
      await fs.writeFile(CATALOG_FILE, `${JSON.stringify(catalog, null, 2)}\n`);
      console.log(`OK ${id}: 内蔵カタログ（packages/schema/src/asset-sources.json）に確認日 ${String(result.source.verifiedAt)} を記録しました`);
    }
    return 0;
  }

  console.log(`rpg asset catalog check [--days 180] [--json] --project <dir>   原文の確認が必要な取得元と、開くページ・確認項目
rpg asset catalog verify <id> --read-terms [--date YYYY-MM-DD] [--summary "…"] [--credit-required yes|no|varies|unknown]
      [--redistribution allowed|prohibited|varies|unknown] [--automated-download allowed|manual|unknown] [--notes "…"]
                                  人が規約の原文を読んだことを記録（--read-terms なしでは書き込みません）`);
  return sub ? 2 : 0;
}

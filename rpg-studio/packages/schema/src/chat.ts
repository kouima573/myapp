/**
 * チャットで作る（ChatGPT などファイルを触れないAI向け）: 作業カード・依頼パック・変更案の取り込み。
 *
 * チャットのAIはファイルを開けず、書き換えられず、チェックも走らせられない。その3つを工房（とCLI）が肩代わりする:
 *   1. 作業カード（projects/<id>/todo.json）: 1枚＝小さな作業1つ。関係するデータ（"dialogue:elder" など）をひも付ける
 *   2. 依頼パック: カードの目的・ひも付いたデータの今の内容・使えるID・書き方の要点・返事の形式を1つの文章にする
 *   3. 変更案（```rpg-change のJSON）を読み取り、ファイルに当てはめる。検証・テストは呼び出し側（工房／CLI）が行い、
 *      エラーがあれば「直してほしい点」の文章（fixPack）を作ってAIに貼り戻してもらう
 * すべて純粋な関数（ファイル名→中身の対応表を受け取り、新しい対応表を返す）。工房とCLIで共用する。
 */
import { z } from "zod";
import { ConditionSchema, EffectSchema, IdSchema } from "./formats";

export const TODO_FILE = "todo.json";
export const PLAN_FILES = ["IDEA.md", "SCRIPT.md", "SPEC.md"] as const;

const LinkSchema = z.string().regex(/^[a-z]+:[A-Za-z0-9_./-]+$/, "ひも付けは \"種類:ID\"（例 dialogue:elder、npc:village/elder）");
export const TodoCardSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  /** 何をしたいか（作り手の言葉のまま）。 */
  goal: z.string().default(""),
  status: z.enum(["todo", "doing", "done"]).default("todo"),
  /** 関係するデータ: "map:village" "npc:village/elder" "dialogue:elder" "event:open-gate" "item:old-key" "flag:has-key" … */
  links: z.array(LinkSchema).default([]),
  /** できたことの確かめ方: 自動テスト（tests/<名前>.scenario.json）か、人が見て確かめること。 */
  doneWhen: z.object({ test: z.string().optional(), check: z.string().optional() }).strict().optional(),
  notes: z.string().optional(),
}).strict();
export type TodoCard = z.infer<typeof TodoCardSchema>;
export const TodoBundleSchema = z.object({ formatVersion: z.literal(1), cards: z.array(TodoCardSchema).default([]) }).strict();
export type TodoBundle = z.infer<typeof TodoBundleSchema>;

export type Texts = Record<string, string>;
const fmt = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
function parse<T = any>(texts: Texts, file: string | undefined): T | undefined { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!file || texts[file] === undefined) return undefined;
  try { return JSON.parse(texts[file]!) as T; } catch { return undefined; }
}

export function readTodo(texts: Texts): { bundle: TodoBundle; error?: string } {
  if (texts[TODO_FILE] === undefined) return { bundle: { formatVersion: 1, cards: [] } };
  let raw: unknown;
  try { raw = JSON.parse(texts[TODO_FILE]!); } catch (e) { return { bundle: { formatVersion: 1, cards: [] }, error: `${TODO_FILE} がJSONとして読めません: ${e instanceof Error ? e.message : String(e)}` }; }
  const parsed = TodoBundleSchema.safeParse(raw);
  if (!parsed.success) return { bundle: { formatVersion: 1, cards: [] }, error: `${TODO_FILE}: ${parsed.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join(" / ")}` };
  return { bundle: parsed.data };
}
export const writeTodo = (bundle: TodoBundle) => fmt(bundle);

/* ------------------------------------------------------------------ locating data by "kind:id" */

export const LINK_KINDS: Record<string, string> = {
  map: "マップ", npc: "人物（マップ/ID）", interactable: "仕掛け（マップ/ID）", portal: "出入口（マップ/ID）", entity: "動く物（マップ/ID）",
  dialogue: "会話", event: "イベント", item: "アイテム", enemy: "敵", ability: "能力・技", trait: "特性", companion: "仲間", status: "状態異常",
  flag: "フラグ", variable: "変数", rule: "ルール", test: "自動テスト",
};
const DB_LIST: Record<string, string> = { item: "items", enemy: "enemies", ability: "abilities", trait: "traits", companion: "companions", status: "statuses" };
const MAP_LIST: Record<string, string> = { npc: "npcs", interactable: "interactables", portal: "portals", entity: "entities" };

interface Manifest { maps?: Array<{ id: string; path: string; title?: string }>; dialoguesPath?: string; eventsPath?: string; databasePath?: string; rulesPath?: string; flags?: Record<string, unknown>; variables?: Record<string, unknown> }
const manifestOf = (texts: Texts) => parse<Manifest>(texts, "project.json") ?? {};
const paths = (m: Manifest) => ({ dialogues: m.dialoguesPath ?? "dialogues/dialogues.json", events: m.eventsPath ?? "events/events.json", database: m.databasePath ?? "database.json", rules: m.rulesPath ?? "rules.json" });

export function splitLink(link: string): { kind: string; id: string; map?: string } {
  const at = link.indexOf(":");
  const kind = link.slice(0, at), rest = link.slice(at + 1);
  if (MAP_LIST[kind]) { const slash = rest.indexOf("/"); return { kind, map: rest.slice(0, slash), id: rest.slice(slash + 1) }; }
  return { kind, id: rest };
}

/** Current value of a linked piece of data (undefined = not there yet). */
export function lookup(texts: Texts, link: string): { file: string; value: unknown } | undefined {
  const { kind, id, map } = splitLink(link);
  const m = manifestOf(texts), p = paths(m);
  const inList = (file: string, list: string) => { const v = parse<Record<string, Array<{ id: string }>>>(texts, file)?.[list]?.find(x => x.id === id); return v ? { file, value: v } : undefined; };
  if (kind === "dialogue") return inList(p.dialogues, "dialogues");
  if (kind === "event") return inList(p.events, "events");
  if (kind === "rule") { const rules = parse<{ rules?: Array<{ id: string }> } | Array<{ id: string }>>(texts, p.rules); const list = Array.isArray(rules) ? rules : rules?.rules; const v = list?.find(r => r.id === id); return v ? { file: p.rules, value: v } : undefined; }
  if (DB_LIST[kind]) return inList(p.database, DB_LIST[kind]!);
  if (kind === "flag" || kind === "variable") { const v = (m[kind === "flag" ? "flags" : "variables"] ?? {})[id]; return v === undefined ? undefined : { file: "project.json", value: v }; }
  if (kind === "test") { const file = `tests/${id}.scenario.json`; const v = parse(texts, file); return v === undefined ? undefined : { file, value: v }; }
  if (kind === "map") { const ref = m.maps?.find(x => x.id === id); const v = ref && parse(texts, ref.path); return ref && v ? { file: ref.path, value: v } : undefined; }
  if (MAP_LIST[kind]) { const ref = m.maps?.find(x => x.id === map); if (!ref) return undefined; return inList(ref.path, MAP_LIST[kind]!); }
  return undefined;
}

/* ------------------------------------------------------------------ change proposals */

const OpSchema = z.discriminatedUnion("op", [
  /** Add or replace one piece of data. */
  z.object({ op: z.literal("put"), target: LinkSchema, value: z.unknown() }).strict(),
  z.object({ op: z.literal("remove"), target: LinkSchema }).strict(),
  /** Update the card this answer is for (status, notes) or add new cards (plan). */
  z.object({ op: z.literal("card"), id: IdSchema.optional(), status: z.enum(["todo", "doing", "done"]).optional(), notes: z.string().optional() }).strict(),
  z.object({ op: z.literal("addCard"), value: z.unknown() }).strict(),
]);
export type ChangeOp = z.infer<typeof OpSchema>;
export const ChangeSetSchema = z.object({ card: z.string().optional(), changes: z.array(OpSchema).min(1) }).strict();
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

/** Finds the ```rpg-change block (or the first JSON object) in an AI's answer. */
export function parseChangeSet(answer: string): { set?: ChangeSet; error?: string } {
  const fenced = /```(?:rpg-change|json)?\s*\n([\s\S]*?)```/.exec(answer);
  let body = fenced?.[1] ?? answer;
  if (!fenced) { const start = body.indexOf("{"), end = body.lastIndexOf("}"); if (start < 0 || end < start) return { error: "返事の中に ```rpg-change のブロック（JSON）が見つかりません" }; body = body.slice(start, end + 1); }
  let raw: unknown;
  try { raw = JSON.parse(body); } catch (e) {
    // よくある崩れ: 末尾のカンマ
    try { raw = JSON.parse(body.replace(/,\s*([}\]])/g, "$1")); } catch { return { error: `変更案のJSONが読めません: ${e instanceof Error ? e.message : String(e)}` }; }
  }
  const parsed = ChangeSetSchema.safeParse(raw);
  if (!parsed.success) return { error: `変更案の形が違います: ${parsed.error.issues.slice(0, 5).map(i => `${i.path.join(".") || "(全体)"} ${i.message}`).join(" / ")}` };
  return { set: parsed.data };
}

export interface ApplyResult { texts: Texts; changed: string[]; notes: string[]; errors: string[] }

/** Applies a change set to the project files. Never throws; problems go to `errors` (nothing is changed for that op). */
export function applyChangeSet(texts: Texts, set: ChangeSet, cardId = set.card): ApplyResult {
  const out: Texts = { ...texts };
  const changed = new Set<string>(), notes: string[] = [], errors: string[] = [];
  const edit = (file: string, recipe: (value: any) => void, create?: () => unknown) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let value: unknown;
    if (out[file] === undefined) { if (!create) { errors.push(`${file} がありません`); return false; } value = create(); }
    else { try { value = JSON.parse(out[file]!); } catch { errors.push(`${file} がJSONとして壊れているため変更できません`); return false; } }
    recipe(value);
    const text = fmt(value);
    if (text !== out[file]) { out[file] = text; changed.add(file); }
    return true;
  };
  const upsert = (list: Array<{ id: string }>, id: string, value: Record<string, unknown> | undefined) => {
    const i = list.findIndex(x => x.id === id);
    if (value === undefined) { if (i >= 0) list.splice(i, 1); return i >= 0 ? "削除" : "なし"; }
    const v = { ...value, id } as { id: string };
    if (i >= 0) { list[i] = v; return "更新"; }
    list.push(v); return "追加";
  };
  for (const op of set.changes) {
    if (op.op === "card" || op.op === "addCard") {
      edit(TODO_FILE, (bundle: TodoBundle) => {
        bundle.cards ??= [];
        if (op.op === "addCard") {
          const card = TodoCardSchema.safeParse(op.value);
          if (!card.success) { errors.push(`作業カードの形が違います: ${card.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join(" / ")}`); return; }
          const r = upsert(bundle.cards as Array<{ id: string }>, card.data.id, card.data as unknown as Record<string, unknown>);
          notes.push(`作業カード「${card.data.title}」を${r}`);
        } else {
          const id = op.id ?? cardId;
          const card = bundle.cards.find(c => c.id === id);
          if (!card) { errors.push(`作業カード '${id ?? "（不明）"}' がありません`); return; }
          if (op.status) card.status = op.status;
          if (op.notes !== undefined) card.notes = op.notes;
          notes.push(`作業カード「${card.title}」${op.status ? `を「${STATUS_LABEL[op.status]}」に` : "のメモを更新"}`);
        }
      }, () => ({ formatVersion: 1, cards: [] }));
      continue;
    }
    const { kind, id, map } = splitLink(op.target);
    const value = op.op === "put" ? op.value : undefined;
    if (op.op === "put" && (kind !== "flag" && kind !== "variable") && (typeof value !== "object" || value === null || Array.isArray(value))) { errors.push(`${op.target}: value はオブジェクト（{ … }）で書いてください`); continue; }
    if (!LINK_KINDS[kind]) { errors.push(`${op.target}: 種類 '${kind}' は変更できません（${Object.keys(LINK_KINDS).join("・")}）`); continue; }
    if (!IdSchema.safeParse(id).success) { errors.push(`${op.target}: ID は英小文字・数字・ハイフンで書いてください`); continue; }
    const m = manifestOf(out), p = paths(m);
    const label = `${LINK_KINDS[kind]} ${map ? `${map}/` : ""}${id}`;
    const listOp = (file: string, list: string, create?: () => unknown) => edit(file, (data: Record<string, Array<{ id: string }>>) => {
      data[list] ??= [];
      notes.push(`${label} を${upsert(data[list]!, id, value as Record<string, unknown> | undefined)}`);
    }, create);
    if (kind === "dialogue") listOp(p.dialogues, "dialogues", () => ({ formatVersion: 1, dialogues: [] }));
    else if (kind === "event") listOp(p.events, "events", () => ({ formatVersion: 1, events: [] }));
    else if (DB_LIST[kind]) listOp(p.database, DB_LIST[kind]!);
    else if (kind === "rule") edit(p.rules, (data: { rules?: Array<{ id: string }> }) => { data.rules ??= []; notes.push(`${label} を${upsert(data.rules, id, value as Record<string, unknown> | undefined)}`); });
    else if (kind === "flag" || kind === "variable") edit("project.json", (data: Record<string, Record<string, unknown>>) => {
      const key = kind === "flag" ? "flags" : "variables";
      data[key] ??= {};
      if (value === undefined) { delete data[key]![id]; notes.push(`${label} を削除`); return; }
      const decl = typeof value === "object" && value !== null ? value : kind === "flag" ? { initial: Boolean(value) } : { initial: Number(value) || 0 };
      notes.push(`${label} を${data[key]![id] === undefined ? "宣言" : "更新"}`);
      data[key]![id] = decl;
    });
    else if (kind === "test") {
      const file = `tests/${id}.scenario.json`;
      if (value === undefined) { if (out[file] !== undefined) { delete out[file]; changed.add(file); notes.push(`${label} を削除`); } continue; }
      const text = fmt(value);
      if (out[file] !== text) { notes.push(`${label} を${out[file] === undefined ? "追加" : "更新"}`); out[file] = text; changed.add(file); }
    } else if (kind === "map") {
      const ref = m.maps?.find(x => x.id === id);
      if (value === undefined) { errors.push(`${label}: マップの削除はチャットからはできません（工房で行ってください）`); continue; }
      const file = ref?.path ?? `maps/${id}.json`;
      const v = { formatVersion: 1, ...(value as Record<string, unknown>), id };
      const text = fmt(v);
      if (out[file] !== text) { out[file] = text; changed.add(file); }
      if (!ref) edit("project.json", (data: Manifest) => { data.maps ??= []; data.maps.push({ id, path: file, title: String((value as { title?: unknown }).title ?? id) }); });
      notes.push(`${label} を${ref ? "更新" : "追加"}`);
    } else if (MAP_LIST[kind]) {
      const ref = m.maps?.find(x => x.id === map);
      if (!ref) { errors.push(`${op.target}: マップ '${map}' がありません（"${kind}:マップID/ID" の形で書きます）`); continue; }
      listOp(ref.path, MAP_LIST[kind]!);
    }
  }
  return { texts: out, changed: [...changed], notes, errors };
}

/** Extra checks on a proposal after it was applied: a card marked done needs the test it promised. */
export function proposalChecks(next: Texts, set: ChangeSet): string[] {
  const problems: string[] = [];
  const { bundle } = readTodo(next);
  for (const op of set.changes) {
    if (op.op !== "card" || op.status !== "done") continue;
    const card = bundle.cards.find(c => c.id === (op.id ?? set.card));
    const test = card?.doneWhen?.test;
    if (test && next[test] === undefined) problems.push(`作業カード「${card!.title}」を「できた」にするには、完成の確かめ方の自動テスト ${test} が必要です（target "test:${test.replace(/^tests\//, "").replace(/\.scenario\.json$/, "")}" で作ってください）`);
  }
  return problems;
}

/* ------------------------------------------------------------------ packs (texts to paste into the chat) */

const STATUS_LABEL = { todo: "これから", doing: "作業中", done: "できた" } as const;
export const statusLabel = (s: TodoCard["status"]) => STATUS_LABEL[s];

function unionNames(schema: unknown, pick: (option: any) => string | undefined): string[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const def = (schema as { _zod: { def: { getter?: () => unknown } } })._zod.def;
    const inner = (def.getter ? def.getter() : schema) as { _zod: { def: { options: unknown[] } } };
    return inner._zod.def.options.map(pick).filter((x): x is string => Boolean(x));
  } catch { return []; }
}
export const effectTypes = () => unionNames(EffectSchema, o => o._zod.def.shape?.type?._zod.def.values?.[0]);
export const conditionForms = () => unionNames(ConditionSchema, o => { const keys = Object.keys(o._zod.def.shape ?? {}); return keys.length ? `{ ${keys.map(k => `"${k}"`).join(", ")} }` : undefined; });

/** Ids that can be referred to (compact, one line per kind). */
export function idIndex(texts: Texts): string[] {
  const m = manifestOf(texts), p = paths(m);
  const names = (file: string, list: string) => (parse<Record<string, Array<{ id: string; name?: string; title?: string; label?: string; speaker?: string }>>>(texts, file)?.[list] ?? []).map(x => `${x.id}${x.name ?? x.title ?? x.label ?? x.speaker ? `(${x.name ?? x.title ?? x.label ?? x.speaker})` : ""}`);
  const lines: string[] = [];
  const add = (label: string, ids: string[]) => { if (ids.length) lines.push(`- ${label}: ${ids.join(", ")}`); };
  add("マップ map", (m.maps ?? []).map(x => `${x.id}(${x.title ?? ""})`));
  for (const ref of m.maps ?? []) {
    const data = parse<Record<string, Array<{ id: string; name?: string; label?: string; x?: number; y?: number }>>>(texts, ref.path);
    if (!data) continue;
    add(`　${ref.id} の人物 npc`, (data.npcs ?? []).map(n => `${n.id}${n.name ? `(${n.name})` : ""}@${n.x},${n.y}`));
    add(`　${ref.id} の仕掛け interactable`, (data.interactables ?? []).map(n => `${n.id}${n.label ? `(${n.label})` : ""}@${n.x},${n.y}`));
    add(`　${ref.id} の出入口 portal`, (data.portals ?? []).map(n => `${n.id}@${n.x},${n.y}`));
  }
  add("会話 dialogue", names(p.dialogues, "dialogues"));
  add("イベント event", names(p.events, "events"));
  for (const [kind, list] of Object.entries(DB_LIST)) add(`${LINK_KINDS[kind]} ${kind}`, names(p.database, list));
  add("フラグ flag", Object.keys(m.flags ?? {}));
  add("変数 variable", Object.keys(m.variables ?? {}));
  return lines;
}

/** A real example of a kind from this project (so the AI copies a valid shape). */
function exampleOf(texts: Texts, kind: string): unknown {
  const m = manifestOf(texts), p = paths(m);
  if (kind === "dialogue") return parse(texts, p.dialogues)?.dialogues?.[0];
  if (kind === "event") return parse(texts, p.events)?.events?.[0];
  if (DB_LIST[kind]) return parse(texts, p.database)?.[DB_LIST[kind]!]?.[0];
  if (MAP_LIST[kind]) for (const ref of m.maps ?? []) { const v = parse(texts, ref.path)?.[MAP_LIST[kind]!]?.[0]; if (v) return v; }
  if (kind === "test") { const file = Object.keys(texts).find(f => f.startsWith("tests/") && f.endsWith(".scenario.json")); return file ? parse(texts, file) : undefined; }
  return undefined;
}

const block = (lang: string, body: string) => `\`\`\`${lang}\n${body.trimEnd()}\n\`\`\``;
const excerpt = (text: string | undefined, max: number) => !text ? "" : text.length > max ? `${text.slice(0, max)}\n…（以下略。必要なら聞いてください）` : text;

const ANSWER_RULES = (cardId: string | undefined) => `## 返事の形式（必ずこの形で）
変更は次のような \`\`\`rpg-change のコードブロック1つにまとめてください。工房がこれを読み取り、検証してから取り込みます。
${block("rpg-change", JSON.stringify({ card: cardId ?? "<作業カードのID>", changes: [
  { op: "put", target: "dialogue:<会話ID>", value: { speaker: "…", lines: ["…"], choices: [], effects: [] } },
  { op: "put", target: "npc:<マップID>/<人物ID>", value: { name: "…", x: 3, y: 4, dialogues: [{ dialogue: "<会話ID>" }] } },
  { op: "put", target: "flag:<フラグID>", value: { initial: false, description: "…" } },
  { op: "card", status: "done" },
] }, null, 1))}
- \`put\` は丸ごと置き換え（なければ追加）。今の内容を下に載せたので、変えない所もそのまま書き写してください。\`remove\` は削除
- target の種類: ${Object.entries(LINK_KINDS).map(([k, v]) => `${k}（${v}）`).join("、")}。マップの上の物は "npc:マップID/ID" の形
- ID は英小文字・数字・ハイフン。新しいフラグ・変数は flag: / variable: で宣言してから使う
- このカードに必要な分だけ変える。関係ない所は書かない
- できたら自動テスト（target "test:<名前>"）も付けると、工房が遊んで確かめます
- 分からない所・決めてほしい所は、推測で埋めずにブロックの外で質問してください`;

function guide(): string {
  const effects = effectTypes(), conds = conditionForms();
  return `## 書き方の要点
- 効果（effects の中の { "type": … }）: ${effects.join(", ") || "（docs/project-format.md）"}
- 条件（when など）: ${conds.join(" ") || "（docs/project-format.md）"}
- よく使う形: 会話 { "speaker", "lines": ["…"], "choices": [{ "id", "label", "effects": [] }], "effects": [] }。人物 { "name", "x", "y", "sprite"?, "dialogues": [{ "when"?, "dialogue": "<会話ID>" }] }（上から順に条件に合う会話）。調べる物 { "label", "x", "y", "event" }。イベント { "label", "once"?, "effects": [] }
- 例: 鍵を渡す [{ "type": "giveItem", "item": "old-key" }, { "type": "setFlag", "flag": "has-key", "value": true }]、条件 { "flag": "has-key" }`;
}

/** The text to paste into the chat for one card. */
export function cardPack(texts: Texts, cardId: string): string {
  const { bundle } = readTodo(texts);
  const card = bundle.cards.find(c => c.id === cardId);
  if (!card) return `作業カード '${cardId}' がありません`;
  const project = manifestOf(texts) as Manifest & { title?: string };
  const parts: string[] = [];
  parts.push(`# RPGシステム工房：作業の依頼「${card.title}」
あなたは「RPGシステム工房」で作っているRPG「${project.title ?? ""}」のデータを書く手伝いをします。あなたはファイルを直接触れません。下の約束どおりの「変更案」を返してください。作り手がそれを工房に貼り、工房が検証・自動テストをしてから取り込みます。`);
  parts.push(`## 今回の作業カード（${card.id}）
- やりたいこと: ${card.goal || card.title}
${card.doneWhen?.test ? `- 完成の確かめ方: 自動テスト ${card.doneWhen.test}\n` : ""}${card.doneWhen?.check ? `- 完成の確かめ方: ${card.doneWhen.check}\n` : ""}${card.notes ? `- メモ: ${card.notes}\n` : ""}`.trimEnd());
  const idea = texts["IDEA.md"], script = texts["SCRIPT.md"];
  if (idea) parts.push(`## ゲームの発想（IDEA.md の抜粋）\n${excerpt(idea, 1500)}`);
  if (script) {
    const words = [card.title, card.goal, ...card.links.map(l => splitLink(l).id)].join(" ").split(/[\s、。・「」（）()]+/).filter(w => w.length >= 2);
    const hits = script.split(/\n(?=#)/).filter(section => words.some(w => section.includes(w)));
    if (hits.length) parts.push(`## 台本（SCRIPT.md）の関係する所\n${excerpt(hits.join("\n"), 2500)}`);
  }
  const linked: string[] = [];
  const kindsNew = new Set<string>();
  for (const link of card.links) {
    const found = lookup(texts, link);
    if (found) linked.push(`### ${link}（${found.file}）\n${block("json", JSON.stringify(found.value, null, 1))}`);
    else { linked.push(`### ${link}\n（まだありません。新しく作ってください）`); kindsNew.add(splitLink(link).kind); }
  }
  const testName = card.doneWhen?.test?.replace(/^tests\//, "").replace(/\.scenario\.json$/, "");
  if (testName && texts[`tests/${testName}.scenario.json`] === undefined) { linked.push(`### test:${testName}\n（まだありません。このカードができたことを確かめる自動テストを target "test:${testName}" で作ってください）`); kindsNew.add("test"); }
  if (linked.length) parts.push(`## ひも付いたデータの今の内容\n${linked.join("\n\n")}`);
  const examples = [...kindsNew].map(kind => { const v = exampleOf(texts, kind); return v ? `### ${LINK_KINDS[kind]}の見本（このゲームの既存データ）\n${block("json", JSON.stringify(v, null, 1))}` : ""; }).filter(Boolean);
  if (examples.length) parts.push(`## 新しく作るものの見本\n${examples.join("\n\n")}`);
  parts.push(`## このゲームにあるID（参照してよいもの）\n${idIndex(texts).join("\n")}`);
  parts.push(guide());
  parts.push(ANSWER_RULES(card.id));
  return parts.join("\n\n");
}

/** The text that asks the chat to split the idea / script / spec into small cards. */
export function planPack(texts: Texts, opts: { max?: number } = {}): string {
  const project = manifestOf(texts) as Manifest & { title?: string };
  const { bundle } = readTodo(texts);
  const parts: string[] = [];
  parts.push(`# RPGシステム工房：作業カードづくりの依頼
RPG「${project.title ?? ""}」を、チャットで少しずつ作ります。下の発想・台本・仕様をもとに、**1枚で終わる小さな作業カード**を最大${opts.max ?? 10}枚、作る順に出してください（1枚＝会話1つ、イベント1つ、敵1体、マップ1枚くらい）。`);
  for (const file of PLAN_FILES) if (texts[file]) parts.push(`## ${file}\n${excerpt(texts[file], file === "IDEA.md" ? 3000 : 6000)}`);
  if (!PLAN_FILES.some(f => texts[f])) parts.push("（IDEA.md・SCRIPT.md・SPEC.md がまだありません。作りたいゲームの説明を、この下に作り手が書き足してください）");
  if (bundle.cards.length) parts.push(`## もうある作業カード（重ねて出さない）\n${bundle.cards.map(c => `- ${c.id}「${c.title}」${statusLabel(c.status)}`).join("\n")}`);
  parts.push(`## このゲームにあるID\n${idIndex(texts).join("\n")}`);
  parts.push(`## 返事の形式
${block("rpg-change", JSON.stringify({ changes: [{ op: "addCard", value: { id: "meet-elder", title: "村長に会う", goal: "村の奥の家で村長と話すと、森に行く理由が分かる", links: ["npc:village/elder", "dialogue:elder-intro"], doneWhen: { check: "村長に話しかけると目的を教えてくれる" } } }] }, null, 1))}
- links はそのカードで作る・変えるデータ（"種類:ID"。種類は ${Object.keys(LINK_KINDS).join("・")}。マップの上の物は "npc:マップID/ID"）
- まだないIDは新しく考えてよい（英小文字・数字・ハイフン）
- 発想の核を「よくある形」に置き換えない。決まっていない所はカードの notes に「要相談: …」と書く`);
  return parts.join("\n\n");
}

/** After a failed import: what went wrong, plus the current data again, to paste back into the chat. */
export function fixPack(texts: Texts, set: ChangeSet | undefined, problems: string[]): string {
  const targets = [...new Set((set?.changes ?? []).flatMap(op => (op.op === "put" || op.op === "remove" ? [op.target] : [])))];
  const current = targets.map(t => { const f = lookup(texts, t); return f ? `### ${t}\n${block("json", JSON.stringify(f.value, null, 1))}` : ""; }).filter(Boolean);
  return `前の変更案を工房に取り込もうとしたら、次の問題が見つかりました。直した変更案を、同じ \`\`\`rpg-change の形で**全部**出し直してください（直した所だけでなく、取り込みたい変更すべて）。

## 問題
${problems.map(p => `- ${p}`).join("\n")}
${current.length ? `\n## 今の内容（参考）\n${current.join("\n\n")}` : ""}
${guide()}`;
}

/* ------------------------------------------------------------------ 台本・仕様書のひな形 */

export const SCRIPT_TEMPLATE = `# 台本（SCRIPT.md）
場面ごとに「どこで・だれが・何を言う・何が起きる」を書きます。チャットのAIは、作業カードに関係する場面だけを読みます。
見出し（#）ごとに1場面にすると、カードと結びつきやすくなります。

# 1. はじまり（苔森の村）
- 主人公が目を覚ます。
- 村長「よく来たね。森の奥の祠を見てきてくれないか」
- → 森へ行く理由が分かる

# 2. 森の入口
- 見張り「この先は魔物が出る。気をつけて」
`;

export const SPEC_TEMPLATE = `# 仕様書（SPEC.md）
ゲームの決まりごとを、短い箇条書きで書きます。長編なら必須、短編でもあると迷いません。

## 全体
- 遊ぶ時間の目安: 15分
- 主人公: 1人（仲間なし）
- 終わり方: 祠で真実を知るとエンディング

## 戦闘・成長
- 敵は3種類。レベルは上がらない
- 回復は宿屋だけ

## 決まりごと
- お金の単位: ゴールド
- 大事なアイテム: 古い鍵（祠の扉を開ける）
`;

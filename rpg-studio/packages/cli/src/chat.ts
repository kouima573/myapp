/**
 * `rpg chat …` — チャットのAI（ChatGPT など、ファイルを触れないAI）と作るためのコマンド。
 *   cards                         作業カードの一覧
 *   card add --id … --title … [--goal … --links a,b --test <名前> --check "…"]   カードを足す
 *   card set <id> --status todo|doing|done
 *   plan [--max 10]               発想・台本・仕様からカードを作ってもらう依頼文
 *   pack <カードID>               そのカードの依頼パック（AIに貼る文章）
 *   apply <返事のファイル|-> [--write]   AIの返事（```rpg-change）を当てはめて検証・自動テスト。--write で保存
 * 中身は packages/schema/src/chat.ts（工房と共用）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  applyChangeSet, cardPack, fixPack, loadProjectContent, parseChangeSet, planPack, proposalChecks, readTodo, statusLabel, TODO_FILE, TodoCardSchema, writeTodo,
  type ChangeSet, type GameContent, type Texts,
} from "../../schema/src/index";
import { ScenarioSchema, runScenario } from "../../engine/src/scenario";
import { summarizeChange } from "../../local-server/src/summary";
import { readProjectTexts } from "./load";

type Flags = Record<string, string | boolean>;
const str = (flags: Flags, key: string) => (typeof flags[key] === "string" ? (flags[key] as string) : undefined);

async function projectTexts(root: string): Promise<Texts> {
  const { texts } = await readProjectTexts(root);
  try { for (const name of (await fs.readdir(path.join(root, "tests"))).filter(n => n.endsWith(".scenario.json")).sort()) texts[`tests/${name}`] = await fs.readFile(path.join(root, "tests", name), "utf8"); } catch { /* no tests */ }
  return texts;
}

/** Scenario tests from in-memory texts (so a proposal can be tried before saving). */
export async function runTextScenarios(root: string, content: GameContent, texts: Texts): Promise<Array<{ file: string; ok: boolean; message?: string }>> {
  const { loadSystems } = await import("./index");
  const systems = await loadSystems(root, content);
  const out: Array<{ file: string; ok: boolean; message?: string }> = [];
  for (const file of Object.keys(texts).filter(f => f.startsWith("tests/") && f.endsWith(".scenario.json")).sort()) {
    let raw: unknown;
    try { raw = JSON.parse(texts[file]!); } catch (e) { out.push({ file, ok: false, message: `JSONとして読めません: ${String(e)}` }); continue; }
    const parsed = ScenarioSchema.safeParse(raw);
    if (!parsed.success) { out.push({ file, ok: false, message: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }); continue; }
    const r = runScenario(content, systems, parsed.data);
    out.push({ file, ok: r.ok, message: r.ok ? undefined : `steps[${r.failedStep ?? "?"}] ${r.message ?? ""}` });
  }
  return out;
}

/** Applies a proposal in memory and checks it. `problems` empty = safe to save. */
export async function tryProposal(root: string, texts: Texts, answer: string): Promise<{ set?: ChangeSet; next: Texts; changed: string[]; notes: string[]; problems: string[]; summary: string[] }> {
  const parsed = parseChangeSet(answer);
  if (!parsed.set) return { next: texts, changed: [], notes: [], problems: [parsed.error!], summary: [] };
  const applied = applyChangeSet(texts, parsed.set);
  const problems = [...applied.errors, ...proposalChecks(applied.texts, parsed.set)];
  const loaded = loadProjectContent(applied.texts);
  for (const d of loaded.diagnostics) if (d.severity === "error") problems.push(`${d.file}${d.at ? ` › ${d.at}` : ""}: ${d.message}`);
  if (loaded.content && !problems.length) {
    for (const r of await runTextScenarios(root, loaded.content, applied.texts)) if (!r.ok) problems.push(`自動テスト ${r.file} が失敗: ${r.message}`);
  }
  const summary = applied.changed.flatMap(file => summarizeChange(file, texts[file], applied.texts[file]).map(line => `${file}: ${line}`));
  return { set: parsed.set, next: applied.texts, changed: applied.changed, notes: applied.notes, problems, summary };
}

async function save(root: string, before: Texts, next: Texts, changed: string[]) {
  for (const file of changed) {
    const target = path.join(root, file);
    if (!path.resolve(target).startsWith(path.resolve(root) + path.sep)) throw new Error(`プロジェクトの外には書けません: ${file}`);
    if (next[file] === undefined) { await fs.rm(target, { force: true }); continue; }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, next[file]!);
  }
  void before;
}

export async function cmdChat(sub: string | undefined, args: string[], flags: Flags, root: string): Promise<number> {
  const texts = await projectTexts(root);
  const { bundle, error } = readTodo(texts);
  if (error) console.log(`WARN ${error}`);

  if (sub === "cards") {
    if (!bundle.cards.length) { console.log("作業カードはまだありません。pnpm rpg chat plan で、発想からカードを作ってもらう依頼文を出せます"); return 0; }
    for (const c of bundle.cards) console.log(`[${statusLabel(c.status)}] ${c.id} — ${c.title}${c.links.length ? `\n      ひも付け: ${c.links.join(", ")}` : ""}`);
    const done = bundle.cards.filter(c => c.status === "done").length;
    console.log(`${done}/${bundle.cards.length} 枚できました`);
    return 0;
  }

  if (sub === "card") {
    const action = args[0];
    if (action === "add") {
      const card = TodoCardSchema.safeParse({
        id: str(flags, "id"), title: str(flags, "title"), goal: str(flags, "goal") ?? "",
        links: (str(flags, "links") ?? "").split(",").map(s => s.trim()).filter(Boolean),
        ...(str(flags, "test") || str(flags, "check") ? { doneWhen: { ...(str(flags, "test") ? { test: `tests/${str(flags, "test")!.replace(/^tests\//, "").replace(/(\.scenario)?\.json$/, "")}.scenario.json` } : {}), ...(str(flags, "check") ? { check: str(flags, "check") } : {}) } } : {}),
      });
      if (!card.success) { console.log(`ERROR ${card.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join(" / ")}`); return 2; }
      if (bundle.cards.some(c => c.id === card.data.id)) { console.log(`ERROR 作業カード '${card.data.id}' は既にあります`); return 2; }
      bundle.cards.push(card.data);
      await fs.writeFile(path.join(root, TODO_FILE), writeTodo(bundle));
      console.log(`OK 作業カード「${card.data.title}」を追加しました（pnpm rpg chat pack ${card.data.id} で依頼文）`);
      return 0;
    }
    if (action === "set") {
      const card = bundle.cards.find(c => c.id === args[1]);
      const status = str(flags, "status");
      if (!card || (status !== "todo" && status !== "doing" && status !== "done")) { console.log("ERROR pnpm rpg chat card set <id> --status todo|doing|done"); return 2; }
      card.status = status;
      await fs.writeFile(path.join(root, TODO_FILE), writeTodo(bundle));
      console.log(`OK ${card.id} を「${statusLabel(status)}」にしました`);
      return 0;
    }
  }

  if (sub === "plan") { console.log(planPack(texts, { max: Number(flags.max) || 10 })); return 0; }

  if (sub === "pack") {
    const id = args[0];
    if (!id || !bundle.cards.some(c => c.id === id)) { console.log(`ERROR 作業カードのIDを指定してください（pnpm rpg chat cards で一覧）`); return 2; }
    console.log(cardPack(texts, id));
    return 0;
  }

  if (sub === "apply") {
    const from = args[0];
    if (!from) { console.log("ERROR AIの返事を保存したファイルを指定してください（- で標準入力）"); return 2; }
    const answer = from === "-" ? await new Promise<string>(resolve => { let s = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", d => { s += d; }); process.stdin.on("end", () => resolve(s)); }) : await fs.readFile(path.resolve(from), "utf8");
    const result = await tryProposal(root, texts, answer);
    const assumptions = result.set?.assumptions, unresolved = result.set?.unresolved;
    if (!result.set || assumptions === undefined || unresolved === undefined) console.log("WARN 前提・未決事項の申告がない変更案です。変更内容を確認してください");
    else {
      for (const item of assumptions) console.log(`ASSUMPTION ${item}`);
      for (const item of unresolved) console.log(`UNRESOLVED ${item}`);
      if (!assumptions.length && !unresolved.length) console.log("INFO AIの申告: 追加前提・未決事項なし");
    }
    for (const n of result.notes) console.log(`- ${n}`);
    for (const line of result.summary) console.log(`  ${line}`);
    if (result.problems.length) {
      for (const p of result.problems) console.log(`ERROR ${p}`);
      const fix = fixPack(texts, result.set, result.problems);
      const out = path.join(root, ".rpg-studio", "chat-fix.md");
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, fix);
      console.log(`FAILED chat apply: 取り込みませんでした。AIに貼り戻す「直してほしい点」を ${path.relative(process.cwd(), out)} に書きました`);
      return 1;
    }
    if (!result.changed.length) { console.log("OK chat apply: 変わる所はありませんでした"); return 0; }
    if (!flags.write) { console.log(`OK chat apply: 検証と自動テストは通りました（${result.changed.length}ファイル）。保存するには --write を付けて実行`); return 0; }
    await save(root, texts, result.next, result.changed);
    console.log(`OK chat apply: ${result.changed.join(", ")} を保存しました`);
    return 0;
  }

  console.log(`rpg chat <cards|card|plan|pack|apply> --project <dir>   チャットのAI（ChatGPTなど）と作る
  cards                                         作業カードの一覧
  card add --id <id> --title "…" [--goal "…" --links dialogue:elder,npc:village/elder --test <名前> --check "…"]
  card set <id> --status todo|doing|done
  plan [--max 10]                               IDEA.md・SCRIPT.md・SPEC.md からカードを作ってもらう依頼文
  pack <カードID>                               そのカードの依頼文（AIに貼る）
  apply <返事のファイル|-> [--write]             AIの返事を当てはめて検証・自動テスト（--write で保存）`);
  return sub ? 2 : 0;
}

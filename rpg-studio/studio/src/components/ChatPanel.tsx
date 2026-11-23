import { useMemo, useState } from "react";
import { ClipboardCopy, MessagesSquare, Plus, Trash2, CheckCircle2, XCircle, FileText } from "lucide-react";
import {
  applyChangeSet, cardPack, fixPack, LINK_KINDS, loadProjectContent, parseChangeSet, planPack, proposalChecks, readTodo, SCRIPT_TEMPLATE, SPEC_TEMPLATE,
  statusLabel, TODO_FILE, TodoCardSchema, writeTodo, type ChangeSet, type TodoCard,
} from "@rpg/schema";
import { runScenario, ScenarioSchema } from "../../../packages/engine/src/scenario";
import { withModules } from "../../../packages/modules/src/index";
import { summarizeChange } from "../../../packages/local-server/src/summary";
import type { ProjectStore } from "../lib/useProject";

interface Checked { set?: ChangeSet; next: Record<string, string>; changed: string[]; notes: string[]; summary: string[]; problems: string[] }

/**
 * チャットで作る: ChatGPT などファイルを触れないAIと作るための画面。
 * 作業カード（todo.json）→ 依頼文をコピー → AIの返事を貼る → 工房が検証と自動テスト → 取り込む／直してほしい点をコピー。
 */
export default function ChatPanel({ store }: { store: ProjectStore }) {
  const { bundle, error } = useMemo(() => readTodo(store.texts), [store.texts]);
  const [copied, setCopied] = useState("");
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [draft, setDraft] = useState({ id: "", title: "", goal: "", links: "", test: "", check: "" });

  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); window.setTimeout(() => setCopied(""), 1600); }
    catch { store.log("warn", "クリップボードに書けませんでした。ブラウザの許可を確認してください"); }
  };
  const saveCards = (cards: TodoCard[]) => store.setFileText(TODO_FILE, writeTodo({ formatVersion: 1, cards }));

  const addCard = () => {
    const card = TodoCardSchema.safeParse({
      id: draft.id.trim(), title: draft.title.trim(), goal: draft.goal.trim(),
      links: draft.links.split(/[,\s、]+/).map(s => s.trim()).filter(Boolean),
      ...(draft.test || draft.check ? { doneWhen: { ...(draft.test ? { test: `tests/${draft.test.trim().replace(/(\.scenario)?\.json$/, "")}.scenario.json` } : {}), ...(draft.check ? { check: draft.check.trim() } : {}) } } : {}),
    });
    if (!card.success) { store.log("error", `作業カード: ${card.error.issues.map(i => `${i.path.join(".") || "全体"} ${i.message}`).join(" / ")}`); return; }
    if (bundle.cards.some(c => c.id === card.data.id)) { store.log("error", `作業カード '${card.data.id}' は既にあります`); return; }
    saveCards([...bundle.cards, card.data]);
    setDraft({ id: "", title: "", goal: "", links: "", test: "", check: "" });
  };

  const check = () => {
    const parsed = parseChangeSet(answer);
    if (!parsed.set) { setChecked({ next: store.texts, changed: [], notes: [], summary: [], problems: [parsed.error!] }); return; }
    const applied = applyChangeSet(store.texts, parsed.set);
    const problems = [...applied.errors, ...proposalChecks(applied.texts, parsed.set)];
    const loaded = loadProjectContent(applied.texts);
    for (const d of loaded.diagnostics) if (d.severity === "error") problems.push(`${d.file}${d.at ? ` › ${d.at}` : ""}: ${d.message}`);
    if (loaded.content && !problems.length) {
      const systems = withModules(loaded.content, store.systems);
      for (const file of Object.keys(applied.texts).filter(f => f.startsWith("tests/") && f.endsWith(".scenario.json")).sort()) {
        try {
          const scenario = ScenarioSchema.parse(JSON.parse(applied.texts[file]!));
          const r = runScenario(loaded.content, systems, scenario);
          if (!r.ok) problems.push(`自動テスト ${file} が失敗: steps[${r.failedStep ?? "?"}] ${r.message ?? ""}`);
        } catch (e) { problems.push(`自動テスト ${file} を読めません: ${e instanceof Error ? e.message : String(e)}`); }
      }
    }
    const summary = applied.changed.flatMap(file => summarizeChange(file, store.texts[file], applied.texts[file]).map(line => `${file}: ${line}`));
    setChecked({ set: parsed.set, next: applied.texts, changed: applied.changed, notes: applied.notes, summary, problems });
  };

  const take = () => {
    if (!checked || checked.problems.length) return;
    store.beginGroup();
    for (const file of checked.changed) if (checked.next[file] !== undefined) store.setFileText(file, checked.next[file]!);
    store.endGroup();
    store.log("ok", `チャットの変更案を取り込みました（${checked.changed.join(", ")}）。元に戻すときは Ctrl+Z か「保存履歴」`);
    setChecked(null); setAnswer("");
  };

  const docs = (["IDEA.md", "SCRIPT.md", "SPEC.md"] as const).map(f => ({ file: f, has: store.texts[f] !== undefined }));
  const done = bundle.cards.filter(c => c.status === "done").length;

  return <div className="panel-page chat-panel">
    <h2><MessagesSquare size={18} /> チャットで作る（ChatGPT など）</h2>
    <p className="muted">ファイルを触れないチャットのAIと作るための画面です。工房がAIの代わりに「必要なデータを集めて渡す」「返事を検証・自動テストする」「直してほしい点を文章にする」を行います。
      <br />目安: <b>短編（〜30分）はチャットで作れます</b>。<b>長編は Codex（おすすめ）や Claude Code</b> のように、ファイルを直接扱えるAIを使ってください。どちらでも <b>台本（SCRIPT.md）</b> があると話がぶれず、長編では <b>仕様書（SPEC.md）</b> もおすすめです。</p>

    <section>
      <h3>1. 発想・台本・仕様書</h3>
      <div className="row">
        {docs.map(d => <span key={d.file} className={`tag ${d.has ? "ok" : ""}`}>{d.has ? <CheckCircle2 size={12} /> : <FileText size={12} />} {d.file}{d.has ? "" : "（なし）"}</span>)}
        {!docs[1]!.has && <button onClick={() => store.setFileText("SCRIPT.md", SCRIPT_TEMPLATE)}><Plus size={13} /> 台本のひな形を作る</button>}
        {!docs[2]!.has && <button onClick={() => store.setFileText("SPEC.md", SPEC_TEMPLATE)}><Plus size={13} /> 仕様書のひな形を作る</button>}
      </div>
      <p className="muted small">中身は「データ」画面で書けます（IDEA.md は「発想」画面）。チャットのAIには、カードに関係する場面だけが渡ります。</p>
    </section>

    <section>
      <h3>2. 作業カード（{done}/{bundle.cards.length} 枚できた）</h3>
      {error && <p className="error-text">{error}</p>}
      <div className="row">
        <button onClick={() => void copy("plan", planPack(store.texts))}><ClipboardCopy size={13} /> {copied === "plan" ? "コピーしました" : "カードを作ってもらう依頼文をコピー"}</button>
        <span className="muted small">発想・台本・仕様書から、AIに小さなカードへ分けてもらいます（返事は下の 3 に貼る）</span>
      </div>
      <ol className="chat-cards">
        {bundle.cards.map(card => <li key={card.id} className={`chat-card status-${card.status}`}>
          <div className="row">
            <select value={card.status} aria-label="状態" onChange={e => saveCards(bundle.cards.map(c => c.id === card.id ? { ...c, status: e.target.value as TodoCard["status"] } : c))}>
              {(["todo", "doing", "done"] as const).map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
            <b>{card.title}</b> <code>{card.id}</code>
            <button onClick={() => void copy(card.id, cardPack(store.texts, card.id))}><ClipboardCopy size={13} /> {copied === card.id ? "コピーしました" : "依頼文をコピー"}</button>
            <button className="icon-button" title="カードを消す" onClick={() => { if (window.confirm(`作業カード「${card.title}」を消しますか？`)) saveCards(bundle.cards.filter(c => c.id !== card.id)); }}><Trash2 size={13} /></button>
          </div>
          {card.goal && <div className="muted small">{card.goal}</div>}
          {card.links.length > 0 && <div className="small">ひも付け: {card.links.map(l => <code key={l}>{l}</code>)}</div>}
          {card.doneWhen && <div className="small">確かめ方: {card.doneWhen.test ?? ""}{card.doneWhen.test && card.doneWhen.check ? " / " : ""}{card.doneWhen.check ?? ""}</div>}
          {card.notes && <div className="small">メモ: {card.notes}</div>}
        </li>)}
      </ol>
      <details>
        <summary>自分でカードを足す</summary>
        <div className="form-grid">
          <label>ID<input value={draft.id} placeholder="talk-cat" onChange={e => setDraft({ ...draft, id: e.target.value })} /></label>
          <label>名前<input value={draft.title} placeholder="村の猫と話す" onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>やりたいこと<textarea rows={2} value={draft.goal} onChange={e => setDraft({ ...draft, goal: e.target.value })} /></label>
          <label>ひも付け<input value={draft.links} placeholder="npc:village/cat, dialogue:cat-talk, flag:cat-met" onChange={e => setDraft({ ...draft, links: e.target.value })} /></label>
          <label>自動テスト名<input value={draft.test} placeholder="cat（tests/cat.scenario.json）" onChange={e => setDraft({ ...draft, test: e.target.value })} /></label>
          <label>人が確かめること<input value={draft.check} onChange={e => setDraft({ ...draft, check: e.target.value })} /></label>
        </div>
        <p className="muted small">ひも付けの種類: {Object.entries(LINK_KINDS).map(([k, v]) => `${k}（${v}）`).join("、")}。マップの上の物は <code>npc:マップID/ID</code></p>
        <button onClick={addCard}><Plus size={13} /> カードを足す</button>
      </details>
    </section>

    <section>
      <h3>3. AIの返事を貼る</h3>
      <textarea className="chat-answer" rows={8} value={answer} placeholder="AIの返事をまるごと貼り付けてください（```rpg-change のブロックを工房が探します）" onChange={e => { setAnswer(e.target.value); setChecked(null); }} />
      <div className="row"><button disabled={!answer.trim()} onClick={check}>確かめる（検証と自動テスト）</button></div>
      {checked && <div className="chat-result">
        {checked.notes.length > 0 && <ul>{checked.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        {checked.summary.length > 0 && <details><summary>変わる所（{checked.summary.length}）</summary><ul className="small">{checked.summary.map((n, i) => <li key={i}>{n}</li>)}</ul></details>}
        {checked.problems.length
          ? <>
            <p className="error-text"><XCircle size={14} /> 取り込めません（{checked.problems.length}件）。下のボタンでコピーしてAIに貼り戻してください。</p>
            <ul className="small">{checked.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            <button onClick={() => void copy("fix", fixPack(store.texts, checked.set, checked.problems))}><ClipboardCopy size={13} /> {copied === "fix" ? "コピーしました" : "直してほしい点をコピー"}</button>
          </>
          : checked.changed.length
            ? <><p className="ok-text"><CheckCircle2 size={14} /> 検証と自動テストを通りました（{checked.changed.length}ファイル）。</p><button onClick={take}>取り込む</button></>
            : <p className="muted">変わる所はありませんでした。</p>}
      </div>}
    </section>
  </div>;
}

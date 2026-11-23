import { useMemo, useState } from "react";
import { ClipboardCopy, MessagesSquare, Plus, Trash2, CheckCircle2, XCircle, FileText } from "lucide-react";
import {
  applyChangeSet, cardPack, directPack, fixPack, LINK_KINDS, loadProjectContent, parseChangeSet, planPack, proposalChecks, readTodo, SCRIPT_TEMPLATE, SPEC_TEMPLATE,
  statusLabel, TODO_FILE, TodoCardSchema, writeTodo, type ChangeSet, type TodoCard,
} from "@rpg/schema";
import { runScenario, ScenarioSchema } from "../../../packages/engine/src/scenario";
import { withModules } from "../../../packages/modules/src/index";
import { summarizeChange } from "../../../packages/local-server/src/summary";
import type { ProjectStore } from "../lib/useProject";

interface Checked { set?: ChangeSet; next: Record<string, string>; changed: string[]; notes: string[]; summary: string[]; problems: string[] }

/**
 * チャットで作る: ChatGPT などファイルを触れないAIと作るための画面。
 * カードあり・なしの依頼文をコピー → AIの返事を貼る → 工房が検証と自動テスト → 取り込む／直してほしい点をコピー。
 */
export default function ChatPanel({ store }: { store: ProjectStore }) {
  const { bundle, error } = useMemo(() => readTodo(store.texts), [store.texts]);
  const [copied, setCopied] = useState("");
  const [answer, setAnswer] = useState("");
  const [directRequest, setDirectRequest] = useState("");
  const [referenceFiles, setReferenceFiles] = useState<string[]>(() => store.texts["IDEA.md"] ? ["IDEA.md"] : []);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const needsExplicitReview = Boolean(checked?.set && (
    checked.set.assumptions === undefined || checked.set.unresolved === undefined ||
    checked.set.assumptions.length > 0 || checked.set.unresolved.length > 0
  ));
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
    setReviewed(false);
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
    setChecked({ set: parsed.set, next: applied.texts, changed: applied.changed, notes: [...(parsed.extracted ? ["返事から変更データだけを取り出しました"] : []), ...applied.notes], summary, problems });
  };

  const take = () => {
    if (!checked || checked.problems.length || (needsExplicitReview && !reviewed)) return;
    store.beginGroup();
    for (const file of checked.changed) if (checked.next[file] !== undefined) store.setFileText(file, checked.next[file]!);
    store.endGroup();
    store.log("ok", `チャットの変更案を取り込みました（${checked.changed.join(", ")}）。元に戻すときは Ctrl+Z か「保存履歴」`);
    setChecked(null); setAnswer("");
  };

  const docs = (["IDEA.md", "SCRIPT.md", "SPEC.md"] as const).map(f => ({ file: f, has: store.texts[f] !== undefined }));
  const selectedReferenceFiles = referenceFiles.filter(file => store.texts[file] !== undefined);
  const availableReferenceFiles = Object.keys(store.texts).filter(file =>
    /\.(?:md|mdx|txt|csv|ya?ml|json|ts|tsx|js|mjs|html|css|xml|toml|ini)$/i.test(file) &&
    !["IDEA.md", "SCRIPT.md", "SPEC.md", "todo.json"].includes(file) &&
    !/(^|\/)(?:node_modules|dist|vendor|assets)(?:\/|$)/i.test(file)
  ).sort((a, b) => a.localeCompare(b, "ja"));
  const done = bundle.cards.filter(c => c.status === "done").length;

  return <div className="panel-page chat-panel">
    <h2><MessagesSquare size={18} /> チャットで作る（ChatGPT など）</h2>
    <p className="muted">ファイルを触れないチャットのAIと作るための画面です。工房がAIの代わりに「必要なデータを集めて渡す」「返事を検証・自動テストする」「直してほしい点を文章にする」を行います。
      <br />制作の現在地も進め方も自由です。作業の順序・粒度・AIとのやり取り方の希望に合わせ、方法を混ぜたり途中で変えたりできます。依頼文コピーはカードあり・なしを選べます。変更案をこの画面へ取り込む場合は <code>rpg-change</code> 形式が必要ですが、カードIDはなくても構いません。
      <br />目安: <b>短編（〜30分）はチャットで作れます</b>。<b>長編や独自の遊び方・コードが必要な作品は、CodexやClaude Code</b> のようにファイルを直接扱えるAIを使ってください。この画面は定型データの変更用です。表せない発想を既存のRPG要素に置き換えず、プロジェクトZIPをローカルで開いて拡張してください。台本・仕様書などを使うか、どの形式で作るかは自由です。</p>

    <section>
      <h3>参考資料の状態（任意）</h3>
      <div className="row">
        {docs.map(d => <span key={d.file} className={`tag ${d.has ? "ok" : ""}`}>{d.has ? <CheckCircle2 size={12} /> : <FileText size={12} />} {d.file}{d.has ? "" : "（なし）"}</span>)}
      </div>
      <p className="muted small">発想メモや資料がなくても始められます。既存ファイルを使う場合も、今回必要なものだけ選べます（IDEA.md は「発想」画面、ほかは「データ」画面で開けます）。</p>
      <details>
        <summary>台本・仕様書のひな形を作りたい場合</summary>
        <div className="row">
          {!docs[1]!.has && <button onClick={() => store.setFileText("SCRIPT.md", SCRIPT_TEMPLATE)}><Plus size={13} /> 台本のひな形を作る</button>}
          {!docs[2]!.has && <button onClick={() => store.setFileText("SPEC.md", SPEC_TEMPLATE)}><Plus size={13} /> 仕様書のひな形を作る</button>}
          {docs[1]!.has && docs[2]!.has && <p className="muted small">台本と仕様書があります。既存の資料を使うかは依頼ごとに選べます。</p>}
        </div>
      </details>
    </section>

    <section>
      <h3>今回の依頼</h3>
      <p className="muted small">相談・案出し・特定の場面からの作業など、今回やりたいことをそのまま書いてください。カードを作らなくても使えます。既存データの変更は、分かれば対象ID（例: dialogue:elder）も書くと現在の内容を添えられます。</p>
      <textarea className="chat-answer" rows={4} value={directRequest} placeholder="今回頼みたいこと、作り方や相談の希望を書く" onChange={e => setDirectRequest(e.target.value)} />
      <details>
        <summary>この依頼で参照する資料を選ぶ（任意）</summary>
        <p className="muted small">IDEA.md だけ初期選択されます。ほかの標準資料や任意の資料・既存コードは必要なものだけ選べます。長い資料は一部を省略します。選んだ内容は依頼文に入り、変更対象ではなく参考資料として扱われます。</p>
        <div className="chat-context-list">
          {docs.map(({ file, has }) => {
            const selected = selectedReferenceFiles.includes(file);
            return <label key={file} className="chat-context-item"><input type="checkbox" checked={selected} disabled={!has} onChange={event => setReferenceFiles(current => event.target.checked ? [...current, file] : current.filter(path => path !== file))} /><code>{file}</code>{!has && <span className="muted">（なし）</span>}</label>;
          })}
          {availableReferenceFiles.map(file => {
            const selected = selectedReferenceFiles.includes(file);
            return <label key={file} className="chat-context-item"><input type="checkbox" checked={selected} onChange={event => setReferenceFiles(current => event.target.checked ? [...current, file] : current.filter(path => path !== file))} /><code>{file}</code></label>;
          })}
        </div>
        {!availableReferenceFiles.length && <p className="muted small">追加できる資料ファイルはありません。</p>}
      </details>
      <div className="row"><button disabled={!directRequest.trim()} onClick={() => void copy("direct", directPack(store.texts, directRequest, selectedReferenceFiles))}><ClipboardCopy size={13} /> {copied === "direct" ? "コピーしました" : "直接依頼文をコピー"}</button><span className="muted small">参考資料 {selectedReferenceFiles.length}件</span></div>
      <details>
        <summary>作業カードを使いたい場合（任意）</summary>
        {error && <p className="error-text">{error}</p>}
        <p className="muted small">複数の作業を整理したいときに使えます。希望する順序や大きさに合わせ、必要なカードだけを作ります。</p>
        <div className="row"><button onClick={() => void copy("plan", planPack(store.texts))}><ClipboardCopy size={13} /> {copied === "plan" ? "コピーしました" : "カードを作ってもらう依頼文をコピー"}</button></div>
        <details>
          <summary>自分でカードを足す</summary>
          <div className="form-grid">
            <label>ID<input value={draft.id} placeholder="entry-scene" onChange={e => setDraft({ ...draft, id: e.target.value })} /></label>
            <label>名前<input value={draft.title} placeholder="今回進めたいところ" onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
            <label>やりたいこと<textarea rows={2} value={draft.goal} onChange={e => setDraft({ ...draft, goal: e.target.value })} /></label>
            <label>ひも付け<input value={draft.links} placeholder="対象データがあれば種類:ID（空欄でも可）" onChange={e => setDraft({ ...draft, links: e.target.value })} /></label>
            <label>自動テスト名<input value={draft.test} placeholder="entry-scene（tests/entry-scene.scenario.json）" onChange={e => setDraft({ ...draft, test: e.target.value })} /></label>
            <label>人が確かめること<input value={draft.check} onChange={e => setDraft({ ...draft, check: e.target.value })} /></label>
          </div>
          <p className="muted small">ひも付けは任意です。定型データを使わない独自の仕組みは無理に当てはめず、ローカルAIで実装方法を相談してください。種類: {Object.entries(LINK_KINDS).map(([k, v]) => `${k}（${v}）`).join("、")}</p>
          <button onClick={addCard}><Plus size={13} /> カードを足す</button>
        </details>
      </details>
      {bundle.cards.length > 0 && <details open>
        <summary>保存済みの作業カード（{done}/{bundle.cards.length}枚できた）</summary>
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
      </details>}
    </section>

    <section>
      <h3>AIの返事を取り込む場合</h3>
      <textarea className="chat-answer" rows={8} value={answer} placeholder="AIの返事をまるごと貼り付けてください（```rpg-change のブロックを工房が探します）" onChange={e => { setAnswer(e.target.value); setChecked(null); setReviewed(false); }} />
      <div className="row"><button disabled={!answer.trim()} onClick={check}>確かめる（検証と自動テスト）</button></div>
      {checked && <div className="chat-result">
        {checked.notes.length > 0 && <ul>{checked.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        {checked.summary.length > 0 && <details><summary>変わる所（{checked.summary.length}）</summary><ul className="small">{checked.summary.map((n, i) => <li key={i}>{n}</li>)}</ul></details>}
        {checked.set && <div className="chat-assumption-review">
          <b>AIが補った前提</b>
          {checked.set.assumptions === undefined
            ? <p className="text-amber small">返答に前提欄がありません。前提なしとは限らないため、差分を読んでから確認してください。</p>
            : checked.set.assumptions.length
              ? <ul>{checked.set.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul>
              : <p className="muted small">AIは追加前提なしと申告しています。</p>}
          <b>未決のこと</b>
          {checked.set.unresolved === undefined
            ? <p className="text-amber small">返答に未決事項欄がありません。発想や仕様にない判断が残っていないか確認してください。</p>
            : checked.set.unresolved.length
              ? <ul>{checked.set.unresolved.map((item, index) => <li key={index}>{item}</li>)}</ul>
              : <p className="muted small">AIは未決事項なしと申告しています。</p>}
          {needsExplicitReview && <label className="chat-review-check">
            <input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />
            <span>AIの補完・未決事項・変更差分を確認しました</span>
          </label>}
        </div>}
        {checked.problems.length
          ? <>
            <p className="error-text"><XCircle size={14} /> 取り込めません（{checked.problems.length}件）。下のボタンでコピーしてAIに貼り戻してください。</p>
            <ul className="small">{checked.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            <button onClick={() => void copy("fix", fixPack(store.texts, checked.set, checked.problems))}><ClipboardCopy size={13} /> {copied === "fix" ? "コピーしました" : "直してほしい点をコピー"}</button>
          </>
          : checked.changed.length
            ? <><p className="ok-text"><CheckCircle2 size={14} /> 検証と自動テストを通りました（{checked.changed.length}ファイル）。</p><button disabled={needsExplicitReview && !reviewed} onClick={take}>{needsExplicitReview ? "前提を確認して取り込む" : "取り込む"}</button></>
            : <p className="muted">変わる所はありませんでした。</p>}
      </div>}
    </section>
  </div>;
}

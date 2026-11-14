import { useState } from "react";
import { CheckCircle2, ClipboardCopy, FlaskConical, Hammer, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { formatDiagnostic, type Diagnostic } from "@rpg/schema";
import type { TestResponse } from "../../../packages/local-server/src/protocol";
import type { ProjectStore } from "../lib/useProject";

interface Props {
  store: ProjectStore;
  diagnostics: Diagnostic[];
  onOpenFile: (file: string) => void;
}

const PRESETS: Array<{ label: string; task: string }> = [
  { label: "種族を追加", task: "次の種族を特性(traits)として追加して。各効果は docs/customization-guide.md のレシピ（statMods・rules・use）で実装し、データで書けないものは一覧にして相談して。\n\n種族名：\n説明：\n効果1：\n効果2：" },
  { label: "仕様書から効果を実装", task: "添付の仕様書の効果を、1種族ずつ database.json の traits / abilities と rules に実装して。仕様にない効果は推測で作らず、表現できない効果はリストアップして。各効果に tests/*.scenario.json の動作確認を付けて。" },
  { label: "仕組みを追加", task: "次の仕組みをフラグ・変数・rules.json のルールで追加して（例：昼夜、好感度、評判、空腹度）。\n\n仕組み：" },
  { label: "発想をそのまま形にする", task: "IDEA.md（なければ下の発想）を、docs/idea-to-game.md の約束どおりに形にして。発想の核を削ったり、よくある形に置き換えたりしないこと。データ・動詞・シグナル・ジャンルモジュールで足りなければ systems/*.ts、それでも足りなければエンジンを広げてよい。まず10分で遊べる最小の形を作り、核の動きを tests/*.scenario.json で確かめて。好みの問題だけ質問し、決めたことは IDEA.md に追記して。\n\n発想：" },
  { label: "ジャンルを混ぜる", task: "次の場面を、組み込みジャンルモジュール（docs/genre-modules.md: novel / puzzle / shooter / planner / cards）を使って作って。RPGの能力値・アイテム・フラグと結果がつながるようにし、合うモジュールがなければ新しいジャンルモジュールを systems/*.ts の defineSystem（scenes・realtime・draw・checkArgs）で作って。\n\n場面：\nジャンル：\n勝ち・成功したとき：\n負け・失敗したとき：" },
  { label: "マップとイベント", task: "村の東に小さな湖を作り、釣り人のNPCが『魚の鱗』をくれるイベントを追加して" },
];

function agentPrompt(task: string, projectDir: string) {
  return `${task.trim() || "（ここにやりたいことを書く）"}

作業ルール:
- まず AGENTS.md（Claude Codeは CLAUDE.md）と docs/customization-guide.md・docs/project-format.md を読む。
- pnpm rpg catalog --project ${projectDir} で既存のID・フラグ・変数・特性を確認する。
- 対象プロジェクト: ${projectDir}
- 種族・効果・仕組みはデータ（特性・能力・ルール・効果・条件・式）で作る。ノベル・パズル・弾幕・育成・カードなどの場面は組み込みジャンルモジュール（docs/genre-modules.md）を使う。表現できないものだけ systems/*.ts の defineSystem で実装する。
- 新しいフラグ・変数は project.json の flags / variables に宣言する。素材は assets.json に出典・寸法つきで登録する。
- 変更を確かめる自動プレイテストを tests/*.scenario.json に追加する。
- 最後に次を実行し、すべて OK になるまで直す:
  pnpm rpg validate --project ${projectDir}
  pnpm rpg test --project ${projectDir}
  pnpm rpg build --project ${projectDir}
  git diff --check`;
}

export default function ChecksPanel({ store, diagnostics, onOpenFile }: Props) {
  const [tests, setTests] = useState<TestResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [task, setTask] = useState(PRESETS[0]!.task);
  const [copied, setCopied] = useState(false);
  const errors = diagnostics.filter(d => d.severity === "error");
  const warnings = diagnostics.filter(d => d.severity === "warning");
  const build = store.build;
  const projectDir = store.source.kind === "local" ? "<このプロジェクトのフォルダ>" : "projects/sample-rpg";

  const runTests = async () => {
    if (!store.source.runTests) return;
    setRunning(true);
    try {
      const result = await store.source.runTests();
      setTests(result);
      store.log(result.ok ? "ok" : "error", `自動プレイテスト: ${result.results.filter(r => r.ok).length}/${result.results.length} 成功`);
    } catch (error) {
      store.log("error", `テストを実行できません: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setRunning(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(agentPrompt(task, projectDir)); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    catch { store.log("warn", "クリップボードを使えません。文章を選択してコピーしてください"); }
  };

  return <div className="checks-panel">
    <section className="card">
      <header><h3>データ検証</h3>{errors.length ? <span className="badge error"><XCircle size={12} /> エラー {errors.length}</span> : <span className="badge ok"><CheckCircle2 size={12} /> 正常</span>}{warnings.length > 0 && <span className="badge warn">警告 {warnings.length}</span>}</header>
      <p className="muted small">スキーマ、ID参照、フラグ宣言、座標、タイルコードを、変更のたびに全ファイル横断で確認します（CLIの <code>rpg validate</code> と同じ処理）。</p>
      {diagnostics.length === 0 ? <p className="text-green">問題は見つかりませんでした。</p>
        : <ul className="diag-list">{diagnostics.map((d, i) => <li key={i} className={d.severity}><button className="link" onClick={() => d.file && onOpenFile(d.file)}>{formatDiagnostic(d)}</button></li>)}</ul>}
    </section>

    <section className="card">
      <header><h3>ビルド</h3>
        {store.source.kind === "preview" ? <span className="badge">Preview</span>
          : build?.state === "building" ? <span className="badge"><Loader2 size={12} className="spin" /> ビルド中</span>
          : build?.state === "ready" ? <span className="badge ok">正常 {build.version}</span>
          : build?.state === "error" ? <span className="badge error">失敗{build.version ? `（試遊は ${build.version}）` : ""}</span>
          : <span className="badge">待機</span>}
        <span className="spacer" />
        <button className="button" onClick={() => void store.requestBuild()} disabled={store.source.kind === "preview"}><Hammer size={14} /> 再ビルド</button>
      </header>
      <p className="muted small">型検査 → bundle → 静的ゲーム出力（dist/game/&lt;id&gt;/）。失敗しても直前の正常版は残り、試遊はそれを使い続けます。CLI: <code>pnpm rpg build</code></p>
      {build?.diagnostics.length ? <ul className="diag-list">{build.diagnostics.map((line, i) => <li key={i} className={line.startsWith("WARN") ? "warning" : "error"}>{line}</li>)}</ul> : null}
      {store.source.kind === "preview" && <p className="muted small">Previewでは利用者PCのファイルやビルドにアクセスできません。PCで <code>pnpm studio</code> を起動すると、ファイル保存・監視・ビルド・テストが有効になります。</p>}
    </section>

    <section className="card">
      <header><h3>自動プレイテスト</h3><span className="spacer" /><button className="button" onClick={() => void runTests()} disabled={!store.source.runTests || running}>{running ? <Loader2 size={14} className="spin" /> : <FlaskConical size={14} />} 実行</button></header>
      <p className="muted small"><code>tests/*.scenario.json</code> の手順（歩く・話す・選ぶ・戦う）をエンジンで自動実行し、フラグや所持品を確かめます。CLI: <code>pnpm rpg test</code></p>
      {tests && <ul className="test-list">
        {tests.diagnostics.filter(d => d.startsWith("ERROR")).map((d, i) => <li key={`d${i}`} className="error"><XCircle size={13} /> {d}</li>)}
        {tests.results.map(r => <li key={r.file} className={r.ok ? "ok" : "error"}>
          {r.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
          <div><b>{r.name}</b> <span className="muted small">{r.file} · {r.steps} steps</span>{!r.ok && <div className="small">steps[{r.failedStep}]: {r.message}</div>}</div>
        </li>)}
      </ul>}
    </section>

    <section className="card">
      <header><h3>Codex／Claude Codeへの依頼文</h3></header>
      <p className="muted small">工房はAIを内蔵しません。普段のCodex／Claude Codeにこの文章を渡すと、リポジトリの規約と検証手順に沿って作業します。<AlertTriangle size={11} /> 同じファイルを工房とエージェントで同時に編集しないでください（保存前に画面を閉じるか、エージェント作業後に再読込）。</p>
      <div className="chips">{PRESETS.map(p => <button key={p.label} className={`chip ${task === p.task ? "is-on" : ""}`} onClick={() => setTask(p.task)}>{p.label}</button>)}</div>
      <textarea className="task-input" rows={5} value={task} onChange={e => setTask(e.target.value)} />
      <pre className="prompt-preview">{agentPrompt(task, projectDir)}</pre>
      <button className="button primary" onClick={() => void copy()}><ClipboardCopy size={14} /> {copied ? "コピーしました" : "依頼文をコピー"}</button>
    </section>
  </div>;
}

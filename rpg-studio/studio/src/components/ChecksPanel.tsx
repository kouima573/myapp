import { useState } from "react";
import { CheckCircle2, ClipboardCopy, FlaskConical, Hammer, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { formatDiagnostic, type Diagnostic } from "@rpg/schema";
import type { TestResponse } from "../../../packages/local-server/src/protocol";
import type { ProjectStore } from "../lib/useProject";
import type { GameState } from "@rpg/schema";
import { createEngine } from "../../../packages/engine/src/game";
import { runScenario, ScenarioSchema, simulateBattleBalance, type BattleBalanceResult } from "../../../packages/engine/src/scenario";
import { withModules } from "../../../packages/modules/src/index";

interface Props {
  store: ProjectStore;
  diagnostics: Diagnostic[];
  onOpenFile: (file: string) => void;
  /** Open the play-test at this game state (the step where a scenario test failed). */
  onPlayState?: (state: GameState) => void;
}

const PRESETS: Array<{ label: string; task: string }> = [
  { label: "発想をそのまま形にする", task: "作り手の制作段階・ゲーム内の開始地点・作り方の希望を尊重し、今回の依頼で必要な資料だけを参照して、指定された範囲を進めて。依頼にない資料の要約・仕様書・作業カード・試作品などの準備工程は挟まないで。既存の設定・プロット・場面・試作品・既存プロジェクトからも始められます。新規プロジェクトが必要な場合だけ技術的な土台を作って。IDEA.md は現在の意図を記録した資料なので、今回の明示的な依頼が古い記述と違う場合は今回の依頼を優先して。発想の核を保ち、頼まれていないプロローグ・チュートリアル・最小の遊べる形を足さないで。未決の内容は勝手に決めず、体験や成果が変わる場合だけ確認して。案出し・相談・レビューを頼まれたときは、そこで止めて実装しないで。\n\n発想・今回の依頼・進め方の希望：" },
  { label: "初心者：おまかせで村を作る", task: "今のプロジェクトに、最初の村の会話イベントと、森で戦える弱い敵を1種類追加して、すぐ遊べるようにして。専門用語は使わずに変更内容を教えて。" },
  { label: "初心者：難易度をやさしく", task: "最初の戦闘で負けにくいように、主人公の初期HPを少し上げて、回復アイテムを2個持った状態で始まるように調整して。" },
  { label: "種族を追加", task: "次の種族を特性(traits)として追加して。各効果は docs/customization-guide.md のレシピ（statMods・rules・use）で実装し、データで書けないものは一覧にして相談して。\n\n種族名：\n説明：\n効果1：\n効果2：" },
  { label: "仕様書から効果を実装", task: "添付の仕様書の効果を、1種族ずつ database.json の traits / abilities と rules に実装して。仕様にない効果は推測で作らず、表現できない効果はリストアップして。各効果に tests/*.scenario.json の動作確認を付けて。" },
  { label: "仕組みを追加", task: "次の仕組みをフラグ・変数・rules.json のルールで追加して（例：昼夜、好感度、評判、空腹度）。\n\n仕組み：" },
  { label: "ジャンルを混ぜる", task: "次の場面を、組み込みジャンルモジュール（docs/genre-modules.md: 全26種。pnpm rpg genres で一覧）と、ジャンル地図（pnpm rpg genres --query <ジャンル名>）のレシピを使って作って。RPGの能力値・アイテム・フラグと結果がつながるようにし、合うモジュールがなければ新しいジャンルモジュールを systems/*.ts の defineSystem（scenes・realtime・draw・checkArgs）で作って。\n\n場面：\nジャンル：\n勝ち・成功したとき：\n負け・失敗したとき：" },
  { label: "マップとイベント", task: "村の東に小さな湖を作り、釣り人のNPCが『魚の鱗』をくれるイベントを追加して" },
];

function agentPrompt(task: string, projectDir: string) {
  return `${task.trim() || "（ここにやりたいことを書く）"}

作業ルール:
- 作り手が指定した進め方・作業順・粒度・今回の到達点を守る。案出し・相談・レビューだけの依頼なら、実装やファイル変更に進まない。
- 実装する場合は AGENTS.md（Claude Codeは CLAUDE.md）と、変更に関係する資料（必要に応じ docs/customization-guide.md・docs/project-format.md）を読む。
- 既存データを変更する場合は、必要に応じて pnpm rpg catalog --project ${projectDir} でID・フラグ・変数・特性を確認する。
- 対象プロジェクト: ${projectDir}
- 実装方法も作り手の希望に合わせる。種族・効果・仕組みはデータ（特性・能力・ルール・効果・条件・式）で作れるが、これを全ての発想に押しつけない。ノベル・パズル・弾幕・育成・カードなども、依頼とゲームの形式に合う場合だけ組み込みジャンルモジュール（docs/genre-modules.md）を使う。コードが必要なら特定の技・アイテム・敵・マップなどは scripts/<名前>.ts（defineScript、データの "script" で付ける。docs/scripting.md）、全体の仕組みは systems/*.ts の defineSystem。
- 新しいフラグ・変数は project.json の flags / variables に宣言する。素材は assets.json に出典・寸法つきで登録する。
- ゲームの挙動を変えた場合は、それを確かめる自動プレイテストを tests/*.scenario.json に追加する。文章の相談・レビューなど挙動を変えない作業には不要。
- 確認方法は変更内容と作り手が指定した到達点に合わせる。ゲームの実装変更なら必要な validate / test を行い、配布物が対象または依頼されたときに build する。依頼された段階を越えて一律のテストやビルドを足さない。実行した確認と未実施のものを報告する。`;
}

export default function ChecksPanel({ store, diagnostics, onOpenFile, onPlayState }: Props) {
  const [tests, setTests] = useState<TestResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [task, setTask] = useState(PRESETS[0]!.task);
  const [startEvent, setStartEvent] = useState("");
  const [copied, setCopied] = useState(false);
  const [balanceEnemy, setBalanceEnemy] = useState("");
  const [balanceLevel, setBalanceLevel] = useState(1);
  const [balanceRuns, setBalanceRuns] = useState(20);
  const [balanceResult, setBalanceResult] = useState<BattleBalanceResult | null>(null);
  const [balanceRunning, setBalanceRunning] = useState(false);
  const errors = diagnostics.filter(d => d.severity === "error");
  const warnings = diagnostics.filter(d => d.severity === "warning");
  const build = store.build;
  const content = store.content ?? store.lastGoodContent;
  const balanceEnemies = content?.database.enemies.filter(enemy => !enemy.battle?.mode) ?? [];
  const balanceEnemyId = balanceEnemies.some(enemy => enemy.id === balanceEnemy) ? balanceEnemy : balanceEnemies[0]?.id ?? "";
  const externalAssets = content?.assets.assets.filter(a => a.origin === "site" || a.origin === "purchased") ?? [];
  const missingTerms = externalAssets.filter(a => !a.termsCheckedAt);
  const missingCredits = (content?.assets.assets ?? []).filter(a => a.creditRequired && !a.credit);
  const publishNeedsReview = Boolean(errors.length || build?.state !== "ready" || missingTerms.length || missingCredits.length || !tests?.ok);
  const projectDir = store.source.kind === "local" ? "<このプロジェクトのフォルダ>" : "projects/sample-rpg";

  /** Re-run a failed scenario here in the browser and open the play-test where it stopped (168). */
  const replay = (file: string) => {
    const content = store.content ?? store.lastGoodContent;
    const text = store.texts[file];
    if (!content || !text || !onPlayState) return;
    try {
      const scenario = ScenarioSchema.parse(JSON.parse(text));
      const result = runScenario(content, withModules(content, store.systems), scenario);
      if (!result.state) { store.log("warn", "再現できませんでした"); return; }
      store.log("info", `${file} を steps[${result.failedStep ?? scenario.steps.length}] の手前まで再生し、試遊で開きました${result.message ? `（${result.message}）` : ""}`);
      onPlayState(result.state);
    } catch (error) {
      store.log("error", `再現できません: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
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

  const playFromEvent = () => {
    if (!content || !startEvent || !onPlayState) return;
    try {
      const engine = createEngine(content, withModules(content, store.systems));
      const result = engine.run(engine.newGame(), [{ type: "event", event: startEvent }]);
      onPlayState(result.state);
      store.log("info", `イベント「${content.events[startEvent]?.label ?? startEvent}」から試遊を開始しました`);
    } catch (error) { store.log("error", `イベントから試遊できません: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const runBalance = async () => {
    if (!content || !balanceEnemyId || balanceRunning) return;
    setBalanceRunning(true);
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
    try {
      const result = simulateBattleBalance(content, withModules(content, store.systems), balanceEnemyId, balanceLevel, balanceRuns);
      setBalanceResult(result);
      store.log("info", `戦闘バランス試算: ${content.database.enemies.find(enemy => enemy.id === balanceEnemyId)?.name ?? balanceEnemyId} Lv${result.level}、${result.completed}回完了、勝率 ${result.winRate === null ? "算出できず" : `${Math.round(result.winRate * 100)}%`}`);
    } catch (error) { store.log("error", `戦闘バランスを試算できません: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBalanceRunning(false); }
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
        : <>
          <ul className="diag-list">{diagnostics.map((d, i) => <li key={i} className={d.severity}><button className="link" onClick={() => d.file && onOpenFile(d.file)}>{formatDiagnostic(d)}</button></li>)}</ul>
          {errors.length > 0 && <button className="button" onClick={() => {
            const list = errors.slice(0, 10).map(e => `- ${formatDiagnostic(e)}`).join("\n");
            setTask(`次の検証エラーが出てゲームが動かなくなりました。原因をやさしい言葉で説明し、直してください:\n\n${list}`);
            store.log("info", "下の「Codex／Claude Codeへの依頼文」欄にエラー修正用プロンプトをセットしました");
          }}><ClipboardCopy size={13} /> このエラーをAIに直してもらう依頼文をセット</button>}
        </>}
    </section>

    <section className="card">
      <header><h3>公開前の確認</h3><span className="spacer" /><span className={`badge ${publishNeedsReview ? "warn" : "ok"}`}>{publishNeedsReview ? "確認が必要" : "主な項目はOK"}</span></header>
      <ul className="diag-list">
        <li className={errors.length ? "error" : "ok"}>{errors.length ? `検証エラー ${errors.length}件を解消` : "データ検証にエラーなし"}{warnings.length ? `（警告 ${warnings.length}件は内容を確認）` : ""}</li>
        <li className={build?.state === "ready" ? "ok" : "warning"}>{build?.state === "ready" ? "配布用ビルドが作成済み" : "最新データの配布用ビルドを作成"}</li>
        <li className={missingTerms.length ? "warning" : "ok"}>{missingTerms.length ? `利用条件の確認日がない外部素材 ${missingTerms.length}件` : "外部素材の利用条件を確認済み"}</li>
        <li className={missingCredits.length ? "warning" : "ok"}>{missingCredits.length ? `クレジット文が未設定の必須素材 ${missingCredits.length}件` : "必須クレジット文を設定済み"}</li>
        <li className={!tests ? "warning" : tests.ok ? "ok" : "error"}>{!tests ? "自動プレイテストを実行して結果を確認" : tests.ok ? "自動プレイテスト成功" : `自動プレイテスト失敗（${tests.results.filter(r => !r.ok).length}件）`}</li>
      </ul>
      <p className="muted small">公開先の規約・素材ごとの条件も別に確認してください。CLI: <code>pnpm rpg audit --project &lt;dir&gt;</code></p>
    </section>

    {onPlayState && content && Object.keys(content.events).length > 0 && <section className="card">
      <header><h3>イベントから試遊</h3></header>
      <p className="muted small">新しいゲームを始め、そのイベントを実行した状態で試遊を開きます。</p>
      <div className="form-row"><select value={startEvent} onChange={e => setStartEvent(e.target.value)}><option value="">イベントを選ぶ</option>{Object.entries(content.events).map(([id, event]) => <option key={id} value={id}>{event.label}（{id}）</option>)}</select><button className="button" disabled={!startEvent} onClick={playFromEvent}>ここから試遊</button></div>
    </section>}

    <section className="card">
      <header><h3>戦闘バランス試算</h3><span className="spacer" /><button className="button" onClick={() => void runBalance()} disabled={!balanceEnemyId || balanceRunning}>{balanceRunning ? <Loader2 size={14} className="spin" /> : <FlaskConical size={14} />} {balanceRunning ? "試算中" : "複数回試す"}</button></header>
      <p className="muted small">敵を選び、レベルと乱数シードを変えて自動戦闘します。開始時の選択肢は最初の項目を使います。簡易AIによる目安なので、技・装備・仲間・プレイヤーの判断で結果は変わります。</p>
      <div className="form-row balance-controls">
        <label>敵<select value={balanceEnemyId} onChange={event => { setBalanceEnemy(event.target.value); setBalanceResult(null); }} disabled={!balanceEnemies.length}>{balanceEnemies.map(enemy => <option key={enemy.id} value={enemy.id}>{enemy.name}（{enemy.id}）</option>)}</select></label>
        <label>主人公Lv<input type="number" min={1} max={content?.project.leveling?.maxLevel ?? 1} value={balanceLevel} disabled={!content?.project.leveling} onChange={event => { setBalanceLevel(Math.max(1, Number(event.target.value) || 1)); setBalanceResult(null); }} /></label>
        <label>試行回数<select value={balanceRuns} onChange={event => { setBalanceRuns(Number(event.target.value)); setBalanceResult(null); }}><option value={10}>10回</option><option value={20}>20回</option><option value={50}>50回</option></select></label>
      </div>
      {!balanceEnemies.length && <p className="muted small">試算できる標準戦闘の敵がありません（独自モードの敵は対象外です）。</p>}
      {balanceResult && <div className="balance-result">
        <div><b>勝率</b><strong>{balanceResult.winRate === null ? "—" : `${Math.round(balanceResult.winRate * 100)}%`}</strong><span className="muted small">{balanceResult.wins}勝 / {balanceResult.defeats}敗・完了 {balanceResult.completed}回</span></div>
        <div><b>勝利時の平均</b><strong>{balanceResult.averageTurnsOnWin === null ? "—" : `${balanceResult.averageTurnsOnWin.toFixed(1)}ターン`}</strong><span className="muted small">残HP {balanceResult.averageHpPercentOnWin === null ? "—" : `${Math.round(balanceResult.averageHpPercentOnWin)}%`}</span></div>
        <div><b>回復アイテム</b><strong>{balanceResult.averageHealingItemsUsed === null ? "—" : `${balanceResult.averageHealingItemsUsed.toFixed(1)}個`}</strong><span className="muted small">完了した戦闘あたり</span></div>
        {(balanceResult.timeouts > 0 || balanceResult.unsupported > 0) && <p className="muted small">時間切れ {balanceResult.timeouts}回・対象外 {balanceResult.unsupported}回。独自戦闘モードや開始時の選択によっては試算できません。</p>}
      </div>}
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
          <div><b>{r.name}</b> <span className="muted small">{r.file} · {r.steps} steps</span>{!r.ok && <div className="small">steps[{r.failedStep}]: {r.message}</div>}
            {!r.ok && onPlayState && <div className="form-row"><button className="button" onClick={() => replay(r.file)}>失敗した場面を試遊で見る</button><button className="button" onClick={() => onOpenFile(r.file)}>テストを開く</button></div>}</div>
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

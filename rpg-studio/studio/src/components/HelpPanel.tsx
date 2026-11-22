import { useMemo, useState } from "react";
import { BookOpen, CheckCircle2, ClipboardCopy, Circle, Smartphone, Wrench } from "lucide-react";
import type { Effect, GameContent } from "@rpg/schema";
import { walkEffects } from "@rpg/schema";
import { proofreadText } from "../../../packages/cli/src/proofreadText";
import { unreachableMaps } from "../lib/world";
import { GLOSSARY } from "../lib/glossary";
import type { ProjectStore } from "../lib/useProject";

/** ヘルプ: 用語集 (010)・完成までのチェックリスト (011)・よくある失敗 (014)・スマホで遊ぶ／見る (017)・見本を元に戻す (020). */
type Tab = "check" | "faq" | "words" | "mobile";

const FAQ: Array<{ q: string; a: string }> = [
  { q: "人に話しかけても何も起きない", a: "マップでその人をクリックし、右の詳細で「会話」が選ばれているか確認。条件（when）が付いていると、成り立つまで話しません。検証画面にエラーが出ていないかも見てください。" },
  { q: "出入口を踏んでも移動しない", a: "出入口の行き先マップと座標（targetX / targetY）が歩けるマスか確認。行き先が壁だと止まります。「ワールド全体図」でつながりを確認できます。" },
  { q: "フラグを立てたのに反応しない", a: "フラグ名の書き間違いが一番多い原因です（検証で「未宣言のフラグ」と出ます）。project.json の flags に宣言し、同じ名前を使ってください。「pnpm rpg refs <名前>」でどこで使われているか探せます。" },
  { q: "宝箱が何度でも開けられる", a: "イベントの「一度だけ」をオンに。2回目以降に出す文は「2回目以降」に書きます。" },
  { q: "敵が強すぎる／弱すぎる", a: "「試遊」の右の変数・能力値で数字を変えて試し、良い値を敵のデータに。練習試合（battle の practice）を使うと負けても損しません。" },
  { q: "画面が真っ白・ビルド失敗", a: "上の「ビルド」表示を押して、検証画面のエラーを上から直します。直前の正常版で試遊は続けられます。直せないときは「保存履歴」で前に戻せます。" },
  { q: "AIに頼んだら壊れた", a: "「保存履歴」に AI の書き換えが言葉で残っています。「この変更の前に戻す」で戻せます。頼むときは「発想」画面の依頼文（作業ルールつき）を使うと安全です。" },
  { q: "画像が表示されない", a: "assets.json に登録されているか、ファイル名・大きさ（tileWidth など）が合っているか確認。「素材」画面で一覧できます。" },
  { q: "音が鳴らない", a: "ブラウザは画面をクリックするまで音を出しません。一度クリックしてから試してください。メニューの BGM／効果音の音量も確認。" },
  { q: "見本を壊してしまった", a: "下の「見本を元に戻す」を参照してください。工房での変更は「保存履歴」からも戻せます。" },
];

export default function HelpPanel({ store, content }: { store: ProjectStore; content: GameContent }) {
  const [tab, setTab] = useState<Tab>("check");
  const checks = useMemo(() => {
    const effects: Effect[] = [...content.project.intro, ...Object.values(content.events).flatMap(e => [...e.effects, ...e.otherwise, ...e.afterDone]), ...Object.values(content.dialogues).flatMap(d => [...d.effects, ...d.choices.flatMap(c => c.effects)])];
    const all: Effect[] = [];
    walkEffects(effects, e => all.push(e));
    const usesItemHeal = content.database.items.some(i => i.heal || i.use?.effects.some(e => e.type === "heal"));
    const texts = [...Object.values(content.dialogues).flatMap(d => d.lines.map(l => (typeof l === "string" ? l : l.text))), ...all.flatMap(e => (e.type === "message" ? [e.text] : []))];
    const textIssues = texts.filter(t => proofreadText(t, { width: 40, lines: 3, message: true }).length).length;
    const errors = store.diagnostics.filter(d => d.severity === "error").length;
    const tests = Object.keys(store.texts).filter(f => f.startsWith("tests/") && f.endsWith(".json")).length;
    const lonely = unreachableMaps(content);
    return [
      { ok: errors === 0, title: "検証エラーがない", hint: errors ? `${errors}件のエラー。「検証」画面で上から直す` : "" },
      { ok: Boolean(content.project.titleScreen.subtitle), title: "タイトル画面のひと言（サブタイトル）", hint: "project.json › titleScreen.subtitle に、どんなゲームかを一行で" },
      { ok: content.project.intro.some(e => e.type === "message"), title: "始めに目的が分かる", hint: "project.json › intro に、最初に何をすればいいかのメッセージ" },
      { ok: content.project.maps.length >= 3 && !lonely.length, title: "マップが3つ以上あり、全部に行ける", hint: lonely.length ? `行けないマップ: ${lonely.join("・")}（ワールド全体図で確認）` : `いま ${content.project.maps.length} マップ` },
      { ok: content.database.enemies.filter(e => !e.battle).length >= 3, title: "戦える敵が3種類以上", hint: "「敵・アイテム・仲間」で追加" },
      { ok: usesItemHeal || all.some(e => e.type === "heal" || (e.type === "startScene" && e.scene === "inn")), title: "回復する手段がある", hint: "回復アイテム、宿屋（shop モジュールの inn）、回復の技など" },
      { ok: Object.keys(content.project.endings).length > 0 || all.some(e => e.type === "ending"), title: "エンディングがある", hint: "project.json › endings と効果 ending" },
      { ok: tests >= 3, title: "自動テストが3つ以上", hint: `いま ${tests} 個。「試遊」の「録画してテストを作る」で簡単に作れます` },
      { ok: textIssues === 0, title: "台詞がウィンドウに収まり、誤字らしき所がない", hint: textIssues ? `${textIssues}か所（pnpm rpg proofread で場所が分かります）` : "" },
      { ok: content.assets.assets.every(a => a.license), title: "素材の出どころ・ライセンスが全部ある", hint: "assets.json の license・source" },
      { ok: store.build?.state === "ready", title: "ビルドできる", hint: "ローカル版の上の「ビルド」表示が OK" },
    ];
  }, [content, store.diagnostics, store.texts, store.build]);
  const done = checks.filter(c => c.ok).length;
  const ask = `次の「完成までのチェックリスト」でまだの項目を、AGENTS.md の作業ルールどおりに片づけて。\n${checks.filter(c => !c.ok).map(c => `- ${c.title}（${c.hint}）`).join("\n")}\n終わったら pnpm rpg validate / test / proofread / build がすべて OK になるまで直して。`;

  return <div className="panel-page help-panel">
    <div className="row">
      {([["check", CheckCircle2, "完成までのチェック"], ["faq", Wrench, "よくある失敗"], ["words", BookOpen, "用語集"], ["mobile", Smartphone, "スマホで遊ぶ・見る"]] as const).map(([id, Icon, label]) =>
        <button key={id} className={`chip ${tab === id ? "is-on" : ""}`} onClick={() => setTab(id)}><Icon size={13} /> {label}</button>)}
    </div>
    {tab === "check" && <>
      <h2>完成までのチェックリスト（{done} / {checks.length}）</h2>
      <div className="tutorial-progress"><div style={{ width: `${(done / checks.length) * 100}%` }} /></div>
      <ol className="tutorial-steps">{checks.map((c, i) => <li key={i} className={c.ok ? "is-done" : ""}>{c.ok ? <CheckCircle2 size={16} /> : <Circle size={16} />}<div><b>{c.title}</b>{c.hint && !c.ok && <div className="small muted">{c.hint}</div>}</div></li>)}</ol>
      {done < checks.length && <button className="button" onClick={() => { void navigator.clipboard?.writeText(ask); store.log("ok", "残りをAIに頼む依頼文をコピーしました（Codex／Claude Code に貼り付け）"); }}><ClipboardCopy size={13} /> 残りをAIに頼む依頼文をコピー</button>}
    </>}
    {tab === "faq" && <>
      <h2>よくある失敗と直し方</h2>
      {FAQ.map((f, i) => <details key={i} className="faq"><summary>{f.q}</summary><p>{f.a}</p></details>)}
      <h3>見本を元に戻す</h3>
      <p className="small">工房で変えた分は「保存履歴」→「この工房での操作」で戻せます。ファイルごと最初の状態に戻すには、ターミナルで次を実行します（見本のフォルダだけが元に戻ります）。</p>
      <pre className="prompt-preview">pnpm rpg sample reset --project {store.projectInfo.projectDir}</pre>
    </>}
    {tab === "words" && <>
      <h2>用語集</h2>
      <p className="muted small">工房の見出しにマウスを乗せても、同じ説明が出ます。</p>
      <dl className="glossary">{GLOSSARY.map(g => <div key={g.term}><dt>{g.term}{g.also ? <span className="muted small">（{g.also.join("・")}）</span> : null}</dt><dd>{g.text}</dd></div>)}</dl>
    </>}
    {tab === "mobile" && <>
      <h2>スマホ・タブレットで</h2>
      <ul>
        <li><b>遊ぶ</b>: 作ったゲームを Web に置けば（<code>pnpm deploy:site</code> や itch.io）スマホのブラウザで遊べます。画面下にタッチ用のボタンが出ます。「ホーム画面に追加」でアプリのように起動でき、一度開けば電波がなくても遊べます。</li>
        <li><b>見せる</b>: 公開サイトの「工房（Preview）」はスマホでも開けます。見本を触って試せます（保存はされません）。</li>
        <li><b>作る</b>: 編集はパソコン向けです。スマホからは Claude Code や Codex のアプリで「〜を足して」と頼み、出来たものを公開版で遊んで確かめる流れが楽です。</li>
        <li><b>文字の大きさ</b>: ゲームの文字は画面幅に合わせて縮みます。台詞は短めに（pnpm rpg proofread で長すぎる所が分かります）。</li>
      </ul>
    </>}
  </div>;
}

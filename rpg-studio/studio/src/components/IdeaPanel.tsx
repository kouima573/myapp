import { useMemo, useState } from "react";
import { Dices, FlaskConical, Lightbulb, Loader2, Puzzle, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import type { GameContent } from "@rpg/schema";
import { MODULES } from "../../../packages/modules/src/index";
import { IDEA_TEMPLATE } from "../../../packages/cli/src/idea-template";
import type { TestResponse } from "../../../packages/local-server/src/protocol";
import type { ProjectStore } from "../lib/useProject";

interface Props { store: ProjectStore; content: GameContent | null }

const SEED_BANKS = {
  setting: ["離島の灯台村", "夜だけ開く学園寮", "月面の小さな移民船", "雨に沈みかけた商店街", "夢を売買する市場", "地下に広がる植物都市", "巨大列車が巡る荒野", "毎朝地形が変わる森"],
  rule: ["眠るたび一日戻るが、誰かの記憶が消える", "嘘をつくと地図に道が生える", "名前を呼ぶと相手の能力を一時借りられる", "約束した言葉が現実のルールになる", "戦闘に負けるたび敵と仲良くなる", "使った時間が通貨として減っていく", "明かりの範囲だけ世界が存在する", "物を置くと、その物の思い出も置かれる"],
  goal: ["失われた季節を取り戻す", "町に残る噂の正体を確かめる", "出航前に全員の秘密をつなぐ", "旅する門を閉じるか開くか決める", "帰れない人物の帰路を作る", "最後の祭りを成功させる", "主人公の名前を取り返す", "村の未来を複数の候補から選ぶ"],
} as const;
type SeedKey = keyof typeof SEED_BANKS;
type SeedOptions = Record<SeedKey, string[]>;
type SeedSelection = Record<SeedKey, string>;
const SEED_TITLES: Record<SeedKey, string> = { setting: "舞台", rule: "物語の核になるルール", goal: "主人公の目的" };
function drawSeeds(): SeedOptions {
  return Object.fromEntries(Object.entries(SEED_BANKS).map(([key, values]) => {
    const pool = [...values];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
    return [key, pool.slice(0, 3)];
  })) as SeedOptions;
}

/** The idea (IDEA.md) next to what proves it works (scenario tests), plus the genre modules and shared mods in use. */
export default function IdeaPanel({ store, content }: Props) {
  const idea = store.texts["IDEA.md"];
  const [draft, setDraft] = useState<string | null>(null);
  const [tests, setTests] = useState<TestResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [seedOptions, setSeedOptions] = useState<SeedOptions>(drawSeeds);
  const [seedSelection, setSeedSelection] = useState<SeedSelection>({ setting: "", rule: "", goal: "" });
  const scenarios = useMemo(() => Object.entries(store.texts).filter(([p]) => p.startsWith("tests/") && p.endsWith(".scenario.json")).map(([path, text]) => {
    try { const j = JSON.parse(text) as { name?: string; steps?: unknown[] }; return { path, name: j.name ?? path, steps: j.steps?.length ?? 0 }; } catch { return { path, name: `${path}（JSONが壊れています）`, steps: 0 }; }
  }), [store.texts]);
  const mods = useMemo(() => { try { return JSON.parse(store.texts["mods.json"] ?? "{}") as Record<string, { version: string; author: string; license: string; addedAt: string }>; } catch { return {}; } }, [store.texts]);
  const enabled = new Set(Object.keys(content?.project.modules ?? {}));
  const text = draft ?? idea ?? "";

  const runTests = async () => {
    if (!store.source.runTests) return;
    setRunning(true);
    try { setTests(await store.source.runTests()); } finally { setRunning(false); }
  };
  const toggle = (id: string) => store.updateJson<{ modules?: Record<string, unknown> }>("project.json", p => {
    const modules = { ...(p.modules ?? {}) };
    if (id in modules) delete modules[id]; else modules[id] = {};
    p.modules = modules;
  });
  const addSeedToIdea = () => {
    if (!seedSelection.setting || !seedSelection.rule || !seedSelection.goal) return;
    const section = `## 発想ガチャ案\n\n- 舞台: ${seedSelection.setting}\n- この世界のルール: ${seedSelection.rule}\n- 主人公の目的: ${seedSelection.goal}\n\nこの組み合わせを出発点に、RPGとして遊べる選択や変化を考える。`;
    const base = draft ?? idea ?? IDEA_TEMPLATE(content?.project.title ?? "新しいゲーム");
    const next = `${base.trimEnd()}\n\n${section}\n`;
    if (idea === undefined) store.setFileText("IDEA.md", next); else setDraft(next);
  };

  return <div className="checks-panel idea-panel">
    <section className="card idea-scope-note">
      <p><b>この工房の土台:</b> 標準の実行形式はRPGです。別ジャンルの遊びや独自ルールも組み込めます。主人公・マップ・物語に結びつけると発想が変わってしまう場合は、RPGの形に決めつけず「希望するゲームの形式」や「まだ決めていないこと」にそのまま書いてください。エンジン拡張が必要なら、Codex / Claude Codeで相談できます。</p>
      <p><b>作り方も自由です。</b> 作り手が今いる段階、プレイヤーが最初に出会う場面、作業の順序やAIとの進め方はそれぞれ別に決められます。設定・プロット・途中の場面・既存作など、どこからでも始められます。方法を組み合わせたり途中で変えたり、まだ決めずに相談しながら進めても構いません。ここにある例や工房の機能に合わせる必要はありません。</p>
    </section>
    <section className="card idea-card">
      <header><Lightbulb size={15} /><h3>発想シート（IDEA.md）</h3><span className="spacer" />
        {idea !== undefined && draft !== null && draft !== idea && <button className="button primary" onClick={() => { store.setFileText("IDEA.md", draft); setDraft(null); }}>保存</button>}
      </header>
      {idea === undefined ? <>
        <p className="muted">発想シートは任意です。一言のメモだけでも、別の資料からでも始められます。書かずに依頼したい場合は「チャットで作る」で直接依頼できます（ローカルAIは既存のファイルから直接続けられます）。</p>
        <button className="button primary" onClick={() => store.setFileText("IDEA.md", IDEA_TEMPLATE(content?.project.title ?? "新しいゲーム"))}>任意の発想メモを作る</button>
      </> : <textarea className="idea-text" value={text} onChange={e => setDraft(e.target.value)} spellCheck={false} rows={22} />}
    </section>

    <section className="card idea-seed-card">
      <header><Dices size={15} /><h3>3択の発想ガチャ（任意・RPG向け）</h3><span className="spacer" /><button className="button" onClick={() => { setSeedOptions(drawSeeds()); setSeedSelection({ setting: "", rule: "", goal: "" }); }}><RefreshCw size={13} /> 引き直す</button></header>
      <p className="muted small">舞台・世界のルール・主人公の目的から案を選べます。使わなくても構いません。選んだ案は発想シートに追記され、既存の発想は消しません。</p>
      <div className="idea-seed-groups">{(Object.keys(SEED_TITLES) as SeedKey[]).map(key => <fieldset key={key} className="idea-seed-group">
        <legend>{SEED_TITLES[key]}</legend>
        {seedOptions[key].map(option => <button key={option} className={`idea-seed-option ${seedSelection[key] === option ? "is-selected" : ""}`} aria-pressed={seedSelection[key] === option} onClick={() => setSeedSelection({ ...seedSelection, [key]: option })}>{option}</button>)}
      </fieldset>)}</div>
      <div className="idea-seed-preview"><b>今回の組み合わせ</b><span>{seedSelection.setting || "舞台を選択"} ／ {seedSelection.rule || "ルールを選択"} ／ {seedSelection.goal || "目的を選択"}</span></div>
      <div className="row"><button className="button primary" disabled={!seedSelection.setting || !seedSelection.rule || !seedSelection.goal} onClick={addSeedToIdea}><Lightbulb size={13} /> 発想シートに追加</button></div>
    </section>

    <section className="card">
      <header><FlaskConical size={15} /><h3>発想を確かめるテスト</h3><span className="spacer" />
        <button className="button" onClick={() => void runTests()} disabled={!store.source.runTests || running}>{running ? <Loader2 size={14} className="spin" /> : <FlaskConical size={14} />} 実行</button>
      </header>
      <p className="muted small">発想の核ごとに、自動プレイテスト（tests/*.scenario.json）で「本当にそう動く」ことを確かめます。テストの名前に核の言葉を入れておくと対応が見やすくなります。</p>
      {!scenarios.length && <p className="muted">まだテストがありません。AIに「IDEA.md の核を確かめるテストを書いて」と頼めます。</p>}
      <ul className="idea-tests">{scenarios.map(s => {
        const r = tests?.results.find(x => x.file.endsWith(s.path.replace(/^tests\//, "")));
        return <li key={s.path}>{r ? (r.ok ? <CheckCircle2 size={13} className="text-green" /> : <XCircle size={13} className="text-error" />) : <span className="dot" />}<span>{s.name}</span><span className="muted small">{s.steps}手順</span></li>;
      })}</ul>
      {!store.source.runTests && <p className="muted small">テストの実行は <code>pnpm studio</code>（ローカル接続）で使えます。</p>}
    </section>

    <section className="card">
      <header><Puzzle size={15} /><h3>ジャンルモジュール</h3><span className="muted small">{enabled.size}/{Object.keys(MODULES).length} 有効</span></header>
      <p className="muted small">有効にしたモジュールは、データから場面（startScene）や戦い方（敵の battle.mode）として呼べます。使い方の全体は docs/genre-modules.md、ジャンルごとの作り方は docs/genre-atlas.md。</p>
      <div className="module-list">{Object.entries(MODULES).map(([id, info]) => <label key={id} className={`module-item ${enabled.has(id) ? "is-on" : ""}`}>
        <input type="checkbox" checked={enabled.has(id)} onChange={() => toggle(id)} />
        <span><b>{info.title}</b> <code>{id}</code><span className="muted small"> {info.genre}</span><br /><span className="small">{info.description}</span><br /><code className="small wrap">{info.usage}</code></span>
      </label>)}</div>
    </section>

    <section className="card">
      <header><Puzzle size={15} /><h3>取り込んだ mod</h3></header>
      {Object.keys(mods).length ? <ul className="idea-tests">{Object.entries(mods).map(([id, m]) => <li key={id}><b>{id}</b><span>{m.version}</span><span className="muted small">{m.author}・{m.license}・{m.addedAt}</span></li>)}</ul>
        : <p className="muted small">まだありません。リポジトリの mods/ にある仕組みは <code>pnpm rpg mod add &lt;id&gt; --project …</code> で取り込めます（出どころは mods.json に残ります）。</p>}
    </section>
  </div>;
}

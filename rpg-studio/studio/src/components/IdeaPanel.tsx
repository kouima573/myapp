import { useMemo, useState } from "react";
import { FlaskConical, Lightbulb, Loader2, Puzzle, CheckCircle2, XCircle } from "lucide-react";
import type { GameContent } from "@rpg/schema";
import { MODULES } from "../../../packages/modules/src/index";
import { IDEA_TEMPLATE } from "../../../packages/cli/src/idea-template";
import type { TestResponse } from "../../../packages/local-server/src/protocol";
import type { ProjectStore } from "../lib/useProject";

interface Props { store: ProjectStore; content: GameContent | null }

/** The idea (IDEA.md) next to what proves it works (scenario tests), plus the genre modules and shared mods in use. */
export default function IdeaPanel({ store, content }: Props) {
  const idea = store.texts["IDEA.md"];
  const [draft, setDraft] = useState<string | null>(null);
  const [tests, setTests] = useState<TestResponse | null>(null);
  const [running, setRunning] = useState(false);
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

  return <div className="checks-panel idea-panel">
    <section className="card idea-card">
      <header><Lightbulb size={15} /><h3>発想シート（IDEA.md）</h3><span className="spacer" />
        {idea !== undefined && draft !== null && draft !== idea && <button className="button primary" onClick={() => { store.setFileText("IDEA.md", draft); setDraft(null); }}>保存</button>}
      </header>
      {idea === undefined ? <>
        <p className="muted">このプロジェクトにはまだ発想シートがありません。核になる発想・常識から外れているところ・借りたいコンセプトを書いておくと、AIはそれを削らずに形にします（docs/idea-to-game.md）。</p>
        <button className="button primary" onClick={() => store.setFileText("IDEA.md", IDEA_TEMPLATE(content?.project.title ?? "新しいゲーム"))}>発想シートを作る</button>
      </> : <textarea className="idea-text" value={text} onChange={e => setDraft(e.target.value)} spellCheck={false} rows={22} />}
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

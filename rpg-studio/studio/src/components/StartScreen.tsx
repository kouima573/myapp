import { useEffect, useRef, useState } from "react";
import { BookOpen, Code2, FolderOpen, Gamepad2, MessagesSquare, Plus, Upload } from "lucide-react";
import { askPersistent, freeId, listProjects, putProject, setCurrentProjectId, type BrowserProject } from "../lib/browserProjects";
import { projectFromZip } from "../lib/browserExport";
import { blankProject } from "../lib/blank";
import { blankExperience } from "../lib/blankExperience";
import { sampleProjectTexts } from "../lib/source";

/** Session flag: the person chose to look at the bundled sample (so the start screen is not shown again in this tab). */
export const SAMPLE_CHOSEN_KEY = "rpg-studio:sample-chosen";
/** Section to open after creating / opening a project from the start screen. */
export const OPEN_SECTION_KEY = "rpg-studio:open-section";

const session = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* private mode */ } },
};
export const sampleChosen = () => session.get(SAMPLE_CHOSEN_KEY) === "1";
export function backToStart() { session.set(SAMPLE_CHOSEN_KEY, null); setCurrentProjectId(null); location.reload(); }
export function takeOpenSection(): string | null { const v = session.get(OPEN_SECTION_KEY); session.set(OPEN_SECTION_KEY, null); return v; }

const formatOf = (p: BrowserProject) => (p.texts["experience.json"] === undefined ? "RPG" : "独立作品");

/**
 * ブラウザ版の最初の画面: 新しく作る／続きから／見本で試す（お手本・テスト用）／ZIPから開く。
 * 見本は自分の作品ではないことを、ここではっきり分ける。
 */
export default function StartScreen({ onSample }: { onSample: () => void }) {
  const [title, setTitle] = useState("");
  const [projects, setProjects] = useState<BrowserProject[] | null>(null);
  const [busy, setBusy] = useState("");
  const zipInput = useRef<HTMLInputElement>(null);
  useEffect(() => { listProjects().then(setProjects, () => setProjects([])); }, []);

  const open = (id: string, section?: string) => { if (section) session.set(OPEN_SECTION_KEY, section); setCurrentProjectId(id); location.reload(); };
  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    try { await job(); } catch (error) { window.alert(`${label}できませんでした:\n${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(""); }
  };
  const createGame = (section: string) => run("新しいゲームを作る", async () => {
    const name = title.trim() || "わたしのゲーム";
    const id = await freeId("my-game");
    const now = new Date().toISOString();
    await putProject({ id, title: name, origin: "blank", texts: blankProject(sampleProjectTexts(), { id, title: name }), files: {}, createdAt: now, updatedAt: now });
    void askPersistent();
    open(id, section);
  });
  const createExperience = () => run("独立作品を作る", async () => {
    const project = await blankExperience(title);
    await putProject(project);
    void askPersistent();
    open(project.id, "experience");
  });
  const importZip = (file: File) => run("ZIPを開く", async () => {
    const project = await projectFromZip(file);
    await putProject(project);
    void askPersistent();
    open(project.id);
  });

  return <main className="start-screen">
    <header className="start-head">
      <img src="./favicon.svg" alt="" width={40} height={40} />
      <div><h1>RPGシステム工房</h1><p className="muted">思いついたものを、ゲームにする。作ったものは、このブラウザに自動で保存されます。</p></div>
    </header>

    <section className="start-card primary">
      <h2><Plus size={18} /> 新しく作る</h2>
      <label className="start-title">作品の名前（あとで変えられます）<input value={title} onChange={e => setTitle(e.target.value)} placeholder="わたしのゲーム" /></label>
      <div className="start-choices">
        <button className="start-choice" disabled={Boolean(busy)} onClick={() => void createGame("tutorial")}>
          <Gamepad2 size={20} /><b>RPGを作る</b><span>マップを歩いて、話して、戦うゲーム。空の舞台から始めます（「はじめての5分」が開きます）</span>
        </button>
        <button className="start-choice" disabled={Boolean(busy)} onClick={() => void createGame("chat")}>
          <MessagesSquare size={20} /><b>チャットのAIと作る</b><span>ChatGPT・Claude などに相談しながら、短いRPGを作ります（「チャットで作る」が開きます）</span>
        </button>
        <button className="start-choice" disabled={Boolean(busy)} onClick={() => void createExperience()}>
          <Code2 size={20} /><b>独立作品を作る</b><span>RPGの形にしばられない、ミニゲーム・パズル・体験もの</span>
        </button>
      </div>
      {busy && <p className="muted small">{busy}…</p>}
    </section>

    <section className="start-card">
      <h2><FolderOpen size={18} /> 続きから</h2>
      {projects === null ? <p className="muted small">読み込み中…</p> : projects.length === 0 ? <p className="muted small">このブラウザに保存した作品はまだありません。</p>
        : <ul className="start-list">{projects.map(p => <li key={p.id}><button onClick={() => open(p.id)}>
          <b>{p.title}</b><span className="muted small">{formatOf(p)}{p.origin === "sample" ? "・見本のコピー" : ""}・{new Date(p.updatedAt).toLocaleString("ja-JP")}</span>
        </button></li>)}</ul>}
      <button className="button" onClick={() => zipInput.current?.click()}><Upload size={13} /> ZIPから開く</button>
      <input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importZip(f); }} />
    </section>

    <section className="start-card sample">
      <h2><BookOpen size={18} /> 見本で試す（お手本・テスト用）</h2>
      <p className="small">工房の機能を試すための、できあがった短いRPGです。<b>あなたの作品ではありません</b>。中を見て、どこに何があるかを知るのに使ってください。見本を書き換えると「見本のコピー」として別に保存され、見本そのものは変わりません。</p>
      <div className="row">
        <button className="button" onClick={() => { session.set(SAMPLE_CHOSEN_KEY, "1"); onSample(); }}>見本を開く</button>
        <a className="button" href="../play/" target="_blank" rel="noopener">見本を遊んでみる</a>
      </div>
    </section>
    <p className="muted small start-foot">PC に開発環境を入れると、手元の工房（<code>pnpm studio</code>）で独自のコードを書いたり、大きな作品を作ったりできます。</p>
  </main>;
}

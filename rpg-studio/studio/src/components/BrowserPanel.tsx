import { useEffect, useRef, useState } from "react";
import { Download, FolderOpen, FolderPlus, Gamepad2, Trash2, Upload, HardDrive } from "lucide-react";
import { deleteProject, listProjects, putProject, setCurrentProjectId, freeId, askPersistent, type BrowserProject } from "../lib/browserProjects";
import { download, playableZip, projectFromZip, projectZip } from "../lib/browserExport";
import { blankProject } from "../lib/blank";
import { sampleProjectTexts, type PreviewSource } from "../lib/source";
import type { ProjectStore } from "../lib/useProject";

/**
 * ブラウザ版の工房（公開サイト）: プロジェクトをこのブラウザに保存し、切り替え・ZIPで書き出し／読み込み・遊べる形で書き出す。
 * PCに何も入れずに、チャットのAI（「チャットで作る」画面）と組み合わせて短編を作れる。
 */
export default function BrowserPanel({ store, source }: { store: ProjectStore; source: PreviewSource }) {
  const [projects, setProjects] = useState<BrowserProject[] | null>(null);
  const [busy, setBusy] = useState("");
  const [title, setTitle] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => { listProjects().then(setProjects, error => { setProjects([]); store.log("error", String(error instanceof Error ? error.message : error)); }); };
  useEffect(refresh, [store]);

  const open = (id: string | null) => { setCurrentProjectId(id); location.reload(); };
  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    try { await job(); } catch (error) { store.log("error", `${label}: ${error instanceof Error ? error.message : String(error)}`); window.alert(`${label}できませんでした:\n${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(""); }
  };

  const createBlank = () => run("新しいゲームを作成", async () => {
    const name = title.trim() || "わたしのゲーム";
    const id = await freeId("my-game");
    const now = new Date().toISOString();
    await putProject({ id, title: name, origin: "blank", texts: blankProject(sampleProjectTexts(), { id, title: name }), files: {}, createdAt: now, updatedAt: now });
    void askPersistent();
    open(id);
  });
  const importZip = (file: File) => run("ZIPの読み込み", async () => {
    const project = await projectFromZip(file);
    await putProject(project);
    void askPersistent();
    open(project.id);
  });
  const exportProject = () => run("プロジェクトの書き出し", async () => {
    const id = source.project?.id ?? "sample";
    const { bytes, missing } = await projectZip(id, store.texts, source.project);
    download(`${id}.zip`, bytes);
    store.log(missing.length ? "warn" : "ok", missing.length ? `書き出しました。見つからない素材: ${missing.join(", ")}` : `${id}.zip を書き出しました（手元の工房・Codex・Claude Code でそのまま開けます）`);
  });
  const exportPlayable = () => run("遊べる形での書き出し", async () => {
    const { bytes, name } = await playableZip(store.texts, source.project, source.codeIsSample());
    download(name, bytes);
    store.log("ok", `${name} を書き出しました。itch.io には「HTML」のゲームとしてそのままアップロードできます`);
  });
  const remove = (p: BrowserProject) => run("削除", async () => {
    if (!window.confirm(`「${p.title}」をこのブラウザから消します。元に戻せません。\n（必要なら先に「ZIPで書き出す」で保存してください）`)) return;
    await deleteProject(p.id);
    if (source.project?.id === p.id) open(null); else refresh();
  });

  const current = source.project;
  return <div className="panel-page browser-panel">
    <h2><HardDrive size={18} /> プロジェクト（ブラウザ版）</h2>
    <p className="muted">この工房はブラウザだけで使えます。作ったゲームは<b>このブラウザの中</b>に自動で保存されます（別のブラウザやPCには引き継がれません）。大事なものはときどき「ZIPで書き出す」で手元に残してください。
      ChatGPT などと作るときは「チャットで作る」画面を使います。</p>

    <section>
      <h3>いま開いているもの</h3>
      <p><b>{current ? current.title : "見本（まだ保存していません）"}</b>{current ? <span className="muted small">　ID: {current.id}・最終保存 {new Date(current.updatedAt).toLocaleString()}</span> : <span className="muted small">　編集すると、自動でこのブラウザにコピーが保存されます</span>}</p>
      <div className="row">
        <button disabled={!!busy} onClick={() => void exportPlayable()}><Gamepad2 size={13} /> 遊べる形で書き出す（ZIP）</button>
        <button disabled={!!busy} onClick={() => void exportProject()}><Download size={13} /> プロジェクトをZIPで書き出す</button>
        {busy && <span className="muted small">{busy}中…</span>}
      </div>
      <p className="muted small">「遊べる形」は、そのまま公開できるゲーム一式です（itch.io なら「HTML」のゲームとしてZIPのままアップロード）。「プロジェクト」は作りかけのデータ一式で、ほかのブラウザでの読み込みや、手元の工房・Codex・Claude Code での続きに使います。</p>
    </section>

    <section>
      <h3>新しく始める・読み込む</h3>
      <div className="row">
        <input value={title} placeholder="ゲームの名前（例: 星降る村）" onChange={e => setTitle(e.target.value)} aria-label="新しいゲームの名前" />
        <button disabled={!!busy} onClick={() => void createBlank()}><FolderPlus size={13} /> 新しいゲームを作る</button>
        <button disabled={!!busy} onClick={() => open(null)}><FolderOpen size={13} /> 見本を開く</button>
        <button disabled={!!busy} onClick={() => fileInput.current?.click()}><Upload size={13} /> ZIPから読み込む</button>
        <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importZip(f); }} />
      </div>
      <p className="muted small">「新しいゲーム」は、見本の絵・音・タイルを使った、マップ1枚と人物1人だけの小さな土台です。</p>
    </section>

    <section>
      <h3>このブラウザに保存されているもの</h3>
      {projects === null ? <p className="muted">読み込み中…</p> : !projects.length ? <p className="muted">まだありません。</p> :
        <ul className="browser-projects">
          {projects.map(p => <li key={p.id} className={current?.id === p.id ? "is-current" : ""}>
            <div><b>{p.title}</b> <code>{p.id}</code> <span className="muted small">{new Date(p.updatedAt).toLocaleString()}</span></div>
            <div className="row">
              {current?.id !== p.id && <button onClick={() => open(p.id)}><FolderOpen size={13} /> 開く</button>}
              {current?.id === p.id && <span className="tag">開いています</span>}
              <button className="icon-button" title="このブラウザから消す" onClick={() => void remove(p)}><Trash2 size={13} /></button>
            </div>
          </li>)}
        </ul>}
    </section>
  </div>;
}

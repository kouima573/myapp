import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCopy, Download, ExternalLink, FileText, FolderOpen, FolderPlus, Gamepad2, Trash2, Upload, HardDrive } from "lucide-react";
import { deleteProject, listProjects, putProject, setCurrentProjectId, freeId, askPersistent, type BrowserProject } from "../lib/browserProjects";
import { download, playableZip, projectFromZip, projectZip } from "../lib/browserExport";
import { blankProject } from "../lib/blank";
import { sampleProjectTexts, type PreviewSource } from "../lib/source";
import type { ProjectStore } from "../lib/useProject";

type PlatformId = "itch" | "plicy" | "pages" | "booth" | "freem" | "unityroom";
type Platform = { id: PlatformId; name: string; status: string; tone: "ready" | "check" | "other"; url: string; source: string; summary: string; steps: string[] };
const PLATFORMS: Platform[] = [
  { id: "itch", name: "itch.io", status: "このZIPで公開しやすい", tone: "ready", url: "https://itch.io/game/new", source: "https://itch.io/docs/creators/html5", summary: "HTML5ゲームとしてZIPを登録します。ZIP直下の index.html から起動する形式です。", steps: ["新しい作品ページを作り、種類で HTML を選ぶ", "遊べる形のZIPをアップロードする", "埋め込みサイズを設定し、プレビューで起動確認する"] },
  { id: "plicy", name: "PLiCy", status: "HTML5投稿の候補", tone: "check", url: "https://plicy.net/", source: "https://plicy.net/ToolFAQ/HTML5", summary: "HTML5作品をZIPで投稿できます。変換とテストプレイが終わるまで少し待ち、公開設定とサムネイルを確認します。", steps: ["ZIPを投稿し、サイト側の変換完了を待つ", "作品情報を設定してテストプレイする", "サムネイルを撮影して公開状態を確認する"] },
  { id: "pages", name: "Cloudflare Pages", status: "サイト公開の候補", tone: "check", url: "https://dash.cloudflare.com/", source: "https://developers.cloudflare.com/pages/get-started/direct-upload/", summary: "ZIPを展開し、index.html・game.js・data/ を含むフォルダーを静的サイトとして公開します。", steps: ["ZIPを展開する", "展開したフォルダーに index.html と game.js があることを確認する", "Pages の Direct Upload でフォルダーをアップロードする"] },
  { id: "booth", name: "BOOTH", status: "ダウンロード頒布向け", tone: "other", url: "https://booth.pm/guide", source: "https://booth.pm/guide", summary: "デジタル商品の頒布先です。今のZIPはブラウザ向けなので、購入者が迷わず起動できる説明を商品に添えてください。", steps: ["ダウンロード商品を作成する", "商品画像・説明・価格などを設定する", "起動方法と素材クレジットを商品説明にも記載する"] },
  { id: "freem", name: "ふりーむ！", status: "現在の形式は対象外", tone: "other", url: "https://www.freem.ne.jp/special/project/24", source: "https://www.freem.ne.jp/special/project/24", summary: "公式案内ではブラウザ投稿の対応制作ツールが限られています。RPGシステム工房の出力形式はその対象に含まれていません。", steps: ["別の対応ツールで出力した場合に投稿を検討する", "対応ツールと投稿条件を公式案内で再確認する"] },
  { id: "unityroom", name: "unityroom", status: "Unity出力が必要", tone: "other", url: "https://help.unityroom.com/2e9dc3ed5de9803ab110fe3b05138bd5", source: "https://help.unityroom.com/2e9dc3ed5de9803ab110fe3b05138bd5", summary: "投稿にはUnity製のWebGLコンテンツが必要です。現在のRPGシステム工房のHTML5 ZIPとは出力形式が異なります。", steps: ["UnityでWebGL用にビルドした作品を用意する", "公式の投稿手順に沿って作品を登録する"] },
];
type ListingDraft = { description: string; playTime: string; tags: string; notes: string; controls: string };
type PublishCheckId = "zip" | "listing" | "credits" | "images" | "mobile" | "save";
const PUBLISH_CHECKS: Array<{ id: PublishCheckId; text: string; automatic?: boolean }> = [
  { id: "zip", text: "公開ZIPを生成し、必須ファイルの構成点検に通す", automatic: true },
  { id: "listing", text: "作品紹介・プレイ時間・操作方法を読み直す" },
  { id: "credits", text: "素材の利用条件とクレジットを確認する" },
  { id: "images", text: "サムネイルとスクリーンショットを用意する" },
  { id: "mobile", text: "スマートフォン表示と操作を確認する" },
  { id: "save", text: "セーブ・ロードを一度確認する" },
];
type PublishChecks = Partial<Record<PublishCheckId, boolean>>;
const DEFAULT_DRAFT: ListingDraft = { description: "", playTime: "", tags: "", notes: "", controls: "" };
const makeListing = (title: string, draft: ListingDraft) => [
  draft.description.trim(),
  draft.playTime.trim() ? `プレイ時間の目安: ${draft.playTime.trim()}` : "",
  draft.tags.trim() ? `ジャンル・タグ: ${draft.tags.trim()}` : "",
  draft.controls.trim() ? `操作方法:\n${draft.controls.trim()}` : "",
  draft.notes.trim() ? `注意事項:\n${draft.notes.trim()}` : "",
].filter(Boolean).join("\n\n") || `${title} の紹介文をここに入力してください。`;

/**
 * ブラウザ版の工房（公開サイト）: プロジェクトをこのブラウザに保存し、切り替え・ZIPで書き出し／読み込み・遊べる形で書き出す。
 * PCに何も入れずに、チャットのAI（「チャットで作る」画面）と組み合わせて短編を作れる。
 */
export default function BrowserPanel({ store, source }: { store: ProjectStore; source: PreviewSource }) {
  const [projects, setProjects] = useState<BrowserProject[] | null>(null);
  const [busy, setBusy] = useState("");
  const [title, setTitle] = useState("");
  const [platformId, setPlatformId] = useState<PlatformId>("itch");
  const [copied, setCopied] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const projectInfo = useMemo(() => { try { return JSON.parse(store.texts["project.json"] ?? "{}") as { id?: string; title?: string; titleScreen?: { subtitle?: string } }; } catch { return {}; } }, [store.texts]);
  const draftKey = `rpg-studio:publish:${projectInfo.id ?? source.project?.id ?? "sample"}`;
  const checklistKey = `rpg-studio:publish-checklist:${projectInfo.id ?? source.project?.id ?? "sample"}:${platformId}`;
  const [draft, setDraft] = useState<ListingDraft>(() => {
    try { return { ...DEFAULT_DRAFT, description: projectInfo.titleScreen?.subtitle ?? "", ...(JSON.parse(localStorage.getItem(draftKey) ?? "{}") as Partial<ListingDraft>) }; } catch { return { ...DEFAULT_DRAFT, description: projectInfo.titleScreen?.subtitle ?? "" }; }
  });
  const [publishChecks, setPublishChecks] = useState<PublishChecks>(() => {
    try { return JSON.parse(localStorage.getItem(checklistKey) ?? "{}"); } catch { return {}; }
  });
  const previousTexts = useRef(store.texts);
  useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* optional browser storage */ } }, [draftKey, draft]);
  useEffect(() => {
    try { setPublishChecks(JSON.parse(localStorage.getItem(checklistKey) ?? "{}")); } catch { setPublishChecks({}); }
  }, [checklistKey]);
  useEffect(() => { try { localStorage.setItem(checklistKey, JSON.stringify(publishChecks)); } catch { /* checklist is optional */ } }, [checklistKey, publishChecks]);
  useEffect(() => {
    if (previousTexts.current !== store.texts) {
      previousTexts.current = store.texts;
      setPublishChecks(current => current.zip ? { ...current, zip: false } : current);
    }
  }, [store.texts]);
  const platform = PLATFORMS.find(item => item.id === platformId)!;
  const gameTitle = projectInfo.title?.trim() || source.project?.title || "タイトル未設定";

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
    const { bytes, name, files, totalBytes } = await playableZip(store.texts, source.project, source.codeIsSample());
    download(name, bytes);
    setPublishChecks(current => ({ ...current, zip: true }));
    store.log("ok", `${name} を書き出しました。${files}ファイル・素材込み ${Math.ceil(totalBytes / 1024)}KB。ZIPを展開して必須ファイルと重複を点検済みです`);
  });
  const copyListing = () => run("投稿文のコピー", async () => {
    await navigator.clipboard.writeText(makeListing(gameTitle, draft));
    setCopied("投稿文をコピーしました");
    window.setTimeout(() => setCopied(""), 2500);
  });
  const exportNotes = () => run("投稿準備メモの書き出し", async () => {
    const listing = makeListing(gameTitle, draft);
    const checklist = PUBLISH_CHECKS.map(item => `- [${publishChecks[item.id] ? "x" : " "}] ${item.text}`).join("\n");
    const notes = `# ${gameTitle} — 公開準備メモ\n\n投稿先: ${platform.name}\n公式ページ: ${platform.url}\n準備日: ${new Date().toLocaleDateString("ja-JP")}\n\n## 作品ページに使う文面\n\n### タイトル\n${gameTitle}\n\n### 紹介文・操作方法\n${listing}\n\n## この投稿先での手順\n\n${platform.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n\n## 公開前チェック（${PUBLISH_CHECKS.filter(item => publishChecks[item.id]).length}/${PUBLISH_CHECKS.length}）\n\n${checklist}\n\nゲームZIPは別途「ゲームZIPを作る」から作成してください。独自コードを追加したプロジェクトは、手元の工房で \`pnpm rpg build --project <プロジェクトフォルダー> --zip\` を使ってください。\n`;
    const slug = projectInfo.id ?? source.project?.id ?? "game";
    download(`${slug}-publish-notes.md`, new TextEncoder().encode(notes), "text/markdown;charset=utf-8");
    store.log("ok", `${slug}-publish-notes.md を書き出しました`);
  });
  const remove = (p: BrowserProject) => run("削除", async () => {
    if (!window.confirm(`「${p.title}」をこのブラウザから消します。元に戻せません。\n（必要なら先に「ZIPで書き出す」で保存してください）`)) return;
    await deleteProject(p.id);
    if (source.project?.id === p.id) open(null); else refresh();
  });

  const current = source.project;
  return <div className="panel-page browser-panel">
    <h2><HardDrive size={18} /> プロジェクト（ブラウザ版）</h2>
    <p className="muted">この工房の標準データ形式はRPGです。他ジャンルの遊びや独自ルールも追加できますが、主人公・マップなどのRPGの外枠が発想に合わない場合は、ローカルAIでエンジンを拡張する必要があります。ブラウザ版はPCに何も入れずに使え、作ったゲームは<b>このブラウザの中</b>に自動で保存されます（別のブラウザやPCには引き継がれません）。大事なものはときどき「ZIPで書き出す」で手元に残してください。
      ChatGPT などと作るときは「チャットで作る」画面を使います。</p>

    <section className="publish-assistant">
      <div className="publish-heading"><div><h3><Upload size={15} /> 公開準備</h3><p className="muted small">投稿先に合わせて手順を確認し、ゲームZIPと作品ページ用の文面を用意します。投稿操作やアカウント接続は各サイトで行います。</p></div></div>
      <div className="publish-platforms" role="group" aria-label="投稿先を選択">
        {PLATFORMS.map(item => <button key={item.id} className={`publish-platform ${platformId === item.id ? "is-active" : ""}`} aria-pressed={platformId === item.id} onClick={() => { setPlatformId(item.id); setCopied(""); }}>
          <b>{item.name}</b><span className={`publish-status ${item.tone}`}>{item.status}</span>
        </button>)}
      </div>
      <div className="publish-columns">
        <div className="publish-site">
          <div className="publish-site-heading"><b>{platform.name} に投稿する</b><a href={platform.url} target="_blank" rel="noreferrer">公式ページ <ExternalLink size={12} /></a></div>
          <p>{platform.summary}</p>
          <ol>{platform.steps.map(step => <li key={step}>{step}</li>)}</ol>
          <a className="publish-source" href={platform.source} target="_blank" rel="noreferrer">投稿条件・公式ヘルプを見る <ExternalLink size={11} /></a>
        </div>
        <div className="publish-form">
          <label>作品紹介<textarea rows={3} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="どんなゲームか、プレイヤーに伝えたいこと" /></label>
          <div className="publish-form-row">
            <label>プレイ時間の目安<input value={draft.playTime} onChange={e => setDraft({ ...draft, playTime: e.target.value })} placeholder="例: 15〜20分" /></label>
          <label>ジャンル・タグ<input value={draft.tags} onChange={e => setDraft({ ...draft, tags: e.target.value })} placeholder="例: 探索, パズル" /></label>
          </div>
          <label>操作方法<textarea rows={3} value={draft.controls} onChange={e => setDraft({ ...draft, controls: e.target.value })} /></label>
          <label>注意事項・年齢区分<textarea rows={2} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="例: ホラー表現あり、音が出ます" /></label>
          <div className="row">
            <button disabled={!!busy} onClick={() => void copyListing()}><ClipboardCopy size={13} /> 投稿文をコピー</button>
            <button disabled={!!busy} onClick={() => void exportNotes()}><FileText size={13} /> 準備メモを保存</button>
            {copied && <span className="text-green small" role="status">{copied}</span>}
          </div>
        </div>
      </div>
      <div className="publish-checklist">
        <div className="publish-checklist-heading"><b>公開前チェック</b><span className="muted small">{PUBLISH_CHECKS.filter(item => publishChecks[item.id]).length} / {PUBLISH_CHECKS.length} 完了</span></div>
        <ul>{PUBLISH_CHECKS.map(item => <li key={item.id} className={publishChecks[item.id] ? "is-done" : ""}>
          <label><input type="checkbox" checked={Boolean(publishChecks[item.id])} disabled={item.automatic} onChange={event => setPublishChecks(current => ({ ...current, [item.id]: event.target.checked }))} />
            <span>{item.text}{item.automatic && <small>（ゲームZIP作成時に自動確認）</small>}</span>
          </label>
        </li>)}</ul>
      </div>
      <div className="publish-export row">
        <button className="primary" disabled={!!busy} onClick={() => void exportPlayable()}><Gamepad2 size={13} /> ゲームZIPを作る</button>
        {busy && <span className="muted small">{busy}中…</span>}
        {!source.canExportInBrowser() && <span className="text-amber small">独自コードを使っているため、ゲームZIPは手元の工房でビルドしてください。</span>}
        {source.canExportInBrowser() && <span className="muted small">ZIPには index.html・game.js・ゲームデータ・素材・CREDITS.md が入ります。</span>}
      </div>
    </section>

    <section>
      <h3>いま開いているもの</h3>
      <p><b>{current ? current.title : "見本（まだ保存していません）"}</b>{current ? <span className="muted small">　ID: {current.id}・最終保存 {new Date(current.updatedAt).toLocaleString()}</span> : <span className="muted small">　編集すると、自動でこのブラウザにコピーが保存されます</span>}</p>
      <div className="row">
        <button disabled={!!busy} onClick={() => void exportProject()}><Download size={13} /> プロジェクトをZIPで書き出す</button>
        {busy && <span className="muted small">{busy}中…</span>}
      </div>
      <p className="muted small">公開用のゲームZIPと投稿文は、上の「公開準備」で作成できます。「プロジェクト」は作りかけのデータ一式で、ほかのブラウザでの読み込みや、手元の工房・Codex・Claude Code での続きに使います。</p>
    </section>

    <section>
      <h3>新しく始める・読み込む</h3>
      <div className="row">
        <input value={title} placeholder="ゲームの名前（例: 星降る村）" onChange={e => setTitle(e.target.value)} aria-label="新しいゲームの名前" />
        <button disabled={!!busy} onClick={() => void createBlank()}><FolderPlus size={13} /> 空のRPG土台を作る</button>
        <button disabled={!!busy} onClick={() => open(null)}><FolderOpen size={13} /> 見本を開く</button>
        <button disabled={!!busy} onClick={() => fileInput.current?.click()}><Upload size={13} /> ZIPから読み込む</button>
        <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importZip(f); }} />
      </div>
      <p className="muted small">主人公と空の舞台1枚だけのRPG土台です。案内人・会話・イベント・目的は入れません。見本の素材は使えますが、発想ガチャや見本のストーリーは任意です。</p>
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

import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCopy, Code2, FilePlus2, FileText, Play, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { AssetManifestSchema, ExperienceProjectSchema } from "@rpg/schema";
import ExperienceAssetsPanel from "./ExperienceAssetsPanel";
import { experiencePreviewDocument, experiencePreviewPayload } from "../lib/experienceBrowser";
import type { PreviewSource, ProjectSource } from "../lib/source";
import type { ProjectStore } from "../lib/useProject";

const EDITABLE = (path: string) => /\.(json|md|tsx?|html?|css|m?js|cjs|txt|xml|svg|webmanifest)$/i.test(path);

export default function ExperiencePanel({ store, source }: { store: ProjectStore; source: ProjectSource }) {
  const [activeFile, setActiveFile] = useState("systems/main.ts");
  const [token] = useState(() => globalThis.crypto?.randomUUID?.() ?? `experience-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [bundle, setBundle] = useState<string | null>(null);
  const [frameVersion, setFrameVersion] = useState(0);
  const [compiling, setCompiling] = useState(false);
  const [status, setStatus] = useState("プレビューを更新すると、ブラウザ内で試遊できます");
  const [commandCopied, setCommandCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const visibleFiles = useMemo(() => Object.keys(store.texts).filter(EDITABLE).sort((a, b) => {
    const order = ["experience.json", "systems/main.ts", "assets.json", "README.md"];
    const ai = order.indexOf(a), bi = order.indexOf(b);
    return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.localeCompare(b);
  }), [store.texts]);

  const manifest = useMemo(() => {
    try {
      const result = ExperienceProjectSchema.safeParse(JSON.parse(store.texts["experience.json"] ?? ""));
      return result.success ? result.data : null;
    } catch { return null; }
  }, [store.texts]);
  const [buildCommandDraft, setBuildCommandDraft] = useState(manifest?.build?.command ?? "");
  const [buildOutputDraft, setBuildOutputDraft] = useState(manifest?.build?.outputDir ?? "dist");
  const [buildSettingsMessage, setBuildSettingsMessage] = useState("");
  const manifestIssues = useMemo(() => {
    try {
      const result = ExperienceProjectSchema.safeParse(JSON.parse(store.texts["experience.json"] ?? ""));
      return result.success ? [] : result.error.issues.map(issue => `experience.json › ${issue.path.join(".")}: ${issue.message}`);
    } catch (e) { return [`experience.json: ${e instanceof Error ? e.message : String(e)}`]; }
  }, [store.texts]);
  const assetCount = useMemo(() => {
    try {
      const project = ExperienceProjectSchema.parse(JSON.parse(store.texts["experience.json"] ?? ""));
      return AssetManifestSchema.parse(JSON.parse(store.texts[project.assetsPath] ?? "")).assets.length;
    } catch { return 0; }
  }, [store.texts]);
  useEffect(() => {
    setBuildCommandDraft(manifest?.build?.command ?? "");
    setBuildOutputDraft(manifest?.build?.outputDir ?? "dist");
  }, [manifest?.id, manifest?.build?.command, manifest?.build?.outputDir]);
  const localProjectPath = source.kind === "local" && store.projectInfo.projectDir ? store.projectInfo.projectDir.replace(/\\/g, "/") : null;
  const staticDevCommand = localProjectPath ? `pnpm rpg dev --project "${localProjectPath}"` : null;
  const staticBuildCommand = localProjectPath && manifest?.build ? `pnpm rpg build --project "${localProjectPath}" --run-project-build --zip` : null;
  const staticCommand = staticBuildCommand && staticDevCommand ? `${staticBuildCommand}\n${staticDevCommand}` : staticDevCommand;
  const browserStaticCommand = manifest?.build
    ? "pnpm rpg build --project projects/<展開した作品フォルダー> --run-project-build --zip\npnpm rpg dev --project projects/<展開した作品フォルダー>"
    : "pnpm rpg dev --project projects/<展開した作品フォルダー>";
  const copyStaticCommand = async () => {
    if (!staticCommand) return;
    try {
      await navigator.clipboard.writeText(staticCommand);
      setCommandCopied(true);
      window.setTimeout(() => setCommandCopied(false), 1800);
    } catch {
      setStatus("クリップボードにコピーできませんでした。下のコマンドを選択してコピーしてください。");
    }
  };
  const saveStaticBuildSettings = () => {
    try {
      const raw = JSON.parse(store.texts["experience.json"] ?? "{}") as Record<string, unknown>;
      if (buildCommandDraft.trim()) raw.build = { command: buildCommandDraft.trim(), outputDir: buildOutputDraft.trim() || "dist" };
      else delete raw.build;
      const parsed = ExperienceProjectSchema.safeParse(raw);
      if (!parsed.success) {
        setBuildSettingsMessage(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
        return;
      }
      store.setFileText("experience.json", `${JSON.stringify(raw, null, 2)}\n`);
      setBuildSettingsMessage(buildCommandDraft.trim() ? "設定を保存しました。実行はローカルCLIで明示してください。" : "ビルド設定を解除しました。");
    } catch (caught) {
      setBuildSettingsMessage(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const addFile = () => {
    const folder = manifest?.entry.split("/").slice(0, -1).join("/");
    const suggestedPath = folder ? `${folder}/helpers.ts` : "helpers.ts";
    const path = window.prompt("作品内の相対ファイル名を入力してください (.html / .css / .js / .ts / .json / .md など)。", suggestedPath)?.trim();
    if (!path) return;
    const parts = path.split("/");
    const parent = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    const existingDirectories = new Set(Object.keys(store.texts).flatMap(file => {
      const segments = file.split("/");
      return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
    }));
    const validPath = !path.includes("\\") && !path.startsWith("/") && parts.every(part => part && part !== "." && part !== ".." && !part.startsWith(".") && !/[<>:\"|?*\u0000-\u001f]/.test(part))
      && /\.(json|md|tsx?|html?|css|m?js|cjs|txt|xml|svg|webmanifest)$/i.test(path) && (parts.length === 1 || existingDirectories.has(parent) || parent === "systems" || parent === "tests");
    if (!validPath) { window.alert("ファイル名を確認してください。相対パスで指定し、保存先フォルダーは既存のものを選んでください。"); return; }
    if (store.texts[path] !== undefined) { window.alert("同じ名前のファイルがすでにあります。"); return; }
    const lower = path.toLowerCase();
    const content = lower.endsWith(".experience.json")
      ? `${JSON.stringify({ name: "入力シナリオ", steps: [{ input: { type: "key", key: "confirm" } }] }, null, 2)}\n`
      : /\.(json|webmanifest)$/.test(lower) ? "{}\n" : lower.endsWith(".md") ? "# メモ\n"
        : /\.html?$/.test(lower) ? "<!doctype html>\n<html lang=\"ja\">\n<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head>\n<body>\n</body>\n</html>\n"
          : lower.endsWith(".css") ? "/* 自由にスタイルを追加 */\n" : /\.(m?js|cjs)$/.test(lower) ? "// 自由に実装できます\n"
            : lower.endsWith(".svg") ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>\n' : lower.endsWith(".xml") ? '<?xml version="1.0" encoding="UTF-8"?>\n' : "";
    store.setFileText(path, content);
    setActiveFile(path);
  };

  useEffect(() => {
    if (manifest?.entry && store.texts[manifest.entry] !== undefined && !visibleFiles.includes(activeFile)) setActiveFile(manifest.entry);
    else if (!visibleFiles.includes(activeFile) && visibleFiles[0]) setActiveFile(visibleFiles[0]);
  }, [manifest?.entry, visibleFiles, activeFile, store.texts]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "experience-error") {
        setError(String(event.data.detail ?? "試遊中にエラーが発生しました"));
        setStatus("実行中にエラーが発生しました");
      } else if (event.data?.type === "experience-started") {
        setError(null);
        setStatus("試遊中です。コードを変更したら更新してください");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!frameReady || !bundle) return;
    frame.current?.contentWindow?.postMessage({ type: "start", token, bundle }, "*");
    setStatus("試遊コードを読み込んでいます…");
  }, [frameReady, bundle, token]);

  const runPreview = async () => {
    if (compiling) return;
    setCompiling(true);
    setFrameReady(false);
    setBundle(null);
    setError(null);
    setStatus("TypeScriptをブラウザ内で変換しています…");
    try {
      const files: Record<string, Blob> = source.kind === "preview" ? { ...((source as PreviewSource).project?.files ?? {}) } : {};
      if (source.kind === "local") {
        const project = ExperienceProjectSchema.parse(JSON.parse(store.texts["experience.json"] ?? ""));
        const assets = AssetManifestSchema.parse(JSON.parse(store.texts[project.assetsPath] ?? ""));
        for (const asset of assets.assets) {
          const url = await source.assetUrl(asset);
          const response = await fetch(url);
          if (!response.ok) throw new Error(`素材ファイルを読み込めません: ${asset.path}`);
          files[asset.path] = await response.blob();
        }
      }
      const prepared = await experiencePreviewPayload(store.texts, files);
      setFrameReady(false);
      setBundle(prepared.bundle);
      setFrameVersion(version => version + 1);
      setStatus("試遊を開始します…");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setStatus("プレビューを作れませんでした");
    } finally { setCompiling(false); }
  };
  const resetPreview = () => {
    setFrameReady(false);
    setBundle(null);
    setError(null);
    setStatus("プレビューを更新すると、ブラウザ内で試遊できます");
  };

  return <div className="experience-panel">
    <header className="experience-heading">
      <div><h2><Code2 size={18} /> {manifest?.runtime === "static" ? "独自HTML（静的サイト）" : "独立作品"}</h2><p className="muted small">RPGの主人公・マップ・HPなしで、作品自身の状態・入力・画面を作ります。保存先は接続中の工房（ブラウザまたはローカル）です。</p></div>
      {manifest?.runtime !== "static" && <div className="row"><button className="primary" onClick={() => void runPreview()} disabled={compiling}><Play size={14} /> {compiling ? "変換中…" : "プレビューを更新"}</button><button onClick={resetPreview}><RotateCcw size={14} /> 停止</button></div>}
    </header>
    <div className="experience-note"><ShieldCheck size={15} /><span>{manifest?.runtime === "static" ? "独自HTMLサイトは作品側のコードと起動方法を保って配布します。Studioのプレビュー環境では実行しません。" : "外部の有料サービスやAI APIは使いません。試遊コードは隔離フレーム内で動き、試遊中のネット接続と保存は無効です。書き出したゲームの保存はブラウザ側で行います。"}</span></div>
    {manifest?.runtime !== "static" && store.texts["project.json"] !== undefined && <div className="notice error">同じフォルダーに project.json と experience.json の両方があります。独立作品として表示中です。作品形式を混ぜず、使わない方のマニフェストを別フォルダーへ移してください。</div>}
    {manifest?.runtime === "static" && <details className="experience-build-settings"><summary>ソースビルド設定（任意）</summary><p className="muted small">Vite・Webpack・自作スクリプトなど、作品に合う手順を設定できます。設定したコマンドは自動実行しません。ローカルCLIで内容を確認し、<code>--run-project-build</code> を付けた場合だけ実行します。ブラウザ工房では実行しません。</p><div className="experience-build-fields"><label className="field"><span className="field-label">ビルドコマンド</span><textarea rows={2} value={buildCommandDraft} onChange={event => setBuildCommandDraft(event.target.value)} placeholder="例: pnpm run build" /></label><label className="field"><span className="field-label">成果物フォルダー</span><input value={buildOutputDraft} onChange={event => setBuildOutputDraft(event.target.value)} placeholder="dist" /></label></div><div className="row"><button type="button" onClick={saveStaticBuildSettings} disabled={!buildCommandDraft.trim() && !manifest.build}>{buildCommandDraft.trim() ? "設定を保存" : "ビルド設定を解除"}</button>{buildSettingsMessage && <span className="muted small" role="status">{buildSettingsMessage}</span>}</div></details>}
    <div className="experience-layout">
      <section className="experience-editor" aria-label="作品ファイル">
        <div className="experience-file-list"><button onClick={addFile}><FilePlus2 size={13} /> ファイルを追加</button>{visibleFiles.map(path => <button key={path} className={path === activeFile ? "is-active" : ""} onClick={() => setActiveFile(path)}><FileText size={13} /> {path}{store.dirty.has(path) && <span className="dot amber" />}</button>)}</div>
        <div className="experience-editor-main">
          <div className="experience-editor-toolbar"><b>{activeFile}</b><span className="muted small">{store.dirty.has(activeFile) ? "保存中…" : "自動保存"} <Save size={12} /></span></div>
          {activeFile && store.texts[activeFile] !== undefined
            ? <textarea className="experience-code" aria-label={`${activeFile} の内容`} spellCheck={false} value={store.texts[activeFile]} onChange={event => store.setFileText(activeFile, event.target.value)} />
            : <div className="empty">編集できるファイルがありません。プロジェクトZIPを読み込み直してください。</div>}
          <p className="muted small">{manifest?.runtime === "static" ? "独自HTML（静的サイト）は、元の制作環境でビルド済みのファイルを読み込みます。Viteなどのビルド処理はここでは実行しません。" : "TypeScript作品の試遊はブラウザ内で行います。"}</p>
        </div>
      </section>
      <section className="experience-preview" aria-label="試遊画面">
        <div className="experience-preview-toolbar"><b>試遊</b><span className="muted small">{assetCount}素材</span></div>
        {manifestIssues.length > 0 && <div className="notice error">{manifestIssues.join("\n")}</div>}
        {error && <div className="notice error experience-error">{error}</div>}
        {manifest?.runtime === "static" ? <div className="experience-preview-empty experience-static-preview"><Code2 size={22} /><p>独自HTML（静的サイト）は、完成済みのファイルをそのまま配布します。</p>
          {staticCommand ? <><p className="muted small">{manifest?.build ? "1行目は experience.json の build.command を実行して公開ZIPを作り、2行目で試遊します。設定内容を確認してからリポジトリのルートで実行してください。" : "この作品をローカルの試遊サーバーで開くコマンドです。リポジトリのルートで実行してください。"}</p>{manifest?.build && <p className="muted small">設定コマンド: <code>{manifest.build.command}</code></p>}<div className="experience-static-command"><code>{staticCommand}</code><button type="button" onClick={() => void copyStaticCommand()}><ClipboardCopy size={13} /> {commandCopied ? "コピーしました" : manifest?.build ? "ビルド・試遊コマンドをコピー" : "試遊コマンドをコピー"}</button></div>{status.startsWith("クリップボード") && <p className="muted small" role="status">{status}</p>}</>
            : <><p className="muted small">ブラウザ版の作品を試遊するには、作品ZIPを書き出し、RPG Studioリポジトリの projects/ に展開してから、リポジトリのルートで実行してください。{manifest?.build ? "1行目は設定コマンドを明示的に実行するため、experience.json の内容を先に確認してください。" : ""}</p><ol><li>「プロジェクトをZIPで書き出す」</li><li>ZIPを projects/ の中に展開する</li><li>次のコマンドを実行する</li></ol><code>{browserStaticCommand}</code></>}
        </div>
          : bundle
          ? <iframe key={`${token}-${frameVersion}`} ref={frame} title="独立作品の試遊" sandbox="allow-scripts" srcDoc={experiencePreviewDocument(token)} onLoad={() => setFrameReady(true)} />
          : <div className="experience-preview-empty"><Code2 size={22} /><p>{status}</p><button onClick={() => void runPreview()} disabled={manifestIssues.length > 0}>プレビューを作る</button></div>}
        {manifest?.runtime !== "static" && <p className="muted small" role="status">{status}</p>}
      </section>
    </div>
    {manifest && <ExperienceAssetsPanel store={store} source={source} />}
    <section className="experience-boundary"><b>この形式の現在地</b><p>「思いついたものを形にする」ため、RPGの標準ルールを持ち込みません。作品ZIPはブラウザで作れます。{manifest?.runtime === "static" ? "静的サイト型は作者が選んだ構成を使います。ソースビルドはローカルCLIだけで設定でき、コマンドは --run-project-build を明示した場合に限り実行します。" : "状態遷移型の完全な型検査はローカルCLIで行います。"} ブラウザ工房から有料のAI API・クラウドビルドは呼びません。</p></section>
  </div>;
}

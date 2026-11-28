import { useMemo, useRef, useState } from "react";
import { ImagePlus, Upload } from "lucide-react";
import { AssetManifestSchema, ExperienceProjectSchema, type AssetEntry } from "@rpg/schema";
import type { PreviewSource, ProjectSource } from "../lib/source";
import type { ProjectStore } from "../lib/useProject";

const IMAGE_KINDS: AssetEntry["kind"][] = ["tileset", "character", "enemy", "animation", "portrait", "background"];
const KIND_LABEL: Record<AssetEntry["kind"], string> = { tileset: "タイル", character: "キャラクター", enemy: "敵", animation: "アニメーション", portrait: "立ち絵", background: "背景", bgm: "BGM", sfx: "効果音", song: "楽譜", font: "フォント" };
const ORIGIN_LABEL: Record<AssetEntry["origin"], string> = { original: "自作", generated: "生成", site: "サイト", purchased: "購入", commission: "依頼" };

export default function ExperienceAssetsPanel({ store, source }: { store: ProjectStore; source: ProjectSource }) {
  const [file, setFile] = useState<File | null>(null);
  const [id, setId] = useState("");
  const [kind, setKind] = useState<AssetEntry["kind"]>("character");
  const [origin, setOrigin] = useState<AssetEntry["origin"]>("original");
  const [license, setLicense] = useState("プロジェクト内素材");
  const [sourceId, setSourceId] = useState("");
  const [termsCheckedAt, setTermsCheckedAt] = useState("");
  const [licenseUrl, setLicenseUrl] = useState("");
  const [url, setUrl] = useState("");
  const [author, setAuthor] = useState("");
  const [credit, setCredit] = useState("");
  const [notes, setNotes] = useState("");
  const [creditRequired, setCreditRequired] = useState(false);
  const [redistributable, setRedistributable] = useState(true);
  const [generator, setGenerator] = useState("");
  const [tileWidth, setTileWidth] = useState(32);
  const [tileHeight, setTileHeight] = useState(32);
  const [columns, setColumns] = useState(1);
  const [rows, setRows] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const entries = useMemo(() => {
    try {
      const project = ExperienceProjectSchema.parse(JSON.parse(store.texts["experience.json"] ?? ""));
      return AssetManifestSchema.parse(JSON.parse(store.texts[project.assetsPath] ?? "")).assets;
    } catch { return null; }
  }, [store.texts]);
  const external = origin === "site" || origin === "purchased" || origin === "commission";

  const chooseFile = (picked?: File) => {
    if (!picked) return;
    setFile(picked);
    setError(null);
    const safeId = picked.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 96);
    setId(safeId || "asset");
    const lower = picked.name.toLowerCase();
    if (lower.endsWith(".png") || picked.type === "image/png") {
      setKind("character");
      const objectUrl = URL.createObjectURL(picked);
      const image = new Image();
      image.onload = () => { setTileWidth(image.naturalWidth || 32); setTileHeight(image.naturalHeight || 32); setColumns(1); setRows(1); URL.revokeObjectURL(objectUrl); };
      image.onerror = () => URL.revokeObjectURL(objectUrl);
      image.src = objectUrl;
    } else if (/\.(woff2?|ttf|otf)$/.test(lower)) setKind("font");
    else setKind("sfx");
  };

  const importFile = async () => {
    if (!file || !source.importAsset) return;
    if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(id.trim())) { setError("IDは英数字で始め、英数字・._-で指定してください。"); return; }
    if (file.size > 20 * 1024 * 1024) { setError("ファイルは20MBまでです。"); return; }
    if (external && !sourceId.trim()) { setAdvancedOpen(true); setError("外部素材の出典IDを記録してください。"); return; }
    if (external && (!license.trim() || license.trim() === "プロジェクト内素材" || !termsCheckedAt)) { setAdvancedOpen(true); setError("外部素材は規約・ライセンス名と、規約を実際に確認した日が必要です。"); return; }
    if (origin === "site" && !url.trim()) { setAdvancedOpen(true); setError("サイト素材は入手したページのURLが必要です。"); return; }
    if (creditRequired && !credit.trim()) { setAdvancedOpen(true); setError("クレジットが必要な素材は表示文言を記録してください。"); return; }
    if (origin === "generated" && !generator.trim()) { setAdvancedOpen(true); setError("生成素材は使用したツール名を記録してください。"); return; }
    setBusy(true); setError(null);
    try {
      const entry: Record<string, unknown> = {
        id: id.trim(), kind, origin, license: license.trim(), creditRequired, redistributable,
        ...(sourceId.trim() ? { sourceId: sourceId.trim() } : {}),
        ...(termsCheckedAt ? { termsCheckedAt } : {}), ...(licenseUrl.trim() ? { licenseUrl: licenseUrl.trim() } : {}), ...(url.trim() ? { url: url.trim() } : {}),
        ...(author.trim() ? { author: author.trim() } : {}), ...(credit.trim() ? { credit: credit.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(origin === "generated" ? { generator: { tool: generator.trim() } } : {}),
        ...(IMAGE_KINDS.includes(kind) ? { tileWidth, tileHeight, columns, rows } : {}),
      };
      const result = await source.importAsset(file, entry);
      if (!result.ok) throw new Error(result.error);
      const project = ExperienceProjectSchema.parse(JSON.parse(store.texts["experience.json"] ?? ""));
      if (source.kind === "preview") {
        const assetsText = (source as PreviewSource).project?.texts[project.assetsPath];
        if (assetsText === undefined) throw new Error(`${project.assetsPath} を更新できませんでした`);
        store.setFileText(project.assetsPath, assetsText);
      } else await store.reload([project.assetsPath]);
      store.log("ok", `素材 ${result.asset.id} を ${result.asset.path} に取り込み、出典を記録しました`);
      setFile(null); setId(""); setSourceId(""); setTermsCheckedAt(""); setLicenseUrl(""); setUrl(""); setAuthor(""); setCredit(""); setNotes("");
      if (input.current) input.current.value = "";
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message); store.log("error", `素材を取り込めません: ${message}`);
    } finally { setBusy(false); }
  };

  return <section className="experience-assets">
    <div className="experience-assets-heading"><div><h3><ImagePlus size={15} /> 素材と出典</h3><p className="muted small">画像・音声・フォントの本体を作品に保存し、出典と利用条件を assets.json に記録します。外部通信や有料サービスは使いません。</p></div><span className="badge">{entries?.length ?? 0} 件</span></div>
    <div className="experience-assets-grid">
      <div className="experience-assets-form">
        <input ref={input} type="file" accept=".png,.ogg,.mp3,.wav,.woff2,.woff,.ttf,.otf" onChange={event => chooseFile(event.target.files?.[0])} />
        <div className="field-row">
          <label className="field"><span className="field-label">ファイル</span><button type="button" onClick={() => input.current?.click()}><Upload size={13} /> {file?.name ?? "ファイルを選ぶ"}</button></label>
          <label className="field"><span className="field-label">素材ID</span><input value={id} onChange={event => setId(event.target.value)} placeholder="my-asset" /></label>
        </div>
        <div className="field-row">
          <label className="field"><span className="field-label">種類</span><select value={kind} onChange={event => setKind(event.target.value as AssetEntry["kind"])}>{([...IMAGE_KINDS, "bgm", "sfx", "font"] as AssetEntry["kind"][]).map(value => <option key={value} value={value}>{KIND_LABEL[value]}</option>)}</select></label>
          <label className="field"><span className="field-label">入手方法</span><select value={origin} onChange={event => { const nextOrigin = event.target.value as AssetEntry["origin"]; setOrigin(nextOrigin); if (nextOrigin !== "original") setAdvancedOpen(true); }} >{Object.entries(ORIGIN_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        {IMAGE_KINDS.includes(kind) && <div className="field-row experience-asset-dimensions">
          <label className="field"><span className="field-label">1コマ幅</span><input type="number" min="1" value={tileWidth} onChange={event => setTileWidth(Number(event.target.value))} /></label>
          <label className="field"><span className="field-label">1コマ高さ</span><input type="number" min="1" value={tileHeight} onChange={event => setTileHeight(Number(event.target.value))} /></label>
          <label className="field"><span className="field-label">列</span><input type="number" min="1" value={columns} onChange={event => setColumns(Number(event.target.value))} /></label>
          <label className="field"><span className="field-label">行</span><input type="number" min="1" value={rows} onChange={event => setRows(Number(event.target.value))} /></label>
        </div>}
        <details className="experience-assets-advanced" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
          <summary>出典・利用条件（詳細）</summary>
          <div className="field-row">
            <label className="field"><span className="field-label">規約・ライセンス</span><input value={license} onChange={event => setLicense(event.target.value)} placeholder="例: CC BY 4.0" /></label>
            {external && <label className="field"><span className="field-label">出典名</span><input value={sourceId} onChange={event => setSourceId(event.target.value)} placeholder="サイト名や作者名" /></label>}
          </div>
          {external && <div className="field-row">
            <label className="field"><span className="field-label">規約確認日</span><input type="date" value={termsCheckedAt} onChange={event => setTermsCheckedAt(event.target.value)} /></label>
            {origin === "site" && <label className="field"><span className="field-label">入手元URL</span><input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://..." /></label>}
          </div>}
          {external && <label className="field"><span className="field-label">ライセンスURL（任意）</span><input type="url" value={licenseUrl} onChange={event => setLicenseUrl(event.target.value)} placeholder="https://..." /></label>}
          {origin === "generated" && <label className="field"><span className="field-label">生成ツール</span><input value={generator} onChange={event => setGenerator(event.target.value)} placeholder="使用したツール名" /></label>}
          <div className="field-row">
            <label className="field"><span className="field-label">作者名（任意）</span><input value={author} onChange={event => setAuthor(event.target.value)} /></label>
            <label className="field"><span className="field-label">クレジット表記</span><input value={credit} onChange={event => setCredit(event.target.value)} /></label>
          </div>
          <label className="field"><span className="field-label">作者・規約の注意（任意）</span><input value={notes} onChange={event => setNotes(event.target.value)} placeholder="利用時に気をつけること" /></label>
          <div className="row experience-assets-options"><label><input type="checkbox" checked={creditRequired} onChange={event => { setCreditRequired(event.target.checked); if (event.target.checked) setAdvancedOpen(true); }} /> クレジット必須</label><label><input type="checkbox" checked={redistributable} onChange={event => setRedistributable(event.target.checked)} /> 素材ファイルの再配布可</label></div>
          {error && <div className="notice error">{error}</div>}
        </details>
        {error && !advancedOpen && <div className="notice error">{error}</div>}
        <button className="primary" type="button" onClick={() => void importFile()} disabled={!file || busy || !source.importAsset}><Upload size={13} />{busy ? "取り込み中…" : "素材を取り込む"}</button>
      </div>
      <div className="experience-assets-list">
        <b>登録済み素材</b>
        {entries === null ? <p className="muted small">assets.json がまだ読めません。作品情報を確認してください。</p> : entries.length === 0 ? <p className="muted small">素材はまだありません。</p> : entries.map(asset => <article key={asset.id}>
          <div><b>{asset.id}</b> <span className="tag">{KIND_LABEL[asset.kind]}</span> <span className="muted small">{ORIGIN_LABEL[asset.origin]}</span></div>
          <code>{asset.path}</code>
          <p className="muted small">{asset.license}{asset.author ? ` · ${asset.author}` : ""}{asset.credit ? ` · ${asset.credit}` : ""}{asset.sourceId ? ` · 出典 ${asset.sourceId}` : ""}{asset.termsCheckedAt ? ` · 規約確認 ${asset.termsCheckedAt}` : ""}</p>
          {asset.licenseUrl && <a className="muted small" href={asset.licenseUrl} target="_blank" rel="noreferrer">ライセンスURL</a>}
          {asset.notes && <p className="muted small">注意: {asset.notes}</p>}
        </article>)}
      </div>
    </div>
  </section>;
}

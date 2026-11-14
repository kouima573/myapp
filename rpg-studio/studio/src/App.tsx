import { useCallback, useEffect, useMemo, useState } from "react";
import { Image as ImageIcon, CheckCircle2, ChevronDown, ChevronUp, Database, FlaskConical, Gamepad2, Loader2, Map as MapIcon, XCircle, AlertTriangle, Save } from "lucide-react";
import { GameMapSchema, TilesetSchema, type GameContent, type GameMap } from "@rpg/schema";
import { loadImages, type ImageMap } from "../../packages/runtime/src/render";
import MapEditor, { type Selection } from "./components/MapEditor";
import Inspector from "./components/Inspector";
import PlayPanel from "./components/PlayPanel";
import DataPanel from "./components/DataPanel";
import ChecksPanel from "./components/ChecksPanel";
import AssetsPanel from "./components/AssetsPanel";
import ConflictDialog from "./components/ConflictDialog";
import { useProject } from "./lib/useProject";
import type { ProjectSource } from "./lib/source";

type Section = "map" | "play" | "data" | "assets" | "checks";
const SECTIONS: Array<{ id: Section; label: string; icon: typeof MapIcon }> = [
  { id: "map", label: "マップ", icon: MapIcon },
  { id: "play", label: "試遊", icon: Gamepad2 },
  { id: "data", label: "データ", icon: Database },
  { id: "assets", label: "素材", icon: ImageIcon },
  { id: "checks", label: "検証", icon: FlaskConical },
];

/** For the editor: the last valid project, with any map/tileset that parses on its own swapped in, so painting stays live even while another file has an error. */
function editorContent(texts: Record<string, string>, base: GameContent | null): GameContent | null {
  if (!base) return null;
  const maps: Record<string, GameMap> = { ...base.maps };
  for (const ref of base.project.maps) {
    try { const parsed = GameMapSchema.safeParse(JSON.parse(texts[ref.path] ?? "")); if (parsed.success) maps[ref.id] = parsed.data; } catch { /* keep last good */ }
  }
  let tileset = base.tileset;
  try { const parsed = TilesetSchema.safeParse(JSON.parse(texts[base.project.tilesetPath] ?? "")); if (parsed.success) tileset = parsed.data; } catch { /* keep */ }
  return { ...base, maps, tileset };
}

export default function App({ source }: { source: ProjectSource }) {
  const store = useProject(source);
  const [section, setSection] = useState<Section>("map");
  const [mapId, setMapId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [dataFile, setDataFile] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<{ mapId: string; x: number; y: number; nonce: number } | null>(null);
  const [images, setImages] = useState<ImageMap>({});
  const [imageRevision, setImageRevision] = useState(0);
  const [consoleOpen, setConsoleOpen] = useState(() => !window.matchMedia?.("(max-width: 900px)").matches);

  const playContent = store.content ?? store.lastGoodContent;
  const editContent = useMemo(() => editorContent(store.texts, store.content ?? store.lastGoodContent), [store.texts, store.content, store.lastGoodContent]);
  const activeMapId = mapId && editContent?.maps[mapId] ? mapId : editContent?.project.start.mapId ?? null;

  const assetKey = playContent ? JSON.stringify(playContent.assets) : "";
  useEffect(() => {
    if (!playContent) return;
    setImages(loadImages(playContent, asset => source.assetUrl(asset), () => setImageRevision(r => r + 1)));
  }, [assetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const playFrom = useCallback((x: number, y: number) => {
    if (!activeMapId) return;
    setStartAt({ mapId: activeMapId, x, y, nonce: Date.now() });
    setSection("play");
    store.log("info", `${activeMapId} (${x}, ${y}) から試遊を開始します`);
  }, [activeMapId, store]);

  const errors = store.diagnostics.filter(d => d.severity === "error").length;
  const warnings = store.diagnostics.length - errors;
  const openFile = (file: string) => { setDataFile(file); setSection("data"); };

  if (store.status === "loading") return <div className="splash"><Loader2 className="spin" /> プロジェクトを読み込んでいます…</div>;
  if (store.status === "error") return <div className="splash error"><XCircle /> 読み込めません: {store.loadError}</div>;

  return <main className={`studio section-${section}`}>
    <header className="topbar">
      <div className="brand"><img src="./favicon.svg" alt="" width={26} height={26} /><div><b>RPGシステム工房</b><span>AGENT WORKBENCH 0.4</span></div></div>
      <div className="project-pill" title={store.texts["project.json"] ? "project.json" : ""}>
        <span>{playContent?.project.title ?? "（検証エラー）"}</span><code>{playContent?.project.id}</code>
      </div>
      <div className="top-status">
        <span className={`pill ${source.kind === "local" ? "ok" : "warn"}`}><span className="dot" />{source.kind === "local" ? "ローカルファイル接続" : "Preview（保存されません）"}</span>
        <button className={`pill ${errors ? "error" : warnings ? "warn" : "ok"}`} onClick={() => setSection("checks")}>
          {errors ? <XCircle size={12} /> : warnings ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
          {errors ? `エラー ${errors}` : warnings ? `警告 ${warnings}` : "検証OK"}
        </button>
        {source.kind === "local" && <span className={`pill ${store.build?.state === "error" ? "error" : store.build?.state === "ready" ? "ok" : ""}`}>
          {store.build?.state === "building" ? <Loader2 size={12} className="spin" /> : null}
          ビルド {store.build?.state === "ready" ? "OK" : store.build?.state === "error" ? "失敗" : store.build?.state === "building" ? "中" : "待機"}
        </span>}
        <span className={`pill ${store.dirty.size ? "warn" : ""}`} title={[...store.dirty].join("\n")}><Save size={12} />{store.dirty.size ? `保存待ち ${store.dirty.size}` : "保存済み"}</span>
      </div>
    </header>

    <nav className="sidebar" aria-label="機能">
      <div className="section-tabs" role="tablist">
        {SECTIONS.map(s => <button key={s.id} role="tab" aria-selected={section === s.id} className={`section-tab ${section === s.id ? "is-active" : ""}`} onClick={() => setSection(s.id)}>
          <s.icon size={16} /><span>{s.label}</span>
          {s.id === "checks" && errors > 0 && <span className="count error">{errors}</span>}
        </button>)}
      </div>
      {editContent && (section === "map" || section === "play") && <div className="map-list">
        <div className="side-heading">マップ</div>
        {editContent.project.maps.map(ref => <button key={ref.id} className={`map-item ${activeMapId === ref.id ? "is-active" : ""}`} onClick={() => { setMapId(ref.id); setSelection(null); if (section === "play") { const m = editContent.maps[ref.id]; if (m) setStartAt({ mapId: ref.id, x: editContent.project.start.mapId === ref.id ? editContent.project.start.x : Math.floor(m.width / 2), y: editContent.project.start.mapId === ref.id ? editContent.project.start.y : Math.floor(m.height / 2), nonce: Date.now() }); } }}>
          <MapIcon size={13} /><span>{ref.title}</span>{editContent.project.start.mapId === ref.id && <span className="tag">開始</span>}{store.dirty.has(ref.path) && <span className="dot amber" />}
        </button>)}
        <p className="muted small side-note">マップの追加は、JSONファイルを作って project.json の maps に登録します（エージェントに依頼するのが簡単です）。</p>
      </div>}
      {source.kind === "preview" && <div className="side-callout">
        <b>Previewモード</b>
        <p>サンプルを画面上で試せます。編集はこのタブの中だけに残り、ファイルには保存されません。PCで <code>pnpm studio</code> を起動すると、Codex／Claude Codeと同じファイルを編集できます。</p>
      </div>}
    </nav>

    <section className="workspace">
      {section === "map" && editContent && activeMapId && <div className="map-workspace">
        <MapEditor store={store} content={editContent} mapId={activeMapId} images={images} imageRevision={imageRevision} selection={selection} onSelect={setSelection} onPlayFrom={playFrom} />
        <aside className="inspector-pane"><Inspector store={store} content={editContent} mapId={activeMapId} selection={selection} onSelect={setSelection} onPlayFrom={playFrom} /></aside>
      </div>}
      {section === "play" && playContent && <PlayPanel store={store} content={playContent} stale={!store.content} systems={store.systems} systemsVersion={store.systemsVersion} source={source} startAt={startAt} />}
      {section === "data" && <DataPanel store={store} diagnostics={store.diagnostics} file={dataFile} onFile={setDataFile} />}
      {section === "assets" && playContent && <AssetsPanel store={store} content={playContent} images={images} />}
      {section === "checks" && <ChecksPanel store={store} diagnostics={store.diagnostics} onOpenFile={openFile} />}
      {!editContent && section !== "data" && section !== "checks" && <div className="empty">プロジェクトが一度も検証を通っていません。「検証」と「データ」で問題を直してください。</div>}
    </section>

    <footer className={`console ${consoleOpen ? "is-open" : ""}`}>
      <button className="console-toggle" onClick={() => setConsoleOpen(o => !o)}>
        {consoleOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />} ログ
        <span className="muted small">{store.logs[0]?.text}</span>
      </button>
      {consoleOpen && <ol className="log-list">{store.logs.slice(0, 40).map(entry => <li key={entry.id} className={entry.level}><time>{entry.at.toLocaleTimeString("ja-JP")}</time>{entry.text}</li>)}</ol>}
    </footer>

    {store.conflicts[0] && <ConflictDialog key={store.conflicts[0].path} conflict={store.conflicts[0]} onResolve={choice => void store.resolveConflict(store.conflicts[0]!.path, choice)} />}
  </main>;
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Image as ImageIcon, CheckCircle2, ChevronDown, ChevronUp, Database, FlaskConical, Gamepad2, Lightbulb, Loader2, Map as MapIcon, MessageSquare, Plus, ScrollText, Swords, Code2, Palette, Library, XCircle, AlertTriangle, Save, History as HistoryIcon, Globe2, Search, GraduationCap, Music, Hexagon, LifeBuoy, Undo2, Redo2, MessagesSquare } from "lucide-react";
import { GameMapSchema, TilesetSchema, type GameContent, type GameMap, type GameState } from "@rpg/schema";
import { loadImages, type ImageMap } from "../../packages/runtime/src/render";
import MapEditor, { type Selection } from "./components/MapEditor";
import Inspector from "./components/Inspector";
import PlayPanel from "./components/PlayPanel";
import DataPanel from "./components/DataPanel";
import ChecksPanel from "./components/ChecksPanel";
import AssetsPanel from "./components/AssetsPanel";
import IdeaPanel from "./components/IdeaPanel";
import StoryPanel from "./components/StoryPanel";
import RulesPanel from "./components/RulesPanel";
import DatabasePanel from "./components/DatabasePanel";
import ScriptsPanel from "./components/ScriptsPanel";
import PixelEditor from "./components/PixelEditor";
import LibraryPanel from "./components/LibraryPanel";
import HistoryPanel from "./components/HistoryPanel";
import WorldPanel from "./components/WorldPanel";
import SearchPanel from "./components/SearchPanel";
import TutorialPanel from "./components/TutorialPanel";
import SongPanel from "./components/SongPanel";
import SkillBoardPanel from "./components/SkillBoardPanel";
import HelpPanel from "./components/HelpPanel";
import ChatPanel from "./components/ChatPanel";
import { glossaryLookup } from "./lib/glossary";
import { generateDungeon } from "../../packages/engine/src/dungeon";
import CodeFinder from "./components/CodeFinder";
import ConflictDialog from "./components/ConflictDialog";
import { useProject } from "./lib/useProject";
import type { ProjectSource } from "./lib/source";

type Section = "idea" | "map" | "story" | "rules" | "database" | "scripts" | "pixel" | "library" | "play" | "data" | "assets" | "checks" | "history" | "world" | "search" | "tutorial" | "song" | "skills" | "help" | "chat";
const SECTIONS: Array<{ id: Section; label: string; icon: typeof MapIcon }> = [
  { id: "tutorial", label: "はじめての5分", icon: GraduationCap },
  { id: "idea", label: "発想", icon: Lightbulb },
  { id: "chat", label: "チャットで作る", icon: MessagesSquare },
  { id: "map", label: "マップ", icon: MapIcon },
  { id: "world", label: "ワールド全体図", icon: Globe2 },
  { id: "story", label: "会話・イベント", icon: MessageSquare },
  { id: "rules", label: "ルール・特性", icon: ScrollText },
  { id: "database", label: "敵・アイテム・仲間", icon: Swords },
  { id: "skills", label: "スキルボード", icon: Hexagon },
  { id: "scripts", label: "スクリプト（コード）", icon: Code2 },
  { id: "pixel", label: "ドット絵", icon: Palette },
  { id: "library", label: "素材ライブラリ", icon: Library },
  { id: "song", label: "楽譜BGM", icon: Music },
  { id: "play", label: "試遊", icon: Gamepad2 },
  { id: "data", label: "データ", icon: Database },
  { id: "search", label: "検索・置換", icon: Search },
  { id: "assets", label: "素材", icon: ImageIcon },
  { id: "checks", label: "検証", icon: FlaskConical },
  { id: "history", label: "保存履歴", icon: HistoryIcon },
  { id: "help", label: "ヘルプ・完成チェック", icon: LifeBuoy },
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
  const [findingCode, setFindingCode] = useState(false);
  const [mapId, setMapId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [dataFile, setDataFile] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<{ mapId: string; x: number; y: number; nonce: number } | null>(null);
  /** A whole game state to open in the play-test (e.g. where a scenario test failed). */
  const [playState, setPlayState] = useState<{ state: GameState; nonce: number } | null>(null);
  const [images, setImages] = useState<ImageMap>({});
  const [imageRevision, setImageRevision] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light" | "contrast">(() => { try { const t = localStorage.getItem("rpg-studio:theme"); return t === "light" || t === "contrast" ? t : "dark"; } catch { return "dark"; } });
  useEffect(() => {
    if (theme === "dark") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("rpg-studio:theme", theme); } catch { /* optional */ }
  }, [theme]);
  useEffect(() => {
    const onHistoryKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (!event.ctrlKey && !event.metaKey) || event.altKey || section === "map" || store.conflicts.length) return;
      const key = event.key.toLowerCase();
      const undo = key === "z" && !event.shiftKey;
      const redo = key === "y" || (key === "z" && event.shiftKey);
      if (!undo && !redo) return;
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "file", "color"].includes(target.type)) return;
      const file = store.lastEditedFile;
      if (!file) return;
      const history = store.historyState(file);
      if (undo ? !history.canUndo : !history.canRedo) return;
      event.preventDefault();
      if (undo) store.undo(file); else store.redo(file);
    };
    window.addEventListener("keydown", onHistoryKey);
    return () => window.removeEventListener("keydown", onHistoryKey);
  }, [section, store]);
  // 用語の説明 (010): field labels and section names explain themselves on hover.
  useEffect(() => {
    const apply = () => document.querySelectorAll<HTMLElement>(".field-label, .section-tab span, .side-heading, .panel-page h2, .card h3").forEach(el => {
      if (el.title || el.dataset.glossed) return;
      const tip = glossaryLookup(el.textContent ?? "");
      el.dataset.glossed = "1";
      if (tip) { el.title = tip; el.classList.add("has-gloss"); }
    });
    apply();
    const observer = new MutationObserver(() => apply());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
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
  const historyFile = store.lastEditedFile;
  const globalHistory = historyFile ? store.historyState(historyFile) : { canUndo: false, canRedo: false };
  const openFile = (file: string) => { setDataFile(file); setSection("data"); };

  if (store.status === "loading") return <div className="splash"><Loader2 className="spin" /> プロジェクトを読み込んでいます…</div>;
  if (store.status === "error") return <div className="splash error"><XCircle /> 読み込めません: {store.loadError}</div>;

  return <main className={`studio section-${section} ${findingCode ? "is-finding-code" : ""}`}>
    <CodeFinder active={findingCode} onExit={() => setFindingCode(false)} repoRoot={store.projectInfo.repoRoot} projectDir={store.projectInfo.projectDir} />
    <header className="topbar">
      <div className="brand"><img src="./favicon.svg" alt="" width={26} height={26} /><div><b>RPGシステム工房</b><span>AGENT WORKBENCH 1.0</span></div></div>
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
        <button className={`pill ${findingCode ? "warn" : ""}`} title="画面の部品をクリックすると、その部分を作っているコードの場所を表示（Alt+クリックでもいつでも）" onClick={() => setFindingCode(v => !v)}><Code2 size={12} />{findingCode ? "コードを探す（Escで終了）" : "コードを探す"}</button>
        <button className="pill" title={`元に戻す${historyFile ? `: ${historyFile}` : ""}（Ctrl/⌘+Z）`} aria-label="元に戻す" disabled={!globalHistory.canUndo} onClick={() => historyFile && store.undo(historyFile)}><Undo2 size={12} /></button>
        <button className="pill" title={`やり直す${historyFile ? `: ${historyFile}` : ""}（Ctrl/⌘+Y）`} aria-label="やり直す" disabled={!globalHistory.canRedo} onClick={() => historyFile && store.redo(historyFile)}><Redo2 size={12} /></button>
        <button className="pill" title="工房の配色（暗い・明るい・高コントラスト）" onClick={() => setTheme(t => (t === "dark" ? "light" : t === "light" ? "contrast" : "dark"))}>{theme === "dark" ? "配色: 暗い" : theme === "light" ? "配色: 明るい" : "配色: 高コントラスト"}</button>
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
        {section === "map" && <NewMapForm content={editContent} onCreate={(id, title, width, height, fill, dungeon) => {
          const rows = dungeon ? generateDungeon({ width, height, seed: dungeon.seed, floor: fill, wall: dungeon.wall }).rows : Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (x === 0 || y === 0 || x === width - 1 || y === height - 1) && editContent.tileset.tiles.some(t => t.code === "T") ? "T" : fill).join(""));
          const path = `maps/${id}.json`;
          store.setFileText(path, `${JSON.stringify({ formatVersion: 2, id, title, width, height, rows, npcs: [], portals: [], interactables: [], entities: [] }, null, 2)}\n`);
          store.updateJson<{ maps: Array<{ id: string; path: string; title: string }> }>("project.json", p => { p.maps.push({ id, path, title }); });
          setMapId(id);
          store.log("info", `マップ ${id} を作りました。出入口（portals）でほかのマップとつなげます`);
        }} />}
      </div>}
      {source.kind === "preview" && <div className="side-callout">
        <b>Previewモード</b>
        <p>サンプルを画面上で試せます。編集はこのタブの中だけに残り、ファイルには保存されません。PCで <code>pnpm studio</code> を起動すると、Codex／Claude Codeと同じファイルを編集できます。</p>
      </div>}
    </nav>

    <section className="workspace">
      {section === "idea" && <IdeaPanel store={store} content={playContent} />}
      {section === "story" && playContent && <StoryPanel store={store} content={playContent} onOpenFile={openFile} />}
      {section === "rules" && playContent && <RulesPanel store={store} content={playContent} />}
      {section === "database" && playContent && <DatabasePanel store={store} content={playContent} onOpenFile={openFile} />}
      {section === "scripts" && playContent && <ScriptsPanel store={store} content={playContent} />}
      {section === "library" && playContent && <LibraryPanel store={store} content={playContent} />}
      {section === "pixel" && playContent && <PixelEditor store={store} content={playContent} images={images} />}
      {section === "map" && editContent && activeMapId && <div className="map-workspace">
        <MapEditor store={store} content={editContent} mapId={activeMapId} images={images} imageRevision={imageRevision} selection={selection} onSelect={setSelection} onPlayFrom={playFrom} />
        <aside className="inspector-pane"><Inspector store={store} content={editContent} mapId={activeMapId} selection={selection} onSelect={setSelection} onPlayFrom={playFrom} onOpenFile={openFile} /></aside>
      </div>}
      {section === "play" && playContent && <PlayPanel store={store} content={playContent} stale={!store.content} systems={store.systems} systemsVersion={store.systemsVersion} source={source} startAt={startAt} startState={playState} />}
      {section === "data" && <DataPanel store={store} diagnostics={store.diagnostics} file={dataFile} onFile={setDataFile} />}
      {section === "assets" && playContent && <AssetsPanel store={store} content={playContent} images={images} />}
      {section === "world" && playContent && <WorldPanel content={playContent} onOpenMap={id => { setMapId(id); setSelection(null); setSection("map"); }} />}
      {section === "chat" && <ChatPanel store={store} />}
      {section === "help" && playContent && <HelpPanel store={store} content={playContent} />}
      {section === "skills" && playContent && <SkillBoardPanel store={store} content={playContent} />}
      {section === "song" && playContent && <SongPanel store={store} content={playContent} />}
      {section === "tutorial" && playContent && <TutorialPanel store={store} content={playContent} onGo={s => setSection(s as Section)} />}
      {section === "search" && <SearchPanel store={store} onOpenFile={openFile} />}
      {section === "history" && <HistoryPanel store={store} source={source} />}
      {section === "checks" && <ChecksPanel store={store} diagnostics={store.diagnostics} onOpenFile={openFile} onPlayState={st => { setPlayState({ state: st, nonce: Date.now() }); setSection("play"); }} />}
      {!editContent && section !== "data" && section !== "checks" && section !== "chat" && <div className="empty">プロジェクトが一度も検証を通っていません。「検証」と「データ」で問題を直してください。</div>}
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

function NewMapForm({ content, onCreate }: { content: GameContent; onCreate: (id: string, title: string, width: number, height: number, fill: string, dungeon?: { seed: number; wall: string }) => void }) {
  const [dungeon, setDungeon] = useState(false);
  const walls = content.tileset.tiles.filter(t => !t.passable);
  const [wall, setWall] = useState(walls[0]?.code ?? "#");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [size, setSize] = useState({ w: 20, h: 14 });
  const passable = content.tileset.tiles.filter(t => t.passable);
  const [fill, setFill] = useState(passable[0]?.code ?? ".");
  const taken = new Set(content.project.maps.map(m => m.id));
  const valid = /^[a-z0-9][a-z0-9-]{0,40}$/.test(id) && !taken.has(id) && title.trim() && size.w >= 5 && size.h >= 5 && size.w <= 200 && size.h <= 200;
  if (!open) return <button className="button new-map" onClick={() => setOpen(true)}><Plus size={13} />新しいマップ</button>;
  return <div className="new-map-form">
    <input placeholder="ID（例: east-lake）" value={id} onChange={e => setId(e.target.value.toLowerCase())} />
    {taken.has(id) && <span className="field-error">そのIDは使われています</span>}
    <input placeholder="名前（例: 東の湖）" value={title} onChange={e => setTitle(e.target.value)} />
    <div className="field-row"><input type="number" min={5} max={200} value={size.w} onChange={e => setSize({ ...size, w: Number(e.target.value) })} /><span>×</span><input type="number" min={5} max={200} value={size.h} onChange={e => setSize({ ...size, h: Number(e.target.value) })} /></div>
    <select value={fill} onChange={e => setFill(e.target.value)} title="床">{passable.map(t => <option key={t.code} value={t.code}>{t.code} {t.name}</option>)}</select>
    <label className="check small"><input type="checkbox" checked={dungeon} onChange={e => setDungeon(e.target.checked)} /> 部屋と通路のダンジョンを自動生成</label>
    {dungeon && <div className="field-row">
      <select value={wall} onChange={e => setWall(e.target.value)} title="壁">{walls.map(t => <option key={t.code} value={t.code}>壁 {t.code} {t.name}</option>)}</select>
      <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value) || 1)} title="シード（同じ数なら同じ形）" style={{ width: "6em" }} />
    </div>}
    <div className="field-row"><button className="button primary" disabled={!valid || (dungeon && (size.w < 10 || size.h < 8))} onClick={() => { onCreate(id, title.trim(), size.w, size.h, fill, dungeon ? { seed, wall } : undefined); setOpen(false); setId(""); setTitle(""); }}>作る</button><button className="button" onClick={() => setOpen(false)}>やめる</button></div>
  </div>;
}

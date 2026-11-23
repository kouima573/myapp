import { useEffect, useMemo, useRef, useState } from "react";
import { FileJson2, FileCode2, FileText, Wand2, Undo2, Redo2, Search } from "lucide-react";
import { formatDiagnostic, type Diagnostic } from "@rpg/schema";
import type { ProjectStore } from "../lib/useProject";

interface Props {
  store: ProjectStore;
  diagnostics: Diagnostic[];
  file: string | null;
  onFile: (file: string) => void;
}

type DataCategory = "project" | "world" | "story" | "database" | "assets" | "tests" | "code" | "other";
const CATEGORIES: Array<{ id: DataCategory; title: string; help: string }> = [
  { id: "project", title: "プロジェクト", help: "作品の基本情報・説明書" },
  { id: "world", title: "マップ・世界", help: "マップ・タイル・美術資料" },
  { id: "story", title: "物語・ルール", help: "会話・イベント・ゲームルール" },
  { id: "database", title: "人物・敵・道具", help: "仲間・敵・能力・アイテム" },
  { id: "assets", title: "素材", help: "素材の出典情報・制作資料。画像や音声は「素材」画面で管理します" },
  { id: "tests", title: "テスト", help: "自動プレイのシナリオ" },
  { id: "code", title: "拡張コード", help: "独自の仕組み・スクリプト" },
  { id: "other", title: "その他", help: "上記に分類されないファイル" },
];
function categoryFor(path: string): DataCategory {
  if (["project.json", "README.md", "README.txt", "IDEA.md", "SPEC.md"].includes(path) || /^docs\//.test(path)) return "project";
  if (path.startsWith("maps/") || path === "tiles.json" || path.startsWith("art/") && /tile|map|world/i.test(path)) return "world";
  if (["rules.json"].includes(path) || path.startsWith("dialogues/") || path.startsWith("events/")) return "story";
  if (path === "database.json") return "database";
  if (path === "assets.json" || path.startsWith("assets/") || path.startsWith("art/")) return "assets";
  if (path.startsWith("tests/")) return "tests";
  if (path.startsWith("systems/") || path.startsWith("scripts/")) return "code";
  return "other";
}
function fileHelp(path: string): string {
  const fixed: Record<string, string> = {
    "project.json": "開始位置・主人公・フラグ・各データファイルの参照先",
    "tiles.json": "マップのタイルと通行ルール",
    "database.json": "人物・仲間・敵・能力・装備・アイテム",
    "assets.json": "素材ファイルの種類・出典・ライセンス・表示設定",
    "rules.json": "条件を満たしたときに起きる効果やゲーム進行のルール",
  };
  if (fixed[path]) return fixed[path]!;
  if (path.startsWith("maps/")) return "マップの地形・出入口・配置物";
  if (path.startsWith("dialogues/")) return "会話・選択肢・会話中の演出";
  if (path.startsWith("events/")) return "調べる場所・宝箱・イベントの処理";
  if (path.startsWith("tests/")) return "プレイヤー操作を再現する自動プレイシナリオ";
  if (path.startsWith("systems/")) return "戦闘や進行に独自の仕組みを追加するTypeScript";
  if (path.startsWith("scripts/")) return "会話やイベントから呼び出すTypeScript";
  if (path.startsWith("assets/")) return "ゲーム内で使う画像・音声などの実ファイル";
  if (path.startsWith("art/")) return "美術資料・生成依頼などの制作ファイル";
  return "プロジェクトに含まれるファイル";
}

export default function DataPanel({ store, diagnostics, file, onFile }: Props) {
  const files = useMemo(() => Object.keys(store.texts).sort((a, b) => a.localeCompare(b)), [store.texts]);
  const current = file && store.texts[file] !== undefined ? file : files[0] ?? null;
  const text = current ? store.texts[current] ?? "" : "";
  const [category, setCategory] = useState<DataCategory | "all">(() => current ? categoryFor(current) : "all");
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState(text);
  const [parseError, setParseError] = useState<string | null>(null);
  const editing = useRef(false);
  /** File text when the user started typing; if the store text moves away from it, the file changed externally. */
  const base = useRef(text);
  useEffect(() => { if (file && store.texts[file] !== undefined) setCategory(categoryFor(file)); }, [file, store.texts]);
  useEffect(() => { if (!editing.current) { setDraft(text); base.current = text; } }, [text, current]);
  useEffect(() => { editing.current = false; setParseError(null); }, [current]);
  // After a conflict on this file is resolved, show whatever the store now holds.
  const conflictOpen = store.conflicts.some(c => c.path === current);
  useEffect(() => { if (!conflictOpen && !editing.current) { setDraft(text); base.current = text; } }, [conflictOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const isJson = current?.endsWith(".json");
  const readOnly = current?.endsWith(".ts") && store.source.kind === "preview";
  const history = current ? store.historyState(current) : { canUndo: false, canRedo: false };
  const fileDiagnostics = diagnostics.filter(d => d.file === current);
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of diagnostics) if (d.file && d.severity === "error") map[d.file] = (map[d.file] ?? 0) + 1;
    return map;
  }, [diagnostics]);
  const categoryCounts = useMemo(() => {
    const result = new Map<DataCategory, number>();
    for (const path of files) result.set(categoryFor(path), (result.get(categoryFor(path)) ?? 0) + 1);
    return result;
  }, [files]);
  const visibleFiles = files.filter(path => (category === "all" || categoryFor(path) === category) && path.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  const activeCategory = category === "all" ? null : CATEGORIES.find(item => item.id === category);
  const selectCategory = (next: DataCategory | "all") => {
    setCategory(next);
    const nextFiles = files.filter(path => (next === "all" || categoryFor(path) === next) && path.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
    if (current && nextFiles.includes(current)) return;
    if (nextFiles[0]) onFile(nextFiles[0]);
  };

  const commit = (value: string) => {
    if (!current) return;
    if (isJson) {
      try { JSON.parse(value); setParseError(null); }
      catch (error) { setParseError(error instanceof Error ? error.message : String(error)); return; }
    }
    editing.current = false;
    if (store.texts[current] !== base.current) { store.raiseConflict(current, value); return; }
    base.current = value;
    store.setFileText(current, value);
  };

  const format = () => {
    try { const value = `${JSON.stringify(JSON.parse(draft), null, 2)}\n`; setDraft(value); commit(value); } catch (error) { setParseError(error instanceof Error ? error.message : String(error)); }
  };

  return <div className="data-panel">
    <nav className="file-list" aria-label="プロジェクトファイル">
      <label className="data-search"><Search size={13} /><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="テキストファイルを検索" aria-label="テキストファイルを検索" /></label>
      <div className="data-categories" aria-label="データの分類">
        <button className={`data-category ${category === "all" ? "is-active" : ""}`} onClick={() => selectCategory("all")}><span>すべてのデータ</span><span className="count">{files.length}</span></button>
        {CATEGORIES.filter(item => categoryCounts.has(item.id)).map(item => <button key={item.id} className={`data-category ${category === item.id ? "is-active" : ""}`} title={item.help} onClick={() => selectCategory(item.id)}>
          <span>{item.title}</span><span className="count">{categoryCounts.get(item.id)}</span>
        </button>)}
      </div>
      <div className="data-file-heading">{activeCategory?.title ?? "ファイル一覧"}<span>{visibleFiles.length}件</span></div>
      {visibleFiles.map(path => <button key={path} className={`file-item ${path === current ? "is-active" : ""}`} onClick={() => onFile(path)} title={fileHelp(path)}>
        {path.endsWith(".ts") ? <FileCode2 size={13} /> : path.endsWith(".json") ? <FileJson2 size={13} /> : <FileText size={13} />}
        <span className="file-name">{path}</span>
        {store.dirty.has(path) && <span className="dot amber" title="未保存" />}
        {counts[path] ? <span className="count error">{counts[path]}</span> : null}
      </button>)}
      {!visibleFiles.length && <p className="muted small data-empty">該当するファイルはありません。</p>}
    </nav>
    <div className="file-editor">
      {current && <>
        <div className="file-head">
          <div>
            <div className="mono">{current}</div>
            <div className="muted small">{fileHelp(current)}{current.startsWith("systems/") ? "（保存すると型検査・再ビルド）" : current.startsWith("tests/") ? "（検証画面から実行）" : ""}</div>
          </div>
          <span className="spacer" />
          <button className="button" title="元に戻す（Ctrl/⌘+Z）" aria-label="元に戻す" onClick={() => current && store.undo(current)} disabled={!history.canUndo}><Undo2 size={14} /></button>
          <button className="button" title="やり直す（Ctrl/⌘+Y）" aria-label="やり直す" onClick={() => current && store.redo(current)} disabled={!history.canRedo}><Redo2 size={14} /></button>
          {isJson && <button className="button" onClick={format} disabled={readOnly}><Wand2 size={14} /> 整形して保存</button>}
        </div>
        <textarea
          className={`code-editor ${parseError ? "has-error" : ""}`}
          value={draft}
          readOnly={readOnly}
          spellCheck={false}
          onChange={e => { if (!editing.current) base.current = text; editing.current = true; setDraft(e.target.value); }}
          onBlur={() => { if (editing.current) commit(draft); }}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); commit(draft); }
            if ((e.ctrlKey || e.metaKey) && !editing.current && e.key.toLowerCase() === "z") { e.preventDefault(); if (current) (e.shiftKey ? store.redo(current) : store.undo(current)); }
            if ((e.ctrlKey || e.metaKey) && !editing.current && e.key.toLowerCase() === "y") { e.preventDefault(); if (current) store.redo(current); }
            if (e.key === "Tab") { e.preventDefault(); const t = e.currentTarget; const s = t.selectionStart; const v = `${draft.slice(0, s)}  ${draft.slice(t.selectionEnd)}`; setDraft(v); if (!editing.current) base.current = text; editing.current = true; requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; }); }
          }}
          aria-label={`${current} の内容`}
        />
        <div className="file-foot">
          {parseError ? <span className="text-error">JSON構文エラー（保存していません）: {parseError}</span>
            : editing.current ? <span className="text-amber">編集中 — フォーカスを外すか Ctrl/⌘+S で保存</span>
            : store.dirty.has(current) ? <span className="text-amber">保存待ち…</span>
            : <span className="text-green">保存済み</span>}
          {readOnly && <span className="muted">Previewではシステムコードは読み取り専用です</span>}
        </div>
        {fileDiagnostics.length > 0 && <ul className="diag-list compact">{fileDiagnostics.map((d, i) => <li key={i} className={d.severity}>{formatDiagnostic(d)}</li>)}</ul>}
      </>}
    </div>
  </div>;
}

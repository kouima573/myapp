import { useEffect, useMemo, useRef, useState } from "react";
import { FileJson2, FileCode2, Wand2 } from "lucide-react";
import { formatDiagnostic, type Diagnostic } from "@rpg/schema";
import type { ProjectStore } from "../lib/useProject";

interface Props {
  store: ProjectStore;
  diagnostics: Diagnostic[];
  file: string | null;
  onFile: (file: string) => void;
}

const ORDER = ["project.json", "tiles.json", "database.json", "dialogues/", "events/", "maps/", "assets.json", "tests/", "systems/"];
const rank = (path: string) => { const i = ORDER.findIndex(prefix => path === prefix || path.startsWith(prefix)); return i < 0 ? 99 : i; };
const LABELS: Record<string, string> = {
  "project.json": "開始位置・主人公・フラグ宣言・ファイル参照",
  "tiles.json": "タイルの種類と通行ルール",
  "database.json": "能力・アイテム・敵",
  "assets.json": "素材の出典・寸法",
};

export default function DataPanel({ store, diagnostics, file, onFile }: Props) {
  const files = useMemo(() => Object.keys(store.texts).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)), [store.texts]);
  const current = file && store.texts[file] !== undefined ? file : files[0] ?? null;
  const text = current ? store.texts[current] ?? "" : "";
  const [draft, setDraft] = useState(text);
  const [parseError, setParseError] = useState<string | null>(null);
  const editing = useRef(false);
  /** File text when the user started typing; if the store text moves away from it, the file changed externally. */
  const base = useRef(text);
  useEffect(() => { if (!editing.current) { setDraft(text); base.current = text; } }, [text, current]);
  useEffect(() => { editing.current = false; setParseError(null); }, [current]);
  // After a conflict on this file is resolved, show whatever the store now holds.
  const conflictOpen = store.conflicts.some(c => c.path === current);
  useEffect(() => { if (!conflictOpen && !editing.current) { setDraft(text); base.current = text; } }, [conflictOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const isJson = current?.endsWith(".json");
  const readOnly = current?.endsWith(".ts") && store.source.kind === "preview";
  const fileDiagnostics = diagnostics.filter(d => d.file === current);
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of diagnostics) if (d.file && d.severity === "error") map[d.file] = (map[d.file] ?? 0) + 1;
    return map;
  }, [diagnostics]);

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
      {files.map(path => <button key={path} className={`file-item ${path === current ? "is-active" : ""}`} onClick={() => onFile(path)}>
        {path.endsWith(".ts") ? <FileCode2 size={13} /> : <FileJson2 size={13} />}
        <span className="file-name">{path}</span>
        {store.dirty.has(path) && <span className="dot amber" title="未保存" />}
        {counts[path] ? <span className="count error">{counts[path]}</span> : null}
      </button>)}
    </nav>
    <div className="file-editor">
      {current && <>
        <div className="file-head">
          <div>
            <div className="mono">{current}</div>
            <div className="muted small">{LABELS[current] ?? (current.startsWith("systems/") ? "信頼されたTypeScriptの独自ルール（保存すると型検査・再ビルド）" : current.startsWith("tests/") ? "自動プレイテスト（pnpm rpg test / 検証画面で実行）" : "")}</div>
          </div>
          <span className="spacer" />
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

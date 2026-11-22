import { useCallback, useEffect, useState } from "react";
import { History as HistoryIcon, RefreshCw, RotateCcw } from "lucide-react";
import type { HistoryEntryView } from "../../../packages/local-server/src/protocol";
import { summarizeChange } from "../../../packages/local-server/src/summary";
import type { ProjectSource } from "../lib/source";
import type { ProjectStore } from "../lib/useProject";

const SOURCE_LABEL: Record<HistoryEntryView["source"], string> = { studio: "工房で保存", outside: "外部（AI・エディター）", restore: "履歴から復元" };

/** Save history (roadmap 016): every change to a project file, with a plain-language summary (007) and one-click restore. */
export default function HistoryPanel({ store, source }: { store: ProjectStore; source: ProjectSource }) {
  const [file, setFile] = useState("");
  const [entries, setEntries] = useState<HistoryEntryView[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!source.history) return;
    try { setEntries(await source.history(file || undefined)); } catch (error) { store.log("error", `履歴を読めません: ${error instanceof Error ? error.message : String(error)}`); }
  }, [source, file, store]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!source.history) return <div className="panel-page"><h2><HistoryIcon size={18} /> 保存履歴</h2><p className="muted">保存履歴はローカル版（<code>pnpm studio</code>）で使えます。Preview版はファイルに保存しないため履歴もありません。</p></div>;

  const restore = async (entry: HistoryEntryView) => {
    if (!source.restoreHistory) return;
    if (store.dirty.has(entry.file)) { store.log("warn", `${entry.file} に保存待ちの変更があります。保存が終わってから戻してください`); return; }
    if (!window.confirm(`${entry.file} を、この変更の「前」の内容に戻します。\n（戻したこと自体も履歴に残るので、あとでやり直せます）`)) return;
    setBusy(true);
    const result = await source.restoreHistory(entry.id, "before");
    setBusy(false);
    store.log(result.ok ? "ok" : "error", result.ok ? `${entry.file} を ${new Date(entry.at).toLocaleString()} の変更前に戻しました` : `戻せません: ${result.error}`);
    void refresh();
  };
  const togglePreview = async (entry: HistoryEntryView) => {
    setOpen(current => current === entry.id ? null : entry.id);
    if (entry.id in preview || !source.historyText) return;
    const text = await source.historyText(entry.id, "before").catch(() => null);
    setPreview(current => ({ ...current, [entry.id]: text }));
  };

  const files = Object.keys(store.texts).sort();
  return <div className="panel-page history-panel">
    <h2><HistoryIcon size={18} /> 保存履歴</h2>
    {store.timeline.length > 0 && <section className="timeline">
      <h3>この工房での操作（新しい順）</h3>
      <ol className="history-list">
        {[...store.timeline].reverse().slice(0, 40).map(step => {
          const later = store.timeline.find(t => t.path === step.path && t.id > step.id);
          const summary = summarizeChange(step.path, step.before, later ? later.before : store.texts[step.path]);
          return <li key={step.id} className="history-entry">
            <div className="history-head"><time>{new Date(step.at).toLocaleTimeString()}</time><code>{step.path}</code></div>
            <ul className="history-summary">{summary.slice(0, 3).map((l, i) => <li key={i}>{l}</li>)}</ul>
            <div className="row"><button onClick={() => { if (window.confirm(`${step.path} をこの操作の前まで戻します（元に戻すを繰り返します）`)) store.rewindTo(step.id); }}><RotateCcw size={13} /> この操作の前まで戻す</button></div>
          </li>;
        })}
      </ol>
    </section>}
    <p className="muted">工房での保存も、Codex／Claude Code などが外からファイルを書き換えたときも、変更前の内容を残しています（最新300件。<code>.rpg-studio/history/</code>）。何が変わったかを言葉で表示し、どの時点にも戻せます。</p>
    <div className="row">
      <select value={file} onChange={e => setFile(e.target.value)} aria-label="ファイルで絞り込む">
        <option value="">すべてのファイル</option>
        {files.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
      <button onClick={() => void refresh()}><RefreshCw size={13} /> 更新</button>
    </div>
    {entries === null ? <p className="muted">読み込み中…</p> : !entries.length ? <p className="muted">まだ履歴はありません。</p> :
      <ol className="history-list">
        {entries.map(entry => <li key={entry.id} className={`history-entry source-${entry.source}`}>
          <div className="history-head">
            <time>{new Date(entry.at).toLocaleString()}</time>
            <code>{entry.file}</code>
            <span className="tag">{SOURCE_LABEL[entry.source]}</span>
          </div>
          <ul className="history-summary">{entry.summary.map((line, i) => <li key={i}>{line}</li>)}</ul>
          <div className="row">
            <button onClick={() => void togglePreview(entry)}>{open === entry.id ? "閉じる" : "変更前の内容を見る"}</button>
            {entry.beforeHash && <button disabled={busy} onClick={() => void restore(entry)}><RotateCcw size={13} /> この変更の前に戻す</button>}
          </div>
          {open === entry.id && <pre className="history-preview">{preview[entry.id] === undefined ? "読み込み中…" : preview[entry.id] ?? "（この時点ではファイルがありませんでした）"}</pre>}
        </li>)}
      </ol>}
  </div>;
}

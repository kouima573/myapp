import { useMemo, useState } from "react";
import { Replace, Search } from "lucide-react";
import { replaceTexts, searchTexts } from "../../../packages/cli/src/search";
import type { ProjectStore } from "../lib/useProject";

/** Project-wide search & replace in the data's text (roadmap 175). Keys and IDs are never changed (IDs: rpg rename). */
export default function SearchPanel({ store, onOpenFile }: { store: ProjectStore; onOpenFile: (file: string) => void }) {
  const [query, setQuery] = useState("");
  const [to, setTo] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCase] = useState(false);
  const opts = { regex, caseSensitive };
  const hits = useMemo(() => (query ? searchTexts(store.texts, query, opts) : []), [store.texts, query, regex, caseSensitive]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = hits.reduce((s, h) => s + h.count, 0);
  const replaceAll = () => {
    const changes = replaceTexts(store.texts, query, to, opts);
    if (!changes.length) return;
    if (!window.confirm(`${changes.reduce((s, c) => s + c.count, 0)}か所（${changes.length}ファイル）を「${to}」に置き換えます。保存履歴から戻せます。`)) return;
    for (const c of changes) store.setFileText(c.file, c.text);
    store.log("ok", `置換: 「${query}」→「${to}」 ${changes.map(c => `${c.file}（${c.count}）`).join("、")}`);
  };
  return <div className="panel-page search-panel">
    <h2><Search size={18} /> 検索・置換</h2>
    <p className="muted">会話・イベント・名前・説明など、データの文章をまとめて探して置き換えます。IDやキーは変えません（IDの変更は <code>pnpm rpg rename</code>）。AIからは <code>pnpm rpg find</code> で同じことができます。</p>
    <div className="row">
      <input type="search" placeholder="探す文字" value={query} onChange={e => setQuery(e.target.value)} aria-label="探す文字" style={{ minWidth: 220 }} />
      <label className="check small"><input type="checkbox" checked={caseSensitive} onChange={e => setCase(e.target.checked)} /> 大文字・小文字を区別</label>
      <label className="check small"><input type="checkbox" checked={regex} onChange={e => setRegex(e.target.checked)} /> 正規表現</label>
    </div>
    <div className="row">
      <input type="text" placeholder="置き換える文字" value={to} onChange={e => setTo(e.target.value)} aria-label="置き換える文字" style={{ minWidth: 220 }} />
      <button className="button" disabled={!hits.length} onClick={replaceAll}><Replace size={13} /> すべて置換（{total}か所）</button>
    </div>
    {query && <p className="muted">{hits.length ? `${total}か所（${new Set(hits.map(h => h.file)).size}ファイル）` : "見つかりません"}</p>}
    <ol className="history-list">
      {hits.slice(0, 300).map((h, i) => <li key={i} className="history-entry">
        <div className="history-head"><button className="flow-link" onClick={() => onOpenFile(h.file)}><code>{h.file}</code></button><span className="muted">{h.at}</span>{h.count > 1 && <span className="tag">×{h.count}</span>}</div>
        <div className="small">{h.value.length > 160 ? `${h.value.slice(0, 157)}…` : h.value}</div>
      </li>)}
    </ol>
  </div>;
}

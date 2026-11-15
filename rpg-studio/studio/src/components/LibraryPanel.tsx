import { useEffect, useMemo, useState } from "react";
import { Check, Download, Search } from "lucide-react";
import type { GameContent } from "@rpg/schema";
import type { ProjectStore } from "../lib/useProject";
import type { LibraryCatalogView, LibraryItemView } from "../lib/source";

interface Props { store: ProjectStore; content: GameContent }

const KINDS: Array<[LibraryItemView["kind"] | "all", string]> = [["all", "すべて"], ["tileset", "タイル"], ["character", "キャラ"], ["enemy", "敵"], ["background", "戦闘背景"]];

/** Browse the shared generated library (library/) and copy items into this project with one click. */
export default function LibraryPanel({ store, content }: Props) {
  const [catalog, setCatalog] = useState<LibraryCatalogView | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<LibraryItemView["kind"] | "all">("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<LibraryItemView | null>(null);
  const source = store.source;
  const have = useMemo(() => new Set(content.assets.assets.map(a => a.id)), [content.assets.assets]);

  useEffect(() => {
    if (!source.library) { setError("素材ライブラリは pnpm studio（ローカル）で使えます。"); return; }
    source.library().then(setCatalog).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [source]);

  const items = useMemo(() => (catalog?.items ?? []).filter(item => {
    if (kind !== "all" && item.kind !== kind) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return `${item.id} ${item.title} ${item.tags.join(" ")} ${(item.tiles ?? []).map(t => `${t.name} ${t.key}`).join(" ")}`.toLowerCase().includes(q);
  }), [catalog, kind, query]);

  useEffect(() => {
    if (!source.libraryImageUrl) return;
    for (const item of items.slice(0, 200)) {
      if (urls[item.path]) continue;
      source.libraryImageUrl(item.path).then(url => setUrls(u => ({ ...u, [item.path]: url }))).catch(() => {});
    }
  }, [items, source]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const add = async () => {
    if (!source.libraryAdd || !picked.size) return;
    if (store.dirty.size) { store.log("warn", "保存待ちの変更があります。保存が終わってから取り込んでください"); return; }
    setBusy(true);
    const ok = await source.libraryAdd([...picked]);
    setBusy(false);
    if (ok) { store.log("ok", `${picked.size}件を取り込みました（assets.json・tiles.json に登録）。タイルはマップのパレットに、キャラ・敵は各編集画面の選択肢に出ます`); setPicked(new Set()); void store.reload(); }
    else store.log("error", "取り込みに失敗しました（検証・容量・ID重複を確認）");
  };

  /** First frame of a sheet as a CSS background (pixelated). */
  const thumb = (item: LibraryItemView, size: number) => {
    const url = urls[item.path];
    const whole = item.kind === "tileset" || item.kind === "background";
    return <div className="lib-thumb" style={{
      width: size, height: whole ? size * (item.kind === "background" ? item.rows * item.tileHeight / (item.columns * item.tileWidth) : item.rows / item.columns) : size,
      backgroundImage: url ? `url(${url})` : undefined,
      backgroundSize: whole ? "100% 100%" : `${item.columns * 100}% ${item.rows * 100}%`,
    }} />;
  };

  return <div className="library-panel">
    <header className="card library-head">
      <h3>素材ライブラリ</h3>
      <p className="muted small">内蔵ジェネレーターで描いたオリジナル素材（{catalog ? `${catalog.items.length}点・タイル${catalog.items.reduce((n, i) => n + (i.tiles?.length ?? 0), 0)}種` : "…"}）。選んで「取り込む」と、このプロジェクトに画像をコピーして登録します。{catalog?.license}</p>
      <div className="form-row wrap">
        <div className="chips">{KINDS.map(([k, label]) => <button key={k} className={`chip ${kind === k ? "is-on" : ""}`} onClick={() => setKind(k)}>{label}</button>)}</div>
        <div className="form-row"><Search size={13} /><input placeholder="さがす（例: 宝箱 / slime / 雪）" value={query} onChange={e => setQuery(e.target.value)} /></div>
        <span className="spacer" />
        <button className="button primary" disabled={!picked.size || busy} onClick={() => void add()}><Download size={13} />{busy ? "取り込み中…" : `${picked.size}件を取り込む`}</button>
      </div>
      {error && <p className="error-text small">{error}</p>}
    </header>
    <div className="library-grid">
      {items.map(item => {
        const owned = have.has(item.id);
        return <button key={item.id} className={`card lib-item ${picked.has(item.id) ? "is-on" : ""} ${owned ? "is-owned" : ""}`} onClick={() => (owned ? setOpen(item) : toggle(item.id))} onDoubleClick={() => setOpen(item)} title={item.tags.join(", ")}>
          {thumb(item, item.kind === "tileset" ? 160 : item.kind === "background" ? 200 : 96)}
          <span className="small">{item.title}</span>
          <code className="small muted">{item.id}{item.tiles ? `・${item.tiles.length}種` : ""}</code>
          {owned && <span className="tag"><Check size={10} />取り込み済み</span>}
        </button>;
      })}
    </div>
    {open && <div className="lib-detail card" onClick={() => setOpen(null)}>
      <header><h3>{open.title}</h3><code className="small">{open.id}</code><span className="spacer" /><span className="muted small">クリックで閉じる</span></header>
      {urls[open.path] && <img src={urls[open.path]} alt={open.title} className="lib-full" />}
      {open.tiles && <div className="chips">{open.tiles.map(t => <span key={t.key} className="chip" title={t.tags.join(", ")}>{t.name}{t.passable ? "" : "（壁）"}</span>)}</div>}
    </div>}
  </div>;
}

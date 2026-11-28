import { useMemo, useRef, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { GameContent, Tileset } from "@rpg/schema";
import { customTileSheet, SHEET_TITLES, TILE_CATALOG, type CustomTile } from "../../../packages/cli/src/artgen/makers";
import { ART_STYLE_LABELS, ART_STYLES, type ArtStyle } from "../../../packages/cli/src/artgen/style";
import { mergeTiles } from "../../../packages/cli/src/tileMerge";
import { drawImg, registerGenerated } from "../lib/registerGenerated";
import type { ProjectStore } from "../lib/useProject";

const SHEETS = [...new Set(TILE_CATALOG.map(t => t.sheet))];
/** Frames and autotile pieces come along with their main tile, so only main tiles are offered. */
const OFFERED = TILE_CATALOG.filter(t => !t.companion);

/** タイル作り: 内蔵タイルから選び、模様・色・明るさ・画風を変えて自分のタイル集を作る（CLI: pnpm rpg art tiles）。 */
export default function TileMakerSection({ store, content }: { store: ProjectStore; content: GameContent }) {
  const [tiles, setTiles] = useState<CustomTile[]>([{ from: "lib-tiles-field/grass" }, { from: "lib-tiles-field/water-anim-1" }]);
  const [style, setStyle] = useState<ArtStyle>("standard");
  const [name, setName] = useState(""); const [id, setId] = useState(""); const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sheet = useMemo(() => { try { return customTileSheet(tiles, style, id || "custom"); } catch { return null; } }, [tiles, style, id]);
  useEffect(() => { const c = canvas.current; if (!c || !sheet) return; c.width = sheet.img.w; c.height = sheet.img.h; drawImg(c, sheet.img); }, [sheet]);
  const set = (i: number, patch: Partial<CustomTile>) => setTiles(ts => ts.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const assetId = `tiles-${id}`, exists = content.assets.assets.some(a => a.id === assetId);

  const add = async () => {
    if (!sheet || !/^[a-z0-9][a-z0-9-]*$/.test(id) || !name.trim()) { window.alert("ID（英小文字・数字・ハイフン）と名前を入れてください"); return; }
    if (exists && !window.confirm(`${assetId} はもうあります。置き換えますか？（マップの記号はそのまま）`)) return;
    setBusy(true);
    try {
      await registerGenerated(store, content, { assetId, path: `assets/tilesets/${assetId}.png`, kind: "tileset", img: sheet.img, note: `タイル作りで作成（${name.trim()}）。`,
        generator: { tool: "タイル作り", spec: JSON.stringify({ name: name.trim(), style, tiles }) }, grid: { tileWidth: 64, tileHeight: 64, columns: 8, rows: sheet.img.h / 64 } });
      let added: string[] = [];
      store.updateJson<Tileset>(content.project.tilesetPath, ts => { const r = mergeTiles(ts as unknown as { atlas: string; tiles: Array<Record<string, unknown>> }, assetId, sheet.tiles); added = r.added; return r.tileset as unknown as Tileset; });
      store.log("ok", `${assetId}（${name.trim()}）を登録し、マップで使えるようにしました${added.length ? `: ${added.join(" ")}` : ""}`);
    } catch (error) { store.log("error", `タイルを保存できません: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  return <section className="maker-section">
    <p className="muted small">内蔵のタイルを選び、模様（番号を変えると別の模様）・色（色相）・明るさ・画風を変えて、自分のタイル集を作ります。動く水はコマごと、つながる床は9つの部品ごと入ります。</p>
    <div className="tile-maker-rows">{tiles.map((t, i) => <div key={i} className="row">
      <select value={t.from} onChange={e => set(i, { from: e.target.value })}>
        {SHEETS.map(s => <optgroup key={s} label={SHEET_TITLES[s] ?? s}>{OFFERED.filter(x => x.sheet === s).map(x => <option key={x.ref} value={x.ref}>{x.name}{x.passable ? "" : "（通れない）"}</option>)}</optgroup>)}
      </select>
      <label>模様<input type="number" min={0} max={999} value={t.seed ?? 0} onChange={e => set(i, { seed: Number(e.target.value) || undefined })} style={{ width: "4.5em" }} /></label>
      <label>色<input type="range" min={-180} max={180} value={t.hue ?? 0} onChange={e => set(i, { hue: Number(e.target.value) || undefined })} /></label>
      <label>明るさ<input type="range" min={-50} max={50} value={t.light ?? 0} onChange={e => set(i, { light: Number(e.target.value) || undefined })} /></label>
      <input value={t.name ?? ""} placeholder="名前（任意）" onChange={e => set(i, { name: e.target.value || undefined })} style={{ width: "9em" }} />
      <button className="icon-button" title="外す" onClick={() => setTiles(ts => ts.filter((_, k) => k !== i))}><Trash2 size={13} /></button>
    </div>)}</div>
    <div className="row">
      <button className="button" onClick={() => setTiles(ts => [...ts, { from: "lib-tiles-field/grass" }])}><Plus size={13} /> タイルを足す</button>
      <label>画風<select value={style} onChange={e => setStyle(e.target.value as ArtStyle)}>{ART_STYLES.map(s => <option key={s} value={s}>{ART_STYLE_LABELS[s]}</option>)}</select></label>
    </div>
    {sheet && <canvas ref={canvas} className="maker-preview tiles" aria-label="タイル集の見本" />}
    <div className="row">
      <label>名前<input value={name} onChange={e => setName(e.target.value)} placeholder="例: 夜の野原" /></label>
      <label>ID<input value={id} onChange={e => setId(e.target.value.toLowerCase())} placeholder="night-field" /></label>
      <button className="button primary" disabled={busy || !sheet || !tiles.length} onClick={() => void add()}><Plus size={13} /> {exists ? "置き換える" : "このプロジェクトに追加"}（{sheet?.tiles.length ?? 0}枚）</button>
    </div>
    <p className="muted small">追加すると <code>assets/tilesets/tiles-ID.png</code> と、マップで使う記号（tiles.json）が登録されます。「マップ」画面のタイル一覧から塗れます。</p>
  </section>;
}

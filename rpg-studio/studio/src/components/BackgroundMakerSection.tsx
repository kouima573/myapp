import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { GameContent } from "@rpg/schema";
import { BACKGROUND_PRESETS, renderBackgroundDesign, type BackgroundDesign } from "../../../packages/cli/src/artgen/backgrounds";
import { drawImg, registerGenerated } from "../lib/registerGenerated";
import type { ProjectStore } from "../lib/useProject";

/** 戦闘背景作り: 空・雲や星・山・丘・地面・道・木・遺跡の柱を選んで組み立てる（CLI: pnpm rpg art background）。 */
export default function BackgroundMakerSection({ store, content }: { store: ProjectStore; content: GameContent }) {
  const [d, setD] = useState<BackgroundDesign>(() => ({ ...BACKGROUND_PRESETS[0]! }));
  const [name, setName] = useState(""); const [id, setId] = useState(""); const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useMemo(() => renderBackgroundDesign(d), [d]);
  useEffect(() => { drawImg(canvas.current, img); }, [img]);
  const set = (patch: Partial<BackgroundDesign>) => setD(cur => ({ ...cur, ...patch }));
  const color = (label: string, value: string | null | undefined, on: (v: string | null) => void, optional = false, fallback = "#808080") =>
    <label>{optional && <input type="checkbox" checked={Boolean(value)} onChange={e => on(e.target.checked ? fallback : null)} />}{label}{(value || !optional) && <input type="color" value={value ?? fallback} onChange={e => on(e.target.value)} />}</label>;
  const assetId = `bg-${id}`, exists = content.assets.assets.some(a => a.id === assetId);
  const add = async () => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !name.trim()) { window.alert("ID（英小文字・数字・ハイフン）と名前を入れてください"); return; }
    if (exists && !window.confirm(`${assetId} はもうあります。置き換えますか？`)) return;
    setBusy(true);
    try {
      await registerGenerated(store, content, { assetId, path: `assets/backgrounds/${assetId}.png`, kind: "background", img, note: `戦闘背景作りで作成（${name.trim()}）。`,
        generator: { tool: "戦闘背景作り", spec: JSON.stringify({ ...d, id, name: name.trim() }) }, grid: { tileWidth: 640, tileHeight: 448, columns: 1, rows: 1 } });
      store.log("ok", `${assetId}（${name.trim()}）を登録しました。戦闘の背景に選べます`);
    } catch (error) { store.log("error", `背景を保存できません: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  return <section className="maker-section">
    <div className="row">
      <label>見本から <select value="" onChange={e => { const p = BACKGROUND_PRESETS.find(x => x.id === e.target.value); if (p) setD({ ...p, seed: d.seed }); }}><option value="">選ぶ…</option>{BACKGROUND_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>形の番号<input type="number" min={0} max={999} value={d.seed ?? 0} onChange={e => set({ seed: Number(e.target.value) || 0 })} style={{ width: "4.5em" }} /></label>
    </div>
    <canvas ref={canvas} className="maker-preview background" width={640} height={448} aria-label="戦闘背景の見本" />
    <div className="character-parts">
      {color("空（上）", d.skyTop, v => set({ skyTop: v ?? d.skyTop }))}
      {color("空（地平線）", d.skyHorizon, v => set({ skyHorizon: v ?? d.skyHorizon }))}
      <label>空の飾り<select value={d.sky} onChange={e => set({ sky: e.target.value as BackgroundDesign["sky"] })}><option value="clouds">雲</option><option value="stars">星</option><option value="none">なし</option></select>{d.sky === "clouds" && <input type="color" value={d.cloudColor ?? "#f4f8ff"} onChange={e => set({ cloudColor: e.target.value })} />}</label>
      {color("遠くの山", d.far, v => set({ far: v }), true, "#8aa8c8")}
      {color("近くの丘", d.mid, v => set({ mid: v }), true, "#5a9a4a")}
      {color("地面", d.ground, v => set({ ground: v ?? d.ground }))}
      {color("道", d.path, v => set({ path: v }), true, "#c8a868")}
      {color("遺跡の柱", d.pillars, v => set({ pillars: v }), true, "#c8bca8")}
      <label>木<select value={d.trees?.kind ?? ""} onChange={e => set({ trees: e.target.value ? { kind: e.target.value as "round" | "pine", color: d.trees?.color ?? "#3a7a3a", count: d.trees?.count ?? 4 } : null })}><option value="">なし</option><option value="round">広葉樹</option><option value="pine">針葉樹</option></select>
        {d.trees && <><input type="color" value={d.trees.color} onChange={e => set({ trees: { ...d.trees!, color: e.target.value } })} /><input type="number" min={1} max={8} value={d.trees.count} onChange={e => set({ trees: { ...d.trees!, count: Math.max(1, Math.min(8, Number(e.target.value) || 1)) } })} style={{ width: "3.5em" }} />本</>}</label>
    </div>
    <div className="row">
      <label>名前<input value={name} onChange={e => setName(e.target.value)} placeholder="例: 夜の森" /></label>
      <label>ID<input value={id} onChange={e => setId(e.target.value.toLowerCase())} placeholder="night-woods" /></label>
      <button className="button primary" disabled={busy} onClick={() => void add()}><Plus size={13} /> {exists ? "置き換える" : "このプロジェクトに追加"}</button>
    </div>
    <p className="muted small">追加すると <code>assets/backgrounds/bg-ID.png</code>（640×448）として登録されます。戦闘の背景に選べます。</p>
  </section>;
}

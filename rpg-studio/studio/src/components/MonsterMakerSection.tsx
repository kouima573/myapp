import { useEffect, useMemo, useRef, useState } from "react";
import { Dices, Plus } from "lucide-react";
import type { GameContent } from "@rpg/schema";
import { EXTRA_LABELS, FAMILY_LABELS, MONSTER_EXTRAS, MONSTER_FAMILIES, monsterSpec, randomMonster, renderMonsterSheet } from "../../../packages/cli/src/artgen/makers";
import { MONSTERS, type MonsterSpec } from "../../../packages/cli/src/artgen/monsters";
import { drawImg, registerGenerated } from "../lib/registerGenerated";
import type { ProjectStore } from "../lib/useProject";

/** 敵作り: 種類・色・飾りを選んで、4コマで動く敵を作る（CLI: pnpm rpg art monster）。 */
export default function MonsterMakerSection({ store, content }: { store: ProjectStore; content: GameContent }) {
  const [spec, setSpec] = useState<MonsterSpec>(() => monsterSpec({ id: "x", name: "x", from: "slime-green" }));
  const [name, setName] = useState(""); const [id, setId] = useState(""); const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sheet = useMemo(() => renderMonsterSheet(spec), [spec]);
  useEffect(() => {
    let f = 0;
    const draw = () => { const c = canvas.current; if (!c) return; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); drawImg(c, sheet, 3, 0, 0, { x: f * 64, y: 0, w: 64, h: 64 }); f = (f + 1) % 4; };
    draw(); const t = window.setInterval(draw, 220); return () => window.clearInterval(t);
  }, [sheet]);
  const update = (o: Parameters<typeof monsterSpec>[0]) => { try { setSpec(monsterSpec(o)); } catch (error) { store.log("warn", error instanceof Error ? error.message : String(error)); } };
  const assetId = `mon-${id}`, exists = content.assets.assets.some(a => a.id === assetId);
  const add = async () => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !name.trim()) { window.alert("ID（英小文字・数字・ハイフン）と名前を入れてください"); return; }
    if (exists && !window.confirm(`${assetId} はもうあります。置き換えますか？`)) return;
    setBusy(true);
    try {
      await registerGenerated(store, content, { assetId, path: `assets/enemies/${assetId}.png`, kind: "enemy", img: sheet, note: `敵作りで作成（${name.trim()}）。`,
        generator: { tool: "敵作り", spec: JSON.stringify({ ...spec, id, name: name.trim() }) }, grid: { tileWidth: 64, tileHeight: 64, columns: 4, rows: 1, frameDurationMs: 220, loop: true } });
      store.log("ok", `${assetId}（${name.trim()}）を登録しました。敵の見た目（sprite）に選べます`);
    } catch (error) { store.log("error", `敵を保存できません: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const extras = MONSTER_EXTRAS[spec.family] ?? [];
  return <section className="maker-section">
    <div className="row">
      <label>見本から <select value="" onChange={e => e.target.value && update({ id: "x", name: "x", from: e.target.value })}><option value="">選ぶ…</option>{MONSTERS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <button className="button" onClick={() => setSpec(randomMonster(`${Date.now()}`))}><Dices size={13} /> おまかせ</button>
    </div>
    <canvas ref={canvas} className="maker-preview" width={192} height={192} aria-label="敵の見本" />
    <div className="character-parts">
      <label>種類<select value={spec.family} onChange={e => update({ id: "x", name: "x", family: e.target.value, pal: spec.pal, extra: null })}>{MONSTER_FAMILIES.map(f => <option key={f} value={f}>{FAMILY_LABELS[f] ?? f}</option>)}</select></label>
      <label>体の色<input type="color" value={spec.pal.body} onChange={e => setSpec({ ...spec, pal: { ...spec.pal, body: e.target.value } })} /></label>
      <label>差し色<input type="color" value={spec.pal.accent ?? "#e8c040"} onChange={e => setSpec({ ...spec, pal: { ...spec.pal, accent: e.target.value } })} /></label>
      <label>影の色<input type="color" value={spec.pal.dark ?? "#3a2a4a"} onChange={e => setSpec({ ...spec, pal: { ...spec.pal, dark: e.target.value } })} /></label>
      <label>目の色<input type="color" value={spec.pal.eye ?? "#1a1a24"} onChange={e => setSpec({ ...spec, pal: { ...spec.pal, eye: e.target.value } })} /></label>
      {extras.length > 0 && <label>飾り<select value={spec.extra ?? ""} onChange={e => setSpec({ ...spec, extra: e.target.value || undefined })}><option value="">なし</option>{extras.map(x => <option key={x} value={x}>{EXTRA_LABELS[x] ?? x}</option>)}</select></label>}
    </div>
    <div className="row">
      <label>名前<input value={name} onChange={e => setName(e.target.value)} placeholder="例: 月のスライム" /></label>
      <label>ID<input value={id} onChange={e => setId(e.target.value.toLowerCase())} placeholder="moon-slime" /></label>
      <button className="button primary" disabled={busy} onClick={() => void add()}><Plus size={13} /> {exists ? "置き換える" : "このプロジェクトに追加"}</button>
    </div>
    <p className="muted small">追加すると <code>assets/enemies/mon-ID.png</code>（64×64のコマが4つ）として登録されます。「敵・アイテム・仲間」画面で敵の見た目に選べます。</p>
  </section>;
}

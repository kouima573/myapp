import { useMemo, useState } from "react";
import { Hexagon, Plus, Trash2 } from "lucide-react";
import type { GameContent, SkillBoard, SkillNode } from "@rpg/schema";
import { Field, TextInput } from "./Inspector";
import { ConditionEditor, EffectListEditor } from "./forms";
import type { ProjectStore } from "../lib/useProject";

/**
 * スキルボードの編集 (v2.3): boards on a hex grid. Click a dashed slot next to a panel to add one there;
 * click a panel to edit it (name, cost, stats, abilities, hidden condition, effects). "移動" puts the selected panel
 * on the next slot you click.
 */
type Db = { skillBoards?: SkillBoard[] };
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]] as const;
const R = 30; // hex radius in px
const hexPoints = (cx: number, cy: number, r = R - 2) => Array.from({ length: 6 }, (_, k) => { const a = (Math.PI / 180) * (60 * k - 30); return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`; }).join(" ");
const uniqueId = (base: string, taken: string[]) => { if (!taken.includes(base)) return base; for (let i = 2; ; i++) if (!taken.includes(`${base}${i}`)) return `${base}${i}`; };

export default function SkillBoardPanel({ store, content }: { store: ProjectStore; content: GameContent }) {
  const path = content.project.databasePath;
  const boards = content.database.skillBoards ?? [];
  const [boardId, setBoardId] = useState<string | null>(boards[0]?.id ?? null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const board = boards.find(b => b.id === boardId) ?? boards[0];
  const node = board?.nodes.find(n => n.id === nodeId);
  const edit = (recipe: (b: SkillBoard) => void) => store.updateJson<Db>(path, db => { const b = db.skillBoards?.find(x => x.id === board?.id); if (b) recipe(b); });
  const editNode = (recipe: (n: SkillNode) => void) => edit(b => { const n = b.nodes.find(x => x.id === nodeId); if (n) recipe(n); });

  const addBoard = () => {
    const id = uniqueId("board", boards.map(b => b.id));
    store.updateJson<Db>(path, db => { db.skillBoards = [...(db.skillBoards ?? []), { id, name: "新しいボード", owner: "hero", description: "", nodes: [{ id: "p1", name: "攻撃+1", description: "", q: 0, r: 0, cost: 1, start: true, statMods: { attack: 1 }, abilities: [], traits: [], effects: [] }] }]; });
    setBoardId(id); setNodeId("p1");
  };
  const layout = useMemo(() => {
    if (!board) return null;
    const cells = new Map(board.nodes.map(n => [`${n.q},${n.r}`, n]));
    const slots = new Map<string, { q: number; r: number }>();
    for (const n of board.nodes) for (const [dq, dr] of NEIGHBOURS) { const q = n.q + dq, r = n.r + dr; if (!cells.has(`${q},${r}`)) slots.set(`${q},${r}`, { q, r }); }
    const all = [...board.nodes.map(n => ({ q: n.q, r: n.r })), ...slots.values()];
    const xy = (q: number, r: number) => ({ x: Math.sqrt(3) * R * (q + r / 2), y: 1.5 * R * r });
    const xs = all.map(p => xy(p.q, p.r).x), ys = all.map(p => xy(p.q, p.r).y);
    const minX = Math.min(...xs) - R, minY = Math.min(...ys) - R, w = Math.max(...xs) - minX + R, h = Math.max(...ys) - minY + R;
    return { slots: [...slots.values()], xy: (q: number, r: number) => { const p = xy(q, r); return { x: p.x - minX, y: p.y - minY }; }, w, h };
  }, [board]);
  const clickSlot = (q: number, r: number) => {
    if (!board) return;
    if (moving && node) { editNode(n => { n.q = q; n.r = r; }); setMoving(false); return; }
    const id = uniqueId("p", board.nodes.map(n => n.id));
    edit(b => { b.nodes.push({ id, name: "新しいパネル", description: "", q, r, cost: 1, abilities: [], traits: [], effects: [] } as SkillNode); });
    setNodeId(id);
  };
  const owners = ["hero", ...content.database.companions.map(c => c.id)];
  const stat = (key: "maxHp" | "maxMp" | "maxSp" | "attack" | "defense") => (typeof node?.statMods?.[key] === "number" ? String(node.statMods[key]) : "");

  return <div className="panel-page skill-editor">
    <h2><Hexagon size={18} /> スキルボード</h2>
    <p className="muted">六角形のパネルを、覚えたパネルの隣から開いていく育成。点線の六角形をクリックするとそこにパネルを足せます。ポイントはレベルアップごとに <code>project.json › leveling.skillPoints</code> だけ入ります（今は {content.project.leveling?.skillPoints ?? 0}）。</p>
    <div className="row">
      {boards.map(b => <button key={b.id} className={`chip ${b.id === board?.id ? "is-on" : ""}`} onClick={() => { setBoardId(b.id); setNodeId(null); }}>{b.name}（{b.owner === "hero" ? "主人公" : content.database.companions.find(c => c.id === b.owner)?.name ?? b.owner}）</button>)}
      <button className="button" onClick={addBoard}><Plus size={13} /> ボード</button>
    </div>
    {board && layout && <div className="skill-editor-body">
      <div className="card">
        <div className="form-row wrap">
          <Field label="名前"><TextInput value={board.name} onCommit={v => v && edit(b => { b.name = v; })} /></Field>
          <Field label="持ち主"><select value={board.owner} onChange={e => edit(b => { b.owner = e.target.value; })}>{owners.map(o => <option key={o} value={o}>{o === "hero" ? "主人公" : content.database.companions.find(c => c.id === o)?.name ?? o}</option>)}</select></Field>
          <button className="button danger" onClick={() => { if (window.confirm(`ボード「${board.name}」を消しますか？`)) { store.updateJson<Db>(path, db => { db.skillBoards = (db.skillBoards ?? []).filter(b => b.id !== board.id); }); setBoardId(null); } }}><Trash2 size={13} /> ボードを消す</button>
        </div>
        <svg className="skill-editor-svg" width={layout.w} height={layout.h} viewBox={`0 0 ${layout.w} ${layout.h}`}>
          {layout.slots.map(s => { const p = layout.xy(s.q, s.r); return <polygon key={`s${s.q},${s.r}`} className={`skill-slot ${moving ? "is-target" : ""}`} points={hexPoints(p.x, p.y)} onClick={() => clickSlot(s.q, s.r)}><title>{moving ? "ここへ移動" : "ここにパネルを足す"}（{s.q}, {s.r}）</title></polygon>; })}
          {board.nodes.map(n => { const p = layout.xy(n.q, n.r); return <g key={n.id} className={`skill-node ${n.id === nodeId ? "is-selected" : ""} ${n.start ? "is-start" : ""} ${n.hidden ? "is-hidden" : ""}`} onClick={() => { setNodeId(n.id); setMoving(false); }}>
            <polygon points={hexPoints(p.x, p.y)} />
            <text x={p.x} y={p.y - 2} textAnchor="middle">{n.icon ?? n.name.slice(0, 3)}</text>
            <text x={p.x} y={p.y + 13} textAnchor="middle" className="skill-cost">{n.cost}</text>
          </g>; })}
        </svg>
        <p className="muted small">緑の縁＝最初から覚えられるパネル、紫の点線＝条件まで「？」のパネル。</p>
      </div>
      {node && <div className="card">
        <header><h3>パネル <code>{node.id}</code></h3><span className="spacer" />
          <button className={`button ${moving ? "primary" : ""}`} onClick={() => setMoving(m => !m)}>{moving ? "移動先をクリック…" : "移動"}</button>
          <button className="button danger" disabled={board.nodes.length <= 1} onClick={() => { edit(b => { b.nodes = b.nodes.filter(x => x.id !== node.id); }); setNodeId(null); }}><Trash2 size={13} /> 消す</button>
        </header>
        <div className="form-row wrap">
          <Field label="名前"><TextInput value={node.name} onCommit={v => v && editNode(n => { n.name = v; })} /></Field>
          <Field label="表示（2〜4文字）"><TextInput value={node.icon ?? ""} onCommit={v => editNode(n => { if (v) n.icon = v.slice(0, 4); else delete n.icon; })} /></Field>
          <Field label="ポイント"><TextInput type="number" min={0} value={node.cost} onCommit={v => editNode(n => { n.cost = Math.max(0, Math.round(Number(v) || 0)); })} /></Field>
          <label className="field"><span className="field-label">最初から覚えられる</span><input type="checkbox" checked={Boolean(node.start)} onChange={e => editNode(n => { if (e.target.checked) n.start = true; else delete n.start; })} /></label>
        </div>
        <Field label="説明"><TextInput value={node.description} onCommit={v => editNode(n => { n.description = v; })} /></Field>
        <div className="form-row wrap">
          {(["maxHp", "maxMp", "maxSp", "attack", "defense"] as const).map(k => <Field key={k} label={{ maxHp: "最大HP +", maxMp: "最大MP +", maxSp: "最大SP +", attack: "攻撃 +", defense: "防御 +" }[k]}><TextInput type="number" value={stat(k)} onCommit={v => editNode(n => { const m = { ...(n.statMods ?? {}) } as Record<string, unknown>; if (v === "" || Number(v) === 0) delete m[k]; else m[k] = Math.round(Number(v)); if (Object.keys(m).length) n.statMods = m as SkillNode["statMods"]; else delete n.statMods; })} /></Field>)}
        </div>
        {board.owner === "hero" && <Field label="覚える技（Ctrl/⌘+クリックで複数）"><select multiple value={node.abilities} onChange={e => editNode(n => { n.abilities = Array.from(e.target.selectedOptions).map(o => o.value); })} style={{ minHeight: "5em" }}>{content.database.abilities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
        {board.owner === "hero" && <Field label="付く特性"><select multiple value={node.traits} onChange={e => editNode(n => { n.traits = Array.from(e.target.selectedOptions).map(o => o.value); })} style={{ minHeight: "4em" }}>{content.database.traits.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
        <div className="field"><span className="field-label">隠す条件（成り立つまで「？」）</span><ConditionEditor value={node.hidden} content={content} onChange={w => editNode(n => { if (w) n.hidden = w; else delete n.hidden; })} /></div>
        <div className="field"><span className="field-label">覚えたときの効果</span><EffectListEditor value={node.effects} content={content} onChange={v => editNode(n => { n.effects = v; })} /></div>
      </div>}
    </div>}
    {!boards.length && <p className="muted">まだボードがありません。「＋ボード」で作れます。</p>}
  </div>;
}

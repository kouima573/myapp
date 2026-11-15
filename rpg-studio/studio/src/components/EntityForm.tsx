import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { BehaviorSchema, type Entity, type EntityState, type GameContent } from "@rpg/schema";
import { Field, JsonField, TextInput } from "./Inspector";
import { ConditionEditor, EffectListEditor } from "./forms";

const TRIGGERS: Array<[EntityState["trigger"], string]> = [["action", "調べる"], ["touch", "触れる"], ["auto", "その状態になった時"], ["none", "なし（背景）"]];
const MARKERS: EntityState["marker"][] = ["none", "sign", "chest", "sparkle", "statue"];

/** Entity states as forms: the first state whose condition holds is the active one. */
export default function EntityForm({ entity, content, onChange }: { entity: Entity; content: GameContent; onChange: (e: Entity) => void }) {
  const sprites = content.assets.assets.filter(a => a.kind === "character").map(a => a.id);
  const setState = (i: number, patch: Partial<EntityState>) => onChange({ ...entity, states: entity.states.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, d: number) => { const st = [...entity.states]; const [x] = st.splice(i, 1); st.splice(i + d, 0, x!); onChange({ ...entity, states: st }); };
  return <div className="entity-form">
    <Field label="名前"><TextInput value={entity.name} onCommit={v => v && onChange({ ...entity, name: v })} /></Field>
    {entity.states.map((s, i) => <div key={i} className="card choice-card">
      <div className="form-row">
        <strong className="small">状態 {i + 1}</strong><span className="spacer" />
        <button className="icon-button" disabled={i === 0} onClick={() => move(i, -1)} title="上へ"><ArrowUp size={12} /></button>
        <button className="icon-button" disabled={i === entity.states.length - 1} onClick={() => move(i, 1)} title="下へ"><ArrowDown size={12} /></button>
        <button className="icon-button danger" disabled={entity.states.length <= 1} onClick={() => onChange({ ...entity, states: entity.states.filter((_, j) => j !== i) })} title="削除"><Trash2 size={12} /></button>
      </div>
      <div className="field"><span className="field-label">この状態になる条件（空なら常に）</span><ConditionEditor value={s.when} content={content} onChange={w => setState(i, { when: w })} /></div>
      <div className="form-row wrap">
        <Field label="表示名"><TextInput value={s.name ?? ""} onCommit={v => setState(i, { name: v || undefined })} /></Field>
        <Field label="見た目"><select value={s.sprite ?? ""} onChange={e => setState(i, { sprite: e.target.value || undefined })}><option value="">（なし）</option>{sprites.map(id => <option key={id}>{id}</option>)}</select></Field>
        <Field label="印"><select value={s.marker} onChange={e => setState(i, { marker: e.target.value as EntityState["marker"] })}>{MARKERS.map(m => <option key={m}>{m}</option>)}</select></Field>
        <Field label="きっかけ"><select value={s.trigger} onChange={e => setState(i, { trigger: e.target.value as EntityState["trigger"] })}>{TRIGGERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      </div>
      <div className="form-row wrap">
        <label className="small"><input type="checkbox" checked={s.solid} onChange={e => setState(i, { solid: e.target.checked })} />通れない</label>
        <label className="small"><input type="checkbox" checked={!!s.pushable} onChange={e => setState(i, { pushable: e.target.checked || undefined })} />押せる</label>
        <label className="small"><input type="checkbox" checked={!!s.carryable} onChange={e => setState(i, { carryable: e.target.checked || undefined })} />持てる</label>
      </div>
      <div className="form-row wrap">
        <Field label="会話"><select value={s.dialogue ?? ""} onChange={e => setState(i, { dialogue: e.target.value || undefined })}><option value="">（なし）</option>{Object.keys(content.dialogues).map(id => <option key={id}>{id}</option>)}</select></Field>
        <Field label="イベント"><select value={s.event ?? ""} onChange={e => setState(i, { event: e.target.value || undefined })}><option value="">（なし）</option>{Object.keys(content.events).map(id => <option key={id}>{id}</option>)}</select></Field>
      </div>
      <div className="field"><span className="field-label">起きること</span><EffectListEditor value={s.effects} content={content} onChange={v => setState(i, { effects: v })} /></div>
      {(s.pushable || s.carryable) && <div className="field"><span className="field-label">動かされた後</span><EffectListEditor value={s.onMoved ?? []} content={content} onChange={v => setState(i, { onMoved: v.length ? v : undefined })} /></div>}
      <Field label="動き" hint='例 {"type":"wander"} / {"type":"chase","speed":2}'><JsonField value={s.behavior} schema={BehaviorSchema} rows={1} onCommit={v => setState(i, { behavior: v ?? { type: "still" } })} /></Field>
    </div>)}
    <button className="button" onClick={() => onChange({ ...entity, states: [...entity.states, { marker: "none", solid: true, trigger: "action", effects: [], behavior: { type: "still" } }] })}><Plus size={12} />状態を足す</button>
  </div>;
}

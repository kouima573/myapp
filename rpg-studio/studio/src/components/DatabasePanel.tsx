import { useState } from "react";
import { ScriptField } from "./ScriptsPanel";
import { z } from "zod";
import { Plus, Shield, Sword, Trash2, Users, Wand2 } from "lucide-react";
import { StatModsSchema, type Ability, type Companion, type Enemy, type GameContent, type Item, type Use, type ScriptRef } from "@rpg/schema";
import { MODULES } from "../../../packages/modules/src/index";
import { Field, JsonField, TextInput } from "./Inspector";
import { ConditionEditor, EffectListEditor } from "./forms";
import { RuleEditor } from "./RulesPanel";
import type { ProjectStore } from "../lib/useProject";

interface Props { store: ProjectStore; content: GameContent }
type Tab = "enemies" | "items" | "abilities" | "companions";
type Db = { enemies: Enemy[]; items: Item[]; abilities: Ability[]; companions: Companion[] };

const TABS: Array<[Tab, string, typeof Sword]> = [["enemies", "敵", Sword], ["items", "アイテム", Shield], ["abilities", "能力・技", Wand2], ["companions", "仲間", Users]];
const uniqueId = (base: string, taken: string[]) => { if (!taken.includes(base)) return base; for (let i = 2; ; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`; };
const num = (v: string, min = 0) => Math.max(min, Math.round(Number(v) || 0));

function StatsRow({ stats, onChange }: { stats: { maxHp: number; attack: number; defense: number }; onChange: (s: { maxHp: number; attack: number; defense: number }) => void }) {
  return <div className="form-row wrap">
    <Field label="最大HP"><TextInput type="number" min={1} value={stats.maxHp} onCommit={v => onChange({ ...stats, maxHp: num(v, 1) })} /></Field>
    <Field label="攻撃"><TextInput type="number" min={0} value={stats.attack} onCommit={v => onChange({ ...stats, attack: num(v) })} /></Field>
    <Field label="防御"><TextInput type="number" min={0} value={stats.defense} onCommit={v => onChange({ ...stats, defense: num(v) })} /></Field>
  </div>;
}

/** Usable item / skill: where, costs, condition, effects. */
function UseEditor({ use, onChange, content, item }: { use: Use | undefined; onChange: (u: Use | undefined) => void; content: GameContent; item?: boolean }) {
  if (!use) return <button className="button" onClick={() => onChange({ where: "battle", cost: [], effects: [{ type: "heal", amount: 10 }], consume: true })}><Plus size={12} />使える{item ? "アイテム" : "技"}にする</button>;
  return <div className="form-nested">
    <div className="form-row wrap">
      <Field label="使える場所"><select value={use.where} onChange={e => onChange({ ...use, where: e.target.value as Use["where"] })}><option value="battle">戦闘</option><option value="field">フィールド</option><option value="both">どちらでも</option></select></Field>
      <Field label="表示名"><TextInput value={use.label ?? ""} onCommit={v => onChange({ ...use, label: v || undefined })} /></Field>
      {item && <label className="field"><span className="field-label">使うとなくなる</span><input type="checkbox" checked={use.consume} onChange={e => onChange({ ...use, consume: e.target.checked })} /></label>}
      <button className="button danger" onClick={() => onChange(undefined)}>使えなくする</button>
    </div>
    <div className="field"><span className="field-label">消費（変数）</span>
      {use.cost.map((c, i) => <div key={i} className="form-row">
        <select value={c.var} onChange={e => onChange({ ...use, cost: use.cost.map((x, j) => (j === i ? { ...x, var: e.target.value } : x)) })}>{Object.entries(content.project.variables).map(([id, d]) => <option key={id} value={id}>{d.label ?? id}</option>)}</select>
        <input type="number" value={typeof c.amount === "number" ? c.amount : 0} onChange={e => onChange({ ...use, cost: use.cost.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)) })} style={{ width: "5em" }} />
        <button className="icon-button" onClick={() => onChange({ ...use, cost: use.cost.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>
      </div>)}
      {Object.keys(content.project.variables).length > 0 && <button className="button" onClick={() => onChange({ ...use, cost: [...use.cost, { var: Object.keys(content.project.variables)[0]!, amount: 1 }] })}><Plus size={12} />消費を足す</button>}
    </div>
    <div className="field"><span className="field-label">使える条件</span><ConditionEditor value={use.when} content={content} onChange={w => onChange({ ...use, when: w })} /></div>
    <div className="field"><span className="field-label">効果</span><EffectListEditor value={use.effects} content={content} onChange={v => v.length && onChange({ ...use, effects: v })} /></div>
  </div>;
}

/** Forms for database.json: enemies, items, abilities and companions. */
export default function DatabasePanel({ store, content }: Props) {
  const [tab, setTab] = useState<Tab>("enemies");
  const [selected, setSelected] = useState<string | null>(null);
  const path = content.project.databasePath;
  const db = content.database;
  const edit = <K extends Tab>(key: K, id: string, recipe: (x: Db[K][number]) => void) => store.updateJson<Db>(path, f => { const x = (f[key] as Array<{ id: string }>).find(e => e.id === id); if (x) recipe(x as Db[K][number]); });
  const list: Array<{ id: string; name: string }> = db[tab];
  const characters = content.assets.assets.filter(a => a.kind === "character").map(a => a.id);
  const enemyArt = content.assets.assets.filter(a => a.kind === "enemy").map(a => a.id);
  const backgrounds = content.assets.assets.filter(a => a.kind === "background").map(a => a.id);
  const add = () => {
    const id = uniqueId(`new-${tab.replace(/s$/, "")}`, list.map(x => x.id));
    store.updateJson<Db>(path, f => {
      if (tab === "enemies") f.enemies.push({ id, name: "新しい敵", tags: [], stats: { maxHp: 10, attack: 3, defense: 0 }, actions: [{ name: "体当たり", power: 1, effects: [] }], drops: [], rules: [], canFlee: true, resist: {}, immune: [] });
      if (tab === "items") f.items.push({ id, name: "新しいアイテム", description: "", rules: [], key: false });
      if (tab === "abilities") f.abilities.push({ id, name: "新しい能力", description: "", kind: "battle", rules: [] });
      if (tab === "companions") (f.companions ??= []).push({ id, name: "新しい仲間", description: "", stats: { maxHp: 12, attack: 4, defense: 1 }, actions: [{ name: "攻撃", kind: "attack", power: 0 }] });
    });
    setSelected(id);
  };
  const remove = (id: string) => { if (confirm(`${id} を消しますか？（参照している所は検証エラーになります）`)) { store.updateJson<Db>(path, f => { (f as unknown as Record<string, Array<{ id: string }>>)[tab] = (f[tab] as Array<{ id: string }>).filter(x => x.id !== id); }); setSelected(null); } };
  const current = list.find(x => x.id === selected);

  return <div className="story-panel">
    <aside className="story-list card">
      <div className="chips">{TABS.map(([t, label]) => <button key={t} className={`chip ${tab === t ? "is-on" : ""}`} onClick={() => { setTab(t); setSelected(null); }}>{label}</button>)}</div>
      <button className="button" onClick={add}><Plus size={13} />{TABS.find(t => t[0] === tab)![1]}を足す</button>
      {list.map(x => { const Icon = TABS.find(t => t[0] === tab)![2]; return <button key={x.id} className={`map-item ${selected === x.id ? "is-active" : ""}`} onClick={() => setSelected(x.id)}><Icon size={12} /><span>{x.name}</span><code className="small">{x.id}</code></button>; })}
    </aside>
    <section className="story-editor">
      {!current && <div className="empty">左から選ぶか、新しく足してください。ここでの変更は database.json に保存され、検証されます。</div>}
      {current && <div className="card">
        <header><h3>{current.name} <code>{current.id}</code></h3><span className="spacer" /><button className="button danger" onClick={() => remove(current.id)}><Trash2 size={13} />削除</button></header>
        <div className="form-row wrap">
          <Field label="名前"><TextInput value={current.name} onCommit={v => v && edit(tab, current.id, x => { x.name = v; })} /></Field>
          {"description" in current && <Field label="説明"><TextInput value={String((current as { description?: string }).description ?? "")} onCommit={v => edit(tab, current.id, x => { (x as { description: string }).description = v; })} /></Field>}
        </div>
        <ScriptField key={`script-${tab}-${current.id}`} value={(current as { script?: ScriptRef }).script} content={content} store={store} ownerId={current.id}
          templateFor={tab === "enemies" ? "enemy" : tab === "companions" ? "command" : "skill"}
          onChange={r => edit(tab, current.id, x => { const o = x as { script?: ScriptRef }; if (r) o.script = r; else delete o.script; })} />

        {tab === "enemies" && (() => { const e = current as Enemy; const set = (r: (x: Enemy) => void) => edit("enemies", e.id, r); return <>
          <StatsRow stats={e.stats} onChange={s => set(x => { x.stats = s; })} />
          <div className="form-row wrap">
            <Field label="絵"><select value={e.sprite ?? ""} onChange={v => set(x => { if (v.target.value) x.sprite = v.target.value; else delete x.sprite; })}><option value="">（自動の絵）</option>{enemyArt.map(id => <option key={id}>{id}</option>)}</select></Field>
            <Field label="戦闘背景"><select value={e.background ?? ""} onChange={v => set(x => { if (v.target.value) x.background = v.target.value; else delete x.background; })}><option value="">（マップの背景）</option>{backgrounds.map(id => <option key={id}>{id}</option>)}</select></Field>
            <label className="field"><span className="field-label">逃げられる</span><input type="checkbox" checked={e.canFlee} onChange={v => set(x => { x.canFlee = v.target.checked; })} /></label>
            <Field label="経験値（空欄＝自動）"><TextInput type="number" min={0} value={e.exp ?? ""} onCommit={v => set(x => { if (v === "") delete x.exp; else x.exp = num(v); })} /></Field>
            <Field label="タグ（空白区切り）"><TextInput value={e.tags.join(" ")} onCommit={v => set(x => { x.tags = v.split(/\s+/).filter(Boolean); })} /></Field>
          </div>
          <div className="field"><span className="field-label">行動（使える物を上から順に、くり返し）</span>
            {e.actions.map((a, i) => <div key={i} className="card choice-card">
              <div className="form-row wrap">
                <Field label="名前"><TextInput value={a.name} onCommit={v => v && set(x => { x.actions[i]!.name = v; })} /></Field>
                <Field label="威力（0 = 攻撃しない）"><TextInput type="number" min={0} value={a.power} onCommit={v => set(x => { x.actions[i]!.power = num(v); })} /></Field>
                <Field label="セリフ"><TextInput value={a.message ?? ""} onCommit={v => set(x => { x.actions[i]!.message = v || undefined; })} /></Field>
                <button className="button" disabled={e.actions.length <= 1} onClick={() => set(x => { x.actions.splice(i, 1); })}><Trash2 size={12} /></button>
              </div>
              <div className="field"><span className="field-label">使う条件</span><ConditionEditor value={a.when} content={content} onChange={w => set(x => { x.actions[i]!.when = w; })} /></div>
              <div className="field"><span className="field-label">行動のあとの効果</span><EffectListEditor value={a.effects} content={content} onChange={v => set(x => { x.actions[i]!.effects = v; })} /></div>
            </div>)}
            <button className="button" onClick={() => set(x => { x.actions.push({ name: "攻撃", power: 1, effects: [] }); })}><Plus size={12} />行動を足す</button>
          </div>
          <div className="field"><span className="field-label">戦利品</span>
            {e.drops.map((d, i) => <div key={i} className="form-row">
              <select value={d.item} onChange={v => set(x => { x.drops[i]!.item = v.target.value; })}>{db.items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}</select>
              <input type="number" min={1} value={d.count} onChange={v => set(x => { x.drops[i]!.count = num(v.target.value, 1); })} style={{ width: "4em" }} />
              <button className="icon-button" onClick={() => set(x => { x.drops.splice(i, 1); })}><Trash2 size={12} /></button>
            </div>)}
            {db.items.length > 0 && <button className="button" onClick={() => set(x => { x.drops.push({ item: db.items[0]!.id, count: 1 }); })}><Plus size={12} />戦利品を足す</button>}
          </div>
          <div className="field"><span className="field-label">戦い方</span>
            <select value={e.battle?.mode ?? "builtin"} onChange={v => set(x => { if (v.target.value === "builtin") delete x.battle; else x.battle = { mode: v.target.value, args: x.battle?.args ?? {} }; })}>
              <option value="builtin">いつものコマンド戦闘</option>
              {Object.entries(MODULES).flatMap(([id, m]) => Object.keys(m.system.scenes ?? {}).map(sc => <option key={`${id}.${sc}`} value={`${id}.${sc}`}>{m.title}（{id}.{sc}）{content.project.modules[id] ? "" : " ※未有効"}</option>))}
            </select>
            {e.battle && <JsonField value={e.battle.args} schema={z.record(z.string(), z.unknown())} onCommit={v => set(x => { if (x.battle) x.battle.args = (v ?? {}) as Record<string, unknown>; })} rows={4} />}
          </div>
          <div className="field"><span className="field-label">この敵との戦闘中のルール</span>
            {e.rules.map((r, i) => <RuleEditor key={`${r.id}-${i}`} rule={r} content={content} onChange={nr => set(x => { x.rules[i] = nr; })} onDelete={() => set(x => { x.rules.splice(i, 1); })} />)}
            <button className="button" onClick={() => set(x => { x.rules.push({ id: uniqueId("rule", x.rules.map(r => r.id)), on: "battleStart", repeat: false, priority: 0, effects: [] }); })}><Plus size={12} />ルールを足す</button>
          </div>
        </>; })()}

        {tab === "items" && (() => { const it = current as Item; const set = (r: (x: Item) => void) => edit("items", it.id, r); return <>
          <div className="form-row wrap">
            <Field label="装備枠"><select value={it.slot ?? ""} onChange={v => set(x => { if (v.target.value) x.slot = v.target.value; else delete x.slot; })}><option value="">（装備品ではない）</option>{Object.entries(content.project.equipmentSlots).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}</select></Field>
            <Field label="回復量（簡易）"><TextInput type="number" min={0} value={it.heal ?? ""} onCommit={v => set(x => { if (Number(v) > 0) x.heal = num(v, 1); else delete x.heal; })} /></Field>
            <label className="field"><span className="field-label">大事なもの</span><input type="checkbox" checked={it.key} onChange={v => set(x => { x.key = v.target.checked; })} /></label>
          </div>
          <Field label={it.slot ? "装備中の能力補正" : "持っている間の能力補正"} hint='例 {"attack": 2}'><JsonField value={it.statMods} schema={StatModsSchema} onCommit={v => set(x => { if (v) x.statMods = v; else delete x.statMods; })} rows={1} /></Field>
          <div className="field"><span className="field-label">使ったとき</span><UseEditor use={it.use} item content={content} onChange={u => set(x => { if (u) x.use = u; else delete x.use; })} /></div>
          <div className="field"><span className="field-label">{it.slot ? "装備中" : "持っている間"}のルール</span>
            {it.rules.map((r, i) => <RuleEditor key={`${r.id}-${i}`} rule={r} content={content} onChange={nr => set(x => { x.rules[i] = nr; })} onDelete={() => set(x => { x.rules.splice(i, 1); })} />)}
            <button className="button" onClick={() => set(x => { x.rules.push({ id: uniqueId("rule", x.rules.map(r => r.id)), on: "battleStart", repeat: false, priority: 0, effects: [] }); })}><Plus size={12} />ルールを足す</button>
          </div>
        </>; })()}

        {tab === "abilities" && (() => { const ab = current as Ability; const set = (r: (x: Ability) => void) => edit("abilities", ab.id, r); return <>
          <Field label="分類（表示用）"><select value={ab.kind} onChange={v => set(x => { x.kind = v.target.value as Ability["kind"]; })}><option value="passive">常に効く</option><option value="battle">戦闘の技</option><option value="field">フィールドの技</option></select></Field>
          <Field label="能力補正" hint='例 {"defense": 1}'><JsonField value={ab.statMods} schema={StatModsSchema} onCommit={v => set(x => { if (v) x.statMods = v; else delete x.statMods; })} rows={1} /></Field>
          <div className="field"><span className="field-label">技として使ったとき</span><UseEditor use={ab.use} content={content} onChange={u => set(x => { if (u) x.use = u; else delete x.use; })} /></div>
          <div className="field"><span className="field-label">持っている間のルール</span>
            {ab.rules.map((r, i) => <RuleEditor key={`${r.id}-${i}`} rule={r} content={content} onChange={nr => set(x => { x.rules[i] = nr; })} onDelete={() => set(x => { x.rules.splice(i, 1); })} />)}
            <button className="button" onClick={() => set(x => { x.rules.push({ id: uniqueId("rule", x.rules.map(r => r.id)), on: "battleStart", repeat: false, priority: 0, effects: [] }); })}><Plus size={12} />ルールを足す</button>
          </div>
        </>; })()}

        {tab === "companions" && (() => { const cp = current as Companion; const set = (r: (x: Companion) => void) => edit("companions", cp.id, r); return <>
          <StatsRow stats={cp.stats} onChange={s => set(x => { x.stats = s; })} />
          <Field label="見た目"><select value={cp.sprite ?? ""} onChange={v => set(x => { if (v.target.value) x.sprite = v.target.value; else delete x.sprite; })}><option value="">（なし）</option>{characters.map(id => <option key={id}>{id}</option>)}</select></Field>
          <div className="field"><span className="field-label">行動（手当ては誰かのHPが半分を切ると優先。戦闘中は「なかま」で指示できる）</span>
            {cp.actions.map((a, i) => <div key={i} className="form-row wrap">
              <input value={a.name} onChange={v => set(x => { x.actions[i]!.name = v.target.value || x.actions[i]!.name; })} />
              <select value={a.kind} onChange={v => set(x => { x.actions[i]!.kind = v.target.value as typeof a.kind; })}><option value="attack">攻撃</option><option value="heal">手当て</option><option value="guard">守り</option></select>
              <input type="number" min={0} value={a.power} onChange={v => set(x => { x.actions[i]!.power = num(v.target.value); })} style={{ width: "5em" }} title="威力・回復量" />
              <button className="icon-button" disabled={cp.actions.length <= 1} onClick={() => set(x => { x.actions.splice(i, 1); })}><Trash2 size={12} /></button>
            </div>)}
            <button className="button" onClick={() => set(x => { x.actions.push({ name: "攻撃", kind: "attack", power: 0 }); })}><Plus size={12} />行動を足す</button>
          </div>
          <p className="muted small">仲間にするには、会話やイベントの効果「joinParty」を使います（効果フォームでは JSON: {'{"type": "joinParty", "companion": "'}{cp.id}{'"}'}）。</p>
        </>; })()}
      </div>}
    </section>
  </div>;
}

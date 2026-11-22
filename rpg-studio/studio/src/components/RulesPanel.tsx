import { useState } from "react";
import { Plus, ScrollText, Sparkles, Trash2 } from "lucide-react";
import { RULE_TRIGGERS, StatModsSchema, type GameContent, type Rule, type Trait } from "@rpg/schema";
import { Field, JsonField, TextInput } from "./Inspector";
import { ConditionEditor, EffectListEditor } from "./forms";
import { ScriptField } from "./ScriptsPanel";
import type { ProjectStore } from "../lib/useProject";

interface Props { store: ProjectStore; content: GameContent }
type RuleFile = { formatVersion: number; rules: Rule[] };
type DbFile = { traits: Trait[] };

const TRIGGER_LABEL: Record<string, string> = {
  auto: "条件が成り立った時", step: "歩くたび", tick: "時間が進むたび", mapEnter: "マップに入った時", battleStart: "戦闘開始", turnEnd: "ターン終了",
  dealDamage: "ダメージを与える時", takeDamage: "ダメージを受ける時", lethalDamage: "倒れそうな時", victory: "勝利", defeat: "敗北",
  bump: "ぶつかった時", examine: "何もない所を調べた時", verb: "動詞を使った時", signal: "シグナルを受けた時",
};

const uniqueId = (base: string, taken: string[]) => { if (!taken.includes(base)) return base; for (let i = 2; ; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`; };

export function RuleEditor({ rule, onChange, onDelete, content }: { rule: Rule; onChange: (r: Rule) => void; onDelete: () => void; content: GameContent }) {
  return <div className="card choice-card">
    <div className="form-row wrap">
      <Field label="ID"><TextInput mono value={rule.id} onCommit={v => /^[a-z0-9][a-z0-9_-]*$/i.test(v) && onChange({ ...rule, id: v })} /></Field>
      <label className="field" title="消さずに一時的に止める（検証で警告が出ます）"><span className="field-label">一時的に無効</span><input type="checkbox" checked={Boolean(rule.disabled)} onChange={ev => { const { disabled: _d, ...rest } = rule; onChange(ev.target.checked ? { ...rest, disabled: true } : rest); }} /></label>
      <Field label="いつ"><select value={rule.on} onChange={e => onChange({ ...rule, on: e.target.value as Rule["on"] })}>{RULE_TRIGGERS.map(t => <option key={t} value={t}>{TRIGGER_LABEL[t] ?? t}（{t}）</option>)}</select></Field>
      {(rule.on === "verb" || rule.on === "signal") && <Field label={rule.on === "verb" ? "動詞" : "シグナル"}><select value={rule.match ?? ""} onChange={e => onChange({ ...rule, match: e.target.value || undefined })}><option value="">{rule.on === "verb" ? "（どの動詞でも）" : "（選ぶ）"}</option>{Object.keys(rule.on === "verb" ? content.project.verbs : content.project.signals).map(id => <option key={id} value={id}>{id}</option>)}</select></Field>}
      <Field label="一度だけ"><select value={rule.once ?? ""} onChange={e => onChange({ ...rule, once: (e.target.value || undefined) as Rule["once"] })}><option value="">何度でも</option><option value="game">一度だけ</option><option value="map">マップごとに一度</option><option value="battle">戦闘ごとに一度</option></select></Field>
      <Field label="確率％"><input type="number" min={0} max={100} value={typeof rule.chance === "number" ? rule.chance : ""} placeholder="100" onChange={e => onChange({ ...rule, chance: e.target.value === "" ? undefined : Number(e.target.value) })} style={{ width: "5em" }} /></Field>
      <span className="spacer" />
      <button className="button danger" onClick={onDelete}><Trash2 size={12} /></button>
    </div>
    <Field label="説明"><TextInput value={rule.description ?? ""} onCommit={v => onChange({ ...rule, description: v || undefined })} /></Field>
    <div className="field"><span className="field-label">条件</span><ConditionEditor value={rule.when} content={content} onChange={w => onChange({ ...rule, when: w })} /></div>
    <div className="field"><span className="field-label">起きること</span><EffectListEditor value={rule.effects} content={content} onChange={v => onChange({ ...rule, effects: v })} /></div>
  </div>;
}

/** Project-wide rules (rules.json) and traits (races, classes, curses…) as forms. */
export default function RulesPanel({ store, content }: Props) {
  const [tab, setTab] = useState<"rules" | "traits">("rules");
  const [selected, setSelected] = useState<string | null>(null);
  const rulesPath = content.project.rulesPath;
  const dbPath = content.project.databasePath;
  const editRules = (recipe: (f: RuleFile) => void) => rulesPath && store.updateJson<RuleFile>(rulesPath, recipe);
  const editTrait = (id: string, recipe: (t: Trait) => void) => store.updateJson<DbFile>(dbPath, f => { const t = f.traits.find(x => x.id === id); if (t) recipe(t); });
  const trait = content.database.traits.find(t => t.id === selected);

  return <div className="story-panel">
    <aside className="story-list card">
      <div className="chips">
        <button className={`chip ${tab === "rules" ? "is-on" : ""}`} onClick={() => setTab("rules")}>ルール</button>
        <button className={`chip ${tab === "traits" ? "is-on" : ""}`} onClick={() => setTab("traits")}>特性（種族・職業など）</button>
      </div>
      {tab === "traits" && <>
        <button className="button" onClick={() => { const id = uniqueId("new-trait", content.database.traits.map(t => t.id)); store.updateJson<DbFile>(dbPath, f => { f.traits.push({ id, name: "新しい特性", category: "種族", description: "", tags: [], abilities: [], rules: [], onGrant: [] }); }); setSelected(id); }}><Plus size={13} />特性</button>
        {content.database.traits.map(t => <button key={t.id} className={`map-item ${selected === t.id ? "is-active" : ""}`} onClick={() => setSelected(t.id)}><Sparkles size={12} /><span>{t.name}</span><code className="small">{t.category}</code></button>)}
      </>}
      {tab === "rules" && <p className="muted small">世界全体のルール（rules.json）。能力・特性・アイテム・敵が持つルールは、それぞれの編集画面で。</p>}
    </aside>
    <section className="story-editor">
      {tab === "rules" && <div className="card">
        <header><ScrollText size={15} /><h3>全体のルール</h3><span className="spacer" />
          {rulesPath && <button className="button" onClick={() => editRules(f => { f.rules.push({ id: uniqueId("new-rule", f.rules.map(r => r.id)), on: "auto", repeat: false, priority: 0, effects: [{ type: "message", text: "……" }] }); })}><Plus size={13} />ルール</button>}
        </header>
        {!rulesPath && <p className="muted">project.json に rulesPath がありません。</p>}
        {content.rules.map((rule, i) => <RuleEditor key={`${rule.id}-${i}`} rule={rule} content={content} onChange={r => editRules(f => { f.rules[i] = r; })} onDelete={() => editRules(f => { f.rules.splice(i, 1); })} />)}
      </div>}
      {tab === "traits" && !trait && <div className="empty">左から特性を選ぶか、新しく作ってください。種族・職業・呪い・祝福など、持っている間だけ効く性質です。</div>}
      {tab === "traits" && trait && <div className="card">
        <header><Sparkles size={15} /><h3>特性 <code>{trait.id}</code></h3><span className="spacer" />
          <button className="button danger" onClick={() => { if (confirm(`特性 ${trait.id} を消しますか？`)) { store.updateJson<DbFile>(dbPath, f => { f.traits = f.traits.filter(t => t.id !== trait.id); }); setSelected(null); } }}><Trash2 size={13} />削除</button>
        </header>
        <div className="form-row wrap">
          <Field label="名前"><TextInput value={trait.name} onCommit={v => editTrait(trait.id, t => { t.name = v || t.name; })} /></Field>
          <Field label="分類"><TextInput value={trait.category} onCommit={v => editTrait(trait.id, t => { t.category = v || t.category; })} /></Field>
        </div>
        <Field label="説明"><TextInput value={trait.description} onCommit={v => editTrait(trait.id, t => { t.description = v; })} /></Field>
        <ScriptField key={`script-${trait.id}`} value={trait.script} content={content} store={store} ownerId={trait.id} templateFor="command" onChange={r => editTrait(trait.id, t => { if (r) t.script = r; else delete t.script; })} />
        <Field label="能力値の補正" hint='例 {"maxHp": 4, "defense": 1}（式も可）'><JsonField value={trait.statMods} schema={StatModsSchema} onCommit={v => editTrait(trait.id, t => { if (v) t.statMods = v; else delete t.statMods; })} rows={1} /></Field>
        <div className="field"><span className="field-label">持っている間に使える能力</span>
          <div className="chips">{content.database.abilities.map(a => <button key={a.id} className={`chip ${trait.abilities.includes(a.id) ? "is-on" : ""}`} onClick={() => editTrait(trait.id, t => { t.abilities = t.abilities.includes(a.id) ? t.abilities.filter(x => x !== a.id) : [...t.abilities, a.id]; })}>{a.name}</button>)}</div>
        </div>
        <div className="field"><span className="field-label">得た時に起きること</span><EffectListEditor value={trait.onGrant} content={content} onChange={v => editTrait(trait.id, t => { t.onGrant = v; })} /></div>
        <div className="field"><span className="field-label">この特性のルール</span>
          {trait.rules.map((rule, i) => <RuleEditor key={`${rule.id}-${i}`} rule={rule} content={content} onChange={r => editTrait(trait.id, t => { t.rules[i] = r; })} onDelete={() => editTrait(trait.id, t => { t.rules.splice(i, 1); })} />)}
          <button className="button" onClick={() => editTrait(trait.id, t => { t.rules.push({ id: uniqueId("rule", t.rules.map(r => r.id)), on: "battleStart", repeat: false, priority: 0, effects: [] }); })}><Plus size={12} />ルールを足す</button>
        </div>
      </div>}
    </section>
  </div>;
}

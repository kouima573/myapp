/**
 * Form editors for conditions and effect lists. Common shapes get real inputs (selects for flags, items, maps…);
 * everything else stays editable as validated JSON, so no data shape is ever out of reach.
 */
import { useState } from "react";
import { ArrowDown, ArrowUp, Braces, Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { ConditionSchema, EffectSchema, type Condition, type Effect, type GameContent } from "@rpg/schema";
import { MODULES } from "../../../packages/modules/src/index";
import { JsonField } from "./Inspector";

type Ctx = { content: GameContent };

const Select = ({ value, options, onChange, placeholder }: { value: string; options: Array<[string, string]>; onChange: (v: string) => void; placeholder?: string }) =>
  <select value={value} onChange={e => onChange(e.target.value)}>
    {!options.some(([v]) => v === value) && <option value={value}>{value || placeholder || "（選ぶ）"}</option>}
    {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
  </select>;

const ids = {
  flags: (c: GameContent) => Object.keys(c.project.flags).map(id => [id, id] as [string, string]),
  vars: (c: GameContent) => Object.entries(c.project.variables).map(([id, d]) => [id, d.label ? `${d.label}（${id}）` : id] as [string, string]),
  items: (c: GameContent) => c.database.items.map(i => [i.id, `${i.name}（${i.id}）`] as [string, string]),
  maps: (c: GameContent) => c.project.maps.map(m => [m.id, `${m.title}（${m.id}）`] as [string, string]),
  enemies: (c: GameContent) => c.database.enemies.map(e => [e.id, `${e.name}（${e.id}）`] as [string, string]),
  sets: (c: GameContent) => Object.entries(c.project.sets).map(([id, d]) => [id, d.label ? `${d.label}（${id}）` : id] as [string, string]),
  dialogues: (c: GameContent) => Object.values(c.dialogues).map(d => [d.id, `${d.speaker}（${d.id}）`] as [string, string]),
  events: (c: GameContent) => Object.values(c.events).map(e => [e.id, `${e.label}（${e.id}）`] as [string, string]),
};

/* ------------------------------------------------------------------ conditions */

const CONDITION_KINDS: Array<[string, string, (c: GameContent) => Condition]> = [
  ["flag", "フラグが立っている", c => ({ flag: Object.keys(c.project.flags)[0] ?? "" })],
  ["var", "変数を比べる", c => ({ var: Object.keys(c.project.variables)[0] ?? "", op: ">=", value: 1 })],
  ["item", "アイテムを持っている", c => ({ item: c.database.items[0]?.id ?? "" })],
  ["set", "集合に含まれる（知っている）", c => ({ set: Object.keys(c.project.sets)[0] ?? "", has: "" })],
  ["map", "いるマップ", c => ({ map: c.project.start.mapId })],
  ["done", "完了済み（once・markDone）", () => ({ done: "" })],
  ["not", "〜でない", c => ({ not: { flag: Object.keys(c.project.flags)[0] ?? "" } })],
];

export function ConditionEditor({ value, onChange, content }: { value: Condition | undefined; onChange: (v: Condition | undefined) => void } & Ctx) {
  const [raw, setRaw] = useState(false);
  const kind = value ? (Object.keys(value)[0] ?? "") : "";
  const simple = !value || CONDITION_KINDS.some(([k]) => k === kind) && !(kind === "not" && typeof (value as { not: Condition }).not !== "object");
  if (raw || !simple) return <div className="form-raw">
    <JsonField value={value} schema={ConditionSchema} onCommit={onChange} rows={2} placeholder='空なら「いつでも」。例 {"flag": "metElder"}' />
    {simple && <button className="link-button" onClick={() => setRaw(false)}>フォームに戻す</button>}
  </div>;
  const c = value as Record<string, unknown> | undefined;
  return <div className="form-row">
    <Select value={kind} placeholder="いつでも" options={[["", "いつでも"], ...CONDITION_KINDS.map(([k, l]) => [k, l] as [string, string])]} onChange={k => onChange(k ? CONDITION_KINDS.find(([x]) => x === k)![2](content) : undefined)} />
    {kind === "flag" && <><Select value={String(c!.flag)} options={ids.flags(content)} onChange={v => onChange({ flag: v, ...(c!.is === false ? { is: false } : {}) })} /><Select value={c!.is === false ? "off" : "on"} options={[["on", "ON"], ["off", "OFF"]]} onChange={v => onChange({ flag: String(c!.flag), ...(v === "off" ? { is: false } : {}) })} /></>}
    {kind === "var" && <><Select value={String(c!.var)} options={ids.vars(content)} onChange={v => onChange({ ...(c as object), var: v } as Condition)} /><Select value={String(c!.op)} options={[">=", ">", "==", "!=", "<", "<="].map(o => [o, o])} onChange={v => onChange({ ...(c as object), op: v } as Condition)} /><input type="number" value={typeof c!.value === "number" ? c!.value : 0} onChange={e => onChange({ ...(c as object), value: Number(e.target.value) } as Condition)} /></>}
    {kind === "item" && <Select value={String(c!.item)} options={ids.items(content)} onChange={v => onChange({ item: v })} />}
    {kind === "set" && <><Select value={String(c!.set)} options={ids.sets(content)} onChange={v => onChange({ set: v, has: String(c!.has ?? "") })} /><input placeholder="値" value={String(c!.has ?? "")} onChange={e => onChange({ set: String(c!.set), has: e.target.value })} /></>}
    {kind === "map" && <Select value={String(c!.map)} options={ids.maps(content)} onChange={v => onChange({ map: v })} />}
    {kind === "done" && <input placeholder="完了ID" value={String(c!.done ?? "")} onChange={e => onChange({ done: e.target.value })} />}
    {kind === "not" && <div className="form-nested"><ConditionEditor value={(c as { not: Condition }).not} onChange={v => onChange(v ? { not: v } : undefined)} content={content} /></div>}
    <button className="icon-button" title="JSONで編集" onClick={() => setRaw(true)}><Braces size={13} /></button>
  </div>;
}

/* ------------------------------------------------------------------ effects */

const EFFECT_KINDS: Array<[Effect["type"], string, (c: GameContent) => Effect]> = [
  ["message", "メッセージ", () => ({ type: "message", text: "……" })],
  ["setFlag", "フラグを立てる", c => ({ type: "setFlag", flag: Object.keys(c.project.flags)[0] ?? "" })],
  ["setVar", "変数を変える", c => ({ type: "setVar", var: Object.keys(c.project.variables)[0] ?? "", op: "add", value: 1 })],
  ["giveItem", "アイテムをもらう", c => ({ type: "giveItem", item: c.database.items[0]?.id ?? "" })],
  ["takeItem", "アイテムを渡す", c => ({ type: "takeItem", item: c.database.items[0]?.id ?? "" })],
  ["heal", "回復", () => ({ type: "heal" })],
  ["teleport", "移動", c => ({ type: "teleport", mapId: c.project.start.mapId, x: c.project.start.x, y: c.project.start.y })],
  ["battle", "戦闘", c => ({ type: "battle", enemy: c.database.enemies[0]?.id ?? "" })],
  ["dialogue", "会話を始める", c => ({ type: "dialogue", dialogue: Object.keys(c.dialogues)[0] ?? "" })],
  ["event", "イベントを起こす", c => ({ type: "event", event: Object.keys(c.events)[0] ?? "" })],
  ["addToSet", "集合に加える（覚える）", c => ({ type: "addToSet", set: Object.keys(c.project.sets)[0] ?? "", value: "" })],
  ["markDone", "完了にする", () => ({ type: "markDone", id: "" })],
  ["startScene", "ジャンルモジュールを開く", () => ({ type: "startScene", system: "novel", scene: "play", args: { script: [{ speaker: "", text: "……" }] } })],
  ["if", "もし〜なら", c => ({ type: "if", when: { flag: Object.keys(c.project.flags)[0] ?? "" }, then: [], else: [] })],
];

function EffectForm({ effect, onChange, content }: { effect: Effect; onChange: (e: Effect) => void } & Ctx) {
  const e = effect as Record<string, unknown> & Effect;
  const set = (patch: Record<string, unknown>) => onChange({ ...e, ...patch } as Effect);
  switch (effect.type) {
    case "message": return <><input className="grow" placeholder="話し手（任意）" value={effect.speaker ?? ""} onChange={x => set({ speaker: x.target.value || undefined })} style={{ maxWidth: "8em" }} /><textarea className="grow" rows={2} value={effect.text} onChange={x => set({ text: x.target.value })} /></>;
    case "setFlag": return <><Select value={effect.flag} options={ids.flags(content)} onChange={v => set({ flag: v })} /><Select value={effect.value === false ? "off" : "on"} options={[["on", "ON にする"], ["off", "OFF にする"]]} onChange={v => set({ value: v === "off" ? false : undefined })} /></>;
    case "setVar": return <><Select value={effect.var} options={ids.vars(content)} onChange={v => set({ var: v })} /><Select value={effect.op ?? "set"} options={[["set", "＝"], ["add", "＋"], ["sub", "－"]]} onChange={v => set({ op: v === "set" ? undefined : v })} />{typeof effect.value === "number" ? <input type="number" value={effect.value} onChange={x => set({ value: Number(x.target.value) })} /> : <code className="small">式</code>}</>;
    case "giveItem": case "takeItem": return <><Select value={effect.item} options={ids.items(content)} onChange={v => set({ item: v })} /><input type="number" min={1} value={effect.count ?? 1} onChange={x => set({ count: Number(x.target.value) > 1 ? Number(x.target.value) : undefined })} style={{ width: "4em" }} /></>;
    case "heal": return <><input type="number" placeholder="全快" value={typeof effect.amount === "number" ? effect.amount : ""} onChange={x => set({ amount: x.target.value === "" ? undefined : Number(x.target.value) })} style={{ width: "6em" }} /><Select value={effect.target ?? "player"} options={[["player", "主人公"], ["party", "仲間"], ["all", "全員"]]} onChange={v => set({ target: v === "player" ? undefined : v })} /></>;
    case "teleport": return <><Select value={effect.mapId} options={ids.maps(content)} onChange={v => set({ mapId: v })} /><input type="number" value={effect.x} onChange={x => set({ x: Number(x.target.value) })} style={{ width: "4em" }} /><input type="number" value={effect.y} onChange={x => set({ y: Number(x.target.value) })} style={{ width: "4em" }} /></>;
    case "battle": return <><Select value={effect.enemy} options={ids.enemies(content)} onChange={v => set({ enemy: v })} /><Select value={effect.onDefeat ?? "respawn"} options={[["respawn", "負けたら戻される"], ["continue", "負けても続く"]]} onChange={v => set({ onDefeat: v === "respawn" ? undefined : v })} /></>;
    case "dialogue": return <Select value={effect.dialogue} options={ids.dialogues(content)} onChange={v => set({ dialogue: v })} />;
    case "event": return <Select value={effect.event} options={ids.events(content)} onChange={v => set({ event: v })} />;
    case "addToSet": return <><Select value={effect.set} options={ids.sets(content)} onChange={v => set({ set: v })} /><input placeholder="値" value={effect.value} onChange={x => set({ value: x.target.value })} /></>;
    case "markDone": return <input placeholder="完了ID" value={effect.id} onChange={x => set({ id: x.target.value })} />;
    case "startScene": return <SceneArgsForm effect={effect} onChange={onChange} content={content} />;
    case "if": return <div className="form-nested">
      <span className="field-label">条件</span><ConditionEditor value={effect.when} onChange={w => w && set({ when: w })} content={content} />
      <span className="field-label">なら</span><EffectListEditor value={effect.then} onChange={v => set({ then: v })} content={content} />
      <span className="field-label">でなければ</span><EffectListEditor value={effect.else ?? []} onChange={v => set({ else: v.length ? v : undefined })} content={content} />
    </div>;
    default: return null;
  }
}

/** startScene: module / scene choice, then a board editor (rows), a script editor (novel) or JSON args. */
function SceneArgsForm({ effect, onChange, content }: { effect: Extract<Effect, { type: "startScene" }>; onChange: (e: Effect) => void } & Ctx) {
  const info = MODULES[effect.system];
  const scenes = Object.keys(info?.system.scenes ?? {});
  const args = (effect.args ?? {}) as Record<string, unknown>;
  const problems = info?.system.scenes?.[effect.scene]?.checkArgs?.(args, { content }) ?? [];
  const setArgs = (patch: Record<string, unknown>) => onChange({ ...effect, args: { ...args, ...patch } });
  const rows = Array.isArray(args.rows) && args.rows.every(r => typeof r === "string") ? (args.rows as string[]) : null;
  const script = effect.system === "novel" && Array.isArray(args.script) ? (args.script as Array<Record<string, unknown>>) : null;
  return <div className="form-nested">
    <div className="form-row">
      <Select value={effect.system} options={[...Object.entries(MODULES).map(([id, m]) => [id, `${m.title}（${id}）`] as [string, string]), ...content.project.systems.map(s => [s.id, `${s.title}（${s.id}）`] as [string, string])]} onChange={v => onChange({ ...effect, system: v, scene: Object.keys(MODULES[v]?.system.scenes ?? {})[0] ?? effect.scene })} />
      {scenes.length > 0 && <Select value={effect.scene} options={scenes.map(s => [s, s])} onChange={v => onChange({ ...effect, scene: v })} />}
      {!content.project.modules[effect.system] && MODULES[effect.system] && <span className="field-error">project.json で有効にしていません（「発想」画面で有効化）</span>}
    </div>
    {rows && <label className="field"><span className="field-label">盤面（1行ずつ。記号は docs/genre-modules.md）</span>
      <textarea className="mono board" rows={Math.min(16, rows.length + 1)} value={rows.join("\n")} onChange={e => setArgs({ rows: e.target.value.split("\n") })} spellCheck={false} /></label>}
    {script && <div className="field"><span className="field-label">台本</span>
      {script.map((line, i) => <div key={i} className="form-row">
        <input placeholder="話し手" value={String(line.speaker ?? "")} onChange={e => setArgs({ script: script.map((l, j) => (j === i ? { ...l, speaker: e.target.value || undefined } : l)) })} style={{ maxWidth: "7em" }} />
        <input className="grow" placeholder="セリフ" value={String(line.text ?? "")} onChange={e => setArgs({ script: script.map((l, j) => (j === i ? { ...l, text: e.target.value } : l)) })} />
        <input placeholder="ラベル" value={String(line.label ?? "")} onChange={e => setArgs({ script: script.map((l, j) => (j === i ? { ...l, label: e.target.value || undefined } : l)) })} style={{ maxWidth: "6em" }} />
        <button className="icon-button" onClick={() => setArgs({ script: script.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>
      </div>)}
      <button className="button" onClick={() => setArgs({ script: [...script, { speaker: "", text: "……" }] })}><Plus size={12} />行を足す</button>
      <span className="field-hint">選択肢・背景・立ち絵・効果は下のJSONで（choices / bg / portrait / effects）。</span>
    </div>}
    <JsonField value={args} schema={z.record(z.string(), z.unknown())} onCommit={v => onChange({ ...effect, args: v ?? {} })} rows={rows || script ? 3 : 6} />
    {problems.map((p, i) => <span key={i} className="field-error">{p}</span>)}
  </div>;
}

export function EffectListEditor({ value, onChange, content }: { value: Effect[]; onChange: (v: Effect[]) => void } & Ctx) {
  const [rawIndex, setRawIndex] = useState<number | null>(null);
  const update = (i: number, e: Effect) => onChange(value.map((x, j) => (j === i ? e : x)));
  const move = (i: number, d: number) => { const next = [...value]; const [x] = next.splice(i, 1); next.splice(i + d, 0, x!); onChange(next); };
  return <div className="effect-list">
    {value.map((effect, i) => {
      const known = EFFECT_KINDS.some(([t]) => t === effect.type);
      return <div key={i} className="effect-item">
        <div className="form-row">
          <Select value={effect.type} options={[...EFFECT_KINDS.map(([t, l]) => [t, l] as [string, string]), ...(known ? [] : [[effect.type, effect.type] as [string, string]])]} onChange={t => update(i, EFFECT_KINDS.find(([x]) => x === t)![2](content))} />
          <span className="spacer" />
          <button className="icon-button" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={12} /></button>
          <button className="icon-button" disabled={i === value.length - 1} onClick={() => move(i, 1)}><ArrowDown size={12} /></button>
          <button className="icon-button" title="JSONで編集" onClick={() => setRawIndex(rawIndex === i ? null : i)}><Braces size={12} /></button>
          <button className="icon-button" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
        </div>
        {rawIndex === i || !known ? <JsonField value={effect} schema={EffectSchema} onCommit={v => v && update(i, v)} rows={4} /> : <div className="form-row wrap"><EffectForm effect={effect} onChange={e => update(i, e)} content={content} /></div>}
      </div>;
    })}
    <button className="button" onClick={() => onChange([...value, { type: "message", text: "……" }])}><Plus size={12} />効果を足す</button>
  </div>;
}

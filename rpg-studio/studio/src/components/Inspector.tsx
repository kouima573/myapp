import { useEffect, useState, type ReactNode } from "react";
import { Play, Trash2 } from "lucide-react";
import { ConditionSchema, NpcSchema, type Condition, type GameContent, type GameMap, type Interactable, type Npc, type Portal } from "@rpg/schema";
import type { z } from "zod";
import type { ProjectStore } from "../lib/useProject";
import type { Selection } from "./MapEditor";

interface Props {
  store: ProjectStore;
  content: GameContent;
  mapId: string;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onPlayFrom: (x: number, y: number) => void;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

/** Text input that commits on blur / Enter, so typing does not save a half-written value. */
function TextInput({ value, onCommit, mono, type = "text", min, max }: { value: string | number; onCommit: (value: string) => void; mono?: boolean; type?: string; min?: number; max?: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => { if (draft !== String(value)) onCommit(draft); };
  return <input className={mono ? "mono" : undefined} type={type} min={min} max={max} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setDraft(String(value)); }} />;
}

/** JSON editor for nested data (conditions, dialogue rules). Only valid values are committed. */
function JsonField<T>({ value, schema, onCommit, placeholder, rows = 3 }: { value: T | undefined; schema: z.ZodType<T>; onCommit: (value: T | undefined) => void; placeholder?: string; rows?: number }) {
  const text = value === undefined ? "" : JSON.stringify(value);
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(text); setError(null); }, [text]);
  const commit = () => {
    if (draft.trim() === "") { setError(null); if (value !== undefined) onCommit(undefined); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(draft); } catch { setError("JSONとして読めません"); return; }
    const result = schema.safeParse(parsed);
    if (!result.success) { setError(result.error.issues[0]?.message ?? "形式が違います"); return; }
    setError(null);
    if (JSON.stringify(result.data) !== text) onCommit(result.data);
  };
  return <>
    <textarea className={`mono ${error ? "has-error" : ""}`} rows={rows} value={draft} placeholder={placeholder} onChange={e => setDraft(e.target.value)} onBlur={commit} spellCheck={false} />
    {error && <span className="field-error">{error}</span>}
  </>;
}

const DirectionSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
  <select value={value} onChange={e => onChange(e.target.value)}>
    <option value="down">下</option><option value="up">上</option><option value="left">左</option><option value="right">右</option>
  </select>;

export default function Inspector({ store, content, mapId, selection, onSelect, onPlayFrom }: Props) {
  const map = content.maps[mapId]!;
  const mapPath = content.project.maps.find(m => m.id === mapId)!.path;
  const characters = content.assets.assets.filter(a => a.kind === "character");
  const edit = (recipe: (draft: GameMap) => void) => store.updateJson<GameMap>(mapPath, recipe);

  if (!selection) {
    return <div className="inspector">
      <h3>マップ設定</h3>
      <Field label="タイトル"><TextInput value={map.title} onCommit={v => { edit(d => { d.title = v || d.title; }); store.updateJson<{ maps: Array<{ id: string; title: string }> }>("project.json", d => { const ref = d.maps.find(m => m.id === mapId); if (ref) ref.title = v || ref.title; }); }} /></Field>
      <div className="field-row">
        <Field label="幅"><TextInput type="number" min={4} max={128} value={map.width} onCommit={v => resize(Number(v), map.height)} /></Field>
        <Field label="高さ"><TextInput type="number" min={4} max={128} value={map.height} onCommit={v => resize(map.width, Number(v))} /></Field>
      </div>
      <Field label="ランダムエンカウント" hint="1歩ごとの確率。0で無効。対象タイルが空なら全通行可タイル">
        <div className="field-row">
          <TextInput type="number" min={0} max={100} value={Math.round((map.encounters?.rate ?? 0) * 100)} onCommit={v => edit(d => {
            const rate = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
            if (!rate) { delete d.encounters; return; }
            d.encounters = { rate, enemies: d.encounters?.enemies ?? [content.database.enemies[0]?.id ?? "enemy"], tiles: d.encounters?.tiles ?? [] };
          })} />
          <span className="unit">%</span>
        </div>
      </Field>
      {map.encounters && <>
        <Field label="出現する敵">
          <div className="chips">{content.database.enemies.map(enemy => {
            const on = map.encounters!.enemies.includes(enemy.id);
            return <button key={enemy.id} className={`chip ${on ? "is-on" : ""}`} onClick={() => edit(d => { const list = d.encounters!.enemies; d.encounters!.enemies = on ? list.filter(e => e !== enemy.id) : [...list, enemy.id]; if (!d.encounters!.enemies.length) d.encounters!.enemies = [enemy.id]; })}>{enemy.name}</button>;
          })}</div>
        </Field>
        <Field label="対象タイル">
          <div className="chips">{content.tileset.tiles.filter(t => t.passable).map(t => {
            const on = map.encounters!.tiles.includes(t.code);
            return <button key={t.code} className={`chip ${on ? "is-on" : ""}`} onClick={() => edit(d => { const list = d.encounters!.tiles; d.encounters!.tiles = on ? list.filter(c => c !== t.code) : [...list, t.code]; })}>{t.name}</button>;
          })}</div>
        </Field>
      </>}
      <p className="muted small">マップ上をクリックするとタイルや配置物の詳細を表示します。</p>
    </div>;
  }

  function resize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 4 || height < 4 || width > 128 || height > 128) { store.log("warn", "マップの大きさは4〜128で指定してください"); return; }
    const filler = content.tileset.tiles[0]!.code;
    edit(d => {
      d.rows = Array.from({ length: height }, (_, y) => { const row = Array.from(d.rows[y] ?? ""); return Array.from({ length: width }, (_, x) => row[x] ?? filler).join(""); });
      d.width = width; d.height = height;
    });
    store.log("info", `${mapId} を ${width}×${height} に変更しました。範囲外の配置物は検証エラーになります`);
  }

  if (selection.kind === "cell") {
    const code = Array.from(map.rows[selection.y] ?? "")[selection.x] ?? "";
    const tile = content.tileset.tiles.find(t => t.code === code);
    return <div className="inspector">
      <h3>セル ({selection.x}, {selection.y})</h3>
      <dl className="facts">
        <dt>タイル</dt><dd>{tile?.name ?? "不明"} <code>{code}</code></dd>
        <dt>通行</dt><dd>{tile?.passable ? "可" : tile?.passableWhen ? <>条件付き <code>{JSON.stringify(tile.passableWhen)}</code></> : "不可"}</dd>
      </dl>
      <button className="button" onClick={() => onPlayFrom(selection.x, selection.y)}><Play size={14} /> ここから試遊</button>
      <p className="muted small">タイルの種類や通行条件は「データ」→ tiles.json で編集します。</p>
    </div>;
  }

  const remove = () => {
    const key = selection.kind === "npc" ? "npcs" : selection.kind === "portal" ? "portals" : "interactables";
    edit(d => { (d as Record<string, unknown>)[key] = (d[key] as Array<{ id: string }>).filter(e => e.id !== selection.id); });
    onSelect(null);
  };
  const header = (title: string) => <div className="inspector-head"><h3>{title}</h3><button className="icon-button danger" onClick={remove} title="削除 (Delete)"><Trash2 size={14} /></button></div>;
  const coords = (x: number, y: number, set: (x: number, y: number) => void) => <div className="field-row">
    <Field label="X"><TextInput type="number" min={0} max={map.width - 1} value={x} onCommit={v => set(Number(v), y)} /></Field>
    <Field label="Y"><TextInput type="number" min={0} max={map.height - 1} value={y} onCommit={v => set(x, Number(v))} /></Field>
  </div>;

  if (selection.kind === "npc") {
    const npc = map.npcs.find(n => n.id === selection.id);
    if (!npc) return <div className="inspector"><p className="muted">選択したNPCが見つかりません。</p></div>;
    const set = (recipe: (n: Npc) => void) => edit(d => { const target = d.npcs.find(n => n.id === npc.id); if (target) recipe(target); });
    return <div className="inspector">
      {header(`NPC: ${npc.name}`)}
      <Field label="ID" hint="セーブ・参照に使う安定ID。変更は慎重に"><TextInput mono value={npc.id} onCommit={v => { set(n => { n.id = v; }); onSelect({ ...selection, id: v }); }} /></Field>
      <Field label="名前"><TextInput value={npc.name} onCommit={v => set(n => { n.name = v; })} /></Field>
      {coords(npc.x, npc.y, (x, y) => { set(n => { n.x = x; n.y = y; }); onSelect({ ...selection, x, y }); })}
      <div className="field-row">
        <Field label="向き"><DirectionSelect value={npc.facing} onChange={v => set(n => { n.facing = v as typeof n.facing; })} /></Field>
        <Field label="スプライト">
          <select value={npc.sprite ?? ""} onChange={e => set(n => { if (e.target.value) n.sprite = e.target.value; else delete n.sprite; })}>
            <option value="">（なし）</option>
            {characters.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
          </select>
        </Field>
      </div>
      <Field label="会話ルール" hint="上から順に、条件(when)を満たす最初の会話を使います">
        <div className="rule-list">
          {npc.dialogues.map((rule, index) => <div key={index} className="rule">
            <select value={rule.dialogue} onChange={e => set(n => { n.dialogues[index]!.dialogue = e.target.value; })}>
              {Object.values(content.dialogues).map(d => <option key={d.id} value={d.id}>{d.id}（{d.speaker}）</option>)}
            </select>
            <JsonField<Condition> value={rule.when} schema={ConditionSchema} rows={1} placeholder='条件なし 例: {"flag":"sentinelCalmed"}' onCommit={v => set(n => { if (v) n.dialogues[index]!.when = v; else delete n.dialogues[index]!.when; })} />
            <div className="rule-actions">
              <button className="text-button" disabled={index === 0} onClick={() => set(n => { const [r] = n.dialogues.splice(index, 1); n.dialogues.splice(index - 1, 0, r!); })}>↑</button>
              <button className="text-button" disabled={npc.dialogues.length === 1} onClick={() => set(n => { n.dialogues.splice(index, 1); })}>削除</button>
            </div>
          </div>)}
          <button className="text-button" onClick={() => set(n => { n.dialogues.unshift({ when: { flag: Object.keys(content.project.flags)[0] ?? "flag" }, dialogue: n.dialogues[0]!.dialogue }); })}>＋ 条件付きの会話を先頭に追加</button>
        </div>
      </Field>
      <Field label="表示条件 visibleWhen"><JsonField<Condition> value={npc.visibleWhen} schema={ConditionSchema} rows={1} placeholder="常に表示" onCommit={v => set(n => { if (v) n.visibleWhen = v; else delete n.visibleWhen; })} /></Field>
      <p className="muted small">会話本文は「データ」→ dialogues で編集します。</p>
      <details className="raw"><summary>JSON</summary><pre>{JSON.stringify(NpcSchema.parse(npc), null, 2)}</pre></details>
    </div>;
  }

  if (selection.kind === "portal") {
    const portal = map.portals.find(p => p.id === selection.id);
    if (!portal) return <div className="inspector"><p className="muted">選択した出入口が見つかりません。</p></div>;
    const set = (recipe: (p: Portal) => void) => edit(d => { const target = d.portals.find(p => p.id === portal.id); if (target) recipe(target); });
    const target = content.maps[portal.targetMapId];
    return <div className="inspector">
      {header(`出入口: ${portal.id}`)}
      <Field label="ID"><TextInput mono value={portal.id} onCommit={v => { set(p => { p.id = v; }); onSelect({ ...selection, id: v }); }} /></Field>
      {coords(portal.x, portal.y, (x, y) => { set(p => { p.x = x; p.y = y; }); onSelect({ ...selection, x, y }); })}
      <Field label="行き先マップ">
        <select value={portal.targetMapId} onChange={e => set(p => { p.targetMapId = e.target.value; })}>
          {content.project.maps.map(m => <option key={m.id} value={m.id}>{m.title}（{m.id}）</option>)}
        </select>
      </Field>
      <div className="field-row">
        <Field label="到着X"><TextInput type="number" min={0} max={(target?.width ?? 128) - 1} value={portal.targetX} onCommit={v => set(p => { p.targetX = Number(v); })} /></Field>
        <Field label="到着Y"><TextInput type="number" min={0} max={(target?.height ?? 128) - 1} value={portal.targetY} onCommit={v => set(p => { p.targetY = Number(v); })} /></Field>
        <Field label="到着時の向き"><DirectionSelect value={portal.facing ?? "down"} onChange={v => set(p => { p.facing = v as typeof p.facing; })} /></Field>
      </div>
      <Field label="通行条件 when"><JsonField<Condition> value={portal.when} schema={ConditionSchema} rows={1} placeholder="常に通れる" onCommit={v => set(p => { if (v) p.when = v; else delete p.when; })} /></Field>
    </div>;
  }

  const item = map.interactables.find(i => i.id === selection.id);
  if (!item) return <div className="inspector"><p className="muted">選択した仕掛けが見つかりません。</p></div>;
  const set = (recipe: (i: Interactable) => void) => edit(d => { const target = d.interactables.find(i => i.id === item.id); if (target) recipe(target); });
  const event = content.events[item.event];
  return <div className="inspector">
    {header(`仕掛け: ${item.label}`)}
    <Field label="ID"><TextInput mono value={item.id} onCommit={v => { set(i => { i.id = v; }); onSelect({ ...selection, id: v }); }} /></Field>
    <Field label="名前"><TextInput value={item.label} onCommit={v => set(i => { i.label = v; })} /></Field>
    {coords(item.x, item.y, (x, y) => { set(i => { i.x = x; i.y = y; }); onSelect({ ...selection, x, y }); })}
    <Field label="イベント">
      <select value={item.event} onChange={e => set(i => { i.event = e.target.value; })}>
        {Object.values(content.events).map(ev => <option key={ev.id} value={ev.id}>{ev.label}（{ev.id}）</option>)}
      </select>
    </Field>
    <div className="field-row">
      <Field label="発動"><select value={item.trigger} onChange={e => set(i => { i.trigger = e.target.value as typeof i.trigger; })}><option value="action">調べる</option><option value="touch">踏む</option></select></Field>
      <Field label="見た目"><select value={item.marker} onChange={e => set(i => { i.marker = e.target.value as typeof i.marker; })}>{["sparkle", "sign", "chest", "statue", "none"].map(m => <option key={m} value={m}>{m}</option>)}</select></Field>
      <Field label="通れない"><input type="checkbox" checked={item.solid} onChange={e => set(i => { i.solid = e.target.checked; })} /></Field>
    </div>
    <Field label="表示条件 visibleWhen"><JsonField<Condition> value={item.visibleWhen} schema={ConditionSchema} rows={1} placeholder="常に表示" onCommit={v => set(i => { if (v) i.visibleWhen = v; else delete i.visibleWhen; })} /></Field>
    {event && <div className="event-summary">
      <div className="muted small">イベント {event.id}{event.once ? "（1回のみ）" : ""}</div>
      {event.when && <div><span className="pill">条件</span> <code>{JSON.stringify(event.when)}</code></div>}
      <ol>{event.effects.map((effect, index) => <li key={index}><code>{effect.type}</code> {"text" in effect ? effect.text : "flag" in effect ? effect.flag : "enemy" in effect ? effect.enemy : "item" in effect ? effect.item : ""}</li>)}</ol>
    </div>}
  </div>;
}

import { useState } from "react";
import { MessageSquare, Plus, Trash2, Zap } from "lucide-react";
import { type Dialogue, type GameContent, type GameEvent } from "@rpg/schema";
import { Field, TextInput } from "./Inspector";
import { ConditionEditor, EffectListEditor } from "./forms";
import type { ProjectStore } from "../lib/useProject";

interface Props { store: ProjectStore; content: GameContent }
type DialogueFile = { formatVersion: number; dialogues: Dialogue[] };
type EventFile = { formatVersion: number; events: GameEvent[] };

function uniqueId(base: string, taken: Iterable<string>) {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Structured editors for dialogues and events: lines and choices as forms, conditions / effects as validated JSON. */
export default function StoryPanel({ store, content }: Props) {
  const [kind, setKind] = useState<"dialogue" | "event">("dialogue");
  const [selected, setSelected] = useState<string | null>(null);
  const dPath = content.project.dialoguesPath, ePath = content.project.eventsPath;
  const dialogues = Object.values(content.dialogues);
  const events = Object.values(content.events);
  const editD = (id: string, recipe: (d: Dialogue) => void) => store.updateJson<DialogueFile>(dPath, f => { const d = f.dialogues.find(x => x.id === id); if (d) recipe(d); });
  const editE = (id: string, recipe: (e: GameEvent) => void) => store.updateJson<EventFile>(ePath, f => { const e = f.events.find(x => x.id === id); if (e) recipe(e); });

  const addDialogue = () => {
    const id = uniqueId("new-dialogue", dialogues.map(d => d.id));
    store.updateJson<DialogueFile>(dPath, f => { f.dialogues.push({ id, speaker: "名前", lines: ["こんにちは。"], effects: [], choices: [] }); });
    setKind("dialogue"); setSelected(id);
  };
  const addEvent = () => {
    const id = uniqueId("new-event", events.map(e => e.id));
    store.updateJson<EventFile>(ePath, f => { f.events.push({ id, label: "新しいイベント", effects: [{ type: "message", text: "何かが起きた。" }], otherwise: [], once: false, afterDone: [] }); });
    setKind("event"); setSelected(id);
  };
  const d = kind === "dialogue" ? content.dialogues[selected ?? ""] : undefined;
  const e = kind === "event" ? content.events[selected ?? ""] : undefined;

  return <div className="story-panel">
    <aside className="story-list card">
      <header><h3>会話・イベント</h3></header>
      <div className="chips">
        <button className="button" onClick={addDialogue}><Plus size={13} />会話</button>
        <button className="button" onClick={addEvent}><Plus size={13} />イベント</button>
      </div>
      <div className="side-heading">会話（{dialogues.length}）</div>
      {dialogues.map(x => <button key={x.id} className={`map-item ${kind === "dialogue" && selected === x.id ? "is-active" : ""}`} onClick={() => { setKind("dialogue"); setSelected(x.id); }}><MessageSquare size={12} /><span>{x.speaker}</span><code className="small">{x.id}</code></button>)}
      <div className="side-heading">イベント（{events.length}）</div>
      {events.map(x => <button key={x.id} className={`map-item ${kind === "event" && selected === x.id ? "is-active" : ""}`} onClick={() => { setKind("event"); setSelected(x.id); }}><Zap size={12} /><span>{x.label}</span><code className="small">{x.id}</code></button>)}
    </aside>

    <section className="story-editor">
      {!d && !e && <div className="empty">左から会話かイベントを選ぶか、新しく作ってください。マップ上のNPC・仕掛けとのつなぎは「マップ」の右側（インスペクター）で設定します。</div>}
      {d && <div className="card">
        <header><MessageSquare size={15} /><h3>会話 <code>{d.id}</code></h3><span className="spacer" />
          <button className="button danger" onClick={() => { if (confirm(`会話 ${d.id} を消しますか？（参照している所は検証エラーになります）`)) { store.updateJson<DialogueFile>(dPath, f => { f.dialogues = f.dialogues.filter(x => x.id !== d.id); }); setSelected(null); } }}><Trash2 size={13} />削除</button>
        </header>
        <Field label="話し手"><TextInput value={d.speaker} onCommit={v => editD(d.id, x => { x.speaker = v || x.speaker; })} /></Field>
        <div className="field"><span className="field-label">台詞（1行ずつ。{"{{var.gold}}"} などの差し込み可。条件つきの行はJSON）</span>
          {d.lines.map((line, i) => <div key={i} className="field-row">
            {typeof line === "string"
              ? <div className="field"><TextInput value={line} onCommit={v => editD(d.id, x => { if (v.trim()) x.lines[i] = v; })} /></div>
              : <div className="field"><TextInput value={line.text} onCommit={v => editD(d.id, x => { const l = x.lines[i]; if (typeof l === "object" && v.trim()) l.text = v; })} /><ConditionEditor value={line.when} content={content} onChange={w => editD(d.id, x => { x.lines[i] = w ? { text: line.text, when: w } : line.text; })} /></div>}
            <button className="button" title="条件をつける／外す" onClick={() => editD(d.id, x => { const l = x.lines[i]!; x.lines[i] = typeof l === "string" ? { text: l, when: { flag: Object.keys(content.project.flags)[0] ?? "" } } : l.text; })}>条件</button>
            <button className="button" disabled={d.lines.length <= 1} onClick={() => editD(d.id, x => { x.lines.splice(i, 1); })}><Trash2 size={12} /></button>
          </div>)}
          <button className="button" onClick={() => editD(d.id, x => { x.lines.push("……"); })}><Plus size={12} />行を足す</button>
        </div>
        <Field label="会話の後の効果（選択肢がないとき）" hint='例: [{"type": "giveItem", "item": "herb"}]'><EffectListEditor value={d.effects} content={content} onChange={v => editD(d.id, x => { x.effects = v; })} /></Field>
        <div className="field"><span className="field-label">選択肢</span>
          {d.choices.map((c, i) => <div key={c.id + i} className="card choice-card">
            <div className="field-row">
              <Field label="ID"><TextInput mono value={c.id} onCommit={v => editD(d.id, x => { if (/^[a-z0-9][a-z0-9_-]*$/i.test(v)) x.choices[i]!.id = v; })} /></Field>
              <Field label="表示"><TextInput value={c.label} onCommit={v => editD(d.id, x => { if (v.trim()) x.choices[i]!.label = v; })} /></Field>
              <label className="field"><span className="field-label">一度だけ報酬</span><input type="checkbox" checked={c.once} onChange={ev => editD(d.id, x => { x.choices[i]!.once = ev.target.checked; })} /></label>
              <button className="button" onClick={() => editD(d.id, x => { x.choices.splice(i, 1); })}><Trash2 size={12} /></button>
            </div>
            <Field label="出す条件"><ConditionEditor value={c.when} content={content} onChange={w => editD(d.id, x => { if (w) x.choices[i]!.when = w; else delete x.choices[i]!.when; })} /></Field>
            <Field label="選んだときの効果"><EffectListEditor value={c.effects} content={content} onChange={v => editD(d.id, x => { x.choices[i]!.effects = v; })} /></Field>
          </div>)}
          <button className="button" onClick={() => editD(d.id, x => { x.choices.push({ id: uniqueId("choice", x.choices.map(c => c.id)), label: "はい", effects: [], once: false }); })}><Plus size={12} />選択肢を足す</button>
        </div>
      </div>}
      {e && <div className="card">
        <header><Zap size={15} /><h3>イベント <code>{e.id}</code></h3><span className="spacer" />
          <button className="button danger" onClick={() => { if (confirm(`イベント ${e.id} を消しますか？`)) { store.updateJson<EventFile>(ePath, f => { f.events = f.events.filter(x => x.id !== e.id); }); setSelected(null); } }}><Trash2 size={13} />削除</button>
        </header>
        <div className="field-row">
          <Field label="名前"><TextInput value={e.label} onCommit={v => editE(e.id, x => { x.label = v || x.label; })} /></Field>
          <label className="field"><span className="field-label">一度だけ</span><input type="checkbox" checked={e.once} onChange={ev => editE(e.id, x => { x.once = ev.target.checked; })} /></label>
        </div>
        <Field label="起きる条件（空なら常に）"><ConditionEditor value={e.when} content={content} onChange={w => editE(e.id, x => { if (w) x.when = w; else delete x.when; })} /></Field>
        <Field label="効果" hint="message・giveItem・setFlag・battle・startScene など（docs/project-format.md）"><EffectListEditor value={e.effects} content={content} onChange={v => editE(e.id, x => { x.effects = v; })} /></Field>
        <Field label="条件を満たさないとき"><EffectListEditor value={e.otherwise} content={content} onChange={v => editE(e.id, x => { x.otherwise = v; })} /></Field>
        {e.once && <Field label="2回目以降"><EffectListEditor value={e.afterDone} content={content} onChange={v => editE(e.id, x => { x.afterDone = v; })} /></Field>}
      </div>}
    </section>
  </div>;
}

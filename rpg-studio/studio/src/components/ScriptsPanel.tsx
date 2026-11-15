import { useMemo, useState } from "react";
import { ClipboardCopy, Code2, Plus } from "lucide-react";
import type { GameContent, GameMap, ScriptRef } from "@rpg/schema";
import type { ProjectStore } from "../lib/useProject";
import { SCRIPT_TEMPLATES, scriptAgentPrompt } from "../lib/scriptTemplates";

interface Props { store: ProjectStore; content: GameContent }

const refId = (ref: ScriptRef | undefined) => (ref === undefined ? undefined : typeof ref === "string" ? ref : ref.id);

/** Where each script is attached ("能力 時の砂", "マップ 遺跡"…). */
export function scriptUses(content: GameContent): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (ref: ScriptRef | undefined, label: string) => { const id = refId(ref); if (id) (out[id] ??= []).push(label); };
  const db = content.database;
  db.abilities.forEach(x => add(x.script, `能力「${x.name}」`));
  db.items.forEach(x => add(x.script, `アイテム「${x.name}」`));
  db.traits.forEach(x => add(x.script, `特性「${x.name}」`));
  db.enemies.forEach(x => add(x.script, `敵「${x.name}」`));
  db.companions.forEach(x => add(x.script, `仲間「${x.name}」`));
  Object.values(content.maps).forEach((m: GameMap) => {
    add(m.script, `マップ「${m.title}」`);
    m.entities.forEach(e => e.states.forEach((st, i) => add(st.script, `エンティティ「${e.name}」の状態${i + 1}`)));
    m.npcs.forEach(n => add(n.script, `NPC「${n.name}」`));
    m.interactables.forEach(n => add(n.script, `仕掛け「${n.id}」`));
    m.regions.forEach(n => add(n.script, `領域「${n.label ?? n.id}」`));
  });
  return out;
}

export const newScriptPath = (id: string) => `scripts/${id}.ts`;
export const validScriptId = (id: string) => /^[a-z0-9][a-z0-9_-]*$/i.test(id);

/** scripts/*.ts: code that can be attached to anything (abilities, items, enemies, maps, entities…). */
export default function ScriptsPanel({ store, content }: Props) {
  const scripts = content.scripts ?? [];
  const [selected, setSelected] = useState<string | null>(scripts[0] ?? null);
  const [newId, setNewId] = useState("");
  const [template, setTemplate] = useState(SCRIPT_TEMPLATES[0]!.id);
  const [idea, setIdea] = useState("");
  const [copied, setCopied] = useState(false);
  const uses = useMemo(() => scriptUses(content), [content]);
  const path = selected ? newScriptPath(selected) : null;
  const code = path ? store.texts[path] : undefined;
  const projectDir = store.source.kind === "local" ? "<このプロジェクトのフォルダ>" : "projects/sample-rpg";
  const problems = (store.build?.diagnostics ?? []).filter(d => selected && d.includes(`scripts/${selected}.ts`));

  const create = () => {
    const id = newId.trim();
    if (!validScriptId(id)) { store.log("error", "スクリプト名は英数字と - _ で（例: meteor-rain）"); return; }
    if (scripts.includes(id)) { setSelected(id); return; }
    store.setFileText(newScriptPath(id), SCRIPT_TEMPLATES.find(t => t.id === template)!.code);
    setSelected(id); setNewId("");
  };
  const copy = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(scriptAgentPrompt(selected, idea, uses[selected] ?? [], projectDir)); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    catch { store.log("error", "クリップボードにコピーできませんでした"); }
  };

  return <div className="story-panel">
    <aside className="story-list card">
      <header><h3>スクリプト</h3></header>
      <p className="muted small">データで書けない処理を、技・アイテム・特性・敵・仲間・マップ・エンティティに「スクリプト」として付けられます。付け先が有効な間だけ動きます（docs/scripting.md）。</p>
      <div className="new-map-form">
        <input placeholder="新しいスクリプト名（例: meteor-rain）" value={newId} onChange={e => setNewId(e.target.value)} onKeyDown={e => e.key === "Enter" && create()} />
        <select value={template} onChange={e => setTemplate(e.target.value)}>{SCRIPT_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}（{t.for}）</option>)}</select>
        <button className="button" onClick={create}><Plus size={13} />作る</button>
      </div>
      {scripts.map(id => <button key={id} className={`map-item ${selected === id ? "is-active" : ""}`} onClick={() => setSelected(id)}>
        <Code2 size={12} /><span>{id}</span><code className="small">{(uses[id] ?? []).length ? `${uses[id]!.length}か所` : "未使用"}</code>
      </button>)}
    </aside>
    <section className="story-editor">
      {!selected && <div className="empty">左で名前を入れて「作る」か、既存のスクリプトを選んでください。作ったら「敵・アイテム・仲間」やマップのエンティティの「スクリプト」欄で付け先を選びます。</div>}
      {selected && <div className="card script-card">
        <header><Code2 size={15} /><h3><code>scripts/{selected}.ts</code></h3><span className="spacer" />
          {store.dirty.has(path!) ? <span className="tag">保存待ち</span> : <span className="muted small">保存済み</span>}
        </header>
        <p className="small">付け先: {(uses[selected] ?? []).join("、") || <span className="muted">まだどこにも付いていません（各編集画面の「スクリプト」欄で選ぶ）</span>}</p>
        {problems.length > 0 && <pre className="prompt-preview error-text">{problems.join("\n")}</pre>}
        {code === undefined
          ? <p className="muted">読み込み中…（新しく作った場合は保存が終わると表示されます）</p>
          : <textarea className="code-editor" spellCheck={false} value={code}
              onChange={e => store.setFileText(path!, e.target.value)}
              onKeyDown={e => {
                if (e.key !== "Tab") return;
                e.preventDefault();
                const t = e.currentTarget, start = t.selectionStart, end = t.selectionEnd;
                store.setFileText(path!, `${t.value.slice(0, start)}  ${t.value.slice(end)}`);
                requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = start + 2; });
              }} rows={26} />}
        <p className="muted small">保存すると自動でビルドされ、試遊に反映されます。型の誤りはここに表示されます。</p>
        <div className="field"><span className="field-label">コードを書かずに作る: やりたいことを書いて、Codex／Claude Code への依頼文をコピー</span>
          <textarea rows={3} value={idea} placeholder="例: 使うと3ターンの間、敵と自分の位置（HP）が入れ替わる。4ターン目に元に戻る。" onChange={e => setIdea(e.target.value)} />
          <button className="button primary" onClick={() => void copy()}><ClipboardCopy size={13} />{copied ? "コピーしました" : "依頼文をコピー"}</button>
        </div>
      </div>}
    </section>
  </div>;
}

/** "script" field used by the database / entity / map forms: pick a script, edit its args, or create one from a template. */
export function ScriptField({ value, content, store, ownerId, onChange, templateFor = "skill" }: {
  value: ScriptRef | undefined; content: GameContent; store: ProjectStore; ownerId: string;
  onChange: (ref: ScriptRef | undefined) => void; templateFor?: string;
}) {
  const scripts = content.scripts ?? [];
  const id = refId(value);
  const args = value && typeof value === "object" ? value.args ?? {} : {};
  const [argText, setArgText] = useState(JSON.stringify(args));
  const [argError, setArgError] = useState("");
  const createFor = () => {
    let name = ownerId;
    for (let i = 2; scripts.includes(name); i++) name = `${ownerId}-${i}`;
    store.setFileText(newScriptPath(name), SCRIPT_TEMPLATES.find(t => t.id === templateFor)!.code);
    onChange(name);
    store.log("ok", `scripts/${name}.ts を作りました。「スクリプト」画面で中身を書けます`);
  };
  return <div className="field">
    <span className="field-label">スクリプト（データで書けない処理をコードで）</span>
    <div className="form-row wrap">
      <select value={id ?? ""} onChange={e => onChange(e.target.value ? (Object.keys(args).length ? { id: e.target.value, args } : e.target.value) : undefined)}>
        <option value="">（なし）</option>{scripts.map(s => <option key={s}>{s}</option>)}
        {id && !scripts.includes(id) && <option value={id}>{id}（ファイルがない）</option>}
      </select>
      {!id && <button className="button" onClick={createFor}><Plus size={12} />新しく作って付ける</button>}
      {id && <input className="grow" placeholder='引数（JSON）例 {"power": 3}' value={argText}
        onChange={e => setArgText(e.target.value)}
        onBlur={() => {
          if (!argText.trim() || argText.trim() === "{}") { setArgError(""); onChange(id); return; }
          try { const parsed = JSON.parse(argText) as unknown; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("オブジェクトで"); setArgError(""); onChange({ id, args: parsed as Record<string, unknown> }); }
          catch (error) { setArgError(`引数のJSONが正しくありません: ${error instanceof Error ? error.message : String(error)}`); }
        }} />}
    </div>
    {argError && <span className="error-text small">{argError}</span>}
  </div>;
}

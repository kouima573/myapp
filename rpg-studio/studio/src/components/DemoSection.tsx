import { useState } from "react";
import { Scissors } from "lucide-react";
import type { Condition, ProjectManifest } from "@rpg/schema";
import type { ProjectStore } from "../lib/useProject";

type Kind = "flag" | "map";

/** 体験版: どこで終わるか（フラグが立ったら／このマップに入ったら）を決める。書き出しはブラウザ版の「体験版ZIPを作る」か `pnpm rpg build --demo`。 */
export default function DemoSection({ store }: { store: ProjectStore }) {
  const project = store.content?.project;
  const demo = project?.demo;
  const current = demo?.endWhen as { flag?: string; map?: string } | undefined;
  const [kind, setKind] = useState<Kind>(current?.map ? "map" : "flag");
  const [target, setTarget] = useState(current?.flag ?? current?.map ?? "");
  const [title, setTitle] = useState(demo?.title ?? "体験版はここまで");
  const [text, setText] = useState(demo?.text ?? "遊んでくれてありがとうございます。続きは製品版でお楽しみください。");
  if (!project) return null;
  const flags = Object.keys(project.flags), maps = project.maps;
  const save = () => {
    if (!target) { window.alert(kind === "flag" ? "フラグを選んでください" : "マップを選んでください"); return; }
    const endWhen: Condition = kind === "flag" ? { flag: target } : { map: target };
    store.updateJson<ProjectManifest>("project.json", p => { p.demo = { endWhen, title, text }; });
    store.log("ok", "体験版の終わる場所を決めました");
  };
  return <section className="card demo-section">
    <header><h3><Scissors size={15} /> 体験版</h3></header>
    <p className="muted small">完成版はそのままで、決めた所まで遊べる「体験版」を別に書き出せます（無料の体験版と有料の完全版、という売り方ができます）。書き出し: ブラウザ版は「プロジェクト」画面の「体験版ZIPを作る」、手元では <code>pnpm rpg build --demo --zip</code>。</p>
    <div className="row">
      <select value={kind} onChange={e => { setKind(e.target.value as Kind); setTarget(""); }}>
        <option value="flag">このフラグが立ったら終わる</option>
        <option value="map">このマップに入ったら終わる</option>
      </select>
      <select value={target} onChange={e => setTarget(e.target.value)}>
        <option value="">選ぶ…</option>
        {kind === "flag" ? flags.map(f => <option key={f} value={f}>{f}{project.flags[f]?.description ? `（${project.flags[f]!.description}）` : ""}</option>) : maps.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
      </select>
    </div>
    <div className="row"><label>終わりの見出し<input value={title} onChange={e => setTitle(e.target.value)} /></label></div>
    <div className="row"><label style={{ flex: 1 }}>終わりの文<input value={text} onChange={e => setText(e.target.value)} style={{ width: "100%" }} /></label></div>
    <div className="row">
      <button className="button primary" onClick={save}>決める</button>
      {demo && <button className="button" onClick={() => store.updateJson<ProjectManifest>("project.json", p => { delete p.demo; })}>体験版をやめる</button>}
      {demo && <span className="muted small">いまの設定: {current?.flag ? `フラグ ${current.flag} が立ったら` : current?.map ? `マップ ${current.map} に入ったら` : "（条件）"}終わる</span>}
    </div>
  </section>;
}

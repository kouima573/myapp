import { useEffect, useState } from "react";
import { CheckCircle2, Circle, GraduationCap, RotateCcw } from "lucide-react";
import type { GameContent } from "@rpg/schema";
import type { ProjectStore } from "../lib/useProject";

/**
 * はじめての5分 (roadmap 004): a short guided quest through the studio. Each step checks the project itself
 * (compared with how it was when the tutorial started), so it ticks off by doing — no quiz, no extra files.
 */
interface Baseline { at: number; npcs: number; dialogues: number; dialogueIds: string[]; things: number; tests: number }

const count = (content: GameContent, texts: Record<string, string>): Omit<Baseline, "at"> => {
  const npcs = Object.values(content.maps).flatMap(m => m.npcs);
  return {
    npcs: npcs.length,
    dialogues: Object.keys(content.dialogues).length,
    dialogueIds: Object.keys(content.dialogues),
    things: content.database.enemies.length + content.database.items.length,
    tests: Object.keys(texts).filter(f => f.startsWith("tests/") && f.endsWith(".json")).length,
  };
};

export default function TutorialPanel({ store, content, onGo }: { store: ProjectStore; content: GameContent; onGo: (section: string) => void }) {
  const key = `rpg-studio:tutorial:${content.project.id}`;
  const [base, setBase] = useState<Baseline | null>(() => { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } });
  const start = () => { const b = { at: Date.now(), ...count(content, store.texts) }; setBase(b); try { localStorage.setItem(key, JSON.stringify(b)); } catch { /* optional */ } };
  useEffect(() => { if (!base) start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const now = count(content, store.texts);
  const played = (() => { try { return Number(localStorage.getItem(`rpg-studio:played:${content.project.id}`) ?? 0); } catch { return 0; } })();
  const b = base ?? { at: Date.now(), ...now };
  const steps: Array<{ title: string; how: string; done: boolean; go: string; label: string }> = [
    { title: "人を置く", how: "「マップ」で人のアイコン（N）を選び、地図をクリック。", done: now.npcs > b.npcs, go: "map", label: "マップへ" },
    { title: "会話を書く", how: "「会話・イベント」の「＋会話」で台詞を2行ほど書く。", done: now.dialogues > b.dialogues, go: "story", label: "会話・イベントへ" },
    { title: "人に会話を付ける", how: "「マップ」で置いた人をクリックし、右の詳細で、書いた会話を選ぶ。", done: Object.values(content.maps).some(m => m.npcs.some(n => n.dialogues.some(d => !(b.dialogueIds ?? []).includes(d.dialogue)))), go: "map", label: "マップへ" },
    { title: "試遊で話しかける", how: "「試遊」で人の前まで歩き、Enter（決定）で話しかける。", done: played > b.at, go: "play", label: "試遊へ" },
    { title: "敵かアイテムを足す", how: "「敵・アイテム・仲間」で＋を押して名前と強さを決める。", done: now.things > b.things, go: "database", label: "敵・アイテムへ" },
    { title: "遊んだ操作をテストにする", how: "「試遊」の「録画してテストを作る」→ 少し遊んで「止めて保存」。", done: now.tests > b.tests, go: "play", label: "試遊へ" },
  ];
  const done = steps.filter(s => s.done).length;
  return <div className="panel-page tutorial-panel">
    <h2><GraduationCap size={18} /> はじめての5分</h2>
    <p className="muted">工房の基本を6つの手順で。やると自動でチェックが付きます（このプロジェクトの、始めたときからの変化で判定）。AIに任せたいときは「発想」画面の依頼文から。</p>
    <div className="tutorial-progress"><div style={{ width: `${(done / steps.length) * 100}%` }} /></div>
    <p>{done === steps.length ? "🎉 全部できました！ もう自分でゲームを作れます。" : `${done} / ${steps.length}`}</p>
    <ol className="tutorial-steps">
      {steps.map((s, i) => <li key={i} className={s.done ? "is-done" : ""}>
        {s.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
        <div><b>{s.title}</b><div className="small muted">{s.how}</div></div>
        {!s.done && <button className="button" onClick={() => onGo(s.go)}>{s.label}</button>}
      </li>)}
    </ol>
    <button className="button" onClick={start}><RotateCcw size={13} /> 最初からやり直す</button>
  </div>;
}

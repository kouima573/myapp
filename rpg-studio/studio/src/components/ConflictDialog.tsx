import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import type { Conflict } from "../lib/useProject";

/** Shown when a save was refused because the file changed on disk (SHA-256 mismatch). Both versions are kept until the user chooses. */
export default function ConflictDialog({ conflict, onResolve }: { conflict: Conflict; onResolve: (choice: "theirs" | "mine") => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal(); }, []);
  const theirs = conflict.latestContent.split("\n");
  const mine = conflict.mine.split("\n");
  const changed = new Set<number>();
  for (let i = 0; i < Math.max(theirs.length, mine.length); i++) if (theirs[i] !== mine[i]) changed.add(i);
  return <dialog ref={ref} className="conflict-dialog" onCancel={e => e.preventDefault()} aria-labelledby="conflict-title">
    <h2 id="conflict-title"><AlertTriangle size={18} /> 保存の競合: <code>{conflict.path}</code></h2>
    <p>画面で開いた後に、このファイルが外部（Codex／Claude Code、エディター等）で変更されました。上書きを防ぐため保存を止めています。どちらの内容を残すか選んでください。</p>
    <div className="conflict-columns">
      <div><h4>ディスクの内容（外部の変更）</h4><pre>{theirs.map((line, i) => <span key={i} className={changed.has(i) ? "diff-line" : undefined}>{line}{"\n"}</span>)}</pre></div>
      <div><h4>画面の内容（あなたの変更）</h4><pre>{mine.map((line, i) => <span key={i} className={changed.has(i) ? "diff-line" : undefined}>{line}{"\n"}</span>)}</pre></div>
    </div>
    <div className="dialog-actions">
      <button className="button" onClick={() => { ref.current?.close(); onResolve("theirs"); }}>ディスクの内容を読み込む（画面の変更を破棄）</button>
      <button className="button danger" onClick={() => { ref.current?.close(); onResolve("mine"); }}>画面の内容で上書き</button>
    </div>
  </dialog>;
}

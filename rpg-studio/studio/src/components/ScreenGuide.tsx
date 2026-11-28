import { useState } from "react";
import { ChevronDown, ChevronUp, HelpCircle, X } from "lucide-react";
import { closedGuides, GUIDES, saveClosedGuides } from "../lib/guides";

/** 画面の上の案内（1行。「くわしく」で、はじめての人へ・ほかのやり方を開く。×で閉じると、小さな「？」だけ残る）。 */
export default function ScreenGuide({ section, onGo }: { section: string; onGo: (section: string) => void }) {
  const guide = GUIDES[section];
  const [closed, setClosed] = useState(closedGuides);
  const [open, setOpen] = useState(false);
  if (!guide) return null;
  const toggleClosed = (value: boolean) => { const next = new Set(closed); if (value) next.add(section); else next.delete(section); setClosed(next); saveClosedGuides(next); setOpen(false); };
  if (closed.has(section)) return <div className="screen-guide is-closed"><button className="pill" title="この画面の案内を表示する" onClick={() => toggleClosed(false)}><HelpCircle size={12} /> この画面について</button></div>;
  const more = Boolean(guide.first?.length || guide.other?.length);
  return <div className="screen-guide" role="note">
    <div className="screen-guide-line">
      <HelpCircle size={14} />
      <span><b>この画面:</b> {guide.what}</span>
      {more && <button className="link-button" onClick={() => setOpen(v => !v)}>{open ? <><ChevronUp size={12} /> 閉じる</> : <><ChevronDown size={12} /> はじめての人へ・ほかのやり方</>}</button>}
      <button className="icon-button" title="この案内をしまう（「この画面について」でまた出せます）" aria-label="案内をしまう" onClick={() => toggleClosed(true)}><X size={13} /></button>
    </div>
    {open && <div className="screen-guide-more">
      {guide.first?.length ? <ul>{guide.first.map(t => <li key={t}>{t}</li>)}</ul> : null}
      {guide.other?.length ? <div className="screen-guide-other"><span className="muted small">ほかのやり方:</span>{guide.other.map(o => <button key={o.section + o.label} className="chip" onClick={() => onGo(o.section)}>{o.label}</button>)}</div> : null}
    </div>}
  </div>;
}

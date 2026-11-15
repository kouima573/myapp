import { useEffect, useState } from "react";
import { ClipboardCopy, Code2, ExternalLink, X } from "lucide-react";

/**
 * 「コードを探す」: Alt+click (or the toolbar toggle, then click) any part of the studio or the game
 * being played to see which source file and line draws it, and open it in an editor or hand it to an AI.
 * Studio elements carry data-src="studio/src/…tsx:line" (added at build time); the game runtime marks its
 * windows with data-src="packages/runtime/src/…ts#function".
 */
interface Found { src: string; label: string; chain: string[] }

const parse = (src: string) => {
  const m = /^(.*?)(?::(\d+)|#(.+))?$/.exec(src)!;
  return { file: m[1]!, line: m[2] ? Number(m[2]) : undefined, symbol: m[3] };
};

export default function CodeFinder({ active, onExit, repoRoot, projectDir }: { active: boolean; onExit: () => void; repoRoot?: string; projectDir: string }) {
  const [hover, setHover] = useState<{ rect: DOMRect; src: string } | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const pick = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>("[data-src]") : null);
    const onMove = (e: MouseEvent) => {
      if (!active && !e.altKey) { setHover(null); return; }
      const el = pick(e.target);
      setHover(el && !el.closest(".code-finder") ? { rect: el.getBoundingClientRect(), src: el.dataset.src! } : null);
    };
    const onClick = (e: MouseEvent) => {
      if (!active && !e.altKey) return;
      const el = pick(e.target);
      if (!el || el.closest(".code-finder")) return;
      e.preventDefault(); e.stopPropagation();
      // The chain of components around it (innermost first), deduplicated by file.
      const chain: string[] = [];
      for (let p: HTMLElement | null = el; p; p = p.parentElement?.closest<HTMLElement>("[data-src]") ?? null) {
        const src = p.dataset.src!;
        if (!chain.some(c => parse(c).file === parse(src).file)) chain.push(src);
      }
      let text = "";
      for (let n: HTMLElement | null = el; n && !text; n = n.parentElement) text = (n.getAttribute("aria-label") || n.getAttribute("title") || n.innerText || "").trim();
      text = (text || el.tagName.toLowerCase()).split("\n")[0]!.slice(0, 40);
      setFound({ src: el.dataset.src!, label: text, chain });
      setHover(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setFound(null); if (active) onExit(); } };
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousemove", onMove, true); window.removeEventListener("click", onClick, true); window.removeEventListener("keydown", onKey); };
  }, [active, onExit]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); window.setTimeout(() => setCopied(""), 1500); } catch { /* ignore */ }
  };
  const abs = (file: string) => (repoRoot ? `${repoRoot.replace(/\\/g, "/").replace(/\/$/, "")}/${file}` : file);
  const editorUrl = (scheme: string, src: string) => { const { file, line } = parse(src); return `${scheme}://file/${encodeURI(abs(file)).replace(/^\/?/, "")}${line ? `:${line}` : ""}`; };

  return <>
    {hover && <div className="code-finder-hover" style={{ left: hover.rect.left, top: hover.rect.top, width: hover.rect.width, height: hover.rect.height }}>
      <span>{hover.src}</span>
    </div>}
    {found && <div className="code-finder card" role="dialog" aria-label="この部分のコード">
      <header><Code2 size={14} /><h3>この部分のコード</h3><span className="spacer" /><button className="icon-button" onClick={() => setFound(null)} title="閉じる（Esc）"><X size={14} /></button></header>
      <p className="small muted">「{found.label}」</p>
      <code className="code-finder-path">{found.src}</code>
      {parse(found.src).symbol && <p className="small muted">ゲーム画面の部品です。{parse(found.src).file} の中で「{parse(found.src).symbol}」を検索してください（見た目は packages/runtime/src/styles.ts）。</p>}
      <div className="form-row wrap">
        <a className="button primary" href={editorUrl("vscode", found.src)}><ExternalLink size={12} />VS Codeで開く</a>
        <a className="button" href={editorUrl("cursor", found.src)}><ExternalLink size={12} />Cursorで開く</a>
        <button className="button" onClick={() => void copy(abs(parse(found.src).file) + (parse(found.src).line ? `:${parse(found.src).line}` : ""), "path")}><ClipboardCopy size={12} />{copied === "path" ? "コピーしました" : "パスをコピー"}</button>
        <button className="button" onClick={() => void copy(`工房の画面の「${found.label}」の部分（${found.src}）について、次のように変えて:\n\n（ここに変えたいことを書く）\n\n関係するコード: ${found.chain.join(" ← ")}\n対象プロジェクト: ${projectDir}\n変更後は pnpm check と pnpm test、pnpm build:studio を通して。`, "ai")}><ClipboardCopy size={12} />{copied === "ai" ? "コピーしました" : "AIへの依頼文をコピー"}</button>
      </div>
      {found.chain.length > 1 && <details><summary className="small">外側の部品（{found.chain.length - 1}）</summary>
        <ul className="small code-finder-chain">{found.chain.slice(1).map(src => <li key={src}><a href={editorUrl("vscode", src)}>{src}</a></li>)}</ul>
      </details>}
      <p className="small muted">Alt を押しながらクリックすると、いつでも調べられます。ゲームのデータ（マップ・敵など）はそれぞれの編集画面と「データ」で開けます。</p>
    </div>}
  </>;
}

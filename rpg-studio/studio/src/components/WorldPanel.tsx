import { useMemo } from "react";
import { Globe2 } from "lucide-react";
import type { GameContent } from "@rpg/schema";
import { unreachableMaps, worldGraph } from "../lib/world";

const W = 170, H = 64, GX = 90, GY = 70;

/** World map graph (roadmap 163): maps as boxes, portals (solid) and teleports (dashed) as arrows. Click a map to edit it. */
export default function WorldPanel({ content, onOpenMap }: { content: GameContent; onOpenMap: (id: string) => void }) {
  const { nodes, edges } = useMemo(() => worldGraph(content), [content]);
  const lonely = useMemo(() => unreachableMaps(content), [content]);
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const pos = new Map(nodes.map((n, i) => [n.id, { x: 20 + (i % cols) * (W + GX), y: 20 + Math.floor(i / cols) * (H + GY) }]));
  const width = 40 + cols * W + (cols - 1) * GX, height = 40 + Math.ceil(nodes.length / cols) * (H + GY) - GY;
  const twoWay = new Set(edges.map(e => `${e.from}>${e.to}`));
  return <div className="panel-page world-panel">
    <h2><Globe2 size={18} /> ワールド全体図</h2>
    <p className="muted">マップどうしのつながり。実線＝出入口（portals）、点線＝イベント・会話・仕掛けの「移動」効果。四角をクリックするとそのマップを開きます。</p>
    {lonely.length > 0 && <p className="badge warn">開始マップから行けないマップ: {lonely.map(id => nodes.find(n => n.id === id)?.title ?? id).join("・")}（ルールやスクリプトで移動する場合は問題ありません）</p>}
    <div className="world-scroll">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="マップのつながり">
        <defs>
          <marker id="world-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor" /></marker>
        </defs>
        {edges.map((e, i) => {
          const a = pos.get(e.from)!, b = pos.get(e.to)!;
          // Two-way links are drawn slightly apart so both arrows show.
          const off = twoWay.has(`${e.to}>${e.from}`) ? (e.from < e.to ? 6 : -6) : 0;
          const ax = a.x + W / 2, ay = a.y + H / 2, bx = b.x + W / 2, by = b.y + H / 2;
          const len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len * off, ny = (bx - ax) / len * off;
          // Stop at the box edge.
          const t = Math.min(W / 2 / Math.abs(bx - ax || 1e-6), H / 2 / Math.abs(by - ay || 1e-6), 0.5) ;
          return <line key={i} className={`world-edge is-${e.kind}`} x1={ax + (bx - ax) * t + nx} y1={ay + (by - ay) * t + ny} x2={bx - (bx - ax) * t + nx} y2={by - (by - ay) * t + ny} markerEnd="url(#world-arrow)"><title>{`${e.from} → ${e.to}（${e.kind === "portal" ? `出入口 ${e.label}` : e.label}）`}</title></line>;
        })}
        {nodes.map(n => {
          const p = pos.get(n.id)!;
          return <g key={n.id} className={`world-node ${n.start ? "is-start" : ""} ${lonely.includes(n.id) ? "is-lonely" : ""}`} transform={`translate(${p.x},${p.y})`} onClick={() => onOpenMap(n.id)} role="button" tabIndex={0} onKeyDown={ev => { if (ev.key === "Enter") onOpenMap(n.id); }}>
            <rect width={W} height={H} rx={8} />
            <text x={10} y={24} className="world-title">{n.title}{n.start ? "（開始）" : ""}</text>
            <text x={10} y={46} className="world-sub">{n.id}・{n.width}×{n.height}</text>
          </g>;
        })}
      </svg>
    </div>
  </div>;
}

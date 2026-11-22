import { useMemo } from "react";
import { GitBranch } from "lucide-react";
import type { GameContent } from "@rpg/schema";
import { flowSources, flowTree, type FlowNode } from "../lib/flow";

/** Branch diagram (roadmap 055): the tree of what a dialogue / event leads to, and what starts it. */
export default function FlowView({ content, root, onOpen }: { content: GameContent; root: { kind: "dialogue" | "event"; id: string }; onOpen: (ref: { kind: "dialogue" | "event"; id: string }) => void }) {
  const tree = useMemo(() => flowTree(content, root), [content, root]);
  const sources = useMemo(() => flowSources(content, root), [content, root]);
  return <div className="card flow-view" data-flow-root={`${root.kind}:${root.id}`}>
    <header><GitBranch size={15} /><h3>分岐図</h3></header>
    <div className="flow-sources">始まる場所: {sources.length ? sources.join("・") : <span className="muted">どこからも呼ばれていません（マップのNPC・仕掛けに付けると始まります）</span>}</div>
    <ul className="flow-tree"><Node node={tree} onOpen={onOpen} isRoot /></ul>
  </div>;
}

function Node({ node, onOpen, isRoot }: { node: FlowNode; onOpen: (ref: { kind: "dialogue" | "event"; id: string }) => void; isRoot?: boolean }) {
  const label = node.ref && !isRoot
    ? <button className="flow-link" onClick={() => onOpen(node.ref!)}>{node.label}</button>
    : <span>{node.label}</span>;
  return <li className={`flow-node flow-${node.kind}`}>
    <div className="flow-label">{label}{node.when && <span className="flow-when">もし {node.when}</span>}</div>
    {node.children.length > 0 && <ul>{node.children.map((child, i) => <Node key={i} node={child} onOpen={onOpen} />)}</ul>}
  </li>;
}

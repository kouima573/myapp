/**
 * World map graph (roadmap 163): every map and how they connect — portals, and teleports in events,
 * dialogues and map objects that start on that map. Pure data, testable without a browser.
 */
import type { GameContent } from "@rpg/schema";

export interface WorldNode { id: string; title: string; width: number; height: number; start: boolean }
export interface WorldEdge { from: string; to: string; kind: "portal" | "teleport"; label: string }

/** Collects teleport targets and referenced dialogues / events anywhere inside a JSON value. */
function scan(value: unknown, out: { teleports: string[]; dialogues: string[]; events: string[] }) {
  if (Array.isArray(value)) { for (const v of value) scan(v, out); return; }
  if (!value || typeof value !== "object") return;
  const o = value as Record<string, unknown>;
  if (o.type === "teleport" && typeof o.mapId === "string") out.teleports.push(o.mapId);
  if (o.type === "dialogue" && typeof o.dialogue === "string") out.dialogues.push(o.dialogue);
  if (o.type === "event" && typeof o.event === "string") out.events.push(o.event);
  // Map objects point at dialogues / events by field (NPC dialogue lists, interactables, entities).
  if (o.type === undefined && typeof o.dialogue === "string") out.dialogues.push(o.dialogue);
  if (o.type === undefined && typeof o.event === "string") out.events.push(o.event);
  for (const v of Object.values(o)) scan(v, out);
}

export function worldGraph(content: GameContent): { nodes: WorldNode[]; edges: WorldEdge[] } {
  const nodes = content.project.maps.map(ref => {
    const m = content.maps[ref.id];
    return { id: ref.id, title: ref.title, width: m?.width ?? 0, height: m?.height ?? 0, start: content.project.start.mapId === ref.id };
  });
  const edges: WorldEdge[] = [];
  const seen = new Set<string>();
  const add = (e: WorldEdge) => { const k = `${e.from}>${e.to}>${e.kind}`; if (e.from !== e.to && !seen.has(k)) { seen.add(k); edges.push(e); } };
  for (const ref of content.project.maps) {
    const map = content.maps[ref.id];
    if (!map) continue;
    for (const p of map.portals) if (content.maps[p.targetMapId]) add({ from: map.id, to: p.targetMapId, kind: "portal", label: p.id });
    // Teleports reachable from this map: its own objects, and the dialogues / events they start (a few levels deep).
    const found = { teleports: [] as string[], dialogues: [] as string[], events: [] as string[] };
    scan({ npcs: map.npcs, interactables: map.interactables, entities: map.entities, regions: map.regions }, found);
    const done = new Set<string>();
    for (let depth = 0; depth < 4; depth++) {
      const next = { teleports: [] as string[], dialogues: [] as string[], events: [] as string[] };
      for (const id of found.dialogues) if (!done.has(`d:${id}`)) { done.add(`d:${id}`); scan(content.dialogues[id], next); }
      for (const id of found.events) if (!done.has(`e:${id}`)) { done.add(`e:${id}`); scan(content.events[id], next); }
      found.teleports.push(...next.teleports);
      found.dialogues = next.dialogues; found.events = next.events;
      if (!next.dialogues.length && !next.events.length) break;
    }
    for (const to of found.teleports) if (content.maps[to]) add({ from: map.id, to, kind: "teleport", label: "移動の効果" });
  }
  return { nodes, edges };
}

/** Maps nobody can reach from the start map (by portals and teleports). */
export function unreachableMaps(content: GameContent): string[] {
  const { nodes, edges } = worldGraph(content);
  const reach = new Set([content.project.start.mapId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const e of edges) if (reach.has(e.from) && !reach.has(e.to)) { reach.add(e.to); changed = true; }
  }
  return nodes.filter(n => !reach.has(n.id)).map(n => n.id);
}

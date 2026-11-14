import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Ghost, SquareDashed, Brush, DoorOpen, Eraser, Flag, MousePointer2, PaintBucket, Pipette, Redo2, Sparkles, Undo2, UserRound, Grid3x3, Eye, ZoomIn, ZoomOut } from "lucide-react";
import type { GameContent, GameMap, Interactable, Npc, Portal, ProjectManifest } from "@rpg/schema";
import { drawMap, TILE, type ImageMap } from "../../../packages/runtime/src/render";
import type { ProjectStore } from "../lib/useProject";

export type Selection =
  | { kind: "cell"; x: number; y: number }
  | { kind: "npc" | "portal" | "interactable" | "entity" | "region"; id: string; x: number; y: number }
  | null;

export type Tool = "select" | "paint" | "fill" | "erase" | "pick" | "npc" | "portal" | "interactable" | "entity" | "region" | "start";

interface Props {
  store: ProjectStore;
  content: GameContent;
  mapId: string;
  images: ImageMap;
  imageRevision: number;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onPlayFrom: (x: number, y: number) => void;
}

const TOOLS: Array<{ id: Tool; label: string; key: string; icon: typeof Brush }> = [
  { id: "select", label: "選択・移動", key: "V", icon: MousePointer2 },
  { id: "paint", label: "ペン", key: "B", icon: Brush },
  { id: "fill", label: "塗りつぶし", key: "G", icon: PaintBucket },
  { id: "erase", label: "消しゴム（先頭タイル）", key: "E", icon: Eraser },
  { id: "pick", label: "スポイト", key: "I", icon: Pipette },
  { id: "npc", label: "NPCを置く", key: "N", icon: UserRound },
  { id: "portal", label: "出入口を置く", key: "P", icon: DoorOpen },
  { id: "interactable", label: "仕掛けを置く", key: "T", icon: Sparkles },
  { id: "entity", label: "エンティティを置く（状態・移動・条件で変わる人や物）", key: "O", icon: Ghost },
  { id: "region", label: "領域を置く（入る・出る・歩く・調べる）", key: "R", icon: SquareDashed },
  { id: "start", label: "開始位置", key: "S", icon: Flag },
];

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function entityAt(map: GameMap, x: number, y: number): Selection {
  const entity = map.entities.find(e => e.x === x && e.y === y);
  if (entity) return { kind: "entity", id: entity.id, x, y };
  const npc = map.npcs.find(n => n.x === x && n.y === y);
  if (npc) return { kind: "npc", id: npc.id, x, y };
  const item = map.interactables.find(i => i.x === x && i.y === y);
  if (item) return { kind: "interactable", id: item.id, x, y };
  const portal = map.portals.find(p => p.x === x && p.y === y);
  if (portal) return { kind: "portal", id: portal.id, x, y };
  return null;
}

export default function MapEditor({ store, content, mapId, images, imageRevision, selection, onSelect, onPlayFrom }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("paint");
  const [tile, setTile] = useState<string>(content.tileset.tiles[0]?.code ?? ".");
  const [hovered, setHovered] = useState<{ x: number; y: number } | null>(null);
  const [grid, setGrid] = useState(true);
  const [passability, setPassability] = useState(false);
  const [zoom, setZoom] = useState(1.5);
  const drag = useRef<{ mode: "paint" | "move"; id?: string; kind?: string } | null>(null);
  const map = content.maps[mapId]!;
  const mapPath = content.project.maps.find(m => m.id === mapId)!.path;
  const { canUndo, canRedo } = store.historyState(mapPath);
  const tileDef = content.tileset.tiles.find(t => t.code === tile);

  useEffect(() => { if (!content.tileset.tiles.some(t => t.code === tile)) setTile(content.tileset.tiles[0]?.code ?? "."); }, [content.tileset.tiles, tile]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    if (canvas.width !== map.width * TILE || canvas.height !== map.height * TILE) { canvas.width = map.width * TILE; canvas.height = map.height * TILE; }
    const start = content.project.start.mapId === mapId ? content.project.start : null;
    drawMap(ctx, {
      content, map, images, time: 0,
      view: { camera: { x: 0, y: 0 }, cols: map.width, rows: map.height },
      interactables: map.interactables,
      markers: map.entities.filter(e => !e.states[0]?.sprite && e.states[0]?.marker !== "none").map(e => ({ x: e.x, y: e.y, marker: e.states[0]!.marker })),
      actors: [
        ...map.npcs.map(n => ({ id: n.id, x: n.x, y: n.y, facing: n.facing, sprite: n.sprite, kind: "npc" as const, label: n.name })),
        ...map.entities.filter(e => e.states[0]?.sprite).map(e => ({ id: e.id, x: e.x, y: e.y, facing: e.states[0]!.facing ?? "down" as const, sprite: e.states[0]!.sprite, kind: "npc" as const, label: e.name })),
      ],
      editor: {
        grid, showEntities: true, showPassability: passability, hovered,
        selected: selection ? { x: selection.x, y: selection.y } : null,
        startPoint: start ? { x: start.x, y: start.y } : null,
      },
    });
  }, [content, map, mapId, images, grid, passability, hovered, selection]);
  useEffect(draw, [draw, imageRevision]);

  const cellFrom = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(map.width - 1, Math.floor(((event.clientX - rect.left) / rect.width) * map.width))),
      y: Math.max(0, Math.min(map.height - 1, Math.floor(((event.clientY - rect.top) / rect.height) * map.height))),
    };
  };

  const setCell = useCallback((x: number, y: number, code: string) => {
    store.updateJson<GameMap>(mapPath, draft => {
      const row = Array.from(draft.rows[y] ?? "");
      if (row[x] === code) return draft;
      row[x] = code;
      draft.rows[y] = row.join("");
    });
  }, [store, mapPath]);

  const fill = (x: number, y: number, code: string) => {
    store.updateJson<GameMap>(mapPath, draft => {
      const rows = draft.rows.map(r => Array.from(r));
      const from = rows[y]?.[x];
      if (from === undefined || from === code) return draft;
      const stack = [[x, y]];
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        if (cx! < 0 || cy! < 0 || cy! >= rows.length || cx! >= rows[cy!]!.length || rows[cy!]![cx!] !== from) continue;
        rows[cy!]![cx!] = code;
        stack.push([cx! + 1, cy!], [cx! - 1, cy!], [cx!, cy! + 1], [cx!, cy! - 1]);
      }
      draft.rows = rows.map(r => r.join(""));
    });
  };

  const addEntity = (kind: "npc" | "portal" | "interactable" | "entity" | "region", x: number, y: number) => {
    const taken = new Set([...map.npcs, ...map.portals, ...map.interactables, ...map.entities, ...map.regions].map(e => e.id));
    const firstDialogue = Object.keys(content.dialogues)[0] ?? "dialogue";
    const firstEvent = Object.keys(content.events)[0] ?? "event";
    const otherMap = content.project.maps.find(m => m.id !== mapId) ?? content.project.maps[0]!;
    let id = "";
    store.updateJson<GameMap>(mapPath, draft => {
      if (kind === "npc") {
        id = uniqueId("npc", taken);
        const npc: Npc = { id, name: "村人", x, y, facing: "down", dialogues: [{ dialogue: firstDialogue }] };
        draft.npcs.push(npc);
      } else if (kind === "portal") {
        id = uniqueId(`${mapId}-to-${otherMap.id}`, taken);
        const portal: Portal = { id, x, y, targetMapId: otherMap.id, targetX: content.project.start.x, targetY: content.project.start.y };
        draft.portals.push(portal);
      } else if (kind === "entity") {
        id = uniqueId("entity", taken);
        draft.entities.push({ id, name: "旅人", x, y, states: [{ sprite: content.assets.assets.find(a => a.kind === "character")?.id, marker: "none", solid: true, trigger: "action", effects: [{ type: "message", text: "……。" }], behavior: { type: "wander", radius: 2, every: 3 } }] } as GameMap["entities"][number]);
      } else if (kind === "region") {
        id = uniqueId("region", taken);
        draft.regions.push({ id, label: "新しい領域", x, y, w: Math.min(3, map.width - x), h: Math.min(3, map.height - y), onEnter: [{ type: "message", text: "空気が変わった。" }], onLeave: [], onStep: [], inspect: [] });
      } else {
        id = uniqueId("object", taken);
        const item: Interactable = { id, x, y, label: "調べられる物", event: firstEvent, trigger: "action", solid: false, marker: "sparkle" };
        draft.interactables.push(item);
      }
    });
    onSelect({ kind, id, x, y });
    setTool("select");
    store.log("info", `${mapId} に ${kind} '${id}' を追加しました。右の詳細で設定してください`);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = cellFrom(event);
    const code = Array.from(map.rows[y] ?? "")[x] ?? "";
    switch (tool) {
      case "paint": case "erase":
        store.beginGroup();
        drag.current = { mode: "paint" };
        setCell(x, y, tool === "erase" ? content.tileset.tiles[0]!.code : tile);
        break;
      case "fill": fill(x, y, tile); break;
      case "pick": setTile(code); setTool("paint"); break;
      case "npc": case "portal": case "interactable": case "entity": case "region": addEntity(tool, x, y); break;
      case "start":
        store.updateJson<ProjectManifest>("project.json", draft => { draft.start = { ...draft.start, mapId, x, y }; });
        store.log("info", `開始位置を ${mapId} (${x}, ${y}) に設定しました`);
        break;
      case "select": {
        const region = map.regions.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
        const entity = entityAt(map, x, y) ?? (event.altKey || event.shiftKey ? null : region ? { kind: "region" as const, id: region.id, x: region.x, y: region.y } : null);
        onSelect(entity ?? { kind: "cell", x, y });
        if (entity && entity.kind !== "cell") { store.beginGroup(); drag.current = { mode: "move", id: entity.id, kind: entity.kind }; }
        break;
      }
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const cell = cellFrom(event);
    if (!hovered || hovered.x !== cell.x || hovered.y !== cell.y) setHovered(cell);
    const current = drag.current;
    if (!current || event.buttons !== 1) return;
    if (current.mode === "paint") setCell(cell.x, cell.y, tool === "erase" ? content.tileset.tiles[0]!.code : tile);
    else if (current.mode === "move" && current.id && current.kind) {
      if (selection && selection.x === cell.x && selection.y === cell.y) return;
      const key = current.kind === "npc" ? "npcs" : current.kind === "portal" ? "portals" : current.kind === "entity" ? "entities" : current.kind === "region" ? "regions" : "interactables";
      store.updateJson<GameMap>(mapPath, draft => {
        const list = draft[key] as Array<{ id: string; x: number; y: number }>;
        const target = list.find(e => e.id === current.id);
        if (target) { target.x = cell.x; target.y = cell.y; }
      });
      onSelect({ kind: current.kind as "npc", id: current.id, x: cell.x, y: cell.y });
    }
  };

  const onPointerUp = () => {
    if (drag.current) store.endGroup();
    drag.current = null;
  };

  // Keyboard shortcuts (never while typing in a field).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (store.conflicts.length) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) store.redo(mapPath); else store.undo(mapPath); return; }
      if (mod && event.key.toLowerCase() === "y") { event.preventDefault(); store.redo(mapPath); return; }
      if (mod || event.altKey) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selection && selection.kind !== "cell") {
        event.preventDefault();
        const key = selection.kind === "npc" ? "npcs" : selection.kind === "portal" ? "portals" : selection.kind === "entity" ? "entities" : selection.kind === "region" ? "regions" : "interactables";
        store.updateJson<GameMap>(mapPath, draft => { (draft[key] as Array<{ id: string }>) = (draft[key] as Array<{ id: string }>).filter(e => e.id !== selection.id) as never; });
        store.log("info", `${selection.id} を削除しました（Ctrl+Zで元に戻せます）`);
        onSelect(null);
        return;
      }
      const toolHit = TOOLS.find(t => t.key.toLowerCase() === event.key.toLowerCase());
      if (toolHit) setTool(toolHit.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, mapPath, selection, onSelect]);

  const swatchStyle = (index: number, color: string, sheetId = content.tileset.atlas) => {
    const atlasAsset = content.assets.assets.find(a => a.id === sheetId);
    const atlasUrl = images[sheetId]?.src;
    if (!atlasUrl || !atlasAsset?.columns) return { background: color };
    const columns = atlasAsset.columns, rows = atlasAsset.rows ?? 1;
    return {
      backgroundImage: `url(${atlasUrl})`,
      backgroundSize: `${columns * 28}px ${rows * 28}px`,
      backgroundPosition: `-${(index % columns) * 28}px -${Math.floor(index / columns) * 28}px`,
      imageRendering: "pixelated" as const,
    };
  };

  const hoveredInfo = useMemo(() => {
    if (!hovered) return "";
    const code = Array.from(map.rows[hovered.y] ?? "")[hovered.x] ?? "";
    const def = content.tileset.tiles.find(t => t.code === code);
    const entity = entityAt(map, hovered.x, hovered.y);
    return `(${hovered.x}, ${hovered.y})  ${def ? `${def.name} '${code}' ${def.passable ? "通行可" : def.passableWhen ? "条件付き通行" : "通行不可"}` : `不明 '${code}'`}${entity ? `  ·  ${entity.kind} ${"id" in entity ? entity.id : ""}` : ""}`;
  }, [hovered, map, content.tileset.tiles]);

  return <div className="map-editor">
    <div className="editor-toolbar" role="toolbar" aria-label="マップ編集ツール">
      <div className="tool-group">
        {TOOLS.map(t => <button key={t.id} className={`tool ${tool === t.id ? "is-active" : ""}`} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`} aria-pressed={tool === t.id}><t.icon size={15} /></button>)}
      </div>
      <div className="tool-group">
        <button className="tool" onClick={() => store.undo(mapPath)} disabled={!canUndo} title="元に戻す (Ctrl/⌘+Z)"><Undo2 size={15} /></button>
        <button className="tool" onClick={() => store.redo(mapPath)} disabled={!canRedo} title="やり直す (Ctrl/⌘+Shift+Z, Ctrl+Y)"><Redo2 size={15} /></button>
      </div>
      <div className="tool-group">
        <button className={`tool ${grid ? "is-active" : ""}`} onClick={() => setGrid(g => !g)} title="グリッド" aria-pressed={grid}><Grid3x3 size={15} /></button>
        <button className={`tool ${passability ? "is-active" : ""}`} onClick={() => setPassability(p => !p)} title="通行不可を赤、条件付きを黄で表示" aria-pressed={passability}><Eye size={15} /></button>
        <button className="tool" onClick={() => setZoom(z => Math.max(0.75, z - 0.25))} title="縮小"><ZoomOut size={15} /></button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="tool" onClick={() => setZoom(z => Math.min(3, z + 0.25))} title="拡大"><ZoomIn size={15} /></button>
      </div>
      <div className="toolbar-status">{hoveredInfo || `${map.title} · ${map.width}×${map.height}`}</div>
    </div>

    <div className="editor-body">
      <div className="tile-palette" aria-label="タイル">
        {content.tileset.tiles.map(t => <button key={t.code} className={`tile-swatch ${tile === t.code ? "is-active" : ""}`} onClick={() => { setTile(t.code); if (tool !== "fill") setTool("paint"); }} title={`${t.name} '${t.code}' — ${t.passable ? "通行可" : t.passableWhen ? "条件付きで通行可" : "通行不可"}`}>
          <span className="swatch-img" style={swatchStyle(t.index, t.color, t.atlas)} />
          <span className="swatch-code">{t.code}</span>
          {!t.passable && <span className={`swatch-flag ${t.passableWhen ? "cond" : ""}`} />}
        </button>)}
      </div>
      <div className="canvas-scroll">
        <canvas
          ref={canvasRef}
          className={`map-canvas tool-${tool}`}
          style={{ width: map.width * TILE * zoom, height: map.height * TILE * zoom }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setHovered(null)}
          onDoubleClick={event => { const { x, y } = cellFrom(event as unknown as ReactPointerEvent<HTMLCanvasElement>); onPlayFrom(x, y); }}
          aria-label={`${map.title}のマップ。ダブルクリックでその位置から試遊`}
        />
      </div>
    </div>
    <div className="editor-footer">
      <span>選択中タイル: <b>{tileDef?.name ?? tile}</b> <code>{tile}</code></span>
      <span>ドラッグ1回 = 1操作（最大100回Undo）</span>
      <span>ダブルクリック: その位置から試遊</span>
      <span>Delete: 選択した配置物を削除</span>
    </div>
  </div>;
}

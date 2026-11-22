import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../packages/cli/src/build";
import { loadProjectFromDisk } from "../../../packages/cli/src/load";
import { createEngine } from "../../../packages/engine/src/index";
import { unreachableMaps, worldGraph } from "./world";

describe("world map graph (163) and debug play hooks (164)", () => {
  it("links maps by portals, and every sample map is reachable from the start", async () => {
    for (const id of ["sample-rpg", "genre-gallery"]) {
      const content = (await loadProjectFromDisk(path.join(REPO_ROOT, "projects", id))).content!;
      const { nodes, edges } = worldGraph(content);
      expect(nodes.length).toBe(content.project.maps.length);
      expect(edges.some(e => e.kind === "portal")).toBe(true);
      expect(unreachableMaps(content)).toEqual([]);
      // A map with no way in is reported.
      const lonely = { ...content, project: { ...content.project, maps: [...content.project.maps, { id: "island", path: "maps/island.json", title: "孤島" }] }, maps: { ...content.maps, island: { ...content.maps[content.project.start.mapId]!, id: "island", portals: [] } } };
      expect(unreachableMaps(lonely)).toEqual(["island"]);
    }
  });

  it("canEncounter: false stops random encounters; canPass: true walks through walls", async () => {
    const content = (await loadProjectFromDisk(path.join(REPO_ROOT, "projects/sample-rpg"))).content!;
    const mapId = Object.keys(content.maps).find(id => (content.maps[id]!.encounters?.rate ?? 0) > 0)!;
    const always = { ...content, maps: { ...content.maps, [mapId]: { ...content.maps[mapId]!, encounters: { ...content.maps[mapId]!.encounters!, rate: 1, tiles: [] } } } };
    const walk = (engine: ReturnType<typeof createEngine>) => {
      let state = engine.newGame(1);
      const map = always.maps[mapId]!;
      // Stand on any open tile of the map with an open neighbour, then step.
      for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < map.width - 2; x++) {
        const probe = { ...state, mapId, scene: { kind: "field" as const }, queue: [], player: { ...state.player, x, y } };
        if (engine.isPassable(probe, x, y) && engine.isPassable(probe, x + 1, y)) { state = probe; return engine.step(state, { type: "move", direction: "right" }).state; }
      }
      throw new Error("no open tile");
    };
    expect(walk(createEngine(always, [])).scene.kind).toBe("battle");
    expect(walk(createEngine(always, [{ id: "debug", canEncounter: () => false }])).scene.kind).toBe("field");
    const ghost = createEngine(content, [{ id: "debug", canPass: () => true }]);
    const s = ghost.newGame(1);
    const map = content.maps[s.mapId]!;
    const wall = (() => { for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (!createEngine(content, []).isPassable(s, x, y)) return { x, y }; return null; })()!;
    expect(ghost.isPassable(s, wall.x, wall.y)).toBe(true);
  });
});

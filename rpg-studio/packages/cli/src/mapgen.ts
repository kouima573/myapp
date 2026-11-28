/**
 * `rpg map generate <id> --project <dir> [--width 30] [--height 22] [--seed 1] [--rooms 6] [--floor <記号>] [--wall <記号>]
 *  [--title 名前] [--enemies a,b] [--rate 0.08] [--back <map>:<x>:<y>]` — a roguelike dungeon map (roadmap 038):
 * rooms and corridors from a seed, written to maps/<id>.json and added to project.json. --back puts a way out
 * (portal) in the first room; random encounters with --enemies.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { generateDungeon } from "../../engine/src/dungeon";

type Flags = Record<string, string | boolean>;

export async function cmdMap(sub: string | undefined, args: string[], flags: Flags, root: string): Promise<number> {
  const id = args[0];
  if (sub === "export") { const { cmdMapExport } = await import("./mapExport"); return cmdMapExport(id, flags, root); }
  if (sub !== "generate" || !id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) { console.log("ERROR rpg map generate <マップID> --project <dir> [--width 30 --height 22 --seed 1 --rooms 6 --floor . --wall # --title 名前 --enemies a,b --back map:x:y]"); return 2; }
  const project = JSON.parse(await fs.readFile(path.join(root, "project.json"), "utf8"));
  if (project.maps.some((m: { id: string }) => m.id === id)) { console.log(`ERROR マップ '${id}' はもうあります`); return 1; }
  const tiles = (JSON.parse(await fs.readFile(path.join(root, project.tilesetPath), "utf8")) as { tiles: Array<{ code: string; name: string; passable: boolean }> }).tiles;
  const pick = (want: string | boolean | undefined, passable: boolean, words: RegExp) => {
    if (typeof want === "string") return tiles.find(t => t.code === want)?.code;
    return (tiles.find(t => t.passable === passable && words.test(t.name)) ?? tiles.find(t => t.passable === passable))?.code;
  };
  const floor = pick(flags.floor, true, /床|石畳|洞窟|ダンジョン/), wall = pick(flags.wall, false, /壁|岩/);
  if (!floor || !wall) { console.log("ERROR 床（通れる）と壁（通れない）のタイルが見つかりません。--floor / --wall で記号を指定してください"); return 1; }
  const width = Number(flags.width) || 30, height = Number(flags.height) || 22, seed = Number(flags.seed) || Date.now() % 100000;
  const d = generateDungeon({ width, height, seed, floor, wall, ...(flags.rooms ? { rooms: Number(flags.rooms) } : {}) });
  const title = typeof flags.title === "string" ? flags.title : `ダンジョン（${seed}）`;
  const portals: unknown[] = [];
  if (typeof flags.back === "string") {
    const [mapId, x, y] = flags.back.split(":");
    portals.push({ id: `${id}-exit`, x: d.start.x, y: d.start.y + 1 < d.rooms[0]!.y + d.rooms[0]!.h ? d.start.y + 1 : d.start.y, targetMapId: mapId, targetX: Number(x), targetY: Number(y) });
  }
  const enemies = typeof flags.enemies === "string" ? flags.enemies.split(",").map(s => s.trim()).filter(Boolean) : [];
  const map = {
    formatVersion: 2, id, title, width, height, rows: d.rows, npcs: [], portals,
    interactables: [],
    entities: [],
    ...(enemies.length ? { encounters: { rate: Number(flags.rate) || 0.08, enemies, tiles: [] } } : {}),
  };
  const file = `maps/${id}.json`;
  await fs.writeFile(path.join(root, file), `${JSON.stringify(map, null, 2)}\n`);
  project.maps.push({ id, path: file, title });
  await fs.writeFile(path.join(root, "project.json"), `${JSON.stringify(project, null, 2)}\n`);
  console.log(`OK map generate: ${file}（${width}×${height}・部屋${d.rooms.length}・シード${seed}・床'${floor}' 壁'${wall}'）`);
  console.log(`   入口 (${d.start.x}, ${d.start.y})・いちばん奥 (${d.goal.x}, ${d.goal.y})。ほかのマップから出入口（portals）でつないでください。同じシードなら同じ形になります`);
  return 0;
}

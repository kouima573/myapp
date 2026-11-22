/**
 * Entry for the static game build. The CLI generates a tiny module that imports this file plus the
 * project's systems and calls `bootStandalone`. Data JSON is fetched from `./data/` so a built game
 * can still be inspected and patched without rebuilding.
 *
 * Build-time validation (`rpg build`) has already checked schemas and cross-references and writes the
 * data with every schema default filled in, so this runtime loader avoids importing Zod (~444 KB).
 */
import type {
  AssetManifest, Database, Dialogue, GameContent, GameEvent, GameMap, ProjectManifest, Rule, Song, Tileset,
} from "../../schema/src/formats";
import type { GameSystem } from "../../engine/src/index";
import { mountGame } from "./player";

function referencedJsonFiles(manifest: ProjectManifest): string[] {
  return [
    manifest.tilesetPath,
    manifest.dialoguesPath,
    manifest.eventsPath,
    manifest.databasePath,
    manifest.assetsPath,
    ...(manifest.rulesPath ? [manifest.rulesPath] : []),
    ...manifest.maps.map(map => map.path),
  ];
}

function normalizeMap(raw: Partial<GameMap>): GameMap {
  return {
    ...raw,
    rows: raw.rows ?? [],
    npcs: raw.npcs ?? [],
    interactables: raw.interactables ?? [],
    entities: raw.entities ?? [],
    regions: raw.regions ?? [],
    overlays: raw.overlays ?? [],
  } as GameMap;
}

/**
 * Builds GameContent from the JSON a `rpg build` wrote (already validated, defaults filled). No Zod.
 * Exported so tests can check that a built game behaves exactly like the validated project.
 */
export async function loadBuiltContent(fetchJson: <T>(path: string) => Promise<T>, systems: readonly GameSystem[]): Promise<GameContent> {
  const rawManifest = await fetchJson<ProjectManifest>("project.json");
  const project: ProjectManifest = {
    ...rawManifest,
    flags: rawManifest.flags ?? {},
    variables: rawManifest.variables ?? {},
    sets: rawManifest.sets ?? {},
    verbs: rawManifest.verbs ?? {},
    signals: rawManifest.signals ?? {},
    endings: rawManifest.endings ?? {},
    modules: rawManifest.modules ?? {},
    systems: rawManifest.systems ?? [],
  };
  const jsonMap = new Map<string, unknown>();
  await Promise.all(referencedJsonFiles(project).map(async path => { jsonMap.set(path, await fetchJson(path)); }));

  const rawTileset = jsonMap.get(project.tilesetPath) as Partial<Tileset>;
  const tileset: Tileset = { ...rawTileset, tiles: rawTileset.tiles ?? [] } as Tileset;
  const dialogueBundle = jsonMap.get(project.dialoguesPath) as { dialogues?: Dialogue[] };
  const eventBundle = jsonMap.get(project.eventsPath) as { events?: GameEvent[] };
  const rawDb = jsonMap.get(project.databasePath) as Partial<Database>;
  const database: Database = {
    ...rawDb,
    abilities: rawDb.abilities ?? [],
    items: rawDb.items ?? [],
    companions: rawDb.companions ?? [],
    enemies: rawDb.enemies ?? [],
    traits: rawDb.traits ?? [],
  } as Database;
  const rawAssets = jsonMap.get(project.assetsPath) as Partial<AssetManifest>;
  const assets: AssetManifest = { ...rawAssets, assets: rawAssets.assets ?? [] } as AssetManifest;
  const ruleBundle = project.rulesPath ? (jsonMap.get(project.rulesPath) as { rules?: Rule[] }) : undefined;
  const maps: Record<string, GameMap> = {};
  for (const ref of project.maps) {
    maps[ref.id] = normalizeMap(jsonMap.get(ref.path) as Partial<GameMap>);
  }
  const songs: Record<string, Song> = {};
  await Promise.all(assets.assets.filter(a => a.kind === "song").map(async asset => {
    songs[asset.id] = await fetchJson<Song>(asset.path);
  }));

  const content: GameContent = {
    project,
    tileset,
    maps,
    dialogues: Object.fromEntries((dialogueBundle.dialogues ?? []).map(d => [d.id, d])),
    events: Object.fromEntries((eventBundle.events ?? []).map(e => [e.id, e])),
    database,
    assets,
    rules: ruleBundle?.rules ?? [],
    songs,
    scripts: systems.filter(s => s.scope === "attached").map(s => s.id),
  };
  return content;
}

export async function bootStandalone(options: { systems: GameSystem[]; host?: HTMLElement; dataBase?: string }): Promise<void> {
  const host = options.host ?? document.getElementById("game")!;
  const base = options.dataBase ?? "./data/";
  const status = document.getElementById("boot-status");
  try {
    const fetchJson = async <T>(path: string): Promise<T> => {
      const response = await fetch(new URL(path, new URL(base, location.href)));
      if (!response.ok) throw new Error(`${path} を取得できません (HTTP ${response.status})`);
      return JSON.parse(await response.text()) as T;
    };
    const content = await loadBuiltContent(fetchJson, options.systems);

    document.title = content.project.title;
    status?.remove();
    const handle = mountGame(host, {
      content,
      systems: options.systems,
      resolveAsset: asset => new URL(asset.path, new URL(base, location.href)).href,
      keyboard: "window",
      titleScreen: true,
    });
    handle.focus();
    // `?debug` exposes the handle for automated play-tests and quick inspection in DevTools.
    if (new URLSearchParams(location.search).has("debug")) (window as unknown as { rpg: unknown }).rpg = handle;
  } catch (error) {
    if (status) {
      status.textContent = `ゲームを起動できません:\n${error instanceof Error ? error.message : String(error)}`;
      status.classList.add("is-error");
    }
    throw error;
  }
}

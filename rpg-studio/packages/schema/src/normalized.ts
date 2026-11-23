import type { GameContent } from "./formats";

/**
 * The runtime JSON files of a built game, from parsed content (schema defaults applied), at the paths project.json names.
 * The built game loads data without Zod, so it must get the validated content with every default filled in.
 * Used by `rpg build` and by the browser studio's "遊べる形で書き出す".
 */
export function normalizedDataFiles(content: GameContent): Record<string, unknown> {
  const { project } = content;
  const v = project.formatVersion;
  const files: Record<string, unknown> = {
    "project.json": project,
    [project.tilesetPath]: content.tileset,
    [project.dialoguesPath]: { formatVersion: v, dialogues: Object.values(content.dialogues) },
    [project.eventsPath]: { formatVersion: v, events: Object.values(content.events) },
    [project.databasePath]: content.database,
    [project.assetsPath]: content.assets,
    ...(project.rulesPath ? { [project.rulesPath]: { formatVersion: v, rules: content.rules } } : {}),
  };
  for (const ref of project.maps) files[ref.path] = content.maps[ref.id];
  for (const asset of content.assets.assets) if (asset.kind === "song" && content.songs[asset.id]) files[asset.path] = content.songs[asset.id];
  return files;
}

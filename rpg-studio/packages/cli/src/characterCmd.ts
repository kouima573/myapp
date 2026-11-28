/**
 * `rpg art character --project <dir> --id <id> --name <名前> [--from <見本ID>] [--random <シード>] [--spec '<JSON>' | --spec-file spec.json] [--replace]`
 * 部品（体型・髪・服・帽子・持ち物・耳…）を選んで、歩くキャラクター（4方向×4コマ）を作り、内蔵ジェネレーター製として登録する。
 * 自作扱いなので、ゲームに使うのも素材パックとして配る・売るのも自由（MIT の内蔵ジェネレーター）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { CHARACTERS, randomCharacter, renderCharacterSheet, type CharacterSpec } from "./artgen/characters";
import { encodePng } from "./artgen/png";
import { ARTGEN_VERSION } from "./artgen/library";
import { addAsset } from "./assets";

type Flags = Record<string, string | boolean>;
const str = (flags: Flags, key: string) => (typeof flags[key] === "string" ? (flags[key] as string) : undefined);

export function characterSpec(flags: { id: string; name: string; from?: string; random?: string; spec?: Partial<CharacterSpec> }): CharacterSpec {
  const base = flags.from ? CHARACTERS.find(c => c.id === flags.from) : undefined;
  if (flags.from && !base) throw new Error(`見本のキャラクター '${flags.from}' はありません（${CHARACTERS.map(c => c.id).join(", ")}）`);
  const start: CharacterSpec = base ? structuredClone(base) : randomCharacter(flags.random ?? flags.id, flags.id, flags.name);
  return { ...start, ...flags.spec, id: flags.id, name: flags.name, tags: [...new Set([...(start.tags ?? []), "custom"])] } as CharacterSpec;
}

export async function cmdArtCharacter(root: string, flags: Flags): Promise<number> {
  const id = str(flags, "id"), name = str(flags, "name");
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id) || !name) { console.log("ERROR --id <英小文字・数字・ハイフン> と --name <名前> が必要です"); return 2; }
  let spec: Partial<CharacterSpec> | undefined;
  try {
    if (str(flags, "spec-file")) spec = JSON.parse(await fs.readFile(path.resolve(str(flags, "spec-file")!), "utf8")) as Partial<CharacterSpec>;
    else if (str(flags, "spec")) spec = JSON.parse(str(flags, "spec")!) as Partial<CharacterSpec>;
  } catch (error) { console.log(`ERROR --spec を JSON として読めません: ${error instanceof Error ? error.message : String(error)}`); return 2; }
  let full: CharacterSpec;
  try { full = characterSpec({ id, name, from: str(flags, "from"), random: str(flags, "random"), spec }); } catch (error) { console.log(`ERROR ${error instanceof Error ? error.message : String(error)}`); return 1; }
  const assetId = `chr-${id}`;
  const file = path.join(root, ".rpg-studio", `${assetId}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, encodePng(renderCharacterSheet(full)));
  const code = await addAsset(root, {
    file, id: assetId, kind: "character", tile: "64x64", columns: "4", rows: "4", "frame-ms": "160",
    origin: "generated", source: "builtin-art", license: "MIT（RPGシステム工房の内蔵ジェネレーター。オリジナル生成物）",
    notes: `キャラクター作りで作成（${name}）。`, ...(flags.replace ? { replace: true } : {}),
  }, { generator: { tool: "rpg art character", version: ARTGEN_VERSION, spec: JSON.stringify(full) }, frameOrder: [0, 1, 2, 3], loop: true });
  await fs.rm(file, { force: true });
  if (code === 0) console.log(`OK art character: ${assetId}（${name}）を登録しました。人物の sprite に "${assetId}" を指定して使えます`);
  return code;
}

/* ------------------------------------------------------------------ 敵作り・タイル作り */

/**
 * `rpg art monster --project <dir> --id <id> --name <名前> [--from <見本ID> | --family slime | --random <シード>] [--body #色 --accent #色 --dark #色 --eye #色] [--extra crown|none] [--replace]`
 */
export async function cmdArtMonster(root: string, flags: Flags): Promise<number> {
  const { monsterSpec, randomMonster, renderMonsterSheet } = await import("./artgen/makers");
  const id = str(flags, "id"), name = str(flags, "name");
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id) || !name) { console.log("ERROR --id <英小文字・数字・ハイフン> と --name <名前> が必要です"); return 2; }
  let spec;
  try {
    const pal = Object.fromEntries((["body", "accent", "dark", "eye"] as const).flatMap(k => (str(flags, k) ? [[k, str(flags, k)!]] : [])));
    spec = str(flags, "random") && !str(flags, "from") && !str(flags, "family") ? { ...randomMonster(str(flags, "random")!, id, name) }
      : monsterSpec({ id, name, from: str(flags, "from"), family: str(flags, "family"), pal, extra: str(flags, "extra") === "none" ? null : str(flags, "extra") });
  } catch (error) { console.log(`ERROR ${error instanceof Error ? error.message : String(error)}`); return 1; }
  const assetId = `mon-${id}`;
  const file = path.join(root, ".rpg-studio", `${assetId}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, encodePng(renderMonsterSheet(spec)));
  const code = await addAsset(root, {
    file, id: assetId, kind: "enemy", tile: "64x64", columns: "4", rows: "1", "frame-ms": "220",
    origin: "generated", source: "builtin-art", license: "MIT（RPGシステム工房の内蔵ジェネレーター。オリジナル生成物）",
    notes: `敵作りで作成（${name}）。`, ...(flags.replace ? { replace: true } : {}),
  }, { generator: { tool: "rpg art monster", version: ARTGEN_VERSION, spec: JSON.stringify(spec) }, loop: true });
  await fs.rm(file, { force: true });
  if (code === 0) console.log(`OK art monster: ${assetId}（${name}）を登録しました。敵の sprite に "${assetId}" を指定して使えます`);
  return code;
}

/** "lib-tiles-field/water:hue=40:light=-10:seed=3:name=夜の湖" → CustomTile */
export function parseTileList(text: string) {
  return text.split(",").map(s => s.trim()).filter(Boolean).map(part => {
    const [from, ...opts] = part.split(":");
    const t: { from: string; name?: string; seed?: number; hue?: number; light?: number; passable?: boolean } = { from: from! };
    for (const o of opts) {
      const [k, v = ""] = o.split("=");
      if (k === "name") t.name = v; else if (k === "seed" || k === "hue" || k === "light") t[k] = Number(v); else if (k === "passable") t.passable = v !== "false";
    }
    return t;
  });
}

/**
 * `rpg art tiles --project <dir> --id <セットID> --name <名前> --tiles "lib-tiles-field/grass,lib-tiles-field/water:hue=40" [--style retro|pastel|dusk|mono] [--replace]`
 * 内蔵のタイルから選び、模様（seed）・色（hue）・明るさ（light）・画風を変えて、自分のタイル集を作る。tiles.json にも追加する。
 */
export async function cmdArtTiles(root: string, flags: Flags): Promise<number> {
  const { customTileSheet, TILE_CATALOG } = await import("./artgen/makers");
  const { isArtStyle } = await import("./artgen/style");
  const { mergeTiles } = await import("./tileMerge");
  const id = str(flags, "id"), name = str(flags, "name"), list = str(flags, "tiles");
  if (flags.list) { for (const t of TILE_CATALOG.filter(x => !x.companion)) console.log(`${t.ref}\t${t.name}${t.passable ? "" : "（通れない）"}${t.animated ? "・動く" : ""}${t.autotile ? "・つながる" : ""}`); return 0; }
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id) || !name || !list) { console.log("ERROR --id --name --tiles が必要です（使えるタイルは --list で一覧）"); return 2; }
  const style = str(flags, "style") ?? "standard";
  if (!isArtStyle(style)) { console.log("ERROR --style は standard / retro / pastel / dusk / mono"); return 2; }
  let sheet;
  const chosen = parseTileList(list);
  try { sheet = customTileSheet(chosen, style, id); } catch (error) { console.log(`ERROR ${error instanceof Error ? error.message : String(error)}`); return 1; }
  const assetId = `tiles-${id}`;
  const file = path.join(root, ".rpg-studio", `${assetId}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, encodePng(sheet.img));
  const code = await addAsset(root, {
    file, id: assetId, kind: "tileset", tile: "64x64", columns: "8", rows: String(sheet.img.h / 64),
    origin: "generated", source: "builtin-art", license: "MIT（RPGシステム工房の内蔵ジェネレーター。オリジナル生成物）",
    notes: `タイル作りで作成（${name}）。`, ...(flags.replace ? { replace: true } : {}),
  }, { generator: { tool: "rpg art tiles", version: ARTGEN_VERSION, spec: JSON.stringify({ name, style, tiles: chosen }) } });
  await fs.rm(file, { force: true });
  if (code !== 0) return code;
  const project = JSON.parse(await fs.readFile(path.join(root, "project.json"), "utf8")) as { tilesetPath: string };
  const tilesFile = path.join(root, project.tilesetPath);
  const merged = mergeTiles(JSON.parse(await fs.readFile(tilesFile, "utf8")), assetId, sheet.tiles);
  await fs.writeFile(tilesFile, `${JSON.stringify(merged.tileset, null, 2)}\n`);
  console.log(`OK art tiles: ${assetId}（${name}・${sheet.tiles.length}枚）を登録し、tiles.json に追加しました: ${merged.added.join(" ")}`);
  return 0;
}

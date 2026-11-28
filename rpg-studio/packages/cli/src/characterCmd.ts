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

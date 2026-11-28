/**
 * `rpg song compose --project <dir> --mood battle [--seed 3] [--bars 16] [--tempo 150] [--id song-battle] [--map village | --battle | --victory]`
 * おまかせ作曲（packages/schema/src/songCompose.ts）で楽譜BGMを作って登録し、流す場所も決められる。`--list` で場面の一覧。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { composeSong, SONG_MOOD_LABELS, SONG_MOODS, type SongMood } from "../../schema/src/index";
import { addAsset } from "./assets";
import { loadProjectFromDisk } from "./load";

type Flags = Record<string, string | boolean>;
const str = (flags: Flags, key: string) => (typeof flags[key] === "string" ? (flags[key] as string) : undefined);

export async function cmdSongCompose(root: string, flags: Flags): Promise<number> {
  if (flags.list) { for (const m of SONG_MOODS) console.log(`${m.padEnd(10)} ${SONG_MOOD_LABELS[m]}`); return 0; }
  const mood = str(flags, "mood") as SongMood | undefined;
  if (!mood || !SONG_MOODS.includes(mood)) { console.log(`ERROR --mood は ${SONG_MOODS.join(" / ")}（--list で説明）`); return 2; }
  const seed = Number(str(flags, "seed") ?? 1), bars = Number(str(flags, "bars") ?? 8);
  if (!Number.isInteger(seed) || seed < 1) { console.log("ERROR --seed は 1 以上の整数です"); return 2; }
  if (bars !== 8 && bars !== 16) { console.log("ERROR --bars は 8 か 16 です"); return 2; }
  const tempo = str(flags, "tempo") ? Number(str(flags, "tempo")) : undefined;
  const id = str(flags, "id") ?? `song-${mood}-${seed}`;
  const song = composeSong({ mood, seed, bars: bars as 8 | 16, ...(tempo ? { tempo } : {}), ...(str(flags, "title") ? { title: str(flags, "title") } : {}) });
  const file = path.join(root, ".rpg-studio", `${id}.song.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(song, null, 2)}\n`);
  const code = await addAsset(root, { file, id, kind: "song", origin: "generated", source: "builtin-song", license: "MIT（RPGシステム工房の内蔵ジェネレーター。オリジナル生成物）", notes: `おまかせ作曲（${SONG_MOOD_LABELS[mood]}・${seed}番）`, ...(flags.replace ? { replace: true } : {}) },
    { generator: { tool: "rpg song compose", mood, seed, bars, tempo: song.tempo } });
  await fs.rm(file, { force: true });
  if (code !== 0) return code;
  // Where it plays.
  const place = str(flags, "map") ? `map:${str(flags, "map")}` : flags.battle ? "battle" : flags.victory ? "victory" : undefined;
  if (place) {
    const loaded = await loadProjectFromDisk(root);
    const project = loaded.content?.project;
    if (!project) { console.log("WARN プロジェクトを読み込めないため、流す場所は設定していません"); return 0; }
    if (place.startsWith("map:")) {
      const ref = project.maps.find(m => m.id === place.slice(4));
      if (!ref) { console.log(`WARN マップ '${place.slice(4)}' がないため、流す場所は設定していません`); return 0; }
      const mapFile = path.join(root, ref.path);
      const map = JSON.parse(await fs.readFile(mapFile, "utf8")) as Record<string, unknown>;
      map.bgm = id;
      await fs.writeFile(mapFile, `${JSON.stringify(map, null, 2)}\n`);
    } else {
      const projectFile = path.join(root, "project.json");
      const raw = JSON.parse(await fs.readFile(projectFile, "utf8")) as Record<string, unknown>;
      raw.audio = { ...((raw.audio as Record<string, unknown> | undefined) ?? {}), [place]: id };
      await fs.writeFile(projectFile, `${JSON.stringify(raw, null, 2)}\n`);
    }
  }
  console.log(`OK song compose: ${id}（${SONG_MOOD_LABELS[mood]}・${seed}番・テンポ${song.tempo}・${bars}小節）${place ? `を ${place} に設定しました` : "を登録しました。マップの bgm などに指定すると流れます"}`);
  return 0;
}

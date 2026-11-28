import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapToTiled, planAssetPack, resolveMapLayers, type Song } from "../../schema/src/index";
import { renderSong, songToWav } from "../../runtime/src/songRender";
import { CHARACTERS, randomCharacter, renderCharacterSheet } from "./artgen/characters";
import { characterSpec } from "./characterCmd";
import { loadProjectFromDisk } from "./load";
import { renderMapPng } from "./mapExport";

const gallery = path.resolve(__dirname, "../../../projects/genre-gallery");
const sample = path.resolve(__dirname, "../../../projects/sample-rpg");

describe("素材だけの作品（幅と深さ）", () => {
  it("楽譜BGMを音声にする: 曲の長さどおり・音が鳴っていて・ループ曲は継ぎ目なし・WAV形式", async () => {
    const song = JSON.parse(await fs.readFile(path.join(sample, "assets/audio/songs/song-village.song.json"), "utf8")) as Song;
    const r = renderSong(song, { sampleRate: 22050 });
    expect(r.seconds).toBeGreaterThan(5);
    const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak(r.samples.slice(0, 22050 * 4))).toBeGreaterThan(0.05);
    expect(peak(r.samples)).toBeLessThanOrEqual(0.951);
    const wav = songToWav(song, { sampleRate: 22050 });
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE");
    expect(songToWav(song, { sampleRate: 22050 })).toEqual(wav); // 同じ楽譜なら同じ音
  });

  it("マップを Tiled 形式と1枚絵にする（オートタイル・複数のタイル画像・人物の位置）", async () => {
    const loaded = await loadProjectFromDisk(gallery);
    const content = loaded.content!;
    const exp = mapToTiled(content, "garden", s => `tilesets/${path.basename(s.path)}`);
    const tmj = exp.tmj as { width: number; height: number; layers: Array<{ type: string; data?: number[]; objects?: unknown[] }>; tilesets: Array<{ firstgid: number; tilecount: number }> };
    const total = tmj.tilesets.reduce((s, t) => s + t.tilecount, 0);
    const ground = tmj.layers.find(l => l.type === "tilelayer")!;
    expect(ground.data!.length).toBe(tmj.width * tmj.height);
    expect(Math.max(...ground.data!)).toBeLessThanOrEqual(total);
    expect(tmj.tilesets.length).toBeGreaterThan(1);
    expect(tmj.layers.find(l => l.type === "objectgroup")!.objects!.length).toBeGreaterThan(0);
    // オートタイル（水辺）の端は、真ん中と違う番号になる
    const cells = resolveMapLayers(content, content.maps.garden!)[0]!.cells.flat().filter(Boolean);
    expect(new Set(cells.map(c => `${c!.sheet}:${c!.index}`)).size).toBeGreaterThan(10);
    const png = await renderMapPng(gallery, content, "garden-house");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("キャラクター作り: 見本や部品から、歩く4方向×4コマを作る（同じシードなら同じ）", () => {
    const fox = characterSpec({ id: "fox", name: "狐", spec: { ears: "cat", tail: "#e8a040", item: "lantern" } });
    expect(fox).toMatchObject({ id: "fox", name: "狐", ears: "cat", item: "lantern" });
    expect(characterSpec({ id: "k", name: "騎士", from: "knight" }).outfit.type).toBe("armor");
    expect(() => characterSpec({ id: "x", name: "x", from: "no-such" })).toThrow();
    const sheet = renderCharacterSheet(fox);
    expect([sheet.w, sheet.h]).toEqual([256, 256]);
    expect(randomCharacter(7)).toEqual(randomCharacter(7));
    expect(CHARACTERS.length).toBeGreaterThan(20);
  });

  it("素材パックに、マップ（使うタイルごと）と楽譜BGMのWAVが入る。配れないタイルを使うマップは入れない", async () => {
    const g = (await loadProjectFromDisk(gallery)).content!;
    const plan = planAssetPack(g.project, g.assets.assets, [], { id: "p", title: "庭", author: "a", license: "cc0", mapIds: ["garden"], content: g }, g.tileset);
    const names = plan.files.map(f => f.name);
    expect(names).toEqual(expect.arrayContaining(["p/maps/garden.tmj", "p/maps/garden.png"]));
    expect(names.some(n => n.startsWith("p/tilesets/") && n.endsWith(".png"))).toBe(true);
    const s = (await loadProjectFromDisk(sample)).content!;
    const songs = s.assets.assets.filter(a => a.kind === "song").map(a => a.id);
    const withSongs = planAssetPack(s.project, s.assets.assets, songs, { id: "m", title: "曲", author: "a", license: "cc0" });
    expect(withSongs.files.filter(f => "songWav" in f.source).length).toBe(songs.length);
    const village = planAssetPack(s.project, s.assets.assets, [], { id: "v", title: "村", author: "a", license: "cc0", mapIds: ["village"], content: s });
    expect(village.problems.join()).toMatch(/マップ village/);
  });
});

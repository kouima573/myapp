import { describe, expect, it } from "vitest";
import { composeSong, SONG_MOODS } from "./songCompose";
import { parseNotes } from "./song";

describe("おまかせ作曲", () => {
  it("どの場面でも、全パートが同じ長さの正しい楽譜になる（ループの継ぎ目がずれない）", () => {
    for (const mood of SONG_MOODS) for (const seed of [1, 2, 7]) for (const bars of [8, 16] as const) {
      const song = composeSong({ mood, seed, bars });
      const lengths = song.tracks.map(t => parseNotes(t.notes, t.transpose).length);
      expect(new Set(lengths).size, `${mood} ${seed}`).toBe(1);
      expect(lengths[0]).toBe((mood === "victory" ? 4 : bars) * 4);
    }
  });

  it("同じ場面と番号なら同じ曲、番号を変えると別の曲。勝利のファンファーレはくり返さない", () => {
    expect(composeSong({ mood: "battle", seed: 3 })).toEqual(composeSong({ mood: "battle", seed: 3 }));
    expect(composeSong({ mood: "battle", seed: 3 }).tracks[0]!.notes).not.toBe(composeSong({ mood: "battle", seed: 4 }).tracks[0]!.notes);
    expect(composeSong({ mood: "victory" }).loop).toBe(false);
    expect(composeSong({ mood: "town" }).loop).toBe(true);
    expect(composeSong({ mood: "battle", seed: 1 }).tempo).toBeGreaterThan(composeSong({ mood: "sad", seed: 1 }).tempo);
  });

  it("旋律は工房のマス目（C4〜B5）に収まり、同じ音が3回以上続かない", () => {
    for (const mood of SONG_MOODS) for (let seed = 1; seed <= 20; seed++) {
      const notes = parseNotes(composeSong({ mood, seed, bars: 16 }).tracks[0]!.notes).events.filter(e => e.freq).map(e => Math.round(69 + 12 * Math.log2(e.freq! / 440)));
      expect(Math.min(...notes)).toBeGreaterThanOrEqual(60);
      expect(Math.max(...notes)).toBeLessThanOrEqual(83);
      for (let i = 2; i < notes.length; i++) if (notes[i] === notes[i - 1] && notes[i] === notes[i - 2]) expect.fail(`${mood} ${seed}: 同じ音が3回続く`);
    }
  });
});

/**
 * Pure TypeScript definitions and note parser for text-score chiptune songs (.song.json).
 * Kept separate from formats.ts so browser game builds can parse songs without bundling Zod.
 */

export const SONG_WAVES = ["square", "pulse25", "pulse12", "triangle", "sawtooth", "sine", "noise"] as const;
export type SongWave = (typeof SONG_WAVES)[number];

export interface SongTrack {
  name?: string;
  wave: SongWave;
  volume: number;
  notes: string;
  transpose: number;
}

export interface Song {
  formatVersion: 1;
  title: string;
  /** Quarter notes per minute. */
  tempo: number;
  loop: boolean;
  tracks: SongTrack[];
}

export interface SongEvent { start: number; duration: number; freq: number | null; hit: boolean }
const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Parses a track's note string into events measured in beats (quarter note = 1). Throws with the token position on error. */
export function parseNotes(text: string, transpose = 0): { events: SongEvent[]; length: number } {
  const events: SongEvent[] = [];
  let time = 0;
  const tokens = text.split(/\s+/).filter(t => t && t !== "|");
  tokens.forEach((token, i) => {
    const m = /^(R|x|[A-G](#|b)?(-?\d))\/(1|2|4|8|16|32)(\.?)$/.exec(token);
    if (!m) throw new Error(`${i + 1}番目の「${token}」が読めません（例: C4/8, F#3/4., R/16, x/8）`);
    const beats = (4 / Number(m[4])) * (m[5] ? 1.5 : 1);
    if (m[1] === "R") { time += beats; return; }
    if (m[1] === "x") { events.push({ start: time, duration: beats, freq: null, hit: true }); time += beats; return; }
    const letter = m[1]![0]!;
    const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
    const octave = Number(m[3]);
    const midi = 12 * (octave + 1) + NOTE_INDEX[letter]! + accidental + transpose;
    events.push({ start: time, duration: beats, freq: 440 * 2 ** ((midi - 69) / 12), hit: false });
    time += beats;
  });
  return { events, length: time };
}

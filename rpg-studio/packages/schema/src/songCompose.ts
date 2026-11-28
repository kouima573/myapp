/**
 * おまかせ作曲: 場面（村・戦闘・ダンジョン…）を選ぶと、決まった作り方（音階・和音の流れ・リズムの型）で
 * 楽譜BGM（.song.json）を組み立てる。AI は使わない。同じ場面と番号なら同じ曲になり、番号を変えると別の曲になる。
 * 純粋関数（工房・CLI・テストで共用）。できた曲は工房の楽譜エディターでそのまま直せる。
 */
import type { Song, SongTrack, SongWave } from "./song";

export const SONG_MOODS = ["town", "field", "dungeon", "battle", "boss", "sad", "peaceful", "shop", "castle", "mystery", "victory", "ending"] as const;
export type SongMood = (typeof SONG_MOODS)[number];
export const SONG_MOOD_LABELS: Record<SongMood, string> = {
  town: "村・町（のどか）", field: "フィールド（冒険）", dungeon: "ダンジョン（あやしい）", battle: "戦闘", boss: "ボス戦",
  sad: "悲しい場面", peaceful: "やすらぎ（宿屋・家の中）", shop: "お店（にぎやか）", castle: "お城（おごそか）", mystery: "なぞ・不思議",
  victory: "勝利のファンファーレ（1回だけ鳴る）", ending: "エンディング",
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10], HARMONIC = [0, 2, 3, 5, 7, 8, 11], PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
type BassStyle = "whole" | "half" | "quarter" | "eighth" | "octave";
type HarmonyStyle = "arp16" | "arp8" | "pad" | "none";
interface MoodDef {
  scale: number[]; tempo: [number, number]; progressions: number[][];
  lead: { wave: SongWave; volume: number }; bass: { wave: SongWave; volume: number; style: BassStyle };
  harmony: { wave: SongWave; volume: number; style: HarmonyStyle };
  rhythms: number[][]; drums: number[][] | null; loop: boolean; bars: number; fanfare?: boolean;
}

const MAJOR_PROGS = [[0, 3, 4, 0], [0, 5, 3, 4], [0, 4, 5, 3], [0, 2, 3, 4], [5, 3, 4, 0], [0, 3, 0, 4]];
const MINOR_PROGS = [[0, 5, 6, 0], [0, 3, 4, 0], [0, 6, 5, 4], [0, 5, 3, 4], [0, 3, 6, 4]];
const CALM = [[4, 4, 4, 4], [8, 4, 4], [4, 4, 8], [6, 2, 4, 4], [4, 2, 2, 8], [12, 4]];
const LIVELY = [[4, 2, 2, 4, 4], [2, 2, 4, 2, 2, 4], [6, 2, 6, 2], [4, 4, 2, 2, 4], [2, 2, 2, 2, 4, 4], [4, 4, 4, 4]];
const FAST = [[2, 2, 2, 2, 2, 2, 4], [2, 2, 4, 2, 2, 4], [4, 2, 2, 4, 2, 2], [2, 2, 2, 2, 8], [3, 3, 2, 4, 4], [2, -2, 2, 2, 4, 4]];
const SLOW = [[8, 8], [4, 4, 8], [6, 2, 8], [4, -4, 4, 4], [12, 4], [8, 4, 4]];
const MARCH = [[6, 2, 4, 4], [4, 4, 4, 4], [6, 2, 6, 2], [8, 4, 4], [4, 2, 2, 8]];
/** Last bar of a phrase: ends on a long note. */
const CADENCE = [[4, 4, 8], [8, 8], [16], [6, 2, 8]];
// Drum bars (16th steps; negative = rest).
const D_LIGHT = [[2, -2, -4, 2, -2, -4]], D_BEAT = [[2, -2, 2, -2, 2, -2, 1, 1, 2]], D_ROCK = [[2, 2, 2, 1, 1, 2, 2, 2, 2]], D_MARCH = [[4, 2, 2, 4, 4]], D_SHOP = [[2, -2, 2, 2, -2, 2, 2, 2]];

const MOODS: Record<SongMood, MoodDef> = {
  town: { scale: MAJOR, tempo: [100, 116], progressions: MAJOR_PROGS, lead: { wave: "pulse25", volume: 0.1 }, bass: { wave: "triangle", volume: 0.26, style: "quarter" }, harmony: { wave: "pulse12", volume: 0.05, style: "arp8" }, rhythms: CALM, drums: D_LIGHT, loop: true, bars: 8 },
  field: { scale: MAJOR, tempo: [120, 138], progressions: MAJOR_PROGS, lead: { wave: "square", volume: 0.1 }, bass: { wave: "triangle", volume: 0.26, style: "eighth" }, harmony: { wave: "pulse12", volume: 0.05, style: "arp16" }, rhythms: LIVELY, drums: D_BEAT, loop: true, bars: 8 },
  dungeon: { scale: MINOR, tempo: [84, 100], progressions: MINOR_PROGS, lead: { wave: "triangle", volume: 0.2 }, bass: { wave: "triangle", volume: 0.24, style: "half" }, harmony: { wave: "sine", volume: 0.06, style: "pad" }, rhythms: SLOW, drums: null, loop: true, bars: 8 },
  battle: { scale: HARMONIC, tempo: [150, 168], progressions: MINOR_PROGS, lead: { wave: "square", volume: 0.1 }, bass: { wave: "triangle", volume: 0.28, style: "eighth" }, harmony: { wave: "pulse25", volume: 0.045, style: "arp16" }, rhythms: FAST, drums: D_ROCK, loop: true, bars: 8 },
  boss: { scale: HARMONIC, tempo: [160, 180], progressions: MINOR_PROGS, lead: { wave: "square", volume: 0.1 }, bass: { wave: "sawtooth", volume: 0.08, style: "octave" }, harmony: { wave: "pulse25", volume: 0.045, style: "arp16" }, rhythms: FAST, drums: D_ROCK, loop: true, bars: 8 },
  sad: { scale: MINOR, tempo: [66, 80], progressions: MINOR_PROGS, lead: { wave: "sine", volume: 0.18 }, bass: { wave: "triangle", volume: 0.22, style: "whole" }, harmony: { wave: "triangle", volume: 0.08, style: "arp8" }, rhythms: CALM, drums: null, loop: true, bars: 8 },
  peaceful: { scale: MAJOR, tempo: [80, 96], progressions: MAJOR_PROGS, lead: { wave: "pulse12", volume: 0.1 }, bass: { wave: "triangle", volume: 0.22, style: "half" }, harmony: { wave: "sine", volume: 0.07, style: "pad" }, rhythms: CALM, drums: null, loop: true, bars: 8 },
  shop: { scale: MAJOR, tempo: [112, 126], progressions: MAJOR_PROGS, lead: { wave: "pulse25", volume: 0.1 }, bass: { wave: "triangle", volume: 0.26, style: "octave" }, harmony: { wave: "pulse12", volume: 0.045, style: "arp8" }, rhythms: LIVELY, drums: D_SHOP, loop: true, bars: 8 },
  castle: { scale: MAJOR, tempo: [96, 108], progressions: MAJOR_PROGS, lead: { wave: "square", volume: 0.1 }, bass: { wave: "triangle", volume: 0.26, style: "quarter" }, harmony: { wave: "triangle", volume: 0.08, style: "pad" }, rhythms: MARCH, drums: D_MARCH, loop: true, bars: 8 },
  mystery: { scale: PHRYGIAN, tempo: [72, 88], progressions: MINOR_PROGS, lead: { wave: "sine", volume: 0.18 }, bass: { wave: "triangle", volume: 0.22, style: "whole" }, harmony: { wave: "pulse12", volume: 0.045, style: "arp16" }, rhythms: SLOW, drums: null, loop: true, bars: 8 },
  victory: { scale: MAJOR, tempo: [132, 140], progressions: [[0, 3, 4, 0], [0, 5, 4, 0]], lead: { wave: "square", volume: 0.11 }, bass: { wave: "triangle", volume: 0.26, style: "quarter" }, harmony: { wave: "pulse25", volume: 0.05, style: "arp16" }, rhythms: [[2, 2, 2, 4, 6], [4, 4, 8], [4, 4, 4, 4], [16]], drums: D_MARCH, loop: false, bars: 4, fanfare: true },
  ending: { scale: MAJOR, tempo: [80, 92], progressions: MAJOR_PROGS, lead: { wave: "pulse25", volume: 0.1 }, bass: { wave: "triangle", volume: 0.24, style: "half" }, harmony: { wave: "sine", volume: 0.07, style: "pad" }, rhythms: CALM, drums: D_LIGHT, loop: true, bars: 8 },
};

/** 16th steps → note length text. */
const LEN: Record<number, string> = { 1: "16", 2: "8", 3: "8.", 4: "4", 6: "4.", 8: "2", 12: "2.", 16: "1" };
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pitch = (midi: number) => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
const tok = (midi: number | null, steps: number) => `${midi === null ? "R" : pitch(midi)}/${LEN[steps]}`;

function rng(seed: number) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface ComposeOptions { mood: SongMood; seed?: number; /** 8 (default) or 16 bars (fanfare: 4). */ bars?: 8 | 16; tempo?: number; title?: string }

/** Composes a song for a scene. Every track has the same length (bars × 4 beats), so loops line up. */
export function composeSong(options: ComposeOptions): Song {
  const def = MOODS[options.mood];
  const seed = options.seed ?? 1;
  const r = rng(seed * 7919 + SONG_MOODS.indexOf(options.mood) * 104729);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
  const bars = def.fanfare ? def.bars : options.bars ?? def.bars;
  const tempo = options.tempo ?? Math.round(def.tempo[0] + r() * (def.tempo[1] - def.tempo[0]));
  const key = pick([-4, -2, 0, 2, 3]);
  const scale = def.scale;
  const deg = (i: number) => scale[((i % 7) + 7) % 7]! + 12 * Math.floor(i / 7);

  // Chords: one per bar. Phrases of 4 bars; the last phrase ends V → I.
  const chords: number[] = [];
  for (let p = 0; p < bars / 4; p++) {
    const prog = [...pick(def.progressions)];
    if (p === bars / 4 - 1) { prog[2] = 4; prog[3] = 0; }
    chords.push(...prog);
  }
  const chordTones = (d: number) => new Set([d % 7, (d + 2) % 7, (d + 4) % 7]);

  // Melody (scale index around G4 + key, kept inside C4..B5 so the studio's step grid can show it).
  // Each 4-bar phrase follows an arch: start → up → peak → settle.
  const MEL = 67 + key, LO = -1, HI = 7;
  const clamp = (v: number) => Math.max(LO, Math.min(HI, v));
  const isTone = (c: number, d: number) => chordTones(d).has(((c % 7) + 7) % 7);
  const nearestChordTone = (from: number, d: number) => {
    for (let k = 0; k <= 7; k++) for (const c of [from + k, from - k]) if (c >= LO && c <= HI && isTone(c, d)) return c;
    return clamp(from);
  };
  const upChordTone = (from: number, d: number) => { for (let c = from + 1; c <= HI; c++) if (isTone(c, d)) return c; return nearestChordTone(from, d); };
  const start = pick([0, 2, 4]);
  let pos = start;
  const recent: number[] = [];
  const positions: number[][] = [];
  const hasTriple = (seq: number[]) => seq.some((v, i) => i >= 2 && v === seq[i - 1] && v === seq[i - 2]);
  const melodyBar = (b: number): string[] => {
    const barPos: number[] = [];
    positions[b] = barPos;
    const phraseBar = b % 4, lastOfPhrase = phraseBar === 3, lastOfSong = b === bars - 1;
    const lift = Math.floor(b / 4) % 2 === 1 ? 1 : 0;
    const target = clamp(start + [0, 2, 4, 1][phraseBar]! + lift);
    const pattern = def.fanfare ? def.rhythms[Math.min(b, def.rhythms.length - 1)]! : lastOfPhrase ? pick(CADENCE) : pick(def.rhythms);
    const out: string[] = [];
    let step = 0;
    pattern.forEach((len, k) => {
      const steps = Math.abs(len);
      if (len < 0) { out.push(tok(null, steps)); step += steps; return; }
      const isLast = k === pattern.length - 1;
      const dir = Math.sign(target - pos) || (r() < 0.5 ? -1 : 1);
      if (lastOfSong && isLast) pos = nearestChordTone(pos > 3 ? 7 : 0, 0);
      else if (def.fanfare) pos = b === 0 && k === 0 ? nearestChordTone(0, chords[b]!) : isLast && lastOfSong ? 7 : upChordTone(pos - (k === 0 ? 2 : 0), chords[b]!);
      else if (step === 0) pos = nearestChordTone(target, chords[b]!);
      else if (step === 8 || (isLast && lastOfPhrase)) pos = nearestChordTone(clamp(pos + dir), chords[b]!);
      else pos = clamp(pos + pick([dir, dir, dir, -dir, 2 * dir]));
      // No more than two of the same note in a row (the last note may jump an octave instead).
      if (recent.length >= 2 && recent.at(-1) === pos && recent.at(-2) === pos) {
        const options = lastOfSong && isLast ? [pos >= 7 ? 0 : 7] : [pos + dir, pos - dir, pos + 2 * dir, pos - 2 * dir];
        pos = options.find(c => c >= LO && c <= HI && c !== pos) ?? pos;
      }
      recent.push(pos);
      barPos.push(pos);
      out.push(tok(MEL + deg(pos), steps));
      step += steps;
    });
    return out;
  };
  const melody: string[][] = [];
  for (let b = 0; b < bars; b++) {
    // The second phrase starts like the first (AA'), so the tune is easy to remember.
    const copied = positions[b - 4];
    if (!def.fanfare && b >= 4 && b % 4 < 2 && chords[b] === chords[b - 4] && copied?.length
      && !hasTriple([...recent.slice(-2), ...copied])) {
      melody.push(melody[b - 4]!); positions[b] = copied; recent.push(...copied); pos = copied.at(-1)!; continue;
    }
    melody.push(melodyBar(b));
  }

  // Bass: chord roots around C2..B2.
  const bassRoot = (d: number) => { let m = 36 + key + deg(d); while (m > 47) m -= 12; while (m < 33) m += 12; return m; };
  const bass = chords.map(d => {
    const root = bassRoot(d), fifth = root + (deg(d + 4) - deg(d));
    switch (def.bass.style) {
      case "whole": return [tok(root, 16)];
      case "half": return [tok(root, 8), tok(fifth, 8)];
      case "quarter": return [tok(root, 4), tok(root, 4), tok(fifth, 4), tok(root, 4)];
      case "eighth": return Array.from({ length: 8 }, (_, i) => tok(i === 6 ? fifth : root, 2));
      case "octave": return Array.from({ length: 8 }, (_, i) => tok(i % 2 ? root + 12 : root, 2));
    }
  });

  // Harmony: arpeggios or a held chord tone, around C4.
  const HARM = 60 + key;
  const harmony = chords.map(d => {
    const tones = [deg(d), deg(d + 2), deg(d + 4), deg(d + 2)].map(x => HARM + x);
    switch (def.harmony.style) {
      case "arp16": return Array.from({ length: 16 }, (_, i) => tok(tones[i % 4]!, 1));
      case "arp8": return Array.from({ length: 8 }, (_, i) => tok(tones[i % 4]!, 2));
      case "pad": return [tok(HARM + deg(d + 2), 16)];
      case "none": return [tok(null, 16)];
    }
  });

  const tracks: SongTrack[] = [
    { name: "メロディ", wave: def.lead.wave, volume: def.lead.volume, notes: melody.map(b => b.join(" ")).join(" | "), transpose: 0 },
    { name: "ベース", wave: def.bass.wave, volume: def.bass.volume, notes: bass.map(b => b.join(" ")).join(" | "), transpose: 0 },
  ];
  if (def.harmony.style !== "none") tracks.push({ name: "伴奏", wave: def.harmony.wave, volume: def.harmony.volume, notes: harmony.map(b => b.join(" ")).join(" | "), transpose: 0 });
  if (def.drums) {
    const pattern = pick(def.drums);
    const bar = pattern.map(len => (len < 0 ? `R/${LEN[-len]}` : `x/${LEN[len]}`)).join(" ");
    tracks.push({ name: "打楽器", wave: "noise", volume: 0.05, notes: Array.from({ length: bars }, () => bar).join(" | "), transpose: 0 });
  }
  return { formatVersion: 1, title: options.title ?? `${SONG_MOOD_LABELS[options.mood].replace(/（.*）/, "")}のテーマ ${seed}`, tempo, loop: def.loop, tracks };
}

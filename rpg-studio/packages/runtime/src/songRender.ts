/**
 * 楽譜BGM（.song.json）を音声データにする: ブラウザの音声機能なしで、ゲーム内の再生（audio.ts の SongPlayer）と
 * 同じ音色・音量の包絡で合成する。「音楽だけ」の作品として WAV で配ったり、ほかのツールで使ったりできるように。
 * 純粋関数（決まった乱数）。ループする曲は、最後の音の余韻を先頭に重ねて継ぎ目なくループできる長さで書き出す。
 */
import { parseNotes, type Song } from "../../schema/src/song";
import { encodeWav } from "./sfx";

export interface SongRenderOptions { sampleRate?: number }

function wave(kind: Song["tracks"][number]["wave"], phase: number): number {
  const p = phase - Math.floor(phase);
  switch (kind) {
    case "sine": return Math.sin(2 * Math.PI * p);
    case "square": return p < 0.5 ? 1 : -1;
    case "pulse25": return (p < 0.25 ? 1 : -1) + 0.5; // remove the DC offset of a 25% pulse
    case "pulse12": return (p < 0.125 ? 1 : -1) + 0.75;
    case "triangle": return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case "sawtooth": return 2 * p - 1;
    default: return 0;
  }
}

/** Mono samples (-1..1) of one pass through the song. */
export function renderSong(song: Song, options: SongRenderOptions = {}): { samples: Float32Array; sampleRate: number; seconds: number } {
  const sampleRate = options.sampleRate ?? 44100;
  const spb = 60 / song.tempo;
  const tracks = song.tracks.map(t => ({ ...t, parsed: parseNotes(t.notes, t.transpose) }));
  const beats = Math.max(1, ...tracks.map(t => t.parsed.length));
  const length = Math.round(beats * spb * sampleRate);
  const tail = Math.round(0.6 * sampleRate);
  const mix = new Float32Array(length + tail);
  let seed = 0x9e3779b9;
  const random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1; };

  for (const track of tracks) {
    for (const ev of track.parsed.events) {
      const noisy = track.wave === "noise" || ev.hit;
      if (ev.freq === null && !noisy) continue; // rest
      const start = Math.round(ev.start * spb * sampleRate);
      const dur = Math.max(0.03, ev.duration * spb * (noisy ? 0.5 : 0.9));
      const n = Math.round((dur + 0.02) * sampleRate);
      const attack = 0.006, release = 0.03;
      // one-pole high-pass for noise (cut-off as in the live player)
      const cutoff = ev.freq ? Math.min(8000, ev.freq * 4) : 3000;
      const rc = 1 / (2 * Math.PI * cutoff), dt = 1 / sampleRate, a = rc / (rc + dt);
      let prevIn = 0, prevOut = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        const env = t < attack ? t / attack : t < dur - release ? 1 : t < dur ? Math.max(0, (dur - t) / release) : 0;
        if (env <= 0 && t > dur) break;
        let s: number;
        if (noisy) { const x = random(); prevOut = a * (prevOut + x - prevIn); prevIn = x; s = prevOut; }
        else s = wave(track.wave, (ev.freq ?? 440) * t);
        const at = start + i;
        if (at < mix.length) mix[at]! += s * env * track.volume;
      }
    }
  }
  let out: Float32Array;
  if (song.loop) {
    out = mix.slice(0, length);
    for (let i = 0; i < tail; i++) out[i % length]! += mix[length + i]!; // wrap the tail so the file loops without a click
  } else out = mix;
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  if (peak > 0.95) for (let i = 0; i < out.length; i++) out[i] = out[i]! * (0.95 / peak);
  return { samples: out, sampleRate, seconds: out.length / sampleRate };
}

/** WAV file bytes of a song (16-bit mono). */
export function songToWav(song: Song, options: SongRenderOptions = {}): Uint8Array {
  const { samples, sampleRate } = renderSong(song, options);
  return encodeWav(samples, sampleRate);
}

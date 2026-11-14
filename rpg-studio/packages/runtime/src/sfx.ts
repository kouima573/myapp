/**
 * Small deterministic sound-effect synthesizer (sfxr-like). Pure: runs in Node (CLI → WAV files) and in the browser.
 * Everything it makes is original, so generated files carry no third-party license.
 */
export type SfxWave = "square" | "triangle" | "sawtooth" | "sine" | "noise";

export interface SfxParams {
  wave: SfxWave;
  /** Pulse width for square (0.05–0.5). */
  duty?: number;
  freq: number;
  /** Frequency at the end of the sound (exponential slide). */
  freqEnd?: number;
  attack: number;
  sustain: number;
  decay: number;
  volume: number;
  vibratoDepth?: number;
  vibratoRate?: number;
  /** Pitch steps: at `at` seconds multiply the base pitch by `ratio`. */
  arp?: Array<{ at: number; ratio: number }>;
  /** 0..1 amount of noise mixed into a tonal wave. */
  noiseMix?: number;
  /** 0..1, higher = darker. */
  lowpass?: number;
}

export const SFX_PRESETS = ["cursor", "confirm", "cancel", "bump", "hit", "hurt", "heal", "encounter", "victory", "defeat", "door", "item", "save", "menu", "coin", "magic", "step", "explosion"] as const;
export type SfxPreset = (typeof SFX_PRESETS)[number];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let r = Math.imul(s ^ (s >>> 15), s | 1); r ^= r + Math.imul(r ^ (r >>> 7), r | 61); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

/** Preset → parameters, with small seed-based variation so several distinct variants can be generated. */
export function presetParams(preset: SfxPreset, seed = 1): SfxParams {
  const r = rng(seed);
  const v = (base: number, spread: number) => base * (1 + (r() * 2 - 1) * spread);
  switch (preset) {
    case "cursor": return { wave: "square", duty: 0.25, freq: v(1250, 0.1), attack: 0.002, sustain: 0.02, decay: 0.03, volume: 0.35 };
    case "confirm": return { wave: "square", duty: 0.5, freq: v(880, 0.08), attack: 0.002, sustain: 0.05, decay: 0.08, volume: 0.35, arp: [{ at: 0.05, ratio: 1.5 }] };
    case "cancel": return { wave: "square", duty: 0.5, freq: v(660, 0.08), freqEnd: v(330, 0.08), attack: 0.002, sustain: 0.04, decay: 0.08, volume: 0.32 };
    case "bump": return { wave: "square", duty: 0.5, freq: v(140, 0.1), freqEnd: v(90, 0.1), attack: 0.001, sustain: 0.03, decay: 0.05, volume: 0.4, lowpass: 0.5 };
    case "hit": return { wave: "noise", freq: v(1200, 0.2), freqEnd: 200, attack: 0.001, sustain: 0.03, decay: v(0.12, 0.2), volume: 0.5, lowpass: 0.3 };
    case "hurt": return { wave: "sawtooth", freq: v(420, 0.1), freqEnd: v(90, 0.1), attack: 0.001, sustain: 0.05, decay: 0.15, volume: 0.4, noiseMix: 0.35, lowpass: 0.35 };
    case "heal": return { wave: "sine", freq: v(523, 0.05), attack: 0.01, sustain: 0.25, decay: 0.25, volume: 0.35, vibratoDepth: 0.02, vibratoRate: 9, arp: [{ at: 0.08, ratio: 1.26 }, { at: 0.16, ratio: 1.5 }, { at: 0.24, ratio: 2 }] };
    case "encounter": return { wave: "square", duty: 0.125, freq: v(220, 0.05), freqEnd: v(1760, 0.05), attack: 0.005, sustain: 0.25, decay: 0.2, volume: 0.3, vibratoDepth: 0.03, vibratoRate: 18 };
    case "victory": return { wave: "square", duty: 0.25, freq: 523.25, attack: 0.005, sustain: 0.7, decay: 0.35, volume: 0.3, arp: [{ at: 0.12, ratio: 1.26 }, { at: 0.24, ratio: 1.5 }, { at: 0.36, ratio: 2 }, { at: 0.6, ratio: 1.5 }, { at: 0.72, ratio: 2 }] };
    case "defeat": return { wave: "triangle", freq: 392, freqEnd: 98, attack: 0.01, sustain: 0.6, decay: 0.5, volume: 0.45, vibratoDepth: 0.02, vibratoRate: 5, arp: [{ at: 0.3, ratio: 0.94 }, { at: 0.6, ratio: 0.84 }] };
    case "door": return { wave: "noise", freq: v(500, 0.2), freqEnd: 120, attack: 0.002, sustain: 0.06, decay: 0.18, volume: 0.45, lowpass: 0.6 };
    case "item": return { wave: "square", duty: 0.25, freq: v(988, 0.05), attack: 0.002, sustain: 0.1, decay: 0.2, volume: 0.3, arp: [{ at: 0.07, ratio: 1.335 }, { at: 0.14, ratio: 2 }] };
    case "save": return { wave: "sine", freq: v(660, 0.03), attack: 0.01, sustain: 0.2, decay: 0.4, volume: 0.35, arp: [{ at: 0.1, ratio: 1.5 }], vibratoDepth: 0.01, vibratoRate: 6 };
    case "menu": return { wave: "triangle", freq: v(700, 0.1), freqEnd: v(1000, 0.1), attack: 0.002, sustain: 0.03, decay: 0.05, volume: 0.4 };
    case "coin": return { wave: "square", duty: 0.5, freq: v(988, 0.03), attack: 0.001, sustain: 0.05, decay: 0.25, volume: 0.3, arp: [{ at: 0.06, ratio: 1.335 }] };
    case "magic": return { wave: "sine", freq: v(440, 0.1), freqEnd: v(1320, 0.1), attack: 0.02, sustain: 0.3, decay: 0.3, volume: 0.32, vibratoDepth: 0.06, vibratoRate: 14, noiseMix: 0.08 };
    case "step": return { wave: "noise", freq: v(800, 0.3), attack: 0.001, sustain: 0.01, decay: 0.04, volume: 0.18, lowpass: 0.7 };
    case "explosion": return { wave: "noise", freq: v(300, 0.2), freqEnd: 40, attack: 0.002, sustain: 0.15, decay: v(0.6, 0.2), volume: 0.6, lowpass: 0.55 };
  }
}

/** Renders mono samples in -1..1. */
export function renderSfx(p: SfxParams, sampleRate = 22050, seed = 1): Float32Array {
  const total = Math.max(1, Math.round((p.attack + p.sustain + p.decay) * sampleRate));
  const out = new Float32Array(total);
  const noise = rng(seed + 991);
  let phase = 0, lp = 0, held = 0, heldPhase = 0;
  const duty = Math.min(0.5, Math.max(0.05, p.duty ?? 0.5));
  const smooth = 1 - Math.min(0.95, Math.max(0, p.lowpass ?? 0));
  const duration = total / sampleRate;
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    let freq = p.freqEnd !== undefined ? p.freq * (p.freqEnd / p.freq) ** (t / duration) : p.freq;
    let ratio = 1;
    for (const step of p.arp ?? []) if (t >= step.at) ratio = step.ratio;
    freq *= ratio;
    if (p.vibratoDepth) freq *= 1 + p.vibratoDepth * Math.sin(2 * Math.PI * (p.vibratoRate ?? 6) * t);
    phase += freq / sampleRate;
    const f = phase % 1;
    let s: number;
    switch (p.wave) {
      case "square": s = f < duty ? 1 : -1; break;
      case "triangle": s = 1 - 4 * Math.abs(f - 0.5); break;
      case "sawtooth": s = 2 * f - 1; break;
      case "sine": s = Math.sin(2 * Math.PI * f); break;
      case "noise":
        // sfxr-style: a new random value several times per cycle, so pitch colours the noise.
        if (Math.floor(phase * 8) !== heldPhase) { heldPhase = Math.floor(phase * 8); held = noise() * 2 - 1; }
        s = held; break;
    }
    if (p.noiseMix) s = s * (1 - p.noiseMix) + (noise() * 2 - 1) * p.noiseMix;
    lp += (s - lp) * smooth;
    const env = t < p.attack ? t / p.attack : t < p.attack + p.sustain ? 1 : Math.max(0, 1 - (t - p.attack - p.sustain) / p.decay);
    out[i] = Math.max(-1, Math.min(1, lp * env * p.volume));
  }
  return out;
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate = 22050): Uint8Array {
  const data = samples.length * 2;
  const buffer = new ArrayBuffer(44 + data);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, 36 + data, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, data, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.round(s * 32767), true));
  return new Uint8Array(buffer);
}

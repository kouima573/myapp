/**
 * Browser audio: BGM files (ogg/mp3/wav), text-score songs synthesized live, and sound effects.
 * Unassigned cues fall back to a tiny synthesized blip so every game has basic feedback.
 */
import type { AssetEntry, GameContent, SfxCue } from "../../schema/src/formats";
import { parseNotes, type Song } from "../../schema/src/song";
import { presetParams, renderSfx, type SfxPreset } from "./sfx";

export interface AudioSettings { bgm: boolean; sfx: boolean; bgmVolume?: number; sfxVolume?: number }

type Loaded = { kind: "buffer"; buffer: AudioBuffer } | { kind: "song"; song: Song };

const FALLBACK: Partial<Record<SfxCue, SfxPreset>> = {
  cursor: "cursor", confirm: "confirm", cancel: "cancel", bump: "bump", hit: "hit", hurt: "hurt", heal: "heal",
  encounter: "encounter", victory: "victory", defeat: "defeat", door: "door", item: "item", save: "save", menu: "menu",
};

class SongPlayer {
  private timer = 0;
  private nextBeat = 0;
  private startTime = 0;
  private readonly tracks: Array<{ wave: Song["tracks"][number]["wave"]; volume: number; events: ReturnType<typeof parseNotes>["events"] }>;
  private readonly length: number;
  private readonly spb: number;
  private readonly out: GainNode;
  private stopped = false;

  constructor(private readonly ctx: AudioContext, destination: AudioNode, private readonly song: Song, private readonly noise: AudioBuffer) {
    this.tracks = song.tracks.map(t => ({ wave: t.wave, volume: t.volume, events: parseNotes(t.notes, t.transpose).events }));
    this.length = Math.max(...song.tracks.map(t => parseNotes(t.notes, t.transpose).length), 1);
    this.spb = 60 / song.tempo;
    this.out = ctx.createGain();
    this.out.connect(destination);
  }

  start() {
    this.startTime = this.ctx.currentTime + 0.05;
    this.nextBeat = 0;
    this.timer = window.setInterval(() => this.schedule(), 40);
    this.schedule();
  }

  stop(fade = 0.3) {
    this.stopped = true;
    window.clearInterval(this.timer);
    const now = this.ctx.currentTime;
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + fade);
    window.setTimeout(() => this.out.disconnect(), (fade + 0.1) * 1000);
  }

  private schedule() {
    if (this.stopped) return;
    const horizon = (this.ctx.currentTime - this.startTime + 0.25) / this.spb;
    while (this.nextBeat < horizon) {
      const loopIndex = Math.floor(this.nextBeat / this.length);
      if (!this.song.loop && loopIndex > 0) { this.stop(0.05); return; }
      const windowStart = this.nextBeat;
      const windowEnd = Math.min(this.nextBeat + 0.25, (loopIndex + 1) * this.length);
      for (const track of this.tracks) {
        for (const ev of track.events) {
          const at = loopIndex * this.length + ev.start;
          if (at >= windowStart && at < windowEnd) this.note(track.wave, track.volume, ev, this.startTime + at * this.spb);
        }
      }
      this.nextBeat = windowEnd;
    }
  }

  private note(wave: Song["tracks"][number]["wave"], volume: number, ev: { duration: number; freq: number | null; hit: boolean }, when: number) {
    const ctx = this.ctx;
    const dur = Math.max(0.03, ev.duration * this.spb * (wave === "noise" || ev.hit ? 0.5 : 0.9));
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(volume, when + 0.006);
    gain.gain.setValueAtTime(volume, when + Math.max(0.006, dur - 0.03));
    gain.gain.linearRampToValueAtTime(0, when + dur);
    gain.connect(this.out);
    let source: AudioScheduledSourceNode;
    if (wave === "noise" || ev.hit) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = ev.freq ? Math.min(8000, ev.freq * 4) : 3000;
      src.connect(filter).connect(gain);
      source = src;
    } else {
      const osc = ctx.createOscillator();
      if (wave === "pulse25" || wave === "pulse12") osc.setPeriodicWave(pulseWave(ctx, wave === "pulse25" ? 0.25 : 0.125));
      else osc.type = wave;
      osc.frequency.value = ev.freq ?? 440;
      osc.connect(gain);
      source = osc;
    }
    source.start(when);
    source.stop(when + dur + 0.02);
  }
}

const pulseCache = new WeakMap<AudioContext, Map<number, PeriodicWave>>();
function pulseWave(ctx: AudioContext, duty: number): PeriodicWave {
  let map = pulseCache.get(ctx);
  if (!map) { map = new Map(); pulseCache.set(ctx, map); }
  const cached = map.get(duty);
  if (cached) return cached;
  const n = 64;
  const real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) { real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty) * Math.cos(k * Math.PI * duty); imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty) * Math.sin(k * Math.PI * duty); }
  const wave = ctx.createPeriodicWave(real, imag);
  map.set(duty, wave);
  return wave;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: { bgm: GainNode; sfx: GainNode } | null = null;
  private cache = new Map<string, Promise<Loaded | null>>();
  private fallback = new Map<SfxPreset, AudioBuffer>();
  private noise: AudioBuffer | null = null;
  private current: { id: string; stop: (fade?: number) => void } | null = null;
  private wanted: string | null = null;
  settings: AudioSettings;

  constructor(private readonly content: GameContent, private readonly resolve: (asset: AssetEntry) => string | Promise<string>, settings: AudioSettings) {
    this.settings = settings;
  }

  /** Must be called from a user gesture (browsers block audio before that). */
  unlock() {
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return; }
      const vol = this.content.project.audio.volume;
      const bgm = this.ctx.createGain(), sfx = this.ctx.createGain();
      bgm.gain.value = this.settings.bgm ? vol.bgm * (this.settings.bgmVolume ?? 1) : 0;
      sfx.gain.value = this.settings.sfx ? vol.sfx * (this.settings.sfxVolume ?? 1) : 0;
      bgm.connect(this.ctx.destination); sfx.connect(this.ctx.destination);
      this.master = { bgm, sfx };
      const noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = noise;
      const wanted = this.wanted;
      this.wanted = null;
      this.preload();
      this.setMusic(wanted);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  applySettings(settings: AudioSettings) {
    this.settings = settings;
    if (!this.master || !this.ctx) return;
    const vol = this.content.project.audio.volume;
    this.master.bgm.gain.setTargetAtTime(settings.bgm ? vol.bgm * (settings.bgmVolume ?? 1) : 0, this.ctx.currentTime, 0.05);
    this.master.sfx.gain.setTargetAtTime(settings.sfx ? vol.sfx * (settings.sfxVolume ?? 1) : 0, this.ctx.currentTime, 0.05);
  }

  private load(id: string): Promise<Loaded | null> {
    if (!this.ctx) return Promise.resolve(null);
    let promise = this.cache.get(id);
    if (promise) return promise;
    const asset = this.content.assets.assets.find(a => a.id === id);
    promise = (async () => {
      if (!asset || !this.ctx) return null;
      if (asset.kind === "song") {
        const known = this.content.songs[id];
        if (known) return { kind: "song", song: known } as const;
        const response = await fetch(await this.resolve(asset));
        return { kind: "song", song: (await response.json()) as Song } as const;
      }
      const response = await fetch(await this.resolve(asset));
      const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
      return { kind: "buffer", buffer } as const;
    })().catch(error => { console.warn(`音声 '${id}' を読み込めません`, error); return null; });
    this.cache.set(id, promise);
    return promise;
  }

  /** Preload assigned cue sounds so the first press is not silent. */
  preload() {
    for (const id of Object.values(this.content.project.audio.sfx)) if (id) void this.load(id);
  }

  playSound(id: string) {
    if (!this.ctx || !this.master || !this.settings.sfx) return;
    void this.load(id).then(loaded => {
      if (!loaded || !this.ctx || !this.master) return;
      if (loaded.kind === "song") { new SongPlayer(this.ctx, this.master.sfx, { ...loaded.song, loop: false }, this.noise!).start(); return; }
      const src = this.ctx.createBufferSource();
      src.buffer = loaded.buffer;
      const asset = this.content.assets.assets.find(a => a.id === id);
      const gain = this.ctx.createGain();
      gain.gain.value = asset?.initialVolume ?? 1;
      src.connect(gain).connect(this.master.sfx);
      src.start();
    });
  }

  cue(cue: SfxCue) {
    const assigned = this.content.project.audio.sfx[cue];
    if (assigned) { this.playSound(assigned); return; }
    if (!this.ctx || !this.master || !this.settings.sfx) return;
    const preset = FALLBACK[cue];
    if (!preset) return;
    let buffer = this.fallback.get(preset);
    if (!buffer) {
      const samples = renderSfx(presetParams(preset, 1), this.ctx.sampleRate);
      buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.fallback.set(preset, buffer);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.6;
    src.connect(gain).connect(this.master.sfx);
    src.start();
  }

  /** Switch BGM (crossfade). null = silence. */
  setMusic(id: string | null) {
    if (!this.ctx || !this.master) { this.wanted = id; return; }
    if ((this.current?.id ?? null) === id) return;
    this.current?.stop(0.4);
    this.current = null;
    if (!id) return;
    const token = { id, stop: (_fade?: number) => { cancelled = true; } };
    let cancelled = false;
    this.current = token;
    void this.load(id).then(loaded => {
      if (cancelled || !loaded || !this.ctx || !this.master || this.current !== token) return;
      if (loaded.kind === "song") {
        const player = new SongPlayer(this.ctx, this.master.bgm, loaded.song, this.noise!);
        player.start();
        token.stop = fade => player.stop(fade);
        return;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = loaded.buffer;
      const asset = this.content.assets.assets.find(a => a.id === id);
      src.loop = asset?.loop ?? true;
      const gain = this.ctx.createGain();
      const target = asset?.initialVolume ?? 1;
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.5);
      src.connect(gain).connect(this.master.bgm);
      src.start();
      token.stop = (fade = 0.4) => {
        if (!this.ctx) return;
        gain.gain.setValueAtTime(gain.gain.value, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fade);
        src.stop(this.ctx.currentTime + fade + 0.05);
      };
    });
  }

  dispose() {
    this.current?.stop(0.05);
    this.current = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}

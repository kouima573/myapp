/**
 * Genre module: rhythm (realtime). Notes fall in 4 lanes (← ↓ ↑ →); hit them on the line in time.
 * Charts are text so an AI can write them: one string per step, 4 characters per step ("x" = note, "." = rest).
 * Field: pass with `pass`% accuracy (a dance, a ritual, a song to open a door).
 * Battle mode: hits damage the enemy, misses let the enemy strike; the chart loops until one side falls.
 */
import { z } from "zod";
import { parseNotes } from "../../schema/src/formats";
import { defineSystem, type SystemContext } from "../../engine/src/index";
import { enemyOf, finish, heroOf, inBattle, issues, OutcomeArgs, pressed } from "./common";

const FPS = 30;
export const LANES = ["left", "down", "up", "right"] as const;

export const RhythmArgsSchema = z.object({
  title: z.string().default("リズム"),
  bpm: z.number().min(40).max(240).default(110),
  stepsPerBeat: z.number().int().min(1).max(4).default(2),
  chart: z.array(z.string().regex(/^[x.]{4}$/, "各行は4文字（x か .）です")).default([]),
  /** Play a song asset (楽譜BGM) and make the chart from it: its notes become the notes to hit (bpm = the song tempo). */
  song: z.string().optional(),
  /** Which track gives the notes (name or index). Default: the first track with pitched notes. */
  track: z.union([z.string(), z.number().int().min(0)]).optional(),
  /** Use every n-th note of the track (lower density). */
  every: z.number().int().min(1).max(8).default(1),
  /** Beats before the first step. */
  leadIn: z.number().int().min(0).max(16).default(4),
  /** Field: accuracy (%) needed to pass. */
  pass: z.number().min(0).max(100).default(70),
  /** Play a short click for every note (no audio files needed). */
  click: z.boolean().default(true),
  hpScale: z.number().min(0.1).max(50).default(1.5),
  ...OutcomeArgs,
}).strict();
export type RhythmArgs = z.infer<typeof RhythmArgsSchema>;

export interface Note { t: number; lane: number; hit: "" | "perfect" | "good" | "miss" }
/** Song playback events: [frame, frequency (0 = percussion hit), length in frames, wave, volume]. */
export type SongCue = [number, number, number, string, number];
export interface RhythmData {
  args: RhythmArgs; frame: number; notes: Note[]; held: string[]; loop: number; cues: SongCue[]; loopFrames: number;
  perfect: number; good: number; miss: number; combo: number; best: number;
  hp: number; maxHp: number; attack: number; defense: number; enemyHp: number; enemyMaxHp: number; battle: boolean; flash: string;
}

const framesPerStep = (a: RhythmArgs) => (FPS * 60) / a.bpm / a.stepsPerBeat;
export function chartNotes(a: RhythmArgs, offset: number): Note[] {
  const out: Note[] = [];
  a.chart.forEach((row, i) => Array.from(row).forEach((ch, lane) => { if (ch === "x") out.push({ t: Math.round(offset + i * framesPerStep(a)), lane, hit: "" }); }));
  return out;
}

/** Chart and playback cues from a song asset. Lanes follow pitch: the lowest notes go left, the highest right. */
export function songChart(ctx: SystemContext, a: RhythmArgs, offset: number): { notes: Note[]; cues: SongCue[]; loopFrames: number } {
  const song = ctx.content.songs[a.song ?? ""];
  if (!song) return { notes: [], cues: [], loopFrames: 0 };
  const perBeat = (FPS * 60) / song.tempo;
  const tracks = song.tracks.map(t => ({ t, parsed: parseNotes(t.notes, t.transpose) }));
  const chosen = typeof a.track === "number" ? tracks[a.track] : typeof a.track === "string" ? tracks.find(x => x.t.name === a.track) : tracks.find(x => x.parsed.events.some(e => e.freq));
  const pitched = (chosen?.parsed.events ?? []).filter(e => e.freq).filter((_, i) => i % a.every === 0);
  const pitches = [...new Set(pitched.map(e => Math.round(e.freq!)))].sort((x, y) => x - y);
  const lane = (f: number) => Math.min(3, Math.floor((pitches.indexOf(Math.round(f)) / Math.max(1, pitches.length)) * 4));
  const notes = pitched.map(e => ({ t: Math.round(offset + e.start * perBeat), lane: lane(e.freq!), hit: "" as const }));
  const cues: SongCue[] = tracks.flatMap(({ t, parsed }) => parsed.events.map(e => [Math.round(offset + e.start * perBeat), e.freq ? Math.round(e.freq * 100) / 100 : 0, Math.max(1, Math.round(e.duration * perBeat)), t.wave, t.volume] as SongCue));
  return { notes, cues, loopFrames: Math.round(Math.max(...tracks.map(x => x.parsed.length)) * perBeat) };
}

export function startRhythm(ctx: SystemContext, raw: Record<string, unknown>): RhythmData {
  let args = RhythmArgsSchema.parse(raw);
  if (args.song && ctx.content.songs[args.song]) args = { ...args, bpm: ctx.content.songs[args.song]!.tempo };
  const hero = heroOf(ctx);
  const enemy = enemyOf(ctx, args.enemyId);
  const enemyMaxHp = enemy ? Math.max(1, Math.round(enemy.stats.maxHp * args.hpScale)) : 0;
  const lead = Math.round((FPS * 60 * args.leadIn) / args.bpm);
  const fromSong = args.song ? songChart(ctx, args, lead) : null;
  return { args, frame: 0, notes: fromSong ? fromSong.notes : chartNotes(args, lead), cues: fromSong?.cues ?? [], loopFrames: fromSong?.loopFrames ?? 0, held: [], loop: 0, perfect: 0, good: 0, miss: 0, combo: 0, best: 0, hp: hero.hp, maxHp: hero.maxHp, attack: hero.attack, defense: hero.defense, enemyHp: enemyMaxHp, enemyMaxHp, battle: inBattle(ctx), flash: "" };
}

export function stepRhythm(ctx: SystemContext, data: RhythmData, held: string[]): RhythmData {
  const d: RhythmData = { ...data, frame: data.frame + 1, held, notes: data.notes.map(n => ({ ...n })) };
  const enemy = enemyOf(ctx, d.args.enemyId);
  const hitDamage = (perfect: boolean) => Math.max(1, Math.round(d.attack * (perfect ? 0.6 : 0.4)));
  for (const lane of pressed(held, data.held).map(b => LANES.indexOf(b as (typeof LANES)[number])).filter(i => i >= 0)) {
    const note = d.notes.filter(n => !n.hit && n.lane === lane && Math.abs(n.t - d.frame) <= 4).sort((a, b) => Math.abs(a.t - d.frame) - Math.abs(b.t - d.frame))[0];
    if (!note) continue;
    const perfect = Math.abs(note.t - d.frame) <= 2;
    note.hit = perfect ? "perfect" : "good";
    d[perfect ? "perfect" : "good"]++;
    d.combo++; d.best = Math.max(d.best, d.combo); d.flash = perfect ? "PERFECT" : "GOOD";
    if (d.battle) d.enemyHp = Math.max(0, d.enemyHp - hitDamage(perfect));
  }
  for (const n of d.notes) if (!n.hit && d.frame > n.t + 4) {
    n.hit = "miss"; d.miss++; d.combo = 0; d.flash = "MISS";
    if (d.battle) d.hp = Math.max(0, d.hp - Math.max(1, (enemy?.stats.attack ?? 4) - d.defense));
  }
  // Battle mode loops the chart.
  const last = Math.max(...d.notes.map(n => n.t));
  if (d.battle && d.frame > last + 10) {
    d.loop++;
    const offset = d.frame + Math.round(framesPerStep(d.args) * d.args.stepsPerBeat);
    if (d.args.song) { const again = songChart(ctx, d.args, offset); d.notes = again.notes; d.cues = again.cues; }
    else d.notes = chartNotes(d.args, offset);
  }
  return d;
}

export const accuracy = (d: RhythmData) => { const total = d.perfect + d.good + d.miss; return total ? Math.round(((d.perfect + d.good * 0.6) / total) * 100) : 0; };
export function rhythmStatus(d: RhythmData): "playing" | "win" | "lose" {
  if (d.battle) return d.enemyHp <= 0 ? "win" : d.hp <= 0 ? "lose" : "playing";
  if (d.notes.every(n => n.hit)) return accuracy(d) >= d.args.pass ? "win" : "lose";
  return "playing";
}

let audio: AudioContext | undefined;
let lastCueFrame = -1;
/** Plays the song cues due since the last drawn frame (synth: pulse / triangle / saw / sine, hits = noise). */
function playCues(d: RhythmData) {
  if (!d.cues.length) return;
  if (d.frame < lastCueFrame) lastCueFrame = -1;
  try {
    audio ??= new AudioContext();
    for (const [f, freq, len, wave, vol] of d.cues) {
      if (f <= lastCueFrame || f > d.frame) continue;
      const g = audio.createGain();
      const dur = len / FPS;
      g.gain.setValueAtTime(vol * 0.6, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + Math.max(0.05, dur * 0.95));
      g.connect(audio.destination);
      if (!freq || wave === "noise") {
        const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.06), audio.sampleRate);
        const ch = buf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
        const src = audio.createBufferSource(); src.buffer = buf; src.connect(g); src.start();
      } else {
        const o = audio.createOscillator();
        o.type = wave.startsWith("pulse") || wave === "square" ? "square" : wave === "saw" || wave === "sawtooth" ? "sawtooth" : wave === "sine" ? "sine" : "triangle";
        o.frequency.value = freq; o.connect(g); o.start(); o.stop(audio.currentTime + dur);
      }
    }
  } catch { /* no audio */ }
  lastCueFrame = d.frame;
}
const clicked = new Set<number>();
function click(lane: number) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = [523, 659, 784, 1047][lane]!; o.type = "triangle";
    g.gain.setValueAtTime(0.08, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.13);
  } catch { /* audio unavailable */ }
}

export default defineSystem({
  id: "rhythm",
  scenes: {
    play: {
      title: "リズム（4レーンの譜面。儀式・演奏・リズム戦闘）",
      realtime: { fps: FPS },
      checkArgs: (args, { content }) => {
        const r = RhythmArgsSchema.safeParse(args);
        if (!r.success) return issues(r);
        if (r.data.song) return content.songs[r.data.song] ? [] : [`song: 楽譜BGM '${r.data.song}' がありません（assets.json の song）`];
        return r.data.chart.some(row => row.includes("x")) ? [] : ["chart にノーツ(x)がありません（または song を指定）"];
      },
      start: (ctx, raw) => startRhythm(ctx, raw),
      input(ctx, raw, input) {
        const d = raw as RhythmData;
        if (input.type === "cancel") return d.args.canFlee || !d.battle ? finish(ctx, d.args, "quit", "演奏をやめた。", d.hp) : {};
        if (input.type !== "frame") return {};
        const next = stepRhythm(ctx, d, input.held);
        const status = rhythmStatus(next);
        if (status === "win") return finish(ctx, d.args, "win", `${d.args.title}をやり遂げた！（正確さ${accuracy(next)}%・最大${next.best}コンボ）`, next.hp);
        if (status === "lose") return finish(ctx, d.args, "lose", next.hp <= 0 ? "リズムに飲まれ、力尽きた……" : `リズムが合わなかった（正確さ${accuracy(next)}% / 必要${d.args.pass}%）`, next.hp);
        return { data: next };
      },
      draw(g, view) {
        const d = view.data as RhythmData;
        const W = view.width, H = view.height;
        g.fillStyle = "#120f1a"; g.fillRect(0, 0, W, H);
        const laneW = Math.min(70, W / 8), left = W / 2 - laneW * 2, lineY = H - 90, speed = (H - 140) / 45;
        const colors = ["#d9745b", "#7fa8d9", "#7fc46b", "#f0c36a"];
        for (let i = 0; i < 4; i++) {
          g.fillStyle = d.held.includes(LANES[i]!) ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.04)";
          g.fillRect(left + i * laneW + 2, 0, laneW - 4, H);
          g.strokeStyle = colors[i]!; g.lineWidth = 3; g.strokeRect(left + i * laneW + 6, lineY - 8, laneW - 12, 16);
        }
        for (const n of d.notes) {
          if (n.hit === "perfect" || n.hit === "good") continue;
          const y = lineY - (n.t - d.frame) * speed;
          if (y < -20 || y > H + 20) continue;
          if (d.args.click && !d.cues.length && !n.hit && n.t <= d.frame && !clicked.has(n.t * 4 + n.lane)) { clicked.add(n.t * 4 + n.lane); click(n.lane); }
          g.fillStyle = n.hit === "miss" ? "#555" : colors[n.lane]!;
          g.fillRect(left + n.lane * laneW + 8, y - 6, laneW - 16, 12);
        }
        g.fillStyle = "#e9dcb8"; g.font = "14px system-ui"; g.textAlign = "left";
        g.fillText(`${d.args.title}　正確さ ${accuracy(d)}%　コンボ ${d.combo}`, 12, 22);
        g.fillText(`HP ${d.hp}/${d.maxHp}`, 12, 44);
        if (d.battle) {
          const enemy = enemyOf({ content: view.content, state: view.state }, d.args.enemyId);
          g.textAlign = "right"; g.fillText(`${enemy?.name ?? "敵"} ${d.enemyHp}/${d.enemyMaxHp}`, W - 12, 22);
          g.fillStyle = "#d9745b"; g.fillRect(W - 172, 30, 160 * (d.enemyHp / Math.max(1, d.enemyMaxHp)), 5);
        }
        g.textAlign = "center"; g.font = "bold 20px system-ui"; g.fillStyle = d.flash === "MISS" ? "#d9745b" : "#f0c36a";
        if (d.flash) g.fillText(d.flash, W / 2, lineY - 60);
        g.font = "12px system-ui"; g.fillStyle = "#a9b09d";
        g.fillText("← ↓ ↑ → で線の上のノーツを叩く　Esc やめる", W / 2, H - 30);
        if (d.frame < 2) clicked.clear();
        playCues(d);
      },
    },
  },
});

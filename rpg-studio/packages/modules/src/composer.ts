/**
 * Genre module: composing / playing music on a step grid. Place one note per step; listen; finish.
 * With `target` it is a challenge (play back the melody a bard hums, a lock that opens to a tune);
 * without it the player composes freely, and the melody can be saved into an RPG set (`saveTo`) for later use
 * (conditions like { "set": "songs", "has": "C4 E4 G4 …" }, or a rule that reacts to the song you wrote).
 */
import { z } from "zod";
import { IdSchema } from "../../schema/src/formats";
import type { Effect } from "../../schema/src/index";
import { defineSystem } from "../../engine/src/index";
import { finish, issues, OutcomeArgs } from "./common";
import { asRecord, backdrop, button, h } from "./ui";

const NOTE = /^([A-G])(#?)([2-6])$/;
export const ComposerArgsSchema = z.object({
  title: z.string().default("作曲"),
  steps: z.number().int().min(4).max(32).default(8),
  /** Notes offered, low to high. */
  notes: z.array(z.string().regex(NOTE, "音名は C4・F#5 のように書きます")).min(2).max(16).default(["C4", "D4", "E4", "G4", "A4", "C5"]),
  bpm: z.number().min(40).max(240).default(120),
  /** Melody to reproduce: one note or "." per step, separated by spaces. Omit for free composing. */
  target: z.string().optional(),
  /** Free composing: add the finished melody (as text) to this set. */
  saveTo: IdSchema.optional(),
  ...OutcomeArgs,
}).strict();
export type ComposerArgs = z.infer<typeof ComposerArgsSchema>;

export interface ComposerData { args: ComposerArgs; grid: number[]; cursor: number; tries: number; message: string }

export const melodyText = (d: ComposerData) => d.grid.map(i => (i < 0 ? "." : d.args.notes[i])).join(" ");
export function checkComposer(a: ComposerArgs): string[] {
  if (!a.target) return [];
  const parts = a.target.trim().split(/\s+/);
  const out: string[] = [];
  if (parts.length !== a.steps) out.push(`target の音の数(${parts.length})を steps(${a.steps}) にそろえてください`);
  parts.forEach((p, i) => { if (p !== "." && !a.notes.includes(p)) out.push(`target の${i + 1}番目 '${p}' は notes にありません`); });
  return out;
}

export function startComposer(raw: Record<string, unknown>): ComposerData {
  const args = ComposerArgsSchema.parse(raw);
  return { args, grid: Array(args.steps).fill(-1), cursor: 0, tries: 0, message: args.target ? "聞いた旋律を、同じように並べよう。" : "自由に旋律を作ろう。" };
}

export function setNote(d: ComposerData, step: number, note: number): ComposerData {
  return { ...d, grid: d.grid.map((v, i) => (i === step ? (v === note ? -1 : note) : v)), cursor: step };
}

let audio: AudioContext | undefined;
export function freq(note: string): number {
  const m = NOTE.exec(note)!;
  const semis = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1] as "C"] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, semis / 12);
}
function play(notes: string[], bpm: number) {
  try {
    audio ??= new AudioContext();
    const start = audio.currentTime + 0.05, len = 60 / bpm / 2;
    notes.forEach((n, i) => {
      if (n === ".") return;
      const o = audio!.createOscillator(), g = audio!.createGain();
      o.type = "triangle"; o.frequency.value = freq(n);
      g.gain.setValueAtTime(0.0001, start + i * len); g.gain.exponentialRampToValueAtTime(0.12, start + i * len + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, start + i * len + len * 0.95);
      o.connect(g).connect(audio!.destination); o.start(start + i * len); o.stop(start + (i + 1) * len);
    });
  } catch { /* no audio */ }
}

export default defineSystem({
  id: "composer",
  scenes: {
    compose: {
      title: "作曲・演奏（音を並べる。課題の旋律を再現／自由に作って保存）",
      checkArgs: args => { const r = ComposerArgsSchema.safeParse(args); return r.success ? checkComposer(r.data) : issues(r); },
      start: (_ctx, raw) => startComposer(raw),
      input(ctx, raw, input) {
        const d = raw as ComposerData;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if (input.type === "cancel" || value.quit) return finish(ctx, d.args, "quit", "楽譜を閉じた。");
        if (input.type === "left" || input.type === "right") return { data: { ...d, cursor: (d.cursor + (input.type === "left" ? -1 : 1) + d.args.steps) % d.args.steps } };
        if (input.type === "up" || input.type === "down") {
          const cur = d.grid[d.cursor]!;
          const nextNote = input.type === "up" ? Math.min(d.args.notes.length - 1, cur + 1) : cur - 1;
          return { data: { ...d, grid: d.grid.map((v, i) => (i === d.cursor ? Math.max(-1, nextNote) : v)) } };
        }
        if (typeof value.step === "number" && typeof value.note === "number") return { data: setNote(d, value.step, value.note) };
        if (value.done || input.type === "confirm") {
          const text = melodyText(d);
          if (d.args.target) {
            if (text === d.args.target.trim().split(/\s+/).join(" ")) return finish(ctx, d.args, "win", `${d.args.title}：旋律がぴたりと合った！`);
            const right = d.args.target.trim().split(/\s+/).filter((n, i) => n === text.split(" ")[i]).length;
            return { data: { ...d, tries: d.tries + 1, message: `${right}/${d.args.steps} の音が合っている。` } };
          }
          if (d.grid.every(v => v < 0)) return { data: { ...d, message: "まだ一つも音がない。" } };
          const save: Effect[] = d.args.saveTo ? [{ type: "addToSet", set: d.args.saveTo, value: text }] : [];
          return { ...finish(ctx, d.args, "win", `${d.args.title}：一曲できた！`), apply: save };
        }
        return {};
      },
      render(host, view) {
        const d = view.data as ComposerData;
        host.innerHTML = "";
        backdrop(host, "#2b2440, #100d18");
        const root = h("div", "position:absolute;inset:3%;display:flex;flex-direction:column;gap:2%");
        root.appendChild(h("div", "color:var(--rpg-accent)", `${d.args.title}　— ${d.message}`));
        const grid = h("div", `flex:1;display:grid;grid-template-columns:3em repeat(${d.args.steps}, 1fr);gap:2px`);
        for (let n = d.args.notes.length - 1; n >= 0; n--) {
          grid.appendChild(h("div", "font-size:.75em;color:var(--rpg-dim);align-self:center", d.args.notes[n]));
          for (let s = 0; s < d.args.steps; s++) {
            const on = d.grid[s] === n;
            const cell = h("button", `all:unset;cursor:pointer;border-radius:3px;background:${on ? "#f0c36a" : s % 4 === 0 ? "#2f2a40" : "#26223a"};outline:${s === d.cursor ? "1px solid rgba(240,195,106,.6)" : "none"}`);
            cell.onclick = () => view.send({ type: "custom", value: { step: s, note: n } });
            grid.appendChild(cell);
          }
        }
        const tools = h("div", "display:flex;gap:.5em;flex-wrap:wrap");
        if (d.args.target) tools.appendChild(button("お手本を聞く", () => play(d.args.target!.trim().split(/\s+/), d.args.bpm)));
        tools.append(button("鳴らす", () => play(melodyText(d).split(" "), d.args.bpm)), button(d.args.target ? "これで合わせる（決定）" : "完成（決定）", () => view.send({ type: "custom", value: { done: true } })), button("やめる", () => view.send({ type: "custom", value: { quit: true } })));
        tools.appendChild(h("span", "font-size:.8em;color:var(--rpg-dim);align-self:center", "←→ 拍を選ぶ　↑↓ 音の高さ　マスをクリックでも置ける"));
        root.append(grid, tools);
        host.appendChild(root);
      },
    },
  },
});

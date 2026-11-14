/**
 * Genre module: push-block puzzle (倉庫番). Levels are text rows, so an AI can design them:
 *   # wall   . goal   $ block   * block on goal   @ player   + player on goal   (space / _) floor
 * { "type": "startScene", "system": "puzzle", "scene": "push", "args": { "title": "動く石板", "rows": ["#####", "#@$.#", "#####"], "onSolve": [...] } }
 */
import { z } from "zod";
import { EffectSchema } from "../../schema/src/formats";
import { defineSystem } from "../../engine/src/index";
import { asRecord, button, h } from "./ui";

export const PushArgsSchema = z.object({
  title: z.string().default("仕掛けを解こう"),
  rows: z.array(z.string().min(1)).min(1),
  /** 0 = unlimited. */
  maxMoves: z.number().int().nonnegative().default(0),
  onSolve: z.array(EffectSchema).default([]),
  onGiveUp: z.array(EffectSchema).default([]),
  hint: z.string().default(""),
}).strict();
type PushArgs = z.infer<typeof PushArgsSchema>;

interface Pos { x: number; y: number }
interface PushData { args: PushArgs; walls: string[]; goals: Pos[]; boxes: Pos[]; player: Pos; moves: number; history: Array<{ player: Pos; boxes: Pos[] }>; message: string }

function parse(rows: string[]): Omit<PushData, "args" | "moves" | "history" | "message"> {
  const goals: Pos[] = [], boxes: Pos[] = [];
  let player: Pos = { x: 0, y: 0 };
  const walls = rows.map((row, y) => Array.from(row).map((ch, x) => {
    if (ch === "." || ch === "*" || ch === "+") goals.push({ x, y });
    if (ch === "$" || ch === "*") boxes.push({ x, y });
    if (ch === "@" || ch === "+") player = { x, y };
    return ch === "#" ? "#" : " ";
  }).join(""));
  return { walls, goals, boxes, player };
}

export function checkPushLevel(rows: string[]): string[] {
  const out: string[] = [];
  const counts = { player: 0, boxes: 0, goals: 0 };
  rows.forEach((row, y) => Array.from(row).forEach((ch, x) => {
    if (!"#.$*@+ _".includes(ch)) out.push(`rows[${y}]: 使えない文字 '${ch}' (x=${x})`);
    if (ch === "@" || ch === "+") counts.player++;
    if (ch === "$" || ch === "*") counts.boxes++;
    if (ch === "." || ch === "*" || ch === "+") counts.goals++;
  }));
  if (counts.player !== 1) out.push(`プレイヤー(@ か +)はちょうど1つ必要です（${counts.player}個）`);
  if (counts.boxes === 0 || counts.boxes !== counts.goals) out.push(`ブロック($ *)の数(${counts.boxes})と目標(. * +)の数(${counts.goals})をそろえてください`);
  return out;
}

const D: Record<string, Pos> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;
const solved = (d: PushData) => d.boxes.every(b => d.goals.some(g => same(b, g)));

export default defineSystem({
  id: "puzzle",
  scenes: {
    push: {
      title: "パズル（ブロック押し・倉庫番）",
      checkArgs: args => { const r = PushArgsSchema.safeParse(args); return r.success ? checkPushLevel(r.data.rows) : r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`); },
      start(_ctx, raw) {
        const args = PushArgsSchema.parse(raw);
        return { args, ...parse(args.rows.map(r => r.replace(/_/g, " "))), moves: 0, history: [], message: args.hint } satisfies PushData;
      },
      input(_ctx, raw, input) {
        const data = raw as PushData;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if (input.type === "cancel" || value.giveUp) return { close: true, effects: [{ type: "message", text: "仕掛けから手を離した。" }, ...data.args.onGiveUp] };
        if (input.type === "confirm" || value.undo) {
          const last = data.history[data.history.length - 1];
          if (!last) return {};
          return { data: { ...data, ...last, moves: data.moves - 1, history: data.history.slice(0, -1), message: "" } };
        }
        if (value.reset) return { data: { ...data, ...parse(data.args.rows.map(r => r.replace(/_/g, " "))), moves: 0, history: [], message: "" } };
        const delta = D[input.type];
        if (!delta) return {};
        const to = { x: data.player.x + delta.x, y: data.player.y + delta.y };
        if (data.walls[to.y]?.[to.x] !== " ") return {};
        const boxIndex = data.boxes.findIndex(b => same(b, to));
        let boxes = data.boxes;
        if (boxIndex >= 0) {
          const beyond = { x: to.x + delta.x, y: to.y + delta.y };
          if (data.walls[beyond.y]?.[beyond.x] !== " " || data.boxes.some(b => same(b, beyond))) return {};
          boxes = data.boxes.map((b, i) => (i === boxIndex ? beyond : b));
        }
        const next: PushData = { ...data, player: to, boxes, moves: data.moves + 1, history: [...data.history, { player: data.player, boxes: data.boxes }].slice(-200), message: "" };
        if (solved(next)) return { close: true, log: [`パズル解決（${next.moves}手）`], effects: data.args.onSolve };
        if (data.args.maxMoves && next.moves >= data.args.maxMoves) return { data: { ...next, message: `手数の上限(${data.args.maxMoves})です。戻すかやり直してください。` } };
        return { data: next };
      },
      render(host, view) {
        const data = view.data as PushData;
        host.innerHTML = "";
        const w = Math.max(...data.walls.map(r => r.length)), hgt = data.walls.length;
        const wrap = h("div", "position:absolute;inset:4% 8%;display:flex;flex-direction:column;align-items:center;gap:.5em;padding:.8em", undefined, "rpg-window");
        wrap.append(h("div", "color:var(--rpg-accent)", data.args.title), h("div", "font-size:.75em;color:var(--rpg-dim)", `手数 ${data.moves}${data.args.maxMoves ? ` / ${data.args.maxMoves}` : ""}　←↑↓→ 押す　決定 一手戻す　キャンセル やめる`));
        const grid = h("div", `display:grid;grid-template-columns:repeat(${w}, 1fr);width:min(100%, ${w * 2.4}em);aspect-ratio:${w}/${hgt};gap:2px`);
        for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
          const p = { x, y };
          const wall = data.walls[y]?.[x] !== " ";
          const goal = data.goals.some(g => same(g, p));
          const box = data.boxes.some(b => same(b, p));
          const me = same(data.player, p);
          const cell = h("div", `border-radius:3px;display:grid;place-items:center;font-size:1.1em;background:${wall ? "#4b5048" : goal ? "rgba(240,195,106,.25)" : "rgba(0,0,0,.35)"};${wall ? "box-shadow:inset 0 -3px 0 rgba(0,0,0,.35)" : ""}`);
          cell.textContent = me ? "◆" : box ? (goal ? "▣" : "■") : goal ? "◇" : "";
          if (me) cell.style.color = "var(--rpg-accent)";
          if (box) cell.style.color = goal ? "#9fd28c" : "#c9b994";
          grid.appendChild(cell);
        }
        wrap.appendChild(grid);
        if (data.message) wrap.appendChild(h("div", "font-size:.8em", data.message));
        const tools = h("div", "display:flex;gap:.4em;flex-wrap:wrap;justify-content:center");
        for (const [label, input] of [["↑", "up"], ["←", "left"], ["↓", "down"], ["→", "right"]] as const) tools.appendChild(button(label, () => view.send({ type: input })));
        tools.append(button("一手戻す", () => view.send({ type: "custom", value: { undo: true } })), button("最初から", () => view.send({ type: "custom", value: { reset: true } })), button("やめる", () => view.send({ type: "custom", value: { giveUp: true } })));
        wrap.appendChild(tools);
        host.appendChild(wrap);
      },
    },
  },
});

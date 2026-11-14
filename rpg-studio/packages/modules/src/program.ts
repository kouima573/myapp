/**
 * Genre module: programming puzzle. Build a short list of commands for a golem / familiar / cart, run it,
 * and see where it goes. Reach G (and pick up every *). Teaches sequencing, loops and economy of commands.
 *   # wall   . floor   @ start   G goal   * gem
 * Commands: F forward, L turn left, R turn right, J jump over one tile, ×2 repeat the previous command,
 * ↺ repeat everything before it once more (a loop).
 */
import { z } from "zod";
import { defineSystem } from "../../engine/src/index";
import { finish, issues, OutcomeArgs } from "./common";
import { asRecord, backdrop, button, h } from "./ui";

export const COMMANDS = ["F", "L", "R", "J", "x2", "loop"] as const;
type Command = (typeof COMMANDS)[number];
const LABEL: Record<Command, string> = { F: "進む", L: "左を向く", R: "右を向く", J: "跳ぶ", x2: "×2", loop: "↺ 最初からもう一度" };

export const ProgramArgsSchema = z.object({
  title: z.string().default("命令を組む"),
  rows: z.array(z.string().min(1)).min(2),
  facing: z.enum(["up", "right", "down", "left"]).default("right"),
  commands: z.array(z.enum(COMMANDS)).min(1).default(["F", "L", "R", "x2"]),
  /** Longest program allowed. */
  maxLength: z.number().int().min(1).max(40).default(10),
  /** Runs allowed (0 = unlimited). */
  maxRuns: z.number().int().min(0).max(99).default(0),
  ...OutcomeArgs,
}).strict();
export type ProgramArgs = z.infer<typeof ProgramArgsSchema>;

export interface ProgramData { args: ProgramArgs; program: Command[]; runs: number; trace: Array<{ x: number; y: number }>; result: string; ok: boolean }

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const FACING = { up: 0, right: 1, down: 2, left: 3 };

export function checkProgram(a: ProgramArgs): string[] {
  const all = a.rows.join("");
  const out: string[] = [];
  a.rows.forEach((row, y) => Array.from(row).forEach((ch, x) => { if (!"#.@G* ".includes(ch)) out.push(`rows[${y}]: 使えない文字 '${ch}' (x=${x})`); }));
  if ((all.match(/@/g) ?? []).length !== 1) out.push("開始位置 @ はちょうど1つ必要です");
  if (!all.includes("G")) out.push("ゴール G が必要です");
  return out;
}

/** Expand ×2 and loops, then walk. Pure: returns the path and whether the goal was met. */
export function runProgram(args: ProgramArgs, program: Command[]): { trace: Array<{ x: number; y: number }>; ok: boolean; result: string } {
  const flat: Command[] = [];
  for (const c of program) {
    if (c === "x2") { const prev = flat[flat.length - 1]; if (prev) flat.push(prev); }
    else if (c === "loop") flat.push(...flat.slice());
    else flat.push(c);
  }
  let pos = { x: 0, y: 0 }, dir = FACING[args.facing];
  const gems = new Set<string>();
  args.rows.forEach((r, y) => Array.from(r).forEach((ch, x) => { if (ch === "@") pos = { x, y }; if (ch === "*") gems.add(`${x},${y}`); }));
  const at = (x: number, y: number) => args.rows[y]?.[x] ?? "#";
  const trace = [{ ...pos }];
  for (const c of flat.slice(0, 200)) {
    if (c === "L") dir = (dir + 3) % 4;
    else if (c === "R") dir = (dir + 1) % 4;
    else {
      const [dx, dy] = DIRS[dir]!;
      const steps = c === "J" ? 2 : 1;
      const to = { x: pos.x + dx * steps, y: pos.y + dy * steps };
      if (at(to.x, to.y) === "#" || at(to.x, to.y) === " ") return { trace, ok: false, result: c === "J" ? "跳んだ先が壁だった" : "壁にぶつかった" };
      pos = to; trace.push({ ...pos });
      gems.delete(`${pos.x},${pos.y}`);
    }
  }
  const atGoal = at(pos.x, pos.y) === "G";
  if (atGoal && !gems.size) return { trace, ok: true, result: "成功！" };
  return { trace, ok: false, result: atGoal ? `宝石が${gems.size}個残っている` : "ゴールに届かなかった" };
}

export default defineSystem({
  id: "program",
  scenes: {
    run: {
      title: "プログラミング（命令を並べて動かす）",
      checkArgs: args => { const r = ProgramArgsSchema.safeParse(args); return r.success ? checkProgram(r.data) : issues(r); },
      start(_ctx, raw) { const args = ProgramArgsSchema.parse(raw); return { args, program: [], runs: 0, trace: [], result: "", ok: false } satisfies ProgramData; },
      input(ctx, raw, input) {
        const d = raw as ProgramData;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if (input.type === "cancel" || value.quit) return finish(ctx, d.args, "quit", "命令書を閉じた。");
        if (typeof value.add === "string" && (d.args.commands as string[]).includes(value.add)) {
          if (d.program.length >= d.args.maxLength) return { data: { ...d, result: `命令は${d.args.maxLength}個まで` } };
          return { data: { ...d, program: [...d.program, value.add as Command], trace: [], result: "" } };
        }
        if (value.back || input.type === "left") return { data: { ...d, program: d.program.slice(0, -1), trace: [], result: "" } };
        if (value.clear) return { data: { ...d, program: [], trace: [], result: "" } };
        if (value.run || input.type === "confirm") {
          const r = runProgram(d.args, d.program);
          const next = { ...d, runs: d.runs + 1, ...r };
          if (r.ok) return finish(ctx, d.args, "win", `${d.args.title}：${d.program.length}個の命令で成功！`);
          if (d.args.maxRuns && next.runs >= d.args.maxRuns) return finish(ctx, d.args, "lose", "試せる回数が尽きた……");
          return { data: next };
        }
        return {};
      },
      render(host, view) {
        const d = view.data as ProgramData;
        host.innerHTML = "";
        backdrop(host, "#23302f, #0d1312");
        const w = Math.max(...d.args.rows.map(r => r.length)), hgt = d.args.rows.length;
        const root = h("div", "position:absolute;inset:3%;display:grid;grid-template-columns:1fr 16em;gap:2%");
        const board = h("div", `display:grid;grid-template-columns:repeat(${w},1fr);gap:2px;aspect-ratio:${w}/${hgt};max-height:100%;align-self:center`);
        for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
          const ch = d.args.rows[y]![x] ?? " ";
          const step = d.trace.findIndex(p => p.x === x && p.y === y);
          const cell = h("div", `display:grid;place-items:center;font-size:.8em;border-radius:3px;background:${ch === "#" || ch === " " ? "#3c4a48" : ch === "G" ? "#5c6b35" : "#1f2a29"};color:#e9dcb8`, ch === "@" ? "◆" : ch === "*" ? "✦" : ch === "G" ? "G" : step > 0 ? String(step) : "");
          if (step > 0) cell.style.boxShadow = "inset 0 0 0 999px rgba(240,195,106,.25)";
          board.appendChild(cell);
        }
        const side = h("div", "padding:.7em;display:flex;flex-direction:column;gap:.4em;font-size:.8em;overflow:auto", undefined, "rpg-window");
        side.append(h("div", "color:var(--rpg-accent)", d.args.title), h("div", "color:var(--rpg-dim)", `向き: ${{ up: "上", right: "右", down: "下", left: "左" }[d.args.facing]}　命令 ${d.program.length}/${d.args.maxLength}${d.args.maxRuns ? `　試行 ${d.runs}/${d.args.maxRuns}` : ""}`));
        side.appendChild(h("div", "min-height:3em;padding:.4em;background:#0e1414;border-radius:4px", d.program.map(c => LABEL[c]).join(" → ") || "（命令を追加）"));
        const palette = h("div", "display:flex;flex-wrap:wrap;gap:.3em");
        for (const c of d.args.commands) palette.appendChild(button(LABEL[c], () => view.send({ type: "custom", value: { add: c } })));
        side.appendChild(palette);
        if (d.result) side.appendChild(h("div", `color:${d.ok ? "#9fd28c" : "#ff8a5c"}`, d.result));
        side.append(button("実行（決定）", () => view.send({ type: "custom", value: { run: true } })), button("一つ消す（←）", () => view.send({ type: "custom", value: { back: true } })), button("全部消す", () => view.send({ type: "custom", value: { clear: true } })), button("やめる", () => view.send({ type: "custom", value: { quit: true } })));
        root.append(board, side);
        host.appendChild(root);
      },
    },
  },
});

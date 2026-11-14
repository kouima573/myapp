/**
 * Genre module: pen-and-paper logic puzzles.
 *   kind "picture": fill cells to match the row / column number clues (お絵かきロジック). `solution` rows use # and .
 *   kind "lights":  pressing a cell flips it and its neighbours; turn every light off. `start` rows use 1 and 0.
 *   kind "numbers": fill 1..n so no row / column (/ box) repeats (数字の配置パズル). `givens` rows use digits and .
 * Clues are computed from the data, so an AI only writes the picture / grid. Solutions are checked by pure functions.
 */
import { z } from "zod";
import { defineSystem } from "../../engine/src/index";
import { finish, issues, OutcomeArgs } from "./common";
import { asRecord, backdrop, button, h } from "./ui";

export const LogicArgsSchema = z.object({
  title: z.string().default("ロジックパズル"),
  kind: z.enum(["picture", "lights", "numbers"]),
  solution: z.array(z.string().regex(/^[#.]+$/)).default([]),
  start: z.array(z.string().regex(/^[01]+$/)).default([]),
  givens: z.array(z.string().regex(/^[1-9.]+$/)).default([]),
  /** numbers: box size (e.g. 2×3 for a 6×6 grid). Omit for rows / columns only. */
  box: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
  /** Mistakes allowed for picture (0 = unlimited, no checking until full). */
  mistakes: z.number().int().min(0).max(99).default(0),
  ...OutcomeArgs,
}).strict();
export type LogicArgs = z.infer<typeof LogicArgsSchema>;

export interface LogicData { args: LogicArgs; grid: number[][]; fixed: boolean[][]; cursor: { x: number; y: number }; moves: number; misses: number; mark: boolean }

export const runs = (cells: boolean[]) => { const out: number[] = []; let n = 0; for (const c of cells) { if (c) n++; else if (n) { out.push(n); n = 0; } } if (n) out.push(n); return out.length ? out : [0]; };
export function pictureClues(solution: string[]) {
  const w = solution[0]!.length;
  return { rows: solution.map(r => runs(Array.from(r).map(c => c === "#"))), cols: Array.from({ length: w }, (_, x) => runs(solution.map(r => r[x] === "#"))) };
}

export function checkLogic(a: LogicArgs): string[] {
  const grid = a.kind === "picture" ? a.solution : a.kind === "lights" ? a.start : a.givens;
  if (!grid.length) return [`kind が ${a.kind} のときは ${a.kind === "picture" ? "solution" : a.kind === "lights" ? "start" : "givens"} が必要です`];
  if (grid.some(r => r.length !== grid[0]!.length)) return ["すべての行を同じ長さにしてください"];
  if (a.kind === "numbers") {
    const n = grid.length;
    if (grid[0]!.length !== n || n > 9) return ["numbers は n×n（9以下）にしてください"];
    if (a.box && a.box[0] * a.box[1] !== n) return [`box(${a.box.join("×")}) の面積が ${n} ではありません`];
    if (grid.some(r => Array.from(r).some(c => c !== "." && Number(c) > n))) return [`数字は 1〜${n} にしてください`];
    if (!numbersOk(grid.map(r => Array.from(r).map(c => (c === "." ? 0 : Number(c)))), a.box)) return ["最初から同じ数字が重なっています"];
  }
  if (a.kind === "lights" && grid.every(r => !r.includes("1"))) return ["最初から全部消えています"];
  return [];
}

/** numbers: no repeats among filled cells (rows, columns, boxes). */
export function numbersOk(g: number[][], box?: [number, number]): boolean {
  const n = g.length;
  const unique = (vals: number[]) => { const f = vals.filter(v => v > 0); return new Set(f).size === f.length; };
  for (let i = 0; i < n; i++) if (!unique(g[i]!) || !unique(g.map(r => r[i]!))) return false;
  if (box) for (let by = 0; by < n; by += box[1]) for (let bx = 0; bx < n; bx += box[0]) { const vals: number[] = []; for (let y = by; y < by + box[1]; y++) for (let x = bx; x < bx + box[0]; x++) vals.push(g[y]![x]!); if (!unique(vals)) return false; }
  return true;
}

export function logicSolved(d: LogicData): boolean {
  const a = d.args;
  if (a.kind === "picture") { const c = pictureClues(a.solution); const now = pictureClues(d.grid.map(r => r.map(v => (v === 1 ? "#" : ".")).join(""))); return JSON.stringify(c) === JSON.stringify(now); }
  if (a.kind === "lights") return d.grid.every(r => r.every(v => v === 0));
  return d.grid.every(r => r.every(v => v > 0)) && numbersOk(d.grid, a.box);
}

export function startLogic(raw: Record<string, unknown>): LogicData {
  const args = LogicArgsSchema.parse(raw);
  const src = args.kind === "picture" ? args.solution.map(r => r.replace(/./g, ".")) : args.kind === "lights" ? args.start : args.givens;
  const grid = src.map(r => Array.from(r).map(c => (args.kind === "lights" ? Number(c) : c === "." ? 0 : Number(c))));
  return { args, grid, fixed: src.map(r => Array.from(r).map(c => args.kind === "numbers" && c !== ".")), cursor: { x: 0, y: 0 }, moves: 0, misses: 0, mark: false };
}

/** Act on a cell: picture toggles fill (or the ✕ mark), lights flips the cross, numbers cycles 1..n. */
export function logicPress(d: LogicData, x: number, y: number, mark = false): LogicData {
  if (d.fixed[y]?.[x] || d.grid[y]?.[x] === undefined) return d;
  const grid = d.grid.map(r => [...r]);
  let misses = d.misses;
  if (d.args.kind === "picture") {
    const v = grid[y]![x]!;
    grid[y]![x] = mark ? (v === 2 ? 0 : 2) : v === 1 ? 0 : 1;
    if (d.args.mistakes && grid[y]![x] === 1 && d.args.solution[y]![x] !== "#") { misses++; grid[y]![x] = 2; }
  } else if (d.args.kind === "lights") {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (grid[y + dy]?.[x + dx] !== undefined) grid[y + dy]![x + dx] = 1 - grid[y + dy]![x + dx]!;
  } else grid[y]![x] = (grid[y]![x]! + 1) % (grid.length + 1);
  return { ...d, grid, misses, moves: d.moves + 1, cursor: { x, y } };
}

export default defineSystem({
  id: "logic",
  scenes: {
    solve: {
      title: "ロジックパズル（お絵かきロジック・ライツアウト・数字の配置）",
      checkArgs: args => { const r = LogicArgsSchema.safeParse(args); return r.success ? checkLogic(r.data) : issues(r); },
      start: (_ctx, raw) => startLogic(raw),
      input(ctx, raw, input) {
        const d = raw as LogicData;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if (input.type === "cancel" || value.quit) return finish(ctx, d.args, "quit", "パズルから手を離した。");
        if (value.toggleMark) return { data: { ...d, mark: !d.mark } };
        const move = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[input.type as "up"];
        if (move) { const n = d.grid.length, w = d.grid[0]!.length; return { data: { ...d, cursor: { x: (d.cursor.x + move[0]! + w) % w, y: (d.cursor.y + move[1]! + n) % n } } }; }
        let next: LogicData;
        if (typeof value.x === "number" && typeof value.y === "number") next = logicPress(d, value.x, value.y, d.mark);
        else if (input.type === "confirm") next = logicPress(d, d.cursor.x, d.cursor.y, d.mark);
        else return {};
        if (logicSolved(next)) return finish(ctx, d.args, "win", `${d.args.title}を解いた！（${next.moves}手）`);
        if (d.args.mistakes && next.misses >= d.args.mistakes) return finish(ctx, d.args, "lose", "間違いが多すぎた……");
        return { data: next };
      },
      render(host, view) {
        const d = view.data as LogicData;
        host.innerHTML = "";
        backdrop(host);
        const n = d.grid.length, w = d.grid[0]!.length;
        const clues = d.args.kind === "picture" ? pictureClues(d.args.solution) : null;
        const wrap = h("div", "position:absolute;inset:3%;display:grid;grid-template-columns:1fr 13em;gap:2%");
        const board = h("div", `display:grid;grid-template-columns:${clues ? "auto " : ""}repeat(${w}, 1fr);gap:2px;align-self:center;justify-self:center;width:min(100%, ${(w + (clues ? 2 : 0)) * 2.6}em)`);
        if (clues) { board.appendChild(h("div")); clues.cols.forEach(c => board.appendChild(h("div", "font-size:.7em;text-align:center;color:var(--rpg-accent);white-space:pre;line-height:1.1;align-self:end", c.join("\n")))); }
        d.grid.forEach((row, y) => {
          if (clues) board.appendChild(h("div", "font-size:.7em;color:var(--rpg-accent);align-self:center;padding-right:.3em;text-align:right", clues.rows[y]!.join(" ")));
          row.forEach((v, x) => {
            const on = d.cursor.x === x && d.cursor.y === y;
            const boxEdge = d.args.box ? `${x % d.args.box[0] === 0 ? "border-left:2px solid #e9dcb8;" : ""}${y % d.args.box[1] === 0 ? "border-top:2px solid #e9dcb8;" : ""}` : "";
            const bg = d.args.kind === "lights" ? (v ? "#f0c36a" : "#2a2633") : d.args.kind === "picture" ? (v === 1 ? "#e9dcb8" : "#2a2633") : "#2a2633";
            const text = d.args.kind === "numbers" ? (v ? String(v) : "") : d.args.kind === "picture" && v === 2 ? "✕" : "";
            const cell = h("button", `all:unset;cursor:pointer;aspect-ratio:1;display:grid;place-items:center;font-weight:${d.fixed[y]![x] ? 800 : 400};color:${d.fixed[y]![x] ? "var(--rpg-accent)" : "#e9dcb8"};background:${bg};${boxEdge}outline:${on ? "2px solid var(--rpg-accent)" : "none"};outline-offset:-2px`, text);
            cell.onclick = () => view.send({ type: "custom", value: { x, y } });
            board.appendChild(cell);
          });
        });
        const side = h("div", "padding:.8em;display:flex;flex-direction:column;gap:.4em;font-size:.82em", undefined, "rpg-window");
        side.append(h("div", "color:var(--rpg-accent)", d.args.title), h("div", "color:var(--rpg-dim)", {
          picture: "数字は、その列・行で続けて塗るマスの数。決定で塗る。",
          lights: "押したマスと上下左右が反転する。全部消そう。",
          numbers: `1〜${n} を、行・列${d.args.box ? "・太枠" : ""}で重ならないように。決定で数字を変える。`,
        }[d.args.kind]), h("div", "", `手数 ${d.moves}${d.args.mistakes ? `　ミス ${d.misses}/${d.args.mistakes}` : ""}`));
        if (d.args.kind === "picture") side.appendChild(button(d.mark ? "✕印モード（クリックで戻す）" : "塗るモード（クリックで✕印）", () => view.send({ type: "custom", value: { toggleMark: true } })));
        side.appendChild(button("やめる", () => view.send({ type: "custom", value: { quit: true } })));
        wrap.append(board, side);
        host.appendChild(wrap);
      },
    },
  },
});

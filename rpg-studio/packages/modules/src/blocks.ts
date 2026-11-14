/**
 * Genre module: falling blocks (realtime). Small coloured pieces fall; move, rotate and drop them.
 * clear "rows": full rows vanish. clear "groups": 4+ touching cells of one colour vanish, and what is left falls (chains).
 * Pieces are data (cell lists), so a project can use its own shapes. Battle mode: clears hit the enemy,
 * the enemy pushes up junk rows.
 */
import { z } from "zod";
import { defineSystem, type SystemContext } from "../../engine/src/index";
import { enemyOf, finish, heroOf, inBattle, issues, OutcomeArgs, pressed } from "./common";
import { nextRand } from "./ui";

const FPS = 30;
type Cell = [number, number];
const DEFAULT_PIECES: Cell[][] = [[[0, 0], [1, 0]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [1, 0], [0, 1]], [[0, 0], [0, 1]]];
const COLORS = ["#d9745b", "#7fa8d9", "#7fc46b", "#f0c36a", "#c08ad9", "#e48fb0"];

export const BlocksArgsSchema = z.object({
  title: z.string().default("落ちもの"),
  width: z.number().int().min(4).max(12).default(7),
  height: z.number().int().min(6).max(20).default(13),
  pieces: z.array(z.array(z.tuple([z.number().int().min(0).max(3), z.number().int().min(0).max(3)])).min(1).max(5)).min(1).default(DEFAULT_PIECES),
  colors: z.number().int().min(2).max(6).default(4),
  clear: z.enum(["rows", "groups"]).default("groups"),
  /** Frames per row of falling at the start (gets faster). */
  speed: z.number().int().min(2).max(120).default(22),
  /** Field: cells (groups) or rows to clear. */
  target: z.number().int().min(1).max(9999).default(24),
  seconds: z.number().min(0).max(3600).default(0),
  /** Battle: seconds between junk rows. */
  junkEvery: z.number().min(2).max(120).default(12),
  hpScale: z.number().min(0.1).max(50).default(2),
  ...OutcomeArgs,
}).strict();
export type BlocksArgs = z.infer<typeof BlocksArgsSchema>;

export interface BlocksData {
  args: BlocksArgs; frame: number; seed: number; grid: number[][]; piece: { cells: Cell[]; colors: number[]; x: number; y: number } | null; next: { shape: number; colors: number[] };
  fallAt: number; cleared: number; chain: number; held: string[]; repeatAt: number; over: boolean;
  hp: number; maxHp: number; attack: number; enemyHp: number; enemyMaxHp: number; battle: boolean; message: string;
}

function rnd(d: { seed: number }, n: number) { let r: number; [r, d.seed] = nextRand(d.seed); return Math.floor(r * n); }
function makeNext(d: BlocksData) { const shape = rnd(d, d.args.pieces.length); return { shape, colors: d.args.pieces[shape]!.map(() => rnd(d, d.args.colors)) }; }
const fits = (d: BlocksData, cells: Cell[], x: number, y: number) => cells.every(([cx, cy]) => { const gx = x + cx, gy = y + cy; return gx >= 0 && gx < d.args.width && gy < d.args.height && (gy < 0 || d.grid[gy]![gx]! < 0); });

function spawn(d: BlocksData): void {
  const n = d.next;
  const cells = d.args.pieces[n.shape]!.map(c => [...c] as Cell);
  d.piece = { cells, colors: n.colors, x: Math.floor((d.args.width - 2) / 2), y: 0 };
  d.next = makeNext(d);
  if (!fits(d, cells, d.piece.x, 0)) d.over = true;
}

export function startBlocks(ctx: SystemContext, raw: Record<string, unknown>): BlocksData {
  const args = BlocksArgsSchema.parse(raw);
  const hero = heroOf(ctx);
  const enemy = enemyOf(ctx, args.enemyId);
  const enemyMaxHp = enemy ? Math.max(1, Math.round(enemy.stats.maxHp * args.hpScale)) : 0;
  const d: BlocksData = { args, frame: 0, seed: ctx.state.rng || 1, grid: Array.from({ length: args.height }, () => Array(args.width).fill(-1)), piece: null, next: { shape: 0, colors: [] }, fallAt: args.speed, cleared: 0, chain: 0, held: [], repeatAt: 0, over: false, hp: hero.hp, maxHp: hero.maxHp, attack: hero.attack, enemyHp: enemyMaxHp, enemyMaxHp, battle: inBattle(ctx), message: "" };
  d.next = makeNext(d);
  spawn(d);
  return d;
}

/** Removes what the rule clears; returns how many cells / rows went. Applies gravity for "groups". */
export function resolveClears(d: BlocksData): number {
  let total = 0;
  for (let chain = 1; chain < 20; chain++) {
    let removed = 0;
    if (d.args.clear === "rows") {
      const keep = d.grid.filter(r => r.some(c => c < 0));
      removed = d.args.height - keep.length;
      d.grid = [...Array.from({ length: removed }, () => Array(d.args.width).fill(-1)), ...keep];
    } else {
      const seen = new Set<string>();
      for (let y = 0; y < d.args.height; y++) for (let x = 0; x < d.args.width; x++) {
        const c = d.grid[y]![x]!;
        if (c < 0 || seen.has(`${x},${y}`)) continue;
        const group: Cell[] = [], stack: Cell[] = [[x, y]];
        seen.add(`${x},${y}`);
        while (stack.length) {
          const [px, py] = stack.pop()!; group.push([px, py]);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const nx = px + dx, ny = py + dy; if (d.grid[ny]?.[nx] === c && !seen.has(`${nx},${ny}`)) { seen.add(`${nx},${ny}`); stack.push([nx, ny]); } }
        }
        if (group.length >= 4) { for (const [gx, gy] of group) d.grid[gy]![gx] = -1; removed += group.length; }
      }
      if (removed) for (let x = 0; x < d.args.width; x++) { const col = d.grid.map(r => r[x]!).filter(c => c >= 0); for (let y = 0; y < d.args.height; y++) d.grid[y]![x] = y >= d.args.height - col.length ? col[y - (d.args.height - col.length)]! : -1; }
    }
    if (!removed) break;
    total += removed * chain;
    d.chain = chain;
    if (d.args.clear === "rows") break;
  }
  return total;
}

function lock(d: BlocksData): void {
  const p = d.piece!;
  p.cells.forEach(([cx, cy], i) => { const gy = p.y + cy; if (gy >= 0) d.grid[gy]![p.x + cx] = p.colors[i]!; else d.over = true; });
  if (d.args.clear === "groups") for (let x = 0; x < d.args.width; x++) { const col = d.grid.map(r => r[x]!).filter(c => c >= 0); for (let y = 0; y < d.args.height; y++) d.grid[y]![x] = y >= d.args.height - col.length ? col[y - (d.args.height - col.length)]! : -1; }
  const got = resolveClears(d);
  if (got) {
    d.cleared += got;
    d.message = d.chain > 1 ? `${d.chain}連鎖！` : `${got}消し`;
    if (d.battle) d.enemyHp = Math.max(0, d.enemyHp - Math.max(1, Math.round(got * d.attack / 4)));
  }
  d.piece = null;
  if (!d.over) spawn(d);
}

export function stepBlocks(data: BlocksData, held: string[]): BlocksData {
  const d: BlocksData = structuredClone(data);
  d.frame++; d.held = held;
  const now = pressed(held, data.held);
  const p = d.piece;
  if (p) {
    const repeat = (b: string) => now.includes(b) || (held.includes(b) && d.frame >= d.repeatAt);
    if (now.some(b => b === "left" || b === "right")) d.repeatAt = d.frame + 7;
    for (const [b, dx] of [["left", -1], ["right", 1]] as const) if (repeat(b) && fits(d, p.cells, p.x + dx, p.y)) { p.x += dx; if (!now.includes(b)) d.repeatAt = d.frame + 2; }
    if (now.includes("up")) {
      const rotated = p.cells.map(([x, y]) => [-y, x] as Cell);
      const minX = Math.min(...rotated.map(c => c[0])), minY = Math.min(...rotated.map(c => c[1]));
      const norm = rotated.map(([x, y]) => [x - minX, y - minY] as Cell);
      for (const kick of [0, -1, 1]) if (fits(d, norm, p.x + kick, p.y)) { p.cells = norm; p.x += kick; break; }
    }
    if (now.includes("fire")) { while (fits(d, p.cells, p.x, p.y + 1)) p.y++; lock(d); }
    else {
      const interval = Math.max(2, Math.round(d.args.speed * Math.pow(0.97, Math.floor(d.cleared / 8))));
      if (held.includes("down") || d.frame >= d.fallAt) {
        d.fallAt = d.frame + interval;
        if (fits(d, p.cells, p.x, p.y + 1)) p.y++; else lock(d);
      }
    }
  }
  if (d.battle && d.frame % Math.round(d.args.junkEvery * FPS) === 0) {
    const gap = rnd(d, d.args.width);
    d.grid = [...d.grid.slice(1), Array.from({ length: d.args.width }, (_, x) => (x === gap ? -1 : rnd(d, d.args.colors)))];
    if (d.grid[0]!.some(c => c >= 0)) d.over = true;
    d.message = "敵がブロックを押し上げてきた！";
  }
  return d;
}

export function blocksStatus(d: BlocksData): "playing" | "win" | "lose" {
  if (d.battle) return d.enemyHp <= 0 ? "win" : d.over ? "lose" : "playing";
  if (d.cleared >= d.args.target) return "win";
  if (d.over || (d.args.seconds && d.frame >= d.args.seconds * FPS)) return "lose";
  return "playing";
}

export default defineSystem({
  id: "blocks",
  scenes: {
    drop: {
      title: "落ちもの（色をそろえる／列をそろえる）",
      realtime: { fps: FPS },
      checkArgs: args => issues(BlocksArgsSchema.safeParse(args)),
      start: (ctx, raw) => startBlocks(ctx, raw),
      input(ctx, raw, input) {
        const d = raw as BlocksData;
        if (input.type === "cancel") return d.args.canFlee || !d.battle ? finish(ctx, d.args, "quit", "手を止めた。") : {};
        if (input.type !== "frame") return {};
        const next = stepBlocks(d, input.held);
        const status = blocksStatus(next);
        if (status === "win") return finish(ctx, d.args, "win", `${d.args.title}：${next.cleared}消し、見事だ！`);
        if (status === "lose") return finish(ctx, d.args, "lose", next.over ? "積み上がってしまった……" : `時間切れ（${next.cleared}/${d.args.target}）`, d.battle ? Math.max(1, d.hp - Math.ceil(d.maxHp / 3)) : undefined);
        return { data: next };
      },
      draw(g, view) {
        const d = view.data as BlocksData;
        const cell = Math.floor(Math.min((view.height - 40) / d.args.height, (view.width * 0.5) / d.args.width));
        const ox = Math.floor(view.width / 2 - (cell * d.args.width) / 2), oy = 20;
        g.fillStyle = "#120f1a"; g.fillRect(0, 0, view.width, view.height);
        g.fillStyle = "#1e1a28"; g.fillRect(ox, oy, cell * d.args.width, cell * d.args.height);
        const paint = (x: number, y: number, c: number, ghost = false) => {
          if (y < 0) return;
          g.fillStyle = COLORS[c % COLORS.length]!; g.globalAlpha = ghost ? 0.25 : 1;
          g.fillRect(ox + x * cell + 1, oy + y * cell + 1, cell - 2, cell - 2);
          g.fillStyle = "rgba(255,255,255,.25)"; g.fillRect(ox + x * cell + 2, oy + y * cell + 2, cell - 4, 3);
          g.globalAlpha = 1;
        };
        d.grid.forEach((row, y) => row.forEach((c, x) => { if (c >= 0) paint(x, y, c); }));
        if (d.piece) {
          let gy = d.piece.y; while (fits(d, d.piece.cells, d.piece.x, gy + 1)) gy++;
          d.piece.cells.forEach(([cx, cy], i) => { paint(d.piece!.x + cx, gy + cy, d.piece!.colors[i]!, true); paint(d.piece!.x + cx, d.piece!.y + cy, d.piece!.colors[i]!); });
        }
        g.fillStyle = "#e9dcb8"; g.font = "14px system-ui"; g.textAlign = "left";
        const right = ox + cell * d.args.width + 20;
        g.fillText(d.args.title, right, 40);
        g.fillText(d.battle ? `${enemyOf({ content: view.content, state: view.state }, d.args.enemyId)?.name ?? "敵"} ${d.enemyHp}/${d.enemyMaxHp}` : `消した数 ${d.cleared}/${d.args.target}`, right, 64);
        if (d.args.seconds && !d.battle) g.fillText(`残り ${Math.max(0, Math.ceil(d.args.seconds - d.frame / FPS))}秒`, right, 88);
        g.fillText(d.message, right, 112);
        g.fillText("つぎ:", right, 140);
        d.args.pieces[d.next.shape]!.forEach(([x, y], i) => { g.fillStyle = COLORS[d.next.colors[i]! % COLORS.length]!; g.fillRect(right + 40 + x * 14, 128 + y * 14, 12, 12); });
        g.fillStyle = "#a9b09d"; g.font = "12px system-ui";
        g.fillText(d.args.clear === "groups" ? "同じ色を4つ以上つなげて消す" : "横一列をそろえて消す", 12, view.height - 34);
        g.fillText("←→ 移動　↑ 回転　↓ 速く落とす　Z 一気に落とす　Esc やめる", 12, view.height - 14);
      },
    },
  },
});

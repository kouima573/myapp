/**
 * Genre module: physics shots (realtime). Aim, choose the power, shoot; the ball bounces with simple physics.
 *   view "side": gravity — knock down targets (artillery / slingshot puzzles, basketball-like throws)
 *   view "top":  rolling friction — golf, billiards-like, curling, mini-golf; sink the ball in O or hit the targets
 * Map rows: # wall   o ball start   * target   O hole   ~ water (ball returns, +1 shot)
 * players: 2 = hot-seat: each player plays the course in turn, fewer shots wins (local multiplayer).
 */
import { z } from "zod";
import { defineSystem } from "../../engine/src/index";
import { finish, issues, OutcomeArgs, pressed } from "./common";
import { asRecord } from "./ui";

const FPS = 30, T = 16;

export const PhysicsArgsSchema = z.object({
  title: z.string().default("一投"),
  view: z.enum(["side", "top"]).default("top"),
  rows: z.array(z.string().min(1)).min(2),
  goal: z.enum(["targets", "hole"]).default("hole"),
  /** Shots allowed (par + spare). */
  shots: z.number().int().min(1).max(99).default(5),
  gravity: z.number().min(0.01).max(2).default(0.25),
  friction: z.number().min(0.8).max(0.999).default(0.975),
  bounce: z.number().min(0).max(1).default(0.7),
  maxPower: z.number().min(1).max(30).default(9),
  players: z.number().int().min(1).max(2).default(1),
  player2: z.string().default("2P"),
  ...OutcomeArgs,
}).strict();
export type PhysicsArgs = z.infer<typeof PhysicsArgsSchema>;

export interface PhysicsData {
  args: PhysicsArgs; frame: number; rows: string[]; w: number; h: number; start: { x: number; y: number };
  ball: { x: number; y: number; vx: number; vy: number }; moving: boolean; angle: number; power: number; used: number;
  targets: Array<{ x: number; y: number; hit: boolean }>; holed: boolean; held: string[]; turn: number; scores: number[]; message: string; trail: Array<[number, number]>;
}

export function checkPhysics(a: PhysicsArgs): string[] {
  const all = a.rows.join("");
  const out: string[] = [];
  a.rows.forEach((row, y) => Array.from(row).forEach((ch, x) => { if (!"#o*O~ .".includes(ch)) out.push(`rows[${y}]: 使えない文字 '${ch}' (x=${x})`); }));
  if ((all.match(/o/g) ?? []).length !== 1) out.push("球の位置 o はちょうど1つ必要です");
  if (a.goal === "hole" && !all.includes("O")) out.push("goal が hole のときはカップ O が必要です");
  if (a.goal === "targets" && !all.includes("*")) out.push("goal が targets のときは的 * が必要です");
  return out;
}

export function startPhysics(raw: Record<string, unknown>): PhysicsData {
  const args = PhysicsArgsSchema.parse(raw);
  const w = Math.max(...args.rows.map(r => r.length));
  const rows = args.rows.map(r => r.padEnd(w, " "));
  let start = { x: T, y: T };
  const targets: PhysicsData["targets"] = [];
  rows.forEach((r, y) => Array.from(r).forEach((ch, x) => { if (ch === "o") start = { x: x * T + T / 2, y: y * T + T / 2 }; if (ch === "*") targets.push({ x: x * T + T / 2, y: y * T + T / 2, hit: false }); }));
  return { args, frame: 0, rows, w, h: rows.length, start, ball: { ...start, vx: 0, vy: 0 }, moving: false, angle: args.view === "side" ? -0.8 : 0, power: Math.round(args.maxPower * 0.6 * 10) / 10, used: 0, targets, holed: false, held: [], turn: 0, scores: [], message: args.title, trail: [] };
}

const wall = (d: PhysicsData, x: number, y: number) => { const tx = Math.floor(x / T), ty = Math.floor(y / T); return tx < 0 || ty < 0 || tx >= d.w || ty >= d.h || d.rows[ty]![tx] === "#"; };
const done = (d: PhysicsData) => (d.args.goal === "hole" ? d.holed : d.targets.every(t => t.hit));

export function shoot(d: PhysicsData): PhysicsData {
  if (d.moving) return d;
  return { ...d, moving: true, used: d.used + 1, trail: [], ball: { ...d.ball, vx: Math.cos(d.angle) * d.power, vy: Math.sin(d.angle) * d.power } };
}

export function stepPhysics(data: PhysicsData, held: string[], aimAt?: { x: number; y: number }): PhysicsData {
  const d: PhysicsData = { ...data, frame: data.frame + 1, held, ball: { ...data.ball }, targets: data.targets.map(t => ({ ...t })), trail: data.trail };
  const now = pressed(held, data.held);
  if (!d.moving) {
    if (aimAt) { d.angle = Math.atan2(aimAt.y - d.ball.y, aimAt.x - d.ball.x); d.power = Math.min(d.args.maxPower, Math.max(1, Math.hypot(aimAt.x - d.ball.x, aimAt.y - d.ball.y) / 8)); return shoot(d); }
    if (held.includes("left")) d.angle -= 0.04;
    if (held.includes("right")) d.angle += 0.04;
    if (held.includes("up")) d.power = Math.min(d.args.maxPower, d.power + 0.15);
    if (held.includes("down")) d.power = Math.max(0.5, d.power - 0.15);
    d.angle = Math.round(d.angle * 1000) / 1000; d.power = Math.round(d.power * 100) / 100;
    return now.includes("fire") ? shoot(d) : d;
  }
  const b = d.ball;
  for (let sub = 0; sub < 2; sub++) {
    if (d.args.view === "side") b.vy += d.args.gravity / 2; else { b.vx *= Math.sqrt(d.args.friction); b.vy *= Math.sqrt(d.args.friction); }
    const nx = b.x + b.vx / 2, ny = b.y + b.vy / 2;
    if (wall(d, nx, b.y)) b.vx = -b.vx * d.args.bounce; else b.x = nx;
    if (wall(d, b.x, ny)) { b.vy = -b.vy * d.args.bounce; if (d.args.view === "side") b.vx *= 0.9; } else b.y = ny;
    for (const t of d.targets) if (!t.hit && Math.hypot(t.x - b.x, t.y - b.y) < 9) { t.hit = true; d.message = "命中！"; }
    const tile = d.rows[Math.floor(b.y / T)]?.[Math.floor(b.x / T)];
    if (tile === "O" && Math.hypot(b.vx, b.vy) < 6 && Math.hypot(b.x - (Math.floor(b.x / T) * T + T / 2), b.y - (Math.floor(b.y / T) * T + T / 2)) < 6) { d.holed = true; b.vx = b.vy = 0; d.message = "カップイン！"; }
    if (tile === "~") { d.ball = { ...d.start, vx: 0, vy: 0 }; d.used++; d.moving = false; d.message = "水に落ちた（1打罰）"; return d; }
  }
  b.x = Math.round(b.x * 100) / 100; b.y = Math.round(b.y * 100) / 100; b.vx = Math.round(b.vx * 1000) / 1000; b.vy = Math.round(b.vy * 1000) / 1000;
  d.trail = [...d.trail, [b.x, b.y] as [number, number]].slice(-40);
  const resting = d.args.view === "side" ? Math.hypot(b.vx, b.vy) < 0.35 && wall(d, b.x, b.y + 6) : Math.hypot(b.vx, b.vy) < 0.06;
  if (d.holed || resting || d.frame - data.frame > 0 && d.trail.length >= 40 && Math.abs(d.trail[0]![0] - b.x) + Math.abs(d.trail[0]![1] - b.y) < 0.5) { d.moving = false; b.vx = b.vy = 0; }
  if (!d.moving && done(d) && d.args.players === 2 && d.turn === 0) {
    return { ...startPhysics(d.args), frame: d.frame, turn: 1, scores: [d.used], message: `${d.args.player2}の番（1Pは${d.used}打）` };
  }
  return d;
}

export function physicsStatus(d: PhysicsData): "playing" | "win" | "lose" {
  if (d.moving) return "playing";
  if (d.args.players === 2) {
    if (d.turn === 1 && (done(d) || d.used >= d.args.shots + 3)) return d.scores[0]! <= (done(d) ? d.used : 99) ? "win" : "lose";
    if (d.turn === 0 && !done(d) && d.used >= d.args.shots + 3) return "lose";
    return "playing";
  }
  if (done(d)) return "win";
  if (d.used >= d.args.shots) return "lose";
  return "playing";
}

function layout(d: PhysicsData, width: number, height: number) {
  const s = Math.min((width - 24) / (d.w * T), (height - 64) / (d.h * T));
  return { s, ox: (width - d.w * T * s) / 2, oy: 30 + (height - 64 - d.h * T * s) / 2 };
}

export default defineSystem({
  id: "physics",
  scenes: {
    shot: {
      title: "物理ショット（ゴルフ・ビリヤード風・投てきパズル）",
      realtime: { fps: FPS },
      checkArgs: args => { const r = PhysicsArgsSchema.safeParse(args); return r.success ? checkPhysics(r.data) : issues(r); },
      start: (_ctx, raw) => startPhysics(raw),
      input(ctx, raw, input) {
        const d = raw as PhysicsData;
        if (input.type === "cancel") return finish(ctx, d.args, "quit", "やめた。");
        let next: PhysicsData;
        if (input.type === "custom") {
          const c = asRecord(asRecord(input.value).click);
          if (typeof c.x !== "number" || d.moving) return {};
          const lay = layout(d, Number(c.width), Number(c.height));
          next = stepPhysics(d, d.held, { x: (c.x - lay.ox) / lay.s, y: ((c.y as number) - lay.oy) / lay.s });
        } else if (input.type === "frame") next = stepPhysics(d, input.held);
        else return {};
        const status = physicsStatus(next);
        if (status !== "playing") {
          const line = d.args.players === 2 ? `1P ${next.scores[0]}打 / ${d.args.player2} ${next.used}打 — ${status === "win" ? "1Pの勝ち！" : `${d.args.player2}の勝ち`}` : status === "win" ? `${d.args.title}：${next.used}打で決めた！` : `${d.args.title}：${d.args.shots}打では届かなかった……`;
          return finish(ctx, d.args, status, line);
        }
        return { data: next };
      },
      draw(g, view) {
        const d = view.data as PhysicsData;
        const lay = layout(d, view.width, view.height);
        g.fillStyle = d.args.view === "top" ? "#1d2b1a" : "#1b2433"; g.fillRect(0, 0, view.width, view.height);
        g.save(); g.translate(lay.ox, lay.oy); g.scale(lay.s, lay.s);
        g.fillStyle = d.args.view === "top" ? "#3f6b3a" : "#26344a"; g.fillRect(0, 0, d.w * T, d.h * T);
        for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
          const ch = d.rows[y]![x];
          if (ch === "#") { g.fillStyle = d.args.view === "top" ? "#6b5a45" : "#6b5a45"; g.fillRect(x * T, y * T, T, T); }
          else if (ch === "~") { g.fillStyle = "#2f5d7e"; g.fillRect(x * T, y * T, T, T); }
          else if (ch === "O") { g.fillStyle = "#111"; g.beginPath(); g.arc(x * T + 8, y * T + 8, 5, 0, Math.PI * 2); g.fill(); g.fillStyle = "#e9dcb8"; g.fillRect(x * T + 8, y * T - 10, 1, 16); g.fillStyle = "#d9745b"; g.fillRect(x * T + 9, y * T - 10, 7, 5); }
        }
        for (const t of d.targets) if (!t.hit) { g.fillStyle = "#d9745b"; g.beginPath(); g.arc(t.x, t.y, 6, 0, Math.PI * 2); g.fill(); g.fillStyle = "#fff"; g.beginPath(); g.arc(t.x, t.y, 2.5, 0, Math.PI * 2); g.fill(); }
        g.strokeStyle = "rgba(255,255,255,.25)"; g.beginPath(); d.trail.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
        if (!d.moving) {
          g.strokeStyle = "#f0c36a"; g.lineWidth = 1.5; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(d.ball.x, d.ball.y); g.lineTo(d.ball.x + Math.cos(d.angle) * d.power * 6, d.ball.y + Math.sin(d.angle) * d.power * 6); g.stroke(); g.setLineDash([]);
        }
        g.fillStyle = "#ffffff"; g.beginPath(); g.arc(d.ball.x, d.ball.y, 3.5, 0, Math.PI * 2); g.fill();
        g.restore();
        g.fillStyle = "#e9dcb8"; g.font = "14px system-ui"; g.textAlign = "left";
        g.fillText(`${d.args.title}　${d.args.players === 2 ? `${d.turn ? d.args.player2 : "1P"}の番　` : ""}${d.used}/${d.args.shots}打　力 ${"■".repeat(Math.round((d.power / d.args.maxPower) * 10))}　${d.message}`, 12, 20);
        g.fillStyle = "#a9b09d"; g.font = "12px system-ui";
        g.fillText("←→ 向き　↑↓ 力　Z 打つ（狙う場所をクリックしても打てる）　Esc やめる", 12, view.height - 12);
      },
    },
  },
});

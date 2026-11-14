/**
 * Genre module: runner / race (realtime). Switch lanes, jump over obstacles, grab coins and boosts, outrun rivals.
 * Covers racing, endless runners, chase and escape scenes, deliveries against the clock, sports sprints.
 * Tracks are text (one row per segment, one character per lane), repeated until `length` is run:
 *   .  empty   #  obstacle (jump with Z / ↑)   *  coin   +  boost
 */
import { z } from "zod";
import { defineSystem, type SystemContext } from "../../engine/src/index";
import { assetRefErrors, drawHero, drawTile, finish, heroOf, issues, OutcomeArgs, pressed } from "./common";
import { nextRand } from "./ui";

const FPS = 30;
const SEG = 48;

export const RunnerArgsSchema = z.object({
  title: z.string().default("レース"),
  lanes: z.number().int().min(2).max(5).default(3),
  /** Distance to run, in segments. */
  length: z.number().int().min(10).max(5000).default(120),
  /** Rows of the track (lane characters). Empty = generated from the seed with `density`. */
  track: z.array(z.string().min(1)).default([]),
  density: z.number().min(0).max(0.9).default(0.25),
  speed: z.number().min(1).max(20).default(5),
  /** Rivals to beat; `place` = the rank you must reach (1 = win the race). */
  rivals: z.array(z.object({ name: z.string().min(1), speed: z.number().min(0.5).max(30) }).strict()).default([]),
  place: z.number().int().min(1).max(10).default(1),
  /** Time limit in seconds (0 = none). */
  seconds: z.number().min(0).max(3600).default(0),
  /** HP lost per obstacle hit (0 = only slows you down). */
  hitDamage: z.number().int().min(0).max(999).default(2),
  /** Draw with the project's tileset: { ".": road tile code, "#": obstacle tile code, "side": verge tile code }. */
  tiles: z.record(z.string(), z.string().length(1)).default({}),
  ...OutcomeArgs,
}).strict();
export type RunnerArgs = z.infer<typeof RunnerArgsSchema>;

export interface RunnerData {
  args: RunnerArgs; frame: number; rows: string[]; lane: number; x: number; dist: number; speed: number; jump: number; boost: number; slow: number;
  coins: number; taken: string[]; hp: number; maxHp: number; rivals: Array<{ name: string; dist: number }>; held: string[]; hits: number;
}

export function buildTrack(args: RunnerArgs, seed: number): string[] {
  if (args.track.length) return args.track.map(r => r.padEnd(args.lanes, ".").slice(0, args.lanes));
  const rows: string[] = [];
  for (let i = 0; i < 64; i++) {
    let row = "";
    for (let l = 0; l < args.lanes; l++) {
      let r: number; [r, seed] = nextRand(seed);
      row += i < 4 ? "." : r < args.density * 0.6 ? "#" : r < args.density * 0.85 ? "*" : r < args.density ? "+" : ".";
    }
    if (!row.includes(".") && !row.includes("*") && !row.includes("+")) row = `.${row.slice(1)}`;
    rows.push(row);
  }
  return rows;
}

export function startRunner(ctx: SystemContext, raw: Record<string, unknown>): RunnerData {
  const args = RunnerArgsSchema.parse(raw);
  const hero = heroOf(ctx);
  const lane = Math.floor(args.lanes / 2);
  return { args, frame: 0, rows: buildTrack(args, ctx.state.rng || 1), lane, x: lane, dist: 0, speed: args.speed, jump: 0, boost: 0, slow: 0, coins: 0, taken: [], hp: hero.hp, maxHp: hero.maxHp, rivals: args.rivals.map(r => ({ name: r.name, dist: 0 })), held: [], hits: 0 };
}

const cell = (d: RunnerData, seg: number, lane: number) => d.rows[((seg % d.rows.length) + d.rows.length) % d.rows.length]![lane] ?? ".";

export function stepRunner(d0: RunnerData, held: string[]): RunnerData {
  const d: RunnerData = { ...d0, frame: d0.frame + 1, held, jump: Math.max(0, d0.jump - 1), boost: Math.max(0, d0.boost - 1), slow: Math.max(0, d0.slow - 1), rivals: d0.rivals.map(r => ({ ...r })) };
  const now = pressed(held, d0.held);
  if (now.includes("left")) d.lane = Math.max(0, d.lane - 1);
  if (now.includes("right")) d.lane = Math.min(d.args.lanes - 1, d.lane + 1);
  if ((now.includes("fire") || now.includes("up")) && d.jump === 0) d.jump = 14;
  d.x = Math.round((d.x + (d.lane - d.x) * 0.35) * 100) / 100;
  const v = d.args.speed * (d.boost ? 1.6 : 1) * (d.slow ? 0.45 : 1) * (held.includes("down") ? 0.6 : 1);
  const before = Math.floor(d.dist / SEG);
  d.dist = Math.round((d.dist + v) * 100) / 100;
  const seg = Math.floor(d.dist / SEG);
  for (let s = before + 1; s <= seg; s++) {
    const key = `${s},${d.lane}`;
    const c = cell(d, s, d.lane);
    if (c === "#" && d.jump === 0 && !d.taken.includes(key)) { d.slow = 20; d.hits++; d.hp = Math.max(0, d.hp - d.args.hitDamage); d.taken = [...d.taken, key].slice(-50); }
    if (c === "*" && !d.taken.includes(key)) { d.coins++; d.taken = [...d.taken, key].slice(-50); }
    if (c === "+" && !d.taken.includes(key)) { d.boost = 45; d.taken = [...d.taken, key].slice(-50); }
  }
  d.args.rivals.forEach((r, i) => { d.rivals[i]!.dist = Math.round((d.rivals[i]!.dist + r.speed * (1 + Math.sin((d.frame + i * 37) / 40) * 0.08)) * 100) / 100; });
  return d;
}

export const placeOf = (d: RunnerData) => 1 + d.rivals.filter(r => r.dist > d.dist).length;
export function runnerStatus(d: RunnerData): "playing" | "win" | "lose" {
  if (d.hp <= 0) return "lose";
  const goal = d.args.length * SEG;
  if (d.dist >= goal) return placeOf(d) <= d.args.place ? "win" : "lose";
  if (d.rivals.filter(r => r.dist >= goal).length >= d.args.place) return "lose";
  if (d.args.seconds && d.frame / FPS >= d.args.seconds) return "lose";
  return "playing";
}

export default defineSystem({
  id: "runner",
  scenes: {
    race: {
      title: "ランナー・レース（レーン移動・ジャンプ・ライバルとの競争）",
      realtime: { fps: FPS },
      checkArgs: (args, { content }) => { const r = RunnerArgsSchema.safeParse(args); if (!r.success) return issues(r); return assetRefErrors(content, r.data.tiles).concat(r.data.track.flatMap((row, i) => (/^[.#*+]+$/.test(row) ? [] : [`track[${i}]: 使えるのは . # * + です`]))); },
      start: (ctx, raw) => startRunner(ctx, raw),
      input(ctx, raw, input) {
        const d = raw as RunnerData;
        if (input.type === "cancel") return d.args.canFlee ? finish(ctx, d.args, "quit", "走るのをやめた。", d.hp) : {};
        if (input.type !== "frame") return {};
        const next = stepRunner(d, input.held);
        const status = runnerStatus(next);
        if (status === "win") return finish(ctx, d.args, "win", `${d.args.title}：${d.rivals.length ? `${placeOf(next)}位でゴール！` : "走りきった！"}（${Math.round(next.frame / FPS)}秒・コイン${next.coins}）`, next.hp);
        if (status === "lose") return finish(ctx, d.args, "lose", next.hp <= 0 ? "転んで動けなくなった……" : next.dist >= d.args.length * SEG ? `${placeOf(next)}位……届かなかった` : "間に合わなかった……", next.hp);
        return { data: next };
      },
      draw(g, view) {
        const d = view.data as RunnerData;
        const W = view.width, H = view.height;
        const laneW = Math.min(90, (W * 0.5) / d.args.lanes), left = W / 2 - (laneW * d.args.lanes) / 2, playerY = H - 110;
        g.fillStyle = "#24301f"; g.fillRect(0, 0, W, H);
        g.fillStyle = "#5c5345"; g.fillRect(left, 0, laneW * d.args.lanes, H);
        if (d.args.tiles.side) for (let y = -(d.dist % 32); y < H; y += 32) for (let x = 0; x < W; x += 32) if (x + 32 < left || x > left + laneW * d.args.lanes) drawTile(g, view, d.args.tiles.side, x, y, 32);
        const seg0 = Math.floor(d.dist / SEG);
        for (let s = seg0 - 3; s < seg0 + Math.ceil(H / SEG) + 2; s++) {
          const y = playerY - (s * SEG - d.dist);
          for (let l = 0; l < d.args.lanes; l++) {
            const c = cell(d, s, l), x = left + l * laneW + laneW / 2;
            if (d.args.tiles["."]) drawTile(g, view, d.args.tiles["."], left + l * laneW, y - SEG / 2, laneW);
            if (c === "#" && d.args.tiles["#"] && drawTile(g, view, d.args.tiles["#"], x - laneW * 0.35, y - laneW * 0.35, laneW * 0.7)) continue;
            if (d.taken.includes(`${s},${l}`) && c !== "#") continue;
            if (c === "#") { g.fillStyle = "#8a7f6a"; g.fillRect(x - laneW * 0.35, y - 10, laneW * 0.7, 20); g.fillStyle = "#3a332a"; g.fillRect(x - laneW * 0.35, y + 6, laneW * 0.7, 4); }
            else if (c === "*") { g.fillStyle = "#f0c36a"; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
            else if (c === "+") { g.fillStyle = "#7fd1e0"; g.beginPath(); g.moveTo(x, y - 10); g.lineTo(x + 8, y + 6); g.lineTo(x - 8, y + 6); g.fill(); }
          }
          g.fillStyle = "rgba(255,255,255,.12)"; for (let l = 1; l < d.args.lanes; l++) g.fillRect(left + l * laneW - 1, y - 10, 2, 14);
        }
        const goalY = playerY - (d.args.length * SEG - d.dist);
        if (goalY > -10 && goalY < H) { g.fillStyle = "#fff"; for (let i = 0; i < d.args.lanes * 4; i++) if (i % 2 === 0) g.fillRect(left + i * laneW / 4, goalY - 4, laneW / 4, 8); }
        d.rivals.forEach((r, i) => { const y = playerY - (r.dist - d.dist); if (y > -20 && y < H + 20) { g.fillStyle = ["#d9745b", "#9d7fd1", "#7fa8d9"][i % 3]!; g.fillRect(left - 30, y - 8, 16, 16); g.fillStyle = "#e9dcb8"; g.font = "10px system-ui"; g.textAlign = "right"; g.fillText(r.name, left - 34, y + 4); } });
        const px = left + d.x * laneW + laneW / 2, lift = d.jump ? Math.sin((d.jump / 14) * Math.PI) * 18 : 0;
        g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(px, playerY + 10, 10, 4, 0, 0, Math.PI * 2); g.fill();
        if (!(d.slow && Math.floor(d.frame / 3) % 2)) drawHero(g, view, px, playerY - lift, 30, 3, Math.floor(d.frame / 4));
        g.fillStyle = "#e9dcb8"; g.font = "14px system-ui"; g.textAlign = "left";
        g.fillText(`${d.args.title}　${Math.floor(d.dist / SEG)}/${d.args.length}${d.rivals.length ? `　${placeOf(d)}位` : ""}　コイン ${d.coins}　HP ${d.hp}/${d.maxHp}${d.args.seconds ? `　残り${Math.max(0, Math.ceil(d.args.seconds - d.frame / FPS))}秒` : ""}${d.boost ? "　ブースト！" : ""}`, 12, 22);
        g.fillStyle = "#a9b09d"; g.font = "12px system-ui";
        g.fillText("←→ レーン　Z/↑ ジャンプ　↓ 減速　Esc やめる", 12, 42);
      },
    },
  },
});

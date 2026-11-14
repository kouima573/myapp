/**
 * Genre module: action stage (realtime). One data format covers many action genres:
 *   view "side": platformer, metroidvania room, run & jump, boss fight on platforms
 *   view "top":  action RPG room, hack & slash, belt-scroll brawl, survivors-like (autoAttack + spawners + survive)
 * Levels are text rows so an AI can design them:
 *   #  wall/ground   ^ spikes   * coin   G goal   @ start
 *   w  walker   f flyer   c chaser   t turret   s spawner (makes chasers)   B boss (the RPG enemy in battle mode)
 *   g  guard: patrols and watches a cone in front of it (stealth). Seen → `seen`: "alarm" (guards chase) or "lose"
 * weapon "gun" shoots (run & gun); aim "lock" keeps the aim while Shift is held (twin-stick style strafing).
 * Field scene: { "type": "startScene", "system": "action", "scene": "stage", "args": { "rows": [...], "goal": "exit", "onWin": [...] } }
 * Battle mode: enemy "battle": { "mode": "action.stage", "args": { "rows": [...], "goal": "defeat" } }
 */
import { z } from "zod";
import { defineSystem, type SystemContext } from "../../engine/src/index";
import { drawEnemyPortrait } from "../../runtime/src/render";
import { drawHero, enemyOf, finish, heroOf, image, issues, OutcomeArgs, pressed } from "./common";
import { nextRand } from "./ui";

export const T = 16;
const FPS = 30;

export const ActionArgsSchema = z.object({
  title: z.string().default(""),
  rows: z.array(z.string().min(1)).min(1),
  view: z.enum(["side", "top"]).default("side"),
  /** exit: reach G. defeat: beat the enemies (or `kills`). collect: take every coin. survive: last `seconds`. */
  goal: z.enum(["exit", "defeat", "collect", "survive"]).default("exit"),
  /** Time limit (or the time to survive). 0 = none. */
  seconds: z.number().min(0).max(3600).default(0),
  kills: z.number().int().min(0).default(0),
  playerSpeed: z.number().min(0.5).max(8).default(2.2),
  jump: z.number().min(1).max(20).default(7.4),
  gravity: z.number().min(0.05).max(2).default(0.45),
  /** Swing automatically every half second (survivors-like). */
  autoAttack: z.boolean().default(false),
  /** sword: a swing in front. gun: shots toward the aim (hold to keep firing). */
  weapon: z.enum(["sword", "gun"]).default("sword"),
  /** move: aim where you walk. lock: Shift keeps the current aim while moving (no dash). */
  aim: z.enum(["move", "lock"]).default("move"),
  /** Guards (g): how far they see (pixels, 16 per tile) and what happens when they see you. */
  sight: z.number().min(8).max(400).default(72),
  seen: z.enum(["alarm", "lose"]).default("alarm"),
  enemyHp: z.number().int().min(1).max(999).default(6),
  /** Damage enemies deal; 0 = from the RPG enemy's attack (or 4) minus the hero's defense. */
  enemyDamage: z.number().int().min(0).max(999).default(0),
  enemySpeed: z.number().min(0.1).max(6).default(0.9),
  spawnEvery: z.number().int().min(10).max(3000).default(90),
  /** Boss HP = RPG enemy max HP × hpScale. */
  hpScale: z.number().min(0.1).max(50).default(3),
  ...OutcomeArgs,
}).strict();
export type ActionArgs = z.infer<typeof ActionArgsSchema>;

type Kind = "walker" | "flyer" | "chaser" | "turret" | "boss" | "guard";
interface Actor { id: number; kind: Kind; x: number; y: number; vx: number; vy: number; hp: number; maxHp: number; t: number; baseY: number; dead: boolean }
interface Shot { x: number; y: number; vx: number; vy: number }
export interface ActionData {
  args: ActionArgs; frame: number; seed: number; rows: string[]; w: number; h: number;
  sx: number; sy: number; px: number; py: number; vx: number; vy: number; onGround: boolean; face: "left" | "right" | "up" | "down";
  hp: number; maxHp: number; attack: number; defense: number; inv: number; swing: number; swingHits: number[];
  coins: string[]; coinTotal: number; actors: Actor[]; shots: Shot[]; spawners: Array<{ x: number; y: number }>; nextId: number;
  kills: number; held: string[]; message: string;
  aimX: number; aimY: number; bolts: Shot[]; caught: boolean; alarm: boolean;
}

export function checkActionLevel(rows: string[], goal: string): string[] {
  const out: string[] = [];
  const all = rows.join("");
  rows.forEach((row, y) => Array.from(row).forEach((ch, x) => { if (!"#^*G@wfctsBg .".includes(ch)) out.push(`rows[${y}]: 使えない文字 '${ch}' (x=${x})`); }));
  const starts = (all.match(/@/g) ?? []).length;
  if (starts !== 1) out.push(`開始位置 @ はちょうど1つ必要です（${starts}個）`);
  if (goal === "exit" && !all.includes("G")) out.push("goal が exit のときはゴール G が必要です");
  if (goal === "collect" && !all.includes("*")) out.push("goal が collect のときはコイン * が必要です");
  if (goal === "defeat" && !/[wfctsBg]/.test(all)) out.push("goal が defeat のときは敵（w f c t s B g）が必要です");
  return out;
}

const solidCh = (d: ActionData, tx: number, ty: number): boolean => {
  if (tx < 0 || tx >= d.w || ty < 0) return true;
  if (ty >= d.h) return d.args.view === "top";
  return d.rows[ty]![tx] === "#";
};
function hits(d: ActionData, x: number, y: number, hw: number, hh: number): boolean {
  for (let ty = Math.floor((y - hh) / T); ty <= Math.floor((y + hh - 0.001) / T); ty++)
    for (let tx = Math.floor((x - hw) / T); tx <= Math.floor((x + hw - 0.001) / T); tx++) if (solidCh(d, tx, ty)) return true;
  return false;
}
/** Axis-separated movement against walls. */
function moveBox(d: ActionData, x: number, y: number, hw: number, hh: number, dx: number, dy: number) {
  let hitX = false, hitY = false;
  let nx = x + dx;
  if (dx && hits(d, nx, y, hw, hh)) { hitX = true; nx = dx > 0 ? Math.floor((nx + hw) / T) * T - hw - 0.01 : Math.floor((nx - hw) / T + 1) * T + hw + 0.01; if (hits(d, nx, y, hw, hh)) nx = x; }
  let ny = y + dy;
  if (dy && hits(d, nx, ny, hw, hh)) { hitY = true; ny = dy > 0 ? Math.floor((ny + hh) / T) * T - hh - 0.01 : Math.floor((ny - hh) / T + 1) * T + hh + 0.01; if (hits(d, nx, ny, hw, hh)) ny = y; }
  return { x: Math.round(nx * 100) / 100, y: Math.round(ny * 100) / 100, hitX, hitY };
}
const overlap = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) => Math.abs(ax - bx) < aw + bw && Math.abs(ay - by) < ah + bh;
const tileAt = (d: ActionData, x: number, y: number) => d.rows[Math.floor(y / T)]?.[Math.floor(x / T)] ?? " ";
const HW = 6, HH = 7;

function makeActor(d: ActionData, kind: Kind, x: number, y: number, hp: number): Actor {
  return { id: d.nextId++, kind, x, y, vx: kind === "turret" ? 0 : -d.args.enemySpeed, vy: 0, hp, maxHp: hp, t: 0, baseY: y, dead: false };
}

export function startAction(ctx: SystemContext, raw: Record<string, unknown>): ActionData {
  const args = ActionArgsSchema.parse(raw);
  const width = Math.max(...args.rows.map(r => r.length));
  const hero = heroOf(ctx);
  const d: ActionData = {
    args, frame: 0, seed: ctx.state.rng || 1, rows: [], w: width, h: args.rows.length, sx: 0, sy: 0, px: 0, py: 0, vx: 0, vy: 0, onGround: false, face: "right",
    hp: hero.hp, maxHp: hero.maxHp, attack: hero.attack, defense: hero.defense, inv: 0, swing: 0, swingHits: [], coins: [], coinTotal: 0, actors: [], shots: [], spawners: [], nextId: 1, kills: 0, held: [], message: args.title, aimX: 1, aimY: 0, bolts: [], caught: false, alarm: false,
  };
  const enemy = enemyOf(ctx, args.enemyId);
  d.rows = args.rows.map((row, y) => Array.from(row.padEnd(width, " ")).map((ch, x) => {
    const cx = x * T + T / 2, cy = y * T + T / 2;
    if (ch === "@") { d.sx = d.px = cx; d.sy = d.py = cy; return " "; }
    if (ch === "*") { d.coinTotal++; return "*"; }
    if (ch === "s") { d.spawners.push({ x: cx, y: cy }); return " "; }
    const kind = ({ w: "walker", f: "flyer", c: "chaser", t: "turret", B: "boss", g: "guard" } as Record<string, Kind | undefined>)[ch];
    if (kind) { d.actors.push(makeActor(d, kind, cx, cy, kind === "boss" ? Math.max(1, Math.round((enemy?.stats.maxHp ?? 20) * args.hpScale)) : args.enemyHp)); return " "; }
    return ch === "." ? " " : ch;
  }).join(""));
  return d;
}

function contactDamage(ctx: SystemContext, d: ActionData): number {
  if (d.args.enemyDamage) return d.args.enemyDamage;
  return Math.max(1, (enemyOf(ctx, d.args.enemyId)?.stats.attack ?? 4) - d.defense);
}

/** One fixed 1/30 s step. Pure and deterministic. */
export function stepAction(ctx: SystemContext, data: ActionData, held: string[]): ActionData {
  const d: ActionData = { ...data, frame: data.frame + 1, inv: Math.max(0, data.inv - 1), swing: Math.max(0, data.swing - 1), actors: data.actors.map(a => ({ ...a })), shots: [], bolts: [], held };
  const now = pressed(held, data.held);
  const side = d.args.view === "side";
  const hurt = (amount: number, fromX: number) => {
    if (d.inv > 0) return;
    d.hp = Math.max(0, d.hp - amount); d.inv = 30;
    if (side) { d.vy = -4; d.vx = d.px < fromX ? -3 : 3; }
  };
  // Player movement.
  const locked = d.args.aim === "lock" && held.includes("focus");
  const speed = d.args.playerSpeed * (held.includes("focus") && !locked ? 1.7 : 1);
  const dx = (held.includes("right") ? 1 : 0) - (held.includes("left") ? 1 : 0);
  if (side) {
    d.vx = dx * speed + (d.inv > 20 ? d.vx * 0.5 : 0);
    if (dx && !locked) { d.face = dx > 0 ? "right" : "left"; d.aimX = dx; d.aimY = 0; }
    if ((now.includes("up")) && d.onGround) d.vy = -d.args.jump;
    if (!held.includes("up") && d.vy < -3) d.vy = -3;
    d.vy = Math.min(8, d.vy + d.args.gravity);
    const m = moveBox(d, d.px, d.py, HW, HH, d.vx, d.vy);
    d.onGround = m.hitY && d.vy > 0;
    if (m.hitY) d.vy = 0;
    d.px = m.x; d.py = m.y;
    if (d.py > d.h * T + 32) { hurt(Math.max(1, Math.floor(d.maxHp / 4)), d.px); d.px = d.sx; d.py = d.sy; d.vx = d.vy = 0; d.inv = 30; }
  } else {
    const dy = (held.includes("down") ? 1 : 0) - (held.includes("up") ? 1 : 0);
    const norm = dx && dy ? Math.SQRT1_2 : 1;
    if ((dx || dy) && !locked) { d.face = dy < 0 ? "up" : dy > 0 ? "down" : dx > 0 ? "right" : "left"; d.aimX = dx * norm; d.aimY = dy * norm; }
    const m = moveBox(d, d.px, d.py, HW, HW, dx * speed * norm, dy * speed * norm);
    d.px = m.x; d.py = m.y;
  }
  // Attack.
  if (d.args.weapon === "gun") {
    if (now.includes("fire") || (held.includes("fire") && d.frame % 6 === 0) || (d.args.autoAttack && d.frame % 12 === 0)) d.bolts.push({ x: d.px + d.aimX * 8, y: d.py + d.aimY * 8, vx: Math.round(d.aimX * 600) / 100, vy: Math.round(d.aimY * 600) / 100 });
  } else if (now.includes("fire") || (d.args.autoAttack && d.frame % 15 === 0)) { d.swing = 8; d.swingHits = []; }
  const reach = { x: d.px + (d.face === "left" ? -14 : d.face === "right" ? 14 : 0), y: d.py + (d.face === "up" ? -14 : d.face === "down" ? 14 : 0) };
  // Tiles under the player.
  const here = tileAt(d, d.px, d.py);
  const key = `${Math.floor(d.px / T)},${Math.floor(d.py / T)}`;
  if (here === "*" && !d.coins.includes(key)) d.coins = [...d.coins, key];
  if (here === "^" || tileAt(d, d.px, d.py + HH) === "^") hurt(Math.max(1, Math.floor(d.maxHp / 5)), d.px);
  // Spawners.
  if (d.frame % d.args.spawnEvery === 0) for (const s of d.spawners) if (d.actors.filter(a => !a.dead).length < 30) d.actors.push(makeActor(d, "chaser", s.x, s.y, d.args.enemyHp));
  // Enemies.
  const dmg = contactDamage(ctx, d);
  for (const a of d.actors) {
    if (a.dead) continue;
    a.t++;
    const toward = Math.sign(d.px - a.x) || 1;
    if (a.kind === "walker") {
      const m = moveBox(d, a.x, a.y, 6, 6, a.vx, side ? Math.min(6, a.vy + d.args.gravity) : 0);
      a.vy = side && !m.hitY ? Math.min(6, a.vy + d.args.gravity) : 0;
      const ahead = side && m.hitY && !solidCh(d, Math.floor((m.x + Math.sign(a.vx) * 8) / T), Math.floor((m.y + 10) / T));
      if (m.hitX || ahead) a.vx = -a.vx;
      a.x = m.x; a.y = m.y;
    } else if (a.kind === "flyer") {
      const m = moveBox(d, a.x, a.y, 6, 6, a.vx, 0);
      if (m.hitX) a.vx = -a.vx;
      a.x = m.x; a.y = Math.round((a.baseY + Math.sin(a.t / 20) * 14) * 100) / 100;
    } else if (a.kind === "chaser" || a.kind === "boss") {
      const sp = d.args.enemySpeed * (a.kind === "boss" ? 0.7 : 1);
      if (side) {
        a.vy = Math.min(6, a.vy + d.args.gravity);
        const m = moveBox(d, a.x, a.y, a.kind === "boss" ? 10 : 6, a.kind === "boss" ? 10 : 6, toward * sp, a.vy);
        if (m.hitY) a.vy = a.kind === "boss" && a.t % 90 === 0 ? -6 : 0;
        a.x = m.x; a.y = m.y;
      } else {
        const dist = Math.hypot(d.px - a.x, d.py - a.y) || 1;
        const m = moveBox(d, a.x, a.y, 6, 6, ((d.px - a.x) / dist) * sp, ((d.py - a.y) / dist) * sp);
        a.x = m.x; a.y = m.y;
      }
    }
    if (a.kind === "guard") {
      const m = moveBox(d, a.x, a.y, 6, 6, a.vx * 0.6, side ? Math.min(6, a.vy + d.args.gravity) : 0);
      a.vy = side && !m.hitY ? Math.min(6, a.vy + d.args.gravity) : 0;
      const ahead = side && m.hitY && !solidCh(d, Math.floor((m.x + Math.sign(a.vx) * 8) / T), Math.floor((m.y + 10) / T));
      if (m.hitX || ahead || a.t % 150 === 0) a.vx = -a.vx;
      a.x = m.x; a.y = m.y;
      if (sees(d, a)) {
        if (d.args.seen === "lose") d.caught = true;
        else if (!d.alarm) { d.alarm = true; d.message = "見つかった！"; for (const o of d.actors) if (o.kind === "guard") o.kind = "chaser"; }
      }
    }
    if ((a.kind === "turret" && a.t % 70 === 0) || (a.kind === "boss" && a.t % 55 === 0)) {
      const base = Math.atan2(d.py - a.y, d.px - a.x);
      for (const off of a.kind === "boss" ? [-0.3, 0, 0.3] : [0]) d.shots.push({ x: a.x, y: a.y, vx: Math.round(Math.cos(base + off) * 220) / 100, vy: Math.round(Math.sin(base + off) * 220) / 100 });
    }
    const size = a.kind === "boss" ? 10 : 6;
    if (d.swing > 0 && !d.swingHits.includes(a.id) && overlap(reach.x, reach.y, 9, 9, a.x, a.y, size, size)) {
      d.swingHits = [...d.swingHits, a.id];
      a.hp -= Math.max(1, d.attack);
      a.x += d.face === "left" ? -6 : d.face === "right" ? 6 : 0;
      if (a.hp <= 0) { a.dead = true; d.kills++; }
    } else if (overlap(d.px, d.py, HW, HH, a.x, a.y, size, size)) hurt(dmg, a.x);
  }
  // Player shots.
  for (const b of [...data.bolts, ...d.bolts.splice(0)]) {
    const n = { x: Math.round((b.x + b.vx) * 100) / 100, y: Math.round((b.y + b.vy) * 100) / 100, vx: b.vx, vy: b.vy };
    if (solidCh(d, Math.floor(n.x / T), Math.floor(n.y / T))) continue;
    const target = d.actors.find(a => !a.dead && overlap(n.x, n.y, 2, 2, a.x, a.y, a.kind === "boss" ? 10 : 6, a.kind === "boss" ? 10 : 6));
    if (target) { target.hp -= Math.max(1, Math.round(d.attack * 0.6)); if (target.hp <= 0) { target.dead = true; d.kills++; } continue; }
    d.bolts.push(n);
  }
  // Enemy shots.
  for (const s of [...data.shots, ...d.shots.splice(0)]) {
    const n = { x: Math.round((s.x + s.vx) * 100) / 100, y: Math.round((s.y + s.vy) * 100) / 100, vx: s.vx, vy: s.vy };
    if (solidCh(d, Math.floor(n.x / T), Math.floor(n.y / T)) || n.x < 0 || n.y < 0 || n.x > d.w * T || n.y > d.h * T) continue;
    if (overlap(d.px, d.py, HW, HH, n.x, n.y, 2, 2)) { hurt(dmg, n.x); continue; }
    d.shots.push(n);
  }
  d.actors = d.actors.filter(a => !a.dead || a.kind === "boss");
  return d;
}

/** Guard vision: within `sight`, inside a ~70° cone in its walking direction, and not behind a wall. */
function sees(d: ActionData, a: Actor): boolean {
  const vx = d.px - a.x, vy = d.py - a.y, dist = Math.hypot(vx, vy);
  if (dist > d.args.sight || dist < 1) return false;
  const fx = Math.sign(a.vx) || 1;
  if ((vx * fx) / dist < Math.cos(0.6)) return false;
  for (let i = 1; i < dist / 4; i++) { const t = (i * 4) / dist; if (solidCh(d, Math.floor((a.x + vx * t) / T), Math.floor((a.y + vy * t) / T))) return false; }
  return true;
}

export type ActionStatus = "playing" | "win" | "lose";
export function actionStatus(d: ActionData): ActionStatus {
  if (d.hp <= 0 || d.caught) return "lose";
  const g = d.args.goal;
  const elapsed = d.frame / FPS;
  if (g === "exit" && tileAt(d, d.px, d.py) === "G") return "win";
  if (g === "collect" && d.coins.length >= d.coinTotal) return "win";
  if (g === "defeat") {
    const boss = d.actors.find(a => a.kind === "boss");
    if (boss ? boss.dead : d.args.kills ? d.kills >= d.args.kills : !d.actors.some(a => !a.dead) && !d.spawners.length) return "win";
    if (!boss && d.spawners.length && !d.args.kills && d.kills >= 10) return "win";
  }
  if (g === "survive" && d.args.seconds && elapsed >= d.args.seconds) return "win";
  if (g !== "survive" && d.args.seconds && elapsed >= d.args.seconds) return "lose";
  return "playing";
}

export default defineSystem({
  id: "action",
  scenes: {
    stage: {
      title: "アクション（横スクロール／見下ろし。足場・敵・ゴール・ボス）",
      realtime: { fps: FPS },
      checkArgs: args => { const r = ActionArgsSchema.safeParse(args); return r.success ? checkActionLevel(r.data.rows, r.data.goal) : issues(r); },
      start: (ctx, raw) => startAction(ctx, raw),
      input(ctx, raw, input) {
        const data = raw as ActionData;
        if (input.type === "cancel") return data.args.canFlee || !(ctx.state.scene as { battle?: unknown }).battle ? finish(ctx, data.args, "quit", "あきらめて引き返した。", data.hp) : {};
        if (input.type !== "frame") return {};
        const next = stepAction(ctx, data, input.held);
        const status = actionStatus(next);
        if (status === "win") return finish(ctx, data.args, "win", `${data.args.title || "ステージ"}を突破した！（${Math.round(next.frame / FPS)}秒・コイン${next.coins.length}）`, next.hp);
        if (status === "lose") return finish(ctx, data.args, "lose", next.caught ? "見つかってしまった……" : next.hp <= 0 ? "力尽きた……" : "時間切れだ……", next.hp);
        return { data: next };
      },
      draw(g, view) {
        const d = view.data as ActionData;
        const rowsShown = Math.max(11, Math.min(d.h, 14));
        const scale = view.height / (rowsShown * T);
        const viewW = view.width / scale, viewH = view.height / scale;
        // Small stages are centred (top view) or sit on the bottom of the screen (side view).
        const camX = d.w * T <= viewW ? (d.w * T - viewW) / 2 : Math.max(0, Math.min(d.w * T - viewW, d.px - viewW / 2));
        const camY = d.h * T <= viewH ? (d.args.view === "side" ? d.h * T - viewH + 8 : (d.h * T - viewH) / 2) : Math.max(0, Math.min(d.h * T - viewH, d.py - viewH / 2));
        g.imageSmoothingEnabled = false;
        g.fillStyle = d.args.view === "side" ? "#1b2433" : "#25301f"; g.fillRect(0, 0, view.width, view.height);
        g.save(); g.scale(scale, scale); g.translate(-Math.round(camX), -Math.round(camY));
        for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
          const ch = d.rows[y]![x];
          const X = x * T, Y = y * T;
          if (ch === "#") { g.fillStyle = d.args.view === "side" ? "#6b5a45" : "#4b5048"; g.fillRect(X, Y, T, T); g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(X, Y + T - 3, T, 3); g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(X, Y, T, 2); }
          else if (ch === "^") { g.fillStyle = "#c9c9c9"; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(X + i * 5.3, Y + T); g.lineTo(X + i * 5.3 + 2.6, Y + 6); g.lineTo(X + i * 5.3 + 5.3, Y + T); g.fill(); } }
          else if (ch === "*" && !d.coins.includes(`${x},${y}`)) { g.fillStyle = "#f0c36a"; g.beginPath(); g.arc(X + 8, Y + 8, 4 + Math.sin((d.frame + x * 5) / 6), 0, Math.PI * 2); g.fill(); }
          else if (ch === "G") { g.fillStyle = "#e9dcb8"; g.fillRect(X + 3, Y, 2, T); g.fillStyle = "#7fc46b"; g.fillRect(X + 5, Y + 1, 9, 6); }
        }
        for (const s of d.spawners) { g.strokeStyle = "rgba(217,116,91,.6)"; g.strokeRect(s.x - 7, s.y - 7, 14, 14); }
        const enemy = enemyOf({ content: view.content, state: view.state }, d.args.enemyId);
        for (const a of d.actors) {
          if (a.dead) continue;
          if (a.kind === "boss") {
            const c = document.createElement("canvas"); c.width = c.height = 32;
            const asset = enemy?.sprite ? view.content.assets.assets.find(x => x.id === enemy.sprite) : undefined;
            drawEnemyPortrait(c.getContext("2d")!, enemy?.id ?? "boss", 32, view.time, image(enemy?.sprite ? view.assetUrl(enemy.sprite) : undefined), asset);
            g.drawImage(c, a.x - 16, a.y - 18);
            g.fillStyle = "#d9745b"; g.fillRect(a.x - 14, a.y - 22, 28 * (a.hp / a.maxHp), 2);
            continue;
          }
          if (a.kind === "guard") {
            const fx = Math.sign(a.vx) || 1;
            g.fillStyle = "rgba(255,230,120,.16)"; g.beginPath(); g.moveTo(a.x, a.y); g.arc(a.x, a.y, d.args.sight, fx > 0 ? -0.6 : Math.PI - 0.6, fx > 0 ? 0.6 : Math.PI + 0.6); g.closePath(); g.fill();
          }
          g.fillStyle = { walker: "#c96b4f", flyer: "#9d7fd1", chaser: "#d9745b", turret: "#8a8f7a", boss: "", guard: "#6f7fb0" }[a.kind];
          if (a.kind === "turret") g.fillRect(a.x - 6, a.y - 6, 12, 12);
          else { g.beginPath(); g.arc(a.x, a.y, 6, 0, Math.PI * 2); g.fill(); }
          g.fillStyle = "#fff"; g.fillRect(a.x - 3 + Math.sign(d.px - a.x) * 2, a.y - 2, 2, 2); g.fillRect(a.x + 1 + Math.sign(d.px - a.x) * 2, a.y - 2, 2, 2);
        }
        g.fillStyle = "#f6e27a";
        for (const b of d.bolts) g.fillRect(b.x - 2, b.y - 1, 4, 2);
        g.fillStyle = "#ff8a5c";
        for (const s of d.shots) { g.beginPath(); g.arc(s.x, s.y, 2.5, 0, Math.PI * 2); g.fill(); }
        if (!(d.inv > 0 && Math.floor(d.frame / 3) % 2 === 0)) {
          const row = { down: 0, left: 1, right: 2, up: 3 }[d.face];
          const moving = d.held.some(b => b === "left" || b === "right" || (d.args.view === "top" && (b === "up" || b === "down")));
          drawHero(g, view, d.px, d.py - 2, 20, row, moving ? Math.floor(d.frame / 5) : 0);
        }
        if (d.swing > 0) {
          const rx = d.px + (d.face === "left" ? -14 : d.face === "right" ? 14 : 0), ry = d.py + (d.face === "up" ? -14 : d.face === "down" ? 14 : 0);
          g.strokeStyle = "rgba(255,240,200,.9)"; g.lineWidth = 2; g.beginPath(); g.arc(rx, ry, 8, 0, Math.PI * 2 * (d.swing / 8)); g.stroke();
        }
        g.restore();
        g.fillStyle = "rgba(10,14,20,.7)"; g.fillRect(0, 0, view.width, 26);
        g.fillStyle = "#e9dcb8"; g.font = "13px system-ui"; g.textAlign = "left";
        const goalText = { exit: "ゴール(旗)へ", defeat: enemy ? `${enemy.name}を倒せ` : "敵を倒せ", collect: `コイン ${d.coins.length}/${d.coinTotal}`, survive: `生きのびろ ${Math.max(0, Math.ceil(d.args.seconds - d.frame / FPS))}秒` }[d.args.goal];
        g.fillText(`HP ${d.hp}/${d.maxHp}　${goalText}${d.args.seconds && d.args.goal !== "survive" ? `　残り${Math.max(0, Math.ceil(d.args.seconds - d.frame / FPS))}秒` : ""}　${d.message}`, 10, 18);
        g.textAlign = "right"; g.fillStyle = "#a9b09d";
        g.fillText(d.args.view === "side" ? "←→ 移動　↑ ジャンプ　Z 攻撃　Shift ダッシュ　Esc やめる" : "←↑↓→ 移動　Z 攻撃　Shift ダッシュ　Esc やめる", view.width - 10, 18);
      },
    },
  },
});

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
import { defineSystem, type SceneDefinition, type SystemContext } from "../../engine/src/index";
import { drawEnemyPortrait } from "../../runtime/src/render";
import { assetRefErrors, drawHero, drawSprite, drawTile, enemyOf, finish, heroOf, image, issues, OutcomeArgs, pressed } from "./common";
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
  /** Draw level characters with the project's tileset: { "#": "w", "^": "R", "G": "o" } (tiles.json codes). Floor too with " ". */
  tiles: z.record(z.string().length(1), z.string().length(1)).default({}),
  /** Character assets for enemies by letter: { "w": "village-guard", "c": "…" }. */
  sprites: z.record(z.string().length(1), z.string()).default({}),
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
  /** Co-op: player 2 (null in single player). */
  p2: Hero | null;
}

export function checkActionLevel(rows: string[], goal: string): string[] {
  const out: string[] = [];
  const all = rows.join("");
  rows.forEach((row, y) => Array.from(row).forEach((ch, x) => { if (!"#^*G@2wfctsBg .".includes(ch)) out.push(`rows[${y}]: 使えない文字 '${ch}' (x=${x})`); }));
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

export function startAction(ctx: SystemContext, raw: Record<string, unknown>, coop = false): ActionData {
  const args = ActionArgsSchema.parse(raw);
  const width = Math.max(...args.rows.map(r => r.length));
  const hero = heroOf(ctx);
  let p2Start: { x: number; y: number } | undefined;
  const d: ActionData = {
    args, frame: 0, seed: ctx.state.rng || 1, rows: [], w: width, h: args.rows.length, sx: 0, sy: 0, px: 0, py: 0, vx: 0, vy: 0, onGround: false, face: "right",
    hp: hero.hp, maxHp: hero.maxHp, attack: hero.attack, defense: hero.defense, inv: 0, swing: 0, swingHits: [], coins: [], coinTotal: 0, actors: [], shots: [], spawners: [], nextId: 1, kills: 0, held: [], message: args.title, aimX: 1, aimY: 0, bolts: [], caught: false, alarm: false, p2: null,
  };
  const enemy = enemyOf(ctx, args.enemyId);
  d.rows = args.rows.map((row, y) => Array.from(row.padEnd(width, " ")).map((ch, x) => {
    const cx = x * T + T / 2, cy = y * T + T / 2;
    if (ch === "@") { d.sx = d.px = cx; d.sy = d.py = cy; return " "; }
    if (ch === "2") { p2Start = { x: cx, y: cy }; return " "; }
    if (ch === "*") { d.coinTotal++; return "*"; }
    if (ch === "s") { d.spawners.push({ x: cx, y: cy }); return " "; }
    const kind = ({ w: "walker", f: "flyer", c: "chaser", t: "turret", B: "boss", g: "guard" } as Record<string, Kind | undefined>)[ch];
    if (kind) { d.actors.push(makeActor(d, kind, cx, cy, kind === "boss" ? Math.max(1, Math.round((enemy?.stats.maxHp ?? 20) * args.hpScale)) : args.enemyHp)); return " "; }
    return ch === "." ? " " : ch;
  }).join(""));
  if (coop) {
    const at = p2Start ?? { x: d.px + T, y: d.py };
    d.p2 = { ...p1Of(d), px: at.x, py: at.y, sx: at.x, sy: at.y, held: [], swingHits: [] };
  }
  return d;
}

function contactDamage(ctx: SystemContext, d: ActionData): number {
  if (d.args.enemyDamage) return d.args.enemyDamage;
  return Math.max(1, (enemyOf(ctx, d.args.enemyId)?.stats.attack ?? 4) - d.defense);
}

/** One hero (player 1 lives in the top-level ActionData fields; player 2 in `p2`). */
export interface Hero {
  px: number; py: number; vx: number; vy: number; onGround: boolean; face: "left" | "right" | "up" | "down";
  hp: number; maxHp: number; attack: number; defense: number; inv: number; swing: number; swingHits: number[]; aimX: number; aimY: number; held: string[]; sx: number; sy: number;
}
const HERO_KEYS = ["px", "py", "vx", "vy", "onGround", "face", "hp", "maxHp", "attack", "defense", "inv", "swing", "swingHits", "aimX", "aimY", "held", "sx", "sy"] as const;
const p1Of = (d: ActionData): Hero => Object.fromEntries(HERO_KEYS.map(k => [k, d[k]])) as unknown as Hero;
/** Both heroes (player 2 only in co-op). */
export const heroesOf = (d: ActionData): Hero[] => (d.p2 ? [p1Of(d), d.p2] : [p1Of(d)]);

function hurtHero(d: ActionData, h: Hero, amount: number, fromX: number) {
  if (h.inv > 0 || h.hp <= 0) return;
  h.hp = Math.max(0, h.hp - amount); h.inv = 30;
  if (d.args.view === "side") { h.vy = -4; h.vx = h.px < fromX ? -3 : 3; }
}

function updateHero(d: ActionData, h: Hero, held: string[]) {
  const now = pressed(held, h.held);
  h.held = held;
  h.inv = Math.max(0, h.inv - 1); h.swing = Math.max(0, h.swing - 1);
  if (h.hp <= 0) return;
  const side = d.args.view === "side";
  const locked = d.args.aim === "lock" && held.includes("focus");
  const speed = d.args.playerSpeed * (held.includes("focus") && !locked ? 1.7 : 1);
  const dx = (held.includes("right") ? 1 : 0) - (held.includes("left") ? 1 : 0);
  if (side) {
    h.vx = dx * speed + (h.inv > 20 ? h.vx * 0.5 : 0);
    if (dx && !locked) { h.face = dx > 0 ? "right" : "left"; h.aimX = dx; h.aimY = 0; }
    if (now.includes("up") && h.onGround) h.vy = -d.args.jump;
    if (!held.includes("up") && h.vy < -3) h.vy = -3;
    h.vy = Math.min(8, h.vy + d.args.gravity);
    const m = moveBox(d, h.px, h.py, HW, HH, h.vx, h.vy);
    h.onGround = m.hitY && h.vy > 0;
    if (m.hitY) h.vy = 0;
    h.px = m.x; h.py = m.y;
    if (h.py > d.h * T + 32) { hurtHero(d, h, Math.max(1, Math.floor(h.maxHp / 4)), h.px); h.px = h.sx; h.py = h.sy; h.vx = h.vy = 0; h.inv = 30; }
  } else {
    const dy = (held.includes("down") ? 1 : 0) - (held.includes("up") ? 1 : 0);
    const norm = dx && dy ? Math.SQRT1_2 : 1;
    if ((dx || dy) && !locked) { h.face = dy < 0 ? "up" : dy > 0 ? "down" : dx > 0 ? "right" : "left"; h.aimX = dx * norm; h.aimY = dy * norm; }
    const m = moveBox(d, h.px, h.py, HW, HW, dx * speed * norm, dy * speed * norm);
    h.px = m.x; h.py = m.y;
  }
  if (d.args.weapon === "gun") {
    if (now.includes("fire") || (held.includes("fire") && d.frame % 6 === 0) || (d.args.autoAttack && d.frame % 12 === 0)) d.bolts.push({ x: h.px + h.aimX * 8, y: h.py + h.aimY * 8, vx: Math.round(h.aimX * 600) / 100, vy: Math.round(h.aimY * 600) / 100 });
  } else if (now.includes("fire") || (d.args.autoAttack && d.frame % 15 === 0)) { h.swing = 8; h.swingHits = []; }
  const here = tileAt(d, h.px, h.py);
  const key = `${Math.floor(h.px / T)},${Math.floor(h.py / T)}`;
  if (here === "*" && !d.coins.includes(key)) d.coins = [...d.coins, key];
  if (here === "^" || tileAt(d, h.px, h.py + HH) === "^") hurtHero(d, h, Math.max(1, Math.floor(h.maxHp / 5)), h.px);
}

/** One fixed 1/30 s step. Pure and deterministic. In co-op, buttons prefixed "p2" drive player 2. */
export function stepAction(ctx: SystemContext, data: ActionData, held: string[]): ActionData {
  const d: ActionData = { ...data, frame: data.frame + 1, actors: data.actors.map(a => ({ ...a })), shots: [], bolts: [], p2: data.p2 ? { ...data.p2, swingHits: [...data.p2.swingHits] } : null };
  const side = d.args.view === "side";
  const heroes = heroesOf(d).map(h => ({ ...h, swingHits: [...h.swingHits] }));
  const inputs = d.p2 ? [held.filter(b => !b.startsWith("p2")), held.filter(b => b.startsWith("p2")).map(b => b.slice(2))] : [held];
  heroes.forEach((h, i) => updateHero(d, h, inputs[i]!));
  const alive = heroes.filter(h => h.hp > 0);
  // Spawners.
  if (d.frame % d.args.spawnEvery === 0) for (const s of d.spawners) if (d.actors.filter(a => !a.dead).length < 30) d.actors.push(makeActor(d, "chaser", s.x, s.y, d.args.enemyHp));
  // Enemies chase / shoot the nearest living hero.
  const dmg = contactDamage(ctx, d);
  for (const a of d.actors) {
    if (a.dead) continue;
    a.t++;
    const target = alive.slice().sort((p, q) => Math.hypot(p.px - a.x, p.py - a.y) - Math.hypot(q.px - a.x, q.py - a.y))[0] ?? heroes[0]!;
    const toward = Math.sign(target.px - a.x) || 1;
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
        const dist = Math.hypot(target.px - a.x, target.py - a.y) || 1;
        const m = moveBox(d, a.x, a.y, 6, 6, ((target.px - a.x) / dist) * sp, ((target.py - a.y) / dist) * sp);
        a.x = m.x; a.y = m.y;
      }
    } else if (a.kind === "guard") {
      const m = moveBox(d, a.x, a.y, 6, 6, a.vx * 0.6, side ? Math.min(6, a.vy + d.args.gravity) : 0);
      a.vy = side && !m.hitY ? Math.min(6, a.vy + d.args.gravity) : 0;
      const ahead = side && m.hitY && !solidCh(d, Math.floor((m.x + Math.sign(a.vx) * 8) / T), Math.floor((m.y + 10) / T));
      if (m.hitX || ahead || a.t % 150 === 0) a.vx = -a.vx;
      a.x = m.x; a.y = m.y;
      if (alive.some(h => sees(d, a, h))) {
        if (d.args.seen === "lose") d.caught = true;
        else if (!d.alarm) { d.alarm = true; d.message = "見つかった！"; for (const o of d.actors) if (o.kind === "guard") o.kind = "chaser"; }
      }
    }
    if ((a.kind === "turret" && a.t % 70 === 0) || (a.kind === "boss" && a.t % 55 === 0)) {
      const base = Math.atan2(target.py - a.y, target.px - a.x);
      for (const off of a.kind === "boss" ? [-0.3, 0, 0.3] : [0]) d.shots.push({ x: a.x, y: a.y, vx: Math.round(Math.cos(base + off) * 220) / 100, vy: Math.round(Math.sin(base + off) * 220) / 100 });
    }
    const size = a.kind === "boss" ? 10 : 6;
    let struck = false;
    for (const h of alive) {
      const reach = { x: h.px + (h.face === "left" ? -14 : h.face === "right" ? 14 : 0), y: h.py + (h.face === "up" ? -14 : h.face === "down" ? 14 : 0) };
      if (h.swing > 0 && !h.swingHits.includes(a.id) && overlap(reach.x, reach.y, 9, 9, a.x, a.y, size, size)) {
        h.swingHits.push(a.id); struck = true;
        a.hp -= Math.max(1, h.attack);
        a.x += h.face === "left" ? -6 : h.face === "right" ? 6 : 0;
        if (a.hp <= 0 && !a.dead) { a.dead = true; d.kills++; }
      }
    }
    if (!struck && !a.dead) for (const h of alive) if (overlap(h.px, h.py, HW, HH, a.x, a.y, size, size)) hurtHero(d, h, dmg, a.x);
  }
  // Player shots.
  for (const b of [...data.bolts, ...d.bolts.splice(0)]) {
    const n = { x: Math.round((b.x + b.vx) * 100) / 100, y: Math.round((b.y + b.vy) * 100) / 100, vx: b.vx, vy: b.vy };
    if (solidCh(d, Math.floor(n.x / T), Math.floor(n.y / T))) continue;
    const target = d.actors.find(a => !a.dead && overlap(n.x, n.y, 2, 2, a.x, a.y, a.kind === "boss" ? 10 : 6, a.kind === "boss" ? 10 : 6));
    if (target) { target.hp -= Math.max(1, Math.round(heroes[0]!.attack * 0.6)); if (target.hp <= 0) { target.dead = true; d.kills++; } continue; }
    d.bolts.push(n);
  }
  // Enemy shots.
  for (const s of [...data.shots, ...d.shots.splice(0)]) {
    const n = { x: Math.round((s.x + s.vx) * 100) / 100, y: Math.round((s.y + s.vy) * 100) / 100, vx: s.vx, vy: s.vy };
    if (solidCh(d, Math.floor(n.x / T), Math.floor(n.y / T)) || n.x < 0 || n.y < 0 || n.x > d.w * T || n.y > d.h * T) continue;
    const hit = alive.find(h => overlap(h.px, h.py, HW, HH, n.x, n.y, 2, 2));
    if (hit) { hurtHero(d, hit, dmg, n.x); continue; }
    d.shots.push(n);
  }
  d.actors = d.actors.filter(a => !a.dead || a.kind === "boss");
  Object.assign(d, Object.fromEntries(HERO_KEYS.map(k => [k, heroes[0]![k]])));
  if (d.p2) d.p2 = heroes[1]!;
  return d;
}

/** Guard vision: within `sight`, inside a ~70° cone in its walking direction, and not behind a wall. */
function sees(d: ActionData, a: Actor, h: Hero): boolean {
  const vx = h.px - a.x, vy = h.py - a.y, dist = Math.hypot(vx, vy);
  if (dist > d.args.sight || dist < 1) return false;
  const fx = Math.sign(a.vx) || 1;
  if ((vx * fx) / dist < Math.cos(0.6)) return false;
  for (let i = 1; i < dist / 4; i++) { const t = (i * 4) / dist; if (solidCh(d, Math.floor((a.x + vx * t) / T), Math.floor((a.y + vy * t) / T))) return false; }
  return true;
}

export type ActionStatus = "playing" | "win" | "lose";
export function actionStatus(d: ActionData): ActionStatus {
  const heroes = heroesOf(d);
  if (heroes.every(h => h.hp <= 0) || d.caught) return "lose";
  const g = d.args.goal;
  const elapsed = d.frame / FPS;
  if (g === "exit" && heroes.some(h => h.hp > 0 && tileAt(d, h.px, h.py) === "G")) return "win";
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

const stageScene = (coop: boolean): SceneDefinition => ({
      title: coop ? "アクション2人協力（同じキーボード・ゲームパッド2台）" : "アクション（横スクロール／見下ろし。足場・敵・ゴール・ボス）",
      realtime: { fps: FPS, players: coop ? 2 : 1 },
      checkArgs: (args, { content }) => { const r = ActionArgsSchema.safeParse(args); return r.success ? [...checkActionLevel(r.data.rows, r.data.goal), ...assetRefErrors(content, r.data.tiles, r.data.sprites)] : issues(r); },
      start: (ctx, raw) => startAction(ctx, raw, coop),
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
        const living = heroesOf(d).filter(h => h.hp > 0);
        const focusX = living.length ? living.reduce((sum, h) => sum + h.px, 0) / living.length : d.px, focusY = living.length ? living.reduce((sum, h) => sum + h.py, 0) / living.length : d.py;
        const camX = d.w * T <= viewW ? (d.w * T - viewW) / 2 : Math.max(0, Math.min(d.w * T - viewW, focusX - viewW / 2));
        const camY = d.h * T <= viewH ? (d.args.view === "side" ? d.h * T - viewH + 8 : (d.h * T - viewH) / 2) : Math.max(0, Math.min(d.h * T - viewH, focusY - viewH / 2));
        g.imageSmoothingEnabled = false;
        g.fillStyle = d.args.view === "side" ? "#1b2433" : "#25301f"; g.fillRect(0, 0, view.width, view.height);
        g.save(); g.scale(scale, scale); g.translate(-Math.round(camX), -Math.round(camY));
        for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
          const ch = d.rows[y]![x];
          const X = x * T, Y = y * T;
          if (d.args.tiles[" "] && ch !== "#") drawTile(g, view, d.args.tiles[" "], X, Y, T);
          if (d.args.tiles[ch!] && !(ch === "*" && d.coins.includes(`${x},${y}`)) && drawTile(g, view, d.args.tiles[ch!]!, X, Y, T)) continue;
          if (ch === "#") { g.fillStyle = d.args.view === "side" ? "#6b5a45" : "#4b5048"; g.fillRect(X, Y, T, T); g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(X, Y + T - 3, T, 3); g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(X, Y, T, 2); }
          else if (ch === "^") { g.fillStyle = "#c9c9c9"; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(X + i * 5.3, Y + T); g.lineTo(X + i * 5.3 + 2.6, Y + 6); g.lineTo(X + i * 5.3 + 5.3, Y + T); g.fill(); } }
          else if (ch === "*" && !d.coins.includes(`${x},${y}`)) { g.fillStyle = "#f0c36a"; g.beginPath(); g.arc(X + 8, Y + 8, 4 + Math.sin((d.frame + x * 5) / 6), 0, Math.PI * 2); g.fill(); }
          else if (ch === "G") { g.fillStyle = "#e9dcb8"; g.fillRect(X + 3, Y, 2, T); g.fillStyle = "#7fc46b"; g.fillRect(X + 5, Y + 1, 9, 6); }
        }
        for (const s of d.spawners) { g.strokeStyle = "rgba(217,116,91,.6)"; g.strokeRect(s.x - 7, s.y - 7, 14, 14); }
        const enemy = enemyOf({ content: view.content, state: view.state }, d.args.enemyId);
        for (const a of d.actors) {
          if (a.dead) continue;
          if (a.kind === "boss" && !d.args.sprites.B) {
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
          const letter = { walker: "w", flyer: "f", chaser: "c", turret: "t", boss: "B", guard: "g" }[a.kind];
          if (d.args.sprites[letter] && drawSprite(g, view, d.args.sprites[letter], a.x, a.y - 2, 18, a.vx < 0 ? 1 : a.vx > 0 ? 2 : 0, Math.floor(d.frame / 6))) continue;
          g.fillStyle = { walker: "#c96b4f", flyer: "#9d7fd1", chaser: "#d9745b", turret: "#8a8f7a", boss: "", guard: "#6f7fb0" }[a.kind];
          if (a.kind === "turret") g.fillRect(a.x - 6, a.y - 6, 12, 12);
          else { g.beginPath(); g.arc(a.x, a.y, 6, 0, Math.PI * 2); g.fill(); }
          g.fillStyle = "#fff"; g.fillRect(a.x - 3 + Math.sign(d.px - a.x) * 2, a.y - 2, 2, 2); g.fillRect(a.x + 1 + Math.sign(d.px - a.x) * 2, a.y - 2, 2, 2);
        }
        g.fillStyle = "#f6e27a";
        for (const b of d.bolts) g.fillRect(b.x - 2, b.y - 1, 4, 2);
        g.fillStyle = "#ff8a5c";
        for (const s of d.shots) { g.beginPath(); g.arc(s.x, s.y, 2.5, 0, Math.PI * 2); g.fill(); }
        heroesOf(d).forEach((h, i) => {
          if (h.hp <= 0) { g.globalAlpha = 0.35; drawHero(g, view, h.px, h.py - 2, 20, 0, 0); g.globalAlpha = 1; return; }
          if (!(h.inv > 0 && Math.floor(d.frame / 3) % 2 === 0)) {
            const row = { down: 0, left: 1, right: 2, up: 3 }[h.face];
            const moving = h.held.some(b => b === "left" || b === "right" || (d.args.view === "top" && (b === "up" || b === "down")));
            if (i === 1) g.filter = "hue-rotate(160deg)";
            drawHero(g, view, h.px, h.py - 2, 20, row, moving ? Math.floor(d.frame / 5) : 0);
            g.filter = "none";
            if (d.p2) { g.fillStyle = i ? "#7fd1e0" : "#f0c36a"; g.font = "6px system-ui"; g.textAlign = "center"; g.fillText(i ? "2P" : "1P", h.px, h.py - 14); }
          }
          if (h.swing > 0) {
            const rx = h.px + (h.face === "left" ? -14 : h.face === "right" ? 14 : 0), ry = h.py + (h.face === "up" ? -14 : h.face === "down" ? 14 : 0);
            g.strokeStyle = "rgba(255,240,200,.9)"; g.lineWidth = 2; g.beginPath(); g.arc(rx, ry, 8, 0, Math.PI * 2 * (h.swing / 8)); g.stroke();
          }
        });
        g.restore();
        g.fillStyle = "rgba(10,14,20,.7)"; g.fillRect(0, 0, view.width, 26);
        g.fillStyle = "#e9dcb8"; g.font = "13px system-ui"; g.textAlign = "left";
        const goalText = { exit: "ゴール(旗)へ", defeat: enemy ? `${enemy.name}を倒せ` : "敵を倒せ", collect: `コイン ${d.coins.length}/${d.coinTotal}`, survive: `生きのびろ ${Math.max(0, Math.ceil(d.args.seconds - d.frame / FPS))}秒` }[d.args.goal];
        g.fillText(`${d.p2 ? `1P ${d.hp}/${d.maxHp}　2P ${d.p2.hp}/${d.p2.maxHp}` : `HP ${d.hp}/${d.maxHp}`}　${goalText}${d.args.seconds && d.args.goal !== "survive" ? `　残り${Math.max(0, Math.ceil(d.args.seconds - d.frame / FPS))}秒` : ""}　${d.message}`, 10, 18);
        g.textAlign = "right"; g.fillStyle = "#a9b09d";
        if (d.p2) g.fillText("1P: WASD 移動・ジャンプ  F 攻撃  G ダッシュ ／ 2P: 矢印  Enter 攻撃  / ダッシュ", view.width - 10, 18);
        else g.fillText(d.args.view === "side" ? "←→ 移動　↑ ジャンプ　Z 攻撃　Shift ダッシュ　Esc やめる" : "←↑↓→ 移動　Z 攻撃　Shift ダッシュ　Esc やめる", view.width - 10, 18);
      },
});

export default defineSystem({ id: "action", scenes: { stage: stageScene(false), coop: stageScene(true) } });

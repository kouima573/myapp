/**
 * Genre module: tower defense (realtime). Enemies walk the path from S to H in waves; build towers on free tiles
 * with gold earned from kills. Covers tower defense, base / village defense, siege events.
 *   S spawn   H home (base)   = path   . buildable   # scenery
 * Controls: arrows move the cursor, Z builds / upgrades, Shift changes the tower, clicks build where you click.
 */
import { z } from "zod";
import { IdSchema } from "../../schema/src/formats";
import { defineSystem, type SystemContext } from "../../engine/src/index";
import { assetRefErrors, drawSprite, drawTile, enemyOf, finish, heroOf, inBattle, issues, OutcomeArgs, pressed } from "./common";
import { asRecord } from "./ui";

const FPS = 30, T = 16;

const TowerSchema = z.object({
  id: IdSchema, label: z.string().min(1).max(8), cost: z.number().int().min(0).max(9999), range: z.number().min(8).max(400), damage: z.number().min(0).max(9999),
  /** Frames between shots. */
  rate: z.number().int().min(1).max(600), color: z.string().default("#e9dcb8"),
  /** Slows hit enemies to this speed factor for 1 s. */
  slow: z.number().min(0.05).max(1).optional(),
  /** Damages everything within this radius of the target. */
  splash: z.number().min(0).max(200).optional(),
}).strict();
const DEFAULT_TOWERS = [
  { id: "archer", label: "弓", cost: 10, range: 52, damage: 2, rate: 18, color: "#e9dcb8" },
  { id: "cannon", label: "砲", cost: 20, range: 44, damage: 5, rate: 45, color: "#d9745b", splash: 18 },
  { id: "frost", label: "氷", cost: 15, range: 44, damage: 1, rate: 22, color: "#7fd1e0", slow: 0.45 },
];
export const DefenseArgsSchema = z.object({
  title: z.string().default("防衛戦"),
  rows: z.array(z.string().min(1)).min(2),
  towers: z.array(TowerSchema).min(1).default(DEFAULT_TOWERS),
  waves: z.array(z.object({ count: z.number().int().min(1).max(200), hp: z.number().min(1).max(99999), speed: z.number().min(0.1).max(10).default(0.7), every: z.number().int().min(1).max(600).default(30), reward: z.number().int().min(0).default(2) }).strict()).min(1)
    .default([{ count: 6, hp: 6, speed: 0.7, every: 30, reward: 2 }, { count: 10, hp: 9, speed: 0.8, every: 24, reward: 2 }, { count: 12, hp: 14, speed: 0.9, every: 20, reward: 3 }]),
  gold: z.number().int().min(0).max(99999).default(30),
  /** Enemies that reach H cost lives. 0 = use the hero's HP. */
  lives: z.number().int().min(0).max(999).default(10),
  /** Seconds before the first wave and between waves. */
  pause: z.number().min(0).max(120).default(5),
  /** Draw with the project's tileset: map characters → tiles.json codes. */
  tiles: z.record(z.string().length(1), z.string().length(1)).default({}),
  /** Character asset for the attackers. */
  foeSprite: z.string().optional(),
  ...OutcomeArgs,
}).strict();
export type DefenseArgs = z.infer<typeof DefenseArgsSchema>;

interface Foe { id: number; s: number; hp: number; maxHp: number; speed: number; slow: number; reward: number }
interface Tower { x: number; y: number; kind: number; level: number; cool: number }
export interface DefenseData {
  args: DefenseArgs; frame: number; rows: string[]; w: number; h: number; path: Array<{ x: number; y: number }>;
  foes: Foe[]; towers: Tower[]; gold: number; lives: number; maxLives: number; wave: number; spawned: number; nextAt: number; nextId: number; kills: number;
  cursor: { x: number; y: number }; kind: number; held: string[]; shots: Array<{ x1: number; y1: number; x2: number; y2: number; t: number; color: string }>; hpScale: number; message: string;
}

export function pathOf(rows: string[]): Array<{ x: number; y: number }> {
  let start: { x: number; y: number } | undefined;
  rows.forEach((r, y) => { const x = r.indexOf("S"); if (x >= 0) start = { x, y }; });
  if (!start) return [];
  const prev = new Map<string, string>(), key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
  const queue = [start]; prev.set(key(start), "");
  while (queue.length) {
    const p = queue.shift()!;
    if (rows[p.y]![p.x] === "H") {
      const out = [p];
      for (let k = prev.get(key(p)); k; k = prev.get(k)) { const [x, y] = k.split(",").map(Number); out.unshift({ x: x!, y: y! }); }
      return out;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: p.x + dx!, y: p.y + dy! };
      const ch = rows[n.y]?.[n.x];
      if ((ch === "=" || ch === "H") && !prev.has(key(n))) { prev.set(key(n), key(p)); queue.push(n); }
    }
  }
  return [];
}

export function checkDefense(args: DefenseArgs): string[] {
  const all = args.rows.join("");
  const out: string[] = [];
  args.rows.forEach((row, y) => Array.from(row).forEach((ch, x) => { if (!"SH=.# ".includes(ch)) out.push(`rows[${y}]: 使えない文字 '${ch}' (x=${x})`); }));
  if ((all.match(/S/g) ?? []).length !== 1 || (all.match(/H/g) ?? []).length !== 1) out.push("出現地点 S と拠点 H はちょうど1つずつ必要です");
  else if (!pathOf(args.rows).length) out.push("S から H まで道（=）がつながっていません");
  if (!all.includes(".")) out.push("塔を建てられる場所（.）がありません");
  return out;
}

export function startDefense(ctx: SystemContext, raw: Record<string, unknown>): DefenseData {
  const args = DefenseArgsSchema.parse(raw);
  const w = Math.max(...args.rows.map(r => r.length));
  const rows = args.rows.map(r => r.padEnd(w, "#"));
  const lives = args.lives || heroOf(ctx).hp;
  const enemy = enemyOf(ctx, args.enemyId);
  const free = rows.flatMap((r, y) => Array.from(r).map((ch, x) => (ch === "." ? { x, y } : null))).find(Boolean)!;
  return { args, frame: 0, rows, w, h: rows.length, path: pathOf(rows), foes: [], towers: [], gold: args.gold, lives, maxLives: lives, wave: 0, spawned: 0, nextAt: Math.round(args.pause * FPS), nextId: 1, kills: 0, cursor: free, kind: 0, held: [], shots: [], hpScale: enemy ? Math.max(0.5, enemy.stats.maxHp / 10) : 1, message: `${args.title} — 塔を建てて備えよう` };
}

const towerAt = (d: DefenseData, x: number, y: number) => d.towers.find(t => t.x === x && t.y === y);
const foePos = (d: DefenseData, f: Foe) => {
  const i = Math.min(d.path.length - 1, Math.floor(f.s)), j = Math.min(d.path.length - 1, i + 1), t = f.s - i;
  const a = d.path[i]!, b = d.path[j]!;
  return { x: (a.x + (b.x - a.x) * t) * T + T / 2, y: (a.y + (b.y - a.y) * t) * T + T / 2 };
};

export function build(d: DefenseData, x: number, y: number): DefenseData {
  if (d.rows[y]?.[x] !== ".") return d;
  const existing = towerAt(d, x, y);
  const spec = d.args.towers[existing ? existing.kind : d.kind]!;
  const cost = existing ? Math.round(spec.cost * (existing.level + 1) * 0.75) : spec.cost;
  if (existing && existing.level >= 3) return { ...d, message: "これ以上強くできない" };
  if (d.gold < cost) return { ...d, message: `ゴールドが足りない（${cost}）` };
  const towers = existing ? d.towers.map(t => (t === existing ? { ...t, level: t.level + 1 } : t)) : [...d.towers, { x, y, kind: d.kind, level: 1, cool: 0 }];
  return { ...d, towers, gold: d.gold - cost, message: existing ? `${spec.label}を強化（Lv${existing.level + 1}）` : `${spec.label}を建てた` };
}

export function stepDefense(data: DefenseData, held: string[], click?: { x: number; y: number }): DefenseData {
  let d: DefenseData = { ...data, frame: data.frame + 1, held, foes: data.foes.map(f => ({ ...f })), towers: data.towers.map(t => ({ ...t })), shots: data.shots.filter(s => s.t > 1).map(s => ({ ...s, t: s.t - 1 })) };
  const now = pressed(held, data.held);
  for (const [b, dx, dy] of [["left", -1, 0], ["right", 1, 0], ["up", 0, -1], ["down", 0, 1]] as const) if (now.includes(b)) d.cursor = { x: Math.max(0, Math.min(d.w - 1, d.cursor.x + dx)), y: Math.max(0, Math.min(d.h - 1, d.cursor.y + dy)) };
  if (now.includes("focus")) d.kind = (d.kind + 1) % d.args.towers.length;
  if (click) { d.cursor = click; d = build(d, click.x, click.y); }
  else if (now.includes("fire")) d = build(d, d.cursor.x, d.cursor.y);
  // Waves.
  const wave = d.args.waves[d.wave];
  if (wave && d.frame >= d.nextAt) {
    d.foes.push({ id: d.nextId++, s: 0, hp: Math.round(wave.hp * d.hpScale), maxHp: Math.round(wave.hp * d.hpScale), speed: wave.speed, slow: 0, reward: wave.reward });
    d.spawned++;
    d.nextAt = d.frame + wave.every;
    if (d.spawned >= wave.count) { d.wave++; d.spawned = 0; d.nextAt = d.frame + Math.round(d.args.pause * FPS) + wave.every; d.message = d.wave < d.args.waves.length ? `第${d.wave + 1}波が来る` : "最後の波だ"; }
  }
  // Movement.
  for (const f of d.foes) {
    f.s += (f.speed * (f.slow > 0 ? 0.5 : 1)) / T * 1.6;
    if (f.slow > 0) f.slow--;
    if (f.s >= d.path.length - 1) { f.hp = 0; d.lives = Math.max(0, d.lives - 1); }
  }
  // Towers.
  for (const t of d.towers) {
    if (t.cool > 0) { t.cool--; continue; }
    const spec = d.args.towers[t.kind]!;
    const cx = t.x * T + T / 2, cy = t.y * T + T / 2, range = spec.range * (1 + (t.level - 1) * 0.15);
    const target = d.foes.filter(f => f.hp > 0).map(f => ({ f, p: foePos(d, f) })).filter(o => Math.hypot(o.p.x - cx, o.p.y - cy) <= range).sort((a, b) => b.f.s - a.f.s)[0];
    if (!target) continue;
    const dmg = spec.damage * (1 + (t.level - 1) * 0.6);
    const victims = spec.splash ? d.foes.filter(f => f.hp > 0 && Math.hypot(foePos(d, f).x - target.p.x, foePos(d, f).y - target.p.y) <= spec.splash!) : [target.f];
    for (const v of victims) { v.hp -= dmg; if (spec.slow) v.slow = FPS; if (v.hp <= 0) { d.gold += v.reward; d.kills++; } }
    t.cool = spec.rate;
    d.shots.push({ x1: cx, y1: cy, x2: target.p.x, y2: target.p.y, t: 4, color: spec.color });
  }
  d.foes = d.foes.filter(f => f.hp > 0);
  return d;
}

export function defenseStatus(d: DefenseData): "playing" | "win" | "lose" {
  if (d.lives <= 0) return "lose";
  if (d.wave >= d.args.waves.length && !d.foes.length) return "win";
  return "playing";
}

export default defineSystem({
  id: "defense",
  scenes: {
    siege: {
      title: "タワーディフェンス（道・波状攻撃・塔の建設と強化）",
      realtime: { fps: FPS },
      checkArgs: (args, { content }) => { const r = DefenseArgsSchema.safeParse(args); return r.success ? [...checkDefense(r.data), ...assetRefErrors(content, r.data.tiles, r.data.foeSprite ? { foe: r.data.foeSprite } : {})] : issues(r); },
      start: (ctx, raw) => startDefense(ctx, raw),
      input(ctx, raw, input) {
        const d = raw as DefenseData;
        if (input.type === "cancel") return d.args.canFlee || !inBattle(ctx) ? finish(ctx, d.args, "quit", "防衛をあきらめた。") : {};
        let next: DefenseData;
        if (input.type === "custom") {
          const click = asRecord(asRecord(input.value).click);
          if (typeof click.x !== "number") return {};
          const lay = layout(d, Number(click.width), Number(click.height));
          const tx = Math.floor((click.x - lay.ox) / lay.s / T), ty = Math.floor(((click.y as number) - lay.oy) / lay.s / T);
          if (tx < 0 || ty < 0 || tx >= d.w || ty >= d.h) return {};
          next = stepDefense(d, d.held, { x: tx, y: ty });
        } else if (input.type === "frame") next = stepDefense(d, input.held);
        else return {};
        const status = defenseStatus(next);
        const hp = d.args.lives ? undefined : next.lives;
        if (status === "win") return finish(ctx, d.args, "win", `${d.args.title}：守りきった！（撃破${next.kills}・残り${next.lives}）`, hp);
        if (status === "lose") return finish(ctx, d.args, "lose", "拠点が落ちた……", hp);
        return { data: next };
      },
      draw(g, view) {
        const d = view.data as DefenseData;
        const lay = layout(d, view.width, view.height);
        g.fillStyle = "#1a2016"; g.fillRect(0, 0, view.width, view.height);
        g.save(); g.translate(lay.ox, lay.oy); g.scale(lay.s, lay.s);
        for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
          const ch = d.rows[y]![x];
          if (d.args.tiles[ch!] && drawTile(g, view, d.args.tiles[ch!]!, x * T, y * T, T)) continue;
          g.fillStyle = ch === "#" ? "#2c3a26" : ch === "." ? "#4a5e3a" : ch === "H" ? "#7a5c3a" : ch === "S" ? "#5a2f2f" : "#8a7a5a";
          g.fillRect(x * T, y * T, T - 0.5, T - 0.5);
        }
        for (const t of d.towers) {
          const spec = d.args.towers[t.kind]!;
          g.fillStyle = spec.color; g.fillRect(t.x * T + 3, t.y * T + 3, T - 6, T - 6);
          g.fillStyle = "#111"; g.font = "7px system-ui"; g.textAlign = "center"; g.fillText(`${spec.label}${t.level > 1 ? t.level : ""}`, t.x * T + T / 2, t.y * T + 11);
        }
        for (const f of d.foes) { const p = foePos(d, f); if (d.args.foeSprite && drawSprite(g, view, d.args.foeSprite, p.x, p.y - 2, 14, 0, Math.floor(d.frame / 6))) { g.fillStyle = "#222"; g.fillRect(p.x - 5, p.y - 10, 10, 1.5); g.fillStyle = "#7fc46b"; g.fillRect(p.x - 5, p.y - 10, 10 * (f.hp / f.maxHp), 1.5); continue; } g.fillStyle = f.slow ? "#9fd6e8" : "#d9745b"; g.beginPath(); g.arc(p.x, p.y, 4.5, 0, Math.PI * 2); g.fill(); g.fillStyle = "#222"; g.fillRect(p.x - 5, p.y - 8, 10, 1.5); g.fillStyle = "#7fc46b"; g.fillRect(p.x - 5, p.y - 8, 10 * (f.hp / f.maxHp), 1.5); }
        for (const s of d.shots) { g.strokeStyle = s.color; g.lineWidth = 1; g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke(); }
        const spec = d.args.towers[d.kind]!;
        g.strokeStyle = "#f0c36a"; g.lineWidth = 1; g.strokeRect(d.cursor.x * T + 0.5, d.cursor.y * T + 0.5, T - 1, T - 1);
        g.strokeStyle = "rgba(240,195,106,.3)"; g.beginPath(); g.arc(d.cursor.x * T + T / 2, d.cursor.y * T + T / 2, spec.range, 0, Math.PI * 2); g.stroke();
        g.restore();
        g.fillStyle = "#e9dcb8"; g.font = "14px system-ui"; g.textAlign = "left";
        g.fillText(`${d.args.title}　第${Math.min(d.wave + 1, d.args.waves.length)}/${d.args.waves.length}波　ゴールド ${d.gold}　拠点 ${d.lives}/${d.maxLives}　建てる: ${d.args.towers.map((t, i) => `${i === d.kind ? "▶" : ""}${t.label}(${t.cost})`).join(" ")}`, 12, 22);
        g.fillStyle = "#a9b09d"; g.font = "12px system-ui";
        g.fillText(`${d.message}　｜ 矢印 カーソル　Z 建てる・強化　Shift 塔の種類　クリックでも建てられる　Esc やめる`, 12, view.height - 12);
      },
    },
  },
});

function layout(d: DefenseData, width: number, height: number) {
  const s = Math.min((width - 24) / (d.w * T), (height - 70) / (d.h * T));
  return { s, ox: (width - d.w * T * s) / 2, oy: 34 + (height - 70 - d.h * T * s) / 2 };
}

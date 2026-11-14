/**
 * Genre module: squad battle (realtime). Command a group: select units with the cursor and send them (attack-move),
 * or set auto: true and watch your formation fight on its own (auto-battler). Bases can be defended / destroyed.
 *   #  wall   @  hero (RPG stats)   a  ally (args.allies, in order, repeating)   e  enemy (args.enemies / RPG enemy)
 *   H  your base   E  enemy base
 */
import { z } from "zod";
import { defineSystem, type SceneDefinition, type SystemContext } from "../../engine/src/index";
import { assetRefErrors, drawHero, drawSprite, drawTile, enemyOf, finish, heroOf, inBattle, issues, OutcomeArgs, pressed } from "./common";
import { asRecord } from "./ui";

const FPS = 30, T = 16;
const UnitType = z.object({ name: z.string().min(1).max(12), hp: z.number().int().min(1).max(9999), attack: z.number().int().min(0).max(999), range: z.number().min(0.8).max(12).default(1.2), speed: z.number().min(0.01).max(0.3).default(0.06), color: z.string().default("#7fa8d9"), sprite: z.string().optional() }).strict();

export const SquadArgsSchema = z.object({
  title: z.string().default("部隊戦"),
  rows: z.array(z.string().min(1)).min(3),
  allies: z.array(UnitType).default([{ name: "兵", hp: 12, attack: 3, range: 1.2, speed: 0.06, color: "#7fa8d9" }, { name: "弓兵", hp: 8, attack: 2, range: 4, speed: 0.05, color: "#9fd28c" }]),
  enemies: z.array(UnitType).default([]),
  /** Auto-battler: nobody takes orders; both sides advance and fight. */
  auto: z.boolean().default(false),
  goal: z.enum(["rout", "base"]).default("rout"),
  baseHp: z.number().int().min(1).max(9999).default(40),
  seconds: z.number().min(0).max(3600).default(0),
  /** Draw with the project's tileset: map characters → tiles.json codes. */
  tiles: z.record(z.string().length(1), z.string().length(1)).default({}),
  ...OutcomeArgs,
}).strict();
export type SquadArgs = z.infer<typeof SquadArgsSchema>;

export interface Unit { id: number; side: 0 | 1; hero: boolean; name: string; x: number; y: number; hp: number; maxHp: number; attack: number; range: number; speed: number; color: string; sprite?: string; cool: number; dest?: { x: number; y: number }; selected: boolean }
export interface SquadData { args: SquadArgs; frame: number; rows: string[]; w: number; h: number; units: Unit[]; bases: Array<{ side: 0 | 1; x: number; y: number; hp: number; maxHp: number }>; cursor: { x: number; y: number }; held: string[]; message: string; lines: Array<[number, number, number, number, number]> }

export function checkSquad(a: SquadArgs): string[] {
  const all = a.rows.join("");
  const out: string[] = [];
  a.rows.forEach((row, y) => Array.from(row).forEach((ch, x) => { if (!"#@aeHE .".includes(ch)) out.push(`rows[${y}]: 使えない文字 '${ch}' (x=${x})`); }));
  if (!/[@a]/.test(all)) out.push("味方（@ か a）が必要です");
  if (!/[eE]/.test(all)) out.push("敵（e か E）が必要です");
  if (a.goal === "base" && !all.includes("E")) out.push("goal が base のときは敵の拠点 E が必要です");
  return out;
}

export function startSquad(ctx: SystemContext, raw: Record<string, unknown>): SquadData {
  const args = SquadArgsSchema.parse(raw);
  const hero = heroOf(ctx);
  const rpgEnemy = enemyOf(ctx, args.enemyId);
  const foes = args.enemies.length ? args.enemies : [{ name: rpgEnemy?.name ?? "敵兵", hp: rpgEnemy?.stats.maxHp ?? 10, attack: rpgEnemy?.stats.attack ?? 3, range: 1.2, speed: 0.05, color: "#d9745b" }];
  const w = Math.max(...args.rows.map(r => r.length));
  const units: Unit[] = [], bases: SquadData["bases"] = [];
  let id = 1, ai = 0, ei = 0;
  const rows = args.rows.map((row, y) => Array.from(row.padEnd(w, " ")).map((ch, x) => {
    const pos = { x: x + 0.5, y: y + 0.5, cool: 0, selected: false };
    if (ch === "@") units.push({ ...pos, id: id++, side: 0, hero: true, name: hero.name, hp: hero.hp, maxHp: hero.maxHp, attack: hero.attack, range: 1.2, speed: 0.07, color: "#f0c36a" });
    if (ch === "a") { const t = args.allies[ai++ % args.allies.length]!; units.push({ ...pos, id: id++, side: 0, hero: false, name: t.name, hp: t.hp, maxHp: t.hp, attack: t.attack, range: t.range, speed: t.speed, color: t.color, sprite: t.sprite }); }
    if (ch === "e") { const t = foes[ei++ % foes.length]!; units.push({ ...pos, id: id++, side: 1, hero: false, name: t.name, hp: t.hp, maxHp: t.hp, attack: t.attack, range: t.range ?? 1.2, speed: t.speed ?? 0.05, color: t.color ?? "#d9745b", sprite: (t as { sprite?: string }).sprite }); }
    if (ch === "H" || ch === "E") bases.push({ side: ch === "H" ? 0 : 1, x: x + 0.5, y: y + 0.5, hp: args.baseHp, maxHp: args.baseHp });
    return ch === "#" ? "#" : " ";
  }).join(""));
  return { args, frame: 0, rows, w, h: rows.length, units, bases, cursor: { x: units.find(u => u.side === 0)?.x ?? 1, y: units.find(u => u.side === 0)?.y ?? 1 }, held: [], message: args.auto ? "布陣完了。見守ろう。" : "Z で部隊を選び、Z で行き先を指示", lines: [] };
}

const wallAt = (d: SquadData, x: number, y: number) => d.rows[Math.floor(y)]?.[Math.floor(x)] !== " ";

/** Select / command at a map position (cells). */
export function command(d: SquadData, x: number, y: number): SquadData {
  const near = d.units.filter(u => u.side === 0 && u.hp > 0 && Math.hypot(u.x - x, u.y - y) < 1.6);
  const selected = d.units.filter(u => u.selected);
  if (near.length && !selected.some(u => near.includes(u))) return { ...d, units: d.units.map(u => ({ ...u, selected: near.includes(u) })), message: `${near.length}人を選んだ` };
  if (!selected.length) return { ...d, message: "味方の近くで決定して選ぶ" };
  return { ...d, units: d.units.map(u => (u.selected ? { ...u, dest: { x, y }, selected: false } : u)), message: `${selected.length}人に移動を命じた` };
}

export function stepSquad(data: SquadData, held: string[], click?: { x: number; y: number }): SquadData {
  let d: SquadData = { ...data, frame: data.frame + 1, held, units: data.units.map(u => ({ ...u })), bases: data.bases.map(b => ({ ...b })), lines: data.lines.filter(l => l[4] > 1).map(l => [l[0], l[1], l[2], l[3], l[4] - 1] as SquadData["lines"][number]) };
  const now = pressed(held, data.held);
  if (!d.args.auto) {
    const sp = 0.25;
    d.cursor = { x: Math.max(0, Math.min(d.w, d.cursor.x + ((held.includes("right") ? 1 : 0) - (held.includes("left") ? 1 : 0)) * sp)), y: Math.max(0, Math.min(d.h, d.cursor.y + ((held.includes("down") ? 1 : 0) - (held.includes("up") ? 1 : 0)) * sp)) };
    if (now.includes("focus")) d = { ...d, units: d.units.map(u => ({ ...u, selected: u.side === 0 && u.hp > 0 })), message: "全員を選んだ" };
    if (click) { d.cursor = click; d = command(d, click.x, click.y); }
    else if (now.includes("fire")) d = command(d, d.cursor.x, d.cursor.y);
  }
  const alive = d.units.filter(u => u.hp > 0);
  for (const u of alive) {
    if (u.cool > 0) u.cool--;
    const foes = [...alive.filter(o => o.side !== u.side && o.hp > 0).map(o => ({ x: o.x, y: o.y, unit: o as Unit | undefined })), ...d.bases.filter(b => b.side !== u.side && b.hp > 0).map(b => ({ x: b.x, y: b.y, unit: undefined }))];
    const nearest = foes.map(f => ({ ...f, dist: Math.hypot(f.x - u.x, f.y - u.y) })).sort((a, b) => a.dist - b.dist)[0];
    if (nearest && nearest.dist <= u.range) {
      if (u.cool === 0) {
        u.cool = 20;
        if (nearest.unit) nearest.unit.hp = Math.max(0, nearest.unit.hp - u.attack);
        else { const b = d.bases.find(b => b.x === nearest.x && b.y === nearest.y)!; b.hp = Math.max(0, b.hp - u.attack); }
        d.lines.push([u.x, u.y, nearest.x, nearest.y, 4]);
      }
      continue;
    }
    // Where to go: player orders, otherwise advance on anything in sight (always, in auto mode / for enemies).
    let goal = u.side === 0 && !d.args.auto ? u.dest : undefined;
    if (!goal && nearest && (u.side === 1 || d.args.auto || nearest.dist < 5)) goal = nearest;
    if (u.side === 0 && u.dest && nearest && nearest.dist < 3) goal = nearest;
    if (!goal) continue;
    const dx = goal.x - u.x, dy = goal.y - u.y, dist = Math.hypot(dx, dy);
    if (dist < 0.1) { if (u.dest) u.dest = undefined; continue; }
    const nx = u.x + (dx / dist) * u.speed, ny = u.y + (dy / dist) * u.speed;
    if (!wallAt(d, nx, u.y)) u.x = Math.round(nx * 1000) / 1000;
    if (!wallAt(d, u.x, ny)) u.y = Math.round(ny * 1000) / 1000;
    for (const o of alive) if (o !== u && Math.hypot(o.x - u.x, o.y - u.y) < 0.5) { u.x += (u.x - o.x) * 0.1 || 0.01; u.y += (u.y - o.y) * 0.1; }
  }
  return d;
}

export function squadStatus(d: SquadData): "playing" | "win" | "lose" {
  const alive = (side: 0 | 1) => d.units.some(u => u.side === side && u.hp > 0);
  if (d.units.some(u => u.hero && u.hp <= 0) || d.bases.some(b => b.side === 0 && b.hp <= 0) || !alive(0)) return "lose";
  if (d.args.goal === "base" ? d.bases.filter(b => b.side === 1).every(b => b.hp <= 0) : !alive(1) && d.bases.filter(b => b.side === 1).every(b => b.hp <= 0)) return "win";
  if (d.args.seconds && d.frame >= d.args.seconds * FPS) return "lose";
  return "playing";
}

function layout(d: SquadData, width: number, height: number) {
  const s = Math.min((width - 24) / (d.w * T), (height - 64) / (d.h * T));
  return { s, ox: (width - d.w * T * s) / 2, oy: 30 + (height - 64 - d.h * T * s) / 2 };
}

const battle = (auto: boolean): SceneDefinition => ({
  title: auto ? "オートバトラー（布陣して見守る）" : "部隊戦（RTS：選んで指示する）",
  realtime: { fps: FPS },
  checkArgs: (args, { content }) => { const r = SquadArgsSchema.safeParse({ ...args, auto }); return r.success ? [...checkSquad(r.data), ...assetRefErrors(content, r.data.tiles, Object.fromEntries([...r.data.allies, ...r.data.enemies].filter(u => u.sprite).map(u => [u.name, u.sprite!])))] : issues(r); },
  start: (ctx, raw) => startSquad(ctx, { ...raw, auto }),
  input(ctx, raw, input) {
    const d = raw as SquadData;
    if (input.type === "cancel") return d.args.canFlee || !inBattle(ctx) ? finish(ctx, d.args, "quit", "兵を退かせた。") : {};
    let next: SquadData;
    if (input.type === "custom") {
      const c = asRecord(asRecord(input.value).click);
      if (typeof c.x !== "number") return {};
      const lay = layout(d, Number(c.width), Number(c.height));
      next = stepSquad(d, d.held, { x: (c.x - lay.ox) / lay.s / T, y: ((c.y as number) - lay.oy) / lay.s / T });
    } else if (input.type === "frame") next = stepSquad(d, input.held);
    else return {};
    const status = squadStatus(next);
    const hero = next.units.find(u => u.hero);
    if (status === "win") return finish(ctx, d.args, "win", `${d.args.title}に勝利！（生存 ${next.units.filter(u => u.side === 0 && u.hp > 0).length}人）`, hero?.hp);
    if (status === "lose") return finish(ctx, d.args, "lose", "部隊が崩れた……", hero ? Math.max(1, hero.hp) : undefined);
    return { data: next };
  },
  draw(g, view) {
    const d = view.data as SquadData;
    const lay = layout(d, view.width, view.height);
    g.fillStyle = "#1a2016"; g.fillRect(0, 0, view.width, view.height);
    g.save(); g.translate(lay.ox, lay.oy); g.scale(lay.s, lay.s);
    g.fillStyle = "#3f5233"; g.fillRect(0, 0, d.w * T, d.h * T);
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
      const ch = d.rows[y]![x]!;
      if (d.args.tiles[" "] && ch !== "#") drawTile(g, view, d.args.tiles[" "], x * T, y * T, T);
      if (ch === "#" && !(d.args.tiles["#"] && drawTile(g, view, d.args.tiles["#"], x * T, y * T, T))) { g.fillStyle = "#5c5345"; g.fillRect(x * T, y * T, T, T); }
    }
    for (const b of d.bases) { g.fillStyle = b.side === 0 ? "#3f7fc4" : "#9b2f2f"; g.fillRect(b.x * T - 10, b.y * T - 10, 20, 20); g.fillStyle = "#222"; g.fillRect(b.x * T - 10, b.y * T - 14, 20, 2); g.fillStyle = "#7fc46b"; g.fillRect(b.x * T - 10, b.y * T - 14, 20 * (b.hp / b.maxHp), 2); }
    for (const l of d.lines) { g.strokeStyle = "rgba(255,240,200,.7)"; g.lineWidth = 0.8; g.beginPath(); g.moveTo(l[0] * T, l[1] * T); g.lineTo(l[2] * T, l[3] * T); g.stroke(); }
    for (const u of d.units) {
      if (u.hp <= 0) continue;
      if (u.hero) drawHero(g, view, u.x * T, u.y * T - 2, 16, 0, 0);
      else if (u.sprite && drawSprite(g, view, u.sprite, u.x * T, u.y * T - 2, 16, u.side === 0 ? 2 : 1, Math.floor(d.frame / 8))) { /* drawn */ }
      else { g.fillStyle = u.color; g.beginPath(); g.arc(u.x * T, u.y * T, 5, 0, Math.PI * 2); g.fill(); g.strokeStyle = u.side === 0 ? "#cfe3ff" : "#3a1010"; g.lineWidth = 1; g.stroke(); }
      if (u.selected) { g.strokeStyle = "#f0c36a"; g.beginPath(); g.arc(u.x * T, u.y * T, 8, 0, Math.PI * 2); g.stroke(); }
      if (u.dest && !d.args.auto) { g.strokeStyle = "rgba(240,195,106,.25)"; g.beginPath(); g.moveTo(u.x * T, u.y * T); g.lineTo(u.dest.x * T, u.dest.y * T); g.stroke(); }
      g.fillStyle = "#222"; g.fillRect(u.x * T - 6, u.y * T - 9, 12, 1.5); g.fillStyle = u.side === 0 ? "#7fc46b" : "#d9745b"; g.fillRect(u.x * T - 6, u.y * T - 9, 12 * (u.hp / u.maxHp), 1.5);
    }
    if (!d.args.auto) { g.strokeStyle = "#f0c36a"; g.lineWidth = 1; g.beginPath(); g.arc(d.cursor.x * T, d.cursor.y * T, 1.6 * T, 0, Math.PI * 2); g.stroke(); }
    g.restore();
    g.fillStyle = "#e9dcb8"; g.font = "14px system-ui"; g.textAlign = "left";
    g.fillText(`${d.args.title}　味方 ${d.units.filter(u => u.side === 0 && u.hp > 0).length}　敵 ${d.units.filter(u => u.side === 1 && u.hp > 0).length}${d.args.seconds ? `　残り${Math.max(0, Math.ceil(d.args.seconds - d.frame / FPS))}秒` : ""}　${d.message}`, 12, 20);
    g.fillStyle = "#a9b09d"; g.font = "12px system-ui";
    g.fillText(d.args.auto ? "自動で戦う。Esc で撤退" : "矢印 カーソル　Z 選ぶ→Z 行き先（クリックでも可）　Shift 全員を選ぶ　Esc 撤退", 12, view.height - 12);
  },
});

export default defineSystem({ id: "squad", scenes: { command: battle(false), auto: battle(true) } });

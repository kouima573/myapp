/**
 * Genre module: first-person dungeon (realtime, pseudo-3D raycasting). Covers grid dungeon crawlers (move one cell,
 * turn 90°) and, with move "free", first-person exploration / shooting (FPS-like, still 2D data underneath).
 *   # wall   @ start   G exit   * treasure   e monster   B boss (the RPG enemy in battle mode)
 */
import { z } from "zod";
import { defineSystem, type SystemContext } from "../../engine/src/index";
import { assetRefErrors, drawSprite, enemyOf, finish, heroOf, inBattle, issues, OutcomeArgs, pressed, tileSource } from "./common";

const FPS = 30;

export const Dungeon3dArgsSchema = z.object({
  title: z.string().default("迷宮"),
  rows: z.array(z.string().min(1)).min(3),
  facing: z.enum(["up", "down", "left", "right"]).default("up"),
  /** grid: step one cell and turn 90° (dungeon crawler). free: walk and turn smoothly, Z attacks / shoots ahead. */
  move: z.enum(["grid", "free"]).default("grid"),
  goal: z.enum(["exit", "defeat", "collect"]).default("exit"),
  enemyHp: z.number().int().min(1).max(999).default(6),
  hpScale: z.number().min(0.1).max(50).default(2),
  /** Monster damage; 0 = from the RPG enemy (or 4) minus the hero's defense. */
  enemyDamage: z.number().int().min(0).max(999).default(0),
  wallColor: z.string().default("#8a7a62"),
  /** Texture the walls (and the exit) with tiles of the project's tileset. */
  wallTile: z.string().length(1).optional(),
  exitTile: z.string().length(1).optional(),
  /** Character assets for monsters: { "e": "…", "B": "…" }. */
  sprites: z.record(z.string().length(1), z.string()).default({}),
  ...OutcomeArgs,
}).strict();
export type Dungeon3dArgs = z.infer<typeof Dungeon3dArgsSchema>;

interface Mob { x: number; y: number; hp: number; maxHp: number; boss: boolean; cool: number; dead: boolean }
export interface Dungeon3dData {
  args: Dungeon3dArgs; frame: number; rows: string[]; w: number; h: number; x: number; y: number; a: number;
  mobs: Mob[]; treasure: Array<{ x: number; y: number; got: boolean }>; hp: number; maxHp: number; attack: number; defense: number; held: string[]; swing: number; kills: number; message: string; hurt: number;
}

export function checkDungeon(a: Dungeon3dArgs): string[] {
  const all = a.rows.join("");
  const out: string[] = [];
  a.rows.forEach((row, y) => Array.from(row).forEach((ch, x) => { if (!"#@G*eB .".includes(ch)) out.push(`rows[${y}]: 使えない文字 '${ch}' (x=${x})`); }));
  if ((all.match(/@/g) ?? []).length !== 1) out.push("開始位置 @ はちょうど1つ必要です");
  if (a.goal === "exit" && !all.includes("G")) out.push("goal が exit のときは出口 G が必要です");
  if (a.goal === "collect" && !all.includes("*")) out.push("goal が collect のときは宝 * が必要です");
  if (a.goal === "defeat" && !/[eB]/.test(all)) out.push("goal が defeat のときは敵 e か B が必要です");
  return out;
}

const ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

export function startDungeon(ctx: SystemContext, raw: Record<string, unknown>): Dungeon3dData {
  const args = Dungeon3dArgsSchema.parse(raw);
  const w = Math.max(...args.rows.map(r => r.length));
  const hero = heroOf(ctx);
  const enemy = enemyOf(ctx, args.enemyId);
  const d: Dungeon3dData = { args, frame: 0, rows: [], w, h: args.rows.length, x: 1.5, y: 1.5, a: ANGLE[args.facing], mobs: [], treasure: [], hp: hero.hp, maxHp: hero.maxHp, attack: hero.attack, defense: hero.defense, held: [], swing: 0, kills: 0, message: args.title, hurt: 0 };
  d.rows = args.rows.map((row, y) => Array.from(row.padEnd(w, "#")).map((ch, x) => {
    if (ch === "@") { d.x = x + 0.5; d.y = y + 0.5; return "."; }
    if (ch === "*") { d.treasure.push({ x: x + 0.5, y: y + 0.5, got: false }); return "."; }
    if (ch === "e" || ch === "B") { const hp = ch === "B" ? Math.max(1, Math.round((enemy?.stats.maxHp ?? 20) * args.hpScale)) : args.enemyHp; d.mobs.push({ x: x + 0.5, y: y + 0.5, hp, maxHp: hp, boss: ch === "B", cool: 0, dead: false }); return "."; }
    return ch === " " ? "." : ch;
  }).join(""));
  return d;
}

const solid = (d: Dungeon3dData, x: number, y: number) => { const c = d.rows[Math.floor(y)]?.[Math.floor(x)]; return c === undefined || c === "#"; };
const round = (n: number) => Math.round(n * 1000) / 1000;

export function stepDungeon(ctx: SystemContext, data: Dungeon3dData, held: string[]): Dungeon3dData {
  const d: Dungeon3dData = { ...data, frame: data.frame + 1, held, swing: Math.max(0, data.swing - 1), hurt: Math.max(0, data.hurt - 1), mobs: data.mobs.map(m => ({ ...m })), treasure: data.treasure.map(t => ({ ...t })) };
  const now = pressed(held, data.held);
  const occupied = (x: number, y: number) => d.mobs.some(m => !m.dead && Math.floor(m.x) === Math.floor(x) && Math.floor(m.y) === Math.floor(y));
  if (d.args.move === "grid") {
    if (now.includes("left")) d.a = round(d.a - Math.PI / 2);
    if (now.includes("right")) d.a = round(d.a + Math.PI / 2);
    for (const [b, dir] of [["up", 1], ["down", -1]] as const) if (now.includes(b)) {
      const nx = Math.floor(d.x + Math.round(Math.cos(d.a)) * dir) + 0.5, ny = Math.floor(d.y + Math.round(Math.sin(d.a)) * dir) + 0.5;
      if (!solid(d, nx, ny) && !occupied(nx, ny)) { d.x = nx; d.y = ny; }
    }
  } else {
    const turn = (held.includes("right") ? 1 : 0) - (held.includes("left") ? 1 : 0);
    d.a = round(d.a + turn * 0.07);
    const step = ((held.includes("up") ? 1 : 0) - (held.includes("down") ? 1 : 0)) * 0.07;
    const nx = d.x + Math.cos(d.a) * step, ny = d.y + Math.sin(d.a) * step;
    if (!solid(d, nx + Math.sign(nx - d.x) * 0.2, d.y)) d.x = round(nx);
    if (!solid(d, d.x, ny + Math.sign(ny - d.y) * 0.2)) d.y = round(ny);
  }
  // Attack: what is straight ahead within reach.
  if (now.includes("fire") && d.swing === 0) {
    d.swing = 8;
    const reach = d.args.move === "free" ? 6 : 1.2;
    const target = d.mobs.filter(m => !m.dead).map(m => ({ m, dist: Math.hypot(m.x - d.x, m.y - d.y), ang: Math.atan2(m.y - d.y, m.x - d.x) - d.a }))
      .map(o => ({ ...o, ang: Math.atan2(Math.sin(o.ang), Math.cos(o.ang)) })).filter(o => o.dist <= reach && Math.abs(o.ang) < (d.args.move === "free" ? 0.12 + 0.3 / o.dist : 0.5)).sort((a, b) => a.dist - b.dist)[0];
    if (target) { target.m.hp -= Math.max(1, d.attack); d.message = "命中！"; if (target.m.hp <= 0) { target.m.dead = true; d.kills++; d.message = "倒した！"; } }
  }
  // Monsters close in and strike when adjacent.
  const dmg = d.args.enemyDamage || Math.max(1, (enemyOf(ctx, d.args.enemyId)?.stats.attack ?? 4) - d.defense);
  for (const m of d.mobs) {
    if (m.dead) continue;
    const dist = Math.hypot(d.x - m.x, d.y - m.y);
    if (m.cool > 0) m.cool--;
    if (dist < 1.3) { if (m.cool === 0) { d.hp = Math.max(0, d.hp - dmg); d.hurt = 6; m.cool = 30; d.message = `攻撃を受けた（${dmg}）`; } }
    else if (dist < 5 && d.frame % (d.args.move === "grid" ? 24 : 1) === 0) {
      const sp = d.args.move === "grid" ? 1 : 0.035;
      const dx = Math.sign(Math.round(d.x - m.x)), dy = Math.sign(Math.round(d.y - m.y));
      const tryMove = (mx: number, my: number) => { const nx = m.x + mx * sp, ny = m.y + my * sp; if (!solid(d, nx, ny) && !(Math.floor(nx) === Math.floor(d.x) && Math.floor(ny) === Math.floor(d.y))) { m.x = round(nx); m.y = round(ny); return true; } return false; };
      if (!(Math.abs(d.x - m.x) > Math.abs(d.y - m.y) ? tryMove(dx, 0) || tryMove(0, dy) : tryMove(0, dy) || tryMove(dx, 0))) { /* blocked */ }
    }
  }
  for (const t of d.treasure) if (!t.got && Math.hypot(t.x - d.x, t.y - d.y) < 0.6) { t.got = true; d.message = "宝を見つけた！"; }
  return d;
}

export function dungeonStatus(d: Dungeon3dData): "playing" | "win" | "lose" {
  if (d.hp <= 0) return "lose";
  if (d.args.goal === "exit" && d.rows[Math.floor(d.y)]![Math.floor(d.x)] === "G") return "win";
  if (d.args.goal === "collect" && d.treasure.every(t => t.got)) return "win";
  if (d.args.goal === "defeat" && (d.mobs.some(m => m.boss) ? d.mobs.filter(m => m.boss).every(m => m.dead) : d.mobs.every(m => m.dead))) return "win";
  return "playing";
}

export default defineSystem({
  id: "dungeon3d",
  scenes: {
    explore: {
      title: "疑似3Dダンジョン（一人称の迷宮探索・一人称の戦闘）",
      realtime: { fps: FPS },
      checkArgs: (args, { content }) => { const r = Dungeon3dArgsSchema.safeParse(args); return r.success ? [...checkDungeon(r.data), ...assetRefErrors(content, Object.fromEntries([["#", r.data.wallTile], ["G", r.data.exitTile]].filter((x): x is [string, string] => Boolean(x[1]))), r.data.sprites)] : issues(r); },
      start: (ctx, raw) => startDungeon(ctx, raw),
      input(ctx, raw, input) {
        const d = raw as Dungeon3dData;
        if (input.type === "cancel") return d.args.canFlee || !inBattle(ctx) ? finish(ctx, d.args, "quit", "迷宮から引き返した。", d.hp) : {};
        if (input.type !== "frame") return {};
        const next = stepDungeon(ctx, d, input.held);
        const status = dungeonStatus(next);
        if (status === "win") return finish(ctx, d.args, "win", `${d.args.title}を踏破した！（撃破${next.kills}・宝${next.treasure.filter(t => t.got).length}）`, next.hp);
        if (status === "lose") return finish(ctx, d.args, "lose", "迷宮で力尽きた……", next.hp);
        return { data: next };
      },
      draw(g, view) {
        const d = view.data as Dungeon3dData;
        const W = view.width, H = view.height, cols = 240, colW = W / cols, fov = Math.PI / 3;
        g.fillStyle = "#1c1916"; g.fillRect(0, 0, W, H / 2);
        g.fillStyle = "#3a332b"; g.fillRect(0, H / 2, W, H / 2);
        const depth: number[] = [];
        const base = d.args.wallColor;
        for (let i = 0; i < cols; i++) {
          const ang = d.a - fov / 2 + (fov * i) / cols;
          const dx = Math.cos(ang), dy = Math.sin(ang);
          let mx = Math.floor(d.x), my = Math.floor(d.y);
          const ddx = Math.abs(1 / dx), ddy = Math.abs(1 / dy);
          const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
          let sdx = (dx < 0 ? d.x - mx : mx + 1 - d.x) * ddx, sdy = (dy < 0 ? d.y - my : my + 1 - d.y) * ddy;
          let side = 0, cell = "#";
          for (let n = 0; n < 64; n++) {
            if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
            cell = d.rows[my]?.[mx] ?? "#";
            if (cell === "#" || cell === "G") break;
          }
          const raw = side === 0 ? sdx - ddx : sdy - ddy;
          const dist = raw * Math.cos(ang - d.a);
          depth.push(dist);
          const hgt = Math.min(H * 2, H / Math.max(0.1, dist));
          const shade = Math.max(0.15, 1 - dist / 9) * (side ? 0.8 : 1);
          const texCode = cell === "G" ? d.args.exitTile : d.args.wallTile;
          const tex = texCode ? tileSource(view, texCode) : undefined;
          if (tex) {
            const wallX = ((side === 0 ? d.y + raw * dy : d.x + raw * dx) % 1 + 1) % 1;
            g.imageSmoothingEnabled = false;
            g.drawImage(tex.img, tex.sx + Math.min(tex.sw - 1, Math.floor(wallX * tex.sw)), tex.sy, 1, tex.sh, i * colW, H / 2 - hgt / 2, colW + 1, hgt);
            g.fillStyle = `rgba(0,0,0,${1 - shade})`; g.fillRect(i * colW, H / 2 - hgt / 2, colW + 1, hgt);
          } else {
            g.fillStyle = cell === "G" ? `rgba(127,196,107,${shade})` : base; g.globalAlpha = cell === "G" ? 1 : shade;
            g.fillRect(i * colW, H / 2 - hgt / 2, colW + 1, hgt);
            g.globalAlpha = 1;
          }
        }
        // Sprites (far to near).
        const sprites = [...d.mobs.filter(m => !m.dead).map(m => ({ x: m.x, y: m.y, color: m.boss ? "#9b2f2f" : "#c0563f", size: m.boss ? 0.9 : 0.6, hp: m.hp / m.maxHp, sprite: d.args.sprites[m.boss ? "B" : "e"] })), ...d.treasure.filter(t => !t.got).map(t => ({ x: t.x, y: t.y, color: "#f0c36a", size: 0.3, hp: -1, sprite: undefined as string | undefined }))]
          .map(s => ({ ...s, dist: Math.hypot(s.x - d.x, s.y - d.y) })).sort((a, b) => b.dist - a.dist);
        for (const s of sprites) {
          let ang = Math.atan2(s.y - d.y, s.x - d.x) - d.a; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
          if (Math.abs(ang) > fov / 2 + 0.3) continue;
          const sxp = (0.5 + ang / fov) * W, size = (H / Math.max(0.2, s.dist)) * s.size;
          const col = Math.floor(sxp / colW);
          if (depth[Math.max(0, Math.min(cols - 1, col))]! < s.dist - 0.3) continue;
          const top = H / 2 + (H / Math.max(0.2, s.dist)) * 0.5 - size;
          if (!(s.sprite && drawSprite(g, view, s.sprite, sxp, top + size / 2, size, 0, Math.floor(d.frame / 8)))) { g.fillStyle = s.color; g.beginPath(); g.ellipse(sxp, top + size / 2, size / 2.4, size / 2, 0, 0, Math.PI * 2); g.fill(); }
          if (s.hp >= 0 && !s.sprite) { g.fillStyle = "#fff"; g.fillRect(sxp - size / 6, top + size * 0.3, size / 10, size / 10); g.fillRect(sxp + size / 12, top + size * 0.3, size / 10, size / 10); g.fillStyle = "#222"; g.fillRect(sxp - size / 3, top - 8, (size * 2) / 3, 4); g.fillStyle = "#d9745b"; g.fillRect(sxp - size / 3, top - 8, ((size * 2) / 3) * s.hp, 4); }
        }
        if (d.swing) { g.strokeStyle = "rgba(255,240,200,.8)"; g.lineWidth = 4; g.beginPath(); g.arc(W / 2, H, H * 0.45, -Math.PI / 2 - 0.6 + (8 - d.swing) * 0.15, -Math.PI / 2 - 0.2 + (8 - d.swing) * 0.15); g.stroke(); }
        if (d.hurt) { g.fillStyle = "rgba(200,40,40,.25)"; g.fillRect(0, 0, W, H); }
        if (d.args.move === "free") { g.strokeStyle = "#fff"; g.lineWidth = 1; g.beginPath(); g.moveTo(W / 2 - 8, H / 2); g.lineTo(W / 2 + 8, H / 2); g.moveTo(W / 2, H / 2 - 8); g.lineTo(W / 2, H / 2 + 8); g.stroke(); }
        // Minimap.
        const m = 6, ox = W - d.w * m - 10, oy = 10;
        g.globalAlpha = 0.8;
        for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) { const c = d.rows[y]![x]; g.fillStyle = c === "#" ? "#5a5246" : c === "G" ? "#7fc46b" : "#1e1b17"; g.fillRect(ox + x * m, oy + y * m, m, m); }
        g.fillStyle = "#f0c36a"; g.beginPath(); g.arc(ox + d.x * m, oy + d.y * m, 2.5, 0, Math.PI * 2); g.fill();
        g.strokeStyle = "#f0c36a"; g.beginPath(); g.moveTo(ox + d.x * m, oy + d.y * m); g.lineTo(ox + (d.x + Math.cos(d.a)) * m, oy + (d.y + Math.sin(d.a)) * m); g.stroke();
        g.globalAlpha = 1;
        g.fillStyle = "#e9dcb8"; g.font = "14px system-ui"; g.textAlign = "left";
        g.fillText(`${d.args.title}　HP ${d.hp}/${d.maxHp}　${{ exit: "出口（緑の壁）へ", defeat: "敵を倒せ", collect: `宝 ${d.treasure.filter(t => t.got).length}/${d.treasure.length}` }[d.args.goal]}　${d.message}`, 12, 22);
        g.fillStyle = "#a9b09d"; g.font = "12px system-ui";
        g.fillText(d.args.move === "grid" ? "↑ 前へ　↓ 後ろへ　←→ 向きを変える　Z 攻撃　Esc 引き返す" : "↑↓ 前後　←→ 向き　Z 攻撃（照準の先）　Esc 引き返す", 12, H - 12);
      },
    },
  },
});

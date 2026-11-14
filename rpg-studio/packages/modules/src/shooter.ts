/**
 * Genre module: bullet-hell shooting as an RPG battle mode. The enemy's RPG stats drive the boss
 * (HP × hpScale, attack), the player's stats drive the ship (HP, attack = shot power, defence = less damage).
 * Deterministic fixed-step simulation (30 fps) so `rpg test` can replay it.
 * Enemy: "battle": { "mode": "shooter.battle", "args": { "phases": [ { "untilHpPercent": 50, "patterns": [ { "type": "ring", "count": 10, "speed": 1.6, "every": 36 } ] }, { "patterns": [...] } ] } }
 */
import { z } from "zod";
import { defineSystem, effectiveStats, type SystemContext } from "../../engine/src/index";
import { drawEnemyPortrait } from "../../runtime/src/render";
import { nextRand } from "./ui";

const PatternSchema = z.object({
  type: z.enum(["ring", "aimed", "spiral", "rain"]),
  count: z.number().int().min(1).max(64).default(8),
  speed: z.number().min(0.2).max(12).default(2),
  every: z.number().int().min(1).max(600).default(30),
  /** aimed: total fan angle (radians). spiral: rotation per volley. */
  spread: z.number().min(0).max(6.3).default(0.4),
  /** Added to the enemy's attack for damage. */
  power: z.number().int().min(0).max(999).default(0),
  radius: z.number().min(1).max(12).default(3),
}).strict();
export const ShooterArgsSchema = z.object({
  hpScale: z.number().min(0.1).max(100).default(6),
  phases: z.array(z.object({ untilHpPercent: z.number().min(0).max(100).optional(), patterns: z.array(PatternSchema).min(1) }).strict()).min(1)
    .default([{ patterns: [{ type: "ring", count: 10, speed: 1.6, every: 40, spread: 0.4, power: 0, radius: 3 }, { type: "aimed", count: 3, speed: 2.4, every: 28, spread: 0.4, power: 0, radius: 3 }] }]),
  playerSpeed: z.number().min(0.5).max(10).default(3),
  /** Frames of invincibility after a hit. */
  invincible: z.number().int().min(0).max(300).default(40),
  enemyId: z.string(),
  canFlee: z.boolean().default(true),
}).strict();
type ShooterArgs = z.infer<typeof ShooterArgsSchema>;

export const FIELD = { w: 240, h: 320 };
interface Bullet { x: number; y: number; vx: number; vy: number; r: number; p: number }
export interface ShooterData {
  args: ShooterArgs; frame: number; seed: number;
  px: number; py: number; hp: number; maxHp: number; inv: number;
  ex: number; ey: number; enemyHp: number; enemyMaxHp: number;
  shots: Array<{ x: number; y: number }>; bullets: Bullet[]; hits: number; volleys: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function simulate(ctx: SystemContext, data: ShooterData, held: string[]): ShooterData {
  const enemy = ctx.content.database.enemies.find(e => e.id === data.args.enemyId)!;
  const stats = effectiveStats(ctx.state, ctx.content);
  const d: ShooterData = { ...data, frame: data.frame + 1, inv: Math.max(0, data.inv - 1), shots: [...data.shots], bullets: [] };
  const ready = d.frame > 30;
  // Player.
  const speed = data.args.playerSpeed * (held.includes("focus") ? 0.45 : 1);
  const dx = (held.includes("right") ? 1 : 0) - (held.includes("left") ? 1 : 0);
  const dy = (held.includes("down") ? 1 : 0) - (held.includes("up") ? 1 : 0);
  const norm = dx && dy ? Math.SQRT1_2 : 1;
  d.px = round(Math.max(6, Math.min(FIELD.w - 6, d.px + dx * speed * norm)));
  d.py = round(Math.max(FIELD.h * 0.35, Math.min(FIELD.h - 8, d.py + dy * speed * norm)));
  if (ready && held.includes("fire") && d.frame % 5 === 0) d.shots.push({ x: d.px - 5, y: d.py - 8 }, { x: d.px + 5, y: d.py - 8 });
  // Enemy moves in a slow figure.
  d.ex = round(FIELD.w / 2 + Math.sin(d.frame / 70) * 70);
  d.ey = round(60 + Math.sin(d.frame / 45) * 12);
  // Shots hit the enemy.
  const kept: Array<{ x: number; y: number }> = [];
  for (const s of d.shots) {
    const y = s.y - 8;
    if (Math.abs(s.x - d.ex) < 18 && Math.abs(y - d.ey) < 18) { d.enemyHp = Math.max(0, d.enemyHp - Math.max(1, stats.attack - Math.floor(enemy.stats.defense / 2))); continue; }
    if (y > -10) kept.push({ x: s.x, y });
  }
  d.shots = kept.slice(-80);
  // Enemy patterns for the current phase.
  const pct = (d.enemyHp / d.enemyMaxHp) * 100;
  const phase = data.args.phases.find(p => p.untilHpPercent === undefined || pct > p.untilHpPercent) ?? data.args.phases[data.args.phases.length - 1]!;
  const spawned: Bullet[] = [];
  if (ready) for (const p of phase.patterns) {
    if (d.frame % p.every !== 0) continue;
    d.volleys++;
    const aim = Math.atan2(d.py - d.ey, d.px - d.ex);
    for (let i = 0; i < p.count; i++) {
      let angle: number;
      let x = d.ex, y = d.ey;
      if (p.type === "ring") angle = (Math.PI * 2 * i) / p.count + d.volleys * 0.21;
      else if (p.type === "aimed") angle = aim + (p.count > 1 ? (i / (p.count - 1) - 0.5) * p.spread : 0);
      else if (p.type === "spiral") angle = (Math.PI * 2 * i) / p.count + d.volleys * p.spread;
      else { let r: number; [r, d.seed] = nextRand(d.seed); x = round(r * FIELD.w); y = 0; angle = Math.PI / 2; }
      spawned.push({ x, y, vx: round(Math.cos(angle) * p.speed), vy: round(Math.sin(angle) * p.speed), r: p.radius, p: p.power });
    }
  }
  // Bullets move and may hit the player (hitbox radius 3).
  let hp = d.hp;
  let inv = d.inv;
  for (const b of [...data.bullets, ...spawned]) {
    const nb = { ...b, x: round(b.x + b.vx), y: round(b.y + b.vy) };
    if (nb.x < -10 || nb.x > FIELD.w + 10 || nb.y < -10 || nb.y > FIELD.h + 10) continue;
    if (inv === 0 && Math.hypot(nb.x - d.px, nb.y - d.py) < nb.r + 3) {
      hp = Math.max(0, hp - Math.max(1, enemy.stats.attack + nb.p - stats.defense));
      inv = data.args.invincible;
      d.hits++;
      continue;
    }
    d.bullets.push(nb);
  }
  d.bullets = d.bullets.slice(-400);
  d.hp = hp; d.inv = inv;
  return d;
}

let portraitCanvas: HTMLCanvasElement | undefined;
const imageCache = new Map<string, HTMLImageElement>();
function image(url: string | undefined): HTMLImageElement | undefined {
  if (!url) return undefined;
  let img = imageCache.get(url);
  if (!img) { img = new Image(); img.src = url; imageCache.set(url, img); }
  return img.complete && img.naturalWidth ? img : undefined;
}

export default defineSystem({
  id: "shooter",
  scenes: {
    battle: {
      title: "シューティング（弾幕で戦う戦闘モード）",
      realtime: { fps: 30 },
      checkArgs: args => { const r = ShooterArgsSchema.safeParse({ enemyId: "x", ...args }); return r.success ? [] : r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`); },
      start(ctx, raw) {
        const args = ShooterArgsSchema.parse(raw);
        const enemy = ctx.content.database.enemies.find(e => e.id === args.enemyId)!;
        const enemyMaxHp = Math.max(1, Math.round(enemy.stats.maxHp * args.hpScale));
        return { args, frame: 0, seed: ctx.state.rng || 1, px: FIELD.w / 2, py: FIELD.h - 30, hp: ctx.state.player.hp, maxHp: effectiveStats(ctx.state, ctx.content).maxHp, inv: 0, ex: FIELD.w / 2, ey: 60, enemyHp: enemyMaxHp, enemyMaxHp, shots: [], bullets: [], hits: 0, volleys: 0 } satisfies ShooterData;
      },
      input(ctx, raw, input) {
        const data = raw as ShooterData;
        if (input.type === "cancel") {
          if (!data.args.canFlee) return {};
          return { outcome: "fled", state: { ...ctx.state, player: { ...ctx.state.player, hp: Math.max(1, data.hp) } }, battleLog: ["弾幕をかいくぐって逃げ出した。"] };
        }
        if (input.type !== "frame") return {};
        const next = simulate(ctx, data, input.held);
        const enemy = ctx.content.database.enemies.find(e => e.id === data.args.enemyId)!;
        if (next.enemyHp <= 0) return { outcome: "victory", state: { ...ctx.state, player: { ...ctx.state.player, hp: Math.max(1, next.hp) } }, battleLog: [`弾幕を撃ち抜いた！（被弾 ${next.hits}回）`] };
        if (next.hp <= 0) return { outcome: "defeat", battleLog: [`${enemy.name}の弾幕に飲み込まれた……`] };
        return { data: next };
      },
      draw(g, view) {
        const d = view.data as ShooterData;
        const scale = view.height / FIELD.h;
        const ox = (view.width - FIELD.w * scale) / 2;
        g.fillStyle = "#05070a"; g.fillRect(0, 0, view.width, view.height);
        g.save();
        g.translate(ox, 0); g.scale(scale, scale);
        // Starfield.
        g.fillStyle = "#0c1220"; g.fillRect(0, 0, FIELD.w, FIELD.h);
        for (let i = 0; i < 40; i++) { const y = (i * 53 + d.frame * (1 + (i % 3))) % FIELD.h; g.fillStyle = i % 3 ? "#2b3550" : "#56658c"; g.fillRect((i * 97) % FIELD.w, y, 1, 1 + (i % 3)); }
        // Enemy portrait.
        const enemy = view.content.database.enemies.find(e => e.id === d.args.enemyId)!;
        portraitCanvas ??= document.createElement("canvas");
        const portrait = portraitCanvas;
        portrait.width = 48; portrait.height = 48;
        const enemyAsset = enemy.sprite ? view.content.assets.assets.find(a => a.id === enemy.sprite) : undefined;
        drawEnemyPortrait(portrait.getContext("2d")!, enemy.id, 48, view.time, image(enemy.sprite ? view.assetUrl(enemy.sprite) : undefined), enemyAsset);
        g.imageSmoothingEnabled = false;
        g.drawImage(portrait, d.ex - 24, d.ey - 24);
        // Shots and bullets.
        g.fillStyle = "#f6e27a";
        for (const s of d.shots) g.fillRect(s.x - 1, s.y - 4, 2, 6);
        for (const b of d.bullets) {
          g.fillStyle = "#ff8a5c"; g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill();
          g.fillStyle = "#ffe6d8"; g.beginPath(); g.arc(b.x, b.y, Math.max(1, b.r - 1.6), 0, Math.PI * 2); g.fill();
        }
        // Player: the hero's own sprite, seen from behind.
        const heroId = view.state.player.sprite ?? view.content.project.player.sprite;
        const heroAsset = heroId ? view.content.assets.assets.find(a => a.id === heroId) : undefined;
        const hero = image(heroId ? view.assetUrl(heroId) : undefined);
        const blink = d.inv > 0 && Math.floor(d.frame / 3) % 2 === 0;
        if (!blink) {
          if (hero && heroAsset) {
            const cols = heroAsset.columns ?? 1, rows = heroAsset.rows ?? 1;
            const cw = hero.naturalWidth / cols, ch = hero.naturalHeight / rows;
            g.drawImage(hero, (Math.floor(d.frame / 6) % cols) * cw, Math.min(rows - 1, 3) * ch, cw, ch, d.px - 12, d.py - 16, 24, 24);
          } else { g.fillStyle = "#7fc4ff"; g.beginPath(); g.moveTo(d.px, d.py - 10); g.lineTo(d.px - 8, d.py + 8); g.lineTo(d.px + 8, d.py + 8); g.fill(); }
        }
        g.fillStyle = "#ffffff"; g.beginPath(); g.arc(d.px, d.py, 2.2, 0, Math.PI * 2); g.fill();
        if (d.frame < 30) { g.fillStyle = "rgba(255,240,200,.9)"; g.font = "bold 18px system-ui"; g.textAlign = "center"; g.fillText("READY", FIELD.w / 2, FIELD.h / 2); }
        g.restore();
        // Side panels.
        const left = ox - 12;
        g.fillStyle = "#e9dcb8"; g.font = "12px system-ui"; g.textAlign = "right";
        g.fillText(enemy.name, left, 30);
        g.fillRect(left - 120, 38, 120 * (d.enemyHp / d.enemyMaxHp), 6);
        g.fillText(`${(view.state.player.name ?? view.content.project.player.name)}  HP ${d.hp}/${d.maxHp}`, left, view.height - 50);
        g.fillStyle = "#7fc46b"; g.fillRect(left - 120, view.height - 42, 120 * (d.hp / d.maxHp), 6);
        g.textAlign = "left"; g.fillStyle = "#a9b09d";
        const right = ox + FIELD.w * scale + 12;
        ["←↑↓→ 移動", "Z / Enter 撃つ", "Shift 低速", d.args.canFlee ? "Esc 逃げる" : "逃げられない"].forEach((t, i) => g.fillText(t, right, 30 + i * 18));
      },
    },
  },
});

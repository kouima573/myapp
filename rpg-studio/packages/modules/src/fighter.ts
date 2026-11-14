/**
 * Genre module: 1-on-1 fighting (realtime, side view). Walk, jump, guard, light / low attacks, a command special
 * (↓ → attack, uses meter), hitstun combos and chip damage. `duel` is against a CPU (the RPG enemy in battle mode),
 * `versus` is local two-player on one keyboard (P1 WASD + F attack + G guard, P2 arrows + Enter/. attack + / guard).
 */
import { z } from "zod";
import { defineSystem, type SceneDefinition, type SystemContext } from "../../engine/src/index";
import { drawEnemyPortrait } from "../../runtime/src/render";
import { drawHero, enemyOf, finish, heroOf, image, inBattle, issues, OutcomeArgs, pressed } from "./common";
import { nextRand } from "./ui";

const FPS = 30, W = 320, FLOOR = 200;

const FighterStats = z.object({ name: z.string().min(1).max(20), hp: z.number().int().min(1).max(9999), attack: z.number().int().min(0).max(999), defense: z.number().int().min(0).max(999).default(0), sprite: z.string().optional() }).strict();
export const FighterArgsSchema = z.object({
  title: z.string().default("一騎打ち"),
  /** Field duel / versus: the opponent. Battle mode: the RPG enemy (HP × hpScale). */
  opponent: FighterStats.optional(),
  hpScale: z.number().min(0.1).max(50).default(3),
  /** HP for the hero in this fight = hero HP × heroScale (fights feel short with RPG HP). */
  heroScale: z.number().min(0.1).max(50).default(3),
  seconds: z.number().int().min(10).max(600).default(60),
  /** CPU strength 1-5. */
  level: z.number().int().min(1).max(5).default(2),
  /** Versus: name of player 2. */
  player2: z.string().default("2P"),
  ...OutcomeArgs,
}).strict();
export type FighterArgs = z.infer<typeof FighterArgsSchema>;

type Move = "light" | "low" | "special";
const MOVES: Record<Move, { startup: number; active: number; recovery: number; mult: number; range: number; cost: number }> = {
  light: { startup: 3, active: 3, recovery: 7, mult: 1, range: 26, cost: 0 },
  low: { startup: 5, active: 3, recovery: 11, mult: 1.3, range: 30, cost: 0 },
  special: { startup: 8, active: 1, recovery: 14, mult: 1.6, range: 0, cost: 50 },
};
export interface Fighter {
  name: string; x: number; y: number; vy: number; face: 1 | -1; hp: number; maxHp: number; attack: number; defense: number;
  move?: Move; t: number; stun: number; guard: boolean; meter: number; combo: number; hitDone: boolean; inputs: Array<[string, number]>; held: string[]; sprite?: string;
}
export interface FighterData { args: FighterArgs; frame: number; seed: number; p: [Fighter, Fighter]; balls: Array<{ x: number; y: number; vx: number; owner: 0 | 1; dmg: number }>; versus: boolean; flash: string }

function fighter(name: string, x: number, face: 1 | -1, hp: number, attack: number, defense: number, sprite?: string): Fighter {
  return { name, x, y: FLOOR, vy: 0, face, hp, maxHp: hp, attack, defense, t: 0, stun: 0, guard: false, meter: 0, combo: 0, hitDone: false, inputs: [], held: [], sprite };
}

export function startFighter(ctx: SystemContext, raw: Record<string, unknown>, versus: boolean): FighterData {
  const args = FighterArgsSchema.parse(raw);
  const hero = heroOf(ctx);
  const enemy = enemyOf(ctx, args.enemyId);
  const o = enemy ? { name: enemy.name, hp: Math.max(1, Math.round(enemy.stats.maxHp * args.hpScale)), attack: enemy.stats.attack, defense: enemy.stats.defense, sprite: enemy.sprite }
    : args.opponent ?? { name: versus ? args.player2 : "好敵手", hp: Math.max(1, Math.round(hero.maxHp * args.heroScale)), attack: hero.attack, defense: hero.defense };
  const heroHp = Math.max(1, Math.round(hero.hp * args.heroScale));
  return { args, frame: 0, seed: ctx.state.rng || 1, p: [fighter(hero.name, 90, 1, heroHp, hero.attack, hero.defense), fighter(versus && !args.opponent ? args.player2 : o.name, 230, -1, versus && !args.opponent ? heroHp : o.hp, o.attack, o.defense ?? 0, o.sprite)], balls: [], versus, flash: "" };
}

/** CPU: approach, poke in range, guard when the player swings (level = reaction). Deterministic via the seed. */
function cpuButtons(d: FighterData, me: Fighter, foe: Fighter): string[] {
  let r: number; [r, d.seed] = nextRand(d.seed);
  const dist = Math.abs(foe.x - me.x), toward = foe.x > me.x ? "right" : "left";
  const out: string[] = [];
  if (foe.move && foe.t < MOVES[foe.move].startup + 2 && r < 0.15 * d.args.level) return ["focus"];
  if (dist > 34) out.push(toward);
  if (dist < 40 && r < 0.05 + 0.04 * d.args.level) out.push("fire");
  if (dist > 120 && me.meter >= 50 && r < 0.03 * d.args.level) return ["down", toward, "fire"];
  if (r > 0.985) out.push("up");
  return out;
}

function stepOne(d: FighterData, i: 0 | 1, held: string[]) {
  const me = d.p[i], foe = d.p[1 - i]!;
  const now = pressed(held, me.held);
  me.held = held;
  for (const b of now) me.inputs.push([b, d.frame]);
  me.inputs = me.inputs.filter(([, f]) => d.frame - f < 15);
  me.face = foe.x > me.x ? 1 : -1;
  const forward = me.face > 0 ? "right" : "left";
  if (me.stun > 0) { me.stun--; me.move = undefined; }
  else if (me.move) {
    me.t++;
    const m = MOVES[me.move];
    if (me.move === "special" && me.t === m.startup) d.balls.push({ x: me.x + me.face * 14, y: me.y - 22, vx: me.face * 4.5, owner: i, dmg: Math.max(1, Math.round(me.attack * m.mult) - Math.floor(foe.defense / 2)) });
    if (me.t >= m.startup + m.active + m.recovery) me.move = undefined;
  } else {
    me.guard = held.includes("focus") && me.y >= FLOOR;
    const seq = me.inputs.map(([b]) => b).join(",");
    if (now.includes("fire")) {
      me.move = /down.*(right|left)/.test(seq) && seq.includes(forward) && me.meter >= MOVES.special.cost ? "special" : held.includes("down") ? "low" : "light";
      if (me.move === "special") me.meter -= MOVES.special.cost;
      me.t = 0; me.hitDone = false; me.inputs = [];
    } else if (!me.guard) {
      const dx = (held.includes("right") ? 1 : 0) - (held.includes("left") ? 1 : 0);
      me.x = Math.max(16, Math.min(W - 16, me.x + dx * (dx === me.face ? 2.6 : 1.8)));
      if (now.includes("up") && me.y >= FLOOR) me.vy = -7;
    }
  }
  me.vy += 0.5; me.y = Math.min(FLOOR, me.y + me.vy); if (me.y >= FLOOR) me.vy = 0;
  // Keep apart.
  if (Math.abs(me.x - foe.x) < 22) me.x = Math.max(16, Math.min(W - 16, foe.x - me.face * 22));
  // Melee hit.
  if (me.move && me.move !== "special" && !me.hitDone) {
    const m = MOVES[me.move];
    if (me.t >= m.startup && me.t < m.startup + m.active && Math.abs(foe.x - me.x) <= m.range && Math.abs(foe.y - me.y) < 30) {
      me.hitDone = true;
      hit(d, i, Math.max(1, Math.round(me.attack * m.mult) - Math.floor(foe.defense / 2)));
    }
  }
}

function hit(d: FighterData, attacker: 0 | 1, dmg: number) {
  const me = d.p[attacker], foe = d.p[1 - attacker]!;
  if (foe.guard && !foe.move) { foe.hp = Math.max(0, foe.hp - Math.max(1, Math.floor(dmg / 5))); foe.x = Math.max(16, Math.min(W - 16, foe.x + me.face * 8)); d.flash = "GUARD"; return; }
  const chained = foe.stun > 0;
  foe.hp = Math.max(0, foe.hp - dmg); foe.stun = 12; foe.move = undefined; foe.x = Math.max(16, Math.min(W - 16, foe.x + me.face * 6));
  me.combo = chained ? me.combo + 1 : 1; me.meter = Math.min(100, me.meter + 12); foe.meter = Math.min(100, foe.meter + 6);
  d.flash = me.combo > 1 ? `${me.combo} HIT` : "HIT";
}

export function stepFighter(data: FighterData, held: string[]): FighterData {
  const d: FighterData = structuredClone(data);
  d.frame++;
  const p2 = d.versus ? held.filter(b => b.startsWith("p2")).map(b => b.slice(2)) : cpuButtons(d, d.p[1], d.p[0]);
  stepOne(d, 0, held.filter(b => !b.startsWith("p2")));
  stepOne(d, 1, p2);
  if (d.p[1].stun === 0 && !d.p[0].move) d.p[0].combo = 0;
  if (d.p[0].stun === 0 && !d.p[1].move) d.p[1].combo = 0;
  d.balls = d.balls.filter(b => {
    b.x += b.vx;
    const target = d.p[1 - b.owner]!;
    if (Math.abs(b.x - target.x) < 12 && target.y > FLOOR - 40) { hit(d, b.owner, b.dmg); return false; }
    return b.x > 0 && b.x < W;
  });
  return d;
}

export function fighterStatus(d: FighterData): "playing" | "win" | "lose" {
  const [a, b] = d.p;
  if (b.hp <= 0) return "win";
  if (a.hp <= 0) return "lose";
  if (d.frame >= d.args.seconds * FPS) return a.hp / a.maxHp >= b.hp / b.maxHp ? "win" : "lose";
  return "playing";
}

const scene = (versus: boolean): SceneDefinition => ({
  title: versus ? "格闘（ローカル2人対戦）" : "格闘（1対1、CPU・RPGの敵と）",
  realtime: { fps: FPS, players: versus ? 2 : 1 },
  checkArgs: args => issues(FighterArgsSchema.safeParse(args)),
  start: (ctx, raw) => startFighter(ctx, raw, versus),
  input(ctx, raw, input) {
    const d = raw as FighterData;
    if (input.type === "cancel") return d.args.canFlee || !inBattle(ctx) ? finish(ctx, d.args, "quit", "勝負を降りた。") : {};
    if (input.type !== "frame") return {};
    const next = stepFighter(d, input.held);
    const status = fighterStatus(next);
    const heroHp = Math.max(1, Math.round((next.p[0].hp / next.p[0].maxHp) * heroOf(ctx).maxHp));
    if (status === "win") return finish(ctx, d.args, "win", `${next.p[0].name}の勝ち！（${d.args.title}）`, heroHp);
    if (status === "lose") return finish(ctx, d.args, "lose", `${next.p[1].name}の勝ち……`, heroHp);
    return { data: next };
  },
  draw(g, view) {
    const d = view.data as FighterData;
    const s = Math.min(view.width / W, view.height / 240), ox = (view.width - W * s) / 2;
    g.fillStyle = "#151824"; g.fillRect(0, 0, view.width, view.height);
    g.save(); g.translate(ox, 0); g.scale(s, s); g.imageSmoothingEnabled = false;
    const sky = g.createLinearGradient(0, 0, 0, FLOOR); sky.addColorStop(0, "#2b2a4a"); sky.addColorStop(1, "#5a3f4a"); g.fillStyle = sky; g.fillRect(0, 0, W, FLOOR);
    g.fillStyle = "#3b2f2a"; g.fillRect(0, FLOOR, W, 40);
    const enemy = enemyOf({ content: view.content, state: view.state }, d.args.enemyId);
    d.p.forEach((f, i) => {
      g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(f.x, FLOOR + 2, 12, 3, 0, 0, Math.PI * 2); g.fill();
      const blink = f.stun > 0 && d.frame % 4 < 2;
      if (i === 0 || (d.versus && !enemy)) { if (!blink) drawHero(g, view, f.x, f.y - 16, 34, f.face > 0 ? 2 : 1, f.move ? 1 : Math.floor(d.frame / 6)); }
      else if (!blink) {
        const c = document.createElement("canvas"); c.width = c.height = 36;
        const asset = enemy?.sprite ? view.content.assets.assets.find(a => a.id === enemy.sprite) : undefined;
        drawEnemyPortrait(c.getContext("2d")!, enemy?.id ?? "rival", 36, view.time, image(enemy?.sprite ? view.assetUrl(enemy.sprite) : undefined), asset);
        g.drawImage(c, f.x - 18, f.y - 36);
      }
      if (f.move && f.move !== "special" && f.t >= MOVES[f.move].startup && f.t < MOVES[f.move].startup + MOVES[f.move].active) { g.fillStyle = "rgba(255,240,200,.85)"; g.fillRect(f.x + f.face * 10, f.y - (f.move === "low" ? 8 : 24), f.face * MOVES[f.move].range * 0.7, 5); }
      if (f.guard) { g.strokeStyle = "rgba(127,200,255,.8)"; g.lineWidth = 2; g.beginPath(); g.arc(f.x + f.face * 6, f.y - 16, 16, -1, 1); g.stroke(); }
      // Bars.
      const left = i === 0 ? 10 : W - 130;
      g.fillStyle = "#222"; g.fillRect(left, 10, 120, 7); g.fillStyle = i === 0 ? "#7fc46b" : "#d9745b"; g.fillRect(i === 0 ? left : left + 120 * (1 - f.hp / f.maxHp), 10, 120 * (f.hp / f.maxHp), 7);
      g.fillStyle = "#f0c36a"; g.fillRect(left, 20, 120 * (f.meter / 100), 2);
      g.fillStyle = "#e9dcb8"; g.font = "8px system-ui"; g.textAlign = i === 0 ? "left" : "right"; g.fillText(`${f.name}${f.combo > 1 ? `  ${f.combo} HIT` : ""}`, i === 0 ? left : left + 120, 32);
    });
    g.fillStyle = "#f6e27a"; for (const b of d.balls) { g.beginPath(); g.arc(b.x, b.y, 5, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = "#e9dcb8"; g.font = "bold 12px system-ui"; g.textAlign = "center"; g.fillText(String(Math.max(0, Math.ceil(d.args.seconds - d.frame / FPS))), W / 2, 18);
    if (d.frame < 30) { g.font = "bold 20px system-ui"; g.fillText("FIGHT!", W / 2, 100); }
    g.restore();
    g.fillStyle = "#a9b09d"; g.font = "12px system-ui"; g.textAlign = "center";
    g.fillText(d.versus ? "1P: WASD 移動・ジャンプ  F 攻撃  G ガード ／ 2P: 矢印  Enter 攻撃  / ガード  （↓+攻撃 下段、↓→攻撃 気弾）" : "←→ 移動  ↑ ジャンプ  Z 攻撃  ↓+Z 下段  ↓→Z 気弾（ゲージ）  Shift ガード  Esc やめる", view.width / 2, view.height - 14);
  },
});

export default defineSystem({ id: "fighter", scenes: { duel: scene(false), versus: scene(true) } });

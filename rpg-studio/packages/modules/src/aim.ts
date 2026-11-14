/**
 * Genre module: aiming / light-gun shooting (realtime). Targets pop up (gallery) or rush toward you (rail: they grow
 * as they approach, the ground scrolls). Move the sight with the arrows or click to shoot there; Shift reloads.
 * Don't hit the friends. Foes that stay too long strike you. Battle mode: the RPG enemy's minions; win to beat it.
 */
import { z } from "zod";
import { defineSystem, type SystemContext } from "../../engine/src/index";
import { enemyOf, finish, heroOf, inBattle, issues, OutcomeArgs, pressed } from "./common";
import { asRecord, nextRand } from "./ui";

const FPS = 30;

export const AimArgsSchema = z.object({
  title: z.string().default("射的"),
  rail: z.boolean().default(false),
  /** Explicit targets (time in seconds, position in %). Empty = generated from `count`. */
  targets: z.array(z.object({ at: z.number().min(0), x: z.number().min(0).max(100), y: z.number().min(0).max(100), kind: z.enum(["foe", "friend", "bonus"]).default("foe"), stay: z.number().min(0.3).max(30).default(2.5) }).strict()).default([]),
  count: z.number().int().min(1).max(500).default(20),
  /** Foes to hit to pass (default: 70% of the foes). */
  need: z.number().int().min(1).optional(),
  ammo: z.number().int().min(1).max(99).default(6),
  /** Damage when a foe is left standing until it strikes. 0 = from the RPG enemy / 2. */
  damage: z.number().int().min(0).max(999).default(0),
  ...OutcomeArgs,
}).strict();
export type AimArgs = z.infer<typeof AimArgsSchema>;

interface Target { at: number; x: number; y: number; kind: "foe" | "friend" | "bonus"; stay: number; state: "wait" | "up" | "hit" | "gone" }
export interface AimData { args: AimArgs; frame: number; targets: Target[]; sight: { x: number; y: number }; ammo: number; reload: number; cool: number; hits: number; misses: number; friendly: number; hp: number; maxHp: number; held: string[]; flash: number; message: string }

export function startAim(ctx: SystemContext, raw: Record<string, unknown>): AimData {
  const args = AimArgsSchema.parse(raw);
  let seed = ctx.state.rng || 1;
  const r = () => { let v: number; [v, seed] = nextRand(seed); return v; };
  const targets: Target[] = (args.targets.length ? args.targets : Array.from({ length: args.count }, (_, i) => ({ at: 1 + i * 1.1 + r() * 0.6, x: 10 + r() * 80, y: 25 + r() * 55, kind: r() < 0.15 ? "friend" as const : r() < 0.1 ? "bonus" as const : "foe" as const, stay: 2.2 + r() }))).map(t => ({ ...t, state: "wait" as const }));
  const hero = heroOf(ctx);
  return { args, frame: 0, targets, sight: { x: 50, y: 50 }, ammo: args.ammo, reload: 0, cool: 0, hits: 0, misses: 0, friendly: 0, hp: hero.hp, maxHp: hero.maxHp, held: [], flash: 0, message: args.title };
}

const sizeOf = (d: AimData, t: Target) => { if (!d.args.rail) return 6; const life = (d.frame / FPS - t.at) / t.stay; return 3 + Math.max(0, Math.min(1, life)) * 9; };

export function fire(d: AimData, x: number, y: number): AimData {
  if (d.ammo <= 0 || d.reload > 0 || d.cool > 0) return d;
  const next = { ...d, ammo: d.ammo - 1, cool: 5, flash: 3, targets: d.targets.map(t => ({ ...t })) };
  const target = next.targets.filter(t => t.state === "up" && Math.hypot(t.x - x, t.y - y) <= sizeOf(next, t)).sort((a, b) => b.at - a.at)[0];
  if (!target) return { ...next, misses: next.misses + 1 };
  target.state = "hit";
  if (target.kind === "friend") return { ...next, friendly: next.friendly + 1, message: "味方を撃ってしまった！" };
  return { ...next, hits: next.hits + (target.kind === "bonus" ? 2 : 1), message: target.kind === "bonus" ? "ボーナス！" : "命中" };
}

export function stepAim(ctx: SystemContext, data: AimData, held: string[], click?: { x: number; y: number }): AimData {
  let d: AimData = { ...data, frame: data.frame + 1, held, cool: Math.max(0, data.cool - 1), flash: Math.max(0, data.flash - 1), targets: data.targets.map(t => ({ ...t })) };
  const now = pressed(held, data.held);
  if (d.reload > 0) { d.reload--; if (d.reload === 0) d.ammo = d.args.ammo; }
  const sp = 2.2;
  d.sight = { x: Math.max(0, Math.min(100, d.sight.x + ((held.includes("right") ? 1 : 0) - (held.includes("left") ? 1 : 0)) * sp)), y: Math.max(0, Math.min(100, d.sight.y + ((held.includes("down") ? 1 : 0) - (held.includes("up") ? 1 : 0)) * sp)) };
  if ((now.includes("focus") || d.ammo === 0) && d.reload === 0 && d.ammo < d.args.ammo) { d.reload = 24; d.message = "装填中…"; }
  if (click) { d.sight = click; d = fire(d, click.x, click.y); }
  else if (now.includes("fire")) d = fire(d, d.sight.x, d.sight.y);
  const t = d.frame / FPS;
  const strike = d.args.damage || Math.max(1, Math.floor((enemyOf(ctx, d.args.enemyId)?.stats.attack ?? 4) / 2));
  for (const target of d.targets) {
    if (target.state === "wait" && t >= target.at) target.state = "up";
    if (target.state === "up" && t >= target.at + target.stay) {
      target.state = "gone";
      if (target.kind === "foe") { d.hp = Math.max(0, d.hp - strike); d.message = `反撃を受けた（${strike}）`; }
    }
  }
  return d;
}

export function aimStatus(d: AimData): "playing" | "win" | "lose" {
  const foes = d.targets.filter(t => t.kind === "foe").length;
  const need = d.args.need ?? Math.max(1, Math.ceil(foes * 0.7));
  if (d.hp <= 0) return "lose";
  if (d.hits >= need && (d.args.need !== undefined || d.targets.every(t => t.state === "hit" || t.state === "gone"))) return "win";
  if (d.targets.every(t => t.state === "hit" || t.state === "gone")) return d.hits >= need ? "win" : "lose";
  return "playing";
}

export default defineSystem({
  id: "aim",
  scenes: {
    shoot: {
      title: "射撃（射的・ガンシューティング・レールシューティング）",
      realtime: { fps: FPS },
      checkArgs: args => issues(AimArgsSchema.safeParse(args)),
      start: (ctx, raw) => startAim(ctx, raw),
      input(ctx, raw, input) {
        const d = raw as AimData;
        if (input.type === "cancel") return d.args.canFlee || !inBattle(ctx) ? finish(ctx, d.args, "quit", "銃を下ろした。", d.hp) : {};
        let next: AimData;
        if (input.type === "custom") {
          const c = asRecord(asRecord(input.value).click);
          if (typeof c.x !== "number") return {};
          next = stepAim(ctx, d, d.held, { x: (c.x / Number(c.width)) * 100, y: ((c.y as number) / Number(c.height)) * 100 });
        } else if (input.type === "frame") next = stepAim(ctx, d, input.held);
        else return {};
        const status = aimStatus(next);
        if (status === "win") return finish(ctx, d.args, "win", `${d.args.title}：${next.hits}発命中！${next.friendly ? `（味方への誤射 ${next.friendly}）` : ""}`, next.hp);
        if (status === "lose") return finish(ctx, d.args, "lose", next.hp <= 0 ? "撃ち負けた……" : `${d.args.title}：命中が足りなかった（${next.hits}）`, next.hp);
        return { data: next };
      },
      draw(g, view) {
        const d = view.data as AimData;
        const W = view.width, H = view.height, px = (v: number) => (v / 100) * W, py = (v: number) => (v / 100) * H;
        const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#2a3550"); sky.addColorStop(0.55, "#4a4a5a"); sky.addColorStop(0.56, "#3a3226"); sky.addColorStop(1, "#241e17");
        g.fillStyle = sky; g.fillRect(0, 0, W, H);
        if (d.args.rail) { g.strokeStyle = "rgba(233,220,184,.18)"; for (let i = 0; i < 8; i++) { const y = H * 0.56 + ((i * 40 + d.frame * 4) % (H * 0.44)); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } }
        else { g.fillStyle = "#5a4630"; g.fillRect(0, H * 0.8, W, H * 0.2); }
        for (const t of d.targets) {
          if (t.state !== "up") continue;
          const r = (sizeOf(d, t) / 100) * W;
          g.fillStyle = t.kind === "foe" ? "#d9745b" : t.kind === "friend" ? "#7fc4ff" : "#f0c36a";
          g.beginPath(); g.arc(px(t.x), py(t.y), r, 0, Math.PI * 2); g.fill();
          g.fillStyle = "#fff"; g.beginPath(); g.arc(px(t.x), py(t.y), r * 0.45, 0, Math.PI * 2); g.fill();
          g.fillStyle = t.kind === "foe" ? "#d9745b" : t.kind === "friend" ? "#2f5d8a" : "#c08a20"; g.beginPath(); g.arc(px(t.x), py(t.y), r * 0.2, 0, Math.PI * 2); g.fill();
          const left = 1 - (d.frame / FPS - t.at) / t.stay;
          if (t.kind === "foe") { g.fillStyle = "rgba(0,0,0,.5)"; g.fillRect(px(t.x) - r, py(t.y) + r + 3, 2 * r, 3); g.fillStyle = "#f0c36a"; g.fillRect(px(t.x) - r, py(t.y) + r + 3, 2 * r * left, 3); }
        }
        if (d.flash) { g.fillStyle = "rgba(255,240,200,.08)"; g.fillRect(0, 0, W, H); }
        g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(px(d.sight.x), py(d.sight.y), 12, 0, Math.PI * 2); g.moveTo(px(d.sight.x) - 18, py(d.sight.y)); g.lineTo(px(d.sight.x) + 18, py(d.sight.y)); g.moveTo(px(d.sight.x), py(d.sight.y) - 18); g.lineTo(px(d.sight.x), py(d.sight.y) + 18); g.stroke();
        g.fillStyle = "#e9dcb8"; g.font = "14px system-ui"; g.textAlign = "left";
        g.fillText(`${d.args.title}　命中 ${d.hits}　HP ${d.hp}/${d.maxHp}　弾 ${d.reload ? "装填中" : "●".repeat(d.ammo) + "○".repeat(d.args.ammo - d.ammo)}　${d.message}`, 12, 22);
        g.fillStyle = "#a9b09d"; g.font = "12px system-ui";
        g.fillText("矢印 照準　Z 撃つ（クリックでも撃てる）　Shift 装填　青は味方　Esc やめる", 12, H - 12);
      },
    },
  },
});

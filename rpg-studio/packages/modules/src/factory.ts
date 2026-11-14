/**
 * Genre module: factory / automation (realtime). Raw materials flow in; put recipes into machine slots and chain them
 * so outputs feed the next machine. Reach the target amount before time runs out. Covers factory and automation
 * games, alchemy workshops, kitchens, smithies, supply lines.
 */
import { z } from "zod";
import { IdSchema } from "../../schema/src/formats";
import { defineSystem } from "../../engine/src/index";
import { finish, issues, OutcomeArgs, pressed } from "./common";
import { asRecord } from "./ui";

const FPS = 30;
const Amounts = z.record(IdSchema, z.number().int().min(1).max(999));
export const FactoryArgsSchema = z.object({
  title: z.string().default("工房"),
  items: z.record(IdSchema, z.string().min(1)).default({ ore: "鉱石", wood: "木材", ingot: "鉄塊", plank: "板", tool: "道具" }),
  /** Raw materials arriving per second. */
  sources: z.record(IdSchema, z.number().min(0).max(100)).default({ ore: 1, wood: 1 }),
  recipes: z.array(z.object({ id: IdSchema, label: z.string().min(1).max(10), inputs: Amounts, outputs: Amounts, seconds: z.number().min(0.1).max(600) }).strict()).min(1)
    .default([
      { id: "smelt", label: "炉", inputs: { ore: 2 }, outputs: { ingot: 1 }, seconds: 2 },
      { id: "saw", label: "製材", inputs: { wood: 1 }, outputs: { plank: 2 }, seconds: 1.5 },
      { id: "craft", label: "組立", inputs: { ingot: 1, plank: 2 }, outputs: { tool: 1 }, seconds: 3 },
    ]),
  slots: z.number().int().min(1).max(12).default(4),
  goal: z.object({ item: IdSchema, amount: z.number().int().min(1).max(99999) }).strict().default({ item: "tool", amount: 5 }),
  seconds: z.number().min(5).max(3600).default(90),
  /** Storage cap per item. */
  capacity: z.number().int().min(1).max(99999).default(50),
  ...OutcomeArgs,
}).strict();
export type FactoryArgs = z.infer<typeof FactoryArgsSchema>;

export interface FactoryData { args: FactoryArgs; frame: number; stock: Record<string, number>; slots: Array<{ recipe: number; progress: number; busy: boolean }>; cursor: number; held: string[]; made: number }

export function checkFactory(a: FactoryArgs): string[] {
  const out: string[] = [];
  const known = new Set(Object.keys(a.items));
  const ref = (where: string, id: string) => { if (!known.has(id)) out.push(`${where}: items にない '${id}'`); };
  Object.keys(a.sources).forEach(id => ref("sources", id));
  a.recipes.forEach(r => { Object.keys(r.inputs).forEach(id => ref(`recipes.${r.id}.inputs`, id)); Object.keys(r.outputs).forEach(id => ref(`recipes.${r.id}.outputs`, id)); });
  ref("goal.item", a.goal.item);
  if (!a.recipes.some(r => a.goal.item in r.outputs)) out.push(`goal.item '${a.goal.item}' を作るレシピがありません`);
  return out;
}

export function startFactory(raw: Record<string, unknown>): FactoryData {
  const args = FactoryArgsSchema.parse(raw);
  return { args, frame: 0, stock: Object.fromEntries(Object.keys(args.items).map(id => [id, 0])), slots: Array.from({ length: args.slots }, () => ({ recipe: -1, progress: 0, busy: false })), cursor: 0, held: [], made: 0 };
}

export function setRecipe(d: FactoryData, slot: number, recipe: number): FactoryData {
  return { ...d, cursor: slot, slots: d.slots.map((s, i) => (i === slot ? { recipe, progress: 0, busy: false } : s)) };
}

export function stepFactory(data: FactoryData, held: string[]): FactoryData {
  const d: FactoryData = { ...data, frame: data.frame + 1, held, stock: { ...data.stock }, slots: data.slots.map(s => ({ ...s })) };
  const now = pressed(held, data.held);
  if (now.includes("left")) d.cursor = (d.cursor + d.slots.length - 1) % d.slots.length;
  if (now.includes("right")) d.cursor = (d.cursor + 1) % d.slots.length;
  const n = d.args.recipes.length;
  if (now.includes("up") || now.includes("fire")) d.slots[d.cursor] = { recipe: ((d.slots[d.cursor]!.recipe + 2) % (n + 1)) - 1, progress: 0, busy: false };
  if (now.includes("down")) d.slots[d.cursor] = { recipe: ((d.slots[d.cursor]!.recipe + n + 1) % (n + 1)) - 1, progress: 0, busy: false };
  const cap = d.args.capacity;
  for (const [id, rate] of Object.entries(d.args.sources)) if (d.frame % Math.max(1, Math.round(FPS / rate)) === 0) d.stock[id] = Math.min(cap, (d.stock[id] ?? 0) + 1);
  for (const slot of d.slots) {
    const r = d.args.recipes[slot.recipe];
    if (!r) continue;
    if (!slot.busy) {
      if (Object.entries(r.inputs).every(([id, k]) => (d.stock[id] ?? 0) >= k)) { for (const [id, k] of Object.entries(r.inputs)) d.stock[id]! -= k; slot.busy = true; slot.progress = 0; }
      continue;
    }
    slot.progress++;
    if (slot.progress >= Math.round(r.seconds * FPS)) {
      for (const [id, k] of Object.entries(r.outputs)) { d.stock[id] = Math.min(cap, (d.stock[id] ?? 0) + k); if (id === d.args.goal.item) d.made += k; }
      slot.busy = false;
    }
  }
  return d;
}

export const factoryStatus = (d: FactoryData): "playing" | "win" | "lose" => (d.made >= d.args.goal.amount ? "win" : d.frame >= d.args.seconds * FPS ? "lose" : "playing");

export default defineSystem({
  id: "factory",
  scenes: {
    line: {
      title: "工場・自動化（機械にレシピを入れて生産ラインをつなぐ）",
      realtime: { fps: FPS },
      checkArgs: args => { const r = FactoryArgsSchema.safeParse(args); return r.success ? checkFactory(r.data) : issues(r); },
      start: (_ctx, raw) => startFactory(raw),
      input(ctx, raw, input) {
        const d = raw as FactoryData;
        if (input.type === "cancel") return finish(ctx, d.args, "quit", "工房を閉めた。");
        let next: FactoryData;
        if (input.type === "custom") {
          const c = asRecord(asRecord(input.value).click);
          if (typeof c.x !== "number") return {};
          const slot = Math.floor(((c.x / Number(c.width)) * d.slots.length));
          next = setRecipe(d, slot, ((d.slots[slot]!.recipe + 2) % (d.args.recipes.length + 1)) - 1);
        } else if (input.type === "frame") next = stepFactory(d, input.held);
        else return {};
        const status = factoryStatus(next);
        const name = d.args.items[d.args.goal.item] ?? d.args.goal.item;
        if (status === "win") return finish(ctx, d.args, "win", `${d.args.title}：${name}を${next.made}個作った！（${Math.round(next.frame / FPS)}秒）`);
        if (status === "lose") return finish(ctx, d.args, "lose", `${d.args.title}：時間切れ（${name} ${next.made}/${d.args.goal.amount}）`);
        return { data: next };
      },
      draw(g, view) {
        const d = view.data as FactoryData;
        const W = view.width, H = view.height;
        g.fillStyle = "#1c1a17"; g.fillRect(0, 0, W, H);
        g.fillStyle = "#e9dcb8"; g.font = "15px system-ui"; g.textAlign = "left";
        const name = (id: string) => d.args.items[id] ?? id;
        g.fillText(`${d.args.title}　目標: ${name(d.args.goal.item)} ${d.made}/${d.args.goal.amount}　残り ${Math.max(0, Math.ceil(d.args.seconds - d.frame / FPS))}秒`, 14, 26);
        // Stock.
        Object.keys(d.args.items).forEach((id, i) => {
          const x = 14 + i * ((W - 28) / Object.keys(d.args.items).length);
          g.fillStyle = "#2c2924"; g.fillRect(x, 44, (W - 28) / Object.keys(d.args.items).length - 8, 46);
          g.fillStyle = id === d.args.goal.item ? "#f0c36a" : "#e9dcb8"; g.font = "13px system-ui"; g.fillText(`${name(id)} ${d.stock[id] ?? 0}`, x + 8, 64);
          g.fillStyle = "#7fa8d9"; g.fillRect(x + 8, 74, ((W - 28) / Object.keys(d.args.items).length - 24) * Math.min(1, (d.stock[id] ?? 0) / d.args.capacity), 6);
        });
        // Machines.
        const sw = (W - 28) / d.slots.length;
        d.slots.forEach((s, i) => {
          const x = 14 + i * sw, y = 110, hgt = H - 170;
          const r = d.args.recipes[s.recipe];
          g.fillStyle = s.busy ? "#3a3326" : "#2a2622"; g.fillRect(x + 4, y, sw - 8, hgt);
          g.strokeStyle = i === d.cursor ? "#f0c36a" : "#4a443a"; g.lineWidth = 2; g.strokeRect(x + 4, y, sw - 8, hgt);
          g.fillStyle = "#e9dcb8"; g.font = "bold 15px system-ui"; g.textAlign = "center";
          g.fillText(r ? r.label : "（空き）", x + sw / 2, y + 30);
          if (r) {
            g.font = "12px system-ui"; g.fillStyle = "#a9b09d";
            g.fillText(Object.entries(r.inputs).map(([id, k]) => `${name(id)}${k}`).join("+"), x + sw / 2, y + 56);
            g.fillText("↓", x + sw / 2, y + 74);
            g.fillText(Object.entries(r.outputs).map(([id, k]) => `${name(id)}${k}`).join("+"), x + sw / 2, y + 92);
            g.fillStyle = "#222"; g.fillRect(x + 16, y + hgt - 24, sw - 32, 8);
            g.fillStyle = "#f0c36a"; g.fillRect(x + 16, y + hgt - 24, (sw - 32) * (s.busy ? s.progress / Math.round(r.seconds * FPS) : 0), 8);
          }
          g.textAlign = "left";
        });
        g.fillStyle = "#a9b09d"; g.font = "12px system-ui";
        g.fillText("←→ 機械を選ぶ　↑↓/Z レシピを変える（クリックでも可）　前の機械の出来た物が次の材料になる　Esc やめる", 14, H - 14);
      },
    },
  },
});

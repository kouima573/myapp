/**
 * Built-in module: shops and inns — the RPG staples.
 *   shop.buy  — buy (and sell) with a currency variable. Equipment shows the stat change against what is worn now.
 *   shop.inn  — pay to rest: everyone recovers fully.
 *   shop.craft   — 合成: recipes turn materials (and money) into an item.
 *   shop.storage — 倉庫: put carried items into a box and take them back later (kept in the save).
 * Prices come from the shop's list, or from the item's `price`. Selling pays `sellRate` of the price.
 */
import { z } from "zod";
import type { Effect, GameContent, GameState, StatMods } from "../../schema/src/formats";
import { IdSchema } from "../../schema/src/formats";
import { defineSystem, type SystemContext } from "../../engine/src/index";
import { issues } from "./common";
import { asRecord, backdrop, button, h } from "./ui";

export const ShopArgsSchema = z.object({
  title: z.string().default("お店"),
  /** Greeting shown at the top. */
  greeting: z.string().default("いらっしゃい！"),
  /** Variable used as money (project.json › variables). */
  currency: IdSchema.default("gold"),
  items: z.array(z.object({ item: IdSchema, price: z.number().int().min(0).optional() }).strict()).min(1),
  /** Allow selling carried items (not key items). */
  sell: z.boolean().default(true),
  sellRate: z.number().min(0).max(1).default(0.5),
}).strict();
export type ShopArgs = z.infer<typeof ShopArgsSchema>;

export const InnArgsSchema = z.object({
  title: z.string().default("宿屋"),
  greeting: z.string().default("ひと晩いかがですか？"),
  currency: IdSchema.default("gold"),
  price: z.number().int().min(0).default(10),
  /** Shown after resting. */
  message: z.string().default("ぐっすり眠って、すっかり元気になった。"),
}).strict();
export type InnArgs = z.infer<typeof InnArgsSchema>;

export const CraftArgsSchema = z.object({
  title: z.string().default("合成"),
  greeting: z.string().default("材料を持ってきたら作ってあげよう。"),
  currency: IdSchema.default("gold"),
  recipes: z.array(z.object({
    item: IdSchema, count: z.number().int().min(1).max(99).default(1),
    needs: z.array(z.object({ item: IdSchema, count: z.number().int().min(1).max(99).default(1) }).strict()).min(1),
    /** Fee in the currency variable. */
    cost: z.number().int().min(0).default(0),
  }).strict()).min(1),
}).strict();
export type CraftArgs = z.infer<typeof CraftArgsSchema>;
export interface CraftData { args: CraftArgs; cursor: number; message: string }

export const StorageArgsSchema = z.object({
  title: z.string().default("倉庫"),
  /** Several separate boxes can exist (by id). */
  box: IdSchema.default("main"),
  /** How many different items fit (0 = no limit). */
  capacity: z.number().int().min(0).max(999).default(0),
}).strict();
export type StorageArgs = z.infer<typeof StorageArgsSchema>;
export interface StorageData { args: StorageArgs; mode: "put" | "take"; cursor: number; message: string }

/** Contents of a storage box (state.systemData.shop.storage[box]). */
export function boxOf(state: GameState, box: string): Record<string, number> {
  const data = asRecord(state.systemData?.shop);
  return { ...(asRecord(asRecord(data.storage)[box]) as Record<string, number>) };
}
function withBox(state: GameState, box: string, contents: Record<string, number>): GameState {
  const data = asRecord(state.systemData?.shop);
  const storage = { ...asRecord(data.storage), [box]: Object.fromEntries(Object.entries(contents).filter(([, n]) => n > 0)) };
  return { ...state, systemData: { ...state.systemData, shop: { ...data, storage } } };
}

/** Can this recipe be made now? Returns what is missing (empty = yes). */
export function missingFor(content: GameContent, state: GameState, args: CraftArgs, index: number): string[] {
  const r = args.recipes[index]!;
  const name = (id: string) => content.database.items.find(i => i.id === id)?.name ?? id;
  const out = r.needs.filter(n => (state.items[n.item] ?? 0) < n.count).map(n => `${name(n.item)}×${n.count - (state.items[n.item] ?? 0)}`);
  if (r.cost > money(state, args)) out.push(`${label(content, args)}${r.cost - money(state, args)}`);
  return out;
}
export function craft(ctx: SystemContext, d: CraftData, index: number): { data: CraftData; apply?: Effect[] } {
  const r = d.args.recipes[index];
  if (!r) return { data: d };
  const name = ctx.content.database.items.find(i => i.id === r.item)?.name ?? r.item;
  const missing = missingFor(ctx.content, ctx.state, d.args, index);
  if (missing.length) return { data: { ...d, message: `足りない: ${missing.join("・")}` } };
  return {
    data: { ...d, message: `${name}${r.count > 1 ? `×${r.count}` : ""}ができた！` },
    apply: [
      ...r.needs.map(n => ({ type: "takeItem", item: n.item, count: n.count }) as Effect),
      ...(r.cost ? [{ type: "setVar", var: d.args.currency, value: r.cost, op: "sub" } as Effect] : []),
      { type: "giveItem", item: r.item, count: r.count },
    ],
  };
}

export interface ShopData { args: ShopArgs; mode: "buy" | "sell"; cursor: number; message: string }

const priceOf = (content: GameContent, args: ShopArgs, item: string) => args.items.find(x => x.item === item)?.price ?? content.database.items.find(i => i.id === item)?.price;
const money = (state: GameState, args: { currency: string }) => state.vars[args.currency] ?? 0;
const label = (content: GameContent, args: { currency: string }) => content.project.variables[args.currency]?.label ?? args.currency;

/** Items the hero can sell right now (carried, not key items, with a price). */
export function sellable(ctx: SystemContext, args: ShopArgs): Array<{ item: string; price: number; count: number }> {
  return Object.entries(ctx.state.items).flatMap(([item, count]) => {
    const def = ctx.content.database.items.find(i => i.id === item);
    const price = priceOf(ctx.content, args, item);
    if (!def || def.key || price === undefined || count <= 0) return [];
    return [{ item, price: Math.floor(price * args.sellRate), count }];
  });
}

/** "攻撃+2（いま+0）" for equipment against what is worn in that slot. Numbers only (expressions are shown as "?"). */
export function compareEquipment(content: GameContent, state: GameState, itemId: string): string {
  const item = content.database.items.find(i => i.id === itemId);
  if (!item?.slot) return "";
  const worn = state.equipment?.[item.slot];
  const wornItem = worn ? content.database.items.find(i => i.id === worn) : undefined;
  const value = (mods: StatMods | undefined, key: keyof StatMods) => { const v = mods?.[key]; return typeof v === "number" ? v : v === undefined ? 0 : NaN; };
  const names: Array<[keyof StatMods, string]> = [["attack", "攻撃"], ["defense", "防御"], ["maxHp", "HP"]];
  const parts = names.flatMap(([key, name]) => {
    const now = value(wornItem?.statMods, key), next = value(item.statMods, key);
    if (now === 0 && next === 0) return [];
    if (Number.isNaN(now) || Number.isNaN(next)) return [`${name}?`];
    const diff = next - now;
    return [`${name}${diff >= 0 ? "+" : ""}${diff}`];
  });
  const slot = content.project.equipmentSlots[item.slot]?.label ?? item.slot;
  return `${slot}${parts.length ? `　${parts.join(" ")}` : ""}${worn === itemId ? "（装備中）" : ""}`;
}

export function buyItem(ctx: SystemContext, d: ShopData, item: string): { data: ShopData; apply?: Effect[] } {
  const price = priceOf(ctx.content, d.args, item) ?? 0;
  const name = ctx.content.database.items.find(i => i.id === item)?.name ?? item;
  if (money(ctx.state, d.args) < price) return { data: { ...d, message: `${label(ctx.content, d.args)}が足りない（${price}必要）。` } };
  return {
    data: { ...d, message: `${name}を買った。` },
    apply: [{ type: "setVar", var: d.args.currency, value: price, op: "sub" }, { type: "giveItem", item }],
  };
}

export function sellItem(ctx: SystemContext, d: ShopData, item: string): { data: ShopData; apply?: Effect[] } {
  const entry = sellable(ctx, d.args).find(x => x.item === item);
  if (!entry) return { data: d };
  const name = ctx.content.database.items.find(i => i.id === item)?.name ?? item;
  const effects: Effect[] = [{ type: "takeItem", item }, { type: "setVar", var: d.args.currency, value: entry.price, op: "add" }];
  // Selling the last one of something worn takes it off first.
  const def = ctx.content.database.items.find(i => i.id === item);
  if (def?.slot && ctx.state.equipment?.[def.slot] === item && entry.count <= 1) effects.unshift({ type: "unequip", slot: def.slot });
  return { data: { ...d, message: `${name}を${entry.price}で売った。` }, apply: effects };
}

function checkShop(args: ShopArgs, content: GameContent): string[] {
  const out: string[] = [];
  if (!content.project.variables[args.currency]) out.push(`currency '${args.currency}' が project.json の variables にありません`);
  args.items.forEach((x, i) => {
    const def = content.database.items.find(it => it.id === x.item);
    if (!def) out.push(`items[${i}]: 未定義のアイテム '${x.item}'`);
    else if (x.price === undefined && def.price === undefined) out.push(`items[${i}]: '${x.item}' に値段がありません（price を書くか、アイテムに price を付ける）`);
  });
  return out;
}

export default defineSystem({
  id: "shop",
  scenes: {
    craft: {
      title: "合成（材料とお金でアイテムを作る）",
      checkArgs: (args, { content }) => {
        const r = CraftArgsSchema.safeParse(args);
        if (!r.success) return issues(r);
        const out: string[] = [];
        if (r.data.recipes.some(x => x.cost) && !content.project.variables[r.data.currency]) out.push(`currency '${r.data.currency}' が project.json の variables にありません`);
        r.data.recipes.forEach((x, i) => { for (const id of [x.item, ...x.needs.map(n => n.item)]) if (!content.database.items.some(it => it.id === id)) out.push(`recipes[${i}]: 未定義のアイテム '${id}'`); });
        return out;
      },
      start(_ctx, raw) { const args = CraftArgsSchema.parse(raw); return { args, cursor: 0, message: args.greeting } satisfies CraftData; },
      input(ctx, raw, input) {
        const d = raw as CraftData;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if (input.type === "cancel" || value.leave) return { close: true };
        const n = d.args.recipes.length;
        if (input.type === "up" || input.type === "down") return { data: { ...d, cursor: (d.cursor + (input.type === "up" ? -1 : 1) + n) % n } };
        const index = typeof value.recipe === "number" ? value.recipe : input.type === "confirm" ? d.cursor : -1;
        if (index < 0) return {};
        const result = craft(ctx, { ...d, cursor: index }, index);
        return { data: result.data, ...(result.apply ? { apply: result.apply } : {}) };
      },
      render(host, view) {
        const d = view.data as CraftData;
        const name = (id: string) => view.content.database.items.find(i => i.id === id)?.name ?? id;
        host.innerHTML = "";
        backdrop(host, "#25222f, #0e0c14");
        const box = h("div", "position:absolute;inset:5% 7%;padding:1em 1.2em;display:flex;flex-direction:column;gap:.5em;overflow:auto", undefined, "rpg-window");
        const head = h("div", "display:flex;justify-content:space-between;align-items:baseline;color:var(--rpg-accent)");
        head.append(h("span", "font-size:1.1em", d.args.title), h("span", "", `${label(view.content, d.args)} ${money(view.state, d.args)}`));
        box.append(head, h("div", "color:var(--rpg-dim);font-size:.9em", d.message));
        d.args.recipes.forEach((r, i) => {
          const missing = missingFor(view.content, view.state, d.args, i);
          const b = button(`${name(r.item)}${r.count > 1 ? `×${r.count}` : ""}`, () => view.send({ type: "custom", value: { recipe: i } }), i === d.cursor, missing.length > 0);
          const needs = r.needs.map(n => `${name(n.item)} ${view.state.items[n.item] ?? 0}/${n.count}`).join("・");
          b.append(h("span", "", `${needs}${r.cost ? `・${label(view.content, d.args)}${r.cost}` : ""}`, "rpg-option-hint"));
          box.appendChild(b);
        });
        box.appendChild(button("やめる", () => view.send({ type: "custom", value: { leave: true } })));
        host.appendChild(box);
      },
    },
    storage: {
      title: "倉庫（預ける・引き出す。セーブに残る）",
      checkArgs: args => { const r = StorageArgsSchema.safeParse(args); return r.success ? [] : issues(r); },
      start(_ctx, raw) { const args = StorageArgsSchema.parse(raw); return { args, mode: "put", cursor: 0, message: "何を預けますか？" } satisfies StorageData; },
      input(ctx, raw, input) {
        const d = raw as StorageData;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if (input.type === "cancel" || value.leave) return { close: true };
        if (value.mode === "put" || value.mode === "take" || input.type === "left" || input.type === "right") {
          const mode = value.mode === "put" || value.mode === "take" ? value.mode : d.mode === "put" ? "take" : "put";
          return { data: { ...d, mode, cursor: 0, message: mode === "put" ? "何を預けますか？" : "何を引き出しますか？" } };
        }
        const contents = boxOf(ctx.state, d.args.box);
        const list = d.mode === "put"
          ? Object.entries(ctx.state.items).filter(([id, n]) => n > 0 && !ctx.content.database.items.find(i => i.id === id)?.key).map(([id]) => id)
          : Object.keys(contents);
        if (input.type === "up" || input.type === "down") return list.length ? { data: { ...d, cursor: (d.cursor + (input.type === "up" ? -1 : 1) + list.length) % list.length } } : {};
        const item = typeof value.item === "string" ? value.item : input.type === "confirm" ? list[Math.min(d.cursor, list.length - 1)] : undefined;
        if (!item || !list.includes(item)) return {};
        const name = ctx.content.database.items.find(i => i.id === item)?.name ?? item;
        if (d.mode === "put") {
          if (d.args.capacity && !contents[item] && Object.keys(contents).length >= d.args.capacity) return { data: { ...d, message: `いっぱいです（${d.args.capacity}種類まで）。` } };
          const def = ctx.content.database.items.find(i => i.id === item);
          const worn = def?.slot && ctx.state.equipment?.[def.slot] === item && (ctx.state.items[item] ?? 0) <= 1;
          let state: GameState = withBox(ctx.state, d.args.box, { ...contents, [item]: (contents[item] ?? 0) + 1 });
          state = { ...state, items: { ...state.items, [item]: (state.items[item] ?? 0) - 1 } };
          return { state, data: { ...d, message: `${name}を預けた。` }, ...(worn ? { apply: [{ type: "unequip", slot: def.slot! } as Effect] } : {}) };
        }
        const state = withBox(ctx.state, d.args.box, { ...contents, [item]: (contents[item] ?? 0) - 1 });
        return { state, data: { ...d, message: `${name}を引き出した。` }, apply: [{ type: "giveItem", item }] };
      },
      render(host, view) {
        const d = view.data as StorageData;
        const name = (id: string) => view.content.database.items.find(i => i.id === id)?.name ?? id;
        host.innerHTML = "";
        backdrop(host, "#20262a, #0b0e10");
        const box = h("div", "position:absolute;inset:5% 7%;padding:1em 1.2em;display:flex;flex-direction:column;gap:.5em;overflow:auto", undefined, "rpg-window");
        box.append(h("div", "color:var(--rpg-accent);font-size:1.1em", d.args.title), h("div", "color:var(--rpg-dim);font-size:.9em", d.message));
        const tabs = h("div", "display:flex;gap:.4em");
        tabs.append(button("預ける", () => view.send({ type: "custom", value: { mode: "put" } }), d.mode === "put"), button("引き出す", () => view.send({ type: "custom", value: { mode: "take" } }), d.mode === "take"));
        box.appendChild(tabs);
        const contents = boxOf(view.state, d.args.box);
        const rows = d.mode === "put"
          ? Object.entries(view.state.items).filter(([id, n]) => n > 0 && !view.content.database.items.find(i => i.id === id)?.key)
          : Object.entries(contents);
        if (!rows.length) box.appendChild(h("div", "color:var(--rpg-dim)", d.mode === "put" ? "預けられる物を持っていない。" : "倉庫は空っぽ。"));
        rows.forEach(([id, n], i) => box.appendChild(button(`${name(id)}　×${n}`, () => view.send({ type: "custom", value: { item: id } }), i === d.cursor)));
        box.appendChild(button("閉じる", () => view.send({ type: "custom", value: { leave: true } })));
        host.appendChild(box);
      },
    },
    buy: {
      title: "お店（買う・売る。装備は今の装備と比べて表示）",
      checkArgs: (args, { content }) => { const r = ShopArgsSchema.safeParse(args); return r.success ? checkShop(r.data, content) : issues(r); },
      start(_ctx, raw) {
        const args = ShopArgsSchema.parse(raw);
        return { args, mode: "buy", cursor: 0, message: args.greeting } satisfies ShopData;
      },
      input(ctx, raw, input) {
        const d = raw as ShopData;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if (input.type === "cancel" || value.leave) return { close: true, effects: [{ type: "message", text: "またどうぞ！", speaker: d.args.title }] };
        if (value.mode === "buy" || value.mode === "sell" || input.type === "left" || input.type === "right") {
          const mode = value.mode === "buy" || value.mode === "sell" ? value.mode : d.mode === "buy" && d.args.sell ? "sell" : "buy";
          return { data: { ...d, mode, cursor: 0, message: mode === "sell" ? "何を売ってくれるんだい？" : d.args.greeting } };
        }
        const list = d.mode === "buy" ? d.args.items.map(x => x.item) : sellable(ctx, d.args).map(x => x.item);
        if (input.type === "up" || input.type === "down") return list.length ? { data: { ...d, cursor: (d.cursor + (input.type === "up" ? -1 : 1) + list.length) % list.length } } : {};
        const target = typeof value.item === "string" ? value.item : input.type === "confirm" ? list[Math.min(d.cursor, list.length - 1)] : undefined;
        if (!target) return {};
        const result = d.mode === "buy" ? buyItem(ctx, d, target) : sellItem(ctx, d, target);
        const cursor = Math.max(0, Math.min(result.data.cursor, (d.mode === "buy" ? list.length : list.length - (result.apply && (ctx.state.items[target] ?? 0) <= 1 ? 1 : 0)) - 1));
        return { data: { ...result.data, cursor }, ...(result.apply ? { apply: result.apply } : {}) };
      },
      render(host, view) {
        const d = view.data as ShopData;
        const ctx = { content: view.content, state: view.state };
        host.innerHTML = "";
        backdrop(host, "#2f2a1f, #120f0a");
        const box = h("div", "position:absolute;inset:5% 7%;padding:1em 1.2em;display:flex;flex-direction:column;gap:.5em;overflow:auto", undefined, "rpg-window");
        const head = h("div", "display:flex;justify-content:space-between;align-items:baseline;color:var(--rpg-accent)");
        head.append(h("span", "font-size:1.1em", d.args.title), h("span", "", `${label(view.content, d.args)} ${money(view.state, d.args)}`));
        box.append(head, h("div", "color:var(--rpg-dim);font-size:.9em", d.message));
        if (d.args.sell) {
          const tabs = h("div", "display:flex;gap:.4em");
          tabs.append(button("買う", () => view.send({ type: "custom", value: { mode: "buy" } }), d.mode === "buy"), button("売る", () => view.send({ type: "custom", value: { mode: "sell" } }), d.mode === "sell"));
          box.appendChild(tabs);
        }
        const rows = d.mode === "buy"
          ? d.args.items.map(x => ({ item: x.item, price: priceOf(view.content, d.args, x.item) ?? 0, extra: `持っている ${view.state.items[x.item] ?? 0}` }))
          : sellable(ctx, d.args).map(x => ({ item: x.item, price: x.price, extra: `×${x.count}` }));
        if (!rows.length) box.appendChild(h("div", "color:var(--rpg-dim)", d.mode === "sell" ? "売れる物を持っていない。" : "品切れ。"));
        rows.forEach((row, i) => {
          const def = view.content.database.items.find(it => it.id === row.item);
          const b = button(`${def?.name ?? row.item}　${row.price}`, () => view.send({ type: "custom", value: { item: row.item } }), i === d.cursor, d.mode === "buy" && money(view.state, d.args) < row.price);
          const info = [compareEquipment(view.content, view.state, row.item), def?.description ?? "", row.extra].filter(Boolean).join("　");
          b.append(h("span", "", info, "rpg-option-hint"));
          box.appendChild(b);
        });
        box.appendChild(button("店を出る", () => view.send({ type: "custom", value: { leave: true } })));
        host.appendChild(box);
      },
    },
    inn: {
      title: "宿屋（お金を払って全員全回復）",
      checkArgs: (args, { content }) => { const r = InnArgsSchema.safeParse(args); if (!r.success) return issues(r); return content.project.variables[r.data.currency] ? [] : [`currency '${r.data.currency}' が project.json の variables にありません`]; },
      start(_ctx, raw) { const args = InnArgsSchema.parse(raw); return { args, cursor: 0 }; },
      input(ctx, raw, input) {
        const d = raw as { args: InnArgs; cursor: number };
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if (input.type === "up" || input.type === "down") return { data: { ...d, cursor: d.cursor === 0 ? 1 : 0 } };
        const stay = value.stay === true || (input.type === "confirm" && d.cursor === 0);
        if (input.type === "cancel" || value.stay === false || (input.type === "confirm" && d.cursor === 1)) return { close: true, effects: [{ type: "message", text: "またのお越しを。", speaker: d.args.title }] };
        if (!stay) return {};
        if (money(ctx.state, d.args) < d.args.price) return { close: true, effects: [{ type: "message", text: `${label(ctx.content, d.args)}が足りないようです（${d.args.price}）。`, speaker: d.args.title }] };
        return { close: true, effects: [{ type: "setVar", var: d.args.currency, value: d.args.price, op: "sub" }, { type: "heal", target: "all" }, { type: "message", text: d.args.message }] };
      },
      render(host, view) {
        const d = view.data as { args: InnArgs; cursor: number };
        host.innerHTML = "";
        const box = h("div", "position:absolute;left:8%;right:8%;bottom:6%;padding:1em 1.2em;display:flex;flex-direction:column;gap:.5em", undefined, "rpg-window");
        box.append(h("div", "color:var(--rpg-accent)", d.args.title), h("div", "", `${d.args.greeting}（${d.args.price}${label(view.content, d.args)}・いま ${money(view.state, d.args)}）`));
        box.append(button("泊まる", () => view.send({ type: "custom", value: { stay: true } }), d.cursor === 0), button("やめておく", () => view.send({ type: "custom", value: { stay: false } }), d.cursor === 1));
        host.appendChild(box);
      },
    },
  },
});

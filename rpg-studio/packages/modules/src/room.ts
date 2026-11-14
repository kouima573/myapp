/**
 * Genre module: point & click rooms (escape rooms, investigation scenes, hidden-object searches, haunted houses).
 * Rooms have a background (asset or colour) and hotspots placed in percent. Hotspots can need an RPG item,
 * run effects (flags, items, variables…), lead to another room, or open the way out.
 */
import { z } from "zod";
import { ConditionSchema, EffectSchema, IdSchema } from "../../schema/src/formats";
import type { Effect } from "../../schema/src/index";
import { defineSystem, evaluate, interpolate, type SystemContext } from "../../engine/src/index";
import { finish, issues, OutcomeArgs } from "./common";
import { asRecord, backdrop, button, h } from "./ui";

const HotspotSchema = z.object({
  id: IdSchema,
  label: z.string().min(1),
  x: z.number().min(0).max(100), y: z.number().min(0).max(100),
  w: z.number().min(1).max(100).default(12), h: z.number().min(1).max(100).default(12),
  /** Only present while this holds. */
  when: ConditionSchema.optional(),
  /** Hidden-object style: no outline until found (still clickable). */
  hidden: z.boolean().default(false),
  /** Shown when examined ({{var.x}} etc. allowed). */
  text: z.string().default(""),
  effects: z.array(EffectSchema).default([]),
  /** Needs this RPG item selected; `lockedText` otherwise. */
  needs: IdSchema.optional(),
  consume: z.boolean().default(false),
  lockedText: z.string().default("何かが必要なようだ。"),
  goto: IdSchema.optional(),
  /** Leaves the rooms: counts as success (onWin). */
  exit: z.boolean().default(false),
  /** Effects only the first time. */
  once: z.boolean().default(false),
}).strict();
const RoomSchema = z.object({ id: IdSchema, title: z.string().min(1), bg: IdSchema.optional(), color: z.string().default("#2a2622"), text: z.string().default(""), hotspots: z.array(HotspotSchema).default([]) }).strict();

export const RoomArgsSchema = z.object({
  title: z.string().default("部屋"),
  start: IdSchema.optional(),
  rooms: z.array(RoomSchema).min(1),
  /** Allow leaving without solving (counts as onLose). */
  canQuit: z.boolean().default(true),
  ...OutcomeArgs,
}).strict();
export type RoomArgs = z.infer<typeof RoomArgsSchema>;

export interface RoomData { args: RoomArgs; room: string; cursor: number; item?: string; message: string; used: string[]; found: string[]; visited: string[] }

export function checkRooms(args: RoomArgs): string[] {
  const ids = new Set(args.rooms.map(r => r.id));
  const out: string[] = [];
  if (args.start && !ids.has(args.start)) out.push(`start: 部屋 '${args.start}' がありません`);
  for (const r of args.rooms) for (const s of r.hotspots) if (s.goto && !ids.has(s.goto)) out.push(`rooms.${r.id}.${s.id}.goto: 部屋 '${s.goto}' がありません`);
  if (!args.rooms.some(r => r.hotspots.some(s => s.exit))) out.push("出口（exit: true の場所）が1つもありません");
  return out;
}

const roomOf = (d: RoomData) => d.args.rooms.find(r => r.id === d.room)!;
const visible = (ctx: SystemContext, d: RoomData) => roomOf(d).hotspots.filter(s => evaluate(s.when, ctx.state, { content: ctx.content }));

/** Click a hotspot. Exported for tests. Returns new data, effects to apply now, and whether the way out opened. */
export function useHotspot(ctx: SystemContext, d: RoomData, id: string): { data: RoomData; apply: Effect[]; exit: boolean } {
  const spot = visible(ctx, d).find(s => s.id === id);
  if (!spot) return { data: d, apply: [], exit: false };
  const key = `${d.room}/${spot.id}`;
  const found = d.found.includes(key) ? d.found : [...d.found, key];
  if (spot.needs && d.item !== spot.needs) return { data: { ...d, found, message: spot.lockedText }, apply: [], exit: false };
  const first = !d.used.includes(key);
  const apply: Effect[] = first || !spot.once ? [...spot.effects] : [];
  if (spot.needs && spot.consume && first) apply.push({ type: "takeItem", item: spot.needs });
  const text = spot.text ? interpolate(spot.text, ctx.state, { content: ctx.content }) : spot.label;
  let next: RoomData = { ...d, found, used: first ? [...d.used, key] : d.used, message: text, item: spot.needs && spot.consume ? undefined : d.item };
  if (spot.goto) next = { ...next, room: spot.goto, cursor: 0, visited: next.visited.includes(spot.goto) ? next.visited : [...next.visited, spot.goto], message: spot.text ? text : roomOf({ ...next, room: spot.goto }).text };
  return { data: next, apply, exit: spot.exit };
}

export default defineSystem({
  id: "room",
  scenes: {
    explore: {
      title: "ポイント＆クリック（脱出・探索・調査の部屋）",
      checkArgs: args => { const r = RoomArgsSchema.safeParse(args); return r.success ? checkRooms(r.data) : issues(r); },
      start(_ctx, raw) {
        const args = RoomArgsSchema.parse(raw);
        const room = args.start ?? args.rooms[0]!.id;
        return { args, room, cursor: 0, message: args.rooms.find(r => r.id === room)!.text, used: [], found: [], visited: [room] } satisfies RoomData;
      },
      input(ctx, raw, input) {
        const d = raw as RoomData;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if ((input.type === "cancel" || value.quit) && d.args.canQuit) return finish(ctx, d.args, "quit", "その場を後にした。");
        if (typeof value.item === "string" || value.item === null) return { data: { ...d, item: value.item === d.item ? undefined : (value.item as string) ?? undefined } };
        const spots = visible(ctx, d);
        if (input.type === "left" || input.type === "up") return { data: { ...d, cursor: (d.cursor - 1 + spots.length) % Math.max(1, spots.length) } };
        if (input.type === "right" || input.type === "down") return { data: { ...d, cursor: (d.cursor + 1) % Math.max(1, spots.length) } };
        const id = typeof value.spot === "string" ? value.spot : input.type === "confirm" ? spots[d.cursor]?.id : undefined;
        if (!id) return {};
        const used = useHotspot(ctx, d, id);
        if (used.exit) return { ...finish(ctx, d.args, "win", used.data.message || `${d.args.title}から抜け出した！`), apply: used.apply };
        return { data: used.data, apply: used.apply };
      },
      render(host, view) {
        const d = view.data as RoomData;
        const ctx = { content: view.content, state: view.state };
        const room = roomOf(d);
        host.innerHTML = "";
        backdrop(host);
        const stage = h("div", `position:absolute;left:2%;right:2%;top:2%;bottom:30%;border:2px solid var(--rpg-edge);border-radius:6px;overflow:hidden;background:${room.color} center/cover no-repeat;image-rendering:pixelated`);
        const url = room.bg ? view.assetUrl(room.bg) : undefined;
        if (url) stage.style.backgroundImage = `url("${url}")`;
        stage.appendChild(h("div", "position:absolute;left:.6em;top:.4em;color:var(--rpg-accent);text-shadow:0 1px 2px #000", `${d.args.title} — ${room.title}`));
        visible(ctx, d).forEach((s, i) => {
          const found = d.found.includes(`${d.room}/${s.id}`);
          const spot = h("button", `all:unset;position:absolute;cursor:pointer;left:${s.x}%;top:${s.y}%;width:${s.w}%;height:${s.h}%;border-radius:4px;display:grid;place-items:center;font-size:.75em;text-align:center;color:#fff;text-shadow:0 1px 2px #000;${s.hidden && !found ? "" : "background:rgba(0,0,0,.25);border:1px dashed rgba(233,220,184,.6);"}${i === d.cursor ? "outline:2px solid var(--rpg-accent);" : ""}`, s.hidden && !found ? "" : s.label);
          spot.onclick = event => { event.stopPropagation(); view.send({ type: "custom", value: { spot: s.id } }); };
          stage.appendChild(spot);
        });
        const bottom = h("div", "position:absolute;left:2%;right:2%;bottom:2%;height:26%;display:grid;grid-template-columns:1fr 15em;gap:2%");
        const msg = h("div", "padding:.6em .9em;white-space:pre-wrap;line-height:1.6;overflow:auto", d.message, "rpg-window");
        const inv = h("div", "padding:.5em .7em;display:flex;flex-wrap:wrap;gap:.3em;align-content:flex-start;overflow:auto;font-size:.8em", undefined, "rpg-window");
        inv.appendChild(h("div", "width:100%;color:var(--rpg-dim)", d.item ? `使う: ${view.content.database.items.find(i => i.id === d.item)?.name ?? d.item}` : "持ち物（選んでから調べる）"));
        for (const [id, count] of Object.entries(view.state.items)) {
          const item = view.content.database.items.find(i => i.id === id);
          inv.appendChild(button(`${item?.name ?? id}×${count}`, () => view.send({ type: "custom", value: { item: id } }), d.item === id));
        }
        if (d.args.canQuit) inv.appendChild(button("出る", () => view.send({ type: "custom", value: { quit: true } })));
        bottom.append(msg, inv);
        host.append(stage, bottom);
      },
    },
  },
});

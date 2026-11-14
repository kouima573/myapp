/**
 * Genre module: schedule simulation — raising (育成), management (経営), farming, training weeks.
 * Each turn the player picks one activity; its effects change RPG stats / variables / items right away.
 * { "type": "startScene", "system": "planner", "scene": "schedule", "args": { "title": "修行の一週間", "turns": 7, "activities": [ ... ], "onEnd": [ ... ] } }
 */
import { z } from "zod";
import { ConditionSchema, EffectSchema, IdSchema } from "../../schema/src/formats";
import { defineSystem, effectiveStats, evaluate, interpolate } from "../../engine/src/index";
import { asRecord, button, h } from "./ui";

export const PlannerArgsSchema = z.object({
  title: z.string().default("予定を立てよう"),
  turns: z.number().int().min(1).max(365),
  /** "{{turn}}" and "{{turns}}" are replaced. */
  turnLabel: z.string().default("{{turn}}日目 / {{turns}}日"),
  activities: z.array(z.object({
    id: IdSchema,
    label: z.string().min(1),
    description: z.string().default(""),
    when: ConditionSchema.optional(),
    effects: z.array(EffectSchema).default([]),
    /** Log line after choosing it ({{var.x}} etc. allowed). */
    text: z.string().default(""),
  }).strict()).min(1),
  /** Applied after every turn (e.g. daily upkeep, fatigue recovery). */
  onTurnEnd: z.array(EffectSchema).default([]),
  /** Run after the last turn (results, endings, flags). */
  onEnd: z.array(EffectSchema).default([]),
  /** Variables shown in the side panel (labels come from project.json). */
  show: z.array(IdSchema).default([]),
  showStats: z.boolean().default(true),
  cancelable: z.boolean().default(false),
}).strict();
type PlannerArgs = z.infer<typeof PlannerArgsSchema>;
/** `pending` is the last log line, interpolated on the next input so it sees the state after its effects. */
interface PlannerData { args: PlannerArgs; turn: number; choice: number; log: string[]; pending?: string }

export default defineSystem({
  id: "planner",
  scenes: {
    schedule: {
      title: "育成・経営シミュ（期間ごとに行動を選ぶ）",
      checkArgs: args => { const r = PlannerArgsSchema.safeParse(args); return r.success ? [] : r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`); },
      start(_ctx, raw) { return { args: PlannerArgsSchema.parse(raw), turn: 1, choice: 0, log: [] } satisfies PlannerData; },
      input(ctx, raw, input) {
        const opts = { content: ctx.content };
        const raw0 = raw as PlannerData;
        const data: PlannerData = raw0.pending === undefined ? raw0 : { ...raw0, pending: undefined, log: [...raw0.log, interpolate(raw0.pending, ctx.state, opts)].slice(-30) };
        const visible = data.args.activities.filter(a => evaluate(a.when, ctx.state, { content: ctx.content }));
        if (input.type === "cancel") return data.args.cancelable ? { close: true } : { data };
        if (input.type === "up" || input.type === "down") return { data: { ...data, choice: (data.choice + (input.type === "up" ? -1 : 1) + visible.length) % visible.length } };
        const pickedIndex = input.type === "custom" && typeof asRecord(input.value).pick === "number" ? (asRecord(input.value).pick as number) : input.type === "confirm" ? data.choice : -1;
        const activity = visible[pickedIndex];
        if (!activity) return { data };
        const template = `${label(data)}: ${activity.label}${activity.text ? ` — ${activity.text}` : ""}`;
        const line = interpolate(template, ctx.state, opts);
        const apply = [...activity.effects, ...data.args.onTurnEnd];
        if (data.turn >= data.args.turns) return { close: true, apply, effects: data.args.onEnd, log: [line] };
        return { data: { ...data, turn: data.turn + 1, choice: Math.min(data.choice, visible.length - 1), pending: template }, apply, log: [line] };
      },
      render(host, view) {
        const data = view.data as PlannerData;
        const { content, state } = view;
        host.innerHTML = "";
        const root = h("div", "position:absolute;inset:3%;display:grid;grid-template-columns:1.4fr 1fr;gap:2%");
        const left = h("div", "padding:.8em 1em;display:flex;flex-direction:column;gap:.3em;overflow:auto", undefined, "rpg-window");
        left.append(h("div", "color:var(--rpg-accent);letter-spacing:.06em", data.args.title), h("div", "font-size:.8em;color:var(--rpg-dim)", label(data)));
        const visible = data.args.activities.filter(a => evaluate(a.when, state, { content }));
        visible.forEach((a, i) => {
          const b = button(a.label, () => view.send({ type: "custom", value: { pick: i } }), i === data.choice);
          if (a.description) b.appendChild(h("span", "font-size:.75em;color:var(--rpg-dim);white-space:normal;text-align:right", a.description, "rpg-option-hint"));
          left.appendChild(b);
        });
        const right = h("div", "padding:.8em 1em;display:flex;flex-direction:column;gap:.3em;font-size:.85em;overflow:auto", undefined, "rpg-window");
        if (data.args.showStats) {
          const s = effectiveStats(state, content);
          right.appendChild(h("div", "", `${state.player.name ?? content.project.player.name}　HP ${state.player.hp}/${s.maxHp}　攻 ${s.attack}　防 ${s.defense}`));
        }
        for (const id of data.args.show) right.appendChild(h("div", "", `${content.project.variables[id]?.label ?? id}: ${state.vars[id] ?? content.project.variables[id]?.initial ?? 0}`));
        right.appendChild(h("div", "margin-top:.4em;color:var(--rpg-accent);font-size:.85em", "記録"));
        const lines = data.pending === undefined ? data.log : [...data.log, interpolate(data.pending, state, { content })];
        for (const line of lines.slice(-7)) right.appendChild(h("div", "color:var(--rpg-dim);font-size:.85em", line));
        root.append(left, right);
        host.appendChild(root);
      },
    },
  },
});

function label(data: PlannerData) {
  return data.args.turnLabel.replace(/\{\{turn\}\}/g, String(data.turn)).replace(/\{\{turns\}\}/g, String(data.args.turns));
}

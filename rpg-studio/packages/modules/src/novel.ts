/**
 * Genre module: visual novel. Full-screen story scenes with backgrounds, portraits, branching, labels/jumps,
 * conditional lines, effects applied as the story goes, and a backlog. Opened from data:
 * { "type": "startScene", "system": "novel", "scene": "play", "args": { "bg": "bg-forest", "script": [ ... ], "onEnd": [ ... ] } }
 */
import { z } from "zod";
import { ConditionSchema, EffectSchema, IdSchema, type Effect } from "../../schema/src/formats";
import { defineSystem, evaluate, interpolate, type SystemContext } from "../../engine/src/index";
import { asRecord, button, h } from "./ui";

const ChoiceSchema = z.object({ label: z.string().min(1), when: ConditionSchema.optional(), effects: z.array(EffectSchema).default([]), jump: z.string().optional() }).strict();
const LineSchema = z.object({
  label: z.string().optional(),
  speaker: z.string().optional(),
  text: z.string().default(""),
  /** Portrait / character asset; "none" hides it. */
  portrait: z.string().optional(),
  pos: z.enum(["left", "center", "right"]).default("center"),
  bg: z.string().optional(),
  when: ConditionSchema.optional(),
  /** Applied when the line is shown (stats, flags, sets…). */
  effects: z.array(EffectSchema).default([]),
  choices: z.array(ChoiceSchema).default([]),
  jump: z.string().optional(),
  end: z.boolean().default(false),
}).strict();
export const NovelArgsSchema = z.object({
  bg: IdSchema.optional(),
  script: z.array(LineSchema).min(1),
  onEnd: z.array(EffectSchema).default([]),
  /** Allow skipping with cancel (default true). */
  skippable: z.boolean().default(true),
}).strict();
type NovelArgs = z.infer<typeof NovelArgsSchema>;

interface NovelData { args: NovelArgs; i: number; choice: number; bg?: string; portrait?: string; pos: string; log: string[]; backlog: boolean; pendingApply: Effect[] }

export default defineSystem({
  id: "novel",
  scenes: {
    play: {
      title: "ノベル（立ち絵・背景・選択肢・バックログ）",
      checkArgs: args => { const r = NovelArgsSchema.safeParse(args); return r.success ? labelErrors(r.data) : r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`); },
      start(ctx, raw) {
        const args = NovelArgsSchema.parse(raw);
        const data: NovelData = { args, i: -1, choice: 0, bg: args.bg, pos: "center", log: [], backlog: false, pendingApply: [] };
        return advance(ctx, data, 0);
      },
      input(ctx, raw, input) {
        let data = raw as NovelData;
        const apply = () => { const fx = data.pendingApply; data = { ...data, pendingApply: [] }; return fx; };
        const line = data.args.script[data.i];
        if (input.type === "cancel") {
          if (data.args.skippable && !data.backlog) return { close: true, apply: apply(), effects: data.args.onEnd };
          return { data: { ...data, backlog: !data.backlog } };
        }
        if (input.type === "custom" && asRecord(input.value).backlog) return { data: { ...data, backlog: !data.backlog } };
        if (data.backlog) return input.type === "confirm" ? { data: { ...data, backlog: false } } : {};
        const choices = (line?.choices ?? []).filter(c => evaluate(c.when, ctx.state, { content: ctx.content }));
        if (choices.length) {
          if (input.type === "up" || input.type === "down") return { data: { ...data, choice: (data.choice + (input.type === "up" ? -1 : 1) + choices.length) % choices.length } };
          const picked = input.type === "custom" && typeof asRecord(input.value).choice === "number" ? choices[asRecord(input.value).choice as number] : input.type === "confirm" ? choices[data.choice] : undefined;
          if (!picked) return {};
          const next = { ...data, log: [...data.log, `▶ ${picked.label}`], pendingApply: [...data.pendingApply, ...picked.effects] };
          const target = picked.jump ? indexOf(next.args, picked.jump) : data.i + 1;
          return finishOrAdvance(ctx, next, target, apply);
        }
        if (input.type !== "confirm") return {};
        if (line?.end) return { close: true, apply: data.pendingApply, effects: data.args.onEnd };
        return finishOrAdvance(ctx, data, line?.jump ? indexOf(data.args, line.jump) : data.i + 1, apply);
      },
      render(host, view) {
        const data = view.data as NovelData;
        const line = data.args.script[data.i];
        host.innerHTML = "";
        const stage = h("div", "position:absolute;inset:0;background:#0b0d0c center/cover no-repeat;image-rendering:pixelated");
        const bgUrl = data.bg ? view.assetUrl(data.bg) : undefined;
        if (bgUrl) stage.style.backgroundImage = `linear-gradient(rgba(0,0,0,.1),rgba(0,0,0,.35)), url("${bgUrl}")`;
        else stage.style.background = "radial-gradient(ellipse at 50% 30%, #2d3a2c, #0b0d0c 75%)";
        host.appendChild(stage);
        const portraitUrl = data.portrait && data.portrait !== "none" ? view.assetUrl(data.portrait) : undefined;
        if (portraitUrl) {
          const asset = view.content.assets.assets.find(a => a.id === data.portrait);
          const isSheet = (asset?.kind === "character") && (asset.rows ?? 1) > 1;
          const left = data.pos === "left" ? "18%" : data.pos === "right" ? "82%" : "50%";
          const box = h("div", `position:absolute;bottom:30%;left:${left};transform:translateX(-50%);width:34%;aspect-ratio:${isSheet ? "1" : "3/4"};background:url("${portraitUrl}") no-repeat;image-rendering:pixelated;background-size:${isSheet ? `${(asset!.columns ?? 1) * 100}% ${(asset!.rows ?? 1) * 100}%` : "contain"};background-position:${isSheet ? "0 0" : "center bottom"}`);
          host.appendChild(box);
        }
        const text = line ? interpolate(line.text, view.state, { content: view.content }) : "";
        const box = h("div", "position:absolute;left:3%;right:3%;bottom:4%;min-height:26%;padding:.8em 1em;line-height:1.7;cursor:pointer", undefined, "rpg-window");
        if (line?.speaker) box.appendChild(h("div", "color:var(--rpg-accent);font-size:.85em;letter-spacing:.08em", line.speaker));
        box.appendChild(h("div", "white-space:pre-wrap", text));
        const choices = (line?.choices ?? []).filter(c => evaluate(c.when, view.state, { content: view.content }));
        if (choices.length) {
          const list = h("div", "display:flex;flex-direction:column;gap:.15em;margin-top:.4em");
          choices.forEach((c, i) => list.appendChild(button(c.label, () => view.send({ type: "custom", value: { choice: i } }), i === data.choice)));
          box.appendChild(list);
        } else {
          box.onclick = () => view.send({ type: "confirm" });
          box.appendChild(h("span", "position:absolute;right:1em;bottom:.5em;font-size:.75em;color:var(--rpg-accent)", "▼"));
        }
        host.appendChild(box);
        const tools = h("div", "position:absolute;right:3%;top:3%;display:flex;gap:.4em");
        tools.appendChild(button(data.backlog ? "閉じる" : "ログ", () => view.send({ type: "custom", value: { backlog: true } })));
        if (data.args.skippable) tools.appendChild(button("スキップ", () => view.send({ type: "cancel" })));
        host.appendChild(tools);
        if (data.backlog) {
          const log = h("div", "position:absolute;inset:8% 6% 34% 6%;overflow:auto;padding:.8em 1em;font-size:.85em;line-height:1.7;white-space:pre-wrap", undefined, "rpg-window");
          log.textContent = data.log.join("\n") || "（まだ何もない）";
          host.appendChild(log);
          log.scrollTop = log.scrollHeight;
        }
      },
    },
  },
});

function indexOf(args: NovelArgs, label: string): number {
  const i = args.script.findIndex(l => l.label === label);
  return i < 0 ? args.script.length : i;
}

function labelErrors(args: NovelArgs): string[] {
  const labels = new Set(args.script.map(l => l.label).filter(Boolean));
  const out: string[] = [];
  args.script.forEach((l, i) => {
    if (l.jump && !labels.has(l.jump)) out.push(`script[${i}].jump: ラベル '${l.jump}' がありません`);
    l.choices.forEach((c, j) => { if (c.jump && !labels.has(c.jump)) out.push(`script[${i}].choices[${j}].jump: ラベル '${c.jump}' がありません`); });
  });
  return out;
}

/** Moves to the next visible line (skipping lines whose `when` fails), collecting its effects and visuals. */
function advance(ctx: SystemContext, data: NovelData, from: number): NovelData {
  let i = from;
  const script = data.args.script;
  while (i < script.length && !evaluate(script[i]!.when, ctx.state, { content: ctx.content })) i++;
  const line = script[i];
  if (!line) return { ...data, i };
  const text = interpolate(line.text, ctx.state, { content: ctx.content });
  return {
    ...data, i, choice: 0,
    bg: line.bg ?? data.bg,
    portrait: line.portrait ?? data.portrait,
    pos: line.portrait ? line.pos : data.pos,
    log: text ? [...data.log, line.speaker ? `${line.speaker}「${text}」` : text] : data.log,
    pendingApply: [...data.pendingApply, ...line.effects],
  };
}

function finishOrAdvance(ctx: Parameters<typeof advance>[0], data: NovelData, target: number, apply: () => Effect[]) {
  const next = advance(ctx, data, target);
  if (next.i >= next.args.script.length) return { close: true, apply: [...next.pendingApply], effects: next.args.onEnd };
  const fx = next.pendingApply;
  void apply;
  return { data: { ...next, pendingApply: [] }, apply: fx };
}

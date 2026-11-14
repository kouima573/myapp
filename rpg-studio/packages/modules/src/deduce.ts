/**
 * Genre module: deduction (mystery, courtroom-style debate, interrogation, "who is lying").
 * Evidence comes from the RPG (show it only once a clue set / flag / item is collected), so exploring the world IS
 * the investigation. Present evidence against the statement it contradicts, then name the answer.
 */
import { z } from "zod";
import { ConditionSchema, IdSchema } from "../../schema/src/formats";
import { defineSystem, evaluate, interpolate, type SystemContext } from "../../engine/src/index";
import { finish, issues, OutcomeArgs } from "./common";
import { asRecord, backdrop, button, h } from "./ui";

export const DeduceArgsSchema = z.object({
  title: z.string().default("推理"),
  intro: z.string().default(""),
  evidence: z.array(z.object({ id: IdSchema, label: z.string().min(1), text: z.string().default(""), when: ConditionSchema.optional() }).strict()).min(1),
  statements: z.array(z.object({
    speaker: z.string().default(""),
    text: z.string().min(1),
    /** The evidence that breaks this statement (statements without it are true). */
    contradiction: IdSchema.optional(),
    /** Reply when the player asks about it. */
    press: z.string().default(""),
    /** Line after it is broken. */
    broken: z.string().default("……！"),
  }).strict()).default([]),
  /** Final question after every contradiction is found (optional). */
  question: z.object({ prompt: z.string().min(1), options: z.array(z.object({ id: IdSchema, label: z.string().min(1) }).strict()).min(2), answer: IdSchema }).strict().optional(),
  /** Wrong answers allowed. */
  lives: z.number().int().min(1).max(10).default(3),
  ...OutcomeArgs,
}).strict();
export type DeduceArgs = z.infer<typeof DeduceArgsSchema>;

export interface DeduceData { args: DeduceArgs; phase: "statements" | "question"; cursor: number; evidence: number; broken: number[]; lives: number; message: string; speaker: string }

export function checkDeduce(args: DeduceArgs): string[] {
  const ids = new Set(args.evidence.map(e => e.id));
  const out: string[] = [];
  args.statements.forEach((s, i) => { if (s.contradiction && !ids.has(s.contradiction)) out.push(`statements[${i}].contradiction: 証拠 '${s.contradiction}' がありません`); });
  if (args.question && !args.question.options.some(o => o.id === args.question!.answer)) out.push(`question.answer: 選択肢に '${args.question.answer}' がありません`);
  if (!args.statements.some(s => s.contradiction) && !args.question) out.push("矛盾（contradiction）のある証言か、question のどちらかが必要です");
  return out;
}

const shown = (ctx: SystemContext, d: DeduceData) => d.args.evidence.filter(e => evaluate(e.when, ctx.state, { content: ctx.content }));
const remaining = (d: DeduceData) => d.args.statements.map((s, i) => (s.contradiction && !d.broken.includes(i) ? i : -1)).filter(i => i >= 0);

/** Present evidence against a statement, or answer the question. Exported for tests. */
export function deduceAct(ctx: SystemContext, d: DeduceData, act: { present?: string; press?: boolean; answer?: string }): DeduceData {
  const text = (s: string) => interpolate(s, ctx.state, { content: ctx.content });
  if (d.phase === "question" && act.answer) {
    if (act.answer === d.args.question!.answer) return { ...d, message: "solved" };
    return { ...d, lives: d.lives - 1, message: "……違う。もう一度考えよう。", speaker: "" };
  }
  const st = d.args.statements[d.cursor];
  if (!st) return d;
  if (act.press) return { ...d, message: text(st.press || "……それ以上は答えてくれない。"), speaker: st.speaker };
  if (act.present) {
    if (!shown(ctx, d).some(e => e.id === act.present)) return d;
    if (st.contradiction === act.present && !d.broken.includes(d.cursor)) {
      const next = { ...d, broken: [...d.broken, d.cursor], message: text(st.broken), speaker: st.speaker };
      if (remaining(next).length) return next;
      return d.args.question ? { ...next, phase: "question", cursor: 0 } : { ...next, message: "solved" };
    }
    return { ...d, lives: d.lives - 1, message: "その証拠では崩せない……", speaker: "" };
  }
  return d;
}

export default defineSystem({
  id: "deduce",
  scenes: {
    case: {
      title: "推理（証言と証拠の矛盾を突き、答えを導く）",
      checkArgs: args => { const r = DeduceArgsSchema.safeParse(args); return r.success ? checkDeduce(r.data) : issues(r); },
      start(ctx, raw) {
        const args = DeduceArgsSchema.parse(raw);
        const d: DeduceData = { args, phase: args.statements.some(s => s.contradiction) ? "statements" : "question", cursor: 0, evidence: 0, broken: [], lives: args.lives, message: interpolate(args.intro, ctx.state, { content: ctx.content }), speaker: "" };
        return d;
      },
      input(ctx, raw, input) {
        const d = raw as DeduceData;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if (input.type === "cancel" || value.quit) return finish(ctx, d.args, "quit", "推理を中断した。");
        const ev = shown(ctx, d);
        const count = d.phase === "question" ? d.args.question!.options.length : d.args.statements.length;
        if (input.type === "up" || input.type === "down") return { data: { ...d, cursor: (d.cursor + (input.type === "up" ? -1 : 1) + count) % count } };
        if (input.type === "left" || input.type === "right") return { data: { ...d, evidence: (d.evidence + (input.type === "left" ? -1 : 1) + Math.max(1, ev.length)) % Math.max(1, ev.length) } };
        let next = d;
        if (typeof value.cursor === "number") next = { ...d, cursor: value.cursor };
        if (typeof value.evidence === "number") return { data: { ...next, evidence: value.evidence } };
        if (d.phase === "question" && (input.type === "confirm" || typeof value.answer === "string")) next = deduceAct(ctx, next, { answer: typeof value.answer === "string" ? value.answer : d.args.question!.options[next.cursor]!.id });
        else if (value.press) next = deduceAct(ctx, next, { press: true });
        else if (input.type === "confirm" || value.present) next = deduceAct(ctx, next, { present: ev[next.evidence]?.id });
        else if (typeof value.cursor !== "number") return {};
        if (next.message === "solved") return finish(ctx, d.args, "win", `真相にたどり着いた！（${d.args.title}）`);
        if (next.lives <= 0) return finish(ctx, d.args, "lose", "推理は行き詰まった……");
        return { data: next };
      },
      render(host, view) {
        const d = view.data as DeduceData;
        const ctx = { content: view.content, state: view.state };
        host.innerHTML = "";
        backdrop(host);
        const root = h("div", "position:absolute;inset:2.5%;display:grid;grid-template-rows:auto 1fr auto;gap:2%");
        root.appendChild(h("div", "display:flex;justify-content:space-between;color:var(--rpg-accent)", undefined)).append(h("span", "", d.args.title), h("span", "", "◆".repeat(d.lives) + "◇".repeat(Math.max(0, d.args.lives - d.lives))));
        const main = h("div", "padding:.7em 1em;display:flex;flex-direction:column;gap:.3em;overflow:auto", undefined, "rpg-window");
        if (d.phase === "statements") d.args.statements.forEach((s, i) => {
          const b = button(`${s.speaker ? `${s.speaker}「` : ""}${interpolate(s.text, view.state, { content: view.content })}${s.speaker ? "」" : ""}${d.broken.includes(i) ? "　✕崩した" : ""}`, () => view.send({ type: "custom", value: { cursor: i } }), i === d.cursor);
          main.appendChild(b);
        });
        else {
          main.appendChild(h("div", "", d.args.question!.prompt));
          d.args.question!.options.forEach((o, i) => main.appendChild(button(o.label, () => view.send({ type: "custom", value: { answer: o.id } }), i === d.cursor)));
        }
        const bottom = h("div", "display:grid;grid-template-columns:1fr 1fr;gap:2%");
        const msg = h("div", "padding:.6em .9em;min-height:5em;white-space:pre-wrap;line-height:1.6", undefined, "rpg-window");
        if (d.speaker) msg.appendChild(h("div", "color:var(--rpg-accent);font-size:.85em", d.speaker));
        msg.appendChild(h("div", "", d.message));
        const ev = h("div", "padding:.5em .7em;display:flex;flex-direction:column;gap:.2em;font-size:.82em;overflow:auto;max-height:12em", undefined, "rpg-window");
        ev.appendChild(h("div", "color:var(--rpg-dim)", "証拠（←→で選ぶ）"));
        shown(ctx, d).forEach((e, i) => { const b = button(e.label, () => view.send({ type: "custom", value: { evidence: i } }), i === d.evidence); if (e.text) b.title = e.text; ev.appendChild(b); });
        if (d.phase === "statements") {
          const tools = h("div", "display:flex;gap:.4em;margin-top:.3em");
          tools.append(button("つきつける（決定）", () => view.send({ type: "custom", value: { present: true } })), button("問いただす", () => view.send({ type: "custom", value: { press: true } })));
          ev.appendChild(tools);
        }
        bottom.append(msg, ev);
        root.append(main, bottom);
        host.appendChild(root);
      },
    },
  },
});

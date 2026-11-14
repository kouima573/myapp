/**
 * Genre module: quiz / riddle / word game / typing. Questions with choices or typed answers.
 * Field: a sphinx's riddle, an exam, a password door, a trivia contest (pass with `pass` correct answers).
 * Battle mode: every correct answer strikes the enemy, every wrong one lets it strike back (questions cycle).
 */
import { z } from "zod";
import { EffectSchema } from "../../schema/src/formats";
import type { Effect } from "../../schema/src/index";
import { defineSystem, interpolate, type SystemContext } from "../../engine/src/index";
import { enemyOf, finish, heroOf, inBattle, issues, OutcomeArgs } from "./common";
import { asRecord, backdrop, bar, button, h } from "./ui";

export const QuizArgsSchema = z.object({
  title: z.string().default("問答"),
  questions: z.array(z.object({
    q: z.string().min(1),
    /** Multiple choice. Omit for a typed answer. */
    choices: z.array(z.string().min(1)).max(8).optional(),
    /** Index of the right choice, or accepted typed answers (case, width and kana-insensitive). */
    answer: z.union([z.number().int().min(0), z.array(z.string().min(1)).min(1)]),
    explain: z.string().default(""),
    /** Effects when answered correctly (applied right away). */
    onCorrect: z.array(EffectSchema).default([]),
  }).strict()).min(1),
  /** Field: correct answers needed (default: all). */
  pass: z.number().int().min(1).optional(),
  hpScale: z.number().min(0.1).max(50).default(1),
  ...OutcomeArgs,
}).strict();
export type QuizArgs = z.infer<typeof QuizArgsSchema>;

export interface QuizData { args: QuizArgs; index: number; asked: number; correct: number; choice: number; message: string; hp: number; maxHp: number; attack: number; defense: number; enemyHp: number; enemyMaxHp: number; battle: boolean }

/** Normalise typed answers: NFKC, lower case, katakana → hiragana, no spaces. */
export function normalizeAnswer(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function checkQuiz(args: QuizArgs): string[] {
  return args.questions.flatMap((q, i) => {
    if (typeof q.answer === "number") return q.choices && q.answer < q.choices.length ? [] : [`questions[${i}].answer: choices の番号（0から）にしてください`];
    return q.choices ? [`questions[${i}]: choices があるときは answer を番号にしてください`] : [];
  }).concat(args.pass && args.pass > args.questions.length ? [`pass(${args.pass}) が問題数(${args.questions.length})より多いです`] : []);
}

export function answerQuiz(ctx: SystemContext, d: QuizData, given: number | string): { data: QuizData; apply: Effect[] } {
  const q = d.args.questions[d.index]!;
  const right = typeof q.answer === "number" ? given === q.answer : typeof given === "string" && q.answer.some(a => normalizeAnswer(a) === normalizeAnswer(given));
  const enemy = enemyOf(ctx, d.args.enemyId);
  let next: QuizData = { ...d, asked: d.asked + 1, correct: d.correct + (right ? 1 : 0), index: (d.index + 1) % d.args.questions.length, choice: 0 };
  const explain = q.explain ? `　${interpolate(q.explain, ctx.state, { content: ctx.content })}` : "";
  if (right) {
    const dmg = Math.max(1, d.attack);
    next = { ...next, enemyHp: d.battle ? Math.max(0, d.enemyHp - dmg) : 0, message: `正解！${d.battle ? ` ${dmg}ダメージ` : ""}${explain}` };
  } else {
    const dmg = d.battle ? Math.max(1, (enemy?.stats.attack ?? 4) - d.defense) : 0;
    const shown = typeof q.answer === "number" ? q.choices![q.answer] : q.answer[0];
    next = { ...next, hp: Math.max(0, d.hp - dmg), message: `不正解……（答え: ${shown}）${dmg ? ` ${dmg}ダメージ` : ""}${explain}` };
  }
  return { data: next, apply: right ? q.onCorrect : [] };
}

export function quizStatus(d: QuizData): "playing" | "win" | "lose" {
  if (d.battle) return d.enemyHp <= 0 ? "win" : d.hp <= 0 ? "lose" : "playing";
  const need = d.args.pass ?? d.args.questions.length;
  if (d.correct >= need) return "win";
  if (d.asked - d.correct > d.args.questions.length - need || d.asked >= d.args.questions.length) return "lose";
  return "playing";
}

export default defineSystem({
  id: "quiz",
  scenes: {
    ask: {
      title: "クイズ・なぞなぞ・言葉当て（選択式・入力式）",
      checkArgs: args => { const r = QuizArgsSchema.safeParse(args); return r.success ? checkQuiz(r.data) : issues(r); },
      start(ctx, raw) {
        const args = QuizArgsSchema.parse(raw);
        const hero = heroOf(ctx);
        const enemy = enemyOf(ctx, args.enemyId);
        const enemyMaxHp = enemy ? Math.max(1, Math.round(enemy.stats.maxHp * args.hpScale)) : 0;
        return { args, index: 0, asked: 0, correct: 0, choice: 0, message: "", hp: hero.hp, maxHp: hero.maxHp, attack: hero.attack, defense: hero.defense, enemyHp: enemyMaxHp, enemyMaxHp, battle: inBattle(ctx) } satisfies QuizData;
      },
      input(ctx, raw, input) {
        const d = raw as QuizData;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if (input.type === "cancel" || value.quit) return finish(ctx, d.args, "quit", "問答から降りた。", d.hp);
        const q = d.args.questions[d.index]!;
        const n = q.choices?.length ?? 0;
        if (n && (input.type === "up" || input.type === "down")) return { data: { ...d, choice: (d.choice + (input.type === "up" ? -1 : 1) + n) % n } };
        let given: number | string | undefined;
        if (typeof value.answer === "string" || typeof value.answer === "number") given = value.answer;
        else if (input.type === "confirm" && n) given = d.choice;
        if (given === undefined) return {};
        const { data, apply } = answerQuiz(ctx, d, given);
        const status = quizStatus(data);
        if (status !== "playing") return { ...finish(ctx, d.args, status, status === "win" ? `${d.args.title}：${data.correct}問正解！` : data.hp <= 0 ? "答えに詰まり、力尽きた……" : `${d.args.title}：${data.correct}/${d.args.pass ?? d.args.questions.length}問……足りなかった`, data.hp), apply };
        return { data, apply };
      },
      render(host, view) {
        const d = view.data as QuizData;
        const q = d.args.questions[d.index]!;
        host.innerHTML = "";
        backdrop(host);
        const box = h("div", "position:absolute;inset:6% 8%;padding:1em 1.2em;display:flex;flex-direction:column;gap:.6em", undefined, "rpg-window");
        box.appendChild(h("div", "color:var(--rpg-accent);display:flex;justify-content:space-between", undefined)).append(h("span", "", d.args.title), h("span", "", d.battle ? "" : `正解 ${d.correct}/${d.args.pass ?? d.args.questions.length}`));
        if (d.battle) {
          const enemy = enemyOf({ content: view.content, state: view.state }, d.args.enemyId);
          box.append(h("div", "font-size:.85em", `${enemy?.name ?? "敵"} ${d.enemyHp}/${d.enemyMaxHp}　あなた HP ${d.hp}/${d.maxHp}`), bar(d.enemyHp, d.enemyMaxHp, "#d9745b"));
        }
        if (d.message) box.appendChild(h("div", "font-size:.85em;color:var(--rpg-dim)", d.message));
        box.appendChild(h("div", "font-size:1.1em;line-height:1.6;white-space:pre-wrap", interpolate(q.q, view.state, { content: view.content })));
        if (q.choices) q.choices.forEach((c, i) => box.appendChild(button(c, () => view.send({ type: "custom", value: { answer: i } }), i === d.choice)));
        else {
          const row = h("form", "display:flex;gap:.5em");
          const field = h("input", "flex:1;font:inherit;padding:.4em .6em;background:#0e1218;color:var(--rpg-ink);border:2px solid var(--rpg-edge);border-radius:6px");
          field.placeholder = "答えを入力"; field.autocomplete = "off";
          field.addEventListener("keydown", e => e.stopPropagation());
          row.onsubmit = e => { e.preventDefault(); if (field.value.trim()) view.send({ type: "custom", value: { answer: field.value } }); };
          row.append(field, button("答える", () => row.requestSubmit()));
          box.appendChild(row);
          setTimeout(() => field.focus(), 0);
        }
        box.appendChild(button("やめる", () => view.send({ type: "custom", value: { quit: true } })));
        host.appendChild(box);
      },
    },
  },
});

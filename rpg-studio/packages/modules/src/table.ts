/**
 * Genre module: hand-ranking card game with stakes and bluffing (table games, gambling dens, bluff duels).
 * Each round: swap some of your 5 cards once, read the opponent's face (it may be a bluff), then fold, call or raise.
 * Hands: high card < pair < two pair < three < straight < flush < full house < four < straight flush.
 * Chips are game-world only (they can come from / go back to an RPG variable). No real money is involved.
 */
import { z } from "zod";
import { IdSchema } from "../../schema/src/formats";
import type { Effect } from "../../schema/src/index";
import { defineSystem, type SystemContext } from "../../engine/src/index";
import { enemyOf, finish, heroOf, inBattle, issues, OutcomeArgs } from "./common";
import { asRecord, backdrop, button, h, nextRand } from "./ui";

export const TableArgsSchema = z.object({
  title: z.string().default("札勝負"),
  rounds: z.number().int().min(1).max(50).default(5),
  chips: z.number().int().min(1).max(99999).default(20),
  ante: z.number().int().min(1).max(9999).default(2),
  /** Stake an RPG variable: chips start from it and the result is written back. */
  stakeVar: IdSchema.optional(),
  suits: z.array(z.string().min(1).max(2)).length(4).default(["剣", "杯", "星", "月"]),
  opponent: z.object({ name: z.string().default("賭場の主"), boldness: z.number().min(0).max(1).default(0.5), bluff: z.number().min(0).max(1).default(0.3) }).strict().default({ name: "賭場の主", boldness: 0.5, bluff: 0.3 }),
  ...OutcomeArgs,
}).strict();
export type TableArgs = z.infer<typeof TableArgsSchema>;

export type Card = [rank: number, suit: number];
export interface TableData {
  args: TableArgs; seed: number; round: number; chips: number; startChips: number; deck: Card[]; mine: Card[]; theirs: Card[]; swap: boolean[]; cursor: number;
  phase: "swap" | "bet" | "show"; tell: string; pot: number; log: string[]; enemyHp: number; enemyMaxHp: number; hp: number; battle: boolean; attack: number;
}

const HANDS = ["ばら", "ワンペア", "ツーペア", "スリーカード", "ストレート", "フラッシュ", "フルハウス", "フォーカード", "ストレートフラッシュ"];
/** Score a 5-card hand: [category, tiebreak ranks…] (Ace = 14). */
export function scoreHand(cards: Card[]): number[] {
  const ranks = cards.map(c => (c[0] === 1 ? 14 : c[0])).sort((a, b) => b - a);
  const counts = new Map<number, number>(); ranks.forEach(r => counts.set(r, (counts.get(r) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every(c => c[1] === cards[0]![1]);
  const uniq = [...new Set(ranks)];
  const wheel = uniq.join() === "14,5,4,3,2";
  const straight = uniq.length === 5 && (ranks[0]! - ranks[4]! === 4 || wheel);
  const top = wheel ? [5] : [ranks[0]!];
  if (straight && flush) return [8, ...top];
  if (groups[0]![1] === 4) return [7, groups[0]![0], groups[1]![0]];
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return [6, groups[0]![0], groups[1]![0]];
  if (flush) return [5, ...ranks];
  if (straight) return [4, ...top];
  if (groups[0]![1] === 3) return [3, ...groups.map(g => g[0])];
  if (groups[0]![1] === 2 && groups[1]![1] === 2) return [2, ...groups.map(g => g[0])];
  if (groups[0]![1] === 2) return [1, ...groups.map(g => g[0])];
  return [0, ...ranks];
}
export const compareHands = (a: Card[], b: Card[]) => { const x = scoreHand(a), y = scoreHand(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };
const strength = (cards: Card[]) => { const s = scoreHand(cards); return Math.min(1, (s[0]! + (s[1]! - 2) / 13) / 4); };

function rand(d: { seed: number }) { let r: number; [r, d.seed] = nextRand(d.seed); return r; }
function deal(d: TableData): TableData {
  const next: TableData = { ...d, deck: [], mine: [], theirs: [], swap: [false, false, false, false, false], cursor: 0, phase: "swap", pot: d.args.ante * 2 };
  const deck: Card[] = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push([r, s]);
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rand(next) * (i + 1)); [deck[i], deck[j]] = [deck[j]!, deck[i]!]; }
  next.mine = deck.splice(0, 5); next.theirs = deck.splice(0, 5); next.deck = deck;
  next.chips -= d.args.ante;
  return next;
}

export function startTable(ctx: SystemContext, raw: Record<string, unknown>): TableData {
  const args = TableArgsSchema.parse(raw);
  const chips = args.stakeVar ? Math.max(0, ctx.state.vars[args.stakeVar] ?? 0) || args.chips : args.chips;
  const enemy = enemyOf(ctx, args.enemyId);
  const hero = heroOf(ctx);
  const base: TableData = { args, seed: ctx.state.rng || 1, round: 1, chips, startChips: chips, deck: [], mine: [], theirs: [], swap: [], cursor: 0, phase: "swap", tell: "", pot: 0, log: [], enemyHp: enemy ? enemy.stats.maxHp : 0, enemyMaxHp: enemy ? enemy.stats.maxHp : 0, hp: hero.hp, battle: inBattle(ctx), attack: hero.attack };
  return deal(base);
}

/** Swap the marked cards; the opponent swaps by its own judgement, then shows a face (true, or a bluff). */
export function doSwap(d: TableData): TableData {
  const deck = [...d.deck];
  const next = { ...d, deck, mine: d.mine.map((c, i) => (d.swap[i] ? deck.shift()! : c)) };
  // Opponent keeps pairs and better, swaps the rest (up to 3).
  const counts = new Map<number, number>(); next.theirs.forEach(c => counts.set(c[0], (counts.get(c[0]) ?? 0) + 1));
  let swapped = 0;
  next.theirs = next.theirs.map(c => ((counts.get(c[0]) ?? 0) < 2 && swapped < 3 && scoreHand(next.theirs)[0]! < 4 ? (swapped++, next.deck.shift()!) : c));
  const real = strength(next.theirs);
  const bluffing = rand(next) < next.args.opponent.bluff;
  const shown = bluffing ? 1 - real : real;
  next.tell = shown > 0.6 ? "にやりと笑った。" : shown > 0.3 ? "表情を変えない。" : "小さくため息をついた。";
  return { ...next, phase: "bet" };
}

/** fold / call / raise. Returns the settled round (phase "show"). */
export function bet(d: TableData, action: "fold" | "call" | "raise"): TableData {
  let next: TableData = { ...d, phase: "show" };
  if (action === "fold") return { ...next, log: [...d.log, `第${d.round}局: 降りた（-${d.args.ante}）`] };
  let pot = d.pot;
  if (action === "raise") {
    const real = strength(d.theirs);
    const folds = real < 0.35 && rand(next) > d.args.opponent.boldness;
    pot += d.args.ante * 2;
    if (folds) return settleBattle({ ...next, chips: next.chips + d.pot, log: [...d.log, `第${d.round}局: 相手が降りた（+${d.pot}）`] }, true);
    next.chips -= d.args.ante * 2;
    pot += d.args.ante * 2;
  }
  const result = compareHands(d.mine, d.theirs);
  const name = HANDS[scoreHand(d.mine)[0]!]!, theirs = HANDS[scoreHand(d.theirs)[0]!]!;
  if (result > 0) next.chips += pot;
  else if (result === 0) next.chips += Math.floor(pot / 2);
  return settleBattle({ ...next, log: [...d.log, `第${d.round}局: ${name} 対 ${theirs} — ${result > 0 ? `勝ち（+${pot}）` : result < 0 ? "負け" : "引き分け"}`] }, result > 0, result < 0);
}
function settleBattle(d: TableData, won: boolean, lost = false): TableData {
  if (!d.battle) return d;
  if (won) return { ...d, enemyHp: Math.max(0, d.enemyHp - Math.max(1, d.attack)) };
  if (lost) return { ...d, hp: Math.max(0, d.hp - Math.max(1, Math.round(d.attack / 2))) };
  return d;
}

export function tableStatus(d: TableData): "playing" | "win" | "lose" {
  if (d.phase !== "show") return "playing";
  if (d.battle) return d.enemyHp <= 0 ? "win" : d.hp <= 0 || d.chips < d.args.ante ? "lose" : "playing";
  if (d.chips < d.args.ante) return "lose";
  if (d.round >= d.args.rounds) return d.chips > d.startChips ? "win" : "lose";
  return "playing";
}

const label = (d: TableData, c: Card) => `${d.args.suits[c[1]]}${({ 1: "A", 11: "J", 12: "Q", 13: "K" } as Record<number, string>)[c[0]] ?? c[0]}`;

export default defineSystem({
  id: "table",
  scenes: {
    hand: {
      title: "札勝負（手役・駆け引き・はったり）",
      checkArgs: args => { const r = TableArgsSchema.safeParse(args); return r.success ? [] : issues(r); },
      start: (ctx, raw) => startTable(ctx, raw),
      input(ctx, raw, input) {
        const d = raw as TableData;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        const writeBack = (data: TableData): Effect[] => (d.args.stakeVar ? [{ type: "setVar", var: d.args.stakeVar, value: data.chips }] : []);
        if (input.type === "cancel" || value.quit) return { ...finish(ctx, d.args, "quit", `席を立った（${d.chips}枚）`, d.battle ? d.hp : undefined), apply: writeBack(d) };
        let next = d;
        if (d.phase === "swap") {
          if (input.type === "left" || input.type === "right") return { data: { ...d, cursor: (d.cursor + (input.type === "left" ? 4 : 1)) % 5 } };
          if (typeof value.toggle === "number" || input.type === "confirm") { const i = typeof value.toggle === "number" ? value.toggle : d.cursor; return { data: { ...d, swap: d.swap.map((s, j) => (j === i ? !s : s)) } }; }
          if (value.swap || input.type === "down") next = doSwap(d); else return {};
        } else if (d.phase === "bet") {
          const act = typeof value.bet === "string" ? value.bet : input.type === "confirm" ? "call" : input.type === "up" ? "raise" : input.type === "down" ? "fold" : undefined;
          if (act !== "fold" && act !== "call" && act !== "raise") return {};
          next = bet(d, act);
        } else if (input.type === "confirm" || value.next) next = deal({ ...d, round: d.round + 1 });
        else return {};
        const status = tableStatus(next);
        if (status !== "playing") {
          const line = status === "win" ? `${d.args.title}：${next.chips}枚で勝ち越した！` : `${d.args.title}：${next.chips}枚……負け越した`;
          return { ...finish(ctx, d.args, status, line, d.battle ? next.hp : undefined), apply: writeBack(next) };
        }
        return { data: next };
      },
      render(host, view) {
        const d = view.data as TableData;
        host.innerHTML = "";
        backdrop(host, "#2e4a34, #0f1a12");
        const root = h("div", "position:absolute;inset:3%;display:flex;flex-direction:column;gap:3%");
        const opp = h("div", "padding:.6em 1em", undefined, "rpg-window");
        opp.append(h("div", "color:var(--rpg-accent)", `${d.args.opponent.name}${d.battle ? `　${d.enemyHp}/${d.enemyMaxHp}` : ""}`), h("div", "", d.phase === "show" ? d.theirs.map(c => label(d, c)).join(" ") + `（${HANDS[scoreHand(d.theirs)[0]!]}）` : "🂠 🂠 🂠 🂠 🂠"), h("div", "color:var(--rpg-dim);font-size:.85em", d.phase === "bet" ? `${d.args.opponent.name}は${d.tell}` : ""));
        const hand = h("div", "display:flex;gap:2%;justify-content:center;min-height:30%");
        d.mine.forEach((c, i) => {
          const card = h("button", `all:unset;cursor:pointer;width:14%;aspect-ratio:2/3;border-radius:.4em;background:#f4ecd8;color:${c[1] % 2 ? "#b03a2e" : "#1a1a1a"};display:grid;place-items:center;font-size:1.3em;font-weight:700;border:3px solid ${i === d.cursor && d.phase === "swap" ? "var(--rpg-accent)" : "transparent"};transform:${d.swap[i] ? "translateY(-12%)" : "none"};opacity:${d.swap[i] ? 0.6 : 1}`, label(d, c));
          card.onclick = () => view.send({ type: "custom", value: { toggle: i } });
          hand.appendChild(card);
        });
        const info = h("div", "padding:.6em 1em;display:flex;flex-direction:column;gap:.3em;font-size:.85em", undefined, "rpg-window");
        info.appendChild(h("div", "", `第${d.round}/${d.args.rounds}局　手持ち ${d.chips}枚　場 ${d.pot}枚　あなたの役: ${HANDS[scoreHand(d.mine)[0]!]}`));
        const tools = h("div", "display:flex;gap:.5em;flex-wrap:wrap");
        if (d.phase === "swap") tools.append(h("span", "color:var(--rpg-dim)", "替える札を選んで（決定）→"), button("交換する（↓）", () => view.send({ type: "custom", value: { swap: true } })));
        if (d.phase === "bet") tools.append(button("降りる（↓）", () => view.send({ type: "custom", value: { bet: "fold" } })), button("勝負（決定）", () => view.send({ type: "custom", value: { bet: "call" } })), button(`上乗せ +${d.args.ante * 2}（↑）`, () => view.send({ type: "custom", value: { bet: "raise" } })));
        if (d.phase === "show") tools.append(button("次の局へ（決定）", () => view.send({ type: "custom", value: { next: true } })));
        tools.appendChild(button("席を立つ", () => view.send({ type: "custom", value: { quit: true } })));
        info.appendChild(tools);
        for (const line of d.log.slice(-3)) info.appendChild(h("div", "color:var(--rpg-dim)", line));
        root.append(opp, hand, info);
        host.appendChild(root);
      },
    },
  },
});

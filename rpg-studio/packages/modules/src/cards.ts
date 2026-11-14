/**
 * Genre module: deck-building card battle as an RPG battle mode. Energy per turn, draw/discard piles,
 * block, enemy intents taken from the enemy's RPG actions (power 0 = wind-up). The hero's attack can scale damage.
 * Enemy: "battle": { "mode": "cards.battle", "args": { "cards": [...], "deck": [ { "card": "strike", "count": 5 } ] } }
 */
import { z } from "zod";
import { IdSchema } from "../../schema/src/formats";
import { defineSystem, effectiveStats, type SystemContext } from "../../engine/src/index";
import { asRecord, bar, button, h, nextRand } from "./ui";

const CardSchema = z.object({
  id: IdSchema,
  label: z.string().min(1),
  cost: z.number().int().min(0).max(9).default(1),
  damage: z.number().int().min(0).default(0),
  /** Add the hero's attack stat to the damage. */
  scaleWithAttack: z.boolean().default(false),
  block: z.number().int().min(0).default(0),
  heal: z.number().int().min(0).default(0),
  draw: z.number().int().min(0).max(10).default(0),
  energy: z.number().int().min(0).max(9).default(0),
  text: z.string().default(""),
}).strict();
const DEFAULT_CARDS = [
  { id: "strike", label: "斬る", cost: 1, damage: 2, scaleWithAttack: true, block: 0, heal: 0, draw: 0, energy: 0, text: "攻撃力+2のダメージ" },
  { id: "defend", label: "構える", cost: 1, damage: 0, scaleWithAttack: false, block: 6, heal: 0, draw: 0, energy: 0, text: "ブロック6" },
  { id: "focus", label: "集中", cost: 0, damage: 0, scaleWithAttack: false, block: 0, heal: 0, draw: 2, energy: 0, text: "2枚引く" },
  { id: "rally", label: "息を整える", cost: 1, damage: 0, scaleWithAttack: false, block: 3, heal: 3, draw: 0, energy: 0, text: "HP3回復・ブロック3" },
];
export const CardsArgsSchema = z.object({
  cards: z.array(CardSchema).min(1).default(DEFAULT_CARDS),
  deck: z.array(z.object({ card: IdSchema, count: z.number().int().min(1).max(30) }).strict()).min(1)
    .default([{ card: "strike", count: 5 }, { card: "defend", count: 4 }, { card: "focus", count: 1 }, { card: "rally", count: 2 }]),
  handSize: z.number().int().min(1).max(10).default(5),
  energy: z.number().int().min(1).max(9).default(3),
  hpScale: z.number().min(0.1).max(50).default(2),
  enemyId: z.string(),
  canFlee: z.boolean().default(true),
}).strict();
type CardsArgs = z.infer<typeof CardsArgsSchema>;

export interface CardsData {
  args: CardsArgs; seed: number; draw: string[]; hand: string[]; discard: string[];
  energy: number; block: number; hp: number; maxHp: number; enemyHp: number; enemyMaxHp: number; turn: number; cursor: number; log: string[];
}

function shuffle(list: string[], seed: number): [string[], number] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { let r: number; [r, seed] = nextRand(seed); const j = Math.floor(r * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return [out, seed];
}

function drawCards(d: CardsData, n: number): CardsData {
  let { draw, discard, seed } = d;
  const hand = [...d.hand];
  for (let i = 0; i < n; i++) {
    if (!draw.length) { if (!discard.length) break; [draw, seed] = shuffle(discard, seed); discard = []; }
    hand.push(draw[0]!); draw = draw.slice(1);
  }
  return { ...d, draw, discard, seed, hand };
}

const cardOf = (d: CardsData, id: string) => d.args.cards.find(c => c.id === id)!;

export function playCard(ctx: SystemContext, d: CardsData, index: number): CardsData {
  const id = d.hand[index];
  if (!id) return d;
  const card = cardOf(d, id);
  if (card.cost > d.energy) return { ...d, log: [...d.log, `エネルギーが足りない（${card.label}）`].slice(-6) };
  const enemy = ctx.content.database.enemies.find(e => e.id === d.args.enemyId)!;
  const stats = effectiveStats(ctx.state, ctx.content);
  const damage = card.damage + (card.scaleWithAttack ? stats.attack : 0);
  const dealt = damage ? Math.max(1, damage - Math.floor(enemy.stats.defense / 2)) : 0;
  let next: CardsData = {
    ...d, energy: d.energy - card.cost + card.energy, block: d.block + card.block, hp: Math.min(d.maxHp, d.hp + card.heal),
    enemyHp: Math.max(0, d.enemyHp - dealt), hand: d.hand.filter((_, i) => i !== index), discard: [...d.discard, id],
    log: [...d.log, `${card.label}${dealt ? `：${dealt}ダメージ` : ""}${card.block ? `：ブロック+${card.block}` : ""}${card.heal ? `：HP+${card.heal}` : ""}`].slice(-6),
  };
  if (card.draw) next = drawCards(next, card.draw);
  return { ...next, cursor: Math.min(next.cursor, Math.max(0, next.hand.length - 1)) };
}

export function endTurn(ctx: SystemContext, d: CardsData): CardsData {
  const enemy = ctx.content.database.enemies.find(e => e.id === d.args.enemyId)!;
  const stats = effectiveStats(ctx.state, ctx.content);
  const action = enemy.actions[(d.turn - 1) % enemy.actions.length]!;
  let hp = d.hp, line = action.message ?? `${enemy.name}の${action.name}！`;
  if (action.power > 0) {
    const raw = Math.max(1, enemy.stats.attack + action.power - stats.defense);
    const taken = Math.max(0, raw - d.block);
    hp = Math.max(0, hp - taken);
    line += ` ${taken}ダメージ${d.block ? `（ブロック${Math.min(d.block, raw)}）` : ""}`;
  }
  const next: CardsData = { ...d, hp, block: 0, discard: [...d.discard, ...d.hand], hand: [], energy: d.args.energy, turn: d.turn + 1, cursor: 0, log: [...d.log, line].slice(-6) };
  return drawCards(next, d.args.handSize);
}

export function intentOf(ctx: SystemContext, d: CardsData): string {
  const enemy = ctx.content.database.enemies.find(e => e.id === d.args.enemyId)!;
  const action = enemy.actions[(d.turn - 1) % enemy.actions.length]!;
  return action.power > 0 ? `${action.name}（攻撃 ${Math.max(1, enemy.stats.attack + action.power - effectiveStats(ctx.state, ctx.content).defense)}）` : `${action.name}（様子をうかがっている）`;
}

export default defineSystem({
  id: "cards",
  scenes: {
    battle: {
      title: "カードバトル（デッキ構築風の戦闘モード）",
      checkArgs: args => {
        const r = CardsArgsSchema.safeParse({ enemyId: "x", ...args });
        if (!r.success) return r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
        return r.data.deck.filter(e => !r.data.cards.some(c => c.id === e.card)).map(e => `deck: 未定義のカード '${e.card}'`);
      },
      start(ctx, raw) {
        const args = CardsArgsSchema.parse(raw);
        const enemy = ctx.content.database.enemies.find(e => e.id === args.enemyId)!;
        const ids = args.deck.flatMap(e => Array.from({ length: e.count }, () => e.card));
        const [draw, seed] = shuffle(ids, ctx.state.rng || 1);
        const enemyMaxHp = Math.max(1, Math.round(enemy.stats.maxHp * args.hpScale));
        const base: CardsData = { args, seed, draw, hand: [], discard: [], energy: args.energy, block: 0, hp: ctx.state.player.hp, maxHp: effectiveStats(ctx.state, ctx.content).maxHp, enemyHp: enemyMaxHp, enemyMaxHp, turn: 1, cursor: 0, log: [] };
        return drawCards(base, args.handSize);
      },
      input(ctx, raw, input) {
        const d = raw as CardsData;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if (input.type === "cancel") return d.args.canFlee ? { outcome: "fled", state: { ...ctx.state, player: { ...ctx.state.player, hp: Math.max(1, d.hp) } }, battleLog: ["カードをしまって逃げ出した。"] } : {};
        if (input.type === "left" || input.type === "right") return { data: { ...d, cursor: (d.cursor + (input.type === "left" ? -1 : 1) + Math.max(1, d.hand.length)) % Math.max(1, d.hand.length) } };
        let next = d;
        if (input.type === "confirm" || typeof value.play === "number") next = playCard(ctx, d, typeof value.play === "number" ? value.play : d.cursor);
        else if (input.type === "down" || value.end) next = endTurn(ctx, d);
        else return {};
        if (next.enemyHp <= 0) return { outcome: "victory", state: { ...ctx.state, player: { ...ctx.state.player, hp: Math.max(1, next.hp) } }, battleLog: [`カードの応酬を制した！（${next.turn}ターン）`] };
        if (next.hp <= 0) return { outcome: "defeat", battleLog: ["手札が尽き、力尽きた……"] };
        return { data: next };
      },
      render(host, view) {
        const d = view.data as CardsData;
        const ctx = { content: view.content, state: view.state };
        const enemy = view.content.database.enemies.find(e => e.id === d.args.enemyId)!;
        host.innerHTML = "";
        const root = h("div", "position:absolute;inset:0;display:flex;flex-direction:column;gap:2%;padding:2.5%;background:radial-gradient(ellipse at 50% 30%, #2f2a3a, #121014 70%)");
        const top = h("div", "display:flex;justify-content:space-between;gap:3%");
        const foe = h("div", "flex:1;padding:.6em .9em", undefined, "rpg-window");
        foe.append(h("div", "", `${enemy.name}　${d.enemyHp}/${d.enemyMaxHp}`), bar(d.enemyHp, d.enemyMaxHp, "#d9745b"), h("div", "font-size:.8em;color:var(--rpg-accent);margin-top:.3em", `次の行動: ${intentOf(ctx, d)}`));
        const me = h("div", "flex:1;padding:.6em .9em", undefined, "rpg-window");
        me.append(h("div", "", `${(view.state.player.name ?? view.content.project.player.name)}　HP ${d.hp}/${d.maxHp}　ブロック ${d.block}`), bar(d.hp, d.maxHp, "#7fc46b"), h("div", "font-size:.8em;margin-top:.3em", `エネルギー ${"◆".repeat(d.energy)}${"◇".repeat(Math.max(0, d.args.energy - d.energy))}　山札 ${d.draw.length}　捨て札 ${d.discard.length}　ターン ${d.turn}`));
        top.append(foe, me);
        const log = h("div", "flex:1;padding:.5em .9em;font-size:.8em;color:var(--rpg-dim);overflow:hidden", undefined, "rpg-window");
        for (const line of d.log.slice(-4)) log.appendChild(h("div", "", line));
        const hand = h("div", "display:flex;gap:2%;justify-content:center;min-height:30%");
        d.hand.forEach((id, i) => {
          const card = cardOf(d, id);
          const playable = card.cost <= d.energy;
          const c = h("button", `all:unset;cursor:pointer;width:15%;padding:.5em;border-radius:.5em;background:${playable ? "#2b2533" : "#1b181f"};border:2px solid ${i === d.cursor ? "var(--rpg-accent)" : "rgba(233,220,184,.35)"};display:flex;flex-direction:column;gap:.3em;opacity:${playable ? 1 : 0.55};transform:${i === d.cursor ? "translateY(-6%)" : "none"}`);
          c.append(h("div", "font-size:.75em;color:var(--rpg-accent)", `コスト ${card.cost}`), h("div", "font-weight:700", card.label), h("div", "font-size:.7em;color:var(--rpg-dim);white-space:normal", card.text));
          c.onclick = () => view.send({ type: "custom", value: { play: i } });
          hand.appendChild(c);
        });
        const tools = h("div", "display:flex;gap:.6em;justify-content:center");
        tools.append(button("ターン終了（↓）", () => view.send({ type: "custom", value: { end: true } })));
        if (d.args.canFlee) tools.append(button("逃げる（Esc）", () => view.send({ type: "cancel" })));
        tools.appendChild(h("span", "font-size:.75em;color:var(--rpg-dim);align-self:center", "←→ 選ぶ　決定 使う"));
        root.append(top, log, hand, tools);
        host.appendChild(root);
      },
    },
  },
});

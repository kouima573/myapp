/**
 * Genre module: match-3 puzzle. Swap neighbouring gems to line up 3+. Each gem kind has an effect, so the same board is
 * a puzzle-battle (swords hit the enemy, hearts heal), a gathering minigame (gems add to RPG variables),
 * or a score attack. Field: goal score within `moves`. Battle mode: the enemy attacks every few moves.
 */
import { z } from "zod";
import { IdSchema } from "../../schema/src/formats";
import { defineSystem, type SystemContext } from "../../engine/src/index";
import type { Effect } from "../../schema/src/index";
import { enemyOf, finish, heroOf, inBattle, issues, OutcomeArgs } from "./common";
import { asRecord, backdrop, bar, button, h, nextRand } from "./ui";

const GemSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(4),
  color: z.string().default("#9fd28c"),
  /** attack: damage the enemy. heal: restore HP. shield: block the next hits. score: add score. var: add to an RPG variable. */
  effect: z.enum(["attack", "heal", "shield", "score", "var"]).default("score"),
  amount: z.number().int().min(0).max(999).default(1),
  var: IdSchema.optional(),
}).strict();
const DEFAULT_GEMS = [
  { id: "sword", label: "剣", color: "#d9745b", effect: "attack" as const, amount: 1 },
  { id: "heart", label: "心", color: "#e48fb0", effect: "heal" as const, amount: 1 },
  { id: "guard", label: "盾", color: "#7fa8d9", effect: "shield" as const, amount: 1 },
  { id: "star", label: "星", color: "#f0c36a", effect: "score" as const, amount: 1 },
  { id: "leaf", label: "葉", color: "#7fc46b", effect: "score" as const, amount: 1 },
];

export const Match3ArgsSchema = z.object({
  title: z.string().default("石合わせ"),
  width: z.number().int().min(4).max(10).default(7),
  height: z.number().int().min(4).max(10).default(7),
  gems: z.array(GemSchema).min(3).max(8).default(DEFAULT_GEMS),
  /** Field: moves available (0 = unlimited) and the score to reach. */
  moves: z.number().int().min(0).max(999).default(15),
  target: z.number().int().min(1).max(99999).default(30),
  /** Battle: the enemy acts every N moves; enemy HP = max HP × hpScale. */
  enemyEvery: z.number().int().min(1).max(20).default(3),
  hpScale: z.number().min(0.1).max(50).default(2),
  ...OutcomeArgs,
}).strict();
export type Match3Args = z.infer<typeof Match3ArgsSchema>;

export interface Match3Data {
  args: Match3Args; seed: number; board: number[][]; cursor: { x: number; y: number }; held: boolean;
  moves: number; score: number; hp: number; maxHp: number; attack: number; defense: number; block: number;
  enemyHp: number; enemyMaxHp: number; battle: boolean; log: string[]; pending: Effect[];
}

function roll(seed: number, n: number): [number, number] { const [r, s] = nextRand(seed); return [Math.floor(r * n), s]; }

/** Cells that are part of a horizontal or vertical run of 3+. */
export function findMatches(board: number[][]): boolean[][] {
  const hgt = board.length, w = board[0]!.length;
  const out = board.map(r => r.map(() => false));
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const v = board[y]![x]!;
    if (v < 0) continue;
    if (x + 2 < w && board[y]![x + 1] === v && board[y]![x + 2] === v) for (let i = x; i < w && board[y]![i] === v; i++) out[y]![i] = true;
    if (y + 2 < hgt && board[y + 1]![x] === v && board[y + 2]![x] === v) for (let i = y; i < hgt && board[i]![x] === v; i++) out[i]![x] = true;
  }
  return out;
}

export function startMatch3(ctx: SystemContext, raw: Record<string, unknown>): Match3Data {
  const args = Match3ArgsSchema.parse(raw);
  let seed = ctx.state.rng || 1;
  const board: number[][] = [];
  for (let y = 0; y < args.height; y++) {
    const row: number[] = [];
    for (let x = 0; x < args.width; x++) {
      let v: number;
      do { [v, seed] = roll(seed, args.gems.length); } while ((x >= 2 && row[x - 1] === v && row[x - 2] === v) || (y >= 2 && board[y - 1]![x] === v && board[y - 2]![x] === v));
      row.push(v);
    }
    board.push(row);
  }
  const hero = heroOf(ctx);
  const enemy = enemyOf(ctx, args.enemyId);
  const enemyMaxHp = enemy ? Math.max(1, Math.round(enemy.stats.maxHp * args.hpScale)) : 0;
  return { args, seed, board, cursor: { x: Math.floor(args.width / 2), y: Math.floor(args.height / 2) }, held: false, moves: 0, score: 0, hp: hero.hp, maxHp: hero.maxHp, attack: hero.attack, defense: hero.defense, block: 0, enemyHp: enemyMaxHp, enemyMaxHp, battle: inBattle(ctx), log: [], pending: [] };
}

/** Swap two neighbours; resolves cascades. Returns the same data when the swap makes no match. */
export function swapGems(ctx: SystemContext, d: Match3Data, a: { x: number; y: number }, b: { x: number; y: number }): Match3Data {
  if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1 || !d.board[b.y]?.[b.x]?.toString()) return d;
  let board = d.board.map(r => [...r]);
  [board[a.y]![a.x], board[b.y]![b.x]] = [board[b.y]![b.x]!, board[a.y]![a.x]!];
  if (!findMatches(board).some(r => r.some(Boolean))) return { ...d, held: false, log: [...d.log, "そろわない"].slice(-6) };
  let next: Match3Data = { ...d, held: false, moves: d.moves + 1 };
  let seed = d.seed, chain = 0;
  const lines: string[] = [];
  for (;;) {
    const matched = findMatches(board);
    if (!matched.some(r => r.some(Boolean))) break;
    chain++;
    const counts = new Map<number, number>();
    board.forEach((row, y) => row.forEach((v, x) => { if (matched[y]![x]) { counts.set(v, (counts.get(v) ?? 0) + 1); board[y]![x] = -1; } }));
    const bonus = 1 + (chain - 1) * 0.5;
    for (const [kind, count] of counts) {
      const gem = next.args.gems[kind]!;
      const value = Math.round(count * gem.amount * bonus);
      if (gem.effect === "attack") {
        const dmg = Math.max(1, Math.round(value * Math.max(1, next.attack) / 3));
        if (next.battle) next = { ...next, enemyHp: Math.max(0, next.enemyHp - dmg) };
        next = { ...next, score: next.score + value };
        lines.push(`${gem.label}×${count}${next.battle ? ` ${dmg}ダメージ` : ""}`);
      } else if (gem.effect === "heal") { next = { ...next, hp: Math.min(next.maxHp, next.hp + value), score: next.score + value }; lines.push(`${gem.label}×${count} HP+${value}`); }
      else if (gem.effect === "shield") { next = { ...next, block: next.block + value, score: next.score + value }; lines.push(`${gem.label}×${count} 守り+${value}`); }
      else if (gem.effect === "var" && gem.var) { next = { ...next, score: next.score + value, pending: [...next.pending, { type: "setVar", var: gem.var, op: "add", value }] }; lines.push(`${gem.label}×${count} +${value}`); }
      else { next = { ...next, score: next.score + value }; lines.push(`${gem.label}×${count} +${value}`); }
    }
    // Gravity and refill.
    for (let x = 0; x < next.args.width; x++) {
      const column = board.map(r => r[x]!).filter(v => v >= 0);
      while (column.length < next.args.height) { let v: number; [v, seed] = roll(seed, next.args.gems.length); column.unshift(v); }
      column.forEach((v, y) => { board[y]![x] = v; });
    }
    if (chain > 20) break;
  }
  next = { ...next, board, seed, log: [...next.log, `${chain > 1 ? `${chain}連鎖 ` : ""}${lines.join("・")}`].slice(-6) };
  if (next.battle && next.enemyHp > 0 && next.moves % next.args.enemyEvery === 0) {
    const enemy = enemyOf(ctx, next.args.enemyId);
    const raw = Math.max(1, (enemy?.stats.attack ?? 4) + 1 - next.defense);
    const taken = Math.max(0, raw - next.block);
    next = { ...next, hp: Math.max(0, next.hp - taken), block: Math.max(0, next.block - raw), log: [...next.log, `${enemy?.name ?? "敵"}の攻撃 ${taken}ダメージ`].slice(-6) };
  }
  return next;
}

export function match3Status(d: Match3Data): "playing" | "win" | "lose" {
  if (d.battle) return d.enemyHp <= 0 ? "win" : d.hp <= 0 ? "lose" : "playing";
  if (d.score >= d.args.target) return "win";
  if (d.args.moves && d.moves >= d.args.moves) return "lose";
  return "playing";
}

export default defineSystem({
  id: "match3",
  scenes: {
    battle: {
      title: "マッチ3（石をそろえるパズル。戦闘にも採集にも）",
      checkArgs: args => { const r = Match3ArgsSchema.safeParse(args); if (!r.success) return issues(r); return r.data.gems.filter(g => g.effect === "var" && !g.var).map(g => `gems.${g.id}: effect が var のときは var が必要です`); },
      start: (ctx, raw) => startMatch3(ctx, raw),
      input(ctx, raw, input) {
        const d = raw as Match3Data;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if (input.type === "cancel" || value.quit) return finish(ctx, d.args, "quit", "石から手を離した。", d.hp);
        let next = d;
        const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[input.type as "up"];
        if (typeof value.x === "number" && typeof value.y === "number") {
          const p = { x: value.x, y: value.y };
          if (d.held && Math.abs(p.x - d.cursor.x) + Math.abs(p.y - d.cursor.y) === 1) next = swapGems(ctx, d, d.cursor, p);
          else next = { ...d, cursor: p, held: true };
        } else if (dir) {
          const p = { x: Math.max(0, Math.min(d.args.width - 1, d.cursor.x + dir[0]!)), y: Math.max(0, Math.min(d.args.height - 1, d.cursor.y + dir[1]!)) };
          next = d.held ? swapGems(ctx, d, d.cursor, p) : { ...d, cursor: p };
        } else if (input.type === "confirm") next = { ...d, held: !d.held };
        else return {};
        const apply = next.pending;
        next = { ...next, pending: [] };
        const status = match3Status(next);
        if (status !== "playing") {
          const result = finish(ctx, d.args, status, status === "win" ? `${d.args.title}を制した！（${next.moves}手・${next.score}点）` : next.hp <= 0 ? "力尽きた……" : `手数が尽きた（${next.score}/${d.args.target}点）`, next.hp);
          return { ...result, apply };
        }
        return { data: next, apply };
      },
      render(host, view) {
        const d = view.data as Match3Data;
        host.innerHTML = "";
        backdrop(host);
        const root = h("div", "position:absolute;inset:2.5%;display:grid;grid-template-columns:1fr 14em;gap:2.5%");
        const grid = h("div", `display:grid;grid-template-columns:repeat(${d.args.width},1fr);gap:3px;aspect-ratio:${d.args.width}/${d.args.height};max-height:100%;align-self:center;justify-self:center;width:min(100%, ${d.args.width * 3.2}em)`);
        d.board.forEach((row, y) => row.forEach((v, x) => {
          const gem = d.args.gems[v]!;
          const on = d.cursor.x === x && d.cursor.y === y;
          const cell = h("button", `all:unset;cursor:pointer;display:grid;place-items:center;border-radius:20%;font-weight:700;color:#14110c;background:${gem.color};box-shadow:inset 0 -3px 0 rgba(0,0,0,.25)${on ? `,0 0 0 3px ${d.held ? "#fff" : "var(--rpg-accent)"}` : ""};transform:${on && d.held ? "scale(1.08)" : "none"}`, gem.label);
          cell.onclick = () => view.send({ type: "custom", value: { x, y } });
          grid.appendChild(cell);
        }));
        const side = h("div", "padding:.8em;display:flex;flex-direction:column;gap:.4em;font-size:.82em", undefined, "rpg-window");
        side.appendChild(h("div", "color:var(--rpg-accent)", d.args.title));
        if (d.battle) {
          const enemy = enemyOf({ content: view.content, state: view.state }, d.args.enemyId);
          side.append(h("div", "", `${enemy?.name ?? "敵"} ${d.enemyHp}/${d.enemyMaxHp}`), bar(d.enemyHp, d.enemyMaxHp, "#d9745b"), h("div", "", `次の攻撃まで ${d.args.enemyEvery - (d.moves % d.args.enemyEvery)}手`));
        } else side.append(h("div", "", `得点 ${d.score}/${d.args.target}`), h("div", "", d.args.moves ? `残り ${d.args.moves - d.moves}手` : `${d.moves}手`));
        side.append(h("div", "", `HP ${d.hp}/${d.maxHp}${d.block ? `　守り ${d.block}` : ""}`), bar(d.hp, d.maxHp, "#7fc46b"));
        side.appendChild(h("div", "color:var(--rpg-dim);font-size:.9em", d.args.gems.map(g => `${g.label}=${{ attack: "攻撃", heal: "回復", shield: "守り", score: "得点", var: view.content.project.variables[g.var ?? ""]?.label ?? g.var ?? "" }[g.effect]}`).join(" ")));
        for (const line of d.log.slice(-5)) side.appendChild(h("div", "color:var(--rpg-dim)", line));
        side.appendChild(h("div", "font-size:.85em;color:var(--rpg-dim)", "矢印で選ぶ → 決定でつかむ → 矢印で入れ替え（クリックでも可）"));
        side.appendChild(button("やめる", () => view.send({ type: "custom", value: { quit: true } })));
        root.append(grid, side);
        host.appendChild(root);
      },
    },
  },
});

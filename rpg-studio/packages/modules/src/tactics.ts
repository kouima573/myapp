/**
 * Genre module: grid tactics (turn-based). Covers tactical RPG battles, skirmishes, escort / reach-the-goal maps,
 * defend-for-N-turns maps and chess-like duels. The hero is a unit with their RPG stats.
 *   #  wall   ~  water (blocks walking, not attacks)   G  goal   @  hero   a  ally slot (args.allies in order)
 *   e  enemy (args.enemy, or the RPG enemy in battle mode)   B  boss (the RPG enemy × hpScale)
 * Field: { "type": "startScene", "system": "tactics", "scene": "battle", "args": { "rows": [...], "goal": "rout", "onWin": [...] } }
 * Battle mode: enemy "battle": { "mode": "tactics.battle", "args": { "rows": [...] } }
 */
import { z } from "zod";
import { defineSystem, type SystemContext } from "../../engine/src/index";
import { enemyOf, finish, heroOf, issues, OutcomeArgs } from "./common";
import { asRecord, backdrop, button, h } from "./ui";

const UnitStats = z.object({
  name: z.string().min(1).max(20),
  hp: z.number().int().min(1).max(9999),
  attack: z.number().int().min(0).max(999),
  defense: z.number().int().min(0).max(999).default(0),
  move: z.number().int().min(0).max(12).default(3),
  range: z.number().int().min(1).max(8).default(1),
  /** Character asset for the unit (optional). */
  sprite: z.string().optional(),
}).strict();

export const TacticsArgsSchema = z.object({
  title: z.string().default("布陣"),
  rows: z.array(z.string().min(1)).min(1),
  /** rout: defeat every enemy. boss: defeat B. reach: the hero steps on G. survive: last `turns` turns. */
  goal: z.enum(["rout", "boss", "reach", "survive"]).default("rout"),
  turns: z.number().int().min(0).max(99).default(0),
  heroMove: z.number().int().min(1).max(12).default(4),
  heroRange: z.number().int().min(1).max(8).default(1),
  allies: z.array(UnitStats).default([]),
  /** Stats for every "e" (defaults from the RPG enemy in battle mode). */
  enemy: UnitStats.partial().default({}),
  hpScale: z.number().min(0.1).max(50).default(2),
  ...OutcomeArgs,
}).strict();
export type TacticsArgs = z.infer<typeof TacticsArgsSchema>;

export interface Unit { id: number; side: "ally" | "enemy"; hero: boolean; boss: boolean; name: string; x: number; y: number; hp: number; maxHp: number; attack: number; defense: number; move: number; range: number; sprite?: string; acted: boolean }
export interface TacticsData {
  args: TacticsArgs; rows: string[]; w: number; h: number; units: Unit[]; turn: number;
  mode: "select" | "move" | "target"; cursor: { x: number; y: number }; active?: number; origin?: { x: number; y: number }; targets: number[]; targetIndex: number; log: string[];
}

export function checkTacticsMap(args: TacticsArgs): string[] {
  const all = args.rows.join("");
  const out: string[] = [];
  args.rows.forEach((row, y) => Array.from(row).forEach((ch, x) => { if (!"#~G@aeB .".includes(ch)) out.push(`rows[${y}]: 使えない文字 '${ch}' (x=${x})`); }));
  if ((all.match(/@/g) ?? []).length !== 1) out.push("主人公 @ はちょうど1つ必要です");
  if ((all.match(/a/g) ?? []).length > args.allies.length) out.push(`仲間の位置 a が allies の人数(${args.allies.length})より多いです`);
  if (!/[eB]/.test(all)) out.push("敵（e か B）が1体以上必要です");
  if (args.goal === "reach" && !all.includes("G")) out.push("goal が reach のときはゴール G が必要です");
  if (args.goal === "boss" && !all.includes("B")) out.push("goal が boss のときはボス B が必要です");
  if (args.goal === "survive" && !args.turns) out.push("goal が survive のときは turns が必要です");
  return out;
}

const D = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const blocked = (d: TacticsData, x: number, y: number) => x < 0 || y < 0 || x >= d.w || y >= d.h || d.rows[y]![x] === "#" || d.rows[y]![x] === "~";
const unitAt = (d: TacticsData, x: number, y: number) => d.units.find(u => u.hp > 0 && u.x === x && u.y === y);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Tiles a unit can end its move on (cannot pass through enemies, cannot stop on anyone). */
export function reachable(d: TacticsData, u: Unit): Array<{ x: number; y: number }> {
  const seen = new Map<string, number>([[`${u.x},${u.y}`, 0]]);
  const queue = [{ x: u.x, y: u.y, c: 0 }];
  while (queue.length) {
    const p = queue.shift()!;
    if (p.c >= u.move) continue;
    for (const [dx, dy] of D) {
      const x = p.x + dx, y = p.y + dy, k = `${x},${y}`;
      if (blocked(d, x, y) || seen.has(k)) continue;
      const other = unitAt(d, x, y);
      if (other && other.side !== u.side) continue;
      seen.set(k, p.c + 1);
      queue.push({ x, y, c: p.c + 1 });
    }
  }
  return [...seen.keys()].map(k => { const [x, y] = k.split(",").map(Number); return { x: x!, y: y! }; }).filter(p => { const o = unitAt(d, p.x, p.y); return !o || o.id === u.id; });
}
const targetsOf = (d: TacticsData, u: Unit) => d.units.filter(o => o.hp > 0 && o.side !== u.side && dist(o, u) <= u.range).map(o => o.id);

function strike(d: TacticsData, attacker: Unit, target: Unit): TacticsData {
  const damage = Math.max(1, attacker.attack - target.defense);
  const units = d.units.map(u => (u.id === target.id ? { ...u, hp: Math.max(0, u.hp - damage) } : u));
  const after = units.find(u => u.id === target.id)!;
  return { ...d, units, log: [...d.log, `${attacker.name}→${target.name} ${damage}${after.hp === 0 ? "（倒れた）" : ""}`].slice(-8) };
}

export function startTactics(ctx: SystemContext, raw: Record<string, unknown>): TacticsData {
  const args = TacticsArgsSchema.parse(raw);
  const hero = heroOf(ctx);
  const rpgEnemy = enemyOf(ctx, args.enemyId);
  const enemyStats = { name: rpgEnemy?.name ?? "敵", hp: rpgEnemy?.stats.maxHp ?? 10, attack: rpgEnemy?.stats.attack ?? 4, defense: rpgEnemy?.stats.defense ?? 0, move: 3, range: 1, ...args.enemy };
  const w = Math.max(...args.rows.map(r => r.length));
  const units: Unit[] = [];
  let allyIndex = 0, id = 1;
  const rows = args.rows.map((row, y) => Array.from(row.padEnd(w, " ")).map((ch, x) => {
    const base = { id: id, x, y, acted: false, boss: false, hero: false };
    if (ch === "@") { units.push({ ...base, id: id++, side: "ally", hero: true, name: hero.name, hp: hero.hp, maxHp: hero.maxHp, attack: hero.attack, defense: hero.defense, move: args.heroMove, range: args.heroRange, sprite: ctx.state.player.sprite ?? ctx.content.project.player.sprite }); return "."; }
    if (ch === "a") { const a = args.allies[allyIndex++]; if (a) units.push({ ...base, id: id++, side: "ally", name: a.name, hp: a.hp, maxHp: a.hp, attack: a.attack, defense: a.defense, move: a.move, range: a.range, sprite: a.sprite }); return "."; }
    if (ch === "e") { units.push({ ...base, id: id++, side: "enemy", name: enemyStats.name, hp: enemyStats.hp, maxHp: enemyStats.hp, attack: enemyStats.attack, defense: enemyStats.defense, move: enemyStats.move, range: enemyStats.range, sprite: enemyStats.sprite }); return "."; }
    if (ch === "B") { const hp = Math.max(1, Math.round((rpgEnemy?.stats.maxHp ?? 20) * args.hpScale)); units.push({ ...base, id: id++, side: "enemy", boss: true, name: rpgEnemy?.name ?? "ボス", hp, maxHp: hp, attack: rpgEnemy?.stats.attack ?? 6, defense: rpgEnemy?.stats.defense ?? 1, move: 2, range: 1 }); return "."; }
    return ch === " " ? "." : ch;
  }).join(""));
  const heroUnit = units.find(u => u.hero)!;
  return { args, rows, w, h: rows.length, units, turn: 1, mode: "select", cursor: { x: heroUnit.x, y: heroUnit.y }, targets: [], targetIndex: 0, log: [`${args.title} — 1ターン目`] };
}

/** Enemy phase: approach and strike the nearest ally (weakest when several are in reach). Deterministic. */
export function enemyPhase(d: TacticsData): TacticsData {
  for (const id of d.units.filter(u => u.side === "enemy" && u.hp > 0).map(u => u.id)) {
    const me = d.units.find(u => u.id === id)!;
    if (me.hp <= 0) continue;
    const allies = d.units.filter(u => u.side === "ally" && u.hp > 0);
    if (!allies.length) break;
    const spots = reachable(d, me);
    let best: { x: number; y: number } | undefined, bestScore = Infinity;
    for (const p of spots) {
      const inReach = allies.filter(a => dist(a, p) <= me.range);
      const score = inReach.length ? -1000 + Math.min(...inReach.map(a => a.hp)) + dist(p, me) / 100 : Math.min(...allies.map(a => dist(a, p))) + dist(p, me) / 100;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    if (best) d = { ...d, units: d.units.map(u => (u.id === id ? { ...u, x: best!.x, y: best!.y } : u)) };
    const moved = d.units.find(u => u.id === id)!;
    const target = d.units.filter(u => u.side === "ally" && u.hp > 0 && dist(u, moved) <= moved.range).sort((a, b) => a.hp - b.hp || a.id - b.id)[0];
    if (target) d = strike(d, moved, target);
  }
  return { ...d, turn: d.turn + 1, units: d.units.map(u => ({ ...u, acted: false })), mode: "select", active: undefined, log: [...d.log, `${d.turn + 1}ターン目`].slice(-8) };
}

export function tacticsStatus(d: TacticsData): "playing" | "win" | "lose" {
  const hero = d.units.find(u => u.hero)!;
  if (hero.hp <= 0) return "lose";
  const enemies = d.units.filter(u => u.side === "enemy");
  const g = d.args.goal;
  if (g === "rout" && enemies.every(u => u.hp <= 0)) return "win";
  if (g === "boss" && enemies.some(u => u.boss && u.hp <= 0)) return "win";
  if (g === "reach" && d.rows[hero.y]![hero.x] === "G") return "win";
  if (g === "survive" && d.turn > d.args.turns) return "win";
  if (g !== "survive" && d.args.turns && d.turn > d.args.turns) return "lose";
  return "playing";
}

function endPlayerPhase(d: TacticsData): TacticsData {
  return tacticsStatus(d) === "playing" ? enemyPhase(d) : d;
}
function finishUnit(d: TacticsData): TacticsData {
  const next = { ...d, units: d.units.map(u => (u.id === d.active ? { ...u, acted: true } : u)), mode: "select" as const, active: undefined, targets: [] };
  return next.units.some(u => u.side === "ally" && u.hp > 0 && !u.acted) ? next : endPlayerPhase(next);
}

/** One player input. Exported for tests. */
export function tacticsInput(d: TacticsData, type: string, value: Record<string, unknown> = {}): TacticsData {
  if (value.end) return endPlayerPhase({ ...d, mode: "select", active: undefined, targets: [] });
  if (typeof value.x === "number" && typeof value.y === "number") { d = { ...d, cursor: { x: value.x, y: value.y } }; type = "confirm"; }
  const move = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[type as "up"];
  if (d.mode === "target") {
    if (move) return { ...d, targetIndex: (d.targetIndex + (type === "left" || type === "up" ? -1 : 1) + d.targets.length) % d.targets.length };
    if (type === "cancel") return finishUnit(d);
    if (type === "confirm") {
      const attacker = d.units.find(u => u.id === d.active)!, target = d.units.find(u => u.id === d.targets[d.targetIndex])!;
      return finishUnit(strike(d, attacker, target));
    }
    return d;
  }
  if (move) return { ...d, cursor: { x: Math.max(0, Math.min(d.w - 1, d.cursor.x + move[0]!)), y: Math.max(0, Math.min(d.h - 1, d.cursor.y + move[1]!)) } };
  if (type === "cancel") return d.mode === "move" ? { ...d, mode: "select", active: undefined } : d;
  if (type !== "confirm") return d;
  if (d.mode === "select") {
    const u = unitAt(d, d.cursor.x, d.cursor.y);
    if (u && u.side === "ally" && !u.acted) return { ...d, mode: "move", active: u.id, origin: { x: u.x, y: u.y } };
    return d;
  }
  const u = d.units.find(x => x.id === d.active)!;
  if (!reachable(d, u).some(p => p.x === d.cursor.x && p.y === d.cursor.y)) return d;
  const moved = { ...d, units: d.units.map(x => (x.id === u.id ? { ...x, x: d.cursor.x, y: d.cursor.y } : x)) };
  if (tacticsStatus(moved) === "win") return moved;
  const targets = targetsOf(moved, moved.units.find(x => x.id === u.id)!);
  if (!targets.length) return finishUnit(moved);
  return { ...moved, mode: "target", targets, targetIndex: 0 };
}

export default defineSystem({
  id: "tactics",
  scenes: {
    battle: {
      title: "タクティクス（マス目の陣取り戦・SRPG）",
      checkArgs: args => { const r = TacticsArgsSchema.safeParse(args); return r.success ? checkTacticsMap(r.data) : issues(r); },
      start: (ctx, raw) => startTactics(ctx, raw),
      input(ctx, raw, input) {
        const d = raw as TacticsData;
        const value = input.type === "custom" ? asRecord(input.value) : {};
        if (value.quit || (input.type === "cancel" && d.mode === "select" && (d.args.canFlee || !(ctx.state.scene as { battle?: unknown }).battle))) return finish(ctx, d.args, "quit", "陣を引いた。", d.units.find(u => u.hero)!.hp);
        if (input.type === "frame") return {};
        const next = tacticsInput(d, input.type, value);
        const status = tacticsStatus(next);
        const hero = next.units.find(u => u.hero)!;
        if (status === "win") return finish(ctx, d.args, "win", `${d.args.title}に勝利した！（${next.turn}ターン）`, hero.hp);
        if (status === "lose") return finish(ctx, d.args, "lose", hero.hp <= 0 ? `${hero.name}が倒れた……` : "持ちこたえられなかった……", hero.hp);
        return { data: next };
      },
      render(host, view) {
        const d = view.data as TacticsData;
        host.innerHTML = "";
        backdrop(host);
        const root = h("div", "position:absolute;inset:2%;display:grid;grid-template-columns:1fr 13em;gap:2%");
        const reach = d.mode === "move" && d.active ? reachable(d, d.units.find(u => u.id === d.active)!) : [];
        const grid = h("div", `display:grid;grid-template-columns:repeat(${d.w},1fr);gap:1px;align-self:center;aspect-ratio:${d.w}/${d.h};max-height:100%`);
        for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
          const ch = d.rows[y]![x];
          const u = unitAt(d, x, y);
          const target = d.mode === "target" && u && u.id === d.targets[d.targetIndex];
          const cell = h("div", `position:relative;display:grid;place-items:center;font-size:.7em;cursor:pointer;background:${ch === "#" ? "#4b5048" : ch === "~" ? "#2f5d6e" : ch === "G" ? "#6d6235" : "#3a4a33"};outline:${d.cursor.x === x && d.cursor.y === y ? "2px solid var(--rpg-accent)" : target ? "2px solid #ff8a5c" : "none"};outline-offset:-2px`);
          if (reach.some(p => p.x === x && p.y === y)) cell.style.boxShadow = "inset 0 0 0 999px rgba(127,196,255,.25)";
          if (u) {
            const url = u.sprite ? view.assetUrl(u.sprite) : undefined;
            const token = h("div", `width:80%;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;opacity:${u.acted ? 0.5 : 1};background:${u.side === "ally" ? "#3f7fc4" : u.boss ? "#9b2f2f" : "#c0563f"}`);
            if (url) { token.style.background = `url("${url}") 0 0/400% 400% no-repeat`; token.style.borderRadius = "0"; token.style.imageRendering = "pixelated"; }
            else token.textContent = u.name.slice(0, 1);
            cell.appendChild(token);
            cell.appendChild(h("div", `position:absolute;left:10%;right:10%;bottom:4%;height:3px;background:#222`)).appendChild(h("div", `height:100%;width:${(u.hp / u.maxHp) * 100}%;background:${u.side === "ally" ? "#7fc46b" : "#d9745b"}`));
          }
          cell.onclick = () => view.send({ type: "custom", value: { x, y } });
          grid.appendChild(cell);
        }
        const side = h("div", "padding:.7em;display:flex;flex-direction:column;gap:.35em;font-size:.8em;overflow:auto", undefined, "rpg-window");
        const goal = { rout: "敵を全滅させる", boss: "ボスを倒す", reach: "主人公がGに着く", survive: `${d.args.turns}ターン持ちこたえる` }[d.args.goal];
        side.append(h("div", "color:var(--rpg-accent)", d.args.title), h("div", "", `ターン ${d.turn}${d.args.turns ? `/${d.args.turns}` : ""}　目的: ${goal}`));
        const hover = unitAt(d, d.cursor.x, d.cursor.y);
        if (hover) side.appendChild(h("div", "", `${hover.name} HP${hover.hp}/${hover.maxHp} 攻${hover.attack} 防${hover.defense} 移${hover.move} 射${hover.range}`));
        side.appendChild(h("div", "color:var(--rpg-dim)", d.mode === "select" ? "味方を選ぶ（決定）" : d.mode === "move" ? "移動先を選ぶ（キャンセルで戻る）" : "攻撃する相手（←→）・決定で攻撃・キャンセルで待機"));
        for (const line of d.log.slice(-6)) side.appendChild(h("div", "color:var(--rpg-dim)", line));
        side.append(button("ターン終了", () => view.send({ type: "custom", value: { end: true } })));
        if (d.args.canFlee) side.append(button("撤退する", () => view.send({ type: "custom", value: { quit: true } })));
        root.append(grid, side);
        host.appendChild(root);
      },
    },
  },
});

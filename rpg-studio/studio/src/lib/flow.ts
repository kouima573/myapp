/**
 * Branch diagram of dialogues and events (roadmap 055): what a conversation / event leads to —
 * choices, conditions, chances, battles, other dialogues and events — and what starts it.
 * Pure data → tree, so it can be tested without a browser.
 */
import type { Condition, Effect, GameContent } from "@rpg/schema";

export interface FlowNode {
  kind: "dialogue" | "event" | "choice" | "branch" | "battle" | "effect" | "lines" | "loop" | "missing";
  label: string;
  /** dialogue / event id the node stands for (clickable in the studio). */
  ref?: { kind: "dialogue" | "event"; id: string };
  /** Condition for reaching this node, in short text. */
  when?: string;
  children: FlowNode[];
}

const shortJson = (value: unknown, max = 60) => { const t = JSON.stringify(value) ?? ""; return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

export function describeCondition(c: Condition | undefined): string | undefined {
  if (!c) return undefined;
  const o = c as Record<string, unknown>;
  if (typeof o.flag === "string") return `${o.value === false ? "NOT " : ""}フラグ ${o.flag}`;
  if (typeof o.var === "string") return `変数 ${o.var} ${String(o.op ?? "==")} ${shortJson(o.value, 20)}`;
  if (typeof o.item === "string") return `アイテム ${o.item}${o.count ? ` ×${String(o.count)}` : ""}`;
  if (Array.isArray(o.all)) return o.all.map(x => describeCondition(x as Condition)).join(" かつ ");
  if (Array.isArray(o.any)) return `(${o.any.map(x => describeCondition(x as Condition)).join(" または ")})`;
  if (o.not) return `NOT (${describeCondition(o.not as Condition)})`;
  return shortJson(c, 50);
}

function describeEffect(e: Effect): string {
  switch (e.type) {
    case "setFlag": return `フラグ ${e.flag} = ${e.value ?? true}`;
    case "setVar": return `変数 ${e.var} ${e.op ?? "="} ${shortJson(e.value, 20)}`;
    case "giveItem": return `${e.item} を${e.count ?? 1}個もらう`;
    case "takeItem": return `${e.item} を${e.count ?? 1}個わたす`;
    case "teleport": return `${e.mapId} (${e.x}, ${e.y}) へ移動`;
    case "ending": return `エンディング ${e.ending}`;
    case "joinParty": return `${e.companion} が仲間になる`;
    case "leaveParty": return `${e.companion} が抜ける`;
    case "startScene": return `場面 ${e.system}/${e.scene}`;
    case "markDone": return `済み印 ${e.id}`;
    case "unlockAbility": return `技 ${e.ability} を覚える`;
    case "removeAbility": return `技 ${e.ability} を忘れる`;
    case "grantTrait": return `特性 ${e.trait} を得る`;
    case "removeTrait": return `特性 ${e.trait} を失う`;
    case "addStatus": return `状態 ${e.status} にする`;
    case "removeStatus": return `状態 ${e.status ?? "すべて"} を治す`;
    case "heal": return "回復";
    case "damage": return `ダメージ ${shortJson(e.amount, 20)}`;
    case "gainExp": return `経験値 ${shortJson(e.amount, 20)}`;
    case "learnVerb": return `動詞 ${e.verb} を覚える`;
    case "setTile": return `地形を変える (${e.x}, ${e.y})`;
    case "moveEntity": return `${e.entity} を動かす`;
    case "signal": return `シグナル ${e.signal}`;
    case "script": return `スクリプト ${e.script}${e.call ? `.${e.call}` : ""}`;
    case "system": return `システム ${e.system}.${e.action}`;
    default: return e.type;
  }
}

/** Effects the diagram does not draw (pure presentation); everything else becomes a node. */
const QUIET = new Set(["message", "emote", "moveRoute", "playSfx", "playBgm", "playAmbient", "battleLog"]);

export function flowTree(content: GameContent, root: { kind: "dialogue" | "event"; id: string }, maxDepth = 8): FlowNode {
  const seen = new Set<string>();
  const effects = (list: Effect[], depth: number, path: Set<string>): FlowNode[] => {
    const out: FlowNode[] = [];
    let lines = 0;
    const flushLines = () => { if (lines) out.push({ kind: "lines", label: `メッセージ ${lines}つ`, children: [] }); lines = 0; };
    for (const e of list) {
      if (e.type === "message") { lines++; continue; }
      if (QUIET.has(e.type)) continue;
      flushLines();
      switch (e.type) {
        case "dialogue": out.push(node({ kind: "dialogue", id: e.dialogue }, depth + 1, path)); break;
        case "event": out.push(node({ kind: "event", id: e.event }, depth + 1, path)); break;
        case "choice":
          out.push({ kind: "branch", label: `選択肢${e.prompt ? `「${e.prompt}」` : ""}`, children: e.options.map(o => ({ kind: "choice" as const, label: o.label, when: describeCondition(o.when), children: effects(o.effects, depth + 1, path) })) });
          break;
        case "if":
          out.push({ kind: "branch", label: "もし", children: [
            { kind: "choice", label: "はい", when: describeCondition(e.when), children: effects(e.then, depth + 1, path) },
            { kind: "choice", label: "いいえ", children: effects(e.else ?? [], depth + 1, path) },
          ] });
          break;
        case "input":
          out.push({ kind: "branch", label: `文字入力${e.prompt ? `「${e.prompt}」` : ""}${e.saveAs === "name" ? "（主人公の名前）" : ""}`, children: [
            ...(e.answers ?? []).map(a => ({ kind: "choice" as const, label: `「${a.match.join("」「")}」と入力`, children: effects(a.effects, depth + 1, path) })),
            ...(e.answers?.length || e.otherwise?.length ? [{ kind: "choice" as const, label: "それ以外", children: effects(e.otherwise ?? [], depth + 1, path) }] : []),
          ] });
          break;
        case "chance":
          out.push({ kind: "branch", label: `確率 ${shortJson(e.percent, 20)}%`, children: [
            { kind: "choice", label: "当たり", children: effects(e.then, depth + 1, path) },
            { kind: "choice", label: "はずれ", children: effects(e.else ?? [], depth + 1, path) },
          ] });
          break;
        case "battle":
          out.push({ kind: "battle", label: `戦闘: ${[e.enemy, ...(e.with ?? [])].join("・")}${e.mode ? `（${e.mode}）` : ""}`, children: e.onVictory?.length ? [{ kind: "choice", label: "勝ったら", children: effects(e.onVictory, depth + 1, path) }] : [] });
          break;
        case "schedule":
          out.push({ kind: "branch", label: `あとで（${shortJson(e.after, 20)}歩/ターン後）`, children: effects(e.effects, depth + 1, path) });
          break;
        default: out.push({ kind: "effect", label: describeEffect(e), children: [] });
      }
    }
    flushLines();
    return out;
  };
  const node = (ref: { kind: "dialogue" | "event"; id: string }, depth: number, path: Set<string>): FlowNode => {
    const key = `${ref.kind}:${ref.id}`;
    if (path.has(key)) return { kind: "loop", label: `↺ ${ref.id} に戻る`, ref, children: [] };
    if (depth > maxDepth) return { kind: "loop", label: `… ${ref.id}（深いので省略）`, ref, children: [] };
    const inner = new Set(path).add(key);
    const again = seen.has(key);
    seen.add(key);
    if (ref.kind === "dialogue") {
      const d = content.dialogues[ref.id];
      if (!d) return { kind: "missing", label: `会話 ${ref.id}（見つかりません）`, ref, children: [] };
      const conditional = d.lines.filter(l => typeof l !== "string" && l.when).length;
      const children: FlowNode[] = again ? [] : [
        { kind: "lines", label: `台詞 ${d.lines.length}行${conditional ? `（条件つき ${conditional}行）` : ""}`, children: [] },
        ...effects(d.effects, depth, inner),
        ...(d.choices.length ? [{ kind: "branch" as const, label: "選択肢", children: d.choices.map(c => ({ kind: "choice" as const, label: `${c.label}${c.once ? "（報酬は一度だけ）" : ""}`, when: describeCondition(c.when), children: effects(c.effects, depth + 1, inner) })) }] : []),
      ];
      return { kind: "dialogue", label: `会話 ${d.speaker}${again ? "（上に同じ）" : ""}`, ref, children };
    }
    const ev = content.events[ref.id];
    if (!ev) return { kind: "missing", label: `イベント ${ref.id}（見つかりません）`, ref, children: [] };
    if (again) return { kind: "event", label: `イベント ${ev.label}（上に同じ）`, ref, children: [] };
    const children: FlowNode[] = [];
    if (ev.when) {
      children.push({ kind: "branch", label: "条件", children: [
        { kind: "choice", label: "満たす", when: describeCondition(ev.when), children: effects(ev.effects, depth, inner) },
        { kind: "choice", label: "満たさない", children: effects(ev.otherwise, depth, inner) },
      ] });
    } else children.push(...effects(ev.effects, depth, inner));
    if (ev.once) children.push({ kind: "choice", label: "2回目以降", children: effects(ev.afterDone, depth, inner) });
    return { kind: "event", label: `イベント ${ev.label}${ev.once ? "（一度だけ）" : ""}`, ref, children };
  };
  return node(root, 0, new Set());
}

/** Where a dialogue / event is started from: NPCs, map objects, other dialogues and events. */
export function flowSources(content: GameContent, target: { kind: "dialogue" | "event"; id: string }): string[] {
  const out: string[] = [];
  const key = target.kind === "dialogue" ? "dialogue" : "event";
  const mentions = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(mentions);
    if (value && typeof value === "object") {
      const o = value as Record<string, unknown>;
      if (o.type === key && o[key] === target.id) return true;
      return Object.values(o).some(mentions);
    }
    return false;
  };
  for (const [mapId, map] of Object.entries(content.maps)) {
    for (const npc of map.npcs) if (target.kind === "dialogue" ? npc.dialogues.some(d => d.dialogue === target.id) : mentions(npc)) out.push(`マップ ${mapId} の人 ${npc.name ?? npc.id}`);
    for (const it of map.interactables) if ((it as { event?: string }).event === target.id && target.kind === "event" || mentions(it)) out.push(`マップ ${mapId} の仕掛け ${it.id}`);
    for (const en of map.entities) if ((en as unknown as Record<string, unknown>)[key] === target.id || mentions(en)) out.push(`マップ ${mapId} のエンティティ ${en.id}`);
    for (const r of map.regions) if (mentions(r)) out.push(`マップ ${mapId} の領域 ${r.id}`);
  }
  for (const d of Object.values(content.dialogues)) if (!(target.kind === "dialogue" && d.id === target.id) && mentions(d)) out.push(`会話 ${d.id}`);
  for (const e of Object.values(content.events)) if (!(target.kind === "event" && e.id === target.id) && mentions(e)) out.push(`イベント ${e.id}`);
  for (const r of content.rules) if (mentions(r)) out.push(`ルール ${r.id}`);
  return [...new Set(out)];
}

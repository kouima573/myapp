import type {
  BattleState, Direction, Effect, Enemy, GameContent, GameEvent, GameMap, GameState, Interactable, Npc, TileDef,
} from "../../schema/src/formats";
import { evaluate, nextRandom } from "./conditions";
import { sortSystems, type GameSystem } from "./systems";

export type BattleCommand = { command: "attack" } | { command: "guard" } | { command: "flee" } | { command: "item"; item: string };

export type Action =
  | { type: "move"; direction: Direction }
  | { type: "face"; direction: Direction }
  | { type: "interact" }
  | { type: "advance" }
  | { type: "choose"; choiceId: string }
  | ({ type: "battle" } & BattleCommand)
  | { type: "useItem"; item: string };

/** Presentation hints for the runtime (sound, animation). Never needed for correctness. */
export type Cue =
  | { kind: "moved"; from: { x: number; y: number } }
  | { kind: "bump" }
  | { kind: "mapChanged"; from: string }
  | { kind: "battleStart"; enemyId: string }
  | { kind: "hit"; target: "player" | "enemy"; amount: number }
  | { kind: "battleEnd"; outcome: BattleState["outcome"] };

export interface StepResult {
  state: GameState;
  log: string[];
  cues: Cue[];
}

export const DELTAS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};

interface Ctx {
  content: GameContent;
  systems: GameSystem[];
  log: string[];
  cues: Cue[];
}

export interface Engine {
  readonly content: GameContent;
  readonly systems: readonly GameSystem[];
  newGame(seed?: number): GameState;
  step(state: GameState, action: Action): StepResult;
  /** Run arbitrary effects (used by tests, the studio's debug console and system code). */
  run(state: GameState, effects: Effect[]): StepResult;
  isPassable(state: GameState, x: number, y: number): boolean;
  tileAt(map: GameMap, x: number, y: number): TileDef | undefined;
  /** Atlas index to draw for a tile in the current state (handles opened gates). */
  tileIndex(state: GameState, tile: TileDef): number;
  visibleNpcs(state: GameState, map?: GameMap): Npc[];
  visibleInteractables(state: GameState, map?: GameMap): Interactable[];
}

export function createEngine(content: GameContent, systems: readonly GameSystem[] = []): Engine {
  const sorted = sortSystems(systems);
  const tiles = new Map(content.tileset.tiles.map(tile => [tile.code, tile]));
  const ctx = (): Ctx => ({ content, systems: sorted, log: [], cues: [] });

  const tileAt = (map: GameMap, x: number, y: number) => tiles.get(Array.from(map.rows[y] ?? "")[x] ?? "");
  const visibleNpcs = (state: GameState, map = content.maps[state.mapId]) => (map?.npcs ?? []).filter(npc => evaluate(npc.visibleWhen, state));
  const visibleInteractables = (state: GameState, map = content.maps[state.mapId]) => (map?.interactables ?? []).filter(item => evaluate(item.visibleWhen, state));

  function isPassable(state: GameState, x: number, y: number, map = content.maps[state.mapId]): boolean {
    if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    const tile = tileAt(map, x, y);
    let passable = Boolean(tile && (tile.passable || (tile.passableWhen && evaluate(tile.passableWhen, state))));
    if (passable && visibleNpcs(state, map).some(npc => npc.x === x && npc.y === y)) passable = false;
    if (passable && visibleInteractables(state, map).some(item => item.solid && item.trigger === "action" && item.x === x && item.y === y)) passable = false;
    for (const system of sorted) {
      const override = system.canPass?.({ content, state, map, x, y, tile, passable });
      if (typeof override === "boolean") passable = override;
    }
    return passable;
  }

  function newGame(seed = 20261114): GameState {
    const { project } = content;
    return {
      mapId: project.start.mapId,
      player: { x: project.start.x, y: project.start.y, facing: project.start.facing, hp: project.player.stats.maxHp, stats: { ...project.player.stats } },
      abilities: [...project.player.abilities],
      items: { ...project.player.items },
      flags: Object.fromEntries(Object.entries(project.flags).map(([id, decl]) => [id, decl.initial])),
      done: [],
      scene: { kind: "field" },
      queue: [],
      systemData: {},
      rng: seed >>> 0,
      steps: 0,
    };
  }

  /* ---------------------------------------------------------------- effects */

  const random = (state: GameState): [number, GameState] => {
    const [value, rng] = nextRandom(state.rng);
    return [value, { ...state, rng }];
  };

  function enqueue(state: GameState, effects: Effect[]): GameState {
    return effects.length ? { ...state, queue: [...effects, ...state.queue] } : state;
  }

  function runQueue(c: Ctx, state: GameState): GameState {
    let guard = 0;
    while (state.scene.kind === "field" && state.queue.length) {
      if (++guard > 1000) throw new Error("効果キューが1000件を超えました。会話やイベントが自分自身を無限に呼んでいないか確認してください");
      const [effect, ...rest] = state.queue;
      state = applyEffect(c, { ...state, queue: rest }, effect!);
    }
    return state;
  }

  function itemName(id: string) { return content.database.items.find(i => i.id === id)?.name ?? id; }
  function abilityName(id: string) { return content.database.abilities.find(a => a.id === id)?.name ?? id; }

  function applyEffect(c: Ctx, state: GameState, effect: Effect): GameState {
    switch (effect.type) {
      case "message":
        return { ...state, scene: { kind: "message", text: effect.text, ...(effect.speaker ? { speaker: effect.speaker } : {}) } };
      case "setFlag":
        c.log.push(`フラグ ${effect.flag} = ${effect.value ?? true}`);
        return { ...state, flags: { ...state.flags, [effect.flag]: effect.value ?? true } };
      case "unlockAbility":
        if (state.abilities.includes(effect.ability)) return state;
        c.log.push(`能力「${abilityName(effect.ability)}」を習得`);
        return { ...state, abilities: [...state.abilities, effect.ability] };
      case "giveItem": {
        const count = effect.count ?? 1;
        c.log.push(`${itemName(effect.item)} ×${count} を入手`);
        return { ...state, items: { ...state.items, [effect.item]: (state.items[effect.item] ?? 0) + count } };
      }
      case "takeItem": {
        const left = (state.items[effect.item] ?? 0) - (effect.count ?? 1);
        const items = { ...state.items };
        if (left > 0) items[effect.item] = left; else delete items[effect.item];
        return { ...state, items };
      }
      case "heal": {
        const hp = Math.min(state.player.stats.maxHp, state.player.hp + (effect.amount ?? state.player.stats.maxHp));
        return { ...state, player: { ...state.player, hp } };
      }
      case "teleport": {
        const from = state.mapId;
        if (from !== effect.mapId) c.cues.push({ kind: "mapChanged", from });
        c.log.push(`${content.maps[effect.mapId]?.title ?? effect.mapId} (${effect.x}, ${effect.y}) へ移動`);
        return { ...state, mapId: effect.mapId, player: { ...state.player, x: effect.x, y: effect.y, facing: effect.facing ?? state.player.facing } };
      }
      case "dialogue":
        if (!content.dialogues[effect.dialogue]) throw new Error(`会話 '${effect.dialogue}' がありません`);
        return { ...state, scene: { kind: "dialogue", dialogueId: effect.dialogue, line: 0 } };
      case "battle":
        return startBattle(c, state, effect);
      case "markDone":
        return state.done.includes(effect.id) ? state : { ...state, done: [...state.done, effect.id] };
      case "if":
        return enqueue(state, evaluate(effect.when, state) ? effect.then : effect.else ?? []);
      case "system": {
        const system = c.systems.find(s => s.id === effect.system);
        const action = system?.actions?.[effect.action];
        if (!action) throw new Error(`システム '${effect.system}' にアクション '${effect.action}' がありません`);
        const result = action({ content, state }, effect.args ?? {});
        c.log.push(...(result.log ?? []));
        return enqueue(result.state ?? state, result.effects ?? []);
      }
    }
  }

  function runEvent(c: Ctx, state: GameState, event: GameEvent): GameState {
    if (event.once && state.done.includes(event.id)) return enqueue(state, event.afterDone);
    if (!evaluate(event.when, state)) return enqueue(state, event.otherwise);
    c.log.push(`イベント「${event.label}」`);
    // markDone runs last so an event interrupted by a lost battle can be retried.
    return enqueue(state, event.once ? [...event.effects, { type: "markDone", id: event.id }] : event.effects);
  }

  /* ---------------------------------------------------------------- battle */

  function enemyOf(id: string): Enemy {
    const enemy = content.database.enemies.find(e => e.id === id);
    if (!enemy) throw new Error(`敵 '${id}' がデータベースにありません`);
    return enemy;
  }

  function startBattle(c: Ctx, state: GameState, effect: Extract<Effect, { type: "battle" }>): GameState {
    const enemy = enemyOf(effect.enemy);
    let battle: BattleState = {
      enemyId: enemy.id,
      enemyHp: enemy.stats.maxHp,
      turn: 0,
      guarding: false,
      canFlee: effect.canFlee ?? enemy.canFlee,
      onDefeat: effect.onDefeat ?? "respawn",
      onVictory: effect.onVictory ?? [],
      log: [`${enemy.name}が現れた！`],
      systemData: {},
      outcome: "ongoing",
    };
    for (const system of c.systems) {
      const data = system.onBattleStart?.({ content, state, battle, enemy });
      if (data !== undefined) battle = { ...battle, systemData: { ...battle.systemData, [system.id]: data } };
    }
    c.cues.push({ kind: "battleStart", enemyId: enemy.id });
    c.log.push(`戦闘開始: ${enemy.name}`);
    return { ...state, scene: { kind: "battle", battle } };
  }

  function rollDamage(state: GameState, attack: number, power: number, defense: number): [number, GameState] {
    const [roll, next] = random(state);
    const variance = Math.floor(roll * 3) - 1; // -1, 0, +1
    return [Math.max(1, attack + power - defense + variance), next];
  }

  /**
   * Damage pipeline, in this fixed order:
   * ① formula → ② systems.modifyDamage → ③ lethal check → systems.onLethalDamage (first outcome wins) → ④ commit HP.
   */
  function damage(c: Ctx, state: GameState, battle: BattleState, target: "player" | "enemy", raw: number): { state: GameState; battle: BattleState; amount: number; notes: string[] } {
    const enemy = enemyOf(battle.enemyId);
    let amount = raw;
    for (const system of c.systems) {
      const changed = system.modifyDamage?.({ content, state, battle, enemy, target, amount, battleData: battle.systemData[system.id] });
      if (typeof changed === "number" && Number.isFinite(changed)) amount = Math.max(0, Math.floor(changed));
    }
    const notes: string[] = [];
    if (target === "enemy") {
      return { state, battle: { ...battle, enemyHp: Math.max(0, battle.enemyHp - amount) }, amount, notes };
    }
    const hpBefore = state.player.hp;
    let hp = Math.max(0, hpBefore - amount);
    if (hp === 0) {
      for (const system of c.systems) {
        const outcome = system.onLethalDamage?.({ content, state, battle, enemy, target, amount, battleData: battle.systemData[system.id], hpBefore });
        if (!outcome) continue;
        hp = Math.max(0, Math.min(state.player.stats.maxHp, Math.floor(outcome.hp)));
        if (outcome.message) notes.push(outcome.message);
        if (outcome.battleData !== undefined) battle = { ...battle, systemData: { ...battle.systemData, [system.id]: outcome.battleData } };
        break;
      }
    }
    return { state: { ...state, player: { ...state.player, hp } }, battle, amount, notes };
  }

  function battleStep(c: Ctx, state: GameState, command: BattleCommand): GameState {
    if (state.scene.kind !== "battle") return state;
    let battle = state.scene.battle;
    if (battle.outcome !== "ongoing") return state;
    const enemy = enemyOf(battle.enemyId);
    const lines: string[] = [];
    battle = { ...battle, guarding: false };

    if (command.command === "attack") {
      const [raw, next] = rollDamage(state, state.player.stats.attack, 0, enemy.stats.defense);
      const hit = damage(c, next, battle, "enemy", raw);
      state = hit.state; battle = hit.battle;
      c.cues.push({ kind: "hit", target: "enemy", amount: hit.amount });
      lines.push(`${content.project.player.name}の攻撃！ ${enemy.name}に${hit.amount}のダメージ。`);
    } else if (command.command === "guard") {
      battle = { ...battle, guarding: true };
      lines.push(`${content.project.player.name}は身を守っている。`);
    } else if (command.command === "item") {
      const item = content.database.items.find(i => i.id === command.item);
      if (!item?.heal || !(state.items[item.id] ?? 0)) {
        lines.push("使えるアイテムがない。");
        return { ...state, scene: { kind: "battle", battle: { ...battle, log: [...battle.log, ...lines].slice(-8) } } };
      }
      const hp = Math.min(state.player.stats.maxHp, state.player.hp + item.heal);
      const items = { ...state.items };
      if ((items[item.id] ?? 0) > 1) items[item.id] = items[item.id]! - 1; else delete items[item.id];
      lines.push(`${item.name}を使った。HPが${hp - state.player.hp}回復した。`);
      state = { ...state, items, player: { ...state.player, hp } };
    } else if (command.command === "flee") {
      if (!battle.canFlee) {
        lines.push("逃げられない！");
      } else {
        const [roll, next] = random(state);
        state = next;
        if (roll < 0.6) {
          lines.push("うまく逃げ切れた。");
          battle = { ...battle, outcome: "fled", log: [...battle.log, ...lines].slice(-8) };
          c.cues.push({ kind: "battleEnd", outcome: "fled" });
          return { ...state, scene: { kind: "battle", battle } };
        }
        lines.push("逃げられなかった！");
      }
    }

    if (battle.enemyHp <= 0) {
      lines.push(`${enemy.name}を倒した！`);
      for (const drop of enemy.drops) {
        state = { ...state, items: { ...state.items, [drop.item]: (state.items[drop.item] ?? 0) + drop.count } };
        lines.push(`${itemName(drop.item)}を${drop.count}個手に入れた。`);
      }
      c.cues.push({ kind: "battleEnd", outcome: "victory" });
      c.log.push(`勝利: ${enemy.name}`);
      return { ...state, scene: { kind: "battle", battle: { ...battle, outcome: "victory", log: [...battle.log, ...lines].slice(-8) } } };
    }

    // Enemy turn. An action with power 0 is a non-damaging move (a wind-up / telegraph).
    const action = enemy.actions[battle.turn % enemy.actions.length]!;
    lines.push(action.message ?? `${enemy.name}の${action.name}！`);
    if (action.power > 0) {
      const [rolled, next] = rollDamage(state, enemy.stats.attack, action.power, state.player.stats.defense);
      // Guarding halves the damage at step ① (before systems see it).
      const raw = battle.guarding ? Math.max(1, Math.ceil(rolled / 2)) : rolled;
      const hit = damage(c, next, battle, "player", raw);
      state = hit.state; battle = hit.battle;
      c.cues.push({ kind: "hit", target: "player", amount: hit.amount });
      lines.push(`${hit.amount}のダメージを受けた。`);
      lines.push(...hit.notes);
    }
    battle = { ...battle, turn: battle.turn + 1 };
    if (state.player.hp <= 0) {
      lines.push(`${content.project.player.name}は倒れた……`);
      battle = { ...battle, outcome: "defeat" };
      c.cues.push({ kind: "battleEnd", outcome: "defeat" });
      c.log.push(`敗北: ${enemy.name}`);
    }
    return { ...state, scene: { kind: "battle", battle: { ...battle, log: [...battle.log, ...lines].slice(-8) } } };
  }

  function closeBattle(c: Ctx, state: GameState): GameState {
    if (state.scene.kind !== "battle") return state;
    const battle = state.scene.battle;
    if (battle.outcome === "ongoing") return state;
    if (battle.outcome === "victory") {
      return runQueue(c, enqueue({ ...state, scene: { kind: "field" } }, battle.onVictory));
    }
    if (battle.outcome === "fled") return { ...state, scene: { kind: "field" }, queue: [] };
    // Defeat.
    if (battle.onDefeat === "continue") {
      return { ...state, scene: { kind: "field" }, queue: [], player: { ...state.player, hp: 1 } };
    }
    const { start } = content.project;
    if (state.mapId !== start.mapId) c.cues.push({ kind: "mapChanged", from: state.mapId });
    return {
      ...state,
      mapId: start.mapId,
      player: { ...state.player, x: start.x, y: start.y, facing: start.facing, hp: state.player.stats.maxHp },
      queue: [],
      scene: { kind: "message", text: "目の前が暗くなった……。気がつくと、見慣れた場所に戻っていた。" },
    };
  }

  /* ---------------------------------------------------------------- field */

  function move(c: Ctx, state: GameState, direction: Direction): GameState {
    const map = content.maps[state.mapId];
    if (!map) throw new Error(`現在のマップ '${state.mapId}' がありません`);
    state = { ...state, player: { ...state.player, facing: direction } };
    const to = { x: state.player.x + DELTAS[direction].x, y: state.player.y + DELTAS[direction].y };
    if (!isPassable(state, to.x, to.y, map)) {
      c.cues.push({ kind: "bump" });
      return state;
    }
    const from = { x: state.player.x, y: state.player.y };
    state = { ...state, steps: state.steps + 1, player: { ...state.player, ...to } };
    c.cues.push({ kind: "moved", from });

    const portal = map.portals.find(p => p.x === to.x && p.y === to.y && evaluate(p.when, state));
    if (portal) {
      return applyEffect(c, state, { type: "teleport", mapId: portal.targetMapId, x: portal.targetX, y: portal.targetY, ...(portal.facing ? { facing: portal.facing } : {}) });
    }
    const touch = visibleInteractables(state, map).find(item => item.trigger === "touch" && item.x === to.x && item.y === to.y);
    if (touch) {
      const event = content.events[touch.event];
      if (event) return runQueue(c, runEvent(c, state, event));
    }
    if (map.encounters && map.encounters.rate > 0) {
      const code = Array.from(map.rows[to.y] ?? "")[to.x] ?? "";
      if (!map.encounters.tiles.length || map.encounters.tiles.includes(code)) {
        let roll: number;
        [roll, state] = random(state);
        if (roll < map.encounters.rate) {
          let pick: number;
          [pick, state] = random(state);
          const enemy = map.encounters.enemies[Math.floor(pick * map.encounters.enemies.length)]!;
          return startBattle(c, state, { type: "battle", enemy, onDefeat: "respawn" });
        }
      }
    }
    return state;
  }

  function interact(c: Ctx, state: GameState): GameState {
    const map = content.maps[state.mapId];
    if (!map) return state;
    const front = { x: state.player.x + DELTAS[state.player.facing].x, y: state.player.y + DELTAS[state.player.facing].y };
    const npc = visibleNpcs(state, map).find(n => n.x === front.x && n.y === front.y);
    if (npc) {
      const entry = npc.dialogues.find(d => evaluate(d.when, state));
      if (!entry) return state;
      c.log.push(`${npc.name}に話しかけた`);
      return runQueue(c, enqueue(state, [{ type: "dialogue", dialogue: entry.dialogue }]));
    }
    const items = visibleInteractables(state, map).filter(i => i.trigger === "action");
    const target = items.find(i => i.x === front.x && i.y === front.y) ?? items.find(i => i.x === state.player.x && i.y === state.player.y);
    if (target) {
      const event = content.events[target.event];
      if (!event) throw new Error(`イベント '${target.event}' がありません`);
      return runQueue(c, runEvent(c, state, event));
    }
    return state;
  }

  function useFieldItem(c: Ctx, state: GameState, itemId: string): GameState {
    const item = content.database.items.find(i => i.id === itemId);
    if (!item?.heal || !(state.items[itemId] ?? 0)) return state;
    if (state.player.hp >= state.player.stats.maxHp) return { ...state, scene: { kind: "message", text: "HPは満タンだ。" } };
    const hp = Math.min(state.player.stats.maxHp, state.player.hp + item.heal);
    const items = { ...state.items };
    if ((items[itemId] ?? 0) > 1) items[itemId] = items[itemId]! - 1; else delete items[itemId];
    c.log.push(`${item.name}を使用`);
    return { ...state, items, player: { ...state.player, hp }, scene: { kind: "message", text: `${item.name}を使った。HPが${hp - state.player.hp}回復した。` } };
  }

  function step(state: GameState, action: Action): StepResult {
    const c = ctx();
    let next = state;
    const scene = state.scene;
    switch (action.type) {
      case "move":
        if (scene.kind === "field") next = move(c, state, action.direction);
        break;
      case "face":
        if (scene.kind === "field") next = { ...state, player: { ...state.player, facing: action.direction } };
        break;
      case "interact":
        if (scene.kind !== "field") return step(state, { type: "advance" });
        next = interact(c, state);
        break;
      case "useItem":
        if (scene.kind === "field") next = useFieldItem(c, state, action.item);
        break;
      case "advance":
        if (scene.kind === "message") next = runQueue(c, { ...state, scene: { kind: "field" } });
        else if (scene.kind === "dialogue") {
          const dialogue = content.dialogues[scene.dialogueId]!;
          if (scene.line + 1 < dialogue.lines.length) next = { ...state, scene: { ...scene, line: scene.line + 1 } };
          else if (dialogue.choices.some(choice => evaluate(choice.when, state))) next = { ...state, scene: { kind: "choice", dialogueId: dialogue.id } };
          else next = runQueue(c, enqueue({ ...state, scene: { kind: "field" } }, dialogue.effects));
        } else if (scene.kind === "battle") next = closeBattle(c, state);
        break;
      case "choose": {
        if (scene.kind !== "choice") break;
        const dialogue = content.dialogues[scene.dialogueId]!;
        const choice = dialogue.choices.find(item => item.id === action.choiceId && evaluate(item.when, state));
        if (!choice) break;
        const key = `${dialogue.id}/${choice.id}`;
        let effects = choice.effects;
        if (choice.once) {
          if (state.done.includes(key)) { effects = []; c.log.push(`選択肢 ${key} は実行済みのため報酬を重複させません`); }
          else effects = [...choice.effects, { type: "markDone", id: key }];
        }
        next = runQueue(c, enqueue({ ...state, scene: { kind: "field" } }, effects));
        break;
      }
      case "battle":
        next = battleStep(c, state, action);
        break;
    }
    return { state: next, log: c.log, cues: c.cues };
  }

  function run(state: GameState, effects: Effect[]): StepResult {
    const c = ctx();
    const next = runQueue(c, enqueue(state, effects));
    return { state: next, log: c.log, cues: c.cues };
  }

  return {
    content,
    systems: sorted,
    newGame,
    step,
    run,
    isPassable: (state, x, y) => isPassable(state, x, y),
    tileAt,
    tileIndex: (state, tile) => (tile.openIndex !== undefined && tile.passableWhen && evaluate(tile.passableWhen, state) ? tile.openIndex : tile.index),
    visibleNpcs,
    visibleInteractables,
  };
}

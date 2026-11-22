import type {
  BattleState, Direction, Effect, Expr, Enemy, Entity, EntityState, GameContent, GameEvent, GameMap, GameState, Interactable, Npc, Rule, RuleTrigger,
  ScriptRef, Stats, TileDef, Use,
} from "../../schema/src/formats";
import { abilitiesOf, effectiveStats, evalExpr, evaluate, interpolate, itemActive, nextRandom, regionsAt, type EvalEnv, type FrontInfo } from "./conditions";
import { bindScript, sortSystems, type GameSystem, type PlayerAction, type SceneInput, type ScriptCommand, type ScriptSelf, type SystemActionResult } from "./systems";

/** Values that survive a new cycle (meta-scoped flags, variables, sets, endings seen, cycle number). */
export interface MetaState {
  cycle: number;
  flags: Record<string, boolean>;
  vars: Record<string, number>;
  sets: Record<string, string[]>;
}

export interface EntityView {
  entity: Entity;
  state: EntityState;
  index: number;
  x: number;
  y: number;
  facing: Direction;
}

export type BattleCommand =
  | { command: "attack"; target?: number }
  | { command: "guard" }
  | { command: "flee" }
  | { command: "item"; item: string }
  | { command: "skill"; ability: string }
  /** Tell a companion what to do this turn (does not use the hero's turn). */
  | { command: "order"; companion: string; action: number }
  /** A command added by a script (engine.commands(state, "battle")). */
  | { command: "script"; source: string; id: string };

export type Action =
  | { type: "move"; direction: Direction }
  | { type: "face"; direction: Direction }
  | { type: "interact" }
  | { type: "advance" }
  | { type: "choose"; choiceId: string }
  | ({ type: "battle" } & BattleCommand)
  | { type: "useItem"; item: string }
  | { type: "useAbility"; ability: string }
  /** Advance the world clock: entities move, tick rules and systems run. */
  | { type: "tick" }
  | { type: "sceneInput"; input: SceneInput }
  /** A self-made verb from project.json › verbs. */
  | { type: "verb"; verb: string }
  /** Equip an item (or take it off if it is already equipped). Field only. */
  | { type: "equip"; item: string; companion?: string }
  /** A field command added by a script (engine.commands(state, "field")). */
  | { type: "command"; source: string; id: string };

/** Presentation hints for the runtime (sound, animation). Never needed for correctness. */
export type Cue =
  | { kind: "moved"; from: { x: number; y: number } }
  | { kind: "bump" }
  | { kind: "mapChanged"; from: string }
  | { kind: "battleStart"; enemyId: string }
  | { kind: "hit"; target: "player" | "enemy"; amount: number }
  | { kind: "battleEnd"; outcome: BattleState["outcome"] }
  | { kind: "sfx"; sound: string }
  | { kind: "item" }
  | { kind: "heal" }
  | { kind: "levelUp"; level: number };

export interface StepResult {
  state: GameState;
  log: string[];
  cues: Cue[];
}

export interface Usable {
  id: string;
  name: string;
  kind: "ability" | "item";
  use: Use;
  /** Why it can't be used right now (cost, condition); undefined when usable. */
  blocked?: string;
  count?: number;
}

export const DELTAS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};

interface Ctx {
  log: string[];
  cues: Cue[];
  /** Nesting of signal effects (guards against signals that fire each other forever). */
  signalDepth?: number;
}

export interface Engine {
  readonly content: GameContent;
  readonly systems: readonly GameSystem[];
  newGame(seed?: number, meta?: MetaState): GameState;
  /** Values to keep across cycles / store as the "memory" of the game. */
  metaOf(state: GameState): MetaState;
  visibleEntities(state: GameState, map?: GameMap): EntityView[];
  regions(state: GameState): string[];
  /** HUD lines from systems. */
  hudLines(state: GameState): string[];
  /** Level, experience and what the next level needs (undefined without project.leveling). */
  levelInfo(state: GameState): { level: number; exp: number; next: number | null } | undefined;
  /** Project systems plus the scripts attached to whatever is active right now (abilities, items, enemies, map…). */
  activeSystems(state: GameState): GameSystem[];
  /** Commands that active scripts add to the battle or field menu. `source` identifies the script for the action. */
  commands(state: GameState, where: "battle" | "field"): Array<ScriptCommand & { source: string }>;
  /** Self-made verbs usable right now (known / learned, not forgotten, `when` holds). */
  usableVerbs(state: GameState): string[];
  /** A companion's stats including its equipment. */
  companionStats(state: GameState, id: string): Stats;
  step(state: GameState, action: Action): StepResult;
  /** Run arbitrary effects (tests, studio debug console, system code). */
  run(state: GameState, effects: Effect[]): StepResult;
  isPassable(state: GameState, x: number, y: number): boolean;
  /** Authored tile (editor). */
  tileAt(map: GameMap, x: number, y: number): TileDef | undefined;
  /** Tile code after overlays and setTile changes. */
  codeAt(state: GameState, map: GameMap, x: number, y: number): string;
  /** Map rows after overlays and setTile changes (for drawing). */
  rowsFor(state: GameState, mapId: string): string[];
  /** Atlas index to draw for a tile in the current state (handles opened gates). */
  tileIndex(state: GameState, tile: TileDef): number;
  visibleNpcs(state: GameState, map?: GameMap): Npc[];
  visibleInteractables(state: GameState, map?: GameMap): Interactable[];
  /** Dialogue lines that are visible in this state, with {{templates}} filled in. */
  dialogueLines(state: GameState, dialogueId: string): string[];
  stats(state: GameState): Stats;
  abilities(state: GameState): string[];
  usables(state: GameState, where: "battle" | "field"): Usable[];
  text(state: GameState, template: string): string;
  evaluate: (condition: Parameters<typeof evaluate>[0], state: GameState) => boolean;
}

const DEFAULT_SEED = 20261114;

export function createEngine(content: GameContent, systems: readonly GameSystem[] = []): Engine {
  const sorted = sortSystems(systems);
  const tiles = new Map(content.tileset.tiles.map(tile => [tile.code, tile]));
  const env: EvalEnv = { content, systems: sorted, front: state => frontInfo(state) };
  const db = content.database;
  const ev = (cond: Parameters<typeof evaluate>[0], state: GameState, extra?: EvalEnv["ctx"]) => evaluate(cond, state, extra ? { ...env, ctx: extra } : env);
  const ex = (expr: Parameters<typeof evalExpr>[0], state: GameState, extra?: EvalEnv["ctx"]) => evalExpr(expr, state, extra ? { ...env, ctx: extra } : env);
  const text = (template: string, state: GameState, extra?: EvalEnv["ctx"]) => interpolate(template, state, extra ? { ...env, ctx: extra } : env);
  const stats = (state: GameState) => effectiveStats(state, content);
  const companionOf = (id: string) => db.companions.find(x => x.id === id);
  /** A companion's stats with its equipment (items' statMods, evaluated like the hero's). */
  function companionStats(state: GameState, id: string): Stats {
    const comp = companionOf(id);
    const base = { ...(comp?.stats ?? { maxHp: 1, attack: 0, defense: 0 }) };
    const member = state.party?.find(m => m.id === id);
    for (const itemId of Object.values(member?.equipment ?? {})) {
      const mods = db.items.find(i => i.id === itemId)?.statMods;
      if (!mods) continue;
      for (const key of ["maxHp", "attack", "defense"] as const) if (mods[key] !== undefined) base[key] += evalExpr(mods[key]!, state, { content, baseStats: true });
    }
    return { maxHp: Math.max(1, base.maxHp), attack: Math.max(0, base.attack), defense: Math.max(0, base.defense) };
  }
  /** Who holds this item equipped: "hero" and/or companion ids. */
  const holdersOf = (state: GameState, itemId: string) => [...(Object.values(state.equipment ?? {}).includes(itemId) ? ["hero"] : []), ...(state.party ?? []).filter(m => Object.values(m.equipment ?? {}).includes(itemId)).map(m => m.id)];
  function takeOff(state: GameState, holder: string, itemId: string): GameState {
    if (holder === "hero") return { ...state, equipment: Object.fromEntries(Object.entries(state.equipment ?? {}).filter(([, i]) => i !== itemId)) };
    return { ...state, party: state.party!.map(m => (m.id === holder ? { ...m, equipment: Object.fromEntries(Object.entries(m.equipment ?? {}).filter(([, i]) => i !== itemId)) } : m)) };
  }
  const enemyOf = (id: string): Enemy => {
    const enemy = db.enemies.find(e => e.id === id);
    if (!enemy) throw new Error(`敵 '${id}' がデータベースにありません`);
    return enemy;
  };
  const itemName = (id: string) => db.items.find(i => i.id === id)?.name ?? id;
  const abilityName = (id: string) => db.abilities.find(a => a.id === id)?.name ?? id;

  /* ---------------------------------------------------------------- map queries */
  const tileAt = (map: GameMap, x: number, y: number) => tiles.get(Array.from(map.rows[y] ?? "")[x] ?? "");

  function codeAt(state: GameState, map: GameMap, x: number, y: number): string {
    const override = state.tileOverrides?.[map.id]?.[`${x},${y}`];
    if (override) return override;
    for (let i = map.overlays.length - 1; i >= 0; i--) {
      const overlay = map.overlays[i]!;
      const cell = overlay.cells.find(c => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
      if (cell && ev(overlay.when, state)) return cell.code;
    }
    return Array.from(map.rows[y] ?? "")[x] ?? "";
  }

  function rowsFor(state: GameState, mapId: string): string[] {
    const map = content.maps[mapId];
    if (!map) return [];
    const overrides = state.tileOverrides?.[mapId];
    const active = map.overlays.filter(o => ev(o.when, state));
    if (!active.length && !overrides) return map.rows;
    const grid = map.rows.map(row => Array.from(row));
    for (const overlay of active) for (const c of overlay.cells) {
      for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) if (grid[y]?.[x] !== undefined) grid[y]![x] = c.code;
    }
    for (const [key, code] of Object.entries(overrides ?? {})) {
      const [x, y] = key.split(",").map(Number);
      if (grid[y!]?.[x!] !== undefined) grid[y!]![x!] = code;
    }
    return grid.map(row => row.join(""));
  }

  const visibleNpcs = (state: GameState, map = content.maps[state.mapId]) => (map?.npcs ?? []).filter(npc => ev(npc.visibleWhen, state));
  const visibleInteractables = (state: GameState, map = content.maps[state.mapId]) => (map?.interactables ?? []).filter(item => ev(item.visibleWhen, state));

  /** Which map each entity is defined on (entities can later move to other maps). */
  const entityHome = new Map<string, string>();
  for (const m of Object.values(content.maps)) for (const e of m.entities) if (!entityHome.has(e.id)) entityHome.set(e.id, m.id);

  function visibleEntities(state: GameState, map = content.maps[state.mapId]): EntityView[] {
    if (!map) return [];
    const out: EntityView[] = [];
    const add = (entity: Entity, home: string) => {
      if (state.carrying?.id === entity.id && state.carrying.home === home) return;
      const index = entity.states.findIndex(st => ev(st.when, state));
      if (index < 0) return;
      const st = entity.states[index]!;
      const pos = state.entities?.[home]?.[entity.id];
      out.push({ entity, state: st, index, x: pos?.x ?? entity.x, y: pos?.y ?? entity.y, facing: pos?.facing ?? st.facing ?? "down" });
    };
    for (const entity of map.entities) { const away = state.entities?.[map.id]?.[entity.id]?.map; if (!away || away === map.id) add(entity, map.id); }
    // Entities from other maps that were moved / carried here.
    for (const [home, moved] of Object.entries(state.entities ?? {})) {
      if (home === map.id) continue;
      for (const [id, pos] of Object.entries(moved)) if (pos.map === map.id) { const e = content.maps[home]?.entities.find(x => x.id === id); if (e) add(e, home); }
    }
    return out;
  }
  /** Writes an entity's position (home = the map that defines it, map = where it is now). */
  function placeEntity(state: GameState, id: string, home: string, x: number, y: number, facing: Direction, map: string): GameState {
    const pos = { x, y, facing, ...(map !== home ? { map } : {}) };
    return { ...state, entities: { ...state.entities, [home]: { ...state.entities[home], [id]: pos } } };
  }

  /* ---------------------------------------------------------------- attached scripts */
  const globalSystems = sorted.filter(s => s.scope !== "attached");
  const byId = new Map(sorted.map(s => [s.id, s]));
  const hasAttached = sorted.some(s => s.scope === "attached");
  const boundCache = new Map<string, GameSystem>();
  const activeCache = new WeakMap<GameState, GameSystem[]>();
  const refOf = (ref: ScriptRef | undefined) => (ref === undefined ? undefined : typeof ref === "string" ? { id: ref, args: {} as Record<string, unknown> } : { id: ref.id, args: ref.args ?? {} });
  function attach(out: GameSystem[], ref: ScriptRef | undefined, kind: ScriptSelf["kind"], id: string, index?: number) {
    const r = refOf(ref);
    const system = r && byId.get(r.id);
    if (!r || !system) return;
    const key = index !== undefined ? `${r.id}@${kind}:${id}#${index}` : `${r.id}@${kind}:${id}`;
    if (out.some(s => s.id === key)) return;
    let bound = boundCache.get(key);
    if (!bound) { bound = bindScript(system, { kind, id, args: r.args, ...(index !== undefined ? { index } : {}) }, key); boundCache.set(key, bound); }
    out.push(bound);
  }
  /** Global systems + scripts attached to what is active in this state (cached per state object). */
  function active(state: GameState): GameSystem[] {
    if (!hasAttached) return globalSystems;
    const cached = activeCache.get(state);
    if (cached) return cached;
    const extra: GameSystem[] = [];
    for (const id of abilitiesOf(state, content)) attach(extra, db.abilities.find(a => a.id === id)?.script, "ability", id);
    for (const id of state.traits ?? []) attach(extra, db.traits.find(t => t.id === id)?.script, "trait", id);
    for (const id of Object.keys(state.items)) { const item = db.items.find(i => i.id === id); if (item && itemActive(state, item)) attach(extra, item.script, "item", id); }
    for (const member of state.party ?? []) attach(extra, db.companions.find(x => x.id === member.id)?.script, "companion", member.id);
    attach(extra, content.maps[state.mapId]?.script, "map", state.mapId);
    for (const view of visibleEntities(state)) attach(extra, view.state.script, "entity", view.entity.id);
    const here = content.maps[state.mapId];
    if (here) {
      for (const npc of visibleNpcs(state, here)) attach(extra, npc.script, "npc", npc.id);
      for (const item of visibleInteractables(state, here)) attach(extra, item.script, "interactable", item.id);
      for (const id of state.regions) attach(extra, here.regions.find(r => r.id === id)?.script, "region", id);
    }
    const battle = state.scene.kind === "battle" ? state.scene.battle : undefined;
    if (battle) {
      const slots = [{ id: battle.enemyId, slot: battle.slot ?? 0 }, ...(battle.foes ?? []).map((f, k) => ({ id: f.enemyId, slot: f.slot ?? k + 1 }))];
      for (const { id: eid, slot } of slots) attach(extra, db.enemies.find(e => e.id === eid)?.script, "enemy", eid, slot);
    }
    const list = extra.length ? sortSystems([...globalSystems, ...extra]) : globalSystems;
    activeCache.set(state, list);
    return list;
  }
  /** Scripts attached to an enemy / companion only steer their own turns. */
  /** For enemies, `slot` is the start-of-battle position of the enemy that is acting now. */
  const steers = (system: GameSystem, kind: "enemy" | "companion", id: string, slot?: number) => {
    const self = system.scope === "attached" ? boundSelf(system) : undefined;
    if (!self || (self.kind !== "enemy" && self.kind !== "companion")) return true;
    if (self.kind !== kind || self.id !== id) return false;
    return kind !== "enemy" || self.index === undefined || self.index === (slot ?? 0);
  };
  const boundSelf = (system: GameSystem): ScriptSelf | undefined => {
    const at = system.id.indexOf("@");
    if (at < 0) return undefined;
    const [kind, ...rest] = system.id.slice(at + 1).split(":");
    const raw = rest.join(":");
    const hash = raw.lastIndexOf("#");
    const index = hash >= 0 && /^\d+$/.test(raw.slice(hash + 1)) ? Number(raw.slice(hash + 1)) : undefined;
    const id = index !== undefined ? raw.slice(0, hash) : raw;
    return { kind: kind as ScriptSelf["kind"], id, args: {}, ...(index !== undefined ? { index } : {}) };
  };
  function scriptCommands(state: GameState, where: "battle" | "field"): Array<ScriptCommand & { source: string }> {
    const out: Array<ScriptCommand & { source: string }> = [];
    for (const system of active(state)) {
      for (const cmd of system.commands?.({ content, state, where }) ?? []) {
        const w = cmd.where ?? "both";
        if (w === "both" || w === where) out.push({ ...cmd, source: system.id });
      }
    }
    return out;
  }
  /** Runs a script command. Returns undefined when it does not exist or is blocked (with a message for the player). */
  function runCommand(c: Ctx, state: GameState, source: string, id: string, where: "battle" | "field"): [GameState, ScriptCommand] | string {
    const cmd = scriptCommands(state, where).find(x => x.source === source && x.id === id);
    if (!cmd) return "そのコマンドは使えない。";
    if (cmd.blocked) return cmd.blocked;
    const system = active(state).find(s => s.id === source)!;
    const fn = id === "use" ? system.use : system.actions?.[id];
    if (!fn) throw new Error(`スクリプト '${source}' に '${id}' がありません`);
    const result = fn({ content, state }, cmd.args ?? {});
    if (result) { c.log.push(...(result.log ?? [])); state = result.state ?? state; state = runNow(c, state, result.effects ?? []); }
    return [state, cmd];
  }
  /** Applies a hook result right away (battle: effects must happen inside the turn). */
  function applyNow(c: Ctx, state: GameState, result: SystemActionResult | void): GameState {
    if (!result) return state;
    c.log.push(...(result.log ?? []));
    return runNow(c, result.state ?? state, result.effects ?? []);
  }
  /** Ability / item that has a script with `use`: usable even without data effects. */
  const scriptUse = (ref: ScriptRef | undefined): Use | undefined => {
    const r = refOf(ref);
    return r && byId.get(r.id)?.use ? { where: "both", cost: [], effects: [], consume: false } : undefined;
  };
  const useEffectOf = (ref: ScriptRef | undefined, kind: "ability" | "item", id: string): Effect[] => {
    const r = refOf(ref);
    return r && byId.get(r.id)?.use ? [{ type: "script", script: r.id, args: r.args, from: { kind, id, args: r.args } } as unknown as Effect] : [];
  };

  /** Tile-only passability (no actors). */
  function tilePassable(state: GameState, map: GameMap, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    const tile = tiles.get(codeAt(state, map, x, y));
    return Boolean(tile && (tile.passable || (tile.passableWhen && ev(tile.passableWhen, state))));
  }

  function isPassable(state: GameState, x: number, y: number, map = content.maps[state.mapId]): boolean {
    if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    const tile = tiles.get(codeAt(state, map, x, y));
    let passable = tilePassable(state, map, x, y);
    if (passable && visibleNpcs(state, map).some(npc => npc.x === x && npc.y === y)) passable = false;
    if (passable && visibleEntities(state, map).some(e => e.state.solid && e.x === x && e.y === y)) passable = false;
    if (passable && visibleInteractables(state, map).some(item => item.solid && item.trigger === "action" && item.x === x && item.y === y)) passable = false;
    for (const system of active(state)) {
      const override = system.canPass?.({ content, state, map, x, y, tile, passable });
      if (typeof override === "boolean") passable = override;
    }
    return passable;
  }

  function dialogueLines(state: GameState, dialogueId: string): string[] {
    const dialogue = content.dialogues[dialogueId];
    if (!dialogue) return [];
    const lines = dialogue.lines.filter(line => typeof line === "string" || ev(line.when, state)).map(line => text(typeof line === "string" ? line : line.text, state));
    return lines.length ? lines : ["……"];
  }

  /* ---------------------------------------------------------------- state helpers */
  const random = (state: GameState): [number, GameState] => {
    const [value, rng] = nextRandom(state.rng);
    return [value, { ...state, rng }];
  };
  const enqueue = (state: GameState, effects: Effect[]): GameState => (effects.length ? { ...state, queue: [...effects, ...state.queue] } : state);
  const battleOf = (state: GameState) => (state.scene.kind === "battle" ? state.scene.battle : null);
  const setBattle = (state: GameState, battle: BattleState): GameState => ({ ...state, scene: { kind: "battle", battle } });
  const battleLog = (state: GameState, ...lines: string[]): GameState => {
    const battle = battleOf(state);
    return battle ? setBattle(state, { ...battle, log: [...battle.log, ...lines].slice(-10) }) : state;
  };
  const clampVar = (id: string, value: number) => {
    const decl = content.project.variables[id];
    let v = Math.trunc(value);
    if (decl?.min !== undefined) v = Math.max(decl.min, v);
    if (decl?.max !== undefined) v = Math.min(decl.max, v);
    return v;
  };
  const applyOp = (current: number, op: string | undefined, value: number) => {
    switch (op ?? "set") {
      case "add": return current + value;
      case "sub": return current - value;
      case "mul": return current * value;
      case "div": return value === 0 ? current : Math.floor(current / value);
      case "min": return Math.min(current, value);
      case "max": return Math.max(current, value);
      default: return value;
    }
  };

  /* ---------------------------------------------------------------- rules */
  interface ActiveRule { key: string; rule: Rule; source: string }

  function rulesFor(state: GameState, trigger: RuleTrigger): ActiveRule[] {
    const out: ActiveRule[] = [];
    const add = (prefix: string, source: string, list: Rule[]) => { for (const rule of list) if (rule.on === trigger) out.push({ key: `${prefix}:${rule.id}`, rule, source }); };
    add("g", "全体", content.rules);
    for (const id of abilitiesOf(state, content)) { const a = db.abilities.find(x => x.id === id); if (a) add(`a:${id}`, a.name, a.rules); }
    for (const id of state.traits ?? []) { const t = db.traits.find(x => x.id === id); if (t) add(`t:${id}`, t.name, t.rules); }
    for (const id of Object.keys(state.items)) { const i = db.items.find(x => x.id === id); if (i && itemActive(state, i)) add(`i:${id}`, i.name, i.rules); }
    const battle = battleOf(state);
    if (battle) { const e = db.enemies.find(x => x.id === battle.enemyId); if (e) add(`e:${e.id}`, e.name, e.rules); }
    return out.sort((a, b) => a.rule.priority - b.rule.priority || a.key.localeCompare(b.key));
  }

  const firedKey = (entry: ActiveRule) => entry.rule.once === "map" ? `map:${entry.key}` : `game:${entry.key}`;
  function alreadyFired(state: GameState, entry: ActiveRule): boolean {
    const once = entry.rule.once;
    if (!once) return false;
    if (once === "battle") return Boolean(battleOf(state)?.fired.includes(entry.key));
    return state.fired.includes(firedKey(entry));
  }
  function markFired(state: GameState, entry: ActiveRule): GameState {
    const once = entry.rule.once;
    if (!once) return state;
    if (once === "battle") { const b = battleOf(state); return b ? setBattle(state, { ...b, fired: [...b.fired, entry.key] }) : state; }
    return { ...state, fired: [...state.fired, firedKey(entry)] };
  }
  /** Checks once / when / chance. Returns the (rng-advanced) state when the rule fires, else null. */
  function tryRule(c: Ctx, state: GameState, entry: ActiveRule, ctxValues?: EvalEnv["ctx"]): GameState | null {
    if (alreadyFired(state, entry) || !ev(entry.rule.when, state, ctxValues)) return null;
    if (entry.rule.chance !== undefined) {
      const percent = ex(entry.rule.chance, state, ctxValues);
      let roll: number;
      [roll, state] = random(state);
      if (roll * 100 >= percent) return null;
    }
    c.log.push(`ルール発動: ${entry.source} / ${entry.rule.id}`);
    return markFired(state, entry);
  }

  /** Field triggers (step, mapEnter): queue the effects of every rule that fires. */
  function fireFieldRules(c: Ctx, state: GameState, trigger: RuleTrigger, match?: string): GameState {
    const collected: Effect[] = [];
    for (const entry of rulesFor(state, trigger)) {
      if (entry.rule.match !== undefined && entry.rule.match !== match) continue;
      const next = tryRule(c, state, entry);
      if (!next) continue;
      state = next;
      collected.push(...entry.rule.effects);
    }
    return enqueue(state, collected);
  }

  /** Auto rules: fire when their condition becomes true (once per game unless `repeat`). */
  function runAuto(c: Ctx, state: GameState): GameState {
    for (let guard = 0; guard < 50; guard++) {
      if (state.scene.kind !== "field" || state.queue.length) return state;
      let fired = false;
      for (const entry of rulesFor(state, "auto")) {
        const key = `auto:${entry.key}`;
        const holds = ev(entry.rule.when, state);
        if (state.fired.includes(key)) {
          if (entry.rule.repeat && !holds) state = { ...state, fired: state.fired.filter(k => k !== key) };
          continue;
        }
        if (!holds) continue;
        if (entry.rule.chance !== undefined) {
          let roll: number;
          [roll, state] = random(state);
          if (roll * 100 >= ex(entry.rule.chance, state)) continue;
        }
        c.log.push(`ルール発動: ${entry.source} / ${entry.rule.id}`);
        state = runQueue(c, enqueue({ ...state, fired: [...state.fired, key] }, entry.rule.effects));
        fired = true;
        break;
      }
      if (!fired) return state;
    }
    throw new Error("autoルールが50回連続で発動しました。条件がずっと成り立ち続けるrepeatルールがないか確認してください");
  }

  /* ---------------------------------------------------------------- effects */
  function runQueue(c: Ctx, state: GameState): GameState {
    let guard = 0;
    while (state.scene.kind === "field" && state.queue.length) {
      if (++guard > 2000) throw new Error("効果キューが2000件を超えました。会話やイベントが自分自身を無限に呼んでいないか確認してください");
      const [effect, ...rest] = state.queue;
      state = applyEffect(c, { ...state, queue: rest }, effect!);
    }
    return state;
  }

  /** In battle every effect runs immediately; field-only ones (dialogue, teleport, choice, battle) wait until the battle ends. */
  function runNow(c: Ctx, state: GameState, effects: Effect[], ctxValues?: EvalEnv["ctx"]): GameState {
    for (const effect of effects) state = applyEffect(c, state, effect, ctxValues);
    return state;
  }

  /** Keeps a "full HP" player full when max HP grows, and clamps HP when it shrinks. */
  function withHpCare(state: GameState, change: (s: GameState) => GameState): GameState {
    const before = stats(state).maxHp;
    const next = change(state);
    const after = stats(next).maxHp;
    if (after === before && next.player.hp <= after) return next;
    const hp = next.player.hp >= before ? Math.max(next.player.hp, after) : next.player.hp;
    return { ...next, player: { ...next.player, hp: Math.min(after, hp) } };
  }

  function applyEffect(c: Ctx, state: GameState, effect: Effect, ctxValues?: EvalEnv["ctx"]): GameState {
    const inBattle = state.scene.kind === "battle";
    /** While a custom scene is open, effects apply immediately; text and screens wait until it closes. */
    const inScene = state.scene.kind === "custom";
    const immediate = inBattle || inScene;
    switch (effect.type) {
      case "message":
      case "battleLog": {
        const line = text(effect.text, state, ctxValues);
        if (inBattle) return battleLog(state, line);
        if (inScene) return { ...state, queue: [...state.queue, { ...effect, type: "message", text: line } as Effect] };
        return { ...state, scene: { kind: "message", text: line, ...(effect.type === "message" && effect.speaker ? { speaker: effect.speaker } : {}) } };
      }
      case "setFlag":
        c.log.push(`フラグ ${effect.flag} = ${effect.value ?? true}`);
        return { ...state, flags: { ...state.flags, [effect.flag]: effect.value ?? true } };
      case "setVar": {
        const current = ex({ var: effect.var }, state, ctxValues);
        const value = clampVar(effect.var, applyOp(current, effect.op, ex(effect.value, state, ctxValues)));
        c.log.push(`変数 ${effect.var} = ${value}`);
        return { ...state, vars: { ...state.vars, [effect.var]: value } };
      }
      case "random": {
        const lo = ex(effect.min, state, ctxValues), hi = ex(effect.max, state, ctxValues);
        let roll: number;
        [roll, state] = random(state);
        const value = clampVar(effect.var, Math.min(lo, hi) + Math.floor(roll * (Math.abs(hi - lo) + 1)));
        return { ...state, vars: { ...state.vars, [effect.var]: value } };
      }
      case "chance": {
        let roll: number;
        [roll, state] = random(state);
        const branch = roll * 100 < ex(effect.percent, state, ctxValues) ? effect.then : effect.else ?? [];
        return immediate ? runNow(c, state, branch, ctxValues) : enqueue(state, branch);
      }
      case "if": {
        const branch = ev(effect.when, state, ctxValues) ? effect.then : effect.else ?? [];
        return immediate ? runNow(c, state, branch, ctxValues) : enqueue(state, branch);
      }
      case "setStat":
        return withHpCare(state, s => {
          const value = Math.max(effect.stat === "maxHp" ? 1 : 0, applyOp(s.player.stats[effect.stat], effect.op, ex(effect.value, s, ctxValues)));
          c.log.push(`基本能力 ${effect.stat} = ${value}`);
          return { ...s, player: { ...s.player, stats: { ...s.player.stats, [effect.stat]: value } } };
        });
      case "unlockAbility":
        if (state.abilities.includes(effect.ability)) return state;
        c.log.push(`能力「${abilityName(effect.ability)}」を習得`);
        return withHpCare(state, s => ({ ...s, abilities: [...s.abilities, effect.ability] }));
      case "removeAbility":
        return withHpCare(state, s => ({ ...s, abilities: s.abilities.filter(a => a !== effect.ability) }));
      case "grantTrait": {
        if (state.traits.includes(effect.trait)) return state;
        const trait = db.traits.find(t => t.id === effect.trait);
        c.log.push(`特性「${trait?.name ?? effect.trait}」を得た`);
        state = withHpCare(state, s => ({ ...s, traits: [...s.traits, effect.trait] }));
        const gifts = trait?.onGrant ?? [];
        return immediate ? runNow(c, state, gifts, ctxValues) : enqueue(state, gifts);
      }
      case "removeTrait":
        return withHpCare(state, s => ({ ...s, traits: s.traits.filter(t => t !== effect.trait) }));
      case "giveItem": {
        const count = effect.count ?? 1;
        c.log.push(`${itemName(effect.item)} ×${count} を入手`);
        c.cues.push({ kind: "item" });
        return withHpCare(state, s => ({ ...s, items: { ...s.items, [effect.item]: (s.items[effect.item] ?? 0) + count } }));
      }
      case "takeItem":
        return withHpCare(state, s => {
          const left = (s.items[effect.item] ?? 0) - (effect.count ?? 1);
          const items = { ...s.items };
          if (left > 0) items[effect.item] = left; else delete items[effect.item];
          // Giving away the last one takes it off.
          const equipment = left > 0 ? s.equipment : Object.fromEntries(Object.entries(s.equipment ?? {}).filter(([, item]) => item !== effect.item));
          const party = left > 0 || !s.party ? s.party : s.party.map(m => ({ ...m, equipment: Object.fromEntries(Object.entries(m.equipment ?? {}).filter(([, item]) => item !== effect.item)) }));
          return { ...s, items, ...(equipment ? { equipment } : {}), ...(party ? { party } : {}) };
        });
      case "addStatus": {
        const target = effect.target ?? (inBattle ? "enemy" : "player");
        if (effect.chance !== undefined) {
          let roll: number;
          [roll, state] = random(state);
          if (roll * 100 >= ex(effect.chance, state, ctxValues)) return inBattle ? battleLog(state, `${statusLabel(effect.status)}は効かなかった。`) : state;
        }
        if (target === "player" || target === "party") return giveStatus(state, "player", effect.status, effect.turns);
        const b = battleOf(state);
        if (!b) return state;
        if (target === "enemy") return giveStatus(state, curSlot(state), effect.status, effect.turns);
        for (let i = 0; i < enemyCount(b); i++) if (enemyHpAt(b, i) > 0) state = giveStatus(state, slotAt(b, i), effect.status, effect.turns);
        return state;
      }
      case "removeStatus": {
        const target = effect.target ?? "player";
        if (target === "player" || target === "party") return dropStatus(state, "player", effect.status, inBattle);
        const b = battleOf(state);
        if (!b) return state;
        if (target === "enemy") return dropStatus(state, curSlot(state), effect.status, true);
        for (let i = 0; i < enemyCount(b); i++) state = dropStatus(state, slotAt(b, i), effect.status, true);
        return state;
      }
      case "gainExp": {
        const amount = Math.max(0, ex(effect.amount, state, ctxValues));
        state = gainExp(c, state, amount, false);
        return state;
      }
      case "heal": {
        const max = stats(state).maxHp;
        const amount = effect.amount === undefined ? max : ex(effect.amount, state, ctxValues);
        if (amount > 0) c.cues.push({ kind: "heal" });
        const target = effect.target ?? "player";
        if (target !== "party") state = { ...state, player: { ...state.player, hp: Math.max(0, Math.min(max, state.player.hp + amount)) } };
        if (target !== "player" && state.party) state = { ...state, party: state.party.map(m => { const cmax = companionStats(state, m.id).maxHp; return { ...m, hp: Math.max(0, Math.min(cmax, m.hp + (effect.amount === undefined ? cmax : amount))) }; }) };
        return state;
      }
      case "joinParty": {
        const comp = companionOf(effect.companion);
        if (!comp) throw new Error(`仲間 '${effect.companion}' がいません（database.json の companions）`);
        if (state.party?.some(m => m.id === comp.id)) return state;
        c.log.push(`${comp.name}が仲間に加わった`);
        return { ...state, party: [...(state.party ?? []), { id: comp.id, hp: comp.stats.maxHp }] };
      }
      case "leaveParty":
        return { ...state, party: (state.party ?? []).filter(m => m.id !== effect.companion) };
      case "damage": {
        const rate = effect.element && (effect.target === "player" || battleOf(state)) ? elementRate(state, effect.element, effect.target) : 100;
        const amount = Math.max(0, Math.floor(ex(effect.amount, state, ctxValues) * rate / 100));
        if (rate !== 100 && inBattle) state = battleLog(state, elementNote(rate).trim() || `${content.project.elements[effect.element!]?.label ?? effect.element}（${rate}%）`);
        if (effect.target === "enemy") {
          const battle = battleOf(state);
          if (!battle) return state;
          if (amount > 0) state = dropWakers(state, curSlot(state));
          c.cues.push({ kind: "hit", target: "enemy", amount });
          const now = battleOf(state)!;
          state = setBattle(state, { ...now, enemyHp: Math.max(0, now.enemyHp - amount) });
          return effect.text ? battleLog(state, text(effect.text, state, { ...ctxValues, damage: amount })) : state;
        }
        // Outside battle, damage never knocks the player out.
        const floor = inBattle ? 0 : 1;
        c.cues.push({ kind: "hit", target: "player", amount });
        state = { ...state, player: { ...state.player, hp: Math.max(Math.min(floor, state.player.hp), state.player.hp - amount) } };
        if (!effect.text) return state;
        const line = text(effect.text, state, { ...ctxValues, damage: amount });
        return inBattle ? battleLog(state, line) : enqueue(state, [{ type: "message", text: line }]);
      }
      case "setTile": {
        const mapId = effect.mapId ?? state.mapId;
        return { ...state, tileOverrides: { ...state.tileOverrides, [mapId]: { ...state.tileOverrides[mapId], [`${effect.x},${effect.y}`]: effect.code } } };
      }
      case "markDone":
        return state.done.includes(effect.id) ? state : { ...state, done: [...state.done, effect.id] };
      case "playSfx":
        c.cues.push({ kind: "sfx", sound: effect.sound });
        return state;
      case "playBgm":
        return { ...state, music: effect.music };
      case "signal": {
        const depth = (c.signalDepth ?? 0) + 1;
        if (depth > 32) throw new Error(`シグナル '${effect.signal}' が32段以上連鎖しました。シグナルどうしが無限に呼び合っていないか確認してください`);
        c.log.push(`シグナル: ${effect.signal}`);
        const collected: Effect[] = [];
        for (const entry of rulesFor(state, "signal")) {
          if (entry.rule.match !== effect.signal) continue;
          const next = tryRule(c, state, entry, ctxValues);
          if (!next) continue;
          state = next;
          collected.push(...entry.rule.effects);
        }
        if (!immediate) return enqueue(state, collected);
        c.signalDepth = depth;
        try { return runNow(c, state, collected, ctxValues); } finally { c.signalDepth = depth - 1; }
      }
      case "equip": {
        const item = db.items.find(i => i.id === effect.item);
        if (!item?.slot) throw new Error(`アイテム '${effect.item}' は装備品ではありません（slot がない）`);
        if ((state.items[item.id] ?? 0) <= 0) { c.log.push(`${item.name}を持っていないので装備できない`); return state; }
        const who = effect.companion ?? "hero";
        if (who !== "hero" && !state.party?.some(m => m.id === who)) { c.log.push(`${who} は仲間にいない`); return state; }
        // Only as many people can wear it as there are copies: take it off someone else first.
        const others = holdersOf(state, item.id).filter(h => h !== who);
        if (others.length >= (state.items[item.id] ?? 0)) state = takeOff(state, others[0]!, item.id);
        c.log.push(`${who === "hero" ? "" : `${companionOf(who)?.name ?? who}が`}${item.name}を装備した`);
        if (who === "hero") return withHpCare(state, s => ({ ...s, equipment: { ...s.equipment, [item.slot!]: item.id } }));
        return { ...state, party: state.party!.map(m => (m.id === who ? { ...m, equipment: { ...m.equipment, [item.slot!]: item.id } } : m)) };
      }
      case "unequip": {
        if (effect.companion) {
          return { ...state, party: (state.party ?? []).map(m => (m.id === effect.companion ? { ...m, equipment: Object.fromEntries(Object.entries(m.equipment ?? {}).filter(([slot]) => slot !== effect.slot)) } : m)).map(m => ({ ...m, hp: Math.min(m.hp, companionStats({ ...state, party: state.party }, m.id).maxHp) })) };
        }
        if (!state.equipment?.[effect.slot]) return state;
        const { [effect.slot]: _removed, ...rest } = state.equipment;
        return withHpCare(state, s => ({ ...s, equipment: rest }));
      }
      case "learnVerb":
        return { ...state, verbsLearned: [...new Set([...(state.verbsLearned ?? []), effect.verb])], verbsForgotten: (state.verbsForgotten ?? []).filter(v => v !== effect.verb) };
      case "forgetVerb":
        return { ...state, verbsLearned: (state.verbsLearned ?? []).filter(v => v !== effect.verb), verbsForgotten: [...new Set([...(state.verbsForgotten ?? []), effect.verb])] };
      case "useVerb": {
        if (inBattle || inScene) return { ...state, queue: [...state.queue, effect] };
        const verb = content.project.verbs[effect.verb];
        if (!verb) throw new Error(`動詞 '${effect.verb}' がありません`);
        const target = effect.target;
        const next = target === undefined ? state : { ...state, target };
        const withRules = fireFieldRules(c, next, "verb", effect.verb);
        if (verb.target && target === undefined) return doVerb(c, withRules, effect.verb);
        c.log.push(`動詞: ${verb.label}${target ? `（${target}）` : ""}`);
        return enqueue(withRules, verb.effects);
      }
      case "setPlayer": {
        const player = { ...state.player };
        if (effect.name === null) delete player.name; else if (effect.name !== undefined) player.name = effect.name;
        if (effect.sprite === null) delete player.sprite; else if (effect.sprite !== undefined) player.sprite = effect.sprite;
        c.log.push(`主人公: ${player.name ?? content.project.player.name}${player.sprite ? `（${player.sprite}）` : ""}`);
        return { ...state, player };
      }
      case "event": {
        const event = content.events[effect.event];
        if (!event) throw new Error(`イベント '${effect.event}' がありません`);
        return immediate ? runNow(c, state, eventEffects(c, state, event), ctxValues) : enqueue(state, eventEffects(c, state, event));
      }
      case "endBattle": {
        const battle = battleOf(state);
        if (!battle || battle.outcome !== "ongoing") return state;
        if (effect.outcome === "victory") return setBattle(state, { ...battle, enemyHp: 0 });
        c.cues.push({ kind: "battleEnd", outcome: "fled" });
        return setBattle(state, { ...battle, outcome: "fled" });
      }
      case "system": {
        const system = sorted.find(s => s.id === effect.system);
        const action = system?.actions?.[effect.action];
        if (!action) throw new Error(`システム '${effect.system}' にアクション '${effect.action}' がありません`);
        const result = action({ content, state }, effect.args ?? {});
        c.log.push(...(result.log ?? []));
        state = result.state ?? state;
        return immediate ? runNow(c, state, result.effects ?? [], ctxValues) : enqueue(state, result.effects ?? []);
      }
      case "script": {
        const system = byId.get(effect.script);
        const from = (effect as { from?: ScriptSelf }).from;
        const self: ScriptSelf = from ? { ...from, key: `${effect.script}@${from.kind}:${from.id}` } : { kind: "effect", id: effect.script, args: effect.args ?? {}, key: `${effect.script}@effect` };
        const fn = effect.call ? system?.actions?.[effect.call] : system?.use;
        if (!system || !fn) throw new Error(`スクリプト '${effect.script}' に ${effect.call ? `actions.${effect.call}` : "use"} がありません（scripts/${effect.script}.ts）`);
        const result = fn.call(system, { content, state, self }, effect.args ?? {}) ?? {};
        c.log.push(...(result.log ?? []));
        state = result.state ?? state;
        return immediate ? runNow(c, state, result.effects ?? [], ctxValues) : enqueue(state, result.effects ?? []);
      }
      case "addToSet": {
        const list = state.sets[effect.set] ?? [];
        if (list.includes(effect.value)) return state;
        c.log.push(`集合 ${effect.set} に「${effect.value}」を追加`);
        return { ...state, sets: { ...state.sets, [effect.set]: [...list, effect.value] } };
      }
      case "removeFromSet":
        return { ...state, sets: { ...state.sets, [effect.set]: (state.sets[effect.set] ?? []).filter(v => v !== effect.value) } };
      case "clearSet":
        return { ...state, sets: { ...state.sets, [effect.set]: [] } };
      case "moveEntity": {
        // mapId = the destination map. An entity defined on another map moves there (cross-map).
        const dest = effect.mapId ?? state.mapId;
        const home = content.maps[dest]?.entities.some(e => e.id === effect.entity) ? dest : entityHome.get(effect.entity);
        if (!home) throw new Error(`エンティティ '${effect.entity}' がどのマップにもありません`);
        const facing = effect.facing ?? state.entities[home]?.[effect.entity]?.facing ?? "down";
        const next = placeEntity(state, effect.entity, home, effect.x, effect.y, facing, dest);
        return state.carrying?.id === effect.entity ? { ...next, carrying: undefined } : next;
      }
      case "schedule":
        return { ...state, timers: [...state.timers, { ...(effect.id ? { id: effect.id } : {}), at: state.steps + Math.max(0, ex(effect.after, state, ctxValues)), effects: effect.effects }] };
      case "cancelSchedule":
        return { ...state, timers: state.timers.filter(t => t.id !== effect.id) };
      case "ending": {
        const endings = state.sets.endings ?? [];
        c.log.push(`エンディング「${content.project.endings[effect.ending]?.title ?? effect.ending}」`);
        state = { ...state, sets: { ...state.sets, endings: endings.includes(effect.ending) ? endings : [...endings, effect.ending] } };
        if (inBattle) { const b = battleOf(state)!; return setBattle(state, { ...b, after: [...b.after, effect] }); }
        if (inScene) return { ...state, queue: [...state.queue, effect] };
        return { ...state, queue: [], scene: { kind: "ending", ending: effect.ending } };
      }
      case "newCycle": {
        const meta = metaOf(state);
        c.log.push(`${meta.cycle + 1}周目を開始（記憶を引き継ぎ）`);
        c.cues.push({ kind: "mapChanged", from: state.mapId });
        return enqueue(freshState(state.rng, { ...meta, cycle: meta.cycle + 1 }), introEffects());
      }
      case "startScene": {
        if (inBattle) { const b = battleOf(state)!; return setBattle(state, { ...b, after: [...b.after, effect] }); }
        if (inScene) return { ...state, queue: [...state.queue, effect] };
        const def = sorted.find(sys => sys.id === effect.system)?.scenes?.[effect.scene];
        if (!def) throw new Error(`システム '${effect.system}' に画面 '${effect.scene}' がありません`);
        const data = def.start ? def.start({ content, state }, effect.args ?? {}) : null;
        c.log.push(`画面 ${effect.system}.${effect.scene} を開始`);
        return { ...state, scene: { kind: "custom", system: effect.system, scene: effect.scene, data } };
      }
      // Field-only (blocking) effects. In battle they wait until the battle closes.
      case "dialogue":
      case "choice":
      case "teleport":
      case "battle":
        if (inBattle) { const b = battleOf(state)!; return setBattle(state, { ...b, after: [...b.after, effect] }); }
        if (inScene) return { ...state, queue: [...state.queue, effect] };
        if (effect.type === "dialogue") {
          if (!content.dialogues[effect.dialogue]) throw new Error(`会話 '${effect.dialogue}' がありません`);
          return { ...state, scene: { kind: "dialogue", dialogueId: effect.dialogue, line: 0 } };
        }
        if (effect.type === "choice") {
          const options = effect.options.map((option, index) => ({ option, index })).filter(({ option }) => ev(option.when, state))
            .map(({ option, index }) => ({ id: option.id ?? `option-${index}`, label: text(option.label, state), effects: option.effects }));
          if (!options.length) return state;
          return { ...state, scene: { kind: "prompt", ...(effect.prompt ? { prompt: text(effect.prompt, state) } : {}), ...(effect.speaker ? { speaker: effect.speaker } : {}), options } };
        }
        if (effect.type === "teleport") {
          const from = state.mapId;
          c.log.push(`${content.maps[effect.mapId]?.title ?? effect.mapId} (${effect.x}, ${effect.y}) へ移動`);
          state = { ...state, mapId: effect.mapId, player: { ...state.player, x: effect.x, y: effect.y, facing: effect.facing ?? state.player.facing } };
          if (from !== effect.mapId) {
            c.cues.push({ kind: "mapChanged", from });
            state = { ...state, fired: state.fired.filter(k => !k.startsWith("map:")), regions: [] };
            state = fireFieldRules(c, state, "mapEnter");
            for (const system of active(state)) state = applySystemResult(c, state, system.onMapEnter?.({ content, state }));
          }
          return updateRegions(c, state, false);
        }
        return startBattle(c, state, effect);
    }
  }

  function eventEffects(c: Ctx, state: GameState, event: GameEvent): Effect[] {
    if (event.once && state.done.includes(event.id)) return event.afterDone;
    if (!ev(event.when, state)) return event.otherwise;
    c.log.push(`イベント「${event.label}」`);
    // markDone runs last so an event interrupted by a lost battle can be retried.
    return event.once ? [...event.effects, { type: "markDone", id: event.id }] : event.effects;
  }

  /* ---------------------------------------------------------------- battle */
  function startBattle(c: Ctx, state: GameState, effect: Extract<Effect, { type: "battle" }>): GameState {
    const enemy = enemyOf(effect.enemy);
    const others = (effect.with ?? []).map(id => enemyOf(id));
    const battle: BattleState = {
      enemyId: enemy.id, enemyHp: enemy.stats.maxHp, turn: 0, guarding: false,
      canFlee: effect.canFlee ?? (enemy.canFlee && others.every(o => o.canFlee)), onDefeat: effect.onDefeat ?? "respawn", onVictory: effect.onVictory ?? [],
      log: [others.length ? `${[enemy, ...others].map(e => e.name).join("と")}が現れた！` : `${enemy.name}が現れた！`], systemData: {}, outcome: "ongoing", fired: [], after: [],
      ...(others.length ? { foes: others.map((o, k) => ({ enemyId: o.id, hp: o.stats.maxHp, slot: k + 1 })) } : {}),
    };
    state = setBattle(state, battle);
    for (const system of active(state)) {
      const data = system.onBattleStart?.({ content, state, battle: battleOf(state)!, enemy });
      if (data !== undefined) { const b = battleOf(state)!; state = setBattle(state, { ...b, systemData: { ...b.systemData, [system.id]: data } }); }
    }
    c.cues.push({ kind: "battleStart", enemyId: enemy.id });
    c.log.push(`戦闘開始: ${enemy.name}`);
    for (const entry of rulesFor(state, "battleStart")) {
      const next = tryRule(c, state, entry);
      if (next) state = runNow(c, next, entry.rule.effects);
    }
    state = checkBattleEnd(c, state);
    // Genre battle modes: fight in a module / system scene, then come back to the RPG battle result.
    const mode = effect.mode ?? enemy.battle?.mode ?? "builtin";
    const started = battleOf(state);
    if (mode !== "builtin" && started && started.outcome === "ongoing") {
      const [systemId, sceneName] = [mode.slice(0, mode.lastIndexOf(".")), mode.slice(mode.lastIndexOf(".") + 1)];
      const def = sorted.find(sys => sys.id === systemId)?.scenes?.[sceneName];
      if (!def) throw new Error(`戦闘モード '${mode}' の画面がありません（project.json の modules / systems を確認）`);
      const args = { ...enemy.battle?.args, ...effect.args, enemyId: enemy.id, canFlee: started.canFlee };
      const data = def.start ? def.start({ content, state }, args) : null;
      c.log.push(`戦闘モード ${mode}`);
      return { ...state, scene: { kind: "custom", system: systemId, scene: sceneName, data, battle: started } };
    }
    return state;
  }

  /** A module battle ended: rebuild the RPG battle result (drops, victory/defeat rules, respawn). */
  function finishModuleBattle(c: Ctx, state: GameState, battle: BattleState, outcome: "victory" | "defeat" | "fled", lines: string[]): GameState {
    state = setBattle(state, { ...battle, log: [...battle.log, ...lines].slice(-10) });
    if (outcome === "fled") { c.cues.push({ kind: "battleEnd", outcome: "fled" }); return setBattle(state, { ...battleOf(state)!, outcome: "fled" }); }
    if (outcome === "victory") return checkBattleEnd(c, setBattle(state, { ...battleOf(state)!, enemyHp: 0 }));
    return checkBattleEnd(c, { ...state, player: { ...state.player, hp: 0 } });
  }

  function rollDamage(state: GameState, attack: number, power: number, defense: number, who: "player" | "enemy" = "player"): [number, GameState] {
    const [roll, next] = random(state);
    const variance = Math.floor(roll * 3) - 1; // -1, 0, +1
    const formula = who === "player" ? content.project.battle.playerDamage : content.project.battle.enemyDamage;
    if (formula !== undefined) return [Math.max(0, ex(formula, next, { attack, defense, power, variance })), next];
    return [Math.max(1, attack + power - defense + variance), next];
  }

  /**
   * Damage pipeline, in this fixed order:
   * ① formula → ② rules (dealDamage/takeDamage) then systems.modifyDamage → ③ lethal: rules (lethalDamage) then systems.onLethalDamage, first wins → ④ commit HP.
   */
  function applyDamage(c: Ctx, state: GameState, target: "player" | "enemy", raw: number): [GameState, number] {
    if (raw > 0) state = dropWakers(state, target === "player" ? "player" : curSlot(state));
    const enemy = enemyOf(battleOf(state)!.enemyId);
    let amount = raw;
    for (const entry of rulesFor(state, target === "enemy" ? "dealDamage" : "takeDamage")) {
      const next = tryRule(c, state, entry, { damage: amount });
      if (!next) continue;
      state = next;
      if (entry.rule.modify?.damage !== undefined) amount = Math.max(0, ex(entry.rule.modify.damage, state, { damage: amount }));
      state = runNow(c, state, entry.rule.effects, { damage: amount });
    }
    for (const system of active(state)) {
      const battle = battleOf(state)!;
      const changed = system.modifyDamage?.({ content, state, battle, enemy, target, amount, battleData: battle.systemData[system.id] });
      if (typeof changed === "number" && Number.isFinite(changed)) amount = Math.max(0, Math.floor(changed));
    }
    if (target === "enemy") {
      const battle = battleOf(state)!;
      c.cues.push({ kind: "hit", target: "enemy", amount });
      return [setBattle(state, { ...battle, enemyHp: Math.max(0, battle.enemyHp - amount) }), amount];
    }
    const hpBefore = state.player.hp;
    let hp = Math.max(0, hpBefore - amount);
    if (hp === 0) {
      let saved = false;
      for (const entry of rulesFor(state, "lethalDamage")) {
        const next = tryRule(c, state, entry, { damage: amount });
        if (!next) continue;
        state = runNow(c, next, entry.rule.effects, { damage: amount });
        if (entry.rule.modify?.hp !== undefined) { hp = Math.max(0, Math.min(stats(state).maxHp, ex(entry.rule.modify.hp, state, { damage: amount }))); saved = true; break; }
      }
      if (!saved) {
        for (const system of active(state)) {
          const battle = battleOf(state)!;
          const outcome = system.onLethalDamage?.({ content, state, battle, enemy, target, amount, battleData: battle.systemData[system.id], hpBefore });
          if (!outcome) continue;
          hp = Math.max(0, Math.min(stats(state).maxHp, Math.floor(outcome.hp)));
          if (outcome.message) state = battleLog(state, outcome.message);
          if (outcome.battleData !== undefined) { const b = battleOf(state)!; state = setBattle(state, { ...b, systemData: { ...b.systemData, [system.id]: outcome.battleData } }); }
          break;
        }
      }
    }
    c.cues.push({ kind: "hit", target: "player", amount });
    return [{ ...state, player: { ...state.player, hp } }, amount];
  }

  /** Resolves victory / defeat after anything that may have changed HP. */
  function checkBattleEnd(c: Ctx, state: GameState): GameState {
    let battle = battleOf(state);
    if (!battle || battle.outcome !== "ongoing") return state;
    const enemy = enemyOf(battle.enemyId);
    if (battle.enemyHp <= 0 && (battle.foes ?? []).every(f => f.hp <= 0)) {
      const all = [enemy, ...(battle.foes ?? []).map(f => enemyOf(f.enemyId))];
      state = battleLog(state, all.length > 1 ? "敵をすべて倒した！" : `${enemy.name}を倒した！`);
      for (const drop of all.flatMap(e => e.drops)) {
        state = { ...state, items: { ...state.items, [drop.item]: (state.items[drop.item] ?? 0) + drop.count } };
        state = battleLog(state, `${itemName(drop.item)}を${drop.count}個手に入れた。`);
      }
      if (content.project.leveling) {
        const exp = all.reduce((sum, e) => sum + (e.exp ?? Math.max(1, Math.round((e.stats.maxHp + 2 * e.stats.attack + 2 * e.stats.defense) / 3))), 0);
        state = gainExp(c, state, exp, true);
      }
      const after: Effect[] = [];
      for (const entry of rulesFor(state, "victory")) { const next = tryRule(c, state, entry); if (next) { state = next; after.push(...entry.rule.effects); } }
      battle = battleOf(state)!;
      c.cues.push({ kind: "battleEnd", outcome: "victory" });
      c.log.push(`勝利: ${enemy.name}`);
      return setBattle(state, { ...battle, outcome: "victory", after: [...battle.after, ...after] });
    }
    if (state.player.hp <= 0) {
      state = battleLog(state, `${content.project.player.name}は倒れた……`);
      const after: Effect[] = [];
      for (const entry of rulesFor(state, "defeat")) { const next = tryRule(c, state, entry); if (next) { state = next; after.push(...entry.rule.effects); } }
      battle = battleOf(state)!;
      c.cues.push({ kind: "battleEnd", outcome: "defeat" });
      c.log.push(`敗北: ${enemy.name}`);
      return setBattle(state, { ...battle, outcome: "defeat", after: [...battle.after, ...after] });
    }
    return state;
  }

  /* ---------------------------------------------------------------- statuses & elements */
  type StatusInst = { id: string; turns: number };
  const statusDef = (id: string) => db.statuses.find(s => s.id === id);
  const statusLabel = (id: string) => { const d = statusDef(id); return d ? d.label ?? d.name : id; };
  const curSlot = (state: GameState) => battleOf(state)?.slot ?? 0;
  const slotAt = (b: BattleState, i: number) => (i === 0 ? b.slot ?? 0 : b.foes?.[i - 1]?.slot ?? i);
  const enemyStatusList = (state: GameState, slot = curSlot(state)): StatusInst[] => battleOf(state)?.enemyStatuses?.[String(slot)] ?? [];
  function setEnemyStatusList(state: GameState, slot: number, list: StatusInst[]): GameState {
    const b = battleOf(state);
    if (!b) return state;
    const all = { ...(b.enemyStatuses ?? {}) };
    if (list.length) all[String(slot)] = list; else delete all[String(slot)];
    return setBattle(state, { ...b, enemyStatuses: all });
  }
  const setPlayerStatuses = (state: GameState, list: StatusInst[]): GameState => {
    const { statuses: _old, ...player } = state.player;
    return { ...state, player: list.length ? { ...player, statuses: list } : player };
  };
  /** Enemy attack / defense with the status mods of the enemy acting or being hit now. */
  function enemyStat(state: GameState, enemy: Enemy, stat: "attack" | "defense"): number {
    return Math.max(0, enemy.stats[stat] + enemyStatusList(state).reduce((sum, s) => sum + (statusDef(s.id)?.statMods?.[stat] ?? 0), 0));
  }
  const holderName = (state: GameState, who: "player" | number) => (who === "player" ? state.player.name ?? content.project.player.name : enemyOf(enemyIdAtSlot(state, who) ?? battleOf(state)!.enemyId).name);
  function enemyIdAtSlot(state: GameState, slot: number): string | undefined {
    const b = battleOf(state);
    if (!b) return undefined;
    if ((b.slot ?? 0) === slot) return b.enemyId;
    return b.foes?.find((f, k) => (f.slot ?? k + 1) === slot)?.enemyId;
  }
  /** Adds (or refreshes) a status. Returns the state and whether it took. */
  function giveStatus(state: GameState, who: "player" | number, id: string, turns?: number): GameState {
    const def = statusDef(id);
    if (!def) return state;
    if (who !== "player") {
      const enemyId = enemyIdAtSlot(state, who);
      if (enemyId && enemyOf(enemyId).immune.includes(id)) return battleOf(state) ? battleLog(state, `${enemyOf(enemyId).name}に${statusLabel(id)}は効かない！`) : state;
    }
    const list = who === "player" ? state.player.statuses ?? [] : enemyStatusList(state, who);
    const n = turns ?? def.turns;
    const existing = list.find(s => s.id === id);
    const next = existing ? list.map(s => (s.id === id ? { ...s, turns: Math.max(s.turns, n) } : s)) : [...list, { id, turns: n }];
    state = who === "player" ? setPlayerStatuses(state, next) : setEnemyStatusList(state, who, next);
    const line = text((def.onAdd ?? `{{name}}は${def.name}になった。`).replaceAll("{{name}}", holderName(state, who)), state);
    return battleOf(state) ? battleLog(state, line) : state;
  }
  function dropStatus(state: GameState, who: "player" | number, id?: string, announce = false): GameState {
    const list = who === "player" ? state.player.statuses ?? [] : enemyStatusList(state, who);
    const gone = list.filter(s => !id || s.id === id);
    if (!gone.length) return state;
    const rest = list.filter(s => id && s.id !== id);
    state = who === "player" ? setPlayerStatuses(state, rest) : setEnemyStatusList(state, who, rest);
    if (announce && battleOf(state)) for (const s of gone) { const def = statusDef(s.id); state = battleLog(state, text((def?.onEnd ?? `{{name}}の${def?.name ?? s.id}が治った。`).replaceAll("{{name}}", holderName(state, who)), state)); }
    return state;
  }
  /** Rolls the skipChance of the statuses (sleep, paralysis). */
  function loseTurn(state: GameState, who: "player" | number): [boolean, GameState] {
    const list = who === "player" ? state.player.statuses ?? [] : enemyStatusList(state, who);
    for (const s of list) {
      const chance = statusDef(s.id)?.skipChance ?? 0;
      if (chance <= 0) continue;
      let roll: number;
      [roll, state] = random(state);
      if (roll * 100 < chance) return [true, battleLog(state, `${holderName(state, who)}は${statusDef(s.id)!.name}で動けない！`)];
    }
    return [false, state];
  }
  /** End of a battle turn: damage / heal over time, count down, expire. */
  function tickStatuses(c: Ctx, state: GameState): GameState {
    const who: Array<"player" | number> = ["player"];
    const b = battleOf(state)!;
    for (let i = 0; i < enemyCount(b); i++) if (enemyHpAt(b, i) > 0) who.push(slotAt(b, i));
    for (const holder of who) {
      const list = holder === "player" ? state.player.statuses ?? [] : enemyStatusList(state, holder);
      for (const s of list) {
        const def = statusDef(s.id);
        if (!def) continue;
        const max = holder === "player" ? stats(state).maxHp : enemyOf(enemyIdAtSlot(state, holder)!).stats.maxHp;
        const amount = (e: Expr | undefined) => (e === undefined ? 0 : Math.max(0, ex(e, state, { power: max })));
        const dmg = amount(def.damage), heal = amount(def.heal);
        if (!dmg && !heal) continue;
        const delta = heal - dmg;
        if (holder === "player") state = { ...state, player: { ...state.player, hp: Math.max(0, Math.min(max, state.player.hp + delta)) } };
        else {
          const bb = battleOf(state)!;
          const idx = [...Array(enemyCount(bb)).keys()].find(i => slotAt(bb, i) === holder)!;
          state = idx === 0 ? setBattle(state, { ...bb, enemyHp: Math.max(0, Math.min(max, bb.enemyHp + delta)) })
            : setBattle(state, { ...bb, foes: bb.foes!.map((f, k) => (k === idx - 1 ? { ...f, hp: Math.max(0, Math.min(max, f.hp + delta)) } : f)) });
        }
        if (dmg) c.cues.push({ kind: "hit", target: holder === "player" ? "player" : "enemy", amount: dmg });
        state = battleLog(state, `${holderName(state, holder)}は${def.name}で${dmg ? `${dmg}のダメージ` : `${heal}回復した`}。`);
      }
      const after = (holder === "player" ? state.player.statuses ?? [] : enemyStatusList(state, holder)).map(s => ({ ...s, turns: s.turns - 1 }));
      for (const s of after.filter(x => x.turns <= 0)) state = dropStatus(state, holder, s.id, true);
      const kept = after.filter(x => x.turns > 0);
      state = holder === "player" ? setPlayerStatuses(state, kept) : setEnemyStatusList(state, holder, kept);
    }
    return state;
  }
  /** Damage multiplier by element: the target's resist (enemy data, or the hero's active items). */
  function elementRate(state: GameState, element: string | undefined, target: "player" | "enemy"): number {
    if (!element) return 100;
    if (target === "enemy") return enemyOf(battleOf(state)!.enemyId).resist[element] ?? 100;
    let rate = 100;
    for (const id of Object.keys(state.items)) { const it = db.items.find(i => i.id === id); if (it?.resist?.[element] !== undefined && itemActive(state, it)) rate = rate * it.resist[element]! / 100; }
    return Math.round(rate);
  }
  /** Taking damage ends wakeOnHit statuses (sleep). */
  function dropWakers(state: GameState, who: "player" | number): GameState {
    const list = who === "player" ? state.player.statuses ?? [] : enemyStatusList(state, who);
    for (const s of list) if (statusDef(s.id)?.wakeOnHit) state = dropStatus(state, who, s.id, true);
    return state;
  }
  const elementNote = (rate: number) => (rate >= 150 ? "弱点！ " : rate === 0 ? "効かない！ " : rate <= 50 ? "効きが悪い…… " : "");
  const weaponElement = (state: GameState) => Object.values(state.equipment ?? {}).map(id => db.items.find(i => i.id === id)?.element).find(Boolean);

  /** Experience needed to go from `level` to level + 1. */
  function expToNext(level: number): number {
    const lv = content.project.leveling!;
    return lv.expTable?.[level - 1] ?? Math.max(1, Math.round(lv.base * lv.growth ** (level - 1)));
  }
  /** Adds experience; levels up (stats, HP, abilities) as many times as it reaches. In battle the lines go to the battle log. */
  function gainExp(c: Ctx, state: GameState, amount: number, inBattle: boolean): GameState {
    const lv = content.project.leveling;
    if (!lv || amount <= 0) return state;
    const say = (s: GameState, line: string) => (inBattle && battleOf(s) ? battleLog(s, line) : enqueue(s, [{ type: "message", text: line }]));
    const name = state.player.name ?? content.project.player.name;
    let level = state.player.level ?? 1;
    let exp = (state.player.exp ?? 0) + amount;
    state = say(state, `${amount}の経験値を手に入れた。`);
    while (level < lv.maxLevel && exp >= expToNext(level)) {
      exp -= expToNext(level);
      level++;
      const g = lv.gains;
      const stats = { maxHp: state.player.stats.maxHp + g.maxHp, attack: state.player.stats.attack + g.attack, defense: state.player.stats.defense + g.defense };
      state = { ...state, player: { ...state.player, level, stats, hp: lv.fullHeal ? effectiveStats({ ...state, player: { ...state.player, stats } }, content).maxHp : state.player.hp + g.maxHp } };
      c.cues.push({ kind: "levelUp", level });
      c.log.push(`レベル${level}`);
      state = say(state, `${name}はレベル${level}に上がった！`);
      for (const learn of lv.learn.filter(l => l.level === level)) {
        if (state.abilities.includes(learn.ability)) continue;
        state = { ...state, abilities: [...state.abilities, learn.ability] };
        state = say(state, learn.message ?? `${abilityName(learn.ability)}を覚えた！`);
      }
    }
    if (level >= lv.maxLevel) exp = 0;
    return { ...state, player: { ...state.player, level, exp } };
  }

  function usableBlock(state: GameState, use: Use, where: "battle" | "field"): string | undefined {
    if (use.where !== "both" && use.where !== where) return where === "battle" ? "戦闘では使えない" : "戦闘中しか使えない";
    if (!ev(use.when, state)) return "条件を満たしていない";
    for (const cost of use.cost) {
      const need = ex(cost.amount, state);
      if (ex({ var: cost.var }, state) < need) return `${content.project.variables[cost.var]?.label ?? cost.var}が${need}必要`;
    }
    return undefined;
  }

  function itemUse(id: string): Use | undefined {
    const item = db.items.find(i => i.id === id);
    if (!item) return undefined;
    if (item.use) return item.use;
    if (item.script && scriptUse(item.script)) return scriptUse(item.script);
    if (item.heal) return { where: "both", cost: [], effects: [{ type: "heal", amount: item.heal }], consume: true };
    return undefined;
  }

  function usables(state: GameState, where: "battle" | "field"): Usable[] {
    const out: Usable[] = [];
    for (const id of abilitiesOf(state, content)) {
      const a = db.abilities.find(x => x.id === id);
      const use = a?.use ?? scriptUse(a?.script);
      if (!a || !use || (use.where !== "both" && use.where !== where)) continue;
      out.push({ id, name: use.label ?? a.name, kind: "ability", use, blocked: usableBlock(state, use, where) });
    }
    for (const [id, count] of Object.entries(state.items)) {
      const use = itemUse(id);
      if (!use || (use.where !== "both" && use.where !== where)) continue;
      out.push({ id, name: itemName(id), kind: "item", use, blocked: usableBlock(state, use, where), count });
    }
    return out;
  }

  /** Pays costs and returns the effects to run, or a reason it can't be used. */
  function payForUse(c: Ctx, state: GameState, kind: "ability" | "item", id: string, where: "battle" | "field"): [GameState, Effect[]] | string {
    const ability = kind === "ability" ? db.abilities.find(a => a.id === id) : undefined;
    const use = kind === "item" ? ((state.items[id] ?? 0) > 0 ? itemUse(id) : undefined) : abilitiesOf(state, content).includes(id) ? ability?.use ?? scriptUse(ability?.script) : undefined;
    if (!use) return "使えない";
    const blocked = usableBlock(state, use, where);
    if (blocked) return blocked;
    for (const cost of use.cost) state = { ...state, vars: { ...state.vars, [cost.var]: clampVar(cost.var, ex({ var: cost.var }, state) - ex(cost.amount, state)) } };
    if (use.hpCost !== undefined) state = { ...state, player: { ...state.player, hp: Math.max(1, state.player.hp - ex(use.hpCost, state)) } };
    if (kind === "item" && use.consume) {
      const items = { ...state.items };
      if ((items[id] ?? 0) > 1) items[id] = items[id]! - 1; else delete items[id];
      state = { ...state, items };
    }
    c.log.push(`${kind === "item" ? itemName(id) : abilityName(id)}を使用`);
    const ref = kind === "item" ? db.items.find(i => i.id === id)?.script : ability?.script;
    return [state, [...use.effects, ...useEffectOf(ref, kind, id)]];
  }

  /** All enemies in the battle: index 0 is the primary (battle.enemyId), then battle.foes. */
  const enemyCount = (b: BattleState) => 1 + (b.foes?.length ?? 0);
  const enemyHpAt = (b: BattleState, i: number) => (i === 0 ? b.enemyHp : b.foes![i - 1]!.hp);
  /**
   * Makes enemy i the primary for a moment (swap with index 0) so every existing rule, system and formula
   * ("the enemy", dealDamage, enemy conditions) sees the one being hit or acting. Swapping twice restores the order.
   */
  function swapEnemy(state: GameState, i: number): GameState {
    const b = battleOf(state);
    if (!b || i <= 0 || !b.foes?.[i - 1]) return state;
    const foe = b.foes[i - 1]!;
    // Each enemy keeps its start-of-battle slot, so attached scripts keep their own memory while the order changes.
    const foes = b.foes.map((f, k) => (k === i - 1 ? { enemyId: b.enemyId, hp: b.enemyHp, slot: b.slot ?? 0 } : f));
    return setBattle(state, { ...b, enemyId: foe.enemyId, enemyHp: foe.hp, slot: foe.slot ?? i, foes });
  }
  const firstAlive = (b: BattleState) => { for (let i = 0; i < enemyCount(b); i++) if (enemyHpAt(b, i) > 0) return i; return 0; };

  function playerAction(c: Ctx, state: GameState, command: BattleCommand): GameState | "done" {
    const enemy = enemyOf(battleOf(state)!.enemyId);
    const name = state.player.name ?? content.project.player.name;
    if (command.command === "attack") {
      const [rolled, rolledState] = rollDamage(state, stats(state).attack, 0, enemyStat(state, enemy, "defense"));
      const rate = elementRate(rolledState, weaponElement(rolledState), "enemy");
      const raw = Math.floor(rolled * rate / 100);
      const next = rate !== 100 ? battleLog(rolledState, elementNote(rate).trim() || `（${rate}%）`) : rolledState;
      const [after, amount] = applyDamage(c, next, "enemy", raw);
      state = battleLog(after, `${name}の攻撃！ ${enemy.name}に${amount}のダメージ。`);
      if (battleOf(state)!.enemyHp <= 0 && enemyCount(battleOf(state)!) > 1) state = battleLog(state, `${enemy.name}を倒した！`);
    } else if (command.command === "guard") {
      state = battleLog(setBattle(state, { ...battleOf(state)!, guarding: true }), `${name}は身を守っている。`);
    } else if (command.command === "item" || command.command === "skill") {
      const kind = command.command === "item" ? "item" : "ability";
      const id = command.command === "item" ? command.item : command.ability;
      const label = kind === "item" ? itemName(id) : db.abilities.find(a => a.id === id)?.use?.label ?? abilityName(id);
      const before = state.player.hp;
      const paid = payForUse(c, state, kind, id, "battle");
      if (typeof paid === "string") return battleLog(state, `${label}: ${paid}。`);
      state = battleLog(paid[0], `${name}は${label}を使った！`);
      state = runNow(c, state, paid[1]);
      if (state.player.hp > before) state = battleLog(state, `HPが${state.player.hp - before}回復した。`);
    } else if (command.command === "flee") {
      if (!battleOf(state)!.canFlee) state = battleLog(state, "逃げられない！");
      else {
        let roll: number;
        [roll, state] = random(state);
        const fleePercent = content.project.battle.fleeChance !== undefined ? ex(content.project.battle.fleeChance, state) : 60;
        if (roll * 100 < fleePercent) {
          c.cues.push({ kind: "battleEnd", outcome: "fled" });
          state = battleLog(state, "うまく逃げ切れた。");
          return setBattle(state, { ...battleOf(state)!, outcome: "fled" });
        }
        state = battleLog(state, "逃げられなかった！");
      }
    }
    return state;
  }

  /** Companions act on their own: heal someone below half HP if they can, otherwise their next attack / guard. */
  function companionTurns(c: Ctx, state: GameState): GameState {
    for (const member of state.party ?? []) {
      const comp = companionOf(member.id);
      const current = state.party?.find(m => m.id === member.id);
      if (!comp || !current || current.hp <= 0 || battleOf(state)!.outcome !== "ongoing") continue;
      let replaced = false;
      for (const system of active(state)) {
        if (!system.companionTurn || !steers(system, "companion", comp.id)) continue;
        const result = system.companionTurn({ content, state, battle: battleOf(state)!, companion: comp.id });
        if (result) { state = applyNow(c, state, result); replaced = true; break; }
      }
      if (replaced) { state = checkBattleEnd(c, state); continue; }
      const actions = comp.actions.filter(a => ev(a.when, state));
      const cs = companionStats(state, comp.id);
      // An order from the hero for this turn wins (if its condition holds).
      const orderIndex = battleOf(state)!.orders?.[comp.id];
      const ordered = orderIndex !== undefined && comp.actions[orderIndex] && ev(comp.actions[orderIndex]!.when, state) ? comp.actions[orderIndex] : undefined;
      const everyone = [{ id: "player", hp: state.player.hp, max: stats(state).maxHp }, ...(state.party ?? []).filter(m => m.hp > 0).map(m => ({ id: m.id, hp: m.hp, max: companionStats(state, m.id).maxHp }))].sort((a, b) => a.hp / a.max - b.hp / b.max);
      const hurt = ordered?.kind === "heal" ? everyone[0] : ordered ? undefined : everyone.filter(x => x.hp < x.max / 2)[0];
      const heal = hurt && (ordered?.kind === "heal" ? ordered : actions.find(a => a.kind === "heal"));
      if (heal && hurt) {
        const amount = Math.max(1, heal.power || Math.ceil(cs.attack * 1.5));
        if (hurt.id === "player") state = { ...state, player: { ...state.player, hp: Math.min(stats(state).maxHp, state.player.hp + amount) } };
        else state = { ...state, party: state.party!.map(m => (m.id === hurt.id ? { ...m, hp: Math.min(hurt.max, m.hp + amount) } : m)) };
        state = battleLog(state, text(heal.message ?? `${comp.name}の${heal.name}！ ${hurt.id === "player" ? (state.player.name ?? content.project.player.name) : companionOf(hurt.id)?.name}のHPが${amount}回復した。`, state));
        continue;
      }
      const others = actions.filter(a => a.kind !== "heal");
      const action = ordered && ordered.kind !== "heal" ? ordered : others.length ? others[battleOf(state)!.turn % others.length]! : undefined;
      if (!action || action.kind === "guard") { state = battleLog(state, `${comp.name}は身構えている。`); continue; }
      const t = firstAlive(battleOf(state)!);
      state = swapEnemy(state, t);
      const enemy = enemyOf(battleOf(state)!.enemyId);
      const [raw, next] = rollDamage(state, cs.attack, action.power, enemyStat(state, enemy, "defense"));
      const amount = Math.max(1, raw);
      state = setBattle(next, { ...battleOf(next)!, enemyHp: Math.max(0, battleOf(next)!.enemyHp - amount) });
      state = battleLog(state, text(action.message ?? `${comp.name}の${action.name}！ ${enemy.name}に${amount}のダメージ。`, state));
      if (battleOf(state)!.enemyHp <= 0 && enemyCount(battleOf(state)!) > 1) state = battleLog(state, `${enemy.name}を倒した！`);
      state = swapEnemy(state, t);
      state = checkBattleEnd(c, state);
    }
    return state;
  }

  /** One enemy's turn (it is the primary while acting). It strikes the hero or, with a party, anyone standing. */
  function enemyTurn(c: Ctx, state: GameState): GameState {
    let lost: boolean;
    [lost, state] = loseTurn(state, curSlot(state));
    if (lost) return state;
    const battle = battleOf(state)!;
    const enemy = enemyOf(battle.enemyId);
    for (const system of active(state)) {
      if (!system.enemyTurn || !steers(system, "enemy", enemy.id, battleOf(state)!.slot ?? 0)) continue;
      const result = system.enemyTurn({ content, state, battle: battleOf(state)!, enemy });
      if (result) return applyNow(c, state, result);
    }
    const available = enemy.actions.filter(action => ev(action.when, state));
    const action = available.length ? available[battle.turn % available.length]! : null;
    if (!action) return state;
    state = battleLog(state, text(action.message ?? `${enemy.name}の${action.name}！`, state));
    if (action.power > 0) {
      const standing = (state.party ?? []).filter(m => m.hp > 0);
      let pick = 0;
      if (standing.length) { let roll: number; [roll, state] = random(state); pick = Math.floor(roll * (standing.length + 1)); }
      if (pick === 0) {
        const guarding = battleOf(state)!.guarding;
        const [rolled, next] = rollDamage(state, enemyStat(state, enemy, "attack"), action.power, stats(state).defense, "enemy");
        // Guarding halves the damage at step ① (before rules and systems see it).
        const [after, amount] = applyDamage(c, next, "player", guarding ? Math.max(1, Math.ceil(rolled / 2)) : rolled);
        state = battleLog(after, `${amount}のダメージを受けた。`);
      } else {
        const member = standing[pick - 1]!;
        const comp = companionOf(member.id)!;
        const [rolled, next] = rollDamage(state, enemyStat(state, enemy, "attack"), action.power, companionStats(state, comp.id).defense, "enemy");
        const amount = Math.max(1, rolled);
        state = { ...next, party: next.party!.map(m => (m.id === member.id ? { ...m, hp: Math.max(0, m.hp - amount) } : m)) };
        state = battleLog(state, `${comp.name}に${amount}のダメージ。${state.party!.find(m => m.id === member.id)!.hp <= 0 ? `${comp.name}は倒れた……` : ""}`);
      }
    }
    return runNow(c, state, action.effects);
  }

  function battleStep(c: Ctx, state: GameState, command: BattleCommand): GameState {
    let battle = battleOf(state);
    if (!battle || battle.outcome !== "ongoing") return state;
    state = setBattle(state, { ...battle, guarding: false });

    if (command.command === "order") {
      const comp = companionOf(command.companion);
      const member = state.party?.find(m => m.id === command.companion);
      if (!comp || !member || member.hp <= 0 || !comp.actions[command.action]) return state;
      const b = battleOf(state)!;
      return battleLog(setBattle(state, { ...b, orders: { ...b.orders, [comp.id]: command.action } }), `${comp.name}に「${comp.actions[command.action]!.name}」を指示した。`);
    }
    let scripted = false;
    if (command.command === "script") {
      const ran = runCommand(c, state, command.source, command.id, "battle");
      if (typeof ran === "string") return battleLog(state, ran);
      state = checkBattleEnd(c, ran[0]);
      if (ran[1].endsTurn === false || battleOf(state)!.outcome !== "ongoing") return state;
      scripted = true;
    }
    const allowed = content.project.battle.commands;
    const commandKey = command.command === "skill" ? "skills" : command.command === "item" ? "items" : command.command;
    if (!scripted && !allowed[commandKey as keyof typeof allowed]) return battleLog(state, "そのコマンドは使えない。");
    // Target: the chosen enemy if it still stands, otherwise the first one standing.
    const requested = command.command === "attack" ? command.target : undefined;
    const target = requested !== undefined && requested < enemyCount(battle) && enemyHpAt(battle, requested) > 0 ? requested : firstAlive(battle);
    // Silence blocks skills without using the turn; sleep / paralysis may take the turn.
    if (!scripted && command.command === "skill" && (state.player.statuses ?? []).some(s => statusDef(s.id)?.noSkills)) return battleLog(state, "技を封じられている！");
    let lost = false;
    if (!scripted) [lost, state] = loseTurn(state, "player");
    if (!scripted && !lost) {
      state = swapEnemy(state, target);
      const acted = playerAction(c, state, command);
      if (acted === "done") return state;
      state = swapEnemy(acted, target);
      if (battleOf(state)!.outcome !== "ongoing") return state;
      state = checkBattleEnd(c, state);
      if (battleOf(state)!.outcome !== "ongoing") return state;
    }

    state = companionTurns(c, state);
    if (battleOf(state)!.outcome !== "ongoing") return state;

    // Enemy turns: every enemy still standing, in order. Actions whose `when` holds are used in order and cycle.
    for (let i = 0; i < enemyCount(battleOf(state)!); i++) {
      if (enemyHpAt(battleOf(state)!, i) <= 0) continue;
      state = swapEnemy(state, i);
      state = enemyTurn(c, state);
      state = swapEnemy(state, i);
      state = checkBattleEnd(c, state);
      if (battleOf(state)!.outcome !== "ongoing") return state;
    }
    state = tickStatuses(c, state);
    state = checkBattleEnd(c, state);
    if (battleOf(state)!.outcome !== "ongoing") return state;
    for (const entry of rulesFor(state, "turnEnd")) {
      const next = tryRule(c, state, entry);
      if (next) state = runNow(c, next, entry.rule.effects);
    }
    for (const system of active(state)) {
      if (battleOf(state)!.outcome !== "ongoing") break;
      state = applyNow(c, state, system.onTurnEnd?.({ content, state, battle: battleOf(state)! }));
    }
    state = checkBattleEnd(c, state);
    battle = battleOf(state)!;
    const { orders: _done, ...rest } = battle;
    return setBattle(state, { ...rest, turn: battle.turn + 1 });
  }

  function closeBattle(c: Ctx, state: GameState): GameState {
    if (!battleOf(state) || battleOf(state)!.outcome === "ongoing") return state;
    state = setPlayerStatuses(state, (state.player.statuses ?? []).filter(s => statusDef(s.id)?.clearAfterBattle === false));
    for (const system of active(state)) state = applyNow(c, state, system.onBattleEnd?.({ content, state, battle: battleOf(state)! }));
    const battle = battleOf(state);
    if (!battle) return state;
    if (battle.outcome === "victory") {
      return runQueue(c, enqueue({ ...state, scene: { kind: "field" } }, [...battle.onVictory, ...battle.after]));
    }
    if (battle.outcome === "fled") return runQueue(c, { ...state, scene: { kind: "field" }, queue: battle.after });
    if (battle.onDefeat === "continue") {
      return runQueue(c, { ...state, scene: { kind: "field" }, queue: battle.after, player: { ...state.player, hp: 1 } });
    }
    const { start } = content.project;
    if (state.mapId !== start.mapId) c.cues.push({ kind: "mapChanged", from: state.mapId });
    return {
      ...state,
      mapId: start.mapId,
      player: { ...state.player, x: start.x, y: start.y, facing: start.facing, hp: stats(state).maxHp },
      queue: battle.after,
      scene: { kind: "message", text: "目の前が暗くなった……。気がつくと、見慣れた場所に戻っていた。" },
    };
  }

  /* ---------------------------------------------------------------- field */
  const entityEffects = (c: Ctx, state: GameState, st: EntityState): Effect[] => [
    ...(st.dialogue ? [{ type: "dialogue", dialogue: st.dialogue } as Effect] : []),
    ...(st.event && content.events[st.event] ? eventEffects(c, state, content.events[st.event]!) : []),
    ...st.effects,
  ];

  function applySystemResult(c: Ctx, state: GameState, result: SystemActionResult | void): GameState {
    if (!result) return state;
    c.log.push(...(result.log ?? []));
    return enqueue(result.state ?? state, result.effects ?? []);
  }

  /** onEnter / onLeave / onStep of regions after the player moved or arrived. */
  function updateRegions(c: Ctx, state: GameState, stepped: boolean): GameState {
    const map = content.maps[state.mapId];
    if (!map?.regions.length) return state.regions.length ? { ...state, regions: [] } : state;
    const now = regionsAt(state, content, env);
    const before = state.regions;
    const effects: Effect[] = [];
    for (const id of before) if (!now.includes(id)) effects.push(...(map.regions.find(r => r.id === id)?.onLeave ?? []));
    for (const id of now) if (!before.includes(id)) effects.push(...(map.regions.find(r => r.id === id)?.onEnter ?? []));
    if (stepped) for (const id of now) effects.push(...(map.regions.find(r => r.id === id)?.onStep ?? []));
    return enqueue({ ...state, regions: now }, effects);
  }

  function fireTimers(c: Ctx, state: GameState): GameState {
    const due = state.timers.filter(t => t.at <= state.steps);
    if (!due.length) return state;
    c.log.push(`予約イベント ${due.length}件`);
    return enqueue({ ...state, timers: state.timers.filter(t => t.at > state.steps) }, due.flatMap(t => t.effects));
  }

  /** Auto-trigger entity states run once when they become active. */
  function runEntityAutos(c: Ctx, state: GameState): GameState {
    for (const view of visibleEntities(state)) {
      if (view.state.trigger !== "auto") continue;
      const key = `ent:${state.mapId}:${view.entity.id}:${view.index}`;
      if (state.fired.includes(key)) continue;
      c.log.push(`${view.entity.name} の自動イベント`);
      return runQueue(c, enqueue({ ...state, fired: [...state.fired, key] }, entityEffects(c, state, view.state)));
    }
    return state;
  }

  function touchEntity(c: Ctx, state: GameState, view: EntityView): GameState {
    c.log.push(`${view.state.name ?? view.entity.name} に触れた`);
    return runQueue(c, enqueue(state, entityEffects(c, state, view.state)));
  }

  function move(c: Ctx, state: GameState, direction: Direction): GameState {
    const map = content.maps[state.mapId];
    if (!map) throw new Error(`現在のマップ '${state.mapId}' がありません`);
    state = { ...state, player: { ...state.player, facing: direction } };
    const to = { x: state.player.x + DELTAS[direction].x, y: state.player.y + DELTAS[direction].y };
    if (!isPassable(state, to.x, to.y, map)) {
      // Push a pushable entity one tile if the tile beyond is free.
      const pushed = visibleEntities(state, map).find(e => e.x === to.x && e.y === to.y && e.state.pushable);
      if (pushed) {
        const beyond = { x: to.x + DELTAS[direction].x, y: to.y + DELTAS[direction].y };
        if (isPassable(state, beyond.x, beyond.y, map) && !visibleEntities(state, map).some(e => e.x === beyond.x && e.y === beyond.y)) {
          const home = map.entities.some(e => e.id === pushed.entity.id) ? map.id : entityHome.get(pushed.entity.id)!;
          state = placeEntity(state, pushed.entity.id, home, beyond.x, beyond.y, pushed.facing, map.id);
          c.log.push(`${pushed.state.name ?? pushed.entity.name}を押した`);
          c.cues.push({ kind: "bump" });
          state = enqueue(state, pushed.state.onMoved ?? []);
          return move(c, state, direction);
        }
      }
      const bumped = visibleEntities(state, map).find(e => e.x === to.x && e.y === to.y && e.state.trigger === "touch");
      if (bumped) return touchEntity(c, state, bumped);
      c.cues.push({ kind: "bump" });
      return runQueue(c, fireFieldRules(c, state, "bump"));
    }
    const from = { x: state.player.x, y: state.player.y };
    state = { ...state, steps: state.steps + 1, player: { ...state.player, ...to } };
    c.cues.push({ kind: "moved", from });

    const portal = map.portals.find(p => p.x === to.x && p.y === to.y && ev(p.when, state));
    if (portal) return runQueue(c, applyEffect(c, state, { type: "teleport", mapId: portal.targetMapId, x: portal.targetX, y: portal.targetY, ...(portal.facing ? { facing: portal.facing } : {}) }));
    state = fireFieldRules(c, state, "step");
    state = fireTimers(c, state);
    state = updateRegions(c, state, true);
    for (const system of active(state)) state = applySystemResult(c, state, system.onStep?.({ content, state }));
    const walkedOn = visibleEntities(state, map).find(e => !e.state.solid && e.state.trigger === "touch" && e.x === to.x && e.y === to.y);
    if (walkedOn) state = enqueue(state, entityEffects(c, state, walkedOn.state));
    const touch = visibleInteractables(state, map).find(item => item.trigger === "touch" && item.x === to.x && item.y === to.y);
    if (touch) {
      const event = content.events[touch.event];
      if (event) return runQueue(c, enqueue(state, eventEffects(c, state, event)));
    }
    state = runQueue(c, state);
    if (state.scene.kind !== "field" || state.mapId !== map.id) return state;
    if (map.encounters && map.encounters.rate > 0) {
      const code = codeAt(state, map, to.x, to.y);
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

  const OPPOSITE: Record<Direction, Direction> = { up: "down", down: "up", left: "right", right: "left" };

  function interact(c: Ctx, state: GameState): GameState {
    const map = content.maps[state.mapId];
    if (!map) return state;
    const front = { x: state.player.x + DELTAS[state.player.facing].x, y: state.player.y + DELTAS[state.player.facing].y };
    // Put down what you carry on a free tile in front.
    if (state.carrying && isPassable(state, front.x, front.y, map) && !visibleEntities(state, map).some(e => e.x === front.x && e.y === front.y)) {
      const { id, home } = state.carrying;
      const entity = content.maps[home]?.entities.find(e => e.id === id);
      state = { ...placeEntity(state, id, home, front.x, front.y, state.player.facing, map.id), carrying: undefined };
      const st = entity?.states.find(s => ev(s.when, state));
      c.log.push(`${st?.name ?? entity?.name ?? id}を置いた`);
      return runQueue(c, enqueue(state, st?.onMoved ?? []));
    }
    const npc = visibleNpcs(state, map).find(n => n.x === front.x && n.y === front.y);
    if (npc) {
      const entry = npc.dialogues.find(d => ev(d.when, state));
      if (!entry) return state;
      c.log.push(`${npc.name}に話しかけた`);
      return runQueue(c, enqueue(state, [{ type: "dialogue", dialogue: entry.dialogue }]));
    }
    const carryable = !state.carrying && visibleEntities(state, map).find(e => e.x === front.x && e.y === front.y && e.state.carryable);
    if (carryable) {
      const home = map.entities.some(e => e.id === carryable.entity.id) ? map.id : entityHome.get(carryable.entity.id)!;
      c.log.push(`${carryable.state.name ?? carryable.entity.name}を持ち上げた`);
      return { ...state, carrying: { id: carryable.entity.id, home } };
    }
    const entity = visibleEntities(state, map).find(e => e.x === front.x && e.y === front.y && (e.state.trigger === "action" || e.state.trigger === "touch"));
    if (entity) {
      // Living entities turn to face the player.
      if (entity.state.sprite) state = { ...state, entities: { ...state.entities, [map.id]: { ...state.entities[map.id], [entity.entity.id]: { x: entity.x, y: entity.y, facing: OPPOSITE[state.player.facing] } } } };
      c.log.push(`${entity.state.name ?? entity.entity.name}を調べた`);
      return runQueue(c, enqueue(state, entityEffects(c, state, entity.state)));
    }
    const items = visibleInteractables(state, map).filter(i => i.trigger === "action");
    const target = items.find(i => i.x === front.x && i.y === front.y) ?? items.find(i => i.x === state.player.x && i.y === state.player.y);
    if (target) {
      const event = content.events[target.event];
      if (!event) throw new Error(`イベント '${target.event}' がありません`);
      return runQueue(c, enqueue(state, eventEffects(c, state, event)));
    }
    const tile = tiles.get(codeAt(state, map, front.x, front.y));
    if (tile?.inspect) {
      const holds = ev(tile.inspect.when, state);
      c.log.push(`${tile.name}を調べた${holds ? "" : "（条件を満たしていない）"}`);
      return runQueue(c, enqueue(state, holds ? tile.inspect.effects : tile.inspect.otherwise));
    }
    for (const id of regionsAt(state, content, env)) {
      const region = map.regions.find(r => r.id === id);
      if (region?.inspect.length) return runQueue(c, enqueue(state, region.inspect));
    }
    // Nothing answered: "examine" rules decide what examining empty space means.
    return runQueue(c, fireFieldRules(c, state, "examine"));
  }

  /** What is in front of the player (for the {"front"} condition). Guarded against conditions that look at themselves. */
  let lookingFront = false;
  function frontInfo(state: GameState): FrontInfo | undefined {
    const map = content.maps[state.mapId];
    if (!map || lookingFront) return undefined;
    lookingFront = true;
    try {
      const x = state.player.x + DELTAS[state.player.facing].x, y = state.player.y + DELTAS[state.player.facing].y;
      return {
        tile: codeAt(state, map, x, y),
        entities: visibleEntities(state, map).filter(e => e.x === x && e.y === y).map(e => e.entity.id),
        npcs: visibleNpcs(state, map).filter(n => n.x === x && n.y === y).map(n => n.id),
        blocked: !isPassable(state, x, y, map),
      };
    } finally { lookingFront = false; }
  }

  /** A self-made verb: its own effects, then every rule listening with on "verb". */
  /** Verbs the player can use right now (known or learned, not forgotten, `when` holds). */
  function usableVerbs(state: GameState): string[] {
    return Object.entries(content.project.verbs).filter(([id, v]) => (v.known || state.verbsLearned?.includes(id)) && !state.verbsForgotten?.includes(id) && ev(v.when, state)).map(([id]) => id);
  }

  /** Things a verb can be used on (verb.target). */
  function verbTargets(state: GameState, id: string): Array<{ id: string; label: string }> {
    const t = content.project.verbs[id]?.target;
    if (!t) return [];
    if (t.from === "items") return Object.entries(state.items).filter(([, n]) => n > 0).map(([item]) => ({ id: item, label: db.items.find(i => i.id === item)?.name ?? item }));
    if (t.from === "set") { const decl = content.project.sets[t.set ?? ""]; return (state.sets[t.set ?? ""] ?? []).map(v => ({ id: v, label: decl?.entries[v] ?? v })); }
    return t.options;
  }

  /** A self-made verb: pick a target if it needs one, then its own effects and every rule listening with on "verb". */
  function doVerb(c: Ctx, state: GameState, id: string, target?: string): GameState {
    const verb = content.project.verbs[id];
    if (!verb) throw new Error(`動詞 '${id}' がありません（project.json の verbs）`);
    if (!usableVerbs(state).includes(id)) { c.log.push(`動詞 ${id}: 今は使えない`); return state; }
    if (verb.target && target === undefined) {
      const options = verbTargets(state, id);
      if (!options.length) return runQueue(c, enqueue(state, [{ type: "message", text: verb.target.none }]));
      return runQueue(c, enqueue(state, [{ type: "choice", prompt: verb.target.prompt ?? `${verb.label}：何に？`, options: [...options.map(o => ({ id: o.id, label: o.label, effects: [{ type: "useVerb" as const, verb: id, target: o.id }] })), { id: "cancel", label: "やめる", effects: [] }] }]));
    }
    c.log.push(`動詞: ${verb.label}${target ? `（${target}）` : ""}`);
    state = target === undefined ? state : { ...state, target };
    state = fireFieldRules(c, state, "verb", id);
    return runQueue(c, enqueue(state, verb.effects));
  }

  /** One world tick: entity behaviours, tick rules, systems' onTick. */
  function tick(c: Ctx, state: GameState): GameState {
    const map = content.maps[state.mapId];
    if (!map) return state;
    state = { ...state, ticks: state.ticks + 1 };
    for (const view of visibleEntities(state, map)) {
      const b = view.state.behavior;
      if (b.type === "still" || state.ticks % b.every !== 0) continue;
      const player = state.player;
      const dist = Math.abs(view.x - player.x) + Math.abs(view.y - player.y);
      let options: Direction[] = [];
      if (b.type === "wander") {
        let roll: number;
        [roll, state] = random(state);
        const all: Direction[] = ["up", "down", "left", "right"];
        const dir = all[Math.floor(roll * 4)]!;
        const nx = view.x + DELTAS[dir].x, ny = view.y + DELTAS[dir].y;
        if (Math.abs(nx - view.entity.x) + Math.abs(ny - view.entity.y) <= b.radius) options = [dir];
      } else if (b.type === "patrol") {
        const index = state.entities[map.id]?.[view.entity.id]?.step ?? 0;
        const target = b.path[index % b.path.length]!;
        if (target.x === view.x && target.y === view.y) {
          state = { ...state, entities: { ...state.entities, [map.id]: { ...state.entities[map.id], [view.entity.id]: { x: view.x, y: view.y, facing: view.facing, step: (index + 1) % b.path.length } } } };
          continue;
        }
        options = towards(view, target);
      } else if (b.type === "chase" && dist <= b.range) {
        if (dist === 1 && view.state.trigger === "touch") { state = touchEntity(c, state, view); if (state.scene.kind !== "field") return state; continue; }
        options = towards(view, player);
      } else if (b.type === "flee" && dist <= b.range) {
        options = towards(view, player).map(d => OPPOSITE[d]);
      }
      for (const dir of options) {
        const nx = view.x + DELTAS[dir].x, ny = view.y + DELTAS[dir].y;
        const occupied = (nx === player.x && ny === player.y) || visibleEntities(state, map).some(o => o.entity.id !== view.entity.id && o.state.solid && o.x === nx && o.y === ny)
          || visibleNpcs(state, map).some(n => n.x === nx && n.y === ny) || map.portals.some(p => p.x === nx && p.y === ny);
        if (!tilePassable(state, map, nx, ny) || occupied) continue;
        const prev = state.entities[map.id]?.[view.entity.id];
        state = { ...state, entities: { ...state.entities, [map.id]: { ...state.entities[map.id], [view.entity.id]: { x: nx, y: ny, facing: dir, ...(prev?.step !== undefined ? { step: prev.step } : {}) } } } };
        if (b.type === "chase" && view.state.trigger === "touch" && Math.abs(nx - player.x) + Math.abs(ny - player.y) === 1) {
          state = touchEntity(c, state, { ...view, x: nx, y: ny, facing: dir });
          if (state.scene.kind !== "field") return state;
        }
        break;
      }
    }
    state = fireFieldRules(c, state, "tick");
    for (const system of active(state)) state = applySystemResult(c, state, system.onTick?.({ content, state }));
    return runQueue(c, state);
  }

  function towards(from: { x: number; y: number }, to: { x: number; y: number }): Direction[] {
    const dx = to.x - from.x, dy = to.y - from.y;
    const h: Direction | null = dx > 0 ? "right" : dx < 0 ? "left" : null;
    const v: Direction | null = dy > 0 ? "down" : dy < 0 ? "up" : null;
    return (Math.abs(dx) >= Math.abs(dy) ? [h, v] : [v, h]).filter((d): d is Direction => d !== null);
  }

  function fieldUse(c: Ctx, state: GameState, kind: "ability" | "item", id: string): GameState {
    const paid = payForUse(c, state, kind, id, "field");
    if (typeof paid === "string") return { ...state, scene: { kind: "message", text: paid } };
    return runQueue(c, enqueue(paid[0], paid[1]));
  }

  function sceneInput(c: Ctx, state: GameState, input: SceneInput): GameState {
    if (state.scene.kind !== "custom") return state;
    const scene = state.scene;
    const def = sorted.find(sys => sys.id === scene.system)?.scenes?.[scene.scene];
    if (!def) throw new Error(`画面 ${scene.system}.${scene.scene} の定義がありません`);
    const result = def.input({ content, state }, scene.data, input);
    c.log.push(...(result.log ?? []));
    let next = result.state ?? state;
    if (result.apply?.length) next = runNow(c, next, result.apply);
    if (scene.battle && (result.outcome || result.close)) {
      const outcome = result.outcome ?? "fled";
      return finishModuleBattle(c, enqueue(next, result.effects ?? []), scene.battle, outcome, result.battleLog ?? []);
    }
    if (result.close) return runQueue(c, enqueue({ ...next, scene: { kind: "field" } }, result.effects ?? []));
    next = { ...next, scene: { ...scene, data: result.data === undefined ? scene.data : result.data } };
    return enqueue(next, result.effects ?? []);
  }

  /* ---------------------------------------------------------------- new game & cycles */
  const SET_PERSIST = (id: string) => id === "endings" || content.project.sets[id]?.persist === "meta";

  function metaOf(state: GameState): MetaState {
    const { project } = content;
    return {
      cycle: state.cycle ?? 1,
      flags: Object.fromEntries(Object.entries(project.flags).filter(([, d]) => d.persist === "meta").map(([id]) => [id, state.flags[id] ?? false])),
      vars: Object.fromEntries(Object.entries(project.variables).filter(([, d]) => d.persist === "meta").map(([id, d]) => [id, state.vars[id] ?? d.initial])),
      sets: Object.fromEntries(Object.entries(state.sets ?? {}).filter(([id]) => SET_PERSIST(id))),
    };
  }

  function freshState(seed: number, meta?: MetaState): GameState {
    const { project } = content;
    let state: GameState = {
      mapId: project.start.mapId,
      player: { x: project.start.x, y: project.start.y, facing: project.start.facing, hp: project.player.stats.maxHp, stats: { ...project.player.stats } },
      abilities: [...project.player.abilities],
      traits: [],
      items: { ...project.player.items },
      flags: { ...Object.fromEntries(Object.entries(project.flags).map(([id, decl]) => [id, decl.initial])), ...meta?.flags },
      vars: { ...Object.fromEntries(Object.entries(project.variables).map(([id, decl]) => [id, decl.initial])), ...meta?.vars },
      sets: { ...Object.fromEntries(Object.keys(project.sets).map(id => [id, [] as string[]])), ...meta?.sets },
      tileOverrides: {},
      entities: {},
      timers: [],
      cycle: meta?.cycle ?? 1,
      ticks: 0,
      regions: [],
      fired: [],
      done: [],
      scene: { kind: "field" },
      queue: [],
      systemData: {},
      rng: seed >>> 0,
      steps: 0,
    };
    state = { ...state, player: { ...state.player, hp: stats(state).maxHp } };
    return state;
  }

  const introEffects = (): Effect[] => [...content.project.player.traits.map(trait => ({ type: "grantTrait", trait }) as Effect), ...content.project.intro];

  function newGame(seed = DEFAULT_SEED, meta?: MetaState): GameState {
    const c: Ctx = { log: [], cues: [] };
    let state = runQueue(c, enqueue(freshState(seed, meta), introEffects()));
    state = updateRegions(c, state, false);
    state = runQueue(c, state);
    return runAuto(c, runEntityAutos(c, state));
  }

  function step(state: GameState, action: Action): StepResult {
    const c: Ctx = { log: [], cues: [] };
    // Systems may rewrite or swallow the action first (changing the rules of control itself).
    for (const system of active(state)) {
      if (!system.onAction) continue;
      const result = system.onAction({ content, state }, action as unknown as PlayerAction);
      if (!result) continue;
      const changed = applySystemResult(c, state, result);
      if (result.cancel) {
        const settled = changed.scene.kind === "field" ? runAuto(c, runEntityAutos(c, runQueue(c, changed))) : changed;
        return { state: settled, log: c.log, cues: c.cues };
      }
      state = changed;
      if (result.action) action = result.action as unknown as Action;
    }
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
        if (scene.kind === "field") next = fieldUse(c, state, "item", action.item);
        break;
      case "useAbility":
        if (scene.kind === "field") next = fieldUse(c, state, "ability", action.ability);
        break;
      case "tick":
        if (scene.kind === "field") next = tick(c, state);
        break;
      case "verb":
        if (scene.kind === "field") next = doVerb(c, state, action.verb);
        break;
      case "equip": {
        if (scene.kind !== "field") break;
        const item = db.items.find(i => i.id === action.item);
        if (!item?.slot) break;
        const worn = action.companion ? state.party?.find(m => m.id === action.companion)?.equipment?.[item.slot] === item.id : state.equipment?.[item.slot] === item.id;
        next = runQueue(c, applyEffect(c, state, worn ? { type: "unequip", slot: item.slot, ...(action.companion ? { companion: action.companion } : {}) } : { type: "equip", item: item.id, ...(action.companion ? { companion: action.companion } : {}) }));
        break;
      }
      case "sceneInput":
        next = sceneInput(c, state, action.input);
        break;
      case "command": {
        if (scene.kind !== "field") break;
        const ran = runCommand(c, state, action.source, action.id, "field");
        next = typeof ran === "string" ? { ...state, scene: { kind: "message", text: ran } } : runQueue(c, ran[0]);
        break;
      }
      case "advance":
        if (scene.kind === "message") next = runQueue(c, { ...state, scene: { kind: "field" } });
        else if (scene.kind === "dialogue") {
          const dialogue = content.dialogues[scene.dialogueId]!;
          const lines = dialogueLines(state, dialogue.id);
          if (scene.line + 1 < lines.length) next = { ...state, scene: { ...scene, line: scene.line + 1 } };
          else if (dialogue.choices.some(choice => ev(choice.when, state))) next = { ...state, scene: { kind: "choice", dialogueId: dialogue.id } };
          else next = runQueue(c, enqueue({ ...state, scene: { kind: "field" } }, dialogue.effects));
        } else if (scene.kind === "battle") next = closeBattle(c, state);
        else if (scene.kind === "ending") next = runQueue(c, applyEffect(c, { ...state, scene: { kind: "field" } }, { type: "newCycle" }));
        break;
      case "choose": {
        if (scene.kind === "prompt") {
          const option = scene.options.find(o => o.id === action.choiceId || o.label === action.choiceId);
          if (option) next = runQueue(c, enqueue({ ...state, scene: { kind: "field" } }, option.effects));
          break;
        }
        if (scene.kind !== "choice") break;
        const dialogue = content.dialogues[scene.dialogueId]!;
        const choice = dialogue.choices.find(item => (item.id === action.choiceId || item.label === action.choiceId) && ev(item.when, state));
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
    if (next !== state && next.scene.kind === "field") next = runQueue(c, next);
    if (next !== state) next = runAuto(c, runEntityAutos(c, next));
    return { state: next, log: c.log, cues: c.cues };
  }

  function run(state: GameState, effects: Effect[]): StepResult {
    const c: Ctx = { log: [], cues: [] };
    let next = state.scene.kind === "battle" ? checkBattleEnd(c, runNow(c, state, effects)) : runQueue(c, enqueue(state, effects));
    if (next.scene.kind === "field") next = runQueue(c, updateRegions(c, next, false));
    next = runAuto(c, runEntityAutos(c, next));
    return { state: next, log: c.log, cues: c.cues };
  }

  return {
    content,
    systems: sorted,
    newGame,
    metaOf,
    usableVerbs,
    companionStats,
    visibleEntities: (state, map) => visibleEntities(state, map),
    regions: state => regionsAt(state, content, env),
    hudLines: state => active(state).flatMap(sys => sys.hud?.({ content, state }) ?? []),
    activeSystems: state => active(state),
    levelInfo: state => {
      const lv = content.project.leveling;
      if (!lv) return undefined;
      const level = state.player.level ?? 1;
      return { level, exp: state.player.exp ?? 0, next: level >= lv.maxLevel ? null : expToNext(level) };
    },
    commands: (state, where) => scriptCommands(state, where),
    step,
    run,
    isPassable: (state, x, y) => isPassable(state, x, y),
    tileAt,
    codeAt,
    rowsFor,
    tileIndex: (state, tile) => (tile.openIndex !== undefined && tile.passableWhen && ev(tile.passableWhen, state) ? tile.openIndex : tile.index),
    visibleNpcs,
    visibleInteractables,
    dialogueLines,
    stats,
    abilities: state => abilitiesOf(state, content),
    usables,
    text: (state, template) => text(template, state),
    evaluate: (condition, state) => ev(condition, state),
  };
}

/**
 * The playable game: canvas + DOM windows (messages, choices, battle, menu) + keyboard/touch input.
 * Used unchanged by the studio play-test and by the static build, so both always behave identically.
 */
import type { AssetEntry, Direction, GameContent, GameState } from "../../schema/src/formats";
import { createEngine, evaluate, makeSave, readSave, type Action, type Engine, type GameSystem, type StepResult } from "../../engine/src/index";
import { directionFromKey, GridMovementAnimator, WALK_ANIMATION_MS, type Point } from "./movement";
import { drawEnemyPortrait, drawMap, loadImages, npcActors, TILE, type ImageMap } from "./render";
import { RUNTIME_CSS } from "./styles";

export interface SaveStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

export interface MountOptions {
  content: GameContent;
  systems?: GameSystem[];
  resolveAsset: (asset: AssetEntry) => string | Promise<string>;
  storage?: SaveStorage;
  initialState?: GameState;
  /** "window": the page is the game. "focus": only when the game element has focus (studio). */
  keyboard?: "window" | "focus";
  onLog?: (lines: string[], state: GameState) => void;
  onStateChange?: (state: GameState) => void;
  onError?: (error: Error) => void;
  seed?: number;
}

export interface GameHandle {
  readonly engine: Engine;
  getState(): GameState;
  setState(state: GameState): void;
  dispatch(action: Action): StepResult | null;
  restart(): void;
  focus(): void;
  destroy(): void;
}

const VIEW_COLS = 20;
const VIEW_ROWS = 14;
const TEXT_SPEED_MS = 22;
const OPPOSITE: Record<Direction, Direction> = { up: "down", down: "up", left: "right", right: "left" };

export function browserStorage(): SaveStorage {
  return {
    read(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
    write(key, value) { try { window.localStorage.setItem(key, value); } catch { throw new Error("ブラウザの保存領域を使えません（プライベートモード等）"); } },
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function injectStyles() {
  if (document.getElementById("rpg-runtime-styles")) return;
  const style = el("style");
  style.id = "rpg-runtime-styles";
  style.textContent = RUNTIME_CSS;
  document.head.appendChild(style);
}

class Beeper {
  private ctx: AudioContext | null = null;
  muted = false;
  play(kind: "step" | "bump" | "ok" | "hit" | "hurt" | "win" | "lose" | "open") {
    if (this.muted) return;
    try {
      this.ctx ??= new AudioContext();
      const table: Record<string, [number, number, OscillatorType, number]> = {
        step: [0, 0, "square", 0], bump: [110, 0.06, "square", 0.04], ok: [660, 0.07, "square", 0.05], open: [520, 0.12, "triangle", 0.06],
        hit: [180, 0.09, "sawtooth", 0.06], hurt: [90, 0.16, "sawtooth", 0.07], win: [880, 0.25, "triangle", 0.06], lose: [70, 0.4, "triangle", 0.07],
      };
      const [freq, dur, type, vol] = table[kind]!;
      if (!freq) return;
      const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
      osc.type = type; osc.frequency.value = freq;
      if (kind === "win") osc.frequency.linearRampToValueAtTime(freq * 1.5, this.ctx.currentTime + dur);
      gain.gain.value = vol; gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(); osc.stop(this.ctx.currentTime + dur);
    } catch { /* audio is optional */ }
  }
}

export function mountGame(host: HTMLElement, options: MountOptions): GameHandle {
  injectStyles();
  const { content } = options;
  const engine = createEngine(content, options.systems ?? []);
  const storage = options.storage ?? browserStorage();
  const saveKey = `rpg-save:${content.project.id}`;
  const beeper = new Beeper();

  let state: GameState = options.initialState ?? engine.newGame(options.seed);
  const animator = new GridMovementAnimator({ x: state.player.x, y: state.player.y });
  let renderPos: Point = { x: state.player.x, y: state.player.y };
  let walkFrame = 0;
  let lastFrameSwap = 0;
  const held: Direction[] = [];
  let talkFacing: Record<string, Direction> = {};
  let selection = 0;
  let itemPicker = false;
  let menuOpen = false;
  let toast: { text: string; until: number } | null = null;
  let typing = { text: "", startedAt: 0, done: true };
  let fadeUntil = 0;
  let shakeUntil = 0;
  let destroyed = false;
  let raf = 0;
  let images: ImageMap = {};

  /* ------------------------------------------------------------ DOM */
  const root = el("div", "rpg-root");
  root.tabIndex = 0;
  root.setAttribute("role", "application");
  root.setAttribute("aria-label", `${content.project.title}（ゲーム）`);
  const screen = el("div", "rpg-screen");
  const canvas = el("canvas", "rpg-canvas");
  canvas.width = VIEW_COLS * TILE; canvas.height = VIEW_ROWS * TILE;
  const ctx = canvas.getContext("2d")!;
  const hud = el("div", "rpg-hud");
  const fade = el("div", "rpg-fade");
  const windowLayer = el("div", "rpg-layer");
  const live = el("div", "rpg-sr"); live.setAttribute("aria-live", "polite");
  screen.append(canvas, hud, fade, windowLayer, live);
  const touch = el("div", "rpg-touch");
  root.append(screen, touch);
  host.appendChild(root);

  // Touch controls.
  const pad = el("div", "rpg-dpad");
  for (const [dir, label, glyph] of [["up", "上", "▲"], ["left", "左", "◀"], ["right", "右", "▶"], ["down", "下", "▼"]] as const) {
    const button = el("button", `rpg-dpad-${dir}`, glyph);
    button.type = "button"; button.setAttribute("aria-label", `${label}へ移動`);
    button.addEventListener("pointerdown", event => { event.preventDefault(); button.setPointerCapture?.(event.pointerId); press(dir); });
    const release = () => releaseDir(dir);
    button.addEventListener("pointerup", release); button.addEventListener("pointercancel", release); button.addEventListener("lostpointercapture", release);
    pad.appendChild(button);
  }
  const ab = el("div", "rpg-ab");
  const aButton = el("button", "rpg-a", "A"); aButton.type = "button"; aButton.title = "決定 / 調べる (Enter・Z)";
  const bButton = el("button", "rpg-b", "B"); bButton.type = "button"; bButton.title = "メニュー / 戻る (Esc・X)";
  aButton.addEventListener("click", () => confirm());
  bButton.addEventListener("click", () => cancel());
  ab.append(bButton, aButton);
  touch.append(pad, ab);

  /* ------------------------------------------------------------ engine glue */
  function fail(error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    showToast(`実行時エラー: ${err.message}`, 6000);
    options.onError?.(err);
  }

  function dispatch(action: Action): StepResult | null {
    let result: StepResult;
    try { result = engine.step(state, action); } catch (error) { fail(error); return null; }
    apply(result, action);
    return result;
  }

  function apply(result: StepResult, action?: Action) {
    const before = state;
    state = result.state;
    for (const cue of result.cues) {
      if (cue.kind === "moved") { animator.enqueue({ x: state.player.x, y: state.player.y }); }
      else if (cue.kind === "bump") beeper.play("bump");
      else if (cue.kind === "battleStart") { beeper.play("open"); fadeUntil = performance.now() + 260; }
      else if (cue.kind === "hit") { beeper.play(cue.target === "enemy" ? "hit" : "hurt"); if (cue.target === "player") shakeUntil = performance.now() + 220; }
      else if (cue.kind === "battleEnd") beeper.play(cue.outcome === "victory" ? "win" : cue.outcome === "defeat" ? "lose" : "ok");
    }
    if (state.mapId !== before.mapId || result.cues.some(c => c.kind === "mapChanged") || Math.abs(state.player.x - before.player.x) + Math.abs(state.player.y - before.player.y) > 1) {
      animator.reset({ x: state.player.x, y: state.player.y });
      renderPos = animator.currentPosition;
      if (state.mapId !== before.mapId) fadeUntil = performance.now() + 220;
    }
    if (action?.type === "interact" && before.scene.kind === "field" && state.scene.kind === "dialogue") {
      const front = { x: before.player.x + ({ up: 0, down: 0, left: -1, right: 1 })[before.player.facing], y: before.player.y + ({ up: -1, down: 1, left: 0, right: 0 })[before.player.facing] };
      const npc = engine.visibleNpcs(state).find(n => n.x === front.x && n.y === front.y);
      if (npc) talkFacing = { [npc.id]: OPPOSITE[before.player.facing] };
    }
    if (state.scene.kind === "field") talkFacing = {};
    if (state.scene.kind !== before.scene.kind || state.scene !== before.scene) { selection = 0; itemPicker = false; }
    if (result.log.length) options.onLog?.(result.log, state);
    if (state !== before) options.onStateChange?.(state);
    renderUI();
  }

  /* ------------------------------------------------------------ input */
  function press(dir: Direction) {
    if (state.scene.kind === "field" && !menuOpen) {
      const fresh = !held.includes(dir);
      if (fresh) held.push(dir);
      // Take the first step on key-down so a quick tap (released before the next frame) still moves / turns.
      if (fresh && !animator.update(performance.now()).moving) dispatch({ type: "move", direction: dir });
      return;
    }
    navigate(dir);
  }
  function releaseDir(dir: Direction) {
    const i = held.indexOf(dir);
    if (i >= 0) held.splice(i, 1);
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(windowLayer.querySelectorAll<HTMLButtonElement>("button[data-nav]:not(:disabled)"));
  }
  function navigate(dir: Direction) {
    const list = buttons();
    if (!list.length) return;
    const grid = windowLayer.querySelector("[data-grid]") ? 2 : 1;
    const delta = dir === "up" ? -grid : dir === "down" ? grid : dir === "left" ? -1 : 1;
    if (grid === 1 && (dir === "left" || dir === "right")) return;
    selection = (selection + delta + list.length) % list.length;
    beeper.play("step");
    highlight();
  }
  function highlight() {
    buttons().forEach((button, index) => button.classList.toggle("is-selected", index === selection));
  }

  function confirm() {
    if (menuOpen || state.scene.kind === "choice" || (state.scene.kind === "battle")) {
      if (!typing.done) { finishTyping(); return; }
      const list = buttons();
      list[Math.min(selection, list.length - 1)]?.click();
      return;
    }
    if (state.scene.kind === "message" || state.scene.kind === "dialogue") {
      if (!typing.done) { finishTyping(); return; }
      beeper.play("ok");
      dispatch({ type: "advance" });
      return;
    }
    if (state.scene.kind === "field" && !animator.update(performance.now()).moving) dispatch({ type: "interact" });
  }
  function cancel() {
    if (state.scene.kind === "battle" && itemPicker) { itemPicker = false; selection = 0; renderUI(); return; }
    if (state.scene.kind !== "field") return;
    menuOpen = !menuOpen; selection = 0; held.length = 0;
    beeper.play("ok");
    renderUI();
  }

  const isTextTarget = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
  const accepts = (event: KeyboardEvent) => !isTextTarget(event.target) && (options.keyboard !== "focus" || root.contains(document.activeElement));
  function onKeyDown(event: KeyboardEvent) {
    if (!accepts(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    const dir = directionFromKey(event.key);
    if (dir) { event.preventDefault(); if (!event.repeat || state.scene.kind === "field") press(dir); return; }
    const key = event.key.toLowerCase();
    if (key === "enter" || key === " " || key === "z") { event.preventDefault(); if (!event.repeat) confirm(); }
    else if (key === "escape" || key === "x" || key === "m") { event.preventDefault(); if (!event.repeat) cancel(); }
    else if (state.scene.kind === "battle" && /^[1-4]$/.test(key)) { selection = Number(key) - 1; confirm(); }
  }
  function onKeyUp(event: KeyboardEvent) {
    const dir = directionFromKey(event.key);
    if (dir) releaseDir(dir);
  }
  const onBlur = () => { held.length = 0; };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  root.addEventListener("focusout", event => { if (!root.contains(event.relatedTarget as Node | null)) held.length = 0; });
  canvas.addEventListener("pointerdown", () => { root.focus({ preventScroll: true }); if (state.scene.kind !== "field") confirm(); });

  /* ------------------------------------------------------------ windows */
  function startTyping(text: string) {
    if (typing.text === text && typing.startedAt) return;
    typing = { text, startedAt: performance.now(), done: false };
    live.textContent = text;
  }
  function finishTyping() { typing = { ...typing, done: true }; updateTyping(performance.now()); }
  function updateTyping(now: number) {
    const target = windowLayer.querySelector<HTMLElement>("[data-typing]");
    if (!target) return;
    const count = typing.done ? typing.text.length : Math.min(typing.text.length, Math.floor((now - typing.startedAt) / TEXT_SPEED_MS));
    if (count >= typing.text.length && !typing.done) { typing = { ...typing, done: true }; renderCaret(); }
    const visible = Array.from(typing.text).slice(0, count).join("");
    if (target.textContent !== visible) target.textContent = visible;
  }
  function renderCaret() {
    windowLayer.querySelector(".rpg-caret")?.classList.toggle("is-ready", typing.done);
  }

  function messageWindow(speaker: string | undefined, text: string, extra?: HTMLElement) {
    const box = el("div", "rpg-window rpg-message");
    if (speaker) box.appendChild(el("div", "rpg-speaker", speaker));
    const body = el("div", "rpg-text"); body.dataset.typing = "1";
    box.append(body);
    if (!extra) box.appendChild(el("span", "rpg-caret", "▼"));
    box.addEventListener("click", () => { if (!extra) confirm(); });
    startTyping(text);
    windowLayer.appendChild(box);
    if (extra) windowLayer.appendChild(extra);
  }

  function navButton(label: string, onClick: () => void, opts: { disabled?: boolean; hint?: string } = {}) {
    const button = el("button", "rpg-option");
    button.type = "button"; button.dataset.nav = "1";
    button.append(el("span", "rpg-option-label", label));
    if (opts.hint) button.append(el("span", "rpg-option-hint", opts.hint));
    button.disabled = Boolean(opts.disabled);
    button.addEventListener("click", event => { event.stopPropagation(); beeper.play("ok"); onClick(); root.focus({ preventScroll: true }); });
    button.addEventListener("pointerenter", () => { selection = buttons().indexOf(button); highlight(); });
    return button;
  }

  function hpBar(current: number, max: number, className: string) {
    const bar = el("div", `rpg-bar ${className}`);
    const fill = el("div", "rpg-bar-fill");
    fill.style.width = `${Math.max(0, Math.min(100, (current / max) * 100))}%`;
    bar.appendChild(fill);
    return bar;
  }

  let portraitCanvas: HTMLCanvasElement | null = null;

  function renderUI() {
    windowLayer.replaceChildren();
    portraitCanvas = null;
    const map = content.maps[state.mapId];
    // HUD
    hud.replaceChildren();
    const title = el("div", "rpg-hud-title", map?.title ?? state.mapId);
    const hp = el("div", "rpg-hud-hp");
    hp.append(el("span", "rpg-hud-label", `${content.project.player.name}  HP ${state.player.hp}/${state.player.stats.maxHp}`), hpBar(state.player.hp, state.player.stats.maxHp, state.player.hp <= state.player.stats.maxHp / 4 ? "is-low" : ""));
    hud.append(title, hp);
    hud.hidden = state.scene.kind === "battle";
    root.dataset.scene = menuOpen ? "menu" : state.scene.kind;

    const scene = state.scene;
    if (scene.kind === "message") messageWindow(scene.speaker, scene.text);
    else if (scene.kind === "dialogue") {
      const dialogue = content.dialogues[scene.dialogueId]!;
      messageWindow(dialogue.speaker, dialogue.lines[scene.line] ?? "");
    } else if (scene.kind === "choice") {
      const dialogue = content.dialogues[scene.dialogueId]!;
      const list = el("div", "rpg-window rpg-choices");
      for (const choice of dialogue.choices) {
        if (!evaluate(choice.when, state)) continue;
        list.appendChild(navButton(choice.label, () => dispatch({ type: "choose", choiceId: choice.id })));
      }
      messageWindow(dialogue.speaker, dialogue.lines[dialogue.lines.length - 1] ?? "", list);
      typing = { ...typing, done: true };
    } else if (scene.kind === "battle") renderBattle(scene.battle);
    else if (menuOpen) renderMenu();
    if (toast && toast.until > performance.now()) windowLayer.appendChild(el("div", "rpg-toast", toast.text));
    selection = Math.min(selection, Math.max(0, buttons().length - 1));
    highlight();
    updateTyping(performance.now());
  }

  function renderBattle(battle: Extract<GameState["scene"], { kind: "battle" }>["battle"]) {
    const enemy = content.database.enemies.find(e => e.id === battle.enemyId)!;
    const panel = el("div", "rpg-battle");
    const stage = el("div", "rpg-battle-stage");
    portraitCanvas = el("canvas", "rpg-portrait");
    portraitCanvas.width = 128; portraitCanvas.height = 128;
    const enemyInfo = el("div", "rpg-enemy-info");
    enemyInfo.append(el("div", "rpg-enemy-name", enemy.name), hpBar(battle.enemyHp, enemy.stats.maxHp, "is-enemy"));
    stage.append(enemyInfo, portraitCanvas);
    const status = el("div", "rpg-window rpg-battle-status");
    status.append(el("div", "rpg-speaker", `${content.project.player.name}`), el("div", "rpg-battle-hp", `HP ${state.player.hp} / ${state.player.stats.maxHp}`), hpBar(state.player.hp, state.player.stats.maxHp, state.player.hp <= state.player.stats.maxHp / 4 ? "is-low" : ""));
    const log = el("div", "rpg-window rpg-battle-log");
    for (const line of battle.log.slice(-4)) log.appendChild(el("div", "rpg-log-line", line));
    live.textContent = battle.log[battle.log.length - 1] ?? "";
    const commands = el("div", "rpg-window rpg-commands");
    if (battle.outcome !== "ongoing") {
      const label = battle.outcome === "victory" ? "勝利！ 次へ" : battle.outcome === "fled" ? "フィールドへ戻る" : "次へ";
      commands.appendChild(navButton(label, () => dispatch({ type: "advance" })));
    } else if (itemPicker) {
      const usable = content.database.items.filter(item => item.heal && (state.items[item.id] ?? 0) > 0);
      for (const item of usable) commands.appendChild(navButton(item.name, () => dispatch({ type: "battle", command: "item", item: item.id }), { hint: `×${state.items[item.id]}` }));
      commands.appendChild(navButton("もどる", () => { itemPicker = false; selection = 0; renderUI(); }));
    } else {
      commands.dataset.grid = "2";
      const hasItems = content.database.items.some(item => item.heal && (state.items[item.id] ?? 0) > 0);
      commands.append(
        navButton("たたかう", () => dispatch({ type: "battle", command: "attack" }), { hint: "1" }),
        navButton("ぼうぎょ", () => dispatch({ type: "battle", command: "guard" }), { hint: "2" }),
        navButton("どうぐ", () => { itemPicker = true; selection = 0; renderUI(); }, { hint: "3", disabled: !hasItems }),
        navButton("にげる", () => dispatch({ type: "battle", command: "flee" }), { hint: "4", disabled: !battle.canFlee }),
      );
    }
    const bottom = el("div", "rpg-battle-bottom");
    bottom.append(status, log, commands);
    panel.append(stage, bottom);
    windowLayer.appendChild(panel);
  }

  function renderMenu() {
    const menu = el("div", "rpg-window rpg-menu");
    menu.appendChild(el("div", "rpg-menu-title", "メニュー"));
    const stats = el("div", "rpg-menu-stats");
    const s = state.player.stats;
    stats.textContent = `${content.project.player.name}　HP ${state.player.hp}/${s.maxHp}　攻撃 ${s.attack}　防御 ${s.defense}`;
    menu.appendChild(stats);
    const section = (title: string) => menu.appendChild(el("div", "rpg-menu-section", title));
    section("どうぐ");
    const owned = Object.entries(state.items);
    if (!owned.length) menu.appendChild(el("div", "rpg-menu-empty", "何も持っていない"));
    for (const [id, count] of owned) {
      const item = content.database.items.find(i => i.id === id);
      menu.appendChild(navButton(`${item?.name ?? id}`, () => { if (item?.heal) { menuOpen = false; dispatch({ type: "useItem", item: id }); } else showToast(item?.description || "使えない。"); }, { hint: `×${count}${item?.heal ? "　使う" : ""}` }));
    }
    section("のうりょく");
    for (const id of state.abilities) {
      const ability = content.database.abilities.find(a => a.id === id);
      const row = el("div", "rpg-menu-ability");
      row.append(el("strong", undefined, ability?.name ?? id), el("span", undefined, ability?.description ?? ""));
      menu.appendChild(row);
    }
    section("きろく");
    const row = el("div", "rpg-menu-row");
    row.append(
      navButton("セーブ", () => save()),
      navButton("ロード", () => load()),
      navButton(beeper.muted ? "音: オフ" : "音: オン", () => { beeper.muted = !beeper.muted; renderUI(); }),
      navButton("とじる", () => { menuOpen = false; renderUI(); }),
    );
    menu.appendChild(row);
    windowLayer.appendChild(menu);
  }

  function showToast(text: string, ms = 2400) {
    toast = { text, until: performance.now() + ms };
    renderUI();
    window.setTimeout(() => { if (!destroyed && toast && toast.until <= performance.now()) { toast = null; renderUI(); } }, ms + 30);
  }

  function save() {
    try {
      storage.write(saveKey, JSON.stringify(makeSave(content, state)));
      showToast("セーブしました。");
    } catch (error) { showToast(`セーブできません: ${error instanceof Error ? error.message : String(error)}`); }
  }
  function load() {
    const raw = storage.read(saveKey);
    if (!raw) { showToast("セーブデータがありません。"); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { showToast("セーブデータが壊れています。新しく始めることができます。"); return; }
    const result = readSave(parsed, content);
    if (!result.ok) { showToast(`${result.reason}。新しく始めることができます。`, 4000); return; }
    menuOpen = false;
    setState(result.save.state);
    showToast(result.migrated ? "旧形式のセーブを変換して読み込みました。" : "ロードしました。");
  }

  function setState(next: GameState) {
    state = next;
    animator.reset({ x: state.player.x, y: state.player.y });
    renderPos = animator.currentPosition;
    talkFacing = {};
    held.length = 0;
    options.onStateChange?.(state);
    renderUI();
  }

  /* ------------------------------------------------------------ frame loop */
  function frame(now: number) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const moving = animator.update(now);
    renderPos = moving.position;
    if (!moving.moving && state.scene.kind === "field" && !menuOpen && held.length) {
      const dir = held[held.length - 1]!;
      dispatch({ type: "move", direction: dir });
      const after = animator.update(now);
      renderPos = after.position;
    }
    if (moving.moving && now - lastFrameSwap > WALK_ANIMATION_MS / 2) { walkFrame = (walkFrame + 1) % 4; lastFrameSwap = now; }
    if (!moving.moving && !held.length) walkFrame = 0;

    const map = content.maps[state.mapId];
    if (map) {
      const cam = {
        x: Math.max(0, Math.min(map.width - VIEW_COLS, renderPos.x - (VIEW_COLS - 1) / 2)),
        y: Math.max(0, Math.min(map.height - VIEW_ROWS, renderPos.y - (VIEW_ROWS - 1) / 2)),
      };
      const npcs = engine.visibleNpcs(state, map);
      drawMap(ctx, {
        content, map, images, state, time: now,
        view: { camera: cam, cols: VIEW_COLS, rows: VIEW_ROWS },
        interactables: engine.visibleInteractables(state, map),
        actors: [
          ...npcActors(content, map, npcs, { facingOverride: talkFacing }),
          { id: "player", kind: "player", x: renderPos.x, y: renderPos.y, facing: state.player.facing, sprite: content.project.player.sprite, frame: walkFrame },
        ],
      });
    }
    const fading = fadeUntil - now;
    fade.style.opacity = fading > 0 ? String(Math.min(1, fading / 220)) : "0";
    screen.classList.toggle("is-shaking", shakeUntil > now);
    if (portraitCanvas && state.scene.kind === "battle") {
      const battle = state.scene.battle;
      const enemy = content.database.enemies.find(e => e.id === battle.enemyId);
      const asset = enemy?.sprite ? content.assets.assets.find(a => a.id === enemy.sprite) : undefined;
      const pctx = portraitCanvas.getContext("2d")!;
      if (battle.outcome === "victory") { pctx.clearRect(0, 0, 128, 128); }
      else drawEnemyPortrait(pctx, battle.enemyId, 128, now, enemy?.sprite ? images[enemy.sprite] : undefined, asset);
    }
    if (!typing.done) updateTyping(now);
  }

  images = loadImages(content, options.resolveAsset);
  renderUI();
  raf = requestAnimationFrame(frame);

  return {
    engine,
    getState: () => state,
    setState,
    dispatch,
    restart() { menuOpen = false; setState(engine.newGame(options.seed)); },
    focus() { root.focus({ preventScroll: true }); },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      root.remove();
    },
  };
}

/**
 * The playable game: canvas + DOM windows (messages, choices, battle, menu) + keyboard/touch input.
 * Used unchanged by the studio play-test and by the static build, so both always behave identically.
 */
import type { AssetEntry, Direction, GameContent, GameState } from "../../schema/src/formats";
import { createEngine, makeSave, readSave, type Action, type Engine, type GameSystem, type StepResult } from "../../engine/src/index";
import { directionFromKey, GridMovementAnimator, WALK_ANIMATION_MS, type Point } from "./movement";
import { drawEnemyPortrait, drawMap, loadImages, npcActors, TILE, type ImageMap } from "./render";
import { RUNTIME_CSS } from "./styles";
import { AudioManager, type AudioSettings } from "./audio";
import { creditLines } from "./credits";

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
  /** Load cross-cycle memories (meta) from storage on start. Default true. */
  useMeta?: boolean;
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
  if (className) {
    node.className = className;
    // For the studio's 「コードを探す」: which runtime code draws this part (search the class name here; look in styles.ts for its look).
    node.dataset.src = `packages/runtime/src/player.ts#${className.split(" ").pop()}`;
  }
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

export function mountGame(host: HTMLElement, options: MountOptions): GameHandle {
  injectStyles();
  const { content } = options;
  // Callers pass the project's systems plus the genre modules it enables (the static build bundles only those).
  const engine = createEngine(content, options.systems ?? []);
  const storage = options.storage ?? browserStorage();
  const saveKey = `rpg-save:${content.project.id}`;
  const settingsKey = `rpg-settings:${content.project.id}`;
  const readSettings = (): AudioSettings => { try { return { bgm: true, sfx: true, ...JSON.parse(storage.read(settingsKey) ?? "{}") }; } catch { return { bgm: true, sfx: true }; } };
  const audio = new AudioManager(content, options.resolveAsset, readSettings());
  let creditsOpen = false;
  const metaKey = `rpg-meta:${content.project.id}`;
  const readMeta = () => { try { const raw = storage.read(metaKey); return raw ? JSON.parse(raw) : undefined; } catch { return undefined; } };
  let lastMeta = "";
  const saveMeta = () => {
    const text = JSON.stringify(engine.metaOf(state));
    if (text === lastMeta) return;
    lastMeta = text;
    try { storage.write(metaKey, text); } catch { /* optional */ }
  };
  const ticking = Object.values(content.maps).some(m => m.entities.some(e => e.states.some(st => st.behavior.type !== "still")))
    || content.rules.some(r => r.on === "tick") || engine.systems.some(s => s.onTick);
  let lastTick = 0;
  /** Smooth movement for entities: id → tween. */
  const entityTweens = new Map<string, { fx: number; fy: number; tx: number; ty: number; start: number }>();
  let sceneHost: HTMLElement | null = null;
  /** Buttons held for realtime scenes (shooting etc.). */
  const realtimeHeld = new Set<string>();
  let realtimeCanvas: HTMLCanvasElement | null = null;
  let realtimeClock = 0;
  const realtimeDef = () => {
    if (state.scene.kind !== "custom") return null;
    const scene = state.scene;
    const def = engine.systems.find(s => s.id === scene.system)?.scenes?.[scene.scene];
    return def?.realtime ? def : null;
  };

  let state: GameState = options.initialState ?? engine.newGame(options.seed, options.useMeta === false ? undefined : (() => { try { const raw = (options.storage ?? browserStorage()).read(`rpg-meta:${content.project.id}`); return raw ? JSON.parse(raw) : undefined; } catch { return undefined; } })());
  const animator = new GridMovementAnimator({ x: state.player.x, y: state.player.y });
  let renderPos: Point = { x: state.player.x, y: state.player.y };
  let walkFrame = 0;
  let lastFrameSwap = 0;
  const held: Direction[] = [];
  let talkFacing: Record<string, Direction> = {};
  let selection = 0;
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
  aButton.addEventListener("click", () => { if (!realtimeDef()) confirm(); });
  aButton.addEventListener("pointerdown", () => { if (realtimeDef()) realtimeHeld.add("fire"); });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) aButton.addEventListener(ev, () => realtimeHeld.delete("fire"));
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
      else if (cue.kind === "bump") audio.cue("bump");
      else if (cue.kind === "battleStart") { audio.cue("encounter"); fadeUntil = performance.now() + 260; }
      else if (cue.kind === "hit") { audio.cue(cue.target === "enemy" ? "hit" : "hurt"); if (cue.target === "player") shakeUntil = performance.now() + 220; }
      else if (cue.kind === "battleEnd") {
        if (cue.outcome === "victory") { const v = content.project.audio.victory; if (v) audio.playSound(v); else audio.cue("victory"); }
        else if (cue.outcome === "defeat") audio.cue("defeat");
      }
      else if (cue.kind === "sfx") audio.playSound(cue.sound);
      else if (cue.kind === "item") audio.cue("item");
      else if (cue.kind === "heal") audio.cue("heal");
      else if (cue.kind === "mapChanged") audio.cue("door");
    }
    if (state.mapId !== before.mapId || result.cues.some(c => c.kind === "mapChanged") || Math.abs(state.player.x - before.player.x) + Math.abs(state.player.y - before.player.y) > 1) {
      animator.reset({ x: state.player.x, y: state.player.y });
      renderPos = animator.currentPosition;
      if (state.mapId !== before.mapId) fadeUntil = performance.now() + 220;
    }
    if (action?.type === "interact" && before.scene.kind === "field" && state.scene.kind === "dialogue") {
      const front = { x: before.player.x + ({ up: 0, down: 0, left: -1, right: 1 })[before.player.facing], y: before.player.y + ({ up: -1, down: 1, left: 0, right: 0 })[before.player.facing] };
      const npc = engine.visibleNpcs(state).find(n => n.x === front.x && n.y === front.y) ?? engine.visibleEntities(state).map(e => ({ id: e.entity.id, x: e.x, y: e.y })).find(n => n.x === front.x && n.y === front.y);
      if (npc) talkFacing = { [npc.id]: OPPOSITE[before.player.facing] };
    }
    if (state.scene.kind === "field") talkFacing = {};
    if (state.scene.kind !== before.scene.kind || state.scene !== before.scene) selection = 0;
    syncMusic();
    saveMeta();
    if (result.log.length) options.onLog?.(result.log, state);
    if (state !== before) options.onStateChange?.(state);
    renderUI();
  }

  /* ------------------------------------------------------------ input */
  function press(dir: Direction) {
    if (realtimeDef()) { realtimeHeld.add(dir); return; }
    if (state.scene.kind === "custom") { audio.cue("cursor"); dispatch({ type: "sceneInput", input: { type: dir } }); return; }
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
    realtimeHeld.delete(dir);
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
    audio.cue("cursor");
    highlight();
  }
  function highlight() {
    buttons().forEach((button, index) => button.classList.toggle("is-selected", index === selection));
  }

  function confirm() {
    if (state.scene.kind === "custom") { dispatch({ type: "sceneInput", input: { type: "confirm" } }); return; }
    if (state.scene.kind === "ending") { const b = buttons()[0]; b?.click(); return; }
    if (menuOpen || state.scene.kind === "choice" || state.scene.kind === "prompt" || state.scene.kind === "battle") {
      if (!typing.done) { finishTyping(); return; }
      const list = buttons();
      list[Math.min(selection, list.length - 1)]?.click();
      return;
    }
    if (state.scene.kind === "message" || state.scene.kind === "dialogue") {
      if (!typing.done) { finishTyping(); return; }
      audio.cue("confirm");
      dispatch({ type: "advance" });
      return;
    }
    if (state.scene.kind === "field" && !animator.update(performance.now()).moving) dispatch({ type: "interact" });
  }
  function cancel() {
    if (state.scene.kind === "custom") { audio.cue("cancel"); dispatch({ type: "sceneInput", input: { type: "cancel" } }); return; }
    if (creditsOpen) { creditsOpen = false; selection = 0; renderUI(); return; }
    if (state.scene.kind === "battle" && battlePicker) { battlePicker = null; selection = 0; renderUI(); return; }
    if (state.scene.kind !== "field") return;
    menuOpen = !menuOpen; selection = 0; held.length = 0; equipFor = null;
    audio.cue(menuOpen ? "menu" : "cancel");
    renderUI();
  }

  const isTextTarget = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
  const accepts = (event: KeyboardEvent) => !isTextTarget(event.target) && (options.keyboard !== "focus" || root.contains(document.activeElement));
  function realtimeKey(event: KeyboardEvent, down: boolean): boolean {
    if (!realtimeDef()) return false;
    const dir = directionFromKey(event.key);
    const key = event.key.toLowerCase();
    let button: string | null;
    if (realtimeDef()?.realtime?.players === 2) {
      const p1: Record<string, string> = { w: "up", a: "left", s: "down", d: "right", f: "fire", g: "focus" };
      const p2: Record<string, string> = { arrowup: "p2up", arrowleft: "p2left", arrowdown: "p2down", arrowright: "p2right", enter: "p2fire", ".": "p2fire", "/": "p2focus" };
      button = p1[key] ?? p2[key] ?? null;
    } else button = dir ?? (key === "z" || key === "enter" || key === " " ? "fire" : key === "shift" ? "focus" : null);
    if (button) { event.preventDefault(); if (down) realtimeHeld.add(button); else realtimeHeld.delete(button); return true; }
    if (down && (key === "escape" || key === "x")) { event.preventDefault(); if (!event.repeat) dispatch({ type: "sceneInput", input: { type: "cancel" } }); return true; }
    return false;
  }
  /** Who the player is right now (setPlayer can transform the hero). */
  function heroName() { return state.player.name ?? content.project.player.name; }
  /** Self-made verbs usable right now. */
  function availableVerbs(): Array<[string, { label: string; key?: string; description?: string }]> {
    let ids: string[];
    try { ids = engine.usableVerbs(state); } catch { ids = []; }
    return ids.map(id => [id, content.project.verbs[id]!] as [string, { label: string; key?: string; description?: string }]);
  }
  function useVerb(id: string) { menuOpen = false; audio.cue("confirm"); dispatch({ type: "verb", verb: id }); }

  function onKeyDown(event: KeyboardEvent) {
    if (!accepts(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    audio.unlock();
    if (realtimeKey(event, true)) return;
    const dir = directionFromKey(event.key);
    if (dir) { event.preventDefault(); if (!event.repeat || state.scene.kind === "field") press(dir); return; }
    const key = event.key.toLowerCase();
    if (key === "enter" || key === " " || key === "z") { event.preventDefault(); if (!event.repeat) confirm(); }
    else if (key === "escape" || key === "x" || key === "m") { event.preventDefault(); if (!event.repeat) cancel(); }
    else if (state.scene.kind === "battle" && /^[1-4]$/.test(key)) { selection = Number(key) - 1; confirm(); }
    else if (state.scene.kind === "field" && !menuOpen && !event.repeat) {
      const verb = availableVerbs().find(([, v]) => v.key === key);
      if (verb) { event.preventDefault(); useVerb(verb[0]); }
    }
  }
  function onKeyUp(event: KeyboardEvent) {
    if (realtimeKey(event, false)) return;
    const dir = directionFromKey(event.key);
    if (dir) releaseDir(dir);
  }
  const onBlur = () => { held.length = 0; realtimeHeld.clear(); };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  root.addEventListener("focusout", event => { if (!root.contains(event.relatedTarget as Node | null)) held.length = 0; });
  root.addEventListener("pointerdown", () => audio.unlock(), { capture: true });
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
    button.addEventListener("click", event => { event.stopPropagation(); audio.cue("confirm"); onClick(); root.focus({ preventScroll: true }); });
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

  /** One canvas per enemy in the battle (index 0 = primary, then battle.foes). */
  let portraitCanvases: HTMLCanvasElement[] = [];

  function renderUI() {
    windowLayer.replaceChildren();
    portraitCanvases = [];
    const map = content.maps[state.mapId];
    const eff = engine.stats(state);
    // HUD
    hud.replaceChildren();
    const left = el("div", "rpg-hud-left");
    left.append(el("div", "rpg-hud-title", map?.title ?? state.mapId));
    const hudVars = Object.entries(content.project.variables).filter(([, decl]) => decl.hud);
    if (hudVars.length) {
      const vars = el("div", "rpg-hud-vars");
      for (const [id, decl] of hudVars) vars.appendChild(el("span", undefined, `${decl.label ?? id} ${state.vars[id] ?? decl.initial}`));
      left.append(vars);
    }
    const hp = el("div", "rpg-hud-hp");
    hp.append(el("span", "rpg-hud-label", `${heroName()}  HP ${state.player.hp}/${eff.maxHp}`), hpBar(state.player.hp, eff.maxHp, state.player.hp <= eff.maxHp / 4 ? "is-low" : ""));
    const extra = (() => { try { return engine.hudLines(state); } catch { return []; } })();
    if (extra.length) { const box = el("div", "rpg-hud-vars"); for (const line of extra) box.appendChild(el("span", undefined, line)); left.append(box); }
    if (state.carrying) {
      const carried = content.maps[state.carrying.home]?.entities.find(e => e.id === state.carrying!.id);
      left.append(el("div", "rpg-hud-vars", `運んでいる: ${carried?.states.find(st => st.name)?.name ?? carried?.name ?? state.carrying.id}（向いた先の空きマスで決定すると置く）`));
    }
    const verbs = state.scene.kind === "field" ? availableVerbs() : [];
    if (verbs.length) {
      const bar = el("div", "rpg-verbs");
      for (const [id, verb] of verbs) {
        const b = el("button", "rpg-verb", verb.key ? `${verb.label} [${verb.key.toUpperCase()}]` : verb.label) as HTMLButtonElement;
        b.type = "button";
        if (verb.description) b.title = verb.description;
        b.addEventListener("click", event => { event.stopPropagation(); useVerb(id); root.focus({ preventScroll: true }); });
        bar.appendChild(b);
      }
      left.append(bar);
    }
    hud.append(left, hp);
    hud.hidden = state.scene.kind === "battle" || state.scene.kind === "ending" || state.scene.kind === "custom";
    root.dataset.scene = menuOpen ? "menu" : state.scene.kind;

    const scene = state.scene;
    if (scene.kind === "message") messageWindow(scene.speaker, scene.text);
    else if (scene.kind === "dialogue") {
      const dialogue = content.dialogues[scene.dialogueId]!;
      messageWindow(dialogue.speaker, engine.dialogueLines(state, dialogue.id)[scene.line] ?? "");
    } else if (scene.kind === "choice") {
      const dialogue = content.dialogues[scene.dialogueId]!;
      const list = el("div", "rpg-window rpg-choices");
      for (const choice of dialogue.choices) {
        if (!engine.evaluate(choice.when, state)) continue;
        list.appendChild(navButton(engine.text(state, choice.label), () => dispatch({ type: "choose", choiceId: choice.id })));
      }
      messageWindow(dialogue.speaker, engine.dialogueLines(state, dialogue.id).at(-1) ?? "", list);
      typing = { ...typing, done: true };
    } else if (scene.kind === "prompt") {
      const list = el("div", "rpg-window rpg-choices");
      for (const option of scene.options) list.appendChild(navButton(option.label, () => dispatch({ type: "choose", choiceId: option.id })));
      if (scene.prompt) { messageWindow(scene.speaker, scene.prompt, list); typing = { ...typing, done: true }; }
      else windowLayer.appendChild(list);
    } else if (scene.kind === "battle") renderBattle(scene.battle);
    else if (scene.kind === "custom") renderCustomScene(scene);
    else if (scene.kind === "ending") {
      const ending = content.project.endings[scene.ending];
      const box = el("div", "rpg-window rpg-ending");
      box.append(el("div", "rpg-ending-label", "ENDING"), el("div", "rpg-ending-title", ending?.title ?? scene.ending));
      if (ending?.text) box.appendChild(el("div", "rpg-ending-text", engine.text(state, ending.text)));
      const seen = state.sets.endings?.length ?? 0;
      box.appendChild(el("div", "rpg-ending-meta", `到達したエンディング ${seen} / ${Object.keys(content.project.endings).length}　・　${state.cycle}周目`));
      box.appendChild(navButton("記憶を引き継いで、もう一度旅をする", () => dispatch({ type: "advance" })));
      windowLayer.appendChild(box);
    }
    else if (menuOpen) renderMenu();
    if (toast && toast.until > performance.now()) windowLayer.appendChild(el("div", "rpg-toast", toast.text));
    selection = Math.min(selection, Math.max(0, buttons().length - 1));
    highlight();
    updateTyping(performance.now());
  }

  let battlePicker: "items" | "skills" | "targets" | "orders" | null = null;
  /** Companion chosen in the "orders" picker (then its actions are listed). */
  let orderCompanion: string | null = null;
  /** Equipment item waiting for "who wears it?" in the menu. */
  let equipFor: string | null = null;

  function renderCustomScene(scene: Extract<GameState["scene"], { kind: "custom" }>) {
    const def = engine.systems.find(s => s.id === scene.system)?.scenes?.[scene.scene];
    sceneHost = el("div", "rpg-scene");
    windowLayer.appendChild(sceneHost);
    if (def?.realtime) {
      realtimeCanvas = el("canvas", "rpg-realtime");
      realtimeCanvas.width = VIEW_COLS * TILE; realtimeCanvas.height = VIEW_ROWS * TILE;
      const target = realtimeCanvas;
      target.addEventListener("pointerdown", event => {
        event.stopPropagation();
        const rect = target.getBoundingClientRect();
        const click = { x: Math.round(((event.clientX - rect.left) / rect.width) * target.width), y: Math.round(((event.clientY - rect.top) / rect.height) * target.height), width: target.width, height: target.height };
        dispatch({ type: "sceneInput", input: { type: "custom", value: { click } } });
      });
      sceneHost.appendChild(realtimeCanvas);
      realtimeClock = performance.now();
      return;
    }
    realtimeCanvas = null;
    if (!def?.render) {
      sceneHost.appendChild(el("div", "rpg-window rpg-message", `画面 ${scene.system}.${scene.scene}（表示なし。矢印・決定・キャンセルで操作）`));
      return;
    }
    try {
      def.render(sceneHost, {
        data: scene.data, state, content,
        send: input => { audio.cue("confirm"); dispatch({ type: "sceneInput", input }); root.focus({ preventScroll: true }); },
        assetUrl: id => images[id]?.src,
      });
    } catch (error) { fail(error); }
  }

  function renderBattle(battle: Extract<GameState["scene"], { kind: "battle" }>["battle"]) {
    const enemy = content.database.enemies.find(e => e.id === battle.enemyId)!;
    const eff = engine.stats(state);
    const panel = el("div", "rpg-battle");
    const backgroundId = enemy.background ?? content.maps[state.mapId]?.battleBackground;
    const backgroundUrl = backgroundId ? images[backgroundId]?.src : undefined;
    if (backgroundUrl) panel.style.backgroundImage = `linear-gradient(rgba(10,12,10,.15), rgba(10,12,10,.55)), url("${backgroundUrl}")`;
    const stage = el("div", "rpg-battle-stage");
    const enemyInfo = el("div", "rpg-enemy-info");
    const foes = [{ enemyId: battle.enemyId, hp: battle.enemyHp }, ...(battle.foes ?? [])];
    for (const foe of foes) {
      const e = content.database.enemies.find(x => x.id === foe.enemyId)!;
      const row = el("div", foe.hp <= 0 ? "rpg-enemy-row is-down" : "rpg-enemy-row");
      row.append(el("div", "rpg-enemy-name", `${e.name}${foes.length > 1 && foe.hp <= 0 ? "（倒れた）" : ""}`), hpBar(foe.hp, e.stats.maxHp, "is-enemy"));
      enemyInfo.appendChild(row);
    }
    const portraits = el("div", "rpg-portraits");
    portraitCanvases = foes.map(() => { const c = el("canvas", foes.length > 1 ? "rpg-portrait is-group" : "rpg-portrait"); c.width = 128; c.height = 128; portraits.appendChild(c); return c; });
    stage.append(enemyInfo, portraits);
    const status = el("div", "rpg-window rpg-battle-status");
    status.append(el("div", "rpg-speaker", `${heroName()}`), el("div", "rpg-battle-hp", `HP ${state.player.hp} / ${eff.maxHp}`), hpBar(state.player.hp, eff.maxHp, state.player.hp <= eff.maxHp / 4 ? "is-low" : ""));
    for (const member of state.party ?? []) {
      const comp = content.database.companions.find(x => x.id === member.id);
      if (comp) status.append(el("div", "rpg-battle-var", `${comp.name} HP ${member.hp}/${engine.companionStats(state, comp.id).maxHp}${member.hp <= 0 ? "（倒れている）" : battle.orders?.[comp.id] !== undefined ? `（${comp.actions[battle.orders[comp.id]!]?.name}）` : ""}`));
    }
    for (const [id, decl] of Object.entries(content.project.variables)) if (decl.hud) status.appendChild(el("div", "rpg-battle-var", `${decl.label ?? id} ${state.vars[id] ?? decl.initial}`));
    const log = el("div", "rpg-window rpg-battle-log");
    for (const line of battle.log.slice(-4)) log.appendChild(el("div", "rpg-log-line", line));
    live.textContent = battle.log[battle.log.length - 1] ?? "";
    const commands = el("div", "rpg-window rpg-commands");
    const usable = engine.usables(state, "battle");
    const skills = usable.filter(u => u.kind === "ability");
    const items = usable.filter(u => u.kind === "item");
    if (battle.outcome !== "ongoing") {
      battlePicker = null;
      const label = battle.outcome === "victory" ? "勝利！ 次へ" : battle.outcome === "fled" ? "フィールドへ戻る" : "次へ";
      commands.appendChild(navButton(label, () => dispatch({ type: "advance" })));
    } else if (battlePicker === "orders") {
      const standing = (state.party ?? []).filter(m => m.hp > 0);
      const comp = orderCompanion ? content.database.companions.find(x => x.id === orderCompanion) : undefined;
      if (!comp) {
        for (const m of standing) { const c = content.database.companions.find(x => x.id === m.id); if (c) commands.appendChild(navButton(c.name, () => { orderCompanion = c.id; selection = 0; renderUI(); }, { hint: `HP ${m.hp}` })); }
      } else {
        comp.actions.forEach((a, i) => commands.appendChild(navButton(a.name, () => { battlePicker = null; orderCompanion = null; dispatch({ type: "battle", command: "order", companion: comp.id, action: i }); }, { hint: { attack: "攻撃", heal: "手当て", guard: "守り" }[a.kind] })));
      }
      commands.appendChild(navButton("もどる", () => { if (orderCompanion) orderCompanion = null; else battlePicker = null; selection = 0; renderUI(); }));
    } else if (battlePicker === "targets") {
      foes.forEach((foe, i) => {
        if (foe.hp <= 0) return;
        const e = content.database.enemies.find(x => x.id === foe.enemyId)!;
        commands.appendChild(navButton(e.name, () => { battlePicker = null; dispatch({ type: "battle", command: "attack", target: i }); }, { hint: `HP ${foe.hp}` }));
      });
      commands.appendChild(navButton("もどる", () => { battlePicker = null; selection = 0; renderUI(); }));
    } else if (battlePicker) {
      const list = battlePicker === "items" ? items : skills;
      for (const u of list) {
        commands.appendChild(navButton(u.name, () => { battlePicker = null; dispatch(u.kind === "item" ? { type: "battle", command: "item", item: u.id } : { type: "battle", command: "skill", ability: u.id }); }, {
          hint: u.blocked ?? (u.kind === "item" ? `×${u.count}` : u.use.cost.map(c => `${content.project.variables[c.var]?.label ?? c.var}${typeof c.amount === "number" ? c.amount : ""}`).join(" ")),
          disabled: Boolean(u.blocked),
        }));
      }
      commands.appendChild(navButton("もどる", () => { battlePicker = null; selection = 0; renderUI(); }));
    } else {
      commands.dataset.grid = "2";
      commands.append(
        navButton("たたかう", () => { if (foes.filter(f => f.hp > 0).length > 1) { battlePicker = "targets"; selection = 0; renderUI(); } else dispatch({ type: "battle", command: "attack" }); }, { hint: "1" }),
        navButton("ぼうぎょ", () => dispatch({ type: "battle", command: "guard" }), { hint: "2" }),
        ...(skills.length ? [navButton("わざ", () => { battlePicker = "skills"; selection = 0; renderUI(); })] : []),
        navButton("どうぐ", () => { battlePicker = "items"; selection = 0; renderUI(); }, { hint: "3", disabled: !items.length }),
        ...((state.party ?? []).some(m => m.hp > 0) ? [navButton("なかま", () => { battlePicker = "orders"; orderCompanion = null; selection = 0; renderUI(); }, { hint: "指示" })] : []),
        ...engine.commands(state, "battle").map(cmd => navButton(cmd.label, () => { if (cmd.blocked) showToast(cmd.blocked); else dispatch({ type: "battle", command: "script", source: cmd.source, id: cmd.id }); }, { hint: cmd.blocked ?? "", disabled: Boolean(cmd.blocked) })),
        navButton("にげる", () => dispatch({ type: "battle", command: "flee" }), { hint: "4", disabled: !battle.canFlee }),
      );
    }
    const bottom = el("div", "rpg-battle-bottom");
    bottom.append(status, log, commands);
    panel.append(stage, bottom);
    windowLayer.appendChild(panel);
  }

  function setAudio(next: AudioSettings) {
    audio.applySettings(next);
    try { storage.write(settingsKey, JSON.stringify(next)); } catch { /* settings are optional */ }
    renderUI();
  }

  /** Which BGM should play now: enemy / battle music, a playBgm override, or the map's. */
  function syncMusic() {
    const scene = state.scene;
    if (scene.kind === "battle" && scene.battle.outcome === "ongoing") {
      const enemy = content.database.enemies.find(e => e.id === scene.battle.enemyId);
      const battleMusic = enemy?.bgm ?? content.project.audio.battle;
      if (battleMusic) { audio.setMusic(battleMusic); return; }
    }
    if (scene.kind === "battle" && scene.battle.outcome === "victory" && content.project.audio.victory) { audio.setMusic(null); return; }
    audio.setMusic(state.music !== undefined ? state.music : content.maps[state.mapId]?.bgm ?? null);
  }

  function renderCredits() {
    const panel = el("div", "rpg-window rpg-menu rpg-credits");
    panel.appendChild(el("div", "rpg-menu-title", "クレジット"));
    for (const line of creditLines(content)) panel.appendChild(el("div", "rpg-credit-line", line));
    panel.appendChild(navButton("もどる", () => { creditsOpen = false; selection = 0; renderUI(); }));
    windowLayer.appendChild(panel);
  }

  function renderMenu() {
    if (creditsOpen) { renderCredits(); return; }
    const menu = el("div", "rpg-window rpg-menu");
    menu.appendChild(el("div", "rpg-menu-title", "メニュー"));
    const stats = el("div", "rpg-menu-stats");
    const s = engine.stats(state);
    stats.textContent = `${heroName()}　HP ${state.player.hp}/${s.maxHp}　攻撃 ${s.attack}　防御 ${s.defense}`;
    menu.appendChild(stats);
    const section = (title: string) => menu.appendChild(el("div", "rpg-menu-section", title));
    const labeled = Object.entries(content.project.variables).filter(([, decl]) => decl.label);
    if (labeled.length) {
      const vars = el("div", "rpg-menu-stats");
      vars.textContent = labeled.map(([id, decl]) => `${decl.label} ${state.vars[id] ?? decl.initial}`).join("　");
      menu.appendChild(vars);
    }
    for (const [id, decl] of Object.entries(content.project.sets)) {
      if (!decl.show) continue;
      section(decl.label ?? id);
      const values = state.sets[id] ?? [];
      if (!values.length) menu.appendChild(el("div", "rpg-menu-empty", "まだない"));
      for (const v of values) menu.appendChild(el("div", "rpg-menu-ability", decl.entries[v] ?? v));
    }
    if (state.party?.length) {
      section("なかま");
      for (const member of state.party) {
        const comp = content.database.companions.find(x => x.id === member.id);
        const row = el("div", "rpg-menu-ability");
        const cs = engine.companionStats(state, member.id);
        const gear = Object.values(member.equipment ?? {}).map(i => content.database.items.find(x => x.id === i)?.name ?? i).join("・");
        row.append(el("strong", undefined, comp?.name ?? member.id), el("span", undefined, `HP ${member.hp}/${cs.maxHp}　攻 ${cs.attack}　防 ${cs.defense}${gear ? `　装備: ${gear}` : ""}${member.hp <= 0 ? "　倒れている" : ""}`));
        menu.appendChild(row);
      }
    }
    if ((state.cycle ?? 1) > 1 || (state.sets.endings?.length ?? 0) > 0) stats.textContent += `　${state.cycle}周目`;
    if (state.traits.length) {
      section("とくせい");
      for (const id of state.traits) {
        const trait = content.database.traits.find(t => t.id === id);
        const row = el("div", "rpg-menu-ability");
        row.append(el("strong", undefined, `${trait?.name ?? id}${trait ? `（${trait.category}）` : ""}`), el("span", undefined, trait?.description ?? ""));
        menu.appendChild(row);
      }
    }
    const fieldUsable = engine.usables(state, "field");
    section("どうぐ");
    const owned = Object.entries(state.items);
    if (!owned.length) menu.appendChild(el("div", "rpg-menu-empty", "何も持っていない"));
    for (const [id, count] of owned) {
      const item = content.database.items.find(i => i.id === id);
      const usable = fieldUsable.find(u => u.kind === "item" && u.id === id);
      if (item?.slot) {
        const slot = item.slot;
        const heroOn = state.equipment?.[slot] === id;
        const wearers = (state.party ?? []).filter(m => m.equipment?.[slot] === id).map(m => content.database.companions.find(x => x.id === m.id)?.name ?? m.id);
        const slotLabel = content.project.equipmentSlots[slot]?.label ?? slot;
        const who = [heroOn ? heroName() : "", ...wearers].filter(Boolean).join("・");
        if (equipFor === id) {
          menu.appendChild(el("div", "rpg-menu-empty", `${item.name}を誰が装備する？`));
          menu.appendChild(navButton(heroName(), () => { equipFor = null; dispatch({ type: "equip", item: id }); renderUI(); }, { hint: heroOn ? "外す" : "装備する" }));
          for (const m of state.party ?? []) {
            const c = content.database.companions.find(x => x.id === m.id);
            const on = m.equipment?.[slot] === id;
            menu.appendChild(navButton(c?.name ?? m.id, () => { equipFor = null; dispatch({ type: "equip", item: id, companion: m.id }); renderUI(); }, { hint: on ? "外す" : "装備する" }));
          }
          menu.appendChild(navButton("やめる", () => { equipFor = null; renderUI(); }));
          continue;
        }
        menu.appendChild(navButton(`${who ? "Ｅ " : ""}${item.name}`, () => { if (state.party?.length) { equipFor = id; selection = 0; renderUI(); } else { dispatch({ type: "equip", item: id }); renderUI(); } }, { hint: `${slotLabel}${who ? `　${who}` : ""}　${!state.party?.length && heroOn ? "外す" : "装備"}` }));
        continue;
      }
      menu.appendChild(navButton(`${item?.name ?? id}`, () => { if (usable && !usable.blocked) { menuOpen = false; dispatch({ type: "useItem", item: id }); } else showToast(usable?.blocked ?? (item?.description || "使えない。")); }, { hint: `×${count}${usable && !usable.blocked ? "　使う" : ""}` }));
    }
    section("のうりょく");
    const abilities = engine.abilities(state);
    if (!abilities.length) menu.appendChild(el("div", "rpg-menu-empty", "なし"));
    for (const id of abilities) {
      const ability = content.database.abilities.find(a => a.id === id);
      const usable = fieldUsable.find(u => u.kind === "ability" && u.id === id);
      if (usable) {
        menu.appendChild(navButton(usable.name, () => { if (!usable.blocked) { menuOpen = false; dispatch({ type: "useAbility", ability: id }); } else showToast(usable.blocked); }, { hint: usable.blocked ?? "使う" }));
        continue;
      }
      const row = el("div", "rpg-menu-ability");
      row.append(el("strong", undefined, ability?.name ?? id), el("span", undefined, ability?.description ?? ""));
      menu.appendChild(row);
    }
    const scriptCommands = engine.commands(state, "field");
    if (scriptCommands.length) {
      section("とくしゅ");
      for (const cmd of scriptCommands) menu.appendChild(navButton(cmd.label, () => { if (cmd.blocked) showToast(cmd.blocked); else { menuOpen = false; dispatch({ type: "command", source: cmd.source, id: cmd.id }); } }, { hint: cmd.blocked ?? "" }));
    }
    const verbList = availableVerbs();
    if (verbList.length) {
      section("こうどう");
      for (const [id, verb] of verbList) menu.appendChild(navButton(verb.label, () => useVerb(id), { hint: `${verb.description ?? ""}${verb.key ? `［${verb.key.toUpperCase()}］` : ""}` }));
    }
    section("きろく");
    const row = el("div", "rpg-menu-row");
    row.append(
      navButton("セーブ", () => save()),
      navButton("ロード", () => load()),
      navButton(`BGM: ${audio.settings.bgm ? "オン" : "オフ"}`, () => { setAudio({ ...audio.settings, bgm: !audio.settings.bgm }); }),
      navButton(`効果音: ${audio.settings.sfx ? "オン" : "オフ"}`, () => { setAudio({ ...audio.settings, sfx: !audio.settings.sfx }); }),
      navButton("クレジット", () => { creditsOpen = true; selection = 0; renderUI(); }),
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
    syncMusic();
    options.onStateChange?.(state);
    renderUI();
  }

  /* ------------------------------------------------------------ frame loop */
  function realtimeFrame(now: number, def: NonNullable<ReturnType<typeof realtimeDef>>) {
    const step = 1000 / (def.realtime?.fps ?? 30);
    let steps = 0;
    while (now - realtimeClock >= step && steps < 3) {
      realtimeClock += step; steps++;
      let result: StepResult;
      try { result = engine.step(state, { type: "sceneInput", input: { type: "frame", held: [...new Set([...realtimeHeld, ...padHeld])] } }); } catch (error) { fail(error); return; }
      const before = state.scene;
      const after = result.state.scene;
      if (after.kind === "custom" && before.kind === "custom" && after.system === before.system && after.scene === before.scene) {
        state = result.state; // stay silent: no DOM rebuild at 30fps
        for (const cue of result.cues) if (cue.kind === "hit") audio.cue(cue.target === "enemy" ? "hit" : "hurt");
      } else { realtimeHeld.clear(); apply(result); return; }
    }
    if (now - realtimeClock > step * 6) realtimeClock = now; // tab was hidden
    const scene = state.scene;
    if (realtimeCanvas && scene.kind === "custom" && def.draw) {
      try {
        def.draw(realtimeCanvas.getContext("2d")!, { data: scene.data, state, content, width: realtimeCanvas.width, height: realtimeCanvas.height, time: now, send: input => dispatch({ type: "sceneInput", input }), assetUrl: id => images[id]?.src });
      } catch (error) { fail(error); }
    }
  }

  /* ------------------------------------------------------------ gamepads (standard mapping) */
  const padHeld = new Set<string>();
  const padPrev: string[][] = [[], []];
  /** Pad 1 plays like the keyboard (D-pad / left stick, A confirm·fire, B cancel, X focus, Start menu); pad 2 is player 2 in two-player scenes. */
  function pollGamepads() {
    const list = typeof navigator !== "undefined" && navigator.getGamepads ? [...navigator.getGamepads()].filter((p): p is Gamepad => Boolean(p)) : [];
    padHeld.clear();
    if (!list.length && !padPrev[0]!.length && !padPrev[1]!.length) return;
    const rt = realtimeDef();
    const two = rt?.realtime?.players === 2;
    for (let i = 0; i < 2; i++) {
      const pad = list[i];
      const now: string[] = [];
      if (pad) {
        const b = (n: number) => Boolean(pad.buttons[n]?.pressed);
        const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
        if (b(12) || ay < -0.5) now.push("up");
        if (b(13) || ay > 0.5) now.push("down");
        if (b(14) || ax < -0.5) now.push("left");
        if (b(15) || ax > 0.5) now.push("right");
        if (b(0)) now.push("fire");
        if (b(1)) now.push("cancel");
        if (b(2)) now.push("focus");
        if (b(9)) now.push("start");
      }
      const prev = padPrev[i]!;
      padPrev[i] = now;
      const fresh = (x: string) => now.includes(x) && !prev.includes(x);
      if (rt) {
        if (i === 1 && !two) continue;
        for (const x of now) if (x !== "cancel" && x !== "start") padHeld.add(two && i === 1 ? `p2${x}` : x);
        if (i === 0 && (fresh("cancel") || fresh("start"))) dispatch({ type: "sceneInput", input: { type: "cancel" } });
        continue;
      }
      if (i !== 0) continue;
      audio.unlock();
      for (const dir of ["up", "down", "left", "right"] as const) { if (fresh(dir)) press(dir); else if (prev.includes(dir) && !now.includes(dir)) releaseDir(dir); }
      if (fresh("fire")) confirm();
      if (fresh("cancel") || fresh("start")) cancel();
    }
  }

  function frame(now: number) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    pollGamepads();
    const rt = realtimeDef();
    if (rt) { realtimeFrame(now, rt); return; }
    const moving = animator.update(now);
    renderPos = moving.position;
    if (!moving.moving && state.scene.kind === "field" && !menuOpen && held.length) {
      const dir = held[held.length - 1]!;
      dispatch({ type: "move", direction: dir });
      const after = animator.update(now);
      renderPos = after.position;
    }
    if (ticking && state.scene.kind === "field" && !menuOpen && now - lastTick > 330) { lastTick = now; dispatch({ type: "tick" }); }
    if (moving.moving && now - lastFrameSwap > WALK_ANIMATION_MS / 2) { walkFrame = (walkFrame + 1) % 4; lastFrameSwap = now; }
    if (!moving.moving && !held.length) walkFrame = 0;

    const map = content.maps[state.mapId];
    if (map) {
      const cam = {
        x: Math.max(0, Math.min(map.width - VIEW_COLS, renderPos.x - (VIEW_COLS - 1) / 2)),
        y: Math.max(0, Math.min(map.height - VIEW_ROWS, renderPos.y - (VIEW_ROWS - 1) / 2)),
      };
      const npcs = engine.visibleNpcs(state, map);
      const rows = engine.rowsFor(state, map.id);
      const entities = engine.visibleEntities(state, map);
      const entityActors = entities.filter(e => e.state.sprite).map(e => {
        const key = `${map.id}:${e.entity.id}`;
        let tween = entityTweens.get(key);
        if (!tween || tween.tx !== e.x || tween.ty !== e.y) {
          const cur = tween ? currentTween(tween, now) : { x: e.x, y: e.y };
          tween = { fx: cur.x, fy: cur.y, tx: e.x, ty: e.y, start: now };
          if (Math.abs(cur.x - e.x) + Math.abs(cur.y - e.y) > 1.5) { tween.fx = e.x; tween.fy = e.y; }
          entityTweens.set(key, tween);
        }
        const pos = currentTween(tween, now);
        const moving = pos.x !== e.x || pos.y !== e.y;
        return { id: e.entity.id, kind: "npc" as const, x: pos.x, y: pos.y, facing: talkFacing[e.entity.id] ?? e.facing, sprite: e.state.sprite, frame: moving ? Math.floor(now / 120) % 4 : 0 };
      });
      const origin = drawMap(ctx, {
        content, map: rows === map.rows ? map : { ...map, rows }, images, state, time: now,
        view: { camera: cam, cols: VIEW_COLS, rows: VIEW_ROWS },
        interactables: engine.visibleInteractables(state, map),
        markers: entities.filter(e => e.state.marker !== "none").map(e => ({ x: e.x, y: e.y, marker: e.state.marker })),
        actors: [
          ...npcActors(content, map, npcs, { facingOverride: talkFacing }),
          ...entityActors,
          { id: "player", kind: "player", x: renderPos.x, y: renderPos.y, facing: state.player.facing, sprite: state.player.sprite ?? content.project.player.sprite, frame: walkFrame },
        ],
      });
      for (const system of engine.activeSystems(state)) {
        if (!system.drawOverlay) continue;
        try {
          ctx.save();
          system.drawOverlay(ctx, { content, state, map, originX: origin.originX, originY: origin.originY, tileSize: TILE, player: renderPos, width: VIEW_COLS * TILE, height: VIEW_ROWS * TILE, time: now });
          ctx.restore();
        } catch (error) { ctx.restore(); console.warn(`${system.id}.drawOverlay`, error); }
      }
    }
    const fading = fadeUntil - now;
    fade.style.opacity = fading > 0 ? String(Math.min(1, fading / 220)) : "0";
    screen.classList.toggle("is-shaking", shakeUntil > now);
    if (portraitCanvases.length && state.scene.kind === "battle") {
      const battle = state.scene.battle;
      const foes = [{ enemyId: battle.enemyId, hp: battle.enemyHp }, ...(battle.foes ?? [])];
      portraitCanvases.forEach((canvas, i) => {
        const foe = foes[i];
        const pctx = canvas.getContext("2d")!;
        if (!foe || foe.hp <= 0 || battle.outcome === "victory") { pctx.clearRect(0, 0, 128, 128); return; }
        const enemy = content.database.enemies.find(e => e.id === foe.enemyId);
        const asset = enemy?.sprite ? content.assets.assets.find(a => a.id === enemy.sprite) : undefined;
        drawEnemyPortrait(pctx, foe.enemyId, 128, now + i * 170, enemy?.sprite ? images[enemy.sprite] : undefined, asset);
      });
    }
    if (!typing.done) updateTyping(now);
  }

  function currentTween(t: { fx: number; fy: number; tx: number; ty: number; start: number }, now: number) {
    const p = Math.min(1, (now - t.start) / 220);
    return { x: Math.round((t.fx + (t.tx - t.fx) * p) * TILE) / TILE, y: Math.round((t.fy + (t.ty - t.fy) * p) * TILE) / TILE };
  }
  void readMeta;

  images = loadImages(content, options.resolveAsset);
  audio.preload();
  syncMusic();
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
      audio.dispose();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      root.remove();
    },
  };
}

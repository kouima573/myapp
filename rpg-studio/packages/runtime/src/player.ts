/**
 * The playable game: canvas + DOM windows (messages, choices, battle, menu) + keyboard/touch input.
 * Used unchanged by the studio play-test and by the static build, so both always behave identically.
 */
import type { AssetEntry, Direction, GameContent, GameState, Use } from "../../schema/src/formats";
import { createEngine, makeSave, readSave, type Action, type Engine, type GameSystem, type StepResult } from "../../engine/src/index";
import { directionFromKey, GridMovementAnimator, WALK_ANIMATION_MS, type Point } from "./movement";
import { drawEnemyPortrait, drawMap, loadImages, npcActors, TILE, type ImageMap } from "./render";
import { RUNTIME_CSS } from "./styles";
import { AudioManager, type AudioSettings } from "./audio";
import { creditLines } from "./credits";
import { parseMarkup, plainLength, renderMarkup, stripMarkup, typedAt, type TextToken } from "./textmarkup";

export interface SaveStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  /** Save slots may use asynchronous storage such as IndexedDB. Settings and metadata stay synchronous. */
  readSave?(key: string): Promise<string | null>;
  writeSave?(key: string, value: string): Promise<void>;
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
  /** Every action the game handled (studio: record play as a scenario test). */
  onAction?: (action: Action, after: GameState) => void;
  /** Show the title screen first (built games). The studio skips it. */
  titleScreen?: boolean;
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

let savesDbPromise: Promise<IDBDatabase> | null = null;
const SAVES_DB_NAME = "rpg-studio-saves";
const SAVES_STORE_NAME = "saves";

function openSavesDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDBを利用できません"));
  if (savesDbPromise) return savesDbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SAVES_DB_NAME, 1);
    let failed = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SAVES_STORE_NAME)) db.createObjectStore(SAVES_STORE_NAME);
    };
    request.onsuccess = () => {
      if (failed) { request.result.close(); return; }
      const db = request.result;
      db.onversionchange = () => { db.close(); savesDbPromise = null; };
      resolve(db);
    };
    request.onerror = () => { failed = true; reject(request.error ?? new Error("IndexedDBを開けません")); };
    request.onblocked = () => { failed = true; reject(new Error("別のタブがセーブ領域を使用中です")); };
  });
  savesDbPromise = opening.catch(error => {
    savesDbPromise = null;
    throw error;
  });
  return savesDbPromise;
}

function readSaveFromDb(db: IDBDatabase, key: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SAVES_STORE_NAME, "readonly");
    const request = transaction.objectStore(SAVES_STORE_NAME).get(key);
    request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error("セーブを読み込めません"));
    transaction.onabort = () => reject(transaction.error ?? new Error("セーブの読込が中断されました"));
  });
}

function writeSaveToDb(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SAVES_STORE_NAME, "readwrite");
    transaction.objectStore(SAVES_STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("セーブを書き込めません"));
    transaction.onabort = () => reject(transaction.error ?? new Error("セーブの書込が中断されました"));
  });
}

export function browserStorage(): SaveStorage {
  return {
    read(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
    write(key, value) { try { window.localStorage.setItem(key, value); } catch { throw new Error("ブラウザの保存領域を使えません（プライベートモード等）"); } },
    async readSave(key) {
      // A local copy exists only when it has not yet migrated or the last IDB write fell back.
      let legacy: string | null = null;
      try { legacy = window.localStorage.getItem(key); } catch { /* IndexedDB may still be available. */ }
      try {
        const db = await openSavesDb();
        if (legacy !== null) {
          try {
            await writeSaveToDb(db, key, legacy);
            window.localStorage.removeItem(key);
          } catch { /* Keep the localStorage copy if migration cannot be committed. */ }
          return legacy;
        }
        return await readSaveFromDb(db, key);
      } catch {
        return legacy;
      }
    },
    async writeSave(key, value) {
      try {
        const db = await openSavesDb();
        await writeSaveToDb(db, key, value);
        try { window.localStorage.removeItem(key); } catch { /* The IndexedDB copy is already durable. */ }
        return;
      } catch (idbError) {
        try { window.localStorage.setItem(key, value); return; } catch {
          const detail = idbError instanceof Error ? ` (${idbError.message})` : "";
          throw new Error(`ブラウザのセーブ領域を使えません。空き容量を確認してください${detail}`);
        }
      }
    },
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
  /** Slots: "auto" (written on map changes) and 1–3. Slot 1 also reads the single save of older versions. */
  const SLOTS = ["auto", "1", "2", "3"] as const;
  type Slot = (typeof SLOTS)[number];
  const slotKey = (slot: Slot) => `${saveKey}:${slot}`;
  const slotCache = new Map<Slot, string | null>();
  const slotVersions = new Map<Slot, number>();
  for (const slot of SLOTS) {
    try { slotCache.set(slot, storage.read(slotKey(slot)) ?? (slot === "1" ? storage.read(saveKey) : null)); }
    catch { slotCache.set(slot, null); }
    slotVersions.set(slot, 0);
  }
  const readSlot = (slot: Slot) => slotCache.get(slot) ?? null;
  async function readStoredSave(key: string): Promise<string | null> {
    try { return storage.readSave ? await storage.readSave(key) : storage.read(key); }
    catch { try { return storage.read(key); } catch { return null; } }
  }
  async function readStoredSlot(slot: Slot): Promise<string | null> {
    const raw = await readStoredSave(slotKey(slot));
    if (raw !== null || slot !== "1") return raw;
    return readStoredSave(saveKey);
  }
  async function writeStoredSlot(slot: Slot, value: string): Promise<void> {
    slotVersions.set(slot, (slotVersions.get(slot) ?? 0) + 1);
    if (storage.writeSave) await storage.writeSave(slotKey(slot), value);
    else storage.write(slotKey(slot), value);
    slotCache.set(slot, value);
  }
  async function hydrateSlots(): Promise<void> {
    await Promise.all(SLOTS.map(async slot => {
      const version = slotVersions.get(slot) ?? 0;
      const raw = await readStoredSlot(slot);
      if (slotVersions.get(slot) === version) slotCache.set(slot, raw);
    }));
    if (!destroyed) renderUI();
  }
  const slotLabel = (slot: Slot) => (slot === "auto" ? "オート" : `スロット${slot}`);
  /** "main" menu, the title screen, or the save / load slot lists. */
  let menuView: "main" | "title" | "save" | "load" | "book" | "achievements" | "quests" | "formation" | "skills" = "main";
  /** Skill-board view: whose boards, which board. */
  let skillOwner = "hero";
  let skillBoardId: string | null = null;
  let slotReturn: "main" | "title" = "main";
  const settingsKey = `rpg-settings:${content.project.id}`;
  const readRawSettings = () => { try { return JSON.parse(storage.read(settingsKey) ?? "{}") as Record<string, unknown>; } catch { return {}; } };
  const rawSet = readRawSettings();
  const audio = new AudioManager(content, options.resolveAsset, { bgm: true, sfx: true, ...(rawSet as Partial<AudioSettings>) });
  const uiPrefs = {
    textSpeed: (rawSet.textSpeed === "fast" || rawSet.textSpeed === "instant" ? rawSet.textSpeed : "normal") as "normal" | "fast" | "instant",
    autoAdvance: rawSet.autoAdvance === true,
    largeText: rawSet.largeText === true,
    colorAssist: rawSet.colorAssist === true,
    showControls: typeof rawSet.showControls === "boolean" ? rawSet.showControls : true,
    clickMove: rawSet.clickMove !== false,
    reducedMotion: typeof rawSet.reducedMotion === "boolean" ? rawSet.reducedMotion : Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
    shake: typeof rawSet.shake === "boolean" ? rawSet.shake : true,
    minimap: typeof rawSet.minimap === "boolean" ? rawSet.minimap : true,
    textSound: typeof rawSet.textSound === "boolean" ? rawSet.textSound : true,
    battleSpeed: (rawSet.battleSpeed === "fast" ? "fast" : "normal") as "normal" | "fast",
  };
  /** オート戦闘: attack again and again until the battle ends or a key is pressed. */
  let autoBattle = false;
  let autoTimer = 0;
  let skipHeld = false;
  let creditsOpen = false;
  let backlogOpen = false;
  const backlog: Array<{ speaker?: string; text: string }> = [];
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
  let dashing = false;
  let talkFacing: Record<string, Direction> = {};
  let selection = 0;
  let menuOpen = false;
  /** Speech bubbles over actors (emote effect): id ("player", NPC or entity id) → icon until a time. */
  const emotes = new Map<string, { icon: string; until: number }>();
  let lastRouteStep = 0;
  /** Damage numbers shown over the battle (070). */
  const POPUP_MS = 900;
  let popups: Array<{ text: string; target: "enemy" | "player"; at: number; n: number }> = [];
  /** True while the title screen (and its load / credits views) is shown: they stay on top of the opening scene. */
  let atTitle = false;
  if (options.titleScreen && content.project.titleScreen.enabled && !options.initialState) { menuOpen = true; menuView = "title"; atTitle = true; }
  let toast: { text: string; until: number } | null = null;
  let typing = { text: "", startedAt: 0, done: true };
  let typingScene: GameState["scene"] | null = null;
  let typingReadyAt = 0;
  let fadeUntil = 0;
  let scriptedFade: { from: number; to: number; start: number; end: number; color: string } | null = null;
  /** セリフ音声: play a line's voice once when the line appears (re-renders of the same line do not repeat it). */
  let lastVoiceKey = "";
  function speak(voice: string | undefined, key: string) {
    if (!voice || key === lastVoiceKey) return;
    lastVoiceKey = key;
    audio.playSound(voice);
  }
  /** 確認ダイアログ: a yes / no question over everything; "いいえ" is selected first. */
  let asking: { text: string; yes: () => void } | null = null;
  function askConfirm(text: string, yes: () => void) { asking = { text, yes }; selection = 1; renderUI(); }
  /** 隊列歩行: the hero's last positions; companions walk on them. */
  let trail: Array<{ x: number; y: number; facing: Direction; mapId: string }> = [];
  /** Footprints / splashes (tile.stepEffect). */
  let stepEffects: Array<{ x: number; y: number; kind: "dust" | "splash" | "footprints" | "leaves"; at: number; facing?: string }> = [];
  let shakeUntil = 0;
  let shakePower = 4;
  /** Where the camera is now (eased toward state.camera / the hero). */
  let camNow: { x: number; y: number; zoom: number; mapId?: string; at?: number } = { x: 0, y: 0, zoom: 1 };
  let lastCamMs = 600;
  let mapView: { mapId: string; zoom: number; originX: number; originY: number } | null = null;
  let clickRoute: Direction[] = [];
  let clickRouteMap = "";
  let clickInteract = false;
  /** Battle animations playing (cue "anim"). */
  let anims: Array<{ name: string; target: "player" | "enemy"; slot?: number | "all"; at: number }> = [];
  let destroyed = false;
  let raf = 0;
  let images: ImageMap = {};

  /* ------------------------------------------------------------ DOM */
  const root = el("div", "rpg-root");
  root.tabIndex = 0;
  root.setAttribute("role", "application");
  root.setAttribute("aria-label", `${content.project.title}（ゲーム）`);
  // ウィンドウのデザイン (project.ui): colours, corners, font and an optional picture frame.
  const ui = content.project.ui;
  if (ui) {
    const set = (name: string, value: string | undefined) => { if (value) root.style.setProperty(name, value); };
    set("--rpg-win", ui.window); set("--rpg-edge", ui.edge); set("--rpg-ink", ui.text); set("--rpg-accent", ui.accent);
    if (ui.radius !== undefined) root.style.setProperty("--rpg-radius", `${ui.radius}px`);
    const fonts = { dot: `"DotGothic16","Hiragino Kaku Gothic ProN","Meiryo",sans-serif`, gothic: `"Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",system-ui,sans-serif`, mincho: `"Hiragino Mincho ProN","Yu Mincho","MS PMincho",serif`, rounded: `"Hiragino Maru Gothic ProN","M PLUS Rounded 1c","Arial Rounded MT Bold",sans-serif` };
    if (ui.font) root.style.fontFamily = fonts[ui.font];
    // カスタムフォント (ui.fontAsset): loaded with FontFace and used for all text of the game.
    const fontAsset = ui.fontAsset ? content.assets.assets.find(a => a.id === ui.fontAsset) : undefined;
    if (fontAsset && typeof FontFace !== "undefined") void Promise.resolve(options.resolveAsset(fontAsset)).then(async url => {
      try {
        const face = new FontFace(`rpg-custom-${fontAsset.id}`, `url("${url}")`);
        await face.load();
        (document.fonts as unknown as { add(f: FontFace): void }).add(face);
        root.style.fontFamily = `"rpg-custom-${fontAsset.id}", ${root.style.fontFamily || "system-ui, sans-serif"}`;
      } catch { /* keep the default font */ }
    });
    const frame = ui.frame ? content.assets.assets.find(a => a.id === ui.frame) : undefined;
    if (frame) void Promise.resolve(options.resolveAsset(frame)).then(url => {
      root.style.setProperty("--rpg-frame", `url("${url}")`);
      root.style.setProperty("--rpg-frame-slice", String(ui.frameSlice));
      root.classList.add("has-frame");
    });
  }
  const screen = el("div", "rpg-screen");
  const fpsEnabled = (() => { const query = new URLSearchParams(window.location.search); return query.has("fps") || query.has("debug"); })();
  const fpsMeter = fpsEnabled ? el("div", "rpg-fps", "FPS — · frame — ms · work — ms") : null;
  fpsMeter?.setAttribute("aria-hidden", "true");
  const canvas = el("canvas", "rpg-canvas");
  canvas.width = VIEW_COLS * TILE; canvas.height = VIEW_ROWS * TILE;
  const ctx = canvas.getContext("2d")!;
  const hud = el("div", "rpg-hud");
  const fade = el("div", "rpg-fade");
  const windowLayer = el("div", "rpg-layer");
  const pictureLayer = el("div", "rpg-pictures");
  pictureLayer.dataset.src = "packages/runtime/src/player.ts#syncPictures";
  const live = el("div", "rpg-sr"); live.setAttribute("aria-live", "polite");
  const fsBtn = el("button", "rpg-fs", "⛶");
  fsBtn.type = "button";
  fsBtn.title = "全画面表示の切り替え";
  fsBtn.setAttribute("aria-label", "全画面表示の切り替え");
  fsBtn.style.cssText = "position:absolute;top:8px;left:50%;transform:translateX(-50%);opacity:.75;z-index:12;background:rgba(13,17,14,.68);color:#e9e2cb;border:1px solid rgba(255,255,255,.22);border-radius:6px;padding:3px 8px;font-size:13px;cursor:pointer;line-height:1.2";
  fsBtn.addEventListener("click", event => {
    event.stopPropagation();
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void root.requestFullscreen?.();
  });
  screen.append(canvas, pictureLayer, hud, fade, windowLayer, fsBtn);
  if (fpsMeter) screen.append(fpsMeter);
  screen.append(live);
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
    options.onAction?.(action, state);
    return result;
  }

  function apply(result: StepResult, action?: Action) {
    const before = state;
    state = result.state;
    for (const cue of result.cues) {
      if (cue.kind === "moved") {
        animator.enqueue({ x: state.player.x, y: state.player.y });
        trail = [{ ...cue.from, facing: state.player.facing, mapId: state.mapId }, ...trail.filter(t => t.mapId === state.mapId)].slice(0, 8);
        // The tile stepped on: its footstep sound and little effect (water splash, snow footprints…).
        const map = content.maps[state.mapId];
        const code = map ? Array.from(engine.rowsFor(state, map.id)[state.player.y] ?? "")[state.player.x] : undefined;
        const tile = code ? content.tileset.tiles.find(t => t.code === code) : undefined;
        if (tile?.footstep) audio.playSound(tile.footstep);
        if (tile?.stepEffect) {
          const now = performance.now();
          stepEffects = [...stepEffects.filter(fx => now - fx.at < 2600).slice(-24), { x: state.player.x, y: state.player.y, kind: tile.stepEffect, at: now, facing: state.player.facing }];
        }
      }
      else if (cue.kind === "bump") audio.cue("bump");
      else if (cue.kind === "battleStart") { audio.cue("encounter"); fadeUntil = performance.now() + (uiPrefs.battleSpeed === "fast" ? 60 : 260); }
      else if (cue.kind === "fade") {
        const now = performance.now();
        const current = scriptedFade ? (scriptedFade.end <= now ? scriptedFade.to : scriptedFade.from + (scriptedFade.to - scriptedFade.from) * Math.max(0, (now - scriptedFade.start) / Math.max(1, scriptedFade.end - scriptedFade.start))) : 0;
        scriptedFade = { from: current, to: cue.to === "color" ? 1 : 0, start: now, end: now + cue.ms, color: cue.color };
      }
      else if (cue.kind === "shake") { shakeUntil = performance.now() + cue.ms; shakePower = cue.power; }
      else if (cue.kind === "anim") anims = [...anims.filter(a => performance.now() - a.at < 900), { name: cue.name, target: cue.target, ...(cue.slot !== undefined ? { slot: cue.slot } : {}), at: performance.now() }];
      else if (cue.kind === "achievement") { showToast(`🏆 実績「${cue.title}」を達成！`); audio.cue("item"); }
      else if (cue.kind === "quest") { showToast(`${cue.action === "start" ? "依頼を受けた" : cue.action === "complete" ? "依頼を達成した" : cue.action === "fail" ? "依頼に失敗した" : "目標を達成した"}：「${cue.title}」`); if (cue.action === "complete") audio.cue("item"); }
      else if (cue.kind === "miss") popups.push({ text: "MISS", target: cue.target, at: performance.now(), n: popups.length });
      else if (cue.kind === "critical") popups.push({ text: "会心！", target: cue.target, at: performance.now(), n: popups.length });
      else if (cue.kind === "hit") { popups.push({ text: String(cue.amount), target: cue.target, at: performance.now(), n: popups.length }); audio.cue(cue.target === "enemy" ? "hit" : "hurt"); if (cue.target === "player" && uiPrefs.shake) shakeUntil = performance.now() + 220; }
      else if (cue.kind === "battleEnd") {
        if (cue.outcome === "victory") { const v = content.project.audio.victory; if (v) audio.playSound(v); else audio.cue("victory"); }
        else if (cue.outcome === "defeat") audio.cue("defeat");
      }
      else if (cue.kind === "sfx") audio.playSound(cue.sound);
      else if (cue.kind === "item") audio.cue("item");
      else if (cue.kind === "heal") audio.cue("heal");
      else if (cue.kind === "levelUp") audio.cue("victory");
      else if (cue.kind === "emote") emotes.set(cue.target, { icon: cue.icon, until: performance.now() + 1500 });
      else if (cue.kind === "mapChanged") { audio.cue("door"); autoSaveSoon = true; }
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
    if (autoSaveSoon) void autoSave();
  }

  /* ------------------------------------------------------------ input */
  function press(dir: Direction) {
    if (realtimeDef()) { realtimeHeld.add(dir); return; }
    if (state.scene.kind === "custom") { audio.cue("cursor"); dispatch({ type: "sceneInput", input: { type: dir } }); return; }
    if (state.scene.kind === "field" && !menuOpen) {
      clickRoute = []; clickInteract = false;
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
    // Skill board: move to the nearest button in that direction on screen (hexes are not a list).
    if (menuOpen && menuView === "skills") {
      const cur = list[Math.min(selection, list.length - 1)]!.getBoundingClientRect();
      const cx = cur.left + cur.width / 2, cy = cur.top + cur.height / 2;
      let best = -1, bestScore = Infinity;
      list.forEach((b, i) => {
        if (i === selection) return;
        const r = b.getBoundingClientRect(), dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
        const along = dir === "up" ? -dy : dir === "down" ? dy : dir === "left" ? -dx : dx;
        const across = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
        if (along <= 2) return;
        const score = along + across * 2;
        if (score < bestScore) { bestScore = score; best = i; }
      });
      if (best >= 0) { selection = best; audio.cue("cursor"); highlight(); }
      return;
    }
    const grid = windowLayer.querySelector("[data-grid]") ? 2 : 1;
    const delta = dir === "up" ? -grid : dir === "down" ? grid : dir === "left" ? -1 : 1;
    if (grid === 1 && (dir === "left" || dir === "right")) return;
    selection = (selection + delta + list.length) % list.length;
    audio.cue("cursor");
    highlight();
  }
  function highlight() {
    buttons().forEach((button, index) => button.classList.toggle("is-selected", index === selection));
    // Skill board: show the panel under the cursor.
    const detail = windowLayer.querySelector<HTMLElement>(".rpg-skill-detail");
    if (detail) {
      const b = buttons()[selection];
      if (b?.dataset.skillName) detail.replaceChildren(el("div", "rpg-skill-name", b.dataset.skillName), el("div", "rpg-skill-desc", b.dataset.skillDesc ?? ""), el("div", "rpg-skill-state", b.dataset.skillState ?? ""));
    }
  }

  function confirm() {
    if (state.scene.kind === "input") { windowLayer.querySelector<HTMLInputElement>(".rpg-input-field")?.focus(); return; }
    if (state.scene.kind === "custom") { dispatch({ type: "sceneInput", input: { type: "confirm" } }); return; }
    if (state.scene.kind === "ending" || (state.scene.kind === "gameover" && !menuOpen)) { const list = buttons(); list[Math.min(selection, list.length - 1)]?.click(); return; }
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
    if (asking) { asking = null; selection = 0; renderUI(); return; }
    if (menuOpen && menuView === "title") return;
    if (menuOpen && (menuView === "save" || menuView === "load")) { menuView = slotReturn; selection = 0; renderUI(); return; }
    if (menuOpen && (menuView === "book" || menuView === "achievements" || menuView === "quests" || menuView === "formation" || menuView === "skills")) { menuView = "main"; selection = 0; renderUI(); return; }
    if (state.scene.kind === "custom") { audio.cue("cancel"); dispatch({ type: "sceneInput", input: { type: "cancel" } }); return; }
    if (creditsOpen) { creditsOpen = false; selection = 0; renderUI(); return; }
    if (backlogOpen) { backlogOpen = false; selection = 0; renderUI(); return; }
    if (state.scene.kind === "battle" && battlePicker) { battlePicker = null; selection = 0; renderUI(); return; }
    if (state.scene.kind !== "field") return;
    menuOpen = !menuOpen; menuView = "main"; selection = 0; held.length = 0; equipFor = null;
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
    dashing = event.shiftKey;
    if (!accepts(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    audio.unlock();
    if (realtimeKey(event, true)) return;
    if (event.key.toLowerCase() === "s" && (state.scene.kind === "message" || state.scene.kind === "dialogue")) { event.preventDefault(); skipHeld = true; if (!typing.done) finishTyping(); return; }
    const dir = directionFromKey(event.key);
    if (dir) { event.preventDefault(); if (!event.repeat || state.scene.kind === "field") press(dir); return; }
    const key = event.key.toLowerCase();
    if (key === "enter" || key === " " || key === "z") { event.preventDefault(); if (!event.repeat) confirm(); }
    else if (key === "escape" || key === "x" || key === "m") { event.preventDefault(); if (!event.repeat) cancel(); }
    else if (key === "n" && content.project.minimap && state.scene.kind === "field" && !menuOpen && !event.repeat && !availableVerbs().some(([, v]) => v.key === "n")) { uiPrefs.minimap = !uiPrefs.minimap; savePrefs(audio.settings); }
    else if (state.scene.kind === "battle" && /^[1-4]$/.test(key)) { selection = Number(key) - 1; confirm(); }
    else if (state.scene.kind === "field" && !menuOpen && !event.repeat) {
      const verb = availableVerbs().find(([, v]) => v.key === key);
      if (verb) { event.preventDefault(); useVerb(verb[0]); }
    }
  }
  function onKeyUp(event: KeyboardEvent) {
    dashing = event.shiftKey;
    if (event.key.toLowerCase() === "s") skipHeld = false;
    if (realtimeKey(event, false)) return;
    const dir = directionFromKey(event.key);
    if (dir) releaseDir(dir);
  }
  const onBlur = () => { held.length = 0; dashing = false; skipHeld = false; realtimeHeld.clear(); };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  root.addEventListener("focusout", event => { if (!root.contains(event.relatedTarget as Node | null)) held.length = 0; });
  root.addEventListener("pointerdown", () => audio.unlock(), { capture: true });
  canvas.addEventListener("pointerdown", event => {
    root.focus({ preventScroll: true });
    if (state.scene.kind !== "field") { confirm(); return; }
    if (!uiPrefs.clickMove || menuOpen || state.routes?.length || !event.isPrimary || event.button !== 0 || !mapView || mapView.mapId !== state.mapId) return;
    const map = content.maps[state.mapId];
    if (!map) return;
    const rect = canvas.getBoundingClientRect();
    const sx = (event.clientX - rect.left) * canvas.width / rect.width / mapView.zoom;
    const sy = (event.clientY - rect.top) * canvas.height / rect.height / mapView.zoom;
    const target = { x: Math.floor((sx - mapView.originX) / TILE), y: Math.floor((sy - mapView.originY) / TILE) };
    if (target.x < 0 || target.y < 0 || target.x >= map.width || target.y >= map.height) return;

    const npcs = engine.visibleNpcs(state, map);
    const entities = engine.visibleEntities(state, map);
    const interactables = engine.visibleInteractables(state, map).filter(item => item.trigger === "action");
    const actor = npcs.some(n => n.x === target.x && n.y === target.y)
      || entities.some(e => e.x === target.x && e.y === target.y)
      || interactables.some(i => i.x === target.x && i.y === target.y);
    const occupied = new Set([
      ...npcs.map(n => `${n.x},${n.y}`),
      ...entities.map(e => `${e.x},${e.y}`),
      ...interactables.filter(i => i.solid).map(i => `${i.x},${i.y}`),
    ]);
    const start = { x: state.player.x, y: state.player.y };
    const keyOf = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    const steps: Array<{ dir: Direction; x: number; y: number }> = [
      { dir: "up", x: 0, y: -1 }, { dir: "right", x: 1, y: 0 }, { dir: "down", x: 0, y: 1 }, { dir: "left", x: -1, y: 0 },
    ];
    const opposite: Record<Direction, Direction> = { up: "down", right: "left", down: "up", left: "right" };
    const edgeWalls = (x: number, y: number) => {
      const codes = [engine.codeAt(state, map, x, y), ...(map.layers ?? []).filter(layer => !layer.above).map(layer => Array.from(layer.rows[y] ?? "")[x] ?? " ")];
      return codes.flatMap(code => content.tileset.tiles.find(tile => tile.code === code)?.walls ?? []);
    };
    const edgeBlocked = (from: { x: number; y: number }, dir: Direction) => edgeWalls(from.x, from.y).includes(dir)
      || edgeWalls(from.x + steps.find(step => step.dir === dir)!.x, from.y + steps.find(step => step.dir === dir)!.y).includes(opposite[dir]);
    const paths = new Map<string, Direction[]>([[keyOf(start), []]]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i]!;
      for (const step of steps) {
        const next = { x: at.x + step.x, y: at.y + step.y };
        const key = keyOf(next);
        if (paths.has(key) || occupied.has(key) || edgeBlocked(at, step.dir) || !engine.isPassable(state, next.x, next.y)) continue;
        paths.set(key, [...paths.get(keyOf(at))!, step.dir]);
        queue.push(next);
      }
    }
    let destination = target;
    let path = paths.get(keyOf(target));
    if (actor) {
      const adjacent = steps.map(step => ({ x: target.x + step.x, y: target.y + step.y }))
        .filter(p => paths.has(keyOf(p)))
        .sort((a, b) => paths.get(keyOf(a))!.length - paths.get(keyOf(b))!.length);
      destination = adjacent[0] ?? target;
      path = paths.get(keyOf(destination));
    }
    if (!path) { showToast("そこへは歩いて行けません"); return; }
    clickRoute = [...path]; clickRouteMap = state.mapId; clickInteract = actor;
    held.length = 0;
    if (actor && path.length === 0) {
      const face = steps.find(step => target.x === start.x + step.x && target.y === start.y + step.y)?.dir;
      if (face) state = { ...state, player: { ...state.player, facing: face } };
      clickInteract = false;
      dispatch({ type: "interact" });
    }
  });

  /* ------------------------------------------------------------ windows */
  let typingTokens: TextToken[] = [];
  let lastRenderedCount = -1;
  let soundsPlayed = new Set<number>();
  function startTyping(text: string) {
    if (typingScene === state.scene && typing.text === text && typing.startedAt) return;
    typingScene = state.scene;
    typing = { text, startedAt: performance.now(), done: false };
    typingReadyAt = 0;
    typingTokens = parseMarkup(text);
    soundsPlayed = new Set();
    lastRenderedCount = -1;
    live.textContent = stripMarkup(text);
  }
  function finishTyping() { typing = { ...typing, done: true }; typingReadyAt = performance.now(); updateTyping(typingReadyAt); }
  function updateTyping(now: number) {
    const target = windowLayer.querySelector<HTMLElement>("[data-typing]");
    if (!target) return;
    const total = plainLength(typingTokens);
    const speedMs = uiPrefs.textSpeed === "instant" ? 0 : uiPrefs.textSpeed === "fast" ? 8 : TEXT_SPEED_MS;
    const typed = typedAt(typingTokens, now - typing.startedAt, speedMs);
    const count = typing.done ? total : typed.count;
    if (!typing.done) for (const i of typed.sounds) if (!soundsPlayed.has(i)) { soundsPlayed.add(i); const tok = typingTokens[i]; if (tok?.kind === "se") audio.playSound(tok.sound); }
    const finished = typed.count >= total && typed.sounds.length === typingTokens.filter(t => t.kind === "se").length;
    if (finished && !typing.done) { typing = { ...typing, done: true }; typingReadyAt = now; renderCaret(); }
    if (lastRenderedCount !== count) {
      // 文字送りの音: one blip every other letter while typing.
      if (content.project.audio.textSound && uiPrefs.textSound && !typing.done && Math.floor(count / 2) !== Math.floor(Math.max(0, lastRenderedCount) / 2)) audio.cue("text");
      lastRenderedCount = count;
      renderMarkup(target, typingTokens, count);
    }
  }
  function renderCaret() {
    windowLayer.querySelector(".rpg-caret")?.classList.toggle("is-ready", typing.done);
  }

  /** Face picture next to the text: frame `face` of a portrait (or character) sheet. */
  function portraitCanvas(id: string, face: number): HTMLCanvasElement | null {
    const asset = content.assets.assets.find(a => a.id === id);
    const image = images[id];
    if (!asset || !image?.complete || !image.naturalWidth) return null;
    const columns = asset.columns ?? 1, tw = asset.tileWidth ?? image.naturalWidth / columns, th = asset.tileHeight ?? image.naturalHeight / (asset.rows ?? 1);
    const canvas = el("canvas", "rpg-face");
    canvas.width = tw; canvas.height = th;
    const g = canvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.drawImage(image, (face % columns) * tw, Math.floor(face / columns) * th, tw, th, 0, 0, tw, th);
    return canvas;
  }

  function messageWindow(speaker: string | undefined, text: string, extra?: HTMLElement, portrait?: { id: string; face: number }, speakerColor?: string) {
    const plain = stripMarkup(text);
    if (plain.trim()) {
      const last = backlog.at(-1);
      if (!last || last.speaker !== speaker || last.text !== plain) {
        backlog.push({ speaker, text: plain });
        if (backlog.length > 40) backlog.shift();
      }
    }
    const box = el("div", "rpg-window rpg-message");
    const face = portrait ? portraitCanvas(portrait.id, portrait.face) : null;
    if (face) { box.classList.add("has-face"); box.appendChild(face); }
    if (speaker) {
      const name = el("div", "rpg-speaker", speaker);
      if (speakerColor) name.style.color = speakerColor;
      box.appendChild(name);
    }
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
    if (opts.hint) button.title = opts.hint;
    button.append(el("span", "rpg-option-label", label));
    if (opts.hint) button.append(el("span", "rpg-option-hint", opts.hint));
    button.disabled = Boolean(opts.disabled);
    button.addEventListener("click", event => { event.stopPropagation(); audio.cue("confirm"); onClick(); root.focus({ preventScroll: true }); });
    button.addEventListener("pointerenter", () => { const i = buttons().indexOf(button); if (i < 0) return; selection = i; highlight(); });
    return button;
  }

  function useCostHints(use: Use): string {
    return [
      ...use.cost.map(cost => `${content.project.variables[cost.var]?.label ?? cost.var} ${typeof cost.amount === "number" ? cost.amount : "消費"}`),
      ...(use.hpCost === undefined ? [] : [`HP ${typeof use.hpCost === "number" ? use.hpCost : "消費"}`]),
      ...(use.mpCost === undefined ? [] : [`MP ${typeof use.mpCost === "number" ? use.mpCost : "消費"}`]),
      ...(use.spCost === undefined ? [] : [`SP ${typeof use.spCost === "number" ? use.spCost : "消費"}`]),
    ].join("　");
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

  /** Still pictures (showPicture): one element per slot, faded in / out; frame 0 of a sheet. */
  const pictureEls = new Map<string, { image: string; node: HTMLElement }>();
  function syncPictures() {
    const wanted = state.pictures ?? {};
    for (const [slot, shown] of pictureEls) {
      if (wanted[slot]?.image === shown.image) continue;
      const node = shown.node;
      node.style.opacity = "0";
      window.setTimeout(() => node.remove(), 600);
      pictureEls.delete(slot);
    }
    for (const [slot, pic] of Object.entries(wanted)) {
      let entry = pictureEls.get(slot);
      if (!entry) {
        const asset = content.assets.assets.find(a => a.id === pic.image);
        const image = images[pic.image];
        if (!asset || !image) continue;
        let node: HTMLElement;
        if ((asset.columns ?? 1) > 1 || (asset.rows ?? 1) > 1) {
          const tw = asset.tileWidth ?? image.naturalWidth / (asset.columns ?? 1), th = asset.tileHeight ?? image.naturalHeight / (asset.rows ?? 1);
          const c = el("canvas", "rpg-picture");
          c.width = tw || 1; c.height = th || 1;
          const g = c.getContext("2d")!; g.imageSmoothingEnabled = false;
          if (image.complete && image.naturalWidth) g.drawImage(image, 0, 0, tw, th, 0, 0, tw, th);
          node = c;
        } else {
          const img = el("img", "rpg-picture");
          img.src = image.src; img.alt = "";
          node = img;
        }
        node.style.opacity = "0";
        pictureLayer.appendChild(node);
        entry = { image: pic.image, node };
        pictureEls.set(slot, entry);
        void node.offsetWidth; // start the fade from 0
      }
      const s = entry.node.style;
      s.transition = `opacity ${pic.fadeMs}ms ease, left ${pic.fadeMs}ms ease, top ${pic.fadeMs}ms ease, width ${pic.fadeMs}ms ease`;
      s.left = `${pic.x}%`; s.top = `${pic.y}%`; s.width = `${pic.width}%`; s.opacity = String(pic.opacity);
    }
  }

  /** Minimap (project.minimap): each cell in its tile colour, the hero as a blinking dot. */
  function minimapCanvas(): HTMLCanvasElement | null {
    const cfg = content.project.minimap;
    const map = content.maps[state.mapId];
    if (!cfg?.enabled || !uiPrefs.minimap || !map || !map.minimap || state.scene.kind !== "field") return null;
    const cell = Math.max(1, Math.floor(cfg.size / Math.max(map.width, map.height)));
    const c = el("canvas", "rpg-minimap");
    c.dataset.src = "packages/runtime/src/player.ts#minimapCanvas";
    c.width = map.width * cell; c.height = map.height * cell;
    c.title = "ミニマップ（N キーで表示を切り替え）";
    const g = c.getContext("2d")!;
    const colorOf = new Map(content.tileset.tiles.map(t => [t.code, t.color] as const));
    const rows = engine.rowsFor(state, map.id);
    for (let y = 0; y < map.height; y++) {
      const row = Array.from(rows[y] ?? "");
      for (let x = 0; x < map.width; x++) {
        const tile = content.tileset.tiles.find(t => t.code === row[x]);
        g.fillStyle = colorOf.get(row[x] ?? "") ?? "#222";
        g.globalAlpha = tile && !tile.passable ? 0.55 : 1;
        g.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = "#f0c36a";
    for (const p of map.portals) g.fillRect(p.x * cell, p.y * cell, cell, cell);
    g.fillStyle = "#ff4b3e";
    const r = Math.max(2, cell);
    g.fillRect(state.player.x * cell + cell / 2 - r / 2, state.player.y * cell + cell / 2 - r / 2, r, r);
    return c;
  }

  function renderUI() {
    root.style.fontSize = uiPrefs.largeText ? "1.2em" : "1em";
    root.dataset.reducedMotion = String(uiPrefs.reducedMotion);
    root.dataset.colorAssist = String(uiPrefs.colorAssist);
    syncPictures();
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
    const lvInfo = engine.levelInfo(state);
    hp.append(el("span", "rpg-hud-label", `${heroName()}${lvInfo ? `  Lv${lvInfo.level}` : ""}  HP ${state.player.hp}/${eff.maxHp}${statusTags(state.player.statuses)}`), hpBar(state.player.hp, eff.maxHp, state.player.hp <= eff.maxHp / 4 ? "is-low" : ""));
    if ((eff.maxMp ?? 0) > 0) hp.append(el("span", "rpg-hud-label", `MP ${state.player.mp ?? 0}/${eff.maxMp}`), hpBar(state.player.mp ?? 0, eff.maxMp!, "is-mp"));
    if ((eff.maxSp ?? 0) > 0) hp.append(el("span", "rpg-hud-label", `SP ${state.player.sp ?? 0}/${eff.maxSp}`), hpBar(state.player.sp ?? 0, eff.maxSp!, "is-sp"));
    const extra = (() => { try { return engine.hudLines(state); } catch { return []; } })();
    if (extra.length) { const box = el("div", "rpg-hud-vars"); for (const line of extra) box.appendChild(el("span", undefined, line)); left.append(box); }
    if (state.carrying) {
      const carried = content.maps[state.carrying.home]?.entities.find(e => e.id === state.carrying!.id);
      left.append(el("div", "rpg-hud-vars", `運んでいる: ${carried?.states.find(st => st.name)?.name ?? carried?.name ?? state.carrying.id}（向いた先の空きマスで決定すると置く）`));
    }
    if (uiPrefs.showControls && state.scene.kind === "field") left.append(el("div", "rpg-hud-vars", "操作: 矢印 / WASDで移動 · Enter / Zで決定 · Esc / Xでメニュー"));
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
    const mini = minimapCanvas();
    if (mini) { const right = el("div", "rpg-hud-right"); right.append(hp, mini); hud.append(left, right); }
    else hud.append(left, hp);
    hud.hidden = state.scene.kind === "battle" || state.scene.kind === "ending" || state.scene.kind === "custom" || state.scene.kind === "gameover";
    root.dataset.scene = menuOpen ? "menu" : state.scene.kind;

    const scene = state.scene;
    if (menuOpen && atTitle) { hud.hidden = true; typing = { ...typing, done: true }; renderMenu(); }
    else if (scene.kind === "message") { messageWindow(scene.speaker, scene.text, undefined, scene.portrait ? { id: scene.portrait, face: scene.face ?? 0 } : undefined); speak(scene.voice, `msg#${scene.text}`); }
    else if (scene.kind === "dialogue") {
      const dialogue = content.dialogues[scene.dialogueId]!;
      messageWindow(dialogue.speaker, engine.dialogueLines(state, dialogue.id)[scene.line] ?? "", undefined, dialogue.portrait ? { id: dialogue.portrait, face: engine.dialogueFaces(state, dialogue.id)[scene.line] ?? 0 } : undefined, dialogue.speakerColor);
      speak(engine.dialogueVoices(state, dialogue.id)[scene.line], `${dialogue.id}#${scene.line}`);
    } else if (scene.kind === "choice") {
      const dialogue = content.dialogues[scene.dialogueId]!;
      const list = el("div", "rpg-window rpg-choices");
      for (const choice of dialogue.choices) {
        if (!engine.evaluate(choice.when, state)) continue;
        list.appendChild(navButton(engine.text(state, choice.label), () => dispatch({ type: "choose", choiceId: choice.id })));
      }
      messageWindow(dialogue.speaker, engine.dialogueLines(state, dialogue.id).at(-1) ?? "", list, dialogue.portrait ? { id: dialogue.portrait, face: engine.dialogueFaces(state, dialogue.id).at(-1) ?? 0 } : undefined, dialogue.speakerColor);
      typing = { ...typing, done: true };
    } else if (scene.kind === "prompt") {
      const list = el("div", "rpg-window rpg-choices");
      for (const option of scene.options) list.appendChild(navButton(option.label, () => dispatch({ type: "choose", choiceId: option.id })));
      if (scene.prompt) { messageWindow(scene.speaker, scene.prompt, list); typing = { ...typing, done: true }; }
      else windowLayer.appendChild(list);
    } else if (scene.kind === "input") {
      // 名前入力・合言葉: a real text box (IME works), Enter or the button sends it.
      const form = el("form", "rpg-window rpg-input");
      form.dataset.src = "packages/runtime/src/player.ts#input";
      const field = el("input", "rpg-input-field");
      field.type = "text"; field.maxLength = scene.maxLength; field.value = scene.initial; field.autocomplete = "off";
      field.setAttribute("aria-label", scene.prompt ? stripMarkup(scene.prompt) : "文字を入力");
      const ok = el("button", "rpg-nav", "決定");
      ok.type = "submit";
      form.append(field, ok);
      form.addEventListener("submit", event => { event.preventDefault(); if (field.value.trim() || scene.saveAs !== "name") dispatch({ type: "submitText", text: field.value }); });
      field.addEventListener("keydown", event => { if (event.key === "Escape") field.blur(); });
      if (scene.prompt) { messageWindow(scene.speaker, scene.prompt, form); typing = { ...typing, done: true }; }
      else windowLayer.appendChild(form);
      window.setTimeout(() => { field.focus({ preventScroll: true }); field.select(); }, 0);
    } else if (scene.kind === "battle") renderBattle(scene.battle);
    else if (scene.kind === "custom") renderCustomScene(scene);
    else if (scene.kind === "gameover" && !menuOpen) {
      // GAME OVER screen (project.gameOver.mode "screen"): load a save, back to the title, or wake up again.
      const go = content.project.gameOver!;
      const box = el("div", "rpg-window rpg-ending rpg-gameover");
      box.dataset.src = "packages/runtime/src/player.ts#gameover";
      const bg = go.image ? content.assets.assets.find(a => a.id === go.image) : undefined;
      if (bg) void Promise.resolve(options.resolveAsset(bg)).then(url => { box.style.backgroundImage = `linear-gradient(rgba(10,6,6,.45), rgba(10,6,6,.8)), url("${url}")`; });
      box.append(el("div", "rpg-ending-title rpg-gameover-title", go.title));
      if (go.text) box.appendChild(el("div", "rpg-ending-text", engine.text(state, go.text)));
      const hasSave = SLOTS.some(slot => readSlot(slot));
      if (hasSave) box.appendChild(navButton("ロードする", () => { menuOpen = true; slotReturn = "main"; menuView = "load"; selection = 0; renderUI(); }));
      if (go.retry) box.appendChild(navButton("もう一度立ち上がる", () => dispatch({ type: "advance" })));
      box.appendChild(navButton("タイトルへ", () => askConfirm("タイトルに戻りますか？", () => { setState(engine.newGame(options.seed)); if (content.project.titleScreen.enabled) { menuOpen = true; menuView = "title"; atTitle = true; } renderUI(); })));
      windowLayer.appendChild(box);
    }
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
    if (asking) {
      const q = asking;
      const box = el("div", "rpg-window rpg-confirm");
      box.setAttribute("role", "alertdialog");
      box.append(el("div", "rpg-confirm-text", q.text));
      const row = el("div", "rpg-menu-row");
      row.append(navButton("はい", () => { asking = null; selection = 0; q.yes(); renderUI(); }), navButton("いいえ", () => { asking = null; selection = 0; renderUI(); }));
      box.appendChild(row);
      // Only the dialog's buttons are reachable while it is open.
      windowLayer.querySelectorAll<HTMLElement>("[data-nav]").forEach(b => { b.removeAttribute("data-nav"); b.setAttribute("aria-hidden", "true"); });
      windowLayer.appendChild(box);
    }
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

  /** "［毒3］［攻↑2］" — status labels with turns left. */
  function statusTags(list: Array<{ id: string; turns: number }> | undefined): string {
    if (!list?.length) return "";
    return " " + list.map(s => { const d = content.database.statuses.find(x => x.id === s.id); return `［${d?.label ?? d?.name ?? s.id}${s.turns}］`; }).join("");
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
    const foes = [{ enemyId: battle.enemyId, hp: battle.enemyHp, slot: battle.slot ?? 0 }, ...(battle.foes ?? []).map((f, k) => ({ ...f, slot: f.slot ?? k + 1 }))];
    for (const foe of foes) {
      const e = content.database.enemies.find(x => x.id === foe.enemyId)!;
      const row = el("div", foe.hp <= 0 ? "rpg-enemy-row is-down" : "rpg-enemy-row");
      const tags = statusTags(battle.enemyStatuses?.[String(foe.slot)]);
      row.append(el("div", "rpg-enemy-name", `${e.name}${foes.length > 1 && foe.hp <= 0 ? "（倒れた）" : ""}${tags}`), hpBar(foe.hp, e.stats.maxHp, "is-enemy"));
      enemyInfo.appendChild(row);
    }
    const portraits = el("div", "rpg-portraits");
    // Battle animations (cue "anim") still playing, as CSS effects over the enemy pictures / the hero's window.
    const nowFx = performance.now();
    anims = anims.filter(a => nowFx - a.at < 900);
    const fx = (name: string, at: number) => { const d = el("div", `rpg-fx rpg-fx-${name}`); d.style.animationDelay = `${-(nowFx - at)}ms`; return d; };
    portraitCanvases = foes.map(foe => {
      const c = el("canvas", foes.length > 1 ? "rpg-portrait is-group" : "rpg-portrait"); c.width = 128; c.height = 128;
      const wrap = el("div", foes.length > 1 ? "rpg-portrait-wrap is-group" : "rpg-portrait-wrap");
      wrap.appendChild(c);
      for (const a of anims) if (a.target === "enemy" && (a.slot === "all" || a.slot === foe.slot)) wrap.appendChild(fx(a.name, a.at));
      portraits.appendChild(wrap);
      return c;
    });
    if (anims.length) window.setTimeout(() => { if (!destroyed && state.scene.kind === "battle") renderUI(); }, 920);
    stage.append(enemyInfo, portraits);
    const status = el("div", "rpg-window rpg-battle-status");
    for (const a of anims) if (a.target === "player") status.appendChild(fx(a.name, a.at));
    status.append(el("div", "rpg-speaker", `${heroName()}${engine.levelInfo(state) ? `  Lv${engine.levelInfo(state)!.level}` : ""}${statusTags(state.player.statuses)}`), el("div", "rpg-battle-hp", `HP ${state.player.hp} / ${eff.maxHp}`), hpBar(state.player.hp, eff.maxHp, state.player.hp <= eff.maxHp / 4 ? "is-low" : ""));
    if ((eff.maxMp ?? 0) > 0) status.append(el("div", "rpg-battle-resource", `MP ${state.player.mp ?? 0}/${eff.maxMp}`), hpBar(state.player.mp ?? 0, eff.maxMp!, "is-mp"));
    if ((eff.maxSp ?? 0) > 0) status.append(el("div", "rpg-battle-resource", `SP ${state.player.sp ?? 0}/${eff.maxSp}`), hpBar(state.player.sp ?? 0, eff.maxSp!, "is-sp"));
    for (const member of (state.party ?? []).filter(m => !m.reserve)) {
      const comp = content.database.companions.find(x => x.id === member.id);
      if (comp) {
        const cs = engine.companionStats(state, comp.id);
        const resourceText = `${(cs.maxMp ?? 0) > 0 ? ` MP ${member.mp ?? 0}/${cs.maxMp}` : ""}${(cs.maxSp ?? 0) > 0 ? ` SP ${member.sp ?? 0}/${cs.maxSp}` : ""}`;
        status.append(el("div", "rpg-battle-var", `${comp.name} HP ${member.hp}/${cs.maxHp}${resourceText}${member.hp <= 0 ? "（倒れている）" : battle.orders?.[comp.id] !== undefined ? `（${comp.actions[battle.orders[comp.id]!]?.name}）` : ""}`));
      }
    }
    for (const [id, decl] of Object.entries(content.project.variables)) if (decl.hud) status.appendChild(el("div", "rpg-battle-var", `${decl.label ?? id} ${state.vars[id] ?? decl.initial}`));
    if (battle.wave) status.appendChild(el("div", "rpg-battle-var", `連戦 第${battle.wave}陣 / 全${battle.wave + (battle.waves?.length ?? 0)}陣`));
    // Turn order (project.battle.order "speed"): who acts next, fastest first.
    if (content.project.battle.order !== "fixed" && battle.outcome === "ongoing") status.appendChild(el("div", "rpg-battle-var rpg-turn-order", `行動順: ${engine.turnOrder(state).map(a => a.name).join(" → ")}`));
    const log = el("div", "rpg-window rpg-battle-log");
    for (const line of battle.log.slice(-4)) log.appendChild(el("div", "rpg-log-line", stripMarkup(line)));
    live.textContent = stripMarkup(battle.log[battle.log.length - 1] ?? "");
    const commands = el("div", "rpg-window rpg-commands");
    const usable = engine.usables(state, "battle");
    const skills = usable.filter(u => u.kind === "ability");
    const items = usable.filter(u => u.kind === "item");
    if (battle.outcome !== "ongoing") {
      battlePicker = null;
      const label = battle.outcome === "victory" ? "勝利！ 次へ" : battle.outcome === "fled" ? "フィールドへ戻る" : "次へ";
      commands.appendChild(navButton(label, () => dispatch({ type: "advance" })));
    } else if (battlePicker === "orders") {
      const standing = (state.party ?? []).filter(m => m.hp > 0 && !m.reserve);
      const comp = orderCompanion ? content.database.companions.find(x => x.id === orderCompanion) : undefined;
      if (!comp) {
        for (const m of standing) { const c = content.database.companions.find(x => x.id === m.id); if (c) commands.appendChild(navButton(c.name, () => { orderCompanion = c.id; selection = 0; renderUI(); }, { hint: `HP ${m.hp}` })); }
      } else {
        comp.actions.forEach((a, i) => {
          const costs = [
            ...(a.mpCost === undefined ? [] : [`MP ${typeof a.mpCost === "number" ? a.mpCost : "消費"}`]),
            ...(a.spCost === undefined ? [] : [`SP ${typeof a.spCost === "number" ? a.spCost : "消費"}`]),
          ];
          commands.appendChild(navButton(a.name, () => { battlePicker = null; orderCompanion = null; dispatch({ type: "battle", command: "order", companion: comp.id, action: i }); }, { hint: [{ attack: "攻撃", heal: "手当て", guard: "守り" }[a.kind], ...costs].join("　") }));
        });
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
        const detail = u.kind === "item" ? content.database.items.find(item => item.id === u.id)?.description : content.database.abilities.find(ability => ability.id === u.id)?.description;
        commands.appendChild(navButton(u.name, () => { battlePicker = null; dispatch(u.kind === "item" ? { type: "battle", command: "item", item: u.id } : { type: "battle", command: "skill", ability: u.id }); }, {
          hint: [u.blocked, u.kind === "item" ? `×${u.count}` : useCostHints(u.use), detail].filter(Boolean).join("　"),
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
        ...((state.party ?? []).some(m => m.hp > 0 && !m.reserve) ? [navButton("なかま", () => { battlePicker = "orders"; orderCompanion = null; selection = 0; renderUI(); }, { hint: "指示" })] : []),
        ...engine.commands(state, "battle").map(cmd => navButton(cmd.label, () => { if (cmd.blocked) showToast(cmd.blocked); else dispatch({ type: "battle", command: "script", source: cmd.source, id: cmd.id }); }, { hint: cmd.blocked ?? "", disabled: Boolean(cmd.blocked) })),
        navButton("にげる", () => dispatch({ type: "battle", command: "flee" }), { hint: "4", disabled: !battle.canFlee }),
        navButton(autoBattle ? "オート中（止める）" : "オート", () => { autoBattle = !autoBattle; renderUI(); }, { hint: "自動で攻撃" }),
      );
    }
    // オート戦闘: keep attacking (the first enemy standing) until the battle ends.
    window.clearTimeout(autoTimer);
    if (autoBattle && battle.outcome === "ongoing" && battlePicker === null) {
      autoTimer = window.setTimeout(() => { if (!destroyed && autoBattle && state.scene.kind === "battle" && state.scene.battle.outcome === "ongoing") dispatch({ type: "battle", command: "attack" }); }, uiPrefs.battleSpeed === "fast" ? 160 : 520);
    } else if (battle.outcome !== "ongoing") autoBattle = false;
    const bottom = el("div", "rpg-battle-bottom");
    bottom.append(status, log, commands);
    panel.append(stage, bottom);
    // Damage numbers that rise and fade (kept running across re-renders with a negative animation delay).
    const now = performance.now();
    popups = popups.filter(p => now - p.at < POPUP_MS);
    popups.forEach((p, i) => {
      const pop = el("div", `rpg-pop is-${p.target}`, p.text);
      pop.style.animationDelay = `${-(now - p.at)}ms`;
      pop.style.setProperty("--dx", `${((p.n * 37) % 5 - 2) * 1.2}em`);
      if (i > 6) return;
      panel.appendChild(pop);
    });
    if (popups.length) window.setTimeout(() => { if (!destroyed && state.scene.kind === "battle" && popups.some(p => performance.now() - p.at >= POPUP_MS)) renderUI(); }, POPUP_MS);
    windowLayer.appendChild(panel);
  }

  function savePrefs(nextAudio: AudioSettings) {
    audio.applySettings(nextAudio);
    try { storage.write(settingsKey, JSON.stringify({ ...nextAudio, ...uiPrefs })); } catch { /* settings are optional */ }
    renderUI();
  }
  function renderBacklog() {
    const panel = el("div", "rpg-window rpg-menu");
    panel.appendChild(el("div", "rpg-menu-title", "会話履歴"));
    if (!backlog.length) panel.appendChild(el("div", "rpg-menu-empty", "まだ会話がありません"));
    for (const entry of backlog.slice(-20).reverse()) {
      const row = el("div", "rpg-menu-ability");
      row.append(el("strong", undefined, entry.speaker ?? "ナレーション"), el("span", undefined, entry.text));
      panel.appendChild(row);
    }
    panel.appendChild(navButton("もどる", () => { backlogOpen = false; selection = 0; renderUI(); }));
    windowLayer.appendChild(panel);
  }

  /** Which BGM should play now: enemy / battle music, a playBgm override, or the map's. */
  function syncMusic() {
    const scene = state.scene;
    audio.setAmbient(scene.kind === "battle" ? null : state.ambient !== undefined ? state.ambient : content.maps[state.mapId]?.ambient ?? null);
    if (scene.kind === "battle" && scene.battle.outcome === "ongoing") {
      const enemy = content.database.enemies.find(e => e.id === scene.battle.enemyId);
      const battleMusic = scene.battle.music === null ? enemy?.bgm ?? content.project.audio.battle : scene.battle.music ?? enemy?.bgm ?? content.project.audio.battle;
      if (battleMusic) { audio.setMusic(battleMusic); return; }
    }
    if (scene.kind === "battle" && scene.battle.outcome === "victory" && content.project.audio.victory) { audio.setMusic(null); return; }
    if (scene.kind === "gameover" || (scene.kind === "battle" && scene.battle.outcome === "defeat")) { audio.setMusic(content.project.gameOver?.music ?? null); return; }
    audio.setMusic(state.music !== undefined ? state.music : content.maps[state.mapId]?.bgm ?? null);
  }

  function renderCredits() {
    const panel = el("div", "rpg-window rpg-menu rpg-credits");
    panel.appendChild(el("div", "rpg-menu-title", "クレジット"));
    for (const line of creditLines(content)) panel.appendChild(el("div", "rpg-credit-line", line));
    panel.appendChild(navButton("もどる", () => { creditsOpen = false; selection = 0; renderUI(); }));
    windowLayer.appendChild(panel);
  }

  function openFeedbackPage() {
    const feedback = content.project.feedback;
    if (!feedback) return;
    let url: URL;
    try { url = new URL(feedback.url); }
    catch { showToast("フィードバックURLを開けません"); return; }
    if (url.protocol !== "https:") { showToast("フィードバックURLはHTTPSのみ開けます"); return; }
    window.open(url.href, "_blank", "noopener,noreferrer");
  }

  function slotSummary(slot: Slot): string | null {
    const raw = readSlot(slot);
    if (!raw) return null;
    try {
      const save = JSON.parse(raw) as { savedAt?: string; state?: GameState };
      const st = save.state;
      const when = save.savedAt ? new Date(save.savedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
      return `${st ? (content.maps[st.mapId]?.title ?? st.mapId) : "?"}${st?.player.level ? `　Lv${st.player.level}` : ""}　${st?.steps ?? 0}歩　${when}`;
    } catch { return "（読めないデータ）"; }
  }
  function renderSlots(mode: "save" | "load") {
    const panel = el("div", "rpg-window rpg-menu rpg-slots");
    panel.appendChild(el("div", "rpg-menu-title", mode === "save" ? "どこにセーブする？" : "どれをロードする？"));
    for (const slot of SLOTS) {
      if (mode === "save" && slot === "auto") continue;
      const summary = slotSummary(slot);
      panel.appendChild(navButton(slotLabel(slot), () => {
        if (mode === "save") { if (summary) askConfirm(`${slotLabel(slot)}に上書きしますか？\n（${summary}）`, () => save(slot)); else save(slot); }
        else if (!atTitle) askConfirm(`${slotLabel(slot)}をロードしますか？\nいまの進み具合のうち、セーブしていない分はなくなります。`, () => load(slot));
        else load(slot);
      }, { hint: summary ?? "（空き）", disabled: mode === "load" && !summary }));
    }
    const row = el("div", "rpg-menu-row");
    if (mode === "load") row.appendChild(navButton("ファイルから読み込む", () => importSave()));
    if (mode === "save") row.appendChild(navButton("いまの状態をファイルに書き出す", () => exportSave()));
    row.appendChild(navButton("もどる", () => { menuView = slotReturn; selection = 0; renderUI(); }));
    panel.appendChild(row);
    panel.appendChild(el("div", "rpg-menu-empty", "セーブはこのブラウザに保存されます。消える前に「ファイルに書き出す」で残せます。"));
    windowLayer.appendChild(panel);
  }
  function renderTitle() {
    const box = el("div", "rpg-window rpg-title");
    const bgId = content.project.titleScreen.background;
    const bg = bgId ? content.assets.assets.find(a => a.id === bgId) : undefined;
    if (bg) void Promise.resolve(options.resolveAsset(bg)).then(url => { box.style.backgroundImage = `linear-gradient(rgba(10,14,11,.35), rgba(10,14,11,.75)), url("${url}")`; });
    box.append(el("div", "rpg-title-name", content.project.title));
    if (content.project.titleScreen.subtitle) box.append(el("div", "rpg-title-sub", content.project.titleScreen.subtitle));
    const list = el("div", "rpg-title-menu");
    const hasSave = SLOTS.some(slot => readSlot(slot));
    list.append(
      navButton("はじめから", () => { atTitle = false; menuOpen = false; menuView = "main"; selection = 0; renderUI(); }),
      navButton("つづきから", () => { slotReturn = "title"; menuView = "load"; selection = 0; renderUI(); }, { disabled: !hasSave }),
      ...(content.project.feedback ? [navButton(content.project.feedback.label, openFeedbackPage, { hint: "フィードバックページを新しいタブで開く" })] : []),
      navButton("クレジット", () => { creditsOpen = true; selection = 0; renderUI(); }),
    );
    box.append(list);
    windowLayer.appendChild(box);
  }

  /** 図鑑: enemies met (stats after a win) and items ever held. Unknown ones show as ？？？. */
  function renderBook() {
    const panel = el("div", "rpg-window rpg-menu rpg-book");
    panel.dataset.src = "packages/runtime/src/player.ts#renderBook";
    const cfg = content.project.book!;
    const book = state.book ?? { seen: [], defeated: {}, items: [] };
    if (cfg.enemies) {
      const list = content.database.enemies.filter(e => !cfg.hidden.includes(e.id));
      panel.appendChild(el("div", "rpg-menu-title", `モンスター図鑑 ${list.filter(e => book.seen.includes(e.id)).length} / ${list.length}`));
      for (const e of list) {
        const met = book.seen.includes(e.id), wins = book.defeated[e.id] ?? 0;
        const drops = e.drops.map(d => content.database.items.find(i => i.id === d.item)?.name ?? d.item).join("・");
        panel.appendChild(el("div", "rpg-book-row", met ? `${e.name}${wins ? `　HP ${e.stats.maxHp}・攻 ${e.stats.attack}・守 ${e.stats.defense}${drops ? `・落とす物 ${drops}` : ""}　倒した数 ${wins}` : "　（まだ倒していない）"}` : "？？？"));
      }
    }
    if (cfg.items) {
      const list = content.database.items.filter(i => !cfg.hidden.includes(i.id));
      panel.appendChild(el("div", "rpg-menu-title", `アイテム図鑑 ${list.filter(i => book.items.includes(i.id)).length} / ${list.length}`));
      for (const i of list) panel.appendChild(el("div", "rpg-book-row", book.items.includes(i.id) ? `${i.name}　${i.description ?? ""}` : "？？？"));
    }
    panel.appendChild(navButton("もどる", () => { menuView = "main"; selection = 0; renderUI(); }));
    windowLayer.appendChild(panel);
  }
  /**
   * スキルボード: hexagonal panels of the chosen owner's boards. A panel next to a learned one (or a start panel)
   * can be learned with skill points; ？ panels open when their condition holds.
   */
  function renderSkills() {
    const panel = el("div", "rpg-window rpg-menu rpg-skills");
    panel.dataset.src = "packages/runtime/src/player.ts#renderSkills";
    const boards = content.database.skillBoards ?? [];
    const owners = ["hero", ...(state.party ?? []).map(m => m.id)].filter(o => boards.some(b => b.owner === o));
    if (!owners.includes(skillOwner)) skillOwner = owners[0] ?? "hero";
    const mine = boards.filter(b => b.owner === skillOwner);
    if (!mine.some(b => b.id === skillBoardId)) skillBoardId = mine[0]?.id ?? null;
    const board = mine.find(b => b.id === skillBoardId);
    const ownerName = (o: string) => (o === "hero" ? heroName() : content.database.companions.find(x => x.id === o)?.name ?? o);
    const points = state.skills?.points[skillOwner] ?? 0;
    const head = el("div", "rpg-skills-head");
    head.append(el("div", "rpg-menu-title", `スキル　${ownerName(skillOwner)}　のこり ${points} ポイント`));
    const tabs = el("div", "rpg-menu-row");
    if (owners.length > 1) for (const o of owners) tabs.appendChild(navButton(`${o === skillOwner ? "● " : ""}${ownerName(o)}`, () => { skillOwner = o; skillBoardId = null; selection = 0; renderUI(); }));
    for (const b of mine) tabs.appendChild(navButton(`${b.id === skillBoardId ? "▶ " : ""}${b.name}`, () => { skillBoardId = b.id; selection = 0; renderUI(); }));
    head.appendChild(tabs);
    panel.appendChild(head);
    if (!board) { panel.appendChild(el("div", "rpg-menu-empty", "スキルボードがありません")); panel.appendChild(navButton("もどる", () => { menuView = "main"; selection = 0; renderUI(); })); windowLayer.appendChild(panel); return; }
    // Hex layout (pointy-top, axial q/r) fitted into the box.
    const pos = board.nodes.map(n => ({ n, x: Math.sqrt(3) * (n.q + n.r / 2), y: 1.5 * n.r }));
    const minX = Math.min(...pos.map(p => p.x)) - 1, maxX = Math.max(...pos.map(p => p.x)) + 1;
    const minY = Math.min(...pos.map(p => p.y)) - 1.1, maxY = Math.max(...pos.map(p => p.y)) + 1.1;
    const area = el("div", "rpg-skill-board");
    area.style.aspectRatio = `${maxX - minX} / ${maxY - minY}`;
    const detail = el("div", "rpg-skill-detail");
    const before = panel.querySelectorAll("[data-nav]").length;
    const hexes = pos.map(({ n, x, y }, i) => {
      const status = engine.skillStatus(state, board.id, n.id);
      const label = status === "hidden" ? "？" : n.icon ?? n.name.slice(0, 2);
      const b = navButton(label, () => {
        if (status === "available") { dispatch({ type: "learnSkill", board: board.id, node: n.id }); audio.cue("item"); renderUI(); }
        else showToast(status === "learned" ? `${n.name}は覚えている` : status === "short" ? `スキルポイントが足りない（${n.cost}必要）` : status === "hidden" ? "まだ秘密のパネルだ" : "となりのパネルを先に覚えよう");
      });
      b.className = `rpg-option rpg-hex is-${status}`;
      b.style.left = `${((x - minX) / (maxX - minX)) * 100}%`;
      b.style.top = `${((y - minY) / (maxY - minY)) * 100}%`;
      b.style.width = `${(Math.sqrt(3) / (maxX - minX)) * 100}%`;
      b.title = status === "hidden" ? "？？？" : `${n.name}（${n.cost}）`;
      b.dataset.index = String(before + i);
      const mods = n.statMods ? (["maxHp", "maxMp", "maxSp", "attack", "defense"] as const).filter(k => typeof n.statMods?.[k] === "number").map(k => `${{ maxHp: "HP", maxMp: "MP", maxSp: "SP", attack: "攻撃", defense: "防御" }[k]}+${n.statMods![k]}`).join(" ") : "";
      const learns = n.abilities.map(a => content.database.abilities.find(x => x.id === a)?.name ?? a).join("・");
      b.dataset.skillName = status === "hidden" ? "？？？" : `${n.name}　${n.cost}ポイント`;
      b.dataset.skillDesc = status === "hidden" ? "条件を満たすと現れる。" : [n.description, mods, learns ? `覚える: ${learns}` : ""].filter(Boolean).join("　");
      b.dataset.skillState = { learned: "覚えた", available: "決定で覚える", short: "ポイントが足りない", locked: "となりのパネルを先に覚える", hidden: "" }[status];
      area.appendChild(b);
      return { b, n, status };
    });
    panel.appendChild(area);
    panel.appendChild(detail);
    panel.appendChild(navButton("もどる", () => { menuView = "main"; selection = 0; renderUI(); }));
    windowLayer.appendChild(panel);
    // The detail box follows the cursor (filled in highlight()).
    if (!hexes.some(h => h.b === buttons()[selection])) { const first = hexes.find(h => h.status === "available") ?? hexes[0]!; selection = Math.max(0, buttons().indexOf(first.b)); }
  }

  /** 隊列: front / back row for everyone, and who fights or waits in the reserve (project.party.size). */
  function renderFormation() {
    const panel = el("div", "rpg-window rpg-menu rpg-book");
    panel.dataset.src = "packages/runtime/src/player.ts#renderFormation";
    const size = content.project.party?.size;
    const fighting = (state.party ?? []).filter(m => !m.reserve).length;
    panel.appendChild(el("div", "rpg-menu-title", `隊列${size !== undefined ? `（戦う仲間 ${fighting} / ${size}人）` : ""}`));
    const p = content.project.party;
    panel.appendChild(el("div", "rpg-menu-empty", `後列は通常攻撃で受けるダメージ ${p?.backRowTaken ?? 50}%・与えるダメージ ${p?.backRowDealt ?? 50}%（技はそのまま）`));
    const hero = state.player.row === "back";
    panel.appendChild(navButton(`${heroName()}　${hero ? "後列" : "前列"}`, () => dispatch({ type: "formation", who: "hero", row: hero ? "front" : "back" }), { hint: "決定で前列／後列" }));
    for (const m of state.party ?? []) {
      const comp = content.database.companions.find(x => x.id === m.id);
      const line = el("div", "rpg-menu-row");
      line.append(
        navButton(`${comp?.name ?? m.id}　${m.row === "back" ? "後列" : "前列"}`, () => dispatch({ type: "formation", who: m.id, row: m.row === "back" ? "front" : "back" }), { hint: m.reserve ? "控え" : "" }),
        navButton(m.reserve ? "戦いに出す" : "控えにする", () => dispatch({ type: "formation", who: m.id, reserve: !m.reserve }), { disabled: Boolean(m.reserve && size !== undefined && fighting >= size) }),
      );
      panel.appendChild(line);
    }
    panel.appendChild(navButton("もどる", () => { menuView = "main"; selection = 0; renderUI(); }));
    windowLayer.appendChild(panel);
  }
  function renderAchievements() {
    const panel = el("div", "rpg-window rpg-menu rpg-book");
    panel.dataset.src = "packages/runtime/src/player.ts#renderAchievements";
    const all = Object.entries(content.project.achievements);
    const got = new Set(state.achievements ?? []);
    panel.appendChild(el("div", "rpg-menu-title", `実績 ${all.filter(([id]) => got.has(id)).length} / ${all.length}`));
    for (const [id, a] of all) {
      const open = got.has(id);
      panel.appendChild(el("div", open ? "rpg-book-row is-got" : "rpg-book-row", open ? `🏆 ${a.title}　${a.description}` : a.hidden ? "？？？（ひみつの実績）" : `・${a.title}　${a.description}`));
    }
    panel.appendChild(navButton("もどる", () => { menuView = "main"; selection = 0; renderUI(); }));
    windowLayer.appendChild(panel);
  }

  /** 依頼帳: accepted / completed / failed quests and their completed objectives. */
  function renderQuests() {
    const panel = el("div", "rpg-window rpg-menu rpg-book");
    panel.dataset.src = "packages/runtime/src/player.ts#renderQuests";
    const visible = Object.entries(content.project.quests).filter(([id, q]) => !q.hidden && state.quests?.[id]);
    panel.appendChild(el("div", "rpg-menu-title", `依頼帳　${visible.filter(([id]) => state.quests?.[id]?.status === "active").length}件進行中`));
    if (!visible.length) panel.appendChild(el("div", "rpg-menu-empty", "受けている依頼はありません。"));
    for (const [id, q] of visible) {
      const progress = state.quests?.[id];
      if (!progress) continue;
      const status = progress.status === "active" ? "進行中" : progress.status === "complete" ? "達成" : "失敗";
      panel.appendChild(el("div", "rpg-menu-title", `${status}　${q.title}`));
      if (q.description) panel.appendChild(el("div", "rpg-book-row", q.description));
      for (const objective of q.objectives) {
        const done = progress.objectivesDone.includes(objective.id);
        panel.appendChild(el("div", done ? "rpg-book-row is-got" : "rpg-book-row", `${done ? "✓" : "・"} ${objective.text}`));
      }
    }
    panel.appendChild(navButton("もどる", () => { menuView = "main"; selection = 0; renderUI(); }));
    windowLayer.appendChild(panel);
  }

  /**
   * project.menu: order of the sections (keys: party, traits, jobs, items, abilities, commands, verbs, records, set:<id>),
   * hidden ones, and ones shown only while a condition holds. Everything before the first section (title, stats) stays on top.
   */
  function arrangeMenu(menu: HTMLElement) {
    const cfg = content.project.menu;
    if (!cfg) return;
    const groups = new Map<string, Element[]>();
    let current: Element[] | null = null;
    for (const child of Array.from(menu.children)) {
      const key = (child as HTMLElement).dataset?.key;
      if (key) { current = [child]; groups.set(key, current); }
      else if (current) current.push(child);
    }
    const visible = (key: string) => !cfg.hidden.includes(key) && (cfg.when?.[key] === undefined || engine.evaluate(cfg.when[key]!, state));
    const order = [...cfg.order.filter(k => groups.has(k)), ...[...groups.keys()].filter(k => !cfg.order.includes(k))];
    for (const group of groups.values()) for (const node of group) node.remove();
    for (const key of order) if (visible(key)) for (const node of groups.get(key)!) menu.appendChild(node);
  }

  function renderMenu() {
    if (creditsOpen) { renderCredits(); return; }
    if (menuView === "title") { renderTitle(); return; }
    if (menuView === "save" || menuView === "load") { renderSlots(menuView); return; }
    if (menuView === "book") { renderBook(); return; }
    if (menuView === "achievements") { renderAchievements(); return; }
    if (menuView === "quests") { renderQuests(); return; }
    if (menuView === "formation") { renderFormation(); return; }
    if (menuView === "skills") { renderSkills(); return; }
    if (backlogOpen) { renderBacklog(); return; }
    const menu = el("div", "rpg-window rpg-menu");
    menu.appendChild(el("div", "rpg-menu-title", "メニュー"));
    const stats = el("div", "rpg-menu-stats");
    const s = engine.stats(state);
    const lv = engine.levelInfo(state);
    stats.textContent = `${heroName()}${lv ? `　Lv${lv.level}` : ""}　HP ${state.player.hp}/${s.maxHp}${(s.maxMp ?? 0) > 0 ? `　MP ${state.player.mp ?? 0}/${s.maxMp}` : ""}${(s.maxSp ?? 0) > 0 ? `　SP ${state.player.sp ?? 0}/${s.maxSp}` : ""}　攻撃 ${s.attack}　防御 ${s.defense}${lv ? `　経験値 ${lv.exp}${lv.next === null ? "（最大）" : `／次まで ${lv.next - lv.exp}`}` : ""}`;
    menu.appendChild(stats);
    // Sections can be reordered, renamed, hidden or shown on a condition (project.menu).
    const section = (title: string, key: string) => { const h = el("div", "rpg-menu-section", content.project.menu?.labels?.[key] ?? title); h.dataset.key = key; return menu.appendChild(h); };
    const labeled = Object.entries(content.project.variables).filter(([, decl]) => decl.label);
    if (labeled.length) {
      const vars = el("div", "rpg-menu-stats");
      vars.textContent = labeled.map(([id, decl]) => `${decl.label} ${state.vars[id] ?? decl.initial}`).join("　");
      menu.appendChild(vars);
    }
    for (const [id, decl] of Object.entries(content.project.sets)) {
      if (!decl.show) continue;
      section(decl.label ?? id, `set:${id}`);
      const values = state.sets[id] ?? [];
      if (!values.length) menu.appendChild(el("div", "rpg-menu-empty", "まだない"));
      for (const v of values) menu.appendChild(el("div", "rpg-menu-ability", decl.entries[v] ?? v));
    }
    if (state.party?.length) {
      section("なかま", "party");
      for (const member of state.party) {
        const comp = content.database.companions.find(x => x.id === member.id);
        const row = el("div", "rpg-menu-ability");
        const cs = engine.companionStats(state, member.id);
        const gear = Object.values(member.equipment ?? {}).map(i => content.database.items.find(x => x.id === i)?.name ?? i).join("・");
        row.append(el("strong", undefined, comp?.name ?? member.id), el("span", undefined, `HP ${member.hp}/${cs.maxHp}${(cs.maxMp ?? 0) > 0 ? `　MP ${member.mp ?? 0}/${cs.maxMp}` : ""}${(cs.maxSp ?? 0) > 0 ? `　SP ${member.sp ?? 0}/${cs.maxSp}` : ""}　攻 ${cs.attack}　防 ${cs.defense}${gear ? `　装備: ${gear}` : ""}${member.hp <= 0 ? "　倒れている" : ""}${member.row === "back" ? "　後列" : ""}${member.reserve ? "　控え" : ""}`));
        menu.appendChild(row);
      }
      menu.appendChild(navButton("隊列・入れ替え", () => { menuView = "formation"; selection = 0; renderUI(); }, { hint: "前列・後列、控え" }));
      if ((state.party ?? []).some(m => content.database.companions.find(x => x.id === m.id)?.chat?.length)) menu.appendChild(navButton("なかまと話す", () => { menuOpen = false; dispatch({ type: "partyChat" }); }, { hint: "いまの気持ちを聞く" }));
    }
    if ((content.database.skillBoards ?? []).length) {
      const pts = state.skills?.points.hero ?? 0;
      section("スキル", "skills");
      menu.appendChild(navButton("スキルボード", () => { menuView = "skills"; selection = 0; renderUI(); }, { hint: `のこり ${pts} ポイント` }));
    }
    if ((state.cycle ?? 1) > 1 || (state.sets.endings?.length ?? 0) > 0) stats.textContent += `　${state.cycle}周目`;
    if (state.traits.length) {
      section("とくせい", "traits");
      for (const id of state.traits) {
        const trait = content.database.traits.find(t => t.id === id);
        const row = el("div", "rpg-menu-ability");
        row.append(el("strong", undefined, `${trait?.name ?? id}${trait ? `（${trait.category}）` : ""}`), el("span", undefined, trait?.description ?? ""));
        menu.appendChild(row);
      }
    }
    // 転職: traits marked selectable (jobs), switchable while their condition holds.
    const jobs = content.database.traits.filter(t => t.selectable && engine.evaluate(t.selectableWhen, state));
    if (jobs.length) {
      section("しょくぎょう", "jobs");
      for (const job of jobs) {
        const current = state.traits.includes(job.id);
        menu.appendChild(navButton(`${current ? "● " : ""}${job.name}`, () => { if (!current) dispatch({ type: "chooseTrait", trait: job.id }); renderUI(); }, { hint: current ? "いまの職業" : job.description || "この職業になる" }));
      }
    }
    const fieldUsable = engine.usables(state, "field");
    section("どうぐ", "items");
    if (Object.keys(state.items).some(id => content.database.items.find(i => i.id === id)?.slot)) {
      const row = el("div", "rpg-menu-row");
      row.appendChild(navButton("さいきょう装備", () => { dispatch({ type: "optimizeEquipment" }); renderUI(); }, { hint: heroName() }));
      for (const m of (state.party ?? []).filter(x => !x.reserve)) row.appendChild(navButton(`さいきょう（${content.database.companions.find(x => x.id === m.id)?.name ?? m.id}）`, () => { dispatch({ type: "optimizeEquipment", companion: m.id }); renderUI(); }));
      menu.appendChild(row);
    }
    const owned = Object.entries(state.items).sort(([idA, countA], [idB, countB]) => content.project.inventory?.sort === "count"
      ? countB - countA || (content.database.items.find(i => i.id === idA)?.name ?? idA).localeCompare(content.database.items.find(i => i.id === idB)?.name ?? idB, "ja")
      : (content.database.items.find(i => i.id === idA)?.name ?? idA).localeCompare(content.database.items.find(i => i.id === idB)?.name ?? idB, "ja"));
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
          const heroPreview = engine.run(state, [heroOn ? { type: "unequip", slot } : { type: "equip", item: id }]).state;
          const heroBefore = engine.stats(state), heroAfter = engine.stats(heroPreview);
          const heroDiff = (["maxHp", "maxMp", "maxSp", "attack", "defense"] as const).map(key => {
            const delta = (heroAfter[key] ?? 0) - (heroBefore[key] ?? 0);
            return delta ? `${{ maxHp: "HP", maxMp: "MP", maxSp: "SP", attack: "攻", defense: "守" }[key]}${delta > 0 ? "+" : ""}${delta}` : "";
          }).filter(Boolean).join("　");
          menu.appendChild(navButton(heroName(), () => { equipFor = null; dispatch({ type: "equip", item: id }); renderUI(); }, { hint: `${heroOn ? "外す" : "装備する"}${heroDiff ? `　${heroDiff}` : ""}` }));
          for (const m of state.party ?? []) {
            const c = content.database.companions.find(x => x.id === m.id);
            const on = m.equipment?.[slot] === id;
            const preview = engine.run(state, [on ? { type: "unequip", slot, companion: m.id } : { type: "equip", item: id, companion: m.id }]).state;
            const before = engine.companionStats(state, m.id), after = engine.companionStats(preview, m.id);
            const diff = (["maxHp", "maxMp", "maxSp", "attack", "defense"] as const).map(key => {
              const delta = (after[key] ?? 0) - (before[key] ?? 0);
              return delta ? `${{ maxHp: "HP", maxMp: "MP", maxSp: "SP", attack: "攻", defense: "守" }[key]}${delta > 0 ? "+" : ""}${delta}` : "";
            }).filter(Boolean).join("　");
            menu.appendChild(navButton(c?.name ?? m.id, () => { equipFor = null; dispatch({ type: "equip", item: id, companion: m.id }); renderUI(); }, { hint: `${on ? "外す" : "装備する"}${diff ? `　${diff}` : ""}` }));
          }
          menu.appendChild(navButton("やめる", () => { equipFor = null; renderUI(); }));
          continue;
        }
        const heroPreview = engine.run(state, [heroOn ? { type: "unequip", slot } : { type: "equip", item: id }]).state;
        const currentStats = engine.stats(state), nextStats = engine.stats(heroPreview);
        const statDiff = (["maxHp", "maxMp", "maxSp", "attack", "defense"] as const)
          .map(key => { const delta = (nextStats[key] ?? 0) - (currentStats[key] ?? 0); return delta ? `${{ maxHp: "HP", maxMp: "MP", maxSp: "SP", attack: "攻", defense: "守" }[key]}${delta > 0 ? "+" : ""}${delta}` : ""; })
          .filter(Boolean).join("　");
        menu.appendChild(navButton(`${who ? "Ｅ " : ""}${item.name}`, () => { if (state.party?.length) { equipFor = id; selection = 0; renderUI(); } else { dispatch({ type: "equip", item: id }); renderUI(); } }, { hint: `${state.party?.length ? "主人公 " : ""}${slotLabel}${statDiff ? `　${statDiff}` : ""}${who ? `　${who}` : ""}　${!state.party?.length && heroOn ? "外す" : "装備"}` }));
        continue;
      }
        menu.appendChild(navButton(`${item?.name ?? id}`, () => { if (usable && !usable.blocked) { menuOpen = false; dispatch({ type: "useItem", item: id }); } else showToast(usable?.blocked ?? (item?.description || "使えない。")); }, { hint: [`×${count}${usable && !usable.blocked ? "　使う" : ""}`, usable ? useCostHints(usable.use) : "", item?.description].filter(Boolean).join("　") }));
    }
    const capacity = content.project.player.passiveCapacity;
    if (capacity !== undefined) {
      const knownPassives = state.abilities.map(id => content.database.abilities.find(a => a.id === id)).filter(a => a?.kind === "passive");
      const equipped = new Set(state.equippedPassives ?? []);
      const used = [...equipped].reduce((sum, id) => sum + (content.database.abilities.find(a => a.id === id)?.passiveCost ?? 1), 0);
      section("パッシブ", "passives");
      menu.appendChild(el("div", "rpg-menu-empty", `使用枠 ${used}/${capacity}（特性から得たパッシブは常に有効）`));
      if (!knownPassives.length) menu.appendChild(el("div", "rpg-menu-empty", "付け替えられるパッシブはありません"));
      for (const ability of knownPassives) if (ability) {
        const active = equipped.has(ability.id);
        menu.appendChild(navButton(`${active ? "● " : "○ "}${ability.name}`, () => { dispatch({ type: "togglePassive", ability: ability.id }); }, { hint: `${ability.passiveCost ?? 1}枠　${active ? "外す" : "装備する"}　${ability.description}` }));
      }
    }
    section("のうりょく", "abilities");
    const abilities = engine.abilities(state).filter(id => capacity === undefined || content.database.abilities.find(a => a.id === id)?.kind !== "passive");
    if (!abilities.length) menu.appendChild(el("div", "rpg-menu-empty", "なし"));
    for (const id of abilities) {
      const ability = content.database.abilities.find(a => a.id === id);
      const usable = fieldUsable.find(u => u.kind === "ability" && u.id === id);
      if (usable) {
        menu.appendChild(navButton(usable.name, () => { if (!usable.blocked) { menuOpen = false; dispatch({ type: "useAbility", ability: id }); } else showToast(usable.blocked); }, { hint: [usable.blocked ?? "使う", useCostHints(usable.use), ability?.description].filter(Boolean).join("　") }));
        continue;
      }
      const row = el("div", "rpg-menu-ability");
      row.append(el("strong", undefined, ability?.name ?? id), el("span", undefined, ability?.description ?? ""));
      menu.appendChild(row);
    }
    const scriptCommands = engine.commands(state, "field");
    if (scriptCommands.length) {
      section("とくしゅ", "commands");
      for (const cmd of scriptCommands) menu.appendChild(navButton(cmd.label, () => { if (cmd.blocked) showToast(cmd.blocked); else { menuOpen = false; dispatch({ type: "command", source: cmd.source, id: cmd.id }); } }, { hint: cmd.blocked ?? "" }));
    }
    const verbList = availableVerbs();
    if (verbList.length) {
      section("こうどう", "verbs");
      for (const [id, verb] of verbList) menu.appendChild(navButton(verb.label, () => useVerb(id), { hint: `${verb.description ?? ""}${verb.key ? `［${verb.key.toUpperCase()}］` : ""}` }));
    }
    section("きろく", "records");
    const row = el("div", "rpg-menu-row");
    row.append(
      navButton("セーブ", () => { slotReturn = "main"; menuView = "save"; selection = 0; renderUI(); }),
      navButton("ロード", () => { slotReturn = "main"; menuView = "load"; selection = 0; renderUI(); }),
      ...(content.project.book ? [navButton("図鑑", () => { menuView = "book"; selection = 0; renderUI(); })] : []),
      ...(Object.keys(content.project.achievements).length ? [navButton("実績", () => { menuView = "achievements"; selection = 0; renderUI(); })] : []),
      ...(Object.keys(content.project.quests).length ? [navButton("依頼帳", () => { menuView = "quests"; selection = 0; renderUI(); })] : []),
      navButton(`文字: ${uiPrefs.textSpeed === "instant" ? "瞬間" : uiPrefs.textSpeed === "fast" ? "はやい" : "ふつう"}`, () => {
        const order: Array<"normal" | "fast" | "instant"> = ["normal", "fast", "instant"];
        uiPrefs.textSpeed = order[(order.indexOf(uiPrefs.textSpeed) + 1) % order.length]!;
        savePrefs(audio.settings);
      }),
      navButton(`会話オート: ${uiPrefs.autoAdvance ? "あり" : "なし"}`, () => { uiPrefs.autoAdvance = !uiPrefs.autoAdvance; savePrefs(audio.settings); }, { hint: "会話中にS長押しで読み飛ばし" }),
      navButton(`文字サイズ: ${uiPrefs.largeText ? "大" : "標準"}`, () => { uiPrefs.largeText = !uiPrefs.largeText; savePrefs(audio.settings); }),
      navButton(`動きの軽減: ${uiPrefs.reducedMotion ? "あり" : "なし"}`, () => { uiPrefs.reducedMotion = !uiPrefs.reducedMotion; savePrefs(audio.settings); }),
      navButton(`色覚補助: ${uiPrefs.colorAssist ? "あり" : "なし"}`, () => { uiPrefs.colorAssist = !uiPrefs.colorAssist; savePrefs(audio.settings); }, { hint: "HPゲージに模様を追加" }),
      navButton(`操作説明: ${uiPrefs.showControls ? "表示" : "非表示"}`, () => { uiPrefs.showControls = !uiPrefs.showControls; savePrefs(audio.settings); }),
      navButton(`クリック移動: ${uiPrefs.clickMove ? "あり" : "なし"}`, () => { uiPrefs.clickMove = !uiPrefs.clickMove; savePrefs(audio.settings); }, { hint: "マップをクリックして歩く" }),
      navButton(`画面揺れ: ${uiPrefs.shake ? "あり" : "なし"}`, () => { uiPrefs.shake = !uiPrefs.shake; savePrefs(audio.settings); }),
      navButton(`戦闘: ${uiPrefs.battleSpeed === "fast" ? "はやい" : "ふつう"}`, () => { uiPrefs.battleSpeed = uiPrefs.battleSpeed === "fast" ? "normal" : "fast"; savePrefs(audio.settings); }),
      ...(content.project.audio.textSound ? [navButton(`文字の音: ${uiPrefs.textSound ? "あり" : "なし"}`, () => { uiPrefs.textSound = !uiPrefs.textSound; savePrefs(audio.settings); })] : []),
      ...(content.project.minimap?.enabled ? [navButton(`ミニマップ: ${uiPrefs.minimap ? "表示" : "隠す"}［N］`, () => { uiPrefs.minimap = !uiPrefs.minimap; savePrefs(audio.settings); })] : []),
      navButton("会話履歴", () => { backlogOpen = true; selection = 0; renderUI(); }),
      ...(content.project.feedback ? [navButton(content.project.feedback.label, openFeedbackPage, { hint: "フィードバックページを新しいタブで開く" })] : []),
      navButton("クレジット", () => { creditsOpen = true; selection = 0; renderUI(); }),
      navButton("とじる", () => { menuOpen = false; renderUI(); }),
    );
    menu.appendChild(row);
    const audioControls = el("div", "rpg-audio-controls");
    const volumeControl = (label: string, kind: "bgm" | "sfx") => {
      const control = el("label", "rpg-audio-control");
      const enabled = audio.settings[kind];
      const volumeKey = `${kind}Volume` as const;
      const slider = el("input");
      slider.type = "range"; slider.min = "0"; slider.max = "100"; slider.step = "1";
      slider.value = String(enabled ? Math.round((audio.settings[volumeKey] ?? 1) * 100) : 0);
      slider.setAttribute("aria-label", `${label}の音量`);
      const caption = el("span", undefined, `${label} ${slider.value}%`);
      slider.addEventListener("input", () => {
        const percent = Number(slider.value);
        const next = { ...audio.settings, [kind]: percent > 0, [volumeKey]: percent > 0 ? percent / 100 : 1 };
        audio.applySettings(next);
        caption.textContent = `${label} ${percent}%`;
        try { storage.write(settingsKey, JSON.stringify({ ...next, ...uiPrefs })); } catch { /* settings are optional */ }
      });
      control.append(caption, slider); return control;
    };
    audioControls.append(volumeControl("BGM", "bgm"), volumeControl("効果音", "sfx"));
    menu.appendChild(audioControls);
    arrangeMenu(menu);
    windowLayer.appendChild(menu);
  }

  function showToast(text: string, ms = 2400) {
    toast = { text, until: performance.now() + ms };
    renderUI();
    window.setTimeout(() => { if (!destroyed && toast && toast.until <= performance.now()) { toast = null; renderUI(); } }, ms + 30);
  }

  async function save(slot: Slot = "1") {
    try {
      await writeStoredSlot(slot, JSON.stringify(makeSave(content, state)));
      menuView = "main";
      showToast(`${slotLabel(slot)}にセーブしました。`);
    } catch (error) { showToast(`セーブできません: ${error instanceof Error ? error.message : String(error)}`); }
  }
  /** Written when entering a map, once nothing is pending (no toast: it should go unnoticed). */
  let autoSaveSoon = false;
  async function autoSave() {
    if (!content.project.autosave) { autoSaveSoon = false; return; }
    if (state.scene.kind !== "field" || state.queue.length) return; // try again once the scene settles
    autoSaveSoon = false;
    try { await writeStoredSlot("auto", JSON.stringify(makeSave(content, state))); } catch { /* autosave is best effort */ }
  }
  function exportSave() {
    try {
      const text = JSON.stringify(makeSave(content, state), null, 2);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = `${content.project.id}-save-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      showToast("セーブをファイルに書き出しました。");
    } catch (error) { showToast(`書き出せません: ${error instanceof Error ? error.message : String(error)}`); }
  }
  function importSave() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 2_000_000) { showToast("ファイルが大きすぎます。"); return; }
      loadRaw(await file.text(), "ファイル");
    });
    input.click();
  }
  async function load(slot: Slot = "1") {
    const raw = await readStoredSlot(slot);
    if (!raw) { showToast("セーブデータがありません。"); return; }
    slotCache.set(slot, raw);
    loadRaw(raw, slotLabel(slot));
  }
  function loadRaw(raw: string, from: string) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { showToast("セーブデータが壊れています。新しく始めることができます。"); return; }
    const result = readSave(parsed, content);
    if (!result.ok) { showToast(`${result.reason}。新しく始めることができます。`, 4000); return; }
    menuOpen = false; menuView = "main"; atTitle = false;
    setState(result.save.state);
    showToast(result.migrated ? "旧形式のセーブを変換して読み込みました。" : `${from}からロードしました。`);
  }

  function setState(next: GameState) {
    state = next;
    clickRoute = []; clickInteract = false;
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
    const frameStartedAt = fpsMeter ? performance.now() : 0;
    raf = requestAnimationFrame(frame);
    pollGamepads();
    const rt = realtimeDef();
    if (rt) { realtimeFrame(now, rt); updateFpsMeter(now, frameStartedAt); return; }
    const speed = dashing ? 1.8 : 1;
    const moving = animator.update(now, speed);
    renderPos = moving.position;
    if (!moving.moving && state.scene.kind === "field" && !menuOpen && held.length) {
      const dir = held[held.length - 1]!;
      clickRoute = []; clickInteract = false;
      dispatch({ type: "move", direction: dir });
      const after = animator.update(now, speed);
      renderPos = after.position;
    }
    if (state.scene.kind !== "field" || menuOpen || (clickRouteMap && clickRouteMap !== state.mapId)) { clickRoute = []; clickInteract = false; }
    else if (!moving.moving && !held.length && clickRoute.length) {
      const dir = clickRoute.shift()!;
      const before = { mapId: state.mapId, x: state.player.x, y: state.player.y };
      dispatch({ type: "move", direction: dir });
      if (state.mapId !== before.mapId || (state.player.x === before.x && state.player.y === before.y)) { clickRoute = []; clickInteract = false; }
    } else if (!moving.moving && !held.length && clickInteract) {
      clickInteract = false;
      dispatch({ type: "interact" });
    }
    if (ticking && state.scene.kind === "field" && !menuOpen && now - lastTick > 330) { lastTick = now; dispatch({ type: "tick" }); }
    // Cutscene routes (moveRoute) advance one step at walking pace.
    if (state.routes?.length && state.scene.kind === "field" && !menuOpen && now - lastRouteStep > 230 && !moving.moving) { lastRouteStep = now; dispatch({ type: "routeStep" }); }
    if (moving.moving && now - lastFrameSwap > (WALK_ANIMATION_MS / speed) / 2) { walkFrame = (walkFrame + 1) % 4; lastFrameSwap = now; }
    if (!moving.moving && !held.length) walkFrame = 0;

    const map = content.maps[state.mapId];
    if (map) {
      // Camera (camera effect): look at a cell or the hero, zoom, eased over `ms`; shake on top.
      const target = { x: state.camera?.x ?? renderPos.x, y: state.camera?.y ?? renderPos.y, zoom: state.camera?.zoom ?? 1 };
      const following = !state.camera && Math.abs(camNow.x - target.x) < 0.05 && Math.abs(camNow.y - target.y) < 0.05 && Math.abs(camNow.zoom - 1) < 0.01;
      if (following || camNow.mapId !== map.id) camNow = { ...target, mapId: map.id };
      else {
        const k = 1 - Math.exp(-(now - (camNow.at ?? now)) / Math.max(30, (state.camera?.ms ?? lastCamMs) / 4));
        camNow = { x: camNow.x + (target.x - camNow.x) * k, y: camNow.y + (target.y - camNow.y) * k, zoom: camNow.zoom + (target.zoom - camNow.zoom) * k, mapId: map.id };
      }
      camNow.at = now;
      if (state.camera) lastCamMs = state.camera.ms;
      // project.display.tileSize: 32 = 20×14 cells on screen; 16 = twice as wide an area, 64 = closer.
      const zoom = camNow.zoom * ((content.project.display?.tileSize ?? 32) / 32), viewCols = VIEW_COLS / zoom, viewRows = VIEW_ROWS / zoom;
      const shaking = shakeUntil > now && uiPrefs.shake && !uiPrefs.reducedMotion ? shakePower * ((shakeUntil - now) / 400) : 0;
      const cam = {
        x: Math.max(0, Math.min(map.width - viewCols, camNow.x - (viewCols - 1) / 2)) + (shaking ? (Math.random() * 2 - 1) * shaking / TILE : 0),
        y: Math.max(0, Math.min(map.height - viewRows, camNow.y - (viewRows - 1) / 2)) + (shaking ? (Math.random() * 2 - 1) * shaking / TILE : 0),
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
      ctx.save();
      if (zoom !== 1) ctx.scale(zoom, zoom);
      const origin = drawMap(ctx, {
        content, map: rows === map.rows ? map : { ...map, rows }, images, state, time: now, cacheStaticData: true,
        view: { camera: cam, cols: viewCols, rows: viewRows },
        interactables: engine.visibleInteractables(state, map),
        stepEffects: stepEffects.filter(fx => now - fx.at < 2600),
        markers: entities.filter(e => e.state.marker !== "none").map(e => ({ x: e.x, y: e.y, marker: e.state.marker })),
        actors: [
          ...npcActors(content, map, npcs, { facingOverride: talkFacing }),
          ...entityActors,
          // Parked vehicles on this map (乗り物), drawn like characters.
          ...Object.entries(content.project.vehicles ?? {}).flatMap(([id, v]) => {
            const at = state.vehicles?.[id] ?? v.start;
            return id !== state.riding && at && at.mapId === map.id ? [{ id: `vehicle:${id}`, kind: "npc" as const, x: at.x, y: at.y, facing: "down" as const, sprite: v.sprite, frame: 0 }] : [];
          }),
          // 隊列歩行: companions follow on the hero's trail (project.party.follow, on unless false).
          ...(content.project.party?.follow === false || state.riding ? [] : (state.party ?? []).filter(m => !m.reserve && m.summoned === undefined && m.hp > 0).flatMap((m, i) => {
            const comp = content.database.companions.find(x => x.id === m.id);
            const spot = trail.filter(t => t.mapId === map.id)[i];
            if (!comp?.sprite || !spot) return [];
            const key = `follow:${m.id}`;
            let tween = entityTweens.get(key);
            if (!tween || tween.tx !== spot.x || tween.ty !== spot.y) {
              const cur = tween ? currentTween(tween, now) : { x: spot.x, y: spot.y };
              tween = { fx: cur.x, fy: cur.y, tx: spot.x, ty: spot.y, start: now };
              if (Math.abs(cur.x - spot.x) + Math.abs(cur.y - spot.y) > 1.5) { tween.fx = spot.x; tween.fy = spot.y; }
              entityTweens.set(key, tween);
            }
            const pos = currentTween(tween, now);
            const walking = pos.x !== spot.x || pos.y !== spot.y;
            return [{ id: key, kind: "npc" as const, x: pos.x, y: pos.y, facing: spot.facing, sprite: comp.sprite, frame: walking ? walkFrame : 0 }];
          })),
          { id: "player", kind: "player" as const, x: renderPos.x, y: renderPos.y, facing: state.player.facing, sprite: (state.riding ? content.project.vehicles?.[state.riding]?.sprite : undefined) ?? state.player.sprite ?? content.project.player.sprite, frame: walkFrame },
        ].map(a => { const e = emotes.get(a.id); return e && e.until > now ? { ...a, emote: e.icon } : a; }),
      });
      mapView = { mapId: map.id, zoom, originX: origin.originX, originY: origin.originY };
      ctx.restore();
      for (const system of engine.activeSystems(state)) {
        if (!system.drawOverlay) continue;
        try {
          ctx.save();
          system.drawOverlay(ctx, { content, state, map, originX: origin.originX * zoom, originY: origin.originY * zoom, tileSize: TILE * zoom, player: renderPos, width: VIEW_COLS * TILE, height: VIEW_ROWS * TILE, time: now });
          ctx.restore();
        } catch (error) { ctx.restore(); console.warn(`${system.id}.drawOverlay`, error); }
      }
    } else mapView = null;
    if (scriptedFade) {
      const progress = Math.min(1, Math.max(0, (now - scriptedFade.start) / Math.max(1, scriptedFade.end - scriptedFade.start)));
      fade.style.backgroundColor = scriptedFade.color;
      fade.style.opacity = String(scriptedFade.from + (scriptedFade.to - scriptedFade.from) * progress);
      if (progress >= 1 && scriptedFade.to === 0) scriptedFade = null;
    } else {
      const fading = fadeUntil - now;
      fade.style.backgroundColor = "#000";
      fade.style.opacity = fading > 0 ? String(Math.min(1, fading / 220)) : "0";
    }
    screen.classList.toggle("is-shaking", shakeUntil > now && uiPrefs.shake && !uiPrefs.reducedMotion);
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
    if ((state.scene.kind === "message" || state.scene.kind === "dialogue") && typing.done && typingReadyAt > 0) {
      const delay = skipHeld ? 80 : uiPrefs.autoAdvance ? 1300 : Number.POSITIVE_INFINITY;
      if (now - typingReadyAt >= delay) { typingReadyAt = 0; dispatch({ type: "advance" }); }
    }
    updateFpsMeter(now, frameStartedAt);
  }

  let fpsWindowStartedAt = 0;
  let fpsWindowFrames = 0;
  let fpsIntervalTotal = 0;
  let fpsIntervalCount = 0;
  let fpsWorkTotal = 0;
  let fpsPreviousFrameAt = 0;
  function updateFpsMeter(now: number, frameStartedAt: number) {
    if (!fpsMeter) return;
    if (fpsPreviousFrameAt && now - fpsPreviousFrameAt > 1000) {
      fpsWindowStartedAt = now;
      fpsWindowFrames = 0;
      fpsIntervalTotal = 0;
      fpsIntervalCount = 0;
      fpsWorkTotal = 0;
      fpsPreviousFrameAt = 0;
    }
    if (!fpsWindowStartedAt) fpsWindowStartedAt = now;
    if (fpsPreviousFrameAt) { fpsIntervalTotal += now - fpsPreviousFrameAt; fpsIntervalCount++; }
    fpsPreviousFrameAt = now;
    fpsWindowFrames++;
    fpsWorkTotal += performance.now() - frameStartedAt;
    const elapsed = now - fpsWindowStartedAt;
    if (elapsed < 500) return;
    const fps = fpsIntervalCount * 1000 / elapsed;
    const frameMs = fpsIntervalCount ? fpsIntervalTotal / fpsIntervalCount : 0;
    const workMs = fpsWindowFrames ? fpsWorkTotal / fpsWindowFrames : 0;
    fpsMeter.textContent = `FPS ${fps.toFixed(1)} · frame ${frameMs.toFixed(1)} ms · work ${workMs.toFixed(1)} ms`;
    fpsWindowStartedAt = now;
    fpsWindowFrames = 0;
    fpsIntervalTotal = 0;
    fpsIntervalCount = 0;
    fpsWorkTotal = 0;
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
  void hydrateSlots();
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

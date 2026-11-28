import type { ExperienceDefinition, ExperienceInput, ExperienceView } from "../../engine/src/experience";

export interface MountExperienceOptions {
  projectId: string;
  args?: Record<string, unknown>;
  saveEnabled?: boolean;
  autosave?: boolean;
  assetUrl?: (id: string) => string | undefined;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

export interface ExperienceHandle {
  getState(): unknown;
  save(): boolean;
  reset(): void;
  destroy(): void;
}

const KEY_MAP: Record<string, string> = {
  ArrowUp: "up", w: "up", W: "up",
  ArrowDown: "down", s: "down", S: "down",
  ArrowLeft: "left", a: "left", A: "left",
  ArrowRight: "right", d: "right", D: "right",
  Enter: "confirm", " ": "confirm", Escape: "cancel",
};

function editableTarget(view: Window, target: EventTarget | null): boolean {
  // The host may be an iframe's window, whose HTMLElement differs from this realm's.
  const Html = (view as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement;
  return target instanceof Html && Boolean(target.closest("input,textarea,select,[contenteditable='true']"));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Mount a complete game experience without creating any RPG engine state or presentation. */
export function mountExperience<State>(
  host: HTMLElement,
  definition: ExperienceDefinition<State>,
  options: MountExperienceOptions,
): ExperienceHandle {
  if (!definition.id || !Number.isSafeInteger(definition.version) || definition.version < 1) {
    throw new Error("ExperienceDefinition requires a stable id and a positive integer version");
  }
  if (definition.fps !== undefined && (!Number.isFinite(definition.fps) || definition.fps <= 0 || definition.fps > 120)) {
    throw new Error("ExperienceDefinition.fps must be between 0 and 120");
  }

  const view = host.ownerDocument.defaultView;
  if (!view) throw new Error("This experience requires a browser window");
  const storageKey = `rpg-studio:experience:${options.projectId}`;
  // Access to localStorage can throw in private/restricted browser contexts. The game still
  // runs; save() simply reports that persistence was unavailable.
  let storage = options.storage;
  if (!storage) {
    try { storage = view.localStorage; } catch { storage = undefined; }
  }
  const args = options.args ?? {};
  const saveEnabled = options.saveEnabled !== false;
  const autosave = options.autosave !== false;
  const held = new Set<string>();
  let destroyed = false;
  let state: State;
  let interval: number | undefined;

  const initial = (): State => definition.start(args);
  const restore = (): State => {
    if (!saveEnabled) return initial();
    try {
      const raw = storage?.getItem(storageKey);
      if (!raw) return initial();
      const record = JSON.parse(raw) as { projectId?: unknown; version?: unknown; state?: unknown };
      if (record.projectId !== options.projectId || record.version !== definition.version || !Object.hasOwn(record, "state")) return initial();
      return record.state as State;
    } catch {
      return initial();
    }
  };

  const showError = (message: string) => {
    host.replaceChildren();
    const box = host.ownerDocument.createElement("pre");
    box.setAttribute("role", "alert");
    box.textContent = `ゲームを続けられません\n${message}`;
    host.append(box);
  };

  const focusIdentity = (element: HTMLElement): string | undefined => {
    const explicit = element.id || element.getAttribute("data-experience-focus") || element.getAttribute("aria-label");
    if (explicit) return explicit;
    return element.tagName === "BUTTON" ? element.textContent?.trim() : undefined;
  };

  const focusedPath = (): { indexes: number[]; tag: string; identity?: string } | undefined => {
    const active = view.document.activeElement;
    if (!(active instanceof view.HTMLElement) || !host.contains(active)) return undefined;
    const indexes: number[] = [];
    let node: HTMLElement = active;
    while (node !== host) {
      const parent = node.parentElement;
      if (!parent) return undefined;
      indexes.unshift(Array.prototype.indexOf.call(parent.children, node) as number);
      node = parent;
    }
    const identity = focusIdentity(active);
    return { indexes, tag: active.tagName, ...(identity === undefined ? {} : { identity }) };
  };

  const restoreFocus = (path: { indexes: number[]; tag: string; identity?: string } | undefined) => {
    if (!path) return;
    let node: Element = host;
    for (const index of path.indexes) {
      const child = node.children.item(index);
      if (!child) { host.focus({ preventScroll: true }); return; }
      node = child;
    }
    const matches = node instanceof view.HTMLElement
      && node.tagName === path.tag
      && !node.matches(":disabled")
      && (path.identity === undefined || focusIdentity(node) === path.identity);
    const target = matches ? node as HTMLElement : host;
    target.focus({ preventScroll: true });
  };

  const saveState = (): boolean => {
    if (!saveEnabled) return false;
    try {
      const json = JSON.stringify({ projectId: options.projectId, version: definition.version, state });
      if (json === undefined) return false;
      if (!storage) return false;
      storage.setItem(storageKey, json);
      return true;
    } catch {
      return false;
    }
  };

  const render = () => {
    if (destroyed) return;
    const previousFocus = focusedPath();
    try {
      host.replaceChildren();
      const api: ExperienceView<State> = {
        state,
        send: dispatch,
        reset,
        save: saveState,
        assetUrl: id => options.assetUrl?.(id),
      };
      definition.render(host, api);
      restoreFocus(previousFocus);
    } catch (error) {
      showError(errorText(error));
    }
  };

  function dispatch(input: ExperienceInput): void {
    if (destroyed) return;
    try {
      const next = definition.update(state, input);
      // Reject values that cannot survive the JSON save/reload boundary when saving is enabled.
      if (saveEnabled) {
        const serialized = JSON.stringify(next);
        if (serialized === undefined) throw new Error("ゲーム状態はJSONにできる値で作ってください");
        JSON.parse(serialized);
      }
      state = next;
      if (autosave) saveState();
      render();
    } catch (error) {
      showError(errorText(error));
    }
  }

  function reset(): void {
    try {
      state = initial();
      if (autosave) saveState();
      render();
    } catch (error) {
      showError(errorText(error));
    }
  }

  state = restore();
  host.setAttribute("role", "application");
  if (definition.title) host.setAttribute("aria-label", definition.title);
  host.tabIndex = 0;

  const onKeyDown = (event: KeyboardEvent) => {
    if (editableTarget(view, event.target)) return;
    if (view.document.activeElement !== host && !host.contains(view.document.activeElement)) return;
    // Native buttons already turn Enter/Space into click events. Dispatching a second
    // synthetic "confirm" here would activate many creator UIs twice.
    const target = event.target instanceof view.HTMLElement ? event.target : null;
    if ((event.key === "Enter" || event.key === " ") && target?.closest("button,a,[role='button']")) return;
    const key = KEY_MAP[event.key] ?? event.key.toLowerCase();
    held.add(key);
    if (event.key in KEY_MAP) event.preventDefault();
    if (!event.repeat && !definition.fps) dispatch({ type: "key", key });
  };
  const onKeyUp = (event: KeyboardEvent) => {
    const key = KEY_MAP[event.key] ?? event.key.toLowerCase();
    held.delete(key);
  };
  const clearHeld = () => held.clear();
  view.addEventListener("keydown", onKeyDown);
  view.addEventListener("keyup", onKeyUp);
  view.addEventListener("blur", clearHeld);

  if (definition.fps) interval = view.setInterval(() => dispatch({ type: "frame", held: [...held].sort() }), 1000 / definition.fps);
  render();
  host.focus({ preventScroll: true });

  return {
    getState: () => state,
    save: saveState,
    reset,
    destroy: () => {
      destroyed = true;
      if (interval !== undefined) view.clearInterval(interval);
      view.removeEventListener("keydown", onKeyDown);
      view.removeEventListener("keyup", onKeyUp);
      view.removeEventListener("blur", clearHeld);
      held.clear();
    },
  };
}

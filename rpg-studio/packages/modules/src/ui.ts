/** Tiny DOM helpers shared by the built-in genre modules (browser only). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, style = "", text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (style) node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function button(label: string, onClick: () => void, selected = false, disabled = false): HTMLButtonElement {
  const b = h("button", "", undefined, `rpg-option${selected ? " is-selected" : ""}`);
  b.type = "button";
  b.append(h("span", "", label, "rpg-option-label"));
  b.disabled = disabled;
  b.onclick = event => { event.stopPropagation(); onClick(); };
  return b;
}

export function panel(style: string): HTMLDivElement {
  return h("div", `position:absolute;${style}`, undefined, "rpg-window");
}

export function bar(value: number, max: number, color: string): HTMLDivElement {
  const outer = h("div", "height:.5em;background:rgba(0,0,0,.5);border:1px solid rgba(233,220,184,.5);border-radius:2px;overflow:hidden");
  outer.appendChild(h("div", `height:100%;width:${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))}%;background:${color}`));
  return outer;
}

/** Deterministic PRNG for module simulations (mulberry32). */
export function nextRand(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let r = Math.imul(next ^ (next >>> 15), next | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, next];
}

export const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

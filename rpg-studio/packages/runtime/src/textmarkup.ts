/**
 * Text decoration in messages and dialogue lines (roadmap 044).
 *
 *   {漢字|かんじ}          ruby (reading above the text)
 *   [c=red]…[/c]          colour: red / blue / green / yellow / gray / gold / #rrggbb
 *   [b]…[/b]              bold
 *   [big]…[/big] [small]…[/small]
 *   [shake]…[/shake]      trembling letters    [wave]…[/wave]  waving letters
 *   [w=500]               pause while typing (milliseconds)
 *   [se=sfx-id]           play a sound when typing reaches this point
 *
 * Unknown [tags] stay as they are, so ordinary brackets in text are safe.
 */
export interface TextStyle { color?: string; classes: string[] }
export type TextToken =
  | { kind: "text"; text: string; style: TextStyle }
  | { kind: "ruby"; base: string; rt: string; style: TextStyle }
  | { kind: "wait"; ms: number }
  | { kind: "se"; sound: string };

const COLORS: Record<string, string> = { red: "#ff7a6b", blue: "#7fb4ff", green: "#8fdc7a", yellow: "#ffe27a", gray: "#a9b09d", grey: "#a9b09d", gold: "#f0c36a", white: "#ffffff", purple: "#c79bff", pink: "#ff9fd0" };
const STYLE_TAGS = ["b", "big", "small", "shake", "wave"] as const;
const TAG = /\{([^|{}]+)\|([^|{}]+)\}|\[(c|color)=(#[0-9a-fA-F]{3,6}|[a-z]+)\]|\[\/(c|color|b|big|small|shake|wave)\]|\[(b|big|small|shake|wave)\]|\[w=(\d{1,5})\]|\[se=([A-Za-z0-9][A-Za-z0-9._-]*)\]/g;

export function parseMarkup(raw: string): TextToken[] {
  const tokens: TextToken[] = [];
  const colors: string[] = [];
  const classes: string[] = [];
  const style = (): TextStyle => ({ ...(colors.length ? { color: colors[colors.length - 1] } : {}), classes: [...classes] });
  let last = 0;
  const pushText = (text: string) => { if (text) tokens.push({ kind: "text", text, style: style() }); };
  for (const m of raw.matchAll(TAG)) {
    pushText(raw.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[1] !== undefined) tokens.push({ kind: "ruby", base: m[1], rt: m[2]!, style: style() });
    else if (m[3] !== undefined) {
      const color = m[4]!.startsWith("#") ? m[4]! : COLORS[m[4]!];
      if (color) colors.push(color); else pushText(m[0]);
    } else if (m[5] !== undefined) {
      if (m[5] === "c" || m[5] === "color") colors.pop();
      else { const i = classes.lastIndexOf(`rpg-t-${m[5]}`); if (i >= 0) classes.splice(i, 1); }
    } else if (m[6] !== undefined && (STYLE_TAGS as readonly string[]).includes(m[6])) classes.push(`rpg-t-${m[6]}`);
    else if (m[7] !== undefined) tokens.push({ kind: "wait", ms: Math.min(10000, Number(m[7])) });
    else if (m[8] !== undefined) tokens.push({ kind: "se", sound: m[8] });
  }
  pushText(raw.slice(last));
  return tokens;
}

/** The text as plain words (logs, screen readers, backlog). */
export function stripMarkup(raw: string): string {
  return parseMarkup(raw).map(t => (t.kind === "text" ? t.text : t.kind === "ruby" ? t.base : "")).join("");
}

const chars = (t: TextToken) => (t.kind === "text" ? Array.from(t.text).length : t.kind === "ruby" ? Array.from(t.base).length : 0);
export const plainLength = (tokens: TextToken[]) => tokens.reduce((n, t) => n + chars(t), 0);

/** How many letters are visible `elapsed` ms after typing started (pauses included), and which sounds were passed. */
export function typedAt(tokens: TextToken[], elapsed: number, msPerChar: number): { count: number; sounds: number[] } {
  let t = 0, count = 0;
  const sounds: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.kind === "wait") { t += msPerChar === 0 ? 0 : tok.ms; if (t > elapsed) break; continue; }
    if (tok.kind === "se") { sounds.push(i); continue; }
    const n = chars(tok);
    if (msPerChar === 0) { count += n; continue; }
    const fit = Math.max(0, Math.min(n, Math.floor((elapsed - t) / msPerChar)));
    count += fit;
    t += n * msPerChar;
    if (fit < n) break;
  }
  return { count, sounds };
}

/** Draws the first `count` letters into `target`. */
export function renderMarkup(target: HTMLElement, tokens: TextToken[], count: number) {
  target.textContent = "";
  let rem = count;
  let letter = 0;
  const styled = (style: TextStyle, node: Node): Node => {
    if (!style.color && !style.classes.length) return node;
    const span = document.createElement("span");
    if (style.color) span.style.color = style.color;
    if (style.classes.length) span.className = style.classes.join(" ");
    span.appendChild(node);
    return span;
  };
  for (const tok of tokens) {
    if (rem <= 0) break;
    if (tok.kind !== "text" && tok.kind !== "ruby") continue;
    const all = Array.from(tok.kind === "text" ? tok.text : tok.base);
    const take = all.slice(0, rem);
    rem -= all.length;
    if (!take.length) continue;
    // Moving letters need one element each (with a delay so they ripple).
    const moving = tok.style.classes.some(c => c === "rpg-t-shake" || c === "rpg-t-wave");
    let inner: Node;
    if (moving && tok.kind === "text") {
      const frag = document.createDocumentFragment();
      for (const ch of take) { const s = document.createElement("span"); s.className = "rpg-t-letter"; s.style.animationDelay = `${(letter++ % 12) * -70}ms`; s.textContent = ch; frag.appendChild(s); }
      inner = frag;
    } else if (tok.kind === "ruby") {
      const ruby = document.createElement("ruby");
      ruby.appendChild(document.createTextNode(take.join("")));
      const rt = document.createElement("rt");
      rt.textContent = tok.rt;
      ruby.appendChild(rt);
      inner = ruby;
    } else inner = document.createTextNode(take.join(""));
    target.appendChild(styled(tok.style, inner));
  }
}

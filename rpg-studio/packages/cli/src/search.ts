/**
 * Project-wide search & replace in the text of the data (roadmap 175). Pure (no Node APIs), shared by
 * `rpg find` and the studio's 検索・置換 panel. Only JSON string values are searched and changed —
 * keys and the file structure never are, so a replace cannot break the format (IDs: use `rpg rename`).
 */
export interface SearchHit { file: string; at: string; value: string; count: number }

export function makeMatcher(query: string, opts: { regex?: boolean; caseSensitive?: boolean } = {}): RegExp | null {
  if (!query) return null;
  try {
    return new RegExp(opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), opts.caseSensitive ? "g" : "gi");
  } catch { return null; }
}

function walk(node: unknown, at: string, re: RegExp, file: string, out: SearchHit[]) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => {
      const id = child && typeof child === "object" && typeof (child as { id?: unknown }).id === "string" ? (child as { id: string }).id : String(i);
      walk(child, `${at}[${id}]`, re, file, out);
    });
    return;
  }
  if (node && typeof node === "object") { for (const [k, v] of Object.entries(node)) walk(v, at ? `${at}.${k}` : k, re, file, out); return; }
  if (typeof node === "string") {
    const count = node.match(re)?.length ?? 0;
    if (count) out.push({ file, at, value: node, count });
  }
}

export function searchTexts(texts: Record<string, string>, query: string, opts: { regex?: boolean; caseSensitive?: boolean } = {}): SearchHit[] {
  const re = makeMatcher(query, opts);
  if (!re) return [];
  const out: SearchHit[] = [];
  for (const [file, text] of Object.entries(texts)) {
    if (!file.endsWith(".json")) continue;
    try { walk(JSON.parse(text), "", re, file, out); } catch { /* broken JSON: validate reports it */ }
  }
  return out;
}

function replaceIn(node: unknown, re: RegExp, to: string, count: { n: number }): unknown {
  if (Array.isArray(node)) return node.map(child => replaceIn(child, re, to, count));
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, replaceIn(v, re, to, count)]));
  if (typeof node === "string") {
    const n = node.match(re)?.length ?? 0;
    if (!n) return node;
    count.n += n;
    return node.replace(re, to);
  }
  return node;
}

/** New text of every file that changes, with how many places changed. */
export function replaceTexts(texts: Record<string, string>, query: string, to: string, opts: { regex?: boolean; caseSensitive?: boolean; files?: string[] } = {}): Array<{ file: string; text: string; count: number }> {
  const re = makeMatcher(query, opts);
  if (!re) return [];
  const out: Array<{ file: string; text: string; count: number }> = [];
  for (const [file, text] of Object.entries(texts)) {
    if (!file.endsWith(".json") || (opts.files && !opts.files.includes(file))) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { continue; }
    const count = { n: 0 };
    const next = replaceIn(parsed, re, to, count);
    if (count.n) out.push({ file, text: `${JSON.stringify(next, null, 2)}\n`, count: count.n });
  }
  return out;
}

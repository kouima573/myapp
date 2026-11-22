/**
 * Plain-language summary of a change to one project file (roadmap 007): "enemies に X を追加", "maxHp: 7 → 12".
 * Pure (no Node APIs) so the studio can use it too.
 */
const MAX_LINES = 8;

const short = (value: unknown): string => {
  const text = typeof value === "string" ? `"${value}"` : JSON.stringify(value);
  return text === undefined ? "（なし）" : text.length > 40 ? `${text.slice(0, 37)}…` : text;
};
const label = (node: unknown): string | undefined => {
  if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
  const o = node as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : typeof o.key === "string" ? o.key : undefined;
  const name = typeof o.name === "string" ? o.name : typeof o.title === "string" ? o.title : undefined;
  return id ? (name && name !== id ? `${id}（${name}）` : id) : name;
};

function compare(before: unknown, after: unknown, at: string, out: string[]) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const keyed = [...before, ...after].every(x => label(x) !== undefined);
    if (keyed) {
      const b = new Map(before.map(x => [label(x)!, x]));
      const a = new Map(after.map(x => [label(x)!, x]));
      for (const [k, x] of a) if (!b.has(k)) out.push(`${at || "（全体）"} に ${k} を追加`);
      for (const k of b.keys()) if (!a.has(k)) out.push(`${at || "（全体）"} から ${k} を削除`);
      for (const [k, x] of a) if (b.has(k)) compare(b.get(k), x, `${at}[${k}]`, out);
      return;
    }
    // Grids (map layers) and plain lists: count changed cells instead of listing each one.
    if (before.length === after.length && before.every(x => typeof x !== "object" || Array.isArray(x))) {
      let cells = 0;
      const count = (x: unknown, y: unknown) => {
        if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) x.forEach((v, i) => count(v, y[i]));
        else if (JSON.stringify(x) !== JSON.stringify(y)) cells++;
      };
      count(before, after);
      out.push(`${at}: ${cells}か所を変更`);
      return;
    }
    out.push(`${at}: ${before.length}件 → ${after.length}件`);
    return;
  }
  if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    const b = before as Record<string, unknown>, a = after as Record<string, unknown>;
    for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
      const here = at ? `${at}.${key}` : key;
      if (!(key in b)) out.push(`${here} を追加: ${short(a[key])}`);
      else if (!(key in a)) out.push(`${here} を削除`);
      else compare(b[key], a[key], here, out);
    }
    return;
  }
  out.push(`${at || "（全体）"}: ${short(before)} → ${short(after)}`);
}

/** Lines describing what changed between two versions of one project file. */
export function summarizeChange(file: string, before: string | undefined, after: string | undefined): string[] {
  if (before === undefined) return ["新しいファイル"];
  if (after === undefined) return ["ファイルを削除"];
  if (file.endsWith(".json")) {
    try {
      const out: string[] = [];
      compare(JSON.parse(before), JSON.parse(after), "", out);
      if (!out.length) return ["書式だけの変更"];
      return out.length > MAX_LINES ? [...out.slice(0, MAX_LINES), `ほか ${out.length - MAX_LINES}件`] : out;
    } catch { /* not valid JSON on one side: fall back to lines */ }
  }
  const b = before.split("\n"), a = after.split("\n");
  const bs = new Set(b), as = new Set(a);
  const added = a.filter(l => !bs.has(l)).length, removed = b.filter(l => !as.has(l)).length;
  return [added || removed ? `${added}行を追加・${removed}行を削除` : "書式だけの変更"];
}


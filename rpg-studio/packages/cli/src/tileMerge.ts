/**
 * Adding tile definitions (from a generated sheet) to a project's tiles.json: keeps existing codes (maps use them),
 * follows a sheet whose numbering changed, hands out unused one-character codes. Pure: used by the CLI and the studio.
 */
/** Characters usable as one-character tile codes, in the order they are handed out. */
export function codePool(): string[] {
  const ascii: string[] = [];
  for (let c = 33; c < 127; c++) { const ch = String.fromCharCode(c); if (ch !== "\"" && ch !== "\\") ascii.push(ch); }
  const letters = ascii.filter(c => /[A-Za-z0-9]/.test(c)), symbols = ascii.filter(c => !/[A-Za-z0-9]/.test(c));
  const kana: string[] = [];
  for (let c = 0x3041; c <= 0x3093; c++) kana.push(String.fromCharCode(c)); // ぁ..ん
  for (let c = 0x30a1; c <= 0x30f3; c++) kana.push(String.fromCharCode(c)); // ァ..ン
  const greek: string[] = [];
  for (let c = 0x03b1; c <= 0x03c9; c++) if (c !== 0x03c2) greek.push(String.fromCharCode(c));
  const kanji: string[] = [];
  for (let c = 0x4e00; c < 0x4e00 + 2000; c++) kanji.push(String.fromCharCode(c));
  return [...letters, ...symbols, ...greek, ...kana, ...kanji];
}

export interface MergeTile { key: string; name: string; index: number; passable: boolean; color: string; frames?: number[]; autotile?: { group: string; pieces: Record<string, number> } }

export function mergeTiles<T extends { atlas: string; tiles: Array<Record<string, unknown>> }>(tilesetJson: T, atlas: string, tiles: MergeTile[]): { tileset: T; added: string[]; moved: string[] } {
  type Def = { code: string; atlas?: string; index: number; name: string; key?: string; frames?: number[]; autotile?: unknown };
  const tileset = JSON.parse(JSON.stringify(tilesetJson)) as T;
  const defs = tileset.tiles as unknown as Def[];
  const used = new Set(defs.map(t => t.code));
  const inSheet = defs.filter(t => (t.atlas ?? tileset.atlas) === atlas);
  const pool = codePool().filter(c => !used.has(c));
  const added: string[] = [], moved: string[] = [];
  for (const tile of tiles) {
    // 1) Same picture by key: keep its code (maps use the code) and follow the sheet's current number.
    const byKey = inSheet.find(t => t.key === tile.key);
    if (byKey) {
      if (byKey.index !== tile.index) { moved.push(`${byKey.code}=${tile.name} ${byKey.index}→${tile.index}`); byKey.index = tile.index; }
      if (tile.frames) byKey.frames = tile.frames; else delete byKey.frames;
      if (tile.autotile) byKey.autotile = tile.autotile; else delete byKey.autotile;
      continue;
    }
    // 2) Added before keys existed: same number and name → remember the key from now on.
    const byIndex = inSheet.find(t => t.index === tile.index && !t.key);
    if (byIndex) { if (byIndex.name === tile.name) byIndex.key = tile.key; continue; }
    const code = pool.shift();
    if (!code) throw new Error("空いているタイルコードがありません");
    defs.push({ code, name: tile.name, atlas, index: tile.index, key: tile.key, passable: tile.passable, color: tile.color, ...(tile.frames ? { frames: tile.frames } : {}), ...(tile.autotile ? { autotile: tile.autotile } : {}) } as Def);
    added.push(`${code}=${tile.name}`);
  }
  return { tileset, added, moved };
}

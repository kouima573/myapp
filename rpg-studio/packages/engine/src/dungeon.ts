/**
 * 自動生成ダンジョン (roadmap 038): rooms joined by corridors, from a seed (same seed → same map).
 * Pure; used by `rpg map generate` and the studio's 新しいマップ.
 */
export interface DungeonOptions { width: number; height: number; seed: number; rooms?: number; floor: string; wall: string }
export interface Dungeon { rows: string[]; rooms: Array<{ x: number; y: number; w: number; h: number }>; start: { x: number; y: number }; goal: { x: number; y: number } }

function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function generateDungeon(o: DungeonOptions): Dungeon {
  const { width: W, height: H } = o;
  if (W < 10 || H < 8) throw new Error("ダンジョンは 10×8 以上にしてください");
  const r = rng(o.seed);
  const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => o.wall));
  const rooms: Dungeon["rooms"] = [];
  const want = o.rooms ?? Math.max(3, Math.round((W * H) / 90));
  for (let tries = 0; tries < want * 30 && rooms.length < want; tries++) {
    const w = 3 + Math.floor(r() * Math.min(7, W / 4)), h = 3 + Math.floor(r() * Math.min(5, H / 4));
    const x = 1 + Math.floor(r() * (W - w - 2)), y = 1 + Math.floor(r() * (H - h - 2));
    if (rooms.some(q => x - 1 < q.x + q.w && x + w + 1 > q.x && y - 1 < q.y + q.h && y + h + 1 > q.y)) continue;
    rooms.push({ x, y, w, h });
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) grid[yy]![xx] = o.floor;
  }
  // Join each room to the previous one (sorted left to right) with an L-shaped corridor.
  const centre = (q: Dungeon["rooms"][number]) => ({ x: q.x + Math.floor(q.w / 2), y: q.y + Math.floor(q.h / 2) });
  const sorted = [...rooms].sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const a = centre(sorted[i - 1]!), b = centre(sorted[i]!);
    const horizontalFirst = r() < 0.5;
    const dig = (x: number, y: number) => { grid[y]![x] = o.floor; };
    if (horizontalFirst) { for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) dig(x, a.y); for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) dig(b.x, y); }
    else { for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) dig(a.x, y); for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) dig(x, b.y); }
  }
  const start = centre(sorted[0]!), goal = centre(sorted[sorted.length - 1]!);
  return { rows: grid.map(row => row.join("")), rooms: sorted, start, goal };
}

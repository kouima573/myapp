import { describe, expect, it } from "vitest";
import { generateDungeon } from "./dungeon";

describe("generated dungeons (038)", () => {
  it("is the same for the same seed, has rooms joined so that the goal is reachable from the start", () => {
    const a = generateDungeon({ width: 30, height: 22, seed: 7, floor: ".", wall: "#" });
    expect(generateDungeon({ width: 30, height: 22, seed: 7, floor: ".", wall: "#" })).toEqual(a);
    expect(generateDungeon({ width: 30, height: 22, seed: 8, floor: ".", wall: "#" }).rows).not.toEqual(a.rows);
    expect(a.rooms.length).toBeGreaterThanOrEqual(3);
    expect(a.rows.every(r => r.length === 30)).toBe(true);
    expect(a.rows[0]).toBe("#".repeat(30));
    // flood fill from start reaches goal
    const seen = new Set<string>(), stack = [a.start];
    while (stack.length) {
      const p = stack.pop()!; const k = `${p.x},${p.y}`;
      if (seen.has(k) || a.rows[p.y]?.[p.x] !== ".") continue;
      seen.add(k); stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
    }
    expect(seen.has(`${a.goal.x},${a.goal.y}`)).toBe(true);
  });
});

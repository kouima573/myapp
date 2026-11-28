import { describe, expect, it } from "vitest";
import { customTileSheet, MONSTER_EXTRAS, monsterSpec, randomMonster, renderMonsterSheet, TILE_CATALOG } from "./artgen/makers";
import { mergeTiles } from "./tileMerge";
import { parseTileList } from "./characterCmd";

describe("素材作り（敵・タイル）", () => {
  it("敵: 見本・種類・色・飾りから作る。種類に合わない飾りは断る", () => {
    const moon = monsterSpec({ id: "moon", name: "月", family: "slime", pal: { body: "#8a7ae8" }, extra: "crown" });
    expect(moon).toMatchObject({ family: "slime", extra: "crown", pal: { body: "#8a7ae8" } });
    expect(() => monsterSpec({ id: "x", name: "x", family: "slime", extra: "wings" })).toThrow(/飾り/);
    expect(() => monsterSpec({ id: "x", name: "x", family: "no-such" })).toThrow();
    const sheet = renderMonsterSheet(moon);
    expect([sheet.w, sheet.h]).toEqual([256, 64]);
    expect(randomMonster(3)).toEqual(randomMonster(3));
    expect(MONSTER_EXTRAS.slime).toContain("crown");
  });

  it("タイル: 模様・色・明るさを変え、動くタイルはコマごと、つながる床は9つの部品ごと入る", () => {
    const water = TILE_CATALOG.find(t => t.animated && !t.companion)!;
    const rug = TILE_CATALOG.find(t => t.autotile)!;
    const plain = customTileSheet([{ from: "lib-tiles-field/grass" }], "standard", "a");
    const changed = customTileSheet([{ from: "lib-tiles-field/grass", hue: 120, light: -20, seed: 5 }], "standard", "a");
    expect(changed.img.data).not.toEqual(plain.img.data);
    const set = customTileSheet([{ from: water.ref, name: "夜の水" }, { from: rug.ref }], "retro", "night");
    const main = set.tiles.find(t => t.name === "夜の水")!;
    expect(main.frames!.length).toBeGreaterThan(1);
    const auto = set.tiles.find(t => t.autotile)!;
    expect(Object.keys(auto.autotile!.pieces)).toHaveLength(9);
    expect(Math.max(...Object.values(auto.autotile!.pieces))).toBeLessThan(set.tiles.length);
    expect([set.img.w, set.img.h]).toEqual([512, Math.ceil(set.tiles.length / 8) * 64]);
    expect(() => customTileSheet([{ from: "nope/nope" }])).toThrow();
    // tiles.json への追加: 新しい記号、2回目は増えない
    const tileset = { formatVersion: 2, atlas: "base", tiles: [{ code: "a", name: "x", index: 0, passable: true }] };
    const once = mergeTiles(tileset, "tiles-night", set.tiles);
    expect(once.added.length).toBe(set.tiles.length);
    expect(mergeTiles(once.tileset, "tiles-night", set.tiles).added).toEqual([]);
    expect(parseTileList("lib-tiles-field/water:hue=40:light=-10:seed=3:name=湖")).toEqual([{ from: "lib-tiles-field/water", hue: 40, light: -10, seed: 3, name: "湖" }]);
  });
});

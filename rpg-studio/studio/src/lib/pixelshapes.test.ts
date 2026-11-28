import { describe, expect, it } from "vitest";
import { ellipsePoints, linePoints, outlineFrame, rectPoints, replaceColor, shiftHue, usedColors } from "./pixelshapes";

describe("pixel editor shapes and colours (129/130)", () => {
  it("lines, rectangles and ellipses cover the expected cells", () => {
    expect(linePoints(0, 0, 3, 0)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
    expect(linePoints(0, 0, 2, 2)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]);
    expect(rectPoints(2, 2, 0, 0, false).length).toBe(8);
    expect(rectPoints(0, 0, 2, 2, true).length).toBe(9);
    const ring = ellipsePoints(0, 0, 6, 6, false), disk = ellipsePoints(0, 0, 6, 6, true);
    expect(disk.length).toBeGreaterThan(ring.length);
    expect(ring.some(p => p.x === 3 && p.y === 3)).toBe(false);
    expect(disk.some(p => p.x === 3 && p.y === 3)).toBe(true);
  });
  it("replaces a colour, lists used colours and rotates hue keeping greys", () => {
    const px = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 128, 128, 128, 255, 0, 0, 0, 0]);
    expect(usedColors(px)).toEqual(["#ff0000", "#808080"]);
    expect(replaceColor(px, "#ff0000", "#00ff00")).toBe(2);
    expect(usedColors(px)[0]).toBe("#00ff00");
    shiftHue(px, 120);
    expect(Array.from(px.slice(0, 3))).toEqual([0, 0, 255]);
    expect(Array.from(px.slice(8, 11))).toEqual([128, 128, 128]);
  });

  it("輪郭を付ける: 描いたブロックのまわりの空いたブロックだけを、ドットの大きさごとに塗る（コマの外は触らない）", () => {
    // 8×4 image, two 4×4 frames; a 2×2 block drawn at the centre of the first frame (pixel = 2 → grid 2×2... use pixel 1 here).
    const data = { width: 8, height: 4, data: new Uint8ClampedArray(8 * 4 * 4) };
    const set = (x: number, y: number) => { data.data[(y * 8 + x) * 4 + 3] = 255; };
    set(1, 1);
    const painted = outlineFrame(data, { x: 0, y: 0, w: 4, h: 4 }, 1, "#102030");
    expect(painted).toBe(4); // up, down, left, right
    expect([...data.data.slice((1 * 8 + 2) * 4, (1 * 8 + 2) * 4 + 4)]).toEqual([16, 32, 48, 255]);
    expect(data.data[(0 * 8 + 0) * 4 + 3]).toBe(0); // diagonal stays empty
    expect(data.data.slice(4 * 4, 8 * 4).every(v => v === 0) && data.data[(1 * 8 + 4) * 4 + 3]).toBe(0); // second frame untouched
    // pixel = 2: a whole 2×2 block is painted.
    const big = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
    for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]] as const) big.data[(y * 8 + x) * 4 + 3] = 255;
    expect(outlineFrame(big, { x: 0, y: 0, w: 8, h: 8 }, 2, "#000000")).toBe(4);
    expect(big.data[(2 * 8 + 4) * 4 + 3]).toBe(255);
    expect(big.data[(3 * 8 + 5) * 4 + 3]).toBe(255);
  });
});

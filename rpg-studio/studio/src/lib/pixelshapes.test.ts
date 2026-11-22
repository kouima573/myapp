import { describe, expect, it } from "vitest";
import { ellipsePoints, linePoints, rectPoints, replaceColor, shiftHue, usedColors } from "./pixelshapes";

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
});

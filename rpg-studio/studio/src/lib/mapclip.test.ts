import { describe, expect, it } from "vitest";
import { copyRange, pasteRange } from "../components/MapEditor";

describe("map range copy & paste (171)", () => {
  const rows = ["abcd", "efgh", "ijkl"];
  it("copies a rectangle dragged in any direction and pastes it, clipped at the edges", () => {
    const clip = copyRange(rows, { x0: 2, y0: 1, x1: 1, y1: 0 });
    expect(clip).toEqual([["b", "c"], ["f", "g"]]);
    expect(pasteRange(rows, clip, 0, 1, false)).toEqual(["abcd", "bcgh", "fgkl"]);
    expect(pasteRange(rows, clip, 3, 2, false)).toEqual(["abcd", "efgh", "ijkb"]);
  });
  it("on upper layers a blank in the copy keeps what is under it", () => {
    expect(pasteRange(["....", "...."], [["x", " "], [" ", "y"]], 1, 0, true)).toEqual([".x..", "..y."]);
  });
});

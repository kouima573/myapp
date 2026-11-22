import { describe, expect, it } from "vitest";
import { parseNotes } from "../../../packages/schema/src/song";
import { gridToNotes, notesToGrid, placeNote } from "./stepgrid";

describe("step sequencer ⇄ score (126)", () => {
  it("keeps note lengths through a round trip", () => {
    const text = "C4/4 E4/4 G4/4 C5/4";
    const grid = notesToGrid(text, 16)!;
    expect(grid.slice(0, 5)).toEqual(["C4", "~", "~", "~", "E4"]);
    expect(gridToNotes(grid)).toBe(text);
  });
  it("placing notes of a chosen length, cutting held notes, removing a note, merging rests", () => {
    let g = notesToGrid("R/1", 16)!;
    g = placeNote(g, 0, "C4", 4);
    g = placeNote(g, 8, "G4", 2);
    expect(gridToNotes(g)).toBe("C4/4 R/4 G4/8 R/4.");
    g = placeNote(g, 2, "E4", 1); // cuts the C4
    expect(gridToNotes(g)).toBe("C4/8 E4/16 R/4 R/16 G4/8 R/4.");
    g = placeNote(g, 8, "G4", 2); // same pitch at its start: removed
    expect(gridToNotes(g)).toBe("C4/8 E4/16 R/2. R/16");
    expect(() => parseNotes(gridToNotes(g))).not.toThrow();
  });
});

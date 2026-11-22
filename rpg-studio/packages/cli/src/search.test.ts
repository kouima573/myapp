import { describe, expect, it } from "vitest";
import { replaceTexts, searchTexts } from "./search";

describe("project search & replace (175)", () => {
  const texts = {
    "a.json": JSON.stringify({ items: [{ id: "herb", name: "薬草", description: "薬草を煎じた" }] }),
    "b.json": JSON.stringify({ lines: ["薬草はいかが？", "HERB"], herb: "keys are never touched" }),
    "c.ts": "const 薬草 = 1;",
  };
  it("finds string values only (not keys, not code) and counts every occurrence", () => {
    const hits = searchTexts(texts, "薬草");
    expect(hits.map(h => `${h.file} › ${h.at} ×${h.count}`)).toEqual(["a.json › items[herb].name ×1", "a.json › items[herb].description ×1", "b.json › lines[0] ×1"]);
    expect(searchTexts(texts, "herb").map(h => h.at)).toEqual(["items[herb].id", "lines[1]"]); // case-insensitive by default
    expect(searchTexts(texts, "herb", { caseSensitive: true }).map(h => h.at)).toEqual(["items[herb].id"]);
    expect(searchTexts(texts, "薬.", { regex: true }).length).toBe(3);
    expect(searchTexts(texts, "[", { regex: true })).toEqual([]); // a broken pattern finds nothing instead of throwing
  });
  it("replaces in values and keeps keys and structure", () => {
    const out = replaceTexts(texts, "薬草", "やくそう");
    expect(out.map(o => [o.file, o.count])).toEqual([["a.json", 2], ["b.json", 1]]);
    const b = JSON.parse(out[1]!.text);
    expect(b).toEqual({ lines: ["やくそうはいかが？", "HERB"], herb: "keys are never touched" });
  });
});

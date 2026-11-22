import { describe, expect, it } from "vitest";
import { SOURCE_CATALOG } from "../../schema/src/index";
import { ART_STYLES, applyStyle, styleColor } from "./artgen/style";
import { Img } from "./artgen/core";
import { applyVerification, dueSources } from "./sourceCatalog";

describe("取得元カタログの更新（136）", () => {
  it("lists unverified and stale sources, skipping built-in generators", () => {
    const due = dueSources(SOURCE_CATALOG, "2026-11-22", 180);
    const ids = due.map(d => d.source.id);
    expect(ids).toContain("kenney");
    expect(ids).not.toContain("builtin-sfx");
    const verified = { ...SOURCE_CATALOG.find(s => s.id === "kenney")!, verifiedAt: "2026-01-01" };
    expect(dueSources([verified], "2026-03-01", 180)).toEqual([]);
    expect(dueSources([verified], "2026-11-22", 180)[0]!.reasons[0]).toMatch(/日経過/);
  });
  it("records a verification only with valid values and keeps extra keys", () => {
    const raw = { id: "x", name: "X", url: "https://example.com/", categories: ["image"], origin: "site", summary: "s", checklist: [], creditRequired: "unknown", redistribution: "unknown", automatedDownload: "unknown", verifiedAt: null, research: { method: "secondary", checkedAt: "2026-11-15", urls: [] } };
    const ok = applyVerification(raw, { date: "2026-11-22", creditRequired: "yes", summary: "読んだ" });
    expect("source" in ok && ok.source).toMatchObject({ verifiedAt: "2026-11-22", creditRequired: "yes", summary: "読んだ", research: { method: "secondary" } });
    expect(applyVerification(raw, { date: "22/11/2026" })).toHaveProperty("error");
    expect(applyVerification(raw, { date: "2026-11-22", redistribution: "maybe" })).toHaveProperty("error");
  });
});

describe("画風（137）", () => {
  it("each style changes colours deterministically and keeps transparency", () => {
    for (const style of ART_STYLES) {
      const img = new Img(4, 4);
      img.set(1, 1, 0x40a060);
      applyStyle(img, style);
      expect(img.alpha(0, 0)).toBe(0);
      expect(img.alpha(1, 1)).toBe(255);
    }
    expect(styleColor("standard", 10, 20, 30)).toEqual([10, 20, 30]);
    expect(styleColor("mono", 0, 0, 0)).toEqual([15, 56, 15]);
    expect(styleColor("retro", 200, 100, 30, 0, 0).every(v => v % 85 === 0)).toBe(true);
    const [r, g, b] = styleColor("pastel", 200, 40, 40);
    expect(r - g).toBeLessThan(160);
    expect(Math.min(r, g, b)).toBeGreaterThan(40);
    expect(styleColor("dusk", 255, 255, 255)[2]).toBeGreaterThan(styleColor("dusk", 255, 255, 255)[0]);
  });
});

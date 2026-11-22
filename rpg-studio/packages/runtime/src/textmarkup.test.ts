import { describe, expect, it } from "vitest";
import { parseMarkup, plainLength, stripMarkup, typedAt } from "./textmarkup";

describe("text decoration tags (044)", () => {
  it("parses colours, styles, ruby, pauses and sounds; unknown brackets stay", () => {
    const raw = "[c=red]{炎|ほのお}[/c]の[shake]呪い[/shake]だ！[w=400][se=sfx-hit][A]ボタン";
    expect(stripMarkup(raw)).toBe("炎の呪いだ！[A]ボタン");
    const tokens = parseMarkup(raw);
    expect(tokens[0]).toMatchObject({ kind: "ruby", base: "炎", style: { color: "#ff7a6b" } });
    expect(tokens.find(t => t.kind === "text" && t.text === "呪い")).toMatchObject({ style: { classes: ["rpg-t-shake"] } });
    expect(tokens.filter(t => t.kind === "wait")).toEqual([{ kind: "wait", ms: 400 }]);
    expect(tokens.filter(t => t.kind === "se")).toEqual([{ kind: "se", sound: "sfx-hit" }]);
    expect(plainLength(tokens)).toBe(Array.from("炎の呪いだ！[A]ボタン").length);
  });

  it("pauses hold the typing; sounds are reported once reached", () => {
    const tokens = parseMarkup("ab[w=1000][se=ding]cd");
    expect(typedAt(tokens, 25, 10).count).toBe(2);
    expect(typedAt(tokens, 500, 10)).toEqual({ count: 2, sounds: [] });
    expect(typedAt(tokens, 1025, 10)).toEqual({ count: 2, sounds: [2] });
    expect(typedAt(tokens, 1045, 10).count).toBe(4);
    expect(typedAt(tokens, 0, 0)).toEqual({ count: 4, sounds: [2] }); // instant text
  });
});

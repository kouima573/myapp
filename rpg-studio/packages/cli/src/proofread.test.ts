import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./build";
import { proofread, proofreadText } from "./proofread";

describe("rpg proofread (169)", () => {
  const opts = { width: 10, lines: 2, message: true };
  it("finds texts too long for the window, typos and open brackets / tags", () => {
    expect(proofreadText("あいうえおかきくけこさしすせそたちつてとなにぬねの", opts)).toEqual([expect.stringContaining("約3行")]);
    expect(proofreadText("それはのの本だ。。", opts)).toEqual(expect.arrayContaining([expect.stringContaining("「。。」"), expect.stringContaining("「のの」")]));
    expect(proofreadText("「こんにちは", opts)).toEqual([expect.stringContaining("かっこ")]);
    expect(proofreadText("[c=red]赤", opts)).toEqual([expect.stringContaining("[c]")]);
    expect(proofreadText("ののしられた……！？", opts)).toEqual([]);
    expect(proofreadText("{{name}}は来た。", opts)).toEqual([]);
  });
  it("the samples are clean", async () => {
    for (const id of ["sample-rpg", "genre-gallery"]) expect(await proofread(path.join(REPO_ROOT, "projects", id), { width: 40, lines: 3 })).toEqual([]);
  });
});

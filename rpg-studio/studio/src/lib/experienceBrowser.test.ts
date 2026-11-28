import path from "node:path";
import { describe, expect, it } from "vitest";
import { readExperienceProjectTexts } from "../../../packages/cli/src/experience";
import { compileExperienceBundle } from "./experienceBrowser";

describe("ブラウザ版の独立作品", () => {
  it("素材が0件でも、試遊・ゲームZIP用のコードが正しいJavaScriptになる", async () => {
    const texts = await readExperienceProjectTexts(path.resolve(__dirname, "../../../projects/deep-sea-post-office"));
    const { bundle } = await compileExperienceBundle(texts, {}, { memorySave: true });
    // 構文エラーがあれば new Function の時点で投げる（実行はしない）
    expect(() => new Function(bundle)).not.toThrow();
    expect(bundle).toContain("assetUrl: id => ({})[id]");
  });
});

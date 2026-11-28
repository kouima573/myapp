import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProjectContent } from "@rpg/schema";
import { blankProject } from "./blank";
import { readZip, writeZip } from "./zip";

const root = path.resolve(__dirname, "../../../projects/sample-rpg");
function sampleTexts(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(json|md|ts)$/.test(e.name)) out[path.relative(root, p).split(path.sep).join("/")] = fs.readFileSync(p, "utf8"); } };
  walk(root);
  return out;
}

describe("ブラウザ版の工房", () => {
  it("「新しいゲーム」のひな形は検証を通り、独自コードもモジュールもない", () => {
    const texts = blankProject(sampleTexts(), { id: "my-game", title: "わたしのゲーム" });
    const loaded = loadProjectContent(texts);
    expect(loaded.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(loaded.content!.project.systems).toEqual([]);
    expect(Object.keys(loaded.content!.project.modules)).toEqual([]);
    expect(Object.keys(texts).some(f => f.startsWith("systems/") || f.startsWith("scripts/"))).toBe(false);
    expect(loaded.content!.project.assetPolicy.shareable).toBe(false); // 自分の作品は共有用ひな形ではない
    // 見本の曲は入れない（自分の曲を音楽画面で入れる）
    expect(loaded.content!.assets.assets.filter(a => a.kind === "song" || a.kind === "bgm")).toEqual([]);
    expect(Object.keys(texts).some(f => f.endsWith(".song.json"))).toBe(false);
  });
  it("ZIPを書いて読み戻せる（日本語のファイル名・空のファイル）", async () => {
    const enc = new TextEncoder();
    const files = [{ name: "game/project.json", data: enc.encode("{\"a\":1}") }, { name: "game/台本.md", data: enc.encode("# はじまり") }, { name: "game/empty.txt", data: new Uint8Array() }];
    const back = await readZip(writeZip(files));
    expect(back.map(f => f.name)).toEqual(files.map(f => f.name));
    expect(new TextDecoder().decode(back[1]!.data)).toBe("# はじまり");
  });
});

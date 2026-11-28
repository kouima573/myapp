import path from "node:path";
import { describe, expect, it } from "vitest";
import { assetRights, planAssetPack, readZip, writeZip, type AssetEntry } from "../../schema/src/index";
import { ENGINE_CREDITS_SECTION, creditsMarkdown } from "../../runtime/src/credits";
import { loadProjectFromDisk } from "./load";
import { releaseChecklist } from "./releaseCheck";

const root = path.resolve(__dirname, "../../../projects/genre-gallery");
const policy = { assetPolicy: { shareable: false, sources: {}, customSources: [], prefer: {}, budget: {} } } as never;
const asset = (over: Partial<AssetEntry>): AssetEntry => ({ id: "x", path: "assets/x.png", kind: "character", mimeType: "image/png", bytes: 1, source: "", license: "", origin: "original", creditRequired: false, redistributable: true, ...over } as AssetEntry);

describe("販売と素材パック", () => {
  it("素材ごとに、ゲームを売ってよいか・素材のまま配れるかを判定する", () => {
    const [own, builtin, site, siteOk, siteNo, ai] = assetRights(policy, [
      asset({ id: "own" }),
      asset({ id: "builtin", origin: "generated", sourceId: "builtin-art" }),
      asset({ id: "site", origin: "site", sourceId: "opengameart", termsCheckedAt: "2026-11-28" }),
      asset({ id: "siteOk", origin: "site", sourceId: "opengameart", termsCheckedAt: "2026-11-28", commercial: true }),
      asset({ id: "siteNo", origin: "site", sourceId: "maou-audio", kind: "bgm", termsCheckedAt: "2026-11-28", commercial: false }),
      asset({ id: "ai", origin: "generated", sourceId: "ai-image" }),
    ]);
    expect([own!.sell, own!.pack]).toEqual(["ok", "ok"]);
    expect([builtin!.sell, builtin!.pack]).toEqual(["ok", "ok"]);
    expect(site!.sell).toBe("check"); // ファイルごとに条件が違う取得元は、人が記録するまで保留
    expect(siteOk!.sell).toBe("ok");
    expect(siteNo!.sell).toBe("block");
    expect([ai!.sell, ai!.pack]).toEqual(["check", "block"]);
    expect(site!.pack).toBe("block");
  });

  it("販売前チェックが、検証・テスト・書きかけ・権利をまとめる", async () => {
    const loaded = await loadProjectFromDisk(root);
    const ok = releaseChecklist({ content: loaded.content, texts: loaded.texts, diagnostics: loaded.diagnostics, tests: [{ file: "tests/a.scenario.json", ok: true }] });
    expect(ok.items.find(i => i.id === "tests")!.status).toBe("ok");
    expect(ok.items.find(i => i.id === "rights")!.status).toBe("warn"); // 見本のAI生成画像は要確認
    const dialogues = JSON.parse(loaded.texts["dialogues/dialogues.json"]!);
    dialogues.dialogues[0].lines = ["TODO: ここにあいさつを書く"];
    const draft = releaseChecklist({ content: loaded.content, texts: { ...loaded.texts, "dialogues/dialogues.json": JSON.stringify(dialogues) }, diagnostics: [], tests: [{ file: "t", ok: false, message: "x" }] });
    expect(draft.items.find(i => i.id === "placeholders")!.status).toBe("warn");
    expect(draft.verdict).toBe("blocked");
    expect(creditsMarkdown(loaded.content!)).toContain(ENGINE_CREDITS_SECTION);
  });

  it("素材パック: 配れる素材だけを、README・LICENSE・出どころ・一覧付きで入れる", async () => {
    const loaded = await loadProjectFromDisk(root);
    const { project, assets, tileset } = loaded.content!;
    const ids = assets.assets.filter(a => a.kind === "character" || a.kind === "tileset").map(a => a.id);
    const plan = planAssetPack(project, assets.assets, ids, { id: "pack", title: "キャラ素材", author: "作者", license: "cc0" }, tileset);
    expect(plan.included.length).toBeGreaterThan(5);
    expect(plan.refused.map(r => r.id)).toContain("adventurer"); // AI生成は入れない
    const names = plan.files.map(f => f.name);
    expect(names).toEqual(expect.arrayContaining(["pack/README.md", "pack/LICENSE.txt", "pack/CREDITS.md", "pack/pack.json"]));
    expect(names.some(n => n.endsWith(".tiles.json"))).toBe(true);
    expect(planAssetPack(project, assets.assets, ids, { id: "p", title: "", author: "", license: "cc0" }).problems.join()).toMatch(/名前/);
    const zip = writeZip(plan.files.filter(f => "text" in f.source).map(f => ({ name: f.name, data: new TextEncoder().encode((f.source as { text: string }).text) })));
    expect((await readZip(zip)).map(e => e.name)).toContain("pack/LICENSE.txt");
  });
});

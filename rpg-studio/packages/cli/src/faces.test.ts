import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composePackPreview, loadProjectContent, planAssetPack, type AssetEntry, type GameContent } from "../../schema/src/index";
import { createEngine, readSave } from "../../engine/src/index";
import { CHARACTERS, randomCharacter } from "./artgen/characters";
import { EXPRESSIONS, drawPortrait, renderPortraitSheet } from "./artgen/portraits";
import { BACKGROUND_PRESETS, renderBackgroundDesign } from "./artgen/backgrounds";
import { cmdArtBackground, cmdArtCharacter, cmdArtPortrait } from "./characterCmd";
import { readProjectTexts, loadProjectFromDisk } from "./load";
import { checkOldSaves, cmdReleaseSnapshot, readOldSaves } from "./releaseSaves";
import { releaseChecklist } from "./releaseCheck";

const sample = path.resolve(__dirname, "../../../projects/sample-rpg");
const quiet = async <T,>(f: () => Promise<T>) => { const log = console.log; console.log = () => {}; try { return await f(); } finally { console.log = log; } };

describe("顔グラフィック・戦闘背景", () => {
  it("顔グラフィック: キャラクターと同じ部品から、表情5つ（96×96）を並べた1枚。表情ごとに顔が変わる", () => {
    for (const spec of [...CHARACTERS, randomCharacter(5), randomCharacter(11)]) {
      const sheet = renderPortraitSheet(spec);
      expect([sheet.w, sheet.h]).toEqual([480, 96]);
    }
    const spec = CHARACTERS[0]!;
    const faces = EXPRESSIONS.map(e => drawPortrait(spec, e).data.join(","));
    expect(new Set(faces).size).toBe(EXPRESSIONS.length);
    expect(renderPortraitSheet(spec).data).toEqual(renderPortraitSheet(spec).data); // 同じ部品なら同じ絵
  });

  it("戦闘背景: 見本ごとに 640×448 の不透明な絵。シードで木や雲の位置が変わる", () => {
    const pics = BACKGROUND_PRESETS.map(p => renderBackgroundDesign(p));
    for (const img of pics) {
      expect([img.w, img.h]).toEqual([640, 448]);
      expect(img.data.filter((_, i) => i % 4 === 3).every(a => a === 255)).toBe(true);
    }
    expect(new Set(pics.map(p => p.data.join(","))).size).toBe(pics.length);
    const meadow = BACKGROUND_PRESETS[0]!;
    expect(renderBackgroundDesign({ ...meadow, seed: 2 }).data).not.toEqual(renderBackgroundDesign({ ...meadow, seed: 3 }).data);
  });

  it("CLI: キャラクターから顔グラフィックを作り、戦闘背景と一緒に登録できる（検証が通る）", async () => {
    const { newProject } = await import("./scaffold");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rpg-face-"));
    try {
      const root = await quiet(() => newProject("faces", "顔の実験", tmp));
      expect(await quiet(() => cmdArtCharacter(root, { id: "fox", name: "狐の娘", random: "7" }))).toBe(0);
      expect(await quiet(() => cmdArtPortrait(root, { id: "fox", character: "chr-fox" }))).toBe(0);
      expect(await quiet(() => cmdArtBackground(root, { id: "dusk", name: "夕暮れ", preset: "dusk-ruins" }))).toBe(0);
      expect(await quiet(() => cmdArtBackground(root, { id: "x", name: "x", preset: "no-such" }))).toBe(2);
      const loaded = loadProjectContent((await readProjectTexts(root)).texts);
      expect(loaded.diagnostics.filter(d => d.severity === "error")).toEqual([]);
      const face = loaded.content!.assets.assets.find(a => a.id === "face-fox")!;
      const bg = loaded.content!.assets.assets.find(a => a.id === "bg-dusk")!;
      expect(face).toMatchObject({ kind: "portrait", tileWidth: 96, tileHeight: 96, columns: 5, rows: 1, origin: "generated", sourceId: "builtin-art" });
      expect(bg).toMatchObject({ kind: "background", tileWidth: 640, tileHeight: 448, columns: 1, rows: 1 });
      expect(JSON.parse(String(face.generator?.spec)).name).toBe("狐の娘");
    } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  }, 30000);
});

describe("素材パックの見本画像", () => {
  const asset = (over: Partial<AssetEntry>): AssetEntry => ({ id: "x", path: "assets/x.png", kind: "character", mimeType: "image/png", bytes: 1, source: "", license: "", origin: "generated", sourceId: "builtin-art", creditRequired: false, redistributable: true, ...over } as AssetEntry);
  const policy = { assetPolicy: { shareable: false, sources: {}, customSources: [], prefer: {}, budget: {} } } as never;

  it("画像素材だけを番号つきで並べ、README と pack.json に番号が入る（音は入らない）", () => {
    const plan = planAssetPack(policy, [
      asset({ id: "hero", path: "assets/characters/hero.png", tileWidth: 64, tileHeight: 64, columns: 4, rows: 4 }),
      asset({ id: "sky", kind: "background", path: "assets/backgrounds/sky.png", tileWidth: 640, tileHeight: 448, columns: 1, rows: 1 }),
      asset({ id: "jingle", kind: "sfx", path: "assets/audio/jingle.wav", mimeType: "audio/wav" }),
    ], ["hero", "sky", "jingle"], { id: "p", title: "見本", author: "作者", license: "cc0" });
    const preview = plan.files.find(f => f.name === "p/preview.png")!;
    expect(preview.source).toEqual({ preview: [{ assetPath: "assets/characters/hero.png", frame: { w: 64, h: 64 } }, { assetPath: "assets/backgrounds/sky.png" }] });
    const readme = (plan.files.find(f => f.name === "p/README.md")!.source as { text: string }).text;
    expect(readme).toContain("[1] `characters/hero.png`");
    expect(readme).toContain("[2] `backgrounds/sky.png`");
    const manifest = JSON.parse((plan.files.find(f => f.name === "p/pack.json")!.source as { text: string }).text);
    expect(manifest.preview).toBe("preview.png");
    expect(manifest.items.find((i: { id: string }) => i.id === "jingle").previewNumber).toBeUndefined();
  });

  it("枠の数に合わせた大きさ。読めない画像は空の枠で番号を保つ", () => {
    const red = { width: 2, height: 2, data: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]) };
    const one = composePackPreview([{ image: red }]);
    expect([one.width, one.height]).toEqual([12 * 2 + 128, 12 * 2 + 128]);
    const seven = composePackPreview(Array.from({ length: 7 }, (_, i) => ({ image: i === 3 ? null : red })));
    expect([seven.width, seven.height]).toEqual([12 * 2 + 6 * 128 + 5 * 8, 12 * 2 + 2 * 128 + 8]);
    // The red picture is enlarged into the middle of the first cell.
    const mid = ((12 + 64) * one.width + 12 + 64) * 4;
    expect([...one.data.slice(mid, mid + 3)]).toEqual([255, 0, 0]);
  });
});

describe("更新しても、買った人のセーブが消えない", () => {
  it("見本の 1.0.0 のセーブ（releases/）は、今の版で全部読み込んで動かせる", async () => {
    const loaded = await loadProjectFromDisk(sample);
    const { loadSystems } = await import("./index");
    const systems = await loadSystems(sample, loaded.content!);
    const saves = await readOldSaves(sample);
    expect(saves.length).toBeGreaterThan(10);
    const results = checkOldSaves(loaded.content!, systems, saves);
    expect(results.filter(r => !r.ok)).toEqual([]);
    expect(results.every(r => r.version === "1.0.0")).toBe(true);
    // 販売前チェックの項目: 工房（確かめられない）は「未実行」でも判定を下げない。CLI で見本がなければ OK。壊れたセーブは不可
    const base = { content: loaded.content, texts: loaded.texts, diagnostics: [], tests: [{ file: "t", ok: true }] };
    const item = (r: ReturnType<typeof releaseChecklist>) => r.items.find(i => i.id === "saves")!.status;
    expect(item(releaseChecklist(base))).toBe("todo");
    expect(item(releaseChecklist({ ...base, oldSaves: [] }))).toBe("ok");
    expect(item(releaseChecklist({ ...base, oldSaves: results }))).toBe("ok");
    expect(releaseChecklist(base).verdict).toBe(releaseChecklist({ ...base, oldSaves: [] }).verdict);
    expect(item(releaseChecklist({ ...base, oldSaves: [{ file: "x", ok: false, notes: [] }] }))).toBe("block");
  }, 60000);

  it("消したアイテムは外して読み込み（記録が残る）、消したマップのセーブは「読めない」と知らせる", async () => {
    const loaded = await loadProjectFromDisk(sample);
    const content = loaded.content!;
    const { loadSystems } = await import("./index");
    const systems = await loadSystems(sample, content);
    const [first] = await readOldSaves(sample);
    const save = JSON.parse(first!.text);
    save.state.items["old-relic"] = 1;
    const moved = { ...save, state: { ...save.state, mapId: "removed-map" } };
    const [kept, lost] = checkOldSaves(content, systems, [{ file: "a.json", text: JSON.stringify(save) }, { file: "b.json", text: JSON.stringify(moved) }]);
    expect(kept).toMatchObject({ ok: true, notes: [expect.stringContaining("old-relic")] });
    expect(lost).toMatchObject({ ok: false, message: expect.stringContaining("removed-map") });
    // The adjusted state plays on.
    const read = readSave(save, content as GameContent);
    expect(read.ok && createEngine(content, systems).step(read.save.state, { type: "move", direction: "up" }).state.scene.kind).toBeTruthy();
  }, 60000);

  it("rpg release snapshot: 自動テストを通して遊び、セーブできる場面を releases/<版>/saves/ に残す", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rpg-snap-"));
    try {
      const root = path.join(tmp, "g");
      await fs.cp(path.resolve(__dirname, "../../../projects/genre-gallery"), root, { recursive: true });
      expect(await quiet(() => cmdReleaseSnapshot(root, {}))).toBe(1); // 版がわからない
      expect(await quiet(() => cmdReleaseSnapshot(root, { version: "0.9" }))).toBe(0);
      const saves = await readOldSaves(root);
      expect(saves.length).toBeGreaterThan(0);
      expect(saves.every(s => s.file.startsWith("releases/0.9/saves/"))).toBe(true);
      expect(JSON.parse(saves[0]!.text).gameVersion).toBe("0.9");
    } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  }, 60000);
});

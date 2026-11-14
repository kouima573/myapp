import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadProjectContent, parseNotes } from "../../schema/src/index";
import { encodeWav, presetParams, renderSfx } from "../../runtime/src/sfx";
import { creditLines } from "../../runtime/src/credits";
import { REPO_ROOT } from "./build";
import { cmdArt, cmdAsset } from "./assets";
import { loadProjectFromDisk, readProjectTexts } from "./load";

let dir: string;
let log: string[] = [];
beforeAll(async () => {
  dir = path.join(REPO_ROOT, ".rpg-studio", `asset-test-${crypto.randomBytes(4).toString("hex")}`);
  await fs.cp(path.join(REPO_ROOT, "projects/sample-rpg"), dir, { recursive: true });
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { log.push(args.join(" ")); });
});
afterAll(async () => { vi.restoreAllMocks(); await fs.rm(dir, { recursive: true, force: true }); });
const run = async (fn: () => Promise<number>) => { log = []; const code = await fn(); return { code, out: log.join("\n") }; };

describe("sound generation", () => {
  it("is deterministic and produces a valid WAV", () => {
    const a = encodeWav(renderSfx(presetParams("coin", 3), 22050, 3));
    const b = encodeWav(renderSfx(presetParams("coin", 3), 22050, 3));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a.subarray(0, 4)).toString()).toBe("RIFF");
    expect(Buffer.from(encodeWav(renderSfx(presetParams("coin", 4), 22050, 4))).equals(Buffer.from(a))).toBe(false);
  });

  it("parses text scores and reports bad tokens", () => {
    const { events, length } = parseNotes("A4/4 R/8 C#5/8. x/16 | Bb3/2");
    expect(length).toBeCloseTo(1 + 0.5 + 0.75 + 0.25 + 2);
    expect(events[0]!.freq).toBeCloseTo(440);
    expect(events[2]!.hit).toBe(true);
    expect(() => parseNotes("A4/4 H4/4")).toThrow(/2番目の「H4\/4」/);
  });
});

describe("rpg asset", () => {
  it("gen-sfx writes a WAV, registers provenance and can assign a cue", async () => {
    const { code } = await run(() => cmdAsset("gen-sfx", dir, { preset: "magic", id: "sfx-spell", cue: "heal", seed: "7" }));
    expect(code).toBe(0);
    const loaded = await loadProjectFromDisk(dir);
    expect(loaded.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    const asset = loaded.content!.assets.assets.find(a => a.id === "sfx-spell")!;
    expect(asset).toMatchObject({ origin: "generated", sourceId: "builtin-sfx", generator: { preset: "magic", seed: 7 } });
    expect(loaded.content!.project.audio.sfx.heal).toBe("sfx-spell");
  });

  it("refuses disabled sources, and site assets without terms check", async () => {
    const wav = path.join(dir, "assets/audio/sfx/sfx-coin.wav");
    let r = await run(() => cmdAsset("add", dir, { file: wav, id: "lab-coin", kind: "sfx", source: "soundeffect-lab", url: "https://soundeffect-lab.info/sound/", license: "効果音ラボ 利用規約", "terms-checked": "2026-11-14" }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("無効");
    r = await run(() => cmdAsset("enable", dir, { source: "soundeffect-lab" }));
    expect(r.code).toBe(0);
    // The sample is shareable → redistribution-prohibited sources are refused.
    r = await run(() => cmdAsset("add", dir, { file: wav, id: "lab-coin", kind: "sfx", source: "soundeffect-lab", url: "https://soundeffect-lab.info/sound/", license: "効果音ラボ 利用規約", "terms-checked": "2026-11-14" }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("再配布禁止");
    const project = JSON.parse(await fs.readFile(path.join(dir, "project.json"), "utf8"));
    project.assetPolicy.shareable = false;
    await fs.writeFile(path.join(dir, "project.json"), JSON.stringify(project));
    r = await run(() => cmdAsset("add", dir, { file: wav, id: "lab-coin", kind: "sfx", source: "soundeffect-lab", url: "https://soundeffect-lab.info/sound/", license: "効果音ラボ 利用規約" }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("termsCheckedAt");
    r = await run(() => cmdAsset("add", dir, { file: wav, id: "lab-coin", kind: "sfx", source: "soundeffect-lab", url: "https://soundeffect-lab.info/sound/", license: "効果音ラボ 利用規約", "terms-checked": "2026-11-14", notes: "素材の再配布禁止" }));
    expect(r.code).toBe(0);
    expect(r.out).toContain("□");
    const loaded = await loadProjectFromDisk(dir);
    expect(loaded.content!.assets.assets.find(a => a.id === "lab-coin")).toMatchObject({ redistributable: false, termsCheckedAt: "2026-11-14" });
    // Turning the project back into a shareable template is now a validation error.
    project.assetPolicy.shareable = true;
    await fs.writeFile(path.join(dir, "project.json"), JSON.stringify(project));
    const again = await loadProjectFromDisk(dir);
    expect(again.diagnostics.map(d => d.message).join()).toContain("再配布");
  });

  it("enforces the file-size budget", async () => {
    const big = path.join(dir, "big.wav");
    const samples = new Float32Array(22050 * 300);
    await fs.writeFile(big, encodeWav(samples));
    const r = await run(() => cmdAsset("add", dir, { file: big, id: "too-big", kind: "bgm" }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("MB を超えています");
  });

  it("art check verifies size and transparency against the request", async () => {
    const r = await run(() => cmdArt("check", dir, { id: "char-elder", file: path.join(dir, "assets/characters/village-guard.png") }));
    expect(r.code).toBe(0);
    const bad = await run(() => cmdArt("check", dir, { id: "char-elder", file: path.join(dir, "assets/tilesets/sample-village.png") }));
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("サイズ");
    const prompt = await run(() => cmdArt("prompt", dir, { id: "char-elder" }));
    expect(prompt.out).toContain("スタイルガイド");
    expect(prompt.out).toContain("64×256px");
  });
});

describe("provenance validation", () => {
  it("requires terms check, URL and credit text for external assets", async () => {
    const { texts } = await readProjectTexts(path.join(REPO_ROOT, "projects/sample-rpg"));
    const assets = JSON.parse(texts["assets.json"]!);
    assets.assets.push({ id: "x", path: "assets/audio/sfx/sfx-coin.wav", kind: "sfx", mimeType: "audio/wav", bytes: 1, origin: "site", sourceId: "otologic", creditRequired: true });
    const result = loadProjectContent({ ...texts, "assets.json": JSON.stringify(assets) });
    const text = result.diagnostics.map(d => d.message).join("\n");
    expect(text).toContain("termsCheckedAt");
    expect(text).toContain("URL");
    expect(text).toContain("credit");
  });

  it("credits list generated sounds", async () => {
    const loaded = await loadProjectFromDisk(path.join(REPO_ROOT, "projects/sample-rpg"));
    expect(creditLines(loaded.content!).join("\n")).toContain("オリジナル生成");
  });
});

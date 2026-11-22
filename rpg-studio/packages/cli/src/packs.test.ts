import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { REPO_ROOT } from "./build";
import { cmdAsset } from "./assets";
import { cmdPacks, loadPacks } from "./packs";
import { add as libraryAdd, cmdLibrary } from "./library";

let work: string, project: string, packDir: string;
let log: string[] = [];
const run = async (fn: () => Promise<number>) => { log = []; const code = await fn(); return { code, out: log.join("\n") }; };

beforeAll(async () => {
  work = path.join(REPO_ROOT, ".rpg-studio", `packs-test-${crypto.randomBytes(4).toString("hex")}`);
  project = path.join(work, "project");
  packDir = path.join(work, "pack");
  await fs.cp(path.join(REPO_ROOT, "projects/sample-rpg"), project, { recursive: true });
  await fs.mkdir(path.join(packDir, "se"), { recursive: true });
  await fs.copyFile(path.join(project, "assets/audio/sfx/sfx-coin.wav"), path.join(packDir, "se/coin.wav"));
  process.env.RPG_STUDIO_HOME = path.join(work, "home");
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { log.push(args.join(" ")); });
});
afterAll(async () => { vi.restoreAllMocks(); delete process.env.RPG_STUDIO_HOME; await fs.rm(work, { recursive: true, force: true }); });

describe("rpg packs (asset pack ledger on this computer)", () => {
  it("records a pack outside the repository and never stores credentials", async () => {
    const added = await run(() => cmdPacks("add", { id: "my-se", name: "効果音パック", source: "otologic", folder: packDir, license: "CC BY 4.0", url: "https://otologic.jp/", "terms-checked": "2026-11-15", credit: "効果音: OtoLogic" }, [], () => project));
    expect(added.code).toBe(0);
    const packs = await loadPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]!.creditRequired).toBe(true);
    const keys = Object.keys((JSON.parse(await fs.readFile(path.join(work, "home", "packs.json"), "utf8")) as { packs: object[] }).packs[0]!);
    expect(keys.some(k => /password|cookie|token|secret/i.test(k))).toBe(false);
    expect((await run(() => cmdPacks("files", {}, ["my-se"], () => project))).out).toContain("se/coin.wav");
  });

  it("registers a file from a pack with its provenance filled in, and refuses paths outside the pack", async () => {
    await run(() => cmdAsset("enable", project, { source: "otologic" }));
    expect((await run(() => cmdPacks("use", { file: "../project/project.json", id: "x", kind: "sfx" }, ["my-se"], () => project))).code).toBe(1);
    const used = await run(() => cmdPacks("use", { file: "se/coin.wav", id: "pack-coin", kind: "sfx" }, ["my-se"], () => project));
    expect(used.code).toBe(0);
    const asset = (JSON.parse(await fs.readFile(path.join(project, "assets.json"), "utf8")) as { assets: Array<Record<string, unknown>> }).assets.find(a => a.id === "pack-coin")!;
    expect(asset).toMatchObject({ sourceId: "otologic", license: "CC BY 4.0", url: "https://otologic.jp/", termsCheckedAt: "2026-11-15", creditRequired: true });
  });
});

describe("helpers for choosing in a chat", () => {
  it("asset find lists built-in options, search links with the words, and cautions", async () => {
    const found = await run(() => cmdAsset("find", project, { kind: "bgm", words: "森", all: true }));
    expect(found.code).toBe(0);
    expect(found.out).toContain("楽譜BGM");
    expect(found.out).toContain("opentracks.com");
    expect(found.out).toMatch(/パスワードは預からない/);
  });

  it("library tiles are matched by key: re-adding a renumbered sheet keeps the map codes and follows the new numbers", async () => {
    const lib = path.join(work, "lib");
    await fs.cp(path.join(REPO_ROOT, "library"), lib, { recursive: true });
    const catalog = JSON.parse(await fs.readFile(path.join(lib, "library.json"), "utf8"));
    const sheet = catalog.items.find((i: { kind: string }) => i.kind === "tileset");
    expect((await run(() => libraryAdd(lib, {}, [sheet.id], project))).code).toBe(0);
    const tilesFile = path.join(project, "tiles.json");
    const before = JSON.parse(await fs.readFile(tilesFile, "utf8")).tiles.filter((t: { atlas?: string }) => t.atlas === sheet.id);
    const [a, b] = sheet.tiles;
    expect(before.find((t: { key?: string }) => t.key === a.key)?.index).toBe(a.index);
    // The sheet is regenerated with the first two pictures swapped.
    [a.index, b.index] = [b.index, a.index];
    await fs.writeFile(path.join(lib, "library.json"), JSON.stringify(catalog));
    const again = await run(() => libraryAdd(lib, { replace: true }, [sheet.id], project));
    expect(again.code).toBe(0);
    expect(again.out).toContain("番号を追従");
    const after = JSON.parse(await fs.readFile(tilesFile, "utf8")).tiles.filter((t: { atlas?: string }) => t.atlas === sheet.id);
    expect(after.length).toBe(before.length);
    for (const key of [a.key, b.key]) {
      const was = before.find((t: { key?: string }) => t.key === key), now = after.find((t: { key?: string }) => t.key === key);
      expect(now.code).toBe(was.code); // maps keep working
      expect(now.index).toBe(sheet.tiles.find((t: { key: string }) => t.key === key).index);
    }
  });

  it("library preview writes a numbered contact sheet", async () => {
    const out = path.join(work, "preview.png");
    const res = await run(() => cmdLibrary("preview", { kind: "tile", query: "絨毯", out }, [], () => project));
    expect(res.code).toBe(0);
    expect(res.out).toContain(" 1. ");
    expect((await fs.readFile(out)).subarray(1, 4).toString()).toBe("PNG");
  });
});

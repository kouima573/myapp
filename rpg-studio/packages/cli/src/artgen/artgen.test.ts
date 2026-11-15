import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { REPO_ROOT } from "../build";
import { loadProjectFromDisk } from "../load";
import { cmdLibrary, codePool } from "../library";
import { Img, rng } from "./core";
import { decodePng, encodePng } from "./png";
import { renderTile, SHEETS } from "./tiles";
import { CHARACTERS, renderCharacterSheet } from "./characters";
import { MONSTERS, renderMonsterSheet } from "./monsters";
import { BACKGROUNDS, renderBackground } from "./backgrounds";
import { renderTileSheet, type LibraryCatalog } from "./library";

const sha = (b: Uint8Array | Uint8ClampedArray) => crypto.createHash("sha256").update(Buffer.from(b.buffer, b.byteOffset, b.byteLength)).digest("hex");

describe("PNG encoder", () => {
  it("writes an indexed PNG with transparency that decodes to the same pixels", () => {
    const img = new Img(37, 21);
    img.rect(2, 3, 10, 5, 0xff0000);
    img.rect(20, 10, 6, 6, 0x00ff00, 128);
    img.line(0, 20, 36, 0, 0x1234ab);
    const png = encodePng(img);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(37);
    expect(png.readUInt32BE(20)).toBe(21);
    expect(png[25]).toBe(3); // palette
    expect(png.includes(Buffer.from("tRNS"))).toBe(true);
    const back = decodePng(png);
    expect(back.w).toBe(37);
    expect(back.h).toBe(21);
    expect(Buffer.from(back.data).equals(Buffer.from(img.data))).toBe(true);
  });

  it("falls back to RGBA for images with more than 256 colours", () => {
    const img = new Img(40, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) img.set(x, y, (x * 6) << 16 | (y * 6) << 8 | 77);
    const png = encodePng(img);
    expect(png[25]).toBe(6);
    expect(Buffer.from(decodePng(png).data).equals(Buffer.from(img.data))).toBe(true);
  });

  it("rejects corrupted data", () => {
    const png = encodePng(new Img(4, 4));
    png[30] = png[30]! ^ 0xff;
    expect(() => decodePng(png)).toThrow(/CRC/);
  });
});

describe("generators", () => {
  it("has a large, uniquely named catalogue", () => {
    const tiles = SHEETS.flatMap(s => s.tiles);
    expect(tiles.length).toBeGreaterThanOrEqual(120);
    for (const sheet of SHEETS) expect(new Set(sheet.tiles.map(t => t.key)).size).toBe(sheet.tiles.length);
    expect(CHARACTERS.length).toBeGreaterThanOrEqual(40);
    expect(MONSTERS.length).toBeGreaterThanOrEqual(40);
    expect(BACKGROUNDS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(CHARACTERS.map(c => c.id)).size).toBe(CHARACTERS.length);
    expect(new Set(MONSTERS.map(c => c.id)).size).toBe(MONSTERS.length);
  });

  it("is deterministic and produces the sheet layouts the runtime expects", () => {
    const a = renderTileSheet(1), b = renderTileSheet(1);
    expect(sha(a.img.data)).toBe(sha(b.img.data));
    expect(encodePng(a.img).equals(encodePng(b.img))).toBe(true);
    expect(a.img.w).toBe(8 * 64);
    expect(renderTile(SHEETS[0]!.tiles[0]!, SHEETS[0]!.id).w).toBe(64);
    const knight = CHARACTERS.find(c => c.id === "knight")!;
    const sheet = renderCharacterSheet(knight);
    expect([sheet.w, sheet.h]).toEqual([256, 256]);
    expect(sha(renderCharacterSheet(knight).data)).toBe(sha(sheet.data));
    expect(sha(renderCharacterSheet(CHARACTERS[0]!).data)).not.toBe(sha(sheet.data));
    const slime = renderMonsterSheet(MONSTERS[0]!);
    expect([slime.w, slime.h]).toEqual([256, 64]);
    expect(sha(renderMonsterSheet(MONSTERS[0]!).data)).toBe(sha(slime.data));
    const bg = renderBackground(BACKGROUNDS[0]!);
    expect([bg.w, bg.h]).toEqual([640, 448]);
    expect(rng("x")()).toBe(rng("x")());
  });

  it("tiles are opaque and ground tiles wrap seamlessly", () => {
    const field = SHEETS.find(s => s.id === "lib-tiles-field")!;
    for (const key of ["grass", "dirt", "sand", "water"]) {
      const img = renderTile(field.tiles.find(t => t.key === key)!, field.id);
      for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(255);
    }
  });

  it("the committed library matches the generator and its catalogue", async () => {
    const dir = path.join(REPO_ROOT, "library");
    const catalog = JSON.parse(await fs.readFile(path.join(dir, "library.json"), "utf8")) as LibraryCatalog;
    expect(catalog.items.filter(i => i.kind === "tileset").reduce((s, i) => s + i.tiles!.length, 0)).toBeGreaterThanOrEqual(120);
    for (const item of catalog.items) {
      const bytes = await fs.readFile(path.join(dir, item.path));
      expect(bytes.length, item.id).toBe(item.bytes);
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], item.id).toEqual([item.columns * item.tileWidth, item.rows * item.tileHeight]);
    }
    // Pixel-exact against a fresh render (catches a stale library after drawing changes: run pnpm rpg art generate).
    const tileItem = catalog.items.find(i => i.id === SHEETS[2]!.id)!;
    expect(sha(decodePng(await fs.readFile(path.join(dir, tileItem.path))).data)).toBe(sha(renderTileSheet(2).img.data));
    expect(sha(decodePng(await fs.readFile(path.join(dir, "characters/chr-knight.png"))).data)).toBe(sha(renderCharacterSheet(CHARACTERS.find(c => c.id === "knight")!).data));
    expect(sha(decodePng(await fs.readFile(path.join(dir, "enemies/mon-dragon-red.png"))).data)).toBe(sha(renderMonsterSheet(MONSTERS.find(c => c.id === "dragon-red")!).data));
  });
});

describe("rpg library", () => {
  let dir: string;
  let log: string[] = [];
  beforeAll(async () => {
    dir = path.join(REPO_ROOT, ".rpg-studio", `library-test-${crypto.randomBytes(4).toString("hex")}`);
    await fs.cp(path.join(REPO_ROOT, "projects/sample-rpg"), dir, { recursive: true });
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { log.push(args.join(" ")); });
  });
  afterAll(async () => { vi.restoreAllMocks(); await fs.rm(dir, { recursive: true, force: true }); });
  const run = async (sub: string, flags: Record<string, string | boolean>, args: string[] = []) => { log = []; const code = await cmdLibrary(sub, flags, args, () => dir); return { code, out: log.join("\n") }; };

  it("lists and searches", async () => {
    const tiles = await run("list", { kind: "tile", query: "宝箱" });
    expect(tiles.code).toBe(0);
    expect(tiles.out).toContain("lib-tiles-interior#chest");
    expect((await run("list", { kind: "enemy", query: "dragon" })).out).toContain("mon-dragon-red");
    expect((await run("list", { kind: "nonsense" })).code).toBe(2);
  });

  it("adds assets with provenance and appends tile definitions without touching existing ones", async () => {
    const before = JSON.parse(await fs.readFile(path.join(dir, "tiles.json"), "utf8")) as { tiles: Array<{ code: string; index: number; atlas?: string }> };
    const result = await run("add", {}, ["lib-tiles-dungeon", "chr-knight", "mon-bat", "bg-night"]);
    expect(result.code, result.out).toBe(0);
    const assets = JSON.parse(await fs.readFile(path.join(dir, "assets.json"), "utf8")).assets as Array<Record<string, unknown>>;
    for (const id of ["lib-tiles-dungeon", "chr-knight", "mon-bat", "bg-night"]) {
      const entry = assets.find(a => a.id === id)!;
      expect(entry.origin).toBe("generated");
      expect(entry.sourceId).toBe("builtin-art");
      expect((await fs.stat(path.join(dir, entry.path as string))).size).toBe(entry.bytes);
    }
    expect(assets.find(a => a.id === "chr-knight")).toMatchObject({ columns: 4, rows: 4, frameOrder: [0, 1, 2, 3], kind: "character" });
    expect(assets.find(a => a.id === "mon-bat")).toMatchObject({ columns: 4, rows: 1, kind: "enemy" });
    const after = JSON.parse(await fs.readFile(path.join(dir, "tiles.json"), "utf8")) as typeof before;
    expect(after.tiles.slice(0, before.tiles.length)).toEqual(before.tiles);
    const added = after.tiles.slice(before.tiles.length);
    expect(added.length).toBe(SHEETS.find(s => s.id === "lib-tiles-dungeon")!.tiles.length);
    expect(added.every(t => t.atlas === "lib-tiles-dungeon")).toBe(true);
    expect(new Set(after.tiles.map(t => t.code)).size).toBe(after.tiles.length);
    const loaded = await loadProjectFromDisk(dir);
    expect(loaded.diagnostics).toEqual([]);

    // Re-running is idempotent; a subset of another sheet only adds those tiles.
    expect((await run("add", {}, ["lib-tiles-dungeon"])).out).toContain("SKIP");
    expect(JSON.parse(await fs.readFile(path.join(dir, "tiles.json"), "utf8")).tiles.length).toBe(after.tiles.length);
    expect((await run("add", { tiles: "tree,water" }, ["lib-tiles-field"])).code).toBe(0);
    expect(JSON.parse(await fs.readFile(path.join(dir, "tiles.json"), "utf8")).tiles.length).toBe(after.tiles.length + 2);
    expect((await run("add", {}, ["no-such-asset"])).code).toBe(1);
  });

  it("hands out tile codes that the format accepts", () => {
    const pool = codePool();
    expect(pool.length).toBeGreaterThan(300);
    expect(new Set(pool).size).toBe(pool.length);
    for (const c of pool) { expect(c.length).toBe(1); expect([" ", "\"", "\\"]).not.toContain(c); }
  });
});

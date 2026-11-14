import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProjectContent } from "../../schema/src/index";
import { REPO_ROOT } from "./build";
import { catalog, jsonSchemas } from "./catalog";
import { readProjectTexts } from "./load";

const sample = path.join(REPO_ROOT, "projects/sample-rpg");

describe("agent tooling", () => {
  it("committed JSON Schemas match the Zod definitions (run `pnpm rpg schema` after changing formats)", async () => {
    for (const [name, schema] of Object.entries(jsonSchemas())) {
      expect(await fs.readFile(path.join(REPO_ROOT, "schema", name), "utf8"), name).toBe(`${JSON.stringify(schema, null, 2)}\n`);
    }
  });

  it("catalog lists races, variables and rules", async () => {
    const content = loadProjectContent((await readProjectTexts(sample)).texts).content!;
    const text = catalog(content);
    expect(text).toContain("`dwarf` 小人");
    expect(text).toContain("`gold` 初期0");
    expect(text).toContain("veteran（on: auto）");
  });

  it("validation catches mistakes inside rules, expressions and traits", async () => {
    const { texts } = await readProjectTexts(sample);
    const db = JSON.parse(texts["database.json"]!);
    db.traits[0].abilities.push("no-such-ability");
    db.abilities[0].rules[0].effects.push({ type: "setVar", var: "mana", value: { add: [{ var: "manna" }, 1] } });
    db.abilities[0].rules[0].modify = { damage: 3 };
    const rules = JSON.parse(texts["rules.json"]!);
    rules.rules[0].when = { trait: "elf" };
    const result = loadProjectContent({ ...texts, "database.json": JSON.stringify(db), "rules.json": JSON.stringify(rules) });
    const lines = result.diagnostics.map(d => `${d.severity} ${d.file} › ${d.at}: ${d.message}`);
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringMatching(/^error database\.json › traits\[dwarf\]\.abilities\[2\]: 未定義の能力 'no-such-ability'/),
      expect.stringMatching(/^error database\.json › abilities\[unyielding-soul\]\.rules\[stand-firm\]\.effects\[1\]: 未宣言の変数 'mana'/),
      expect.stringMatching(/^error .*未宣言の変数 'manna'/),
      expect.stringMatching(/^warning database\.json › abilities\[unyielding-soul\]\.rules\[stand-firm\]: modify\.damage は/),
      expect.stringMatching(/^error rules\.json › rules\[monster-loot\]\.when: 未定義の特性 'elf'/),
    ]));
  });
});

describe("rpg new", () => {
  it("creates a blank project that validates, with an idea sheet", async () => {
    const { newProject } = await import("./scaffold");
    const os = await import("node:os");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rpg-new-"));
    try {
      const dir = await newProject("idea-lab", "発想の実験場", root);
      const loaded = loadProjectContent((await readProjectTexts(dir)).texts);
      expect(loaded.diagnostics.filter(d => d.severity === "error")).toEqual([]);
      expect(loaded.content?.project.title).toBe("発想の実験場");
      expect(await fs.readFile(path.join(dir, "IDEA.md"), "utf8")).toContain("常識から外れているところ");
      await expect(newProject("idea-lab", "x", root)).rejects.toThrow(/すでに/);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }, 30000);
});

describe("rpg mod", () => {
  it("lists, adds (with provenance) and exports mods", async () => {
    const { listMods, addMod, exportMod } = await import("./mods");
    const { newProject } = await import("./scaffold");
    const os = await import("node:os");
    const mods = await listMods();
    expect(mods.find(m => m.manifest?.id === "weather")?.errors).toEqual([]);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rpg-mod-"));
    try {
      const dir = await newProject("mod-test", "mod", root);
      const notes = await addMod("weather", dir, { today: "2026-11-14" });
      expect(notes.join()).toContain("weather");
      const project = JSON.parse(await fs.readFile(path.join(dir, "project.json"), "utf8"));
      expect(project.systems).toContainEqual({ id: "weather", path: "systems/mods/weather/index.ts", title: "天候（雨・雪・霧）（mod 1.0.0）" });
      const lock = JSON.parse(await fs.readFile(path.join(dir, "mods.json"), "utf8"));
      expect(lock.weather).toMatchObject({ version: "1.0.0", license: "MIT", addedAt: "2026-11-14" });
      expect(lock.weather.sha256).toMatch(/^[0-9a-f]{64}$/);
      await expect(addMod("weather", dir)).rejects.toThrow(/--force/);
      await addMod("weather", dir, { force: true });
      const out = await exportMod("weather", dir, { author: "テスト", license: "CC0-1.0", root: path.join(root, "mods") });
      expect(JSON.parse(await fs.readFile(path.join(out, "mod.json"), "utf8"))).toMatchObject({ id: "weather", license: "CC0-1.0", entry: "index.ts" });
      await expect(exportMod("weather", dir, { root: path.join(root, "mods") })).rejects.toThrow(/--author/);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }, 30000);
});

describe("@rpg/modules", () => {
  it("project systems can import the module kit", async () => {
    const { importSystemModule } = await import("./build");
    const os = await import("node:os");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rpg-kit-"));
    try {
      const file = path.join(dir, "mini.ts");
      await fs.writeFile(file, `import { defineSystem } from "@rpg/engine";\nimport { finish, pressed } from "@rpg/modules";\nexport default defineSystem({ id: "mini", scenes: { go: { start: (_c, a) => ({ onWin: [], onLose: [], held: pressed(["fire"], []), a }), input: (ctx, d) => finish(ctx, d as never, "win", "ok") } } });\n`);
      const mod = await importSystemModule(file) as { default: { id: string } };
      expect(mod.default.id).toBe("mini");
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }, 30000);
});

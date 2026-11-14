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

/**
 * `rpg new <id>`: an empty, valid project to grow an idea in. It borrows the sample's tiles, hero and sounds
 * (all original / generated, MIT) so the first build already plays; everything else starts blank on purpose.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./build";
import { MODULES } from "../../modules/src/index";
import { IDEA_TEMPLATE } from "./idea-template";
export { IDEA_TEMPLATE };

const SAMPLE = path.join(REPO_ROOT, "projects", "sample-rpg");
const BORROWED_ASSETS = new Set(["village-tiles", "adventurer", "sfx-cursor", "sfx-confirm", "sfx-cancel", "sfx-bump", "sfx-hit", "sfx-hurt", "sfx-heal", "sfx-encounter", "sfx-victory", "sfx-defeat", "sfx-door", "sfx-item", "sfx-save", "sfx-menu", "song-battle"]);

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export type ProjectTheme = "default" | "fantasy" | "mystery" | "scifi" | "minimal";

const THEMES: Record<ProjectTheme, { playerName: string; place: string; intro: (t: string) => string; stats: { maxHp: number; attack: number; defense: number } }> = {
  default: { playerName: "主人公", place: "はじまりの場所", intro: t => `${t}。ここから、まだ誰も遊んだことのないゲームが始まる。`, stats: { maxHp: 20, attack: 5, defense: 1 } },
  fantasy: { playerName: "見習い騎士", place: "緑の辺境村", intro: t => `${t}。剣と魔法の旅が、静かな辺境の村から幕を開ける。`, stats: { maxHp: 24, attack: 6, defense: 2 } },
  mystery: { playerName: "探偵助手", place: "霧の洋館前", intro: t => `${t}。古い洋館に残された謎を解くため、調査が始まった。`, stats: { maxHp: 18, attack: 4, defense: 1 } },
  scifi: { playerName: "航宙士", place: "軌道ステーション", intro: t => `${t}。未知の信号を追って、宇宙港のハッチが開く。`, stats: { maxHp: 22, attack: 5, defense: 2 } },
  minimal: { playerName: "主人公", place: "スタート地点", intro: t => `${t}。`, stats: { maxHp: 20, attack: 5, defense: 1 } },
};

export async function newProject(id: string, title: string, root = path.join(REPO_ROOT, "projects"), theme: ProjectTheme = "default"): Promise<string> {
  const preset = THEMES[theme] ?? THEMES.default;
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) throw new Error(`プロジェクトID '${id}' は英小文字・数字・ハイフン（2〜41文字）にしてください`);
  const dir = path.join(root, id);
  try { await fs.access(dir); throw new Error(`${path.relative(process.cwd(), dir)} はすでにあります`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  const sampleAssets = JSON.parse(await fs.readFile(path.join(SAMPLE, "assets.json"), "utf8")) as { formatVersion: number; assets: Array<{ id: string; path: string }> };
  const assets = sampleAssets.assets.filter(a => BORROWED_ASSETS.has(a.id));
  for (const asset of assets) {
    await fs.mkdir(path.dirname(path.join(dir, asset.path)), { recursive: true });
    await fs.copyFile(path.join(SAMPLE, asset.path), path.join(dir, asset.path));
  }
  // Tiles without the sample's story (its inspect texts and flag-gated passages refer to the sample's flags).
  const tileset = JSON.parse(await fs.readFile(path.join(SAMPLE, "tiles.json"), "utf8")) as { tiles: Array<Record<string, unknown>> };
  tileset.tiles = tileset.tiles.map(({ inspect: _inspect, passableWhen: _when, openIndex: _open, ...tile }) => tile);
  await fs.writeFile(path.join(dir, "tiles.json"), json(tileset));

  const width = 16, height = 12;
  const rows = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "T" : ".")).join(""));
  const files: Record<string, unknown> = {
    "project.json": {
      formatVersion: 2, id, title,
      engineCompatibility: { min: "0.7.0" },
      start: { mapId: "start", x: 7, y: 6, facing: "down" },
      player: { name: preset.playerName, sprite: "adventurer", stats: preset.stats, abilities: [], items: {}, traits: [] },
      // Levels from the start (remove "leveling" for a game without experience).
      leveling: { maxLevel: 30, base: 8, growth: 1.3, gains: { maxHp: 4, attack: 1, defense: 1 } },
      flags: {}, variables: {}, sets: {}, endings: {},
      verbs: {}, signals: {},
      intro: [{ type: "message", text: preset.intro(title) }],
      maps: [{ id: "start", path: "maps/start.json", title: preset.place }],
      tilesetPath: "tiles.json", dialoguesPath: "dialogues/dialogues.json", eventsPath: "events/events.json",
      databasePath: "database.json", rulesPath: "rules.json", assetsPath: "assets.json",
      systems: [],
      modules: Object.fromEntries(Object.keys(MODULES).map(id => [id, {}])),
      audio: { battle: "song-battle", victory: "sfx-victory", sfx: Object.fromEntries(["cursor", "confirm", "cancel", "bump", "hit", "hurt", "heal", "encounter", "victory", "defeat", "door", "item", "save", "menu"].map(cue => [cue, `sfx-${cue}`])) },
      credits: [`企画: ${title} の作者`, "タイル・主人公・効果音: RPGシステム工房 サンプル素材（MIT）"],
    },
    "maps/start.json": { formatVersion: 2, id: "start", title: preset.place, width, height, rows, npcs: [], portals: [], interactables: [], entities: [] },
    "dialogues/dialogues.json": { formatVersion: 2, dialogues: [] },
    "events/events.json": { formatVersion: 2, events: [] },
    "database.json": { formatVersion: 2, abilities: [], items: [], enemies: [], traits: [] },
    "rules.json": { formatVersion: 2, rules: [] },
    "assets.json": { formatVersion: sampleAssets.formatVersion, assets },
    "tests/start.scenario.json": { name: "始められる", seed: 1, steps: [{ advance: "all" }, { expect: { scene: "field", mapId: "start", at: { x: 7, y: 6 } } }] },
  };
  for (const [file, value] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), json(value));
  }
  await fs.mkdir(path.join(dir, "systems"), { recursive: true });
  await fs.writeFile(path.join(dir, "IDEA.md"), IDEA_TEMPLATE(title));
  await fs.writeFile(path.join(dir, "README.md"), `# ${title}\n\n発想は [IDEA.md](IDEA.md) に書きます。AIに頼むときは「IDEA.md の発想を形にして」と伝えてください（進め方: docs/idea-to-game.md）。\n\n\`\`\`sh\npnpm rpg test  --project projects/${id}\npnpm rpg build --project projects/${id}\n\`\`\`\n`);
  return dir;
}

/**
 * 段階別の見本 (roadmap 012): `rpg new <id> --stage 1|2|3` grows the blank project step by step, each stage small
 * enough to read in a few minutes, with its own scenario test:
 *   1 talk: a villager and a sign.   2 +fight: a slime in the grass, a herb, a chest (once).
 *   3 +quest: a second map through a gate that opens with a key the villager gives (flag), and an ending.
 */
export async function applyStage(dir: string, stage: number): Promise<void> {
  const read = async (f: string) => JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
  const write = async (f: string, v: unknown) => { await fs.mkdir(path.dirname(path.join(dir, f)), { recursive: true }); await fs.writeFile(path.join(dir, f), json(v)); };
  const project = await read("project.json"), map = await read("maps/start.json"), dialogues = await read("dialogues/dialogues.json"), events = await read("events/events.json"), db = await read("database.json");
  // Stage 1: someone to talk to, and a sign.
  map.npcs.push({ id: "villager", name: "村人", x: 5, y: 4, facing: "down", sprite: "adventurer", dialogues: [{ dialogue: "villager-hello" }] });
  dialogues.dialogues.push({ id: "villager-hello", speaker: "村人", lines: ["やあ、旅の人。", "東の草むらには魔物が出るから気をつけて。"], effects: [], choices: [] });
  map.interactables.push({ id: "sign", label: "看板", x: 9, y: 4, trigger: "action", marker: "sign", event: "read-sign" });
  events.events.push({ id: "read-sign", label: "看板", effects: [{ type: "message", text: "「ここは はじまりの村」" }], otherwise: [], once: false, afterDone: [] });
  await write("tests/stage1.scenario.json", { name: "段階1: 村人と話す・看板を読む", seed: 1, steps: [{ advance: "all" }, { effects: [{ type: "teleport", mapId: "start", x: 5, y: 5, facing: "up" }] }, { interact: true }, { expect: { textIncludes: "やあ、旅の人" } }, { advance: "all" }, { effects: [{ type: "teleport", mapId: "start", x: 9, y: 5, facing: "up" }] }, { interact: true }, { expect: { textIncludes: "はじまりの村" } }, { advance: "all" }] });
  if (stage >= 2) {
    db.items.push({ id: "herb", name: "薬草", description: "HPを10回復する。", heal: 10, price: 8, rules: [], key: false });
    db.enemies.push({ id: "slime", name: "スライム", tags: ["monster"], stats: { maxHp: 8, attack: 3, defense: 0 }, actions: [{ name: "体当たり", power: 1, effects: [] }], drops: [{ item: "herb", count: 1 }], rules: [], canFlee: true, resist: {}, immune: [] });
    project.player.items = { herb: 1 };
    map.encounters = { rate: 0.1, enemies: ["slime"], tiles: [] };
    map.interactables.push({ id: "chest", label: "宝箱", x: 12, y: 8, trigger: "action", marker: "chest", event: "open-chest" });
    events.events.push({ id: "open-chest", label: "宝箱", effects: [{ type: "giveItem", item: "herb", count: 2 }, { type: "message", text: "宝箱に薬草が2つ入っていた。" }], otherwise: [], once: true, afterDone: [{ type: "message", text: "空っぽだ。" }] });
    await write("tests/stage2.scenario.json", { name: "段階2: 宝箱は一度だけ・スライムに勝つと薬草", seed: 2, steps: [{ advance: "all" }, { effects: [{ type: "teleport", mapId: "start", x: 12, y: 9, facing: "up" }] }, { interact: true }, { advance: "all" }, { expect: { items: { herb: 3 } } }, { interact: true }, { expect: { textIncludes: "空っぽ" } }, { advance: "all" }, { expect: { items: { herb: 3 } } }, { effects: [{ type: "battle", enemy: "slime" }] }, { fight: "auto" }, { advance: "all" }, { expect: { scene: "field" } }] });
  }
  if (stage >= 3) {
    project.flags = { ...project.flags, "has-key": { initial: false, description: "村人から門の鍵をもらった" } };
    project.endings = { ...project.endings, "garden-end": { title: "庭にたどり着いた", text: "門の向こうには、静かな庭が広がっていた。" } };
    project.maps.push({ id: "garden", path: "maps/garden.json", title: "門の向こうの庭" });
    const width = 10, height = 8;
    await write("maps/garden.json", { formatVersion: 2, id: "garden", title: "門の向こうの庭", width, height, rows: Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "T" : ".")).join("")), npcs: [], portals: [{ id: "garden-back", x: 1, y: 4, targetMapId: "start", targetX: 13, targetY: 5 }], interactables: [{ id: "flower", label: "花", x: 6, y: 3, trigger: "action", marker: "sparkle", event: "the-end" }], entities: [] });
    map.portals.push({ id: "gate", x: 14, y: 5, targetMapId: "garden", targetX: 2, targetY: 4, when: { flag: "has-key" } });
    map.interactables.push({ id: "locked-gate", label: "門", x: 14, y: 4, trigger: "action", marker: "statue", event: "gate-check" });
    events.events.push({ id: "gate-check", label: "門", when: { flag: "has-key" }, effects: [{ type: "message", text: "鍵が合った。門は開いている（右下のマスから入れる）。" }], otherwise: [{ type: "message", text: "門には鍵がかかっている。村人が何か知っているかも。" }], once: false, afterDone: [] });
    events.events.push({ id: "the-end", label: "花", effects: [{ type: "message", text: "見たことのない花が咲いている。" }, { type: "ending", ending: "garden-end" }], otherwise: [], once: false, afterDone: [] });
    const hello = dialogues.dialogues.find((d: { id: string }) => d.id === "villager-hello");
    hello.choices = [{ id: "ask-gate", label: "門のことを聞く", effects: [{ type: "setFlag", flag: "has-key" }, { type: "message", text: "これが門の鍵だ。持っていくといい。" }], once: true }, { id: "bye", label: "またね", effects: [], once: false }];
    // Talking to the villager now ends in a choice: the stage-1 test says goodbye.
    await write("tests/stage1.scenario.json", { name: "段階1: 村人と話す・看板を読む", seed: 1, steps: [{ advance: "all" }, { effects: [{ type: "teleport", mapId: "start", x: 5, y: 5, facing: "up" }] }, { interact: true }, { expect: { textIncludes: "やあ、旅の人" } }, { advance: "all" }, { choose: "bye" }, { advance: "all" }, { effects: [{ type: "teleport", mapId: "start", x: 9, y: 5, facing: "up" }] }, { interact: true }, { expect: { textIncludes: "はじまりの村" } }, { advance: "all" }] });
    // The gate column must be walkable for the portal.
    map.rows = map.rows.map((r: string, y: number) => (y === 5 ? `${r.slice(0, 14)}.${r.slice(15)}` : r));
    await write("tests/stage3.scenario.json", { name: "段階3: 鍵をもらって門の向こうへ、花でエンディング", seed: 3, steps: [{ advance: "all" }, { effects: [{ type: "teleport", mapId: "start", x: 5, y: 5, facing: "up" }] }, { interact: true }, { advance: "all" }, { choose: "ask-gate" }, { advance: "all" }, { expect: { flags: { "has-key": true } } }, { effects: [{ type: "teleport", mapId: "start", x: 13, y: 5, facing: "right" }] }, { move: "right" }, { expect: { mapId: "garden" } }, { effects: [{ type: "teleport", mapId: "garden", x: 6, y: 4, facing: "up" }] }, { interact: true }, { advance: "once" }, { expect: { scene: "ending" } }] });
  }
  await write("project.json", project); await write("maps/start.json", map); await write("dialogues/dialogues.json", dialogues); await write("events/events.json", events); await write("database.json", db);
}

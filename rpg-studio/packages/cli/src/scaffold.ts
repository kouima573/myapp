/**
 * `rpg new <id>`: an empty, valid project to grow an idea in. It borrows the sample's tiles, hero and sounds
 * (all original / generated, MIT) so the first build already plays; everything else starts blank on purpose.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./build";

const SAMPLE = path.join(REPO_ROOT, "projects", "sample-rpg");
const BORROWED_ASSETS = new Set(["village-tiles", "adventurer", "sfx-cursor", "sfx-confirm", "sfx-cancel", "sfx-bump", "sfx-hit", "sfx-hurt", "sfx-heal", "sfx-encounter", "sfx-victory", "sfx-defeat", "sfx-door", "sfx-item", "sfx-save", "sfx-menu", "song-battle"]);

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export const IDEA_TEMPLATE = (title: string) => `# 発想シート — ${title}

> このファイルが、このゲームの「正本の発想」です。AI（Codex / Claude Code）は作業の前に必ず読み、
> 発想を削ったり、ありがちな形に置き換えたりせずに形にします。足りない仕組みは作ります。
> 書けるところだけで構いません。空欄はAIが質問するか、案を出して確認します。

## ひとことで

（例: 「言葉を覚えるほど世界の地図が書き換わるRPG」「主人公は魔王の城そのもの」）

## 遊んだ人に残したい体験・感情

## 常識から外れているところ（ここが核。守ってほしい）

## 借りてきたいもの（他のゲーム・映画・遊び・現実の仕組みのコンセプト）

※ 名前・キャラクター・絵・音楽・ステージなど、既存作品そのものは持ち込まず、仕組みや感覚だけを借ります。

## ありえない組み合わせ

## 最初に遊べる最小の形（10分で遊べるもの）

## プレイヤーができること（動詞）

（例: 耳を澄ます、名前を呼ぶ、時間を巻き戻す、記憶を手放す、敵に憑依する）

## 世界のルール（いつ・何が起きるか）

## 勝ち・負け・終わり方

## 迷ったときの優先順位

1. この発想の核
2. 遊んで面白いこと
3. 作りやすさ

## AIへのメモ・決めたこと（AIが追記）

-
`;

export async function newProject(id: string, title: string, root = path.join(REPO_ROOT, "projects")): Promise<string> {
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
      player: { name: "主人公", sprite: "adventurer", stats: { maxHp: 20, attack: 5, defense: 1 }, abilities: [], items: {}, traits: [] },
      flags: {}, variables: {}, sets: {}, endings: {},
      verbs: {}, signals: {},
      intro: [{ type: "message", text: `${title}。ここから、まだ誰も遊んだことのないゲームが始まる。` }],
      maps: [{ id: "start", path: "maps/start.json", title: "はじまりの場所" }],
      tilesetPath: "tiles.json", dialoguesPath: "dialogues/dialogues.json", eventsPath: "events/events.json",
      databasePath: "database.json", rulesPath: "rules.json", assetsPath: "assets.json",
      systems: [],
      modules: { novel: {}, puzzle: {}, shooter: {}, planner: {}, cards: {} },
      audio: { battle: "song-battle", victory: "sfx-victory", sfx: Object.fromEntries(["cursor", "confirm", "cancel", "bump", "hit", "hurt", "heal", "encounter", "victory", "defeat", "door", "item", "save", "menu"].map(cue => [cue, `sfx-${cue}`])) },
      credits: [`企画: ${title} の作者`, "タイル・主人公・効果音: RPGシステム工房 サンプル素材（MIT）"],
    },
    "maps/start.json": { formatVersion: 2, id: "start", title: "はじまりの場所", width, height, rows, npcs: [], portals: [], interactables: [], entities: [] },
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

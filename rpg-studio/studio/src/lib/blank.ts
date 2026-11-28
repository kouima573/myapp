/**
 * ブラウザ版用の空のRPGデータ土台。実行に必要な主人公・空マップ1枚だけを作り、物語・NPC・イベントは置かない。
 * 独自コードや追加モジュールは含めず、これらが必要な場合はローカル工房で続きを作る。
 */
import { IDEA_TEMPLATE } from "../../../packages/cli/src/idea-template";

const fmt = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

export function blankProject(sample: Record<string, string>, opts: { id: string; title: string }): Record<string, string> {
  const project = JSON.parse(sample["project.json"]!) as Record<string, unknown>;
  const width = 16, height = 12;
  const rows = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "T" : ".")).join(""));
  const next: Record<string, unknown> = {
    ...project,
    id: opts.id,
    title: opts.title,
    start: { mapId: "start", x: 7, y: 7, facing: "down" },
    player: { name: "主人公", sprite: (project.player as { sprite?: string } | undefined)?.sprite ?? "adventurer", stats: { maxHp: 20, attack: 5, defense: 2 }, abilities: [], items: {}, traits: [] },
    flags: {}, variables: {}, sets: {}, endings: {}, verbs: {}, signals: {},
    intro: [],
    maps: [{ id: "start", path: "maps/start.json", title: "空の舞台" }],
    systems: [], modules: {},
    audio: {},
    credits: ["企画・データ: （あなたの名前）", "絵・音: RPGシステム工房の内蔵素材（オリジナル）"],
    titleScreen: { enabled: true, subtitle: "" },
    // 自分の作品は「共有用のひな形」ではない（外部の素材・AIで作った曲も入れられるように）
    assetPolicy: { ...((project.assetPolicy as Record<string, unknown> | undefined) ?? {}), shareable: false },
  };
  const out: Record<string, string> = {
    "project.json": fmt(next),
    "maps/start.json": fmt({ formatVersion: 2, id: "start", title: "空の舞台", width, height, rows, npcs: [], portals: [], interactables: [], entities: [] }),
    [String(project.dialoguesPath ?? "dialogues/dialogues.json")]: fmt({ formatVersion: 2, dialogues: [] }),
    [String(project.eventsPath ?? "events/events.json")]: fmt({ formatVersion: 2, events: [] }),
    [String(project.databasePath ?? "database.json")]: fmt({ formatVersion: 2, abilities: [], items: [], enemies: [], traits: [] }),
    "IDEA.md": IDEA_TEMPLATE(opts.title),
  };
  if (project.rulesPath) out[String(project.rulesPath)] = fmt({ formatVersion: 2, rules: [] });
  // 見本のタイル・絵・効果音の一覧は借りる（画像と音は見本のものを使う）。曲は借りない（音楽画面の「おまかせ作曲」などで自分の曲を入れる）
  const assetsPath = String(project.assetsPath ?? "assets.json"), tilesPath = String(project.tilesetPath ?? "tiles.json");
  if (sample[assetsPath] !== undefined) {
    const manifest = JSON.parse(sample[assetsPath]!) as { assets: Array<{ kind?: string }> };
    manifest.assets = manifest.assets.filter(a => a.kind !== "song" && a.kind !== "bgm");
    out[assetsPath] = fmt(manifest);
  }
  if (sample[tilesPath] !== undefined) {
    // 見本のゲーム固有の仕掛け（条件で通れる・調べると何か起きる）は外して、ただのタイルにする
    const tileset = JSON.parse(sample[tilesPath]!) as { tiles: Array<Record<string, unknown>> };
    tileset.tiles = tileset.tiles.map(({ passableWhen: _p, inspect: _i, openIndex: _o, ...tile }) => tile);
    out[tilesPath] = fmt(tileset);
  }
  return out;
}

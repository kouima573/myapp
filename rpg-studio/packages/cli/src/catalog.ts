import { z } from "zod";
import {
  ArtRequestBundleSchema, AssetManifestSchema, DatabaseSchema, SongSchema, DialogueBundleSchema, EventBundleSchema, GameMapSchema, ProjectManifestSchema, RuleBundleSchema, TilesetSchema,
  type GameContent, type Rule,
} from "../../schema/src/index";
import { ScenarioSchema } from "../../engine/src/scenario";

/** JSON Schemas for editors and agents (generated from the Zod definitions — never edit by hand). */
export function jsonSchemas(): Record<string, unknown> {
  const opts = { io: "input", unrepresentable: "any" } as const;
  return {
    "project.schema.json": z.toJSONSchema(ProjectManifestSchema, opts),
    "tiles.schema.json": z.toJSONSchema(TilesetSchema, opts),
    "map.schema.json": z.toJSONSchema(GameMapSchema, opts),
    "dialogues.schema.json": z.toJSONSchema(DialogueBundleSchema, opts),
    "events.schema.json": z.toJSONSchema(EventBundleSchema, opts),
    "database.schema.json": z.toJSONSchema(DatabaseSchema, opts),
    "rules.schema.json": z.toJSONSchema(RuleBundleSchema, opts),
    "assets.schema.json": z.toJSONSchema(AssetManifestSchema, opts),
    "scenario.schema.json": z.toJSONSchema(ScenarioSchema, opts),
    "song.schema.json": z.toJSONSchema(SongSchema, opts),
    "art-requests.schema.json": z.toJSONSchema(ArtRequestBundleSchema, opts),
  };
}

/** Human / agent readable index of everything a project defines. */
export function catalog(content: GameContent): string {
  const { project, database: db } = content;
  const out: string[] = [];
  const h = (title: string) => out.push("", `## ${title}`);
  const ruleLine = (r: Rule) => `${r.id}（on: ${r.on}${r.once ? `, once: ${r.once}` : ""}${r.chance !== undefined ? ", 確率あり" : ""}）${r.description ? ` — ${r.description}` : ""}`;
  out.push(`# ${project.title} (${project.id})`, "", `開始: ${project.start.mapId} (${project.start.x}, ${project.start.y})　主人公: ${project.player.name}　基本能力: HP${project.player.stats.maxHp} 攻${project.player.stats.attack} 防${project.player.stats.defense}`);
  h("フラグ (flags)");
  for (const [id, d] of Object.entries(project.flags)) out.push(`- \`${id}\` 初期${d.initial}${d.description ? ` — ${d.description}` : ""}`);
  h("変数 (variables)");
  for (const [id, d] of Object.entries(project.variables)) out.push(`- \`${id}\` 初期${d.initial}${d.min !== undefined ? ` 最小${d.min}` : ""}${d.max !== undefined ? ` 最大${d.max}` : ""}${d.label ? ` 表示名「${d.label}」` : ""}${d.hud ? " HUD" : ""}${d.description ? ` — ${d.description}` : ""}`);
  h("特性 (traits)");
  const byCategory = new Map<string, typeof db.traits>();
  for (const t of db.traits) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
  for (const [category, list] of byCategory) {
    out.push(`- **${category}**`);
    for (const t of list) out.push(`  - \`${t.id}\` ${t.name}: 能力 [${t.abilities.join(", ")}]${t.statMods ? ` 補正 ${JSON.stringify(t.statMods)}` : ""}${t.rules.length ? ` ルール ${t.rules.map(r => r.id).join(", ")}` : ""}`);
  }
  h("能力 (abilities)");
  for (const a of db.abilities) out.push(`- \`${a.id}\` ${a.name}（${a.kind}${a.use ? `・使用: ${a.use.where}` : ""}）${a.description ? ` — ${a.description}` : ""}${a.rules.length ? `\n  - ルール: ${a.rules.map(ruleLine).join(" / ")}` : ""}`);
  h("アイテム (items)");
  for (const i of db.items) out.push(`- \`${i.id}\` ${i.name}${i.key ? "（大事なもの）" : ""}${i.heal ? ` 回復${i.heal}` : ""}${i.use ? " 使用可" : ""}${i.statMods ? ` 補正 ${JSON.stringify(i.statMods)}` : ""}`);
  h("敵 (enemies)");
  for (const e of db.enemies) out.push(`- \`${e.id}\` ${e.name} HP${e.stats.maxHp} 攻${e.stats.attack} 防${e.stats.defense} タグ[${e.tags.join(", ")}] 行動: ${e.actions.map(a => `${a.name}(${a.power})${a.when ? "*" : ""}`).join(" → ")}`);
  h("全体ルール (rules)");
  for (const r of content.rules) out.push(`- ${ruleLine(r)}`);
  h("マップ (maps)");
  for (const ref of project.maps) {
    const m = content.maps[ref.id]!;
    out.push(`- \`${m.id}\` ${m.title} ${m.width}×${m.height}　NPC: ${m.npcs.map(n => `${n.id}(${n.x},${n.y})`).join(" ") || "なし"}　出入口: ${m.portals.map(p => `${p.id}→${p.targetMapId}`).join(" ") || "なし"}　仕掛け: ${m.interactables.map(i => `${i.id}[${i.event}](${i.x},${i.y})`).join(" ") || "なし"}${m.overlays.length ? `　地形変化 ${m.overlays.length}` : ""}${m.encounters ? `　エンカウント ${Math.round(m.encounters.rate * 100)}%` : ""}`);
  }
  h("イベント (events)");
  for (const e of Object.values(content.events)) out.push(`- \`${e.id}\` ${e.label}${e.once ? "（1回）" : ""}`);
  h("会話 (dialogues)");
  for (const d of Object.values(content.dialogues)) out.push(`- \`${d.id}\` ${d.speaker}${d.choices.length ? ` 選択肢: ${d.choices.map(c => c.id).join(", ")}` : ""}`);
  h("タイル (tiles)");
  out.push(content.tileset.tiles.map(t => `\`${t.code}\`${t.name}${t.passable ? "" : t.passableWhen ? "(条件)" : "(×)"}`).join(" "));
  h("動詞（プレイヤーがメニュー・キーで使う自作の行動。on: verb のルールで受ける）");
  for (const [id, v] of Object.entries(project.verbs)) out.push(`- \`${id}\` ${v.label}${v.key ? ` [${v.key}]` : ""}${v.when ? "（条件つき）" : ""}${v.known ? "" : "（learnVerb で覚える）"}${v.target ? `　対象: ${v.target.from === "set" ? `集合 ${v.target.set}` : v.target.from === "items" ? "持ち物" : v.target.options.map(o => o.id).join("/")}` : ""}${v.description ? ` — ${v.description}` : ""}`);
  h("シグナル（自作のイベント。{ \"type\": \"signal\" } で発信、on: signal のルールで受ける）");
  for (const [id, d] of Object.entries(project.signals)) out.push(`- \`${id}\`${d.description ? ` — ${d.description}` : ""}`);
  h("ジャンルモジュール");
  out.push(Object.keys(project.modules).map(id => `\`${id}\``).join(" ") || "なし");
  h("独自システム (systems)");
  for (const s of project.systems) out.push(`- \`${s.id}\` ${s.path} — ${s.title}`);
  return `${out.join("\n")}\n`;
}

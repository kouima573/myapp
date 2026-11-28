/**
 * 素材パック: ゲームではなく「キャラクターだけ」「音楽だけ」「タイルだけ」のような素材集として書き出す。
 * 自作・内蔵ジェネレーター製など、素材のまま配ってよいもの（assetRights の pack が ok）だけを入れ、
 * README・ライセンス・出どころ（CREDITS.md）・機械が読める一覧（pack.json）を添える。
 * 純粋関数: ファイルの中身は呼び出し側（CLI はディスク、工房はブラウザ）が読み、ZIP にする。
 */
import type { AssetEntry, ProjectManifest, Tileset } from "./formats";
import { assetRights, type AssetRights } from "./rights";

export type PackLicense = "cc0" | "cc-by-4.0" | "terms";
export interface AssetPackOptions {
  id: string;
  title: string;
  author: string;
  description?: string;
  license: PackLicense;
  /** For license "terms": the creator's own terms of use (利用規約). A template is in PACK_TERMS_TEMPLATE. */
  terms?: string;
  /** Sold (true) or given away. Selling needs every file to be the creator's own or explicitly allowed. */
  paid?: boolean;
}

export const PACK_LICENSE_LABEL: Record<PackLicense, string> = {
  "cc0": "CC0 1.0（パブリックドメイン相当。表記不要・何にでも使える）",
  "cc-by-4.0": "CC BY 4.0（作者名の表記があれば商用・改変・再配布も可）",
  "terms": "独自の利用規約（素材集の販売でよく使われる形）",
};

export const PACK_TERMS_TEMPLATE = `# 利用規約

- 個人・法人、商用・非商用を問わず、ゲーム・動画・配信などの作品に組み込んで使えます。
- 加工・改変してかまいません。
- クレジット表記は任意です（表記する場合: 作者名と素材パック名）。
- 素材そのもの（加工したものを含む）の再配布・転売・素材集への収録はできません。
- 公序良俗に反する用途、作者や第三者の名誉を傷つける用途には使わないでください。
- この素材を使ったことによる損害について、作者は責任を負いません。
- 規約は予告なく変わることがあります。購入・入手時点の規約が適用されます。
`;

const FOLDER: Record<AssetEntry["kind"], string> = {
  tileset: "tilesets", character: "characters", enemy: "enemies", animation: "animations", portrait: "portraits",
  background: "backgrounds", bgm: "bgm", sfx: "sfx", song: "songs", font: "fonts",
};
const KIND_LABEL: Record<AssetEntry["kind"], string> = {
  tileset: "タイル", character: "キャラクター（歩行）", enemy: "敵・モンスター", animation: "アニメーション", portrait: "顔グラフィック・立ち絵",
  background: "背景", bgm: "BGM", sfx: "効果音", song: "楽譜BGM（RPGシステム工房の形式）", font: "フォント",
};

export interface PackFile { name: string; source: { assetPath: string } | { text: string } }
export interface AssetPackPlan { files: PackFile[]; included: AssetRights[]; refused: AssetRights[]; problems: string[] }

const baseName = (p: string) => p.split("/").pop()!;

function gridText(a: AssetEntry): string {
  const parts: string[] = [];
  if (a.tileWidth && a.tileHeight) parts.push(`1コマ ${a.tileWidth}×${a.tileHeight}px`);
  if (a.columns && a.rows) parts.push(`${a.columns}列×${a.rows}行`);
  if (a.frameDurationMs) parts.push(`${a.frameDurationMs}ms/コマ`);
  if (a.loop !== undefined && (a.kind === "bgm" || a.kind === "sfx")) parts.push(a.loop ? "ループ" : "1回再生");
  return parts.join("・");
}

function licenseText(o: AssetPackOptions): string {
  if (o.license === "cc0") return `${o.title} — ${o.author}\n\nこの素材パックの素材は CC0 1.0 Universal（パブリックドメイン相当）で提供します。\nクレジット表記は不要で、商用・改変・再配布を含め自由に使えます。\nhttps://creativecommons.org/publicdomain/zero/1.0/deed.ja\n`;
  if (o.license === "cc-by-4.0") return `${o.title} — ${o.author}\n\nこの素材パックの素材は クリエイティブ・コモンズ 表示 4.0 国際（CC BY 4.0）で提供します。\n作者名の表記（例: 「${o.title}」${o.author}, CC BY 4.0）をすれば、商用・改変・再配布を含めて使えます。\nhttps://creativecommons.org/licenses/by/4.0/deed.ja\n`;
  return `${o.title} — ${o.author}\n\n${(o.terms ?? PACK_TERMS_TEMPLATE).trim()}\n`;
}

/** Which files go into the pack, and the README / LICENSE / CREDITS / pack.json texts. */
export function planAssetPack(project: Pick<ProjectManifest, "assetPolicy">, assets: AssetEntry[], selectedIds: string[], options: AssetPackOptions, tileset?: Tileset): AssetPackPlan {
  const problems: string[] = [];
  if (!options.title.trim()) problems.push("パックの名前を入れてください");
  if (!options.author.trim()) problems.push("作者名（ハンドルネーム可）を入れてください");
  if (options.license === "terms" && options.terms !== undefined && !options.terms.trim()) problems.push("利用規約の本文が空です");
  const selected = assets.filter(a => selectedIds.includes(a.id));
  const missing = selectedIds.filter(id => !assets.some(a => a.id === id));
  if (missing.length) problems.push(`素材がありません: ${missing.join(", ")}`);
  if (!selected.length) problems.push("パックに入れる素材を選んでください");
  const rights = assetRights(project, selected);
  const included = rights.filter(r => r.pack === "ok");
  const refused = rights.filter(r => r.pack !== "ok");
  for (const r of refused) problems.push(`${r.id}: ${r.packReason}`);

  const root = options.id;
  const files: PackFile[] = [];
  const used = new Set<string>();
  const entries = included.map(r => {
    const a = selected.find(x => x.id === r.id)!;
    let name = `${FOLDER[a.kind]}/${baseName(a.path)}`;
    for (let i = 2; used.has(name); i++) name = `${FOLDER[a.kind]}/${a.id}-${i}-${baseName(a.path)}`;
    used.add(name);
    files.push({ name: `${root}/${name}`, source: { assetPath: a.path } });
    return { a, name };
  });
  // Tile definitions travel with the tileset image (names, passability, animation frames).
  if (tileset) for (const { a, name } of entries) {
    if (a.kind !== "tileset") continue;
    const tiles = tileset.tiles.filter(t => (t.atlas ?? tileset.atlas) === a.id);
    if (tiles.length) files.push({ name: `${root}/${name.replace(/\.[a-z0-9]+$/i, "")}.tiles.json`, source: { text: `${JSON.stringify({ image: baseName(name), tileWidth: a.tileWidth, tileHeight: a.tileHeight, columns: a.columns, tiles: tiles.map(t => ({ code: t.code, name: t.name, index: t.index, passable: t.passable })) }, null, 2)}\n` } });
  }

  const byKind = new Map<string, typeof entries>();
  for (const e of entries) byKind.set(KIND_LABEL[e.a.kind], [...(byKind.get(KIND_LABEL[e.a.kind]) ?? []), e]);
  const contents = [...byKind].map(([label, list]) => `### ${label}\n${list.map(({ a, name }) => `- \`${name}\`${gridText(a) ? `（${gridText(a)}）` : ""}`).join("\n")}`).join("\n\n");
  const has = (...kinds: AssetEntry["kind"][]) => entries.some(e => kinds.includes(e.a.kind));
  const usage = [
    ...(has("character", "enemy", "animation") ? ["キャラクター・敵・アニメーションは、1枚の画像にコマが並んだ「スプライトシート」（PNG）です。上の「1コマ」の大きさで区切って使います。"] : []),
    ...(has("tileset") ? ["タイルは PNG で、\`*.tiles.json\` に各タイルの名前・番号・通れるかどうかが入っています。"] : []),
    ...(has("background", "portrait") ? ["背景・立ち絵は PNG です。"] : []),
    ...(has("bgm", "sfx") ? ["音は元のファイル形式（OGG・MP3・WAV など）のままです。"] : []),
    ...(has("song") ? ["楽譜BGM（\`songs/*.song.json\`）は RPGシステム工房の形式です。工房に取り込むとそのまま鳴らせます。"] : []),
    ...(has("font") ? ["フォントは元の形式のままです。"] : []),
    "\`pack.json\` に全ファイルの一覧と大きさの情報があります（ツールで読み込む用）。",
  ];
  const readme = `# ${options.title}

作者: ${options.author}
ライセンス: ${PACK_LICENSE_LABEL[options.license]} — 詳しくは LICENSE.txt
${options.description?.trim() ? `\n${options.description.trim()}\n` : ""}
## 収録内容（${entries.length}点）

${contents}

## 使い方

${usage.map(u => `- ${u}`).join("\n")}

## 出どころ

すべて作者による自作、または RPGシステム工房の内蔵ジェネレーター（MIT License）で作ったオリジナル素材です。第三者の素材は含みません。各ファイルの記録は CREDITS.md にあります。
`;
  const credits = `# ${options.title} — 出どころの記録\n\n| ファイル | 種類 | 出どころ | 記録 |\n| --- | --- | --- | --- |\n${entries.map(({ a, name }) => `| ${name} | ${KIND_LABEL[a.kind]} | ${a.origin === "original" ? "自作" : "内蔵ジェネレーター（MIT）"} | ${a.generator ? Object.entries(a.generator).map(([k, v]) => `${k}=${String(v)}`).join(", ") : (a.notes ?? "")} |`).join("\n")}\n\nMade with RPGシステム工房（MIT License, © 2026 AI人狼ラボ）\n`;
  const manifest = { formatVersion: 1, title: options.title, author: options.author, license: options.license, paid: Boolean(options.paid), items: entries.map(({ a, name }) => ({ id: a.id, kind: a.kind, file: name, mimeType: a.mimeType, tileWidth: a.tileWidth, tileHeight: a.tileHeight, columns: a.columns, rows: a.rows, frameDurationMs: a.frameDurationMs, frameOrder: a.frameOrder, loop: a.loop })) };
  files.push(
    { name: `${root}/README.md`, source: { text: readme } },
    { name: `${root}/LICENSE.txt`, source: { text: licenseText(options) } },
    { name: `${root}/CREDITS.md`, source: { text: credits } },
    { name: `${root}/pack.json`, source: { text: `${JSON.stringify(manifest, null, 2)}\n` } },
  );
  return { files, included, refused, problems };
}

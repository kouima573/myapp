import type { AssetEntry, GameContent } from "../../schema/src/formats";

const KIND_LABEL: Record<AssetEntry["kind"], string> = {
  tileset: "タイル", character: "キャラクター", enemy: "敵", animation: "アニメーション", portrait: "立ち絵", background: "背景", bgm: "BGM", sfx: "効果音", song: "BGM", font: "フォント",
};

/** The engine bundled into every built game is MIT licensed: its notice has to travel with the game. */
export const ENGINE_COPYRIGHT = "Copyright (c) 2026 AI人狼ラボ";
export const ENGINE_BANNER = `/*! RPGシステム工房 engine — MIT License — ${ENGINE_COPYRIGHT}. See CREDITS.md. */`;
export const ENGINE_LICENSE_TEXT = `MIT License

${ENGINE_COPYRIGHT}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
/** Section appended to every CREDITS.md a build writes (RPG games, independent works, browser exports). */
export const ENGINE_CREDITS_SECTION = `## エンジンのライセンス

このゲームは RPGシステム工房（MIT License）で作られており、エンジンのプログラムを含みます。ゲーム自体の権利は作者にあります。

\`\`\`
${ENGINE_LICENSE_TEXT}\`\`\`
`;

/** Credits shown in the game menu and written to CREDITS.md by the build. */
export function creditLines(content: GameContent): string[] {
  const lines = [...content.project.credits];
  const groups = new Map<string, Set<string>>();
  for (const asset of content.assets.assets) {
    const text = asset.credit ?? (asset.origin !== "original" && asset.origin !== "generated" && asset.author ? asset.author : undefined);
    if (!text) continue;
    const label = KIND_LABEL[asset.kind];
    if (!groups.has(label)) groups.set(label, new Set());
    groups.get(label)!.add(text);
  }
  for (const [label, names] of groups) lines.push(`${label}: ${[...names].join(" ／ ")}`);
  const generated = content.assets.assets.filter(a => a.origin === "generated").map(a => KIND_LABEL[a.kind]);
  if (generated.length) lines.push(`${[...new Set(generated)].join("・")}の一部はオリジナル生成`);
  if (content.assets.assets.some(a => !a.redistributable || a.sourceId === "dova-syndrome")) {
    lines.push("利用規約: 収録されている素材ファイルを抽出し、ゲームとは別の用途で利用・転用・再配布することを禁止します。利用者は本規約を遵守してください。");
  }
  lines.push("Made with RPGシステム工房（MIT License, © 2026 AI人狼ラボ）");
  return lines;
}

/** Credits plus the provenance of every bundled asset, shipped next to the game. */
export function creditsMarkdown(content: GameContent): string {
  const rows = content.assets.assets.map(a => `| ${a.id} | ${a.kind} | ${a.origin} | ${a.author ?? ""} | ${a.license} | ${a.url ?? a.sourceId ?? a.source} | ${a.termsCheckedAt ?? ""} |`);
  return `# ${content.project.title} — クレジット\n\n${creditLines(content).map(l => `- ${l}`).join("\n")}\n\n## 素材一覧\n\n| ID | 種類 | 出どころ | 作者 | 規約・ライセンス | 入手元 | 規約確認日 |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n\n${ENGINE_CREDITS_SECTION}`;
}

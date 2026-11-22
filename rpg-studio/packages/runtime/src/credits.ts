import type { AssetEntry, GameContent } from "../../schema/src/formats";

const KIND_LABEL: Record<AssetEntry["kind"], string> = {
  tileset: "タイル", character: "キャラクター", enemy: "敵", animation: "アニメーション", portrait: "立ち絵", background: "背景", bgm: "BGM", sfx: "効果音", song: "BGM",
};

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
  lines.push("Made with RPGシステム工房");
  return lines;
}

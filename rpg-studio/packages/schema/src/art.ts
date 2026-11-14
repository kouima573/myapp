import type { ArtRequest } from "./formats";

/** Builds the full generation / search brief for an art request (style guide included). */
export function artPrompt(request: ArtRequest, styleGuide: string): string {
  const s = request.spec;
  return [
    `# 依頼: ${request.title}（${request.kind}）`,
    request.purpose && `用途: ${request.purpose}`,
    `内容: ${request.description}`,
    `画像仕様: PNG${s.transparent ? "（背景透過）" : ""}、1セル ${s.cellWidth}×${s.cellHeight}px、${s.columns}列×${s.rows}行（全体 ${s.cellWidth * s.columns}×${s.cellHeight * s.rows}px）、余白・間隔なし`,
    s.layout && `配置: ${s.layout}`,
    request.mustHave.length ? `必須: ${request.mustHave.join(" / ")}` : "",
    request.avoid.length ? `避ける: ${request.avoid.join(" / ")}` : "",
    request.userNotes && `作り手の要望: ${request.userNotes}`,
    "既存のゲーム・作品・特定の作家の画風やキャラクターを模写しないこと。文字・ロゴ・透かしを入れないこと。",
    "",
    "## スタイルガイド",
    styleGuide.trim(),
  ].filter(line => line !== "").join("\n");
}

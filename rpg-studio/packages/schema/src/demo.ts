/**
 * 体験版: 完成版のデータから、project.demo.endWhen が成り立った時点で終わるゲームを作る（書き出すときだけの変換）。
 * 自動ルール（on: "auto"）で「体験版はここまで」のエンディングへ。タイトルに（体験版）を付ける。
 */
import type { GameContent } from "./formats";

export const DEMO_ENDING_ID = "demo-end";

export function demoContent(content: GameContent): GameContent {
  const demo = content.project.demo;
  if (!demo) throw new Error("project.json に demo（体験版の終わる条件 endWhen）がありません");
  return {
    ...content,
    project: {
      ...content.project,
      title: `${content.project.title}（体験版）`,
      endings: { ...content.project.endings, [DEMO_ENDING_ID]: { title: demo.title, text: demo.text } },
    },
    rules: [...content.rules, { id: DEMO_ENDING_ID, on: "auto", when: demo.endWhen, repeat: false, priority: 1000, effects: [{ type: "ending", ending: DEMO_ENDING_ID }], description: "体験版の終わり（書き出し時に追加）" }],
  };
}

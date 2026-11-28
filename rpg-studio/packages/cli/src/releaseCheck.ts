/**
 * 販売前チェック（公開・販売の前に1か所で）: 検証・自動テスト・エンディングまでのテスト・書きかけの文章・文章の点検・
 * 素材の権利（売ってよいか）・クレジット・エンジンのライセンス表記。
 * 純粋関数（工房とCLIで共用）。自動テストの結果は呼び出し側が実行して渡す。
 */
import { assetRights, type Diagnostic, type GameContent } from "../../schema/src/index";
import { proofreadProjectTexts, shownTexts } from "./proofreadText";

export type ReleaseStatus = "ok" | "warn" | "block" | "todo";
export interface ReleaseItem { id: string; label: string; status: ReleaseStatus; details: string[] }
export interface ReleaseReport { verdict: "ready" | "warn" | "blocked"; items: ReleaseItem[] }

/** Words that usually mean "not written yet". */
const PLACEHOLDER = /TODO|FIXME|XXX|（仮）|\(仮\)|仮タイトル|仮の(台詞|セリフ|文)|あとで(書|直|決)|ここに.{0,8}(書|入れ)|〇〇|○○|ダミー/;

export function releaseChecklist(input: {
  content: GameContent | null;
  texts: Record<string, string>;
  diagnostics: Diagnostic[];
  /** Results of tests/*.scenario.json, or undefined when they were not run. */
  tests?: Array<{ file: string; ok: boolean; message?: string }>;
}): ReleaseReport {
  const items: ReleaseItem[] = [];
  const errors = input.diagnostics.filter(d => d.severity === "error");
  const warnings = input.diagnostics.filter(d => d.severity === "warning");
  items.push({ id: "validate", label: "データの検証", status: errors.length ? "block" : warnings.length ? "warn" : "ok",
    details: [...errors, ...warnings].slice(0, 8).map(d => `${d.severity === "error" ? "エラー" : "注意"}: ${d.file}${d.at ? ` › ${d.at}` : ""} — ${d.message}`) });

  if (!input.tests) items.push({ id: "tests", label: "自動テスト", status: "todo", details: ["まだ実行していません"] });
  else {
    const failed = input.tests.filter(t => !t.ok);
    items.push({ id: "tests", label: "自動テスト", status: failed.length ? "block" : input.tests.length ? "ok" : "warn",
      details: failed.length ? failed.map(t => `${t.file}: ${t.message ?? "失敗"}`) : input.tests.length ? [`${input.tests.length}件すべて通過`] : ["tests/*.scenario.json がありません。最後まで遊べることを確かめるテストがあると安心です"] });
  }

  const content = input.content;
  if (content) {
    const endings = Object.keys(content.project.endings ?? {});
    const scenarioText = Object.entries(input.texts).filter(([f]) => f.startsWith("tests/") && f.endsWith(".scenario.json")).map(([, t]) => t).join("\n");
    const reachesEnding = /"ending"/.test(scenarioText);
    items.push({ id: "endings", label: "エンディングまで遊べるか", status: !endings.length ? "ok" : reachesEnding ? "ok" : "warn",
      details: !endings.length ? ["エンディングの定義はありません（終わり方は作品の自由です）"] : reachesEnding ? ["エンディングに着く自動テストがあります"] : [`エンディング（${endings.join(", ")}）に着く自動テストがありません`] });

    const leftovers = shownTexts(input.texts).filter(t => PLACEHOLDER.test(t.text));
    items.push({ id: "placeholders", label: "書きかけの文章", status: leftovers.length ? "warn" : "ok",
      details: leftovers.slice(0, 8).map(t => `${t.file} › ${t.at}: 「${t.text.length > 40 ? `${t.text.slice(0, 38)}…` : t.text}」`) });

    const proof = proofreadProjectTexts(input.texts, { width: 40, lines: 3 });
    items.push({ id: "proofread", label: "文章の点検（長さ・誤字らしき所）", status: proof.length ? "warn" : "ok",
      details: proof.slice(0, 8).map(p => `${p.file} › ${p.at}: ${p.message}`) });

    const rights = assetRights(content.project, content.assets.assets);
    const blocked = rights.filter(r => r.sell === "block"), unsure = rights.filter(r => r.sell === "check");
    items.push({ id: "rights", label: "素材の権利（このゲームを売ってよいか）", status: blocked.length ? "block" : unsure.length ? "warn" : "ok",
      details: [...blocked, ...unsure].slice(0, 10).map(r => `${r.sell === "block" ? "不可" : "要確認"}: ${r.id} — ${r.sellReason}`).concat(!blocked.length && !unsure.length ? [`${rights.length}件すべて商用可（自作・内蔵生成・規約確認済み）`] : []) });

    const noCredit = content.assets.assets.filter(a => a.creditRequired && !a.credit?.trim());
    items.push({ id: "credits", label: "クレジット表記", status: noCredit.length ? "block" : "ok",
      details: noCredit.length ? noCredit.map(a => `${a.id}: 表記が必要ですが credit が空です`) : ["必要な表記はそろっています（ゲームのクレジット画面と CREDITS.md に自動で入ります）"] });
  }
  items.push({ id: "license", label: "工房のライセンス表記", status: "ok", details: ["書き出したゲームの CREDITS.md に、エンジン（RPGシステム工房・MIT）の表記が自動で入ります"] });

  const verdict = items.some(i => i.status === "block") ? "blocked" : items.some(i => i.status === "warn" || i.status === "todo") ? "warn" : "ready";
  return { verdict, items };
}

export const RELEASE_MARK: Record<ReleaseStatus, string> = { ok: "OK  ", warn: "注意", block: "不可", todo: "未実行" };

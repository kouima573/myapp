/**
 * 権利の判定: 素材ごとに「このゲームを売ってよいか（sell）」と「素材のまま配る・売る（素材パック）ことができるか（pack）」。
 * ok = 問題なし / check = 人が規約を読んで assets.json に commercial を記録するまで保留 / block = できない。
 * 取得元カタログの分類は二次情報なので、外部素材は「人が規約を読んだ記録（termsCheckedAt・commercial）」を優先する。
 */
import type { AssetEntry, AssetSource, ProjectManifest } from "./formats";
import { sourcesFor } from "./sources";

export type RightsStatus = "ok" | "check" | "block";
export interface AssetRights { id: string; kind: AssetEntry["kind"]; path: string; sell: RightsStatus; sellReason: string; pack: RightsStatus; packReason: string }

const BUILTIN = /^builtin-/;

export function assetRights(project: Pick<ProjectManifest, "assetPolicy">, assets: AssetEntry[]): AssetRights[] {
  const sources = sourcesFor(project);
  return assets.map(asset => {
    const source: AssetSource | undefined = asset.sourceId ? sources.find(s => s.id === asset.sourceId) : undefined;
    const base = { id: asset.id, kind: asset.kind, path: asset.path };
    if (asset.origin === "original") return { ...base, sell: "ok", sellReason: "自作", pack: "ok", packReason: "自作" };
    if (asset.origin === "generated" && source && BUILTIN.test(source.id)) return { ...base, sell: "ok", sellReason: "内蔵ジェネレーターによるオリジナル（MIT）", pack: "ok", packReason: "内蔵ジェネレーターによるオリジナル（MIT）" };

    // Selling a game that contains it.
    let sell: RightsStatus, sellReason: string;
    if (asset.commercial === false) { sell = "block"; sellReason = "この素材は商用不可と記録されています"; }
    else if (asset.commercial === true) { sell = "ok"; sellReason = "規約を読んで商用可と記録済み"; }
    else if (!source) { sell = "check"; sellReason = asset.origin === "generated" ? "生成に使ったツール・サービスの規約で商用可か確認してください" : "取得元が記録されていません"; }
    else if (source.commercial === "allowed") { sell = asset.termsCheckedAt ? "ok" : "check"; sellReason = asset.termsCheckedAt ? `「${source.name}」は商用可（規約確認 ${asset.termsCheckedAt}）` : `「${source.name}」は商用可とされますが、規約を読んだ日（termsCheckedAt）がありません`; }
    else if (source.commercial === "prohibited") { sell = "block"; sellReason = `「${source.name}」の素材はこの使い方では商用不可とされています`; }
    else { sell = "check"; sellReason = `「${source.name}」は素材ごとに条件が違います。規約を読んで assets.json の commercial に true / false を記録してください`; }

    // Giving away / selling the raw file as part of an asset pack.
    let pack: RightsStatus = "block", packReason = "他の人の素材は、素材のまま配ったり売ったりできないのが普通です";
    if (asset.redistributable && source?.redistribution === "allowed" && sell !== "block") {
      pack = sell === "ok" ? "ok" : "check";
      packReason = `「${source.name}」は再配布可とされています（ライセンスと表記の条件をパックにも引き継いでください）`;
    } else if (!asset.redistributable) packReason = "この素材は再配布不可（redistributable: false）と記録されています";
    else if (asset.origin === "generated") packReason = "生成に使ったツール・サービスの規約で、素材のまま配れるか確認できていません（内蔵ジェネレーター製は入れられます）";
    else if (source?.redistribution === "prohibited") packReason = `「${source.name}」は素材そのものの再配布が禁止とされています`;
    return { ...base, sell, sellReason, pack, packReason };
  });
}

export function worst(statuses: RightsStatus[]): RightsStatus {
  return statuses.includes("block") ? "block" : statuses.includes("check") ? "check" : "ok";
}

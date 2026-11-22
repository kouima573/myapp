/** 用語集 (roadmap 010): words used in the studio and the docs, explained plainly. Also used for hover tooltips. */
export const GLOSSARY: Array<{ term: string; also?: string[]; text: string }> = [
  { term: "フラグ", text: "ON か OFF だけを覚える印。「長老と話した」「扉が開いた」など。project.json の flags で宣言します。" },
  { term: "変数", text: "数を覚える箱。お金・好感度・回数など。project.json の variables で宣言します。" },
  { term: "効果", also: ["effects"], text: "起きること1つ1つ。メッセージを出す・アイテムを渡す・フラグを立てる・戦闘を始める…を並べて書きます。" },
  { term: "条件", also: ["when"], text: "「〜のときだけ」。フラグ・変数・持ち物・能力などで決めます。" },
  { term: "イベント", text: "名前のついた効果のまとまり。仕掛けや会話から呼びます。「一度だけ」も選べます。" },
  { term: "エンティティ", text: "状態で姿や動きが変わる人や物（扉・宝箱・歩き回る人）。マップに置きます。" },
  { term: "仕掛け", also: ["interactables"], text: "調べたり触れたりするとイベントが起きるマス（看板・宝箱・スイッチ）。" },
  { term: "出入口", also: ["portals"], text: "踏むと別のマップ（や同じマップの別の場所）へ移るマス。" },
  { term: "領域", also: ["regions"], text: "マップの四角い範囲。入る・出る・歩く・調べるときに効果を起こせます。" },
  { term: "ルール", also: ["rules"], text: "「〜したとき、〜なら、〜する」をいつも見張る決まり。ダメージを変える・歩くたびに回復する、など。" },
  { term: "特性", also: ["traits"], text: "主人公が持つ性質（種族・職業・呪い）。能力値・技・ルールをまとめて付けられます。" },
  { term: "能力", also: ["abilities", "技"], text: "技や魔法。戦闘や移動中に使えるもの、持っているだけで効くものがあります。" },
  { term: "MP", text: "魔法などに使うポイント。最大値を設定したゲームだけ表示され、技の使用や回復効果で増減します。" },
  { term: "SP", text: "技に使うポイント。最大値を設定したゲームだけ表示され、技の使用や回復効果で増減します。" },
  { term: "シナリオテスト", also: ["自動テスト", "自動プレイテスト"], text: "決めた手順で自動で遊び、結果を確かめるテスト。tests/*.scenario.json。壊れたらすぐ分かります。" },
  { term: "検証", also: ["validate"], text: "データの書き間違い（ないIDを指している・数の範囲外など）を見つけるチェック。" },
  { term: "ビルド", also: ["build"], text: "遊べるゲーム（HTML一式）を作ること。Webに置けばだれでも遊べます。" },
  { term: "モジュール", also: ["ジャンルモジュール"], text: "ノベル・パズル・弾幕など、RPGの中に組み込める別ジャンルの場面。" },
  { term: "スクリプト", text: "データで書けない処理を書くコード（scripts/*.ts）。技や敵などに付けます。" },
  { term: "タイル", also: ["tiles"], text: "マップを作る1マス分の絵。1文字の記号で並べます。" },
  { term: "オートタイル", text: "塗るだけで角や辺が自動でつながるタイル（道・水辺・絨毯）。" },
  { term: "レイヤー", also: ["層"], text: "地面の上に重ねる層。キャラの頭上に描く屋根や木の葉もここ。" },
  { term: "スキルボード", text: "六角形のパネルを、覚えたパネルの隣から開いていく育成。レベルアップでポイントが入ります。" },
  { term: "素材", also: ["assets"], text: "絵や音。出どころ・ライセンスを assets.json に記録します。" },
];

export function glossaryLookup(label: string): string | undefined {
  for (const g of GLOSSARY) if (label.includes(g.term) || g.also?.some(a => label.includes(a))) return `${g.term}: ${g.text}`;
  return undefined;
}

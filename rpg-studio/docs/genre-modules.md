# ジャンルモジュール — RPGに他ジャンルを織り込む

作れるゲームは**RPGだけ**です。そのうえで、ノベル・パズル・シューティング・育成・カードゲームなど**他ジャンルの遊びを、RPGの一場面や戦闘のやり方として組み込めます**。各モジュールが返す結果（勝った・解けた・選んだ・育った）は、RPGの能力値・アイテム・フラグ・集合・エンディングにそのままつながります。

```
RPGの土台（マップ・会話・能力値・アイテム・フラグ・周回・セーブ）
 ├─ ノベル      … 物語の場面を立ち絵と背景で語る。選択で手がかり・好感度・フラグが変わる
 ├─ パズル      … 祠や仕掛けを解く。解けたらアイテム・通路・フラグ
 ├─ 育成シミュ  … 修行・経営・学園生活の期間を過ごす。能力値と変数が育つ
 ├─ シューティング … ボス戦を弾幕で戦う。攻撃力・防御力・HPがそのまま効く
 └─ カードバトル … 戦闘をデッキ構築で戦う。攻撃力でカードが強くなる
```

## 有効にする

`project.json` の `modules` に使うモジュールを書きます（書いていないモジュールを参照すると検証エラー）。

```json
"modules": { "novel": {}, "puzzle": {}, "shooter": {}, "planner": {}, "cards": {} }
```

使い方は2通りです。

| 使い方 | データ | 向いているジャンル |
| --- | --- | --- |
| **場面として開く** | 効果 `{ "type": "startScene", "system": "novel", "scene": "play", "args": { … } }` | ノベル、パズル、育成、ミニゲーム |
| **戦闘のやり方を差し替える** | 敵に `"battle": { "mode": "shooter.battle", "args": { … } }`、または効果 `{ "type": "battle", "enemy": "…", "mode": "cards.battle", "args": { … } }` | シューティング、カードバトル、リズム戦闘など |

戦闘モードでも、勝利・敗北・逃走は通常の戦闘と同じように処理されます（戦利品、`onVictory` / `onDefeat`、敗北ルール、`victory` / `defeat` トリガー、シンボルエンカウントの消滅）。`"mode": "builtin"` で通常のコマンド戦闘に戻せます。

モジュールの引数は `rpg validate` / 工房の検証で**モジュール自身が検査**します（パズル盤面の記号数、ノベルのジャンプ先ラベル、育成の行動定義など）。引数の中に書いた効果や条件（`onSolve`、`effects`、`when`…）も、通常のデータと同じく参照チェックされます。

## novel — ノベル（`novel.play`）

| 引数 | 内容 |
| --- | --- |
| `bg` | 最初の背景（素材ID） |
| `script[]` | 行の配列。`speaker`・`text`（`{{var.x}}` などの埋め込み可）・`portrait`（素材ID、`"none"` で消す）・`pos`（left/center/right）・`bg`・`when`（条件を満たさない行は飛ばす）・`effects`（表示した時に適用）・`choices[]`（`label`・`when`・`effects`・`jump`）・`label`・`jump`・`end` |
| `onEnd` | 終わった後の効果 |
| `skippable` | キャンセルで飛ばせるか（既定 true） |

```json
{ "type": "startScene", "system": "novel", "scene": "play", "args": { "script": [
  { "speaker": "長老オババ", "portrait": "village-elder", "pos": "left", "text": "石板の印は、どの順だったかのう……" },
  { "text": "", "choices": [
    { "label": "星では？", "effects": [{ "type": "addToSet", "set": "clues", "value": "rune-order" }], "jump": "star" },
    { "label": "わかりません", "jump": "end" } ] },
  { "label": "star", "speaker": "長老オババ", "text": "そうじゃ、星・月・太陽じゃ。" },
  { "label": "end", "text": "", "end": true } ] } }
```

## puzzle — ブロック押しパズル（`puzzle.push`）

盤面は文字列で書きます: `#` 壁、`.` 目標、`$` ブロック、`*` 目標上のブロック、`@` 自分、`+` 目標上の自分、空白か `_` が床。

| 引数 | 内容 |
| --- | --- |
| `title`・`hint` | 見出しと最初に出す一言 |
| `rows` | 盤面 |
| `maxMoves` | 手数の上限（0 = なし） |
| `onSolve` / `onGiveUp` | 解いた時・やめた時の効果 |

操作: 矢印で移動・押す、決定で一手戻す、キャンセルでやめる（画面のボタンでやり直しも可）。AIに盤面を作らせたら、**解き方を `tests/*.scenario.json` に `sceneInput` で書いて**、本当に解けることを確かめてください（サンプルの `genre-modules.scenario.json` 参照）。

## planner — 育成・経営シミュ（`planner.schedule`）

期間（日・週・季節…）ごとに行動を1つ選び、その効果がすぐ能力値・変数・所持品に反映されます。

| 引数 | 内容 |
| --- | --- |
| `title`・`turns`・`turnLabel`（`{{turn}}` `{{turns}}` が置換される） | 期間 |
| `activities[]` | `id`・`label`・`description`・`when`（選べる条件）・`effects`・`text`（記録に出す一言。効果の後の値で埋め込まれる） |
| `onTurnEnd` | 毎ターン後の効果（疲労、維持費、季節の移り変わり） |
| `onEnd` | 最後のターン後の効果（結果発表、エンディング、フラグ） |
| `show` | 右側に表示する変数 |
| `showStats`・`cancelable` | 能力値の表示、途中でやめられるか |

育成の「結果」は `onEnd` の `if` で分岐させます（例: `skill` が2以上なら攻撃力+1、5以上なら技を習得、所持金が足りなければ店がつぶれる…）。

## shooter — 弾幕シューティング戦闘（`shooter.battle`、リアルタイム）

| 引数 | 内容 |
| --- | --- |
| `hpScale` | 敵HPの倍率（弾が何発も当たるため） |
| `phases[]` | `untilHpPercent`（敵HPがこの%を上回る間）と `patterns[]` |
| `patterns[]` | `type`（`ring` 全方位 / `aimed` 自機狙い / `spiral` 渦 / `rain` 降る弾）・`count`・`speed`・`every`（何フレームごと）・`spread`・`power`・`radius` |
| `playerSpeed`・`invincible` | 自機の速さ、被弾後の無敵フレーム |
| `canFlee` | 逃げられるか |

主人公の攻撃力が弾の威力、防御力が被弾ダメージ、HPが残機になります。操作: 矢印/WASD 移動、Z・Enter・Space 撃つ、Shift 低速、Esc 逃げる（スマホは画面のボタン）。

自動テストでは `{ "frames": 3000, "hold": ["fire"] }` のように**押しっぱなしのボタンとフレーム数**で戦えます。シミュレーションは種つき乱数で決定的なので、同じ入力なら必ず同じ結果になります。

## cards — デッキ構築カードバトル（`cards.battle`）

| 引数 | 内容 |
| --- | --- |
| `cards[]` | `id`・`label`・`cost`・`damage`・`scaleWithAttack`（攻撃力を足す）・`block`・`heal`・`draw`・`energy`・`text` |
| `deck[]` | `{ "card": "strike", "count": 5 }` の並び |
| `handSize`・`energy`・`hpScale`・`canFlee` | 手札枚数、1ターンのエネルギー、敵HP倍率、逃走可否 |

敵の行動は RPG の `actions` を順番に使い、次の行動が予告表示されます（`power` 0 の行動は「様子見」）。操作: ←→ 選ぶ、決定 使う、↓ ターン終了、キャンセル 逃げる。

## 新しいジャンルモジュールを作る（AIに頼む）

上の5つは出発点です。ジャンルは**プロジェクトの `systems/*.ts` に `defineSystem` で自由に追加**できます。組み込みモジュールと同じ仕組みです（`packages/modules/src/` が見本）。

```ts
export default defineSystem({
  id: "rhythm",
  scenes: {
    battle: {
      realtime: { fps: 60 },                      // リアルタイム: 毎フレーム input({type:"frame", held}) が呼ばれる
      checkArgs: args => [],                      // 引数の検査（rpg validate・工房で表示）
      start(ctx, args) { return { … }; },         // 初期データ（JSON）。args.enemyId に戦う敵
      input(ctx, data, input) {                   // 純粋関数。Math.random() や時刻は使わない
        return { data: next, outcome: "victory" }; // 戦闘モードは outcome で決着（victory / defeat / fled）
      },
      draw(ctx2d, view) { … },                    // Canvasに描く（リアルタイム）
      render(host, view) { … },                   // またはDOMで描く（ターン制）
    },
  },
});
```

- 場面の途中で能力値・フラグを変えたいときは `apply`（すぐ適用）、閉じた後の処理は `effects`。
- 戦闘モードでは `ctx.state.scene.battle` に RPG 側の戦闘情報（敵・HP）があります。
- 必ず `tests/*.scenario.json` で `sceneInput` / `sceneInputs` / `frames` を使ってクリアできることを確かめる。

### まだない、組み込めそうなジャンルの例

| ジャンル | RPGとのつなぎ方 |
| --- | --- |
| リズム | ボス戦を音楽に合わせた入力で。楽譜BGM（`song`）のテンポと同期 |
| 農業・生活 | 季節ごとの畑仕事（planner の発展）。収穫物がアイテム・料理の材料に |
| クラフト・料理 | 素材の組み合わせ表で装備や回復薬。レシピは集合で覚える |
| タクティクス | 小さな盤面での陣取り戦闘。仲間はエンティティとして参加 |
| ローグライク | 手続き生成のダンジョン（`setTile` を大量に返すアクション）と一回きりの命（周回） |
| 恋愛・関係シミュ | 好感度変数×ノベル。エンディング分岐 |
| タワーディフェンス | 村の防衛戦。設置できる罠は手に入れたアイテムで決まる |
| 推理ボード | 集めた手がかり（集合）を線でつなぐ画面。正しくつなぐとフラグ |
| 釣り・ミニゲーム | タイミング入力。釣果がアイテムに |
| 経営 | 店の仕入れと価格決め。所持金と評判（変数）が育つ |

組み合わせることもできます。たとえば「ノベルで依頼を受ける → パズルで遺跡を開ける → 弾幕でボスを倒す → 育成で次の季節に備える → 周回で記憶を持ち越す」という一つのRPGが、データだけで書けます。

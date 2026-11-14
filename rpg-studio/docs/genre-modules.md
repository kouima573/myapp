# ジャンルモジュール — RPGに他ジャンルを織り込む

> どのジャンルをどう作るかの一覧（111ジャンル）は [genre-atlas.md](genre-atlas.md)（`pnpm rpg genres --query <言葉>`）。全モジュールを遊べる見本は `projects/genre-gallery`。

作れるゲームは**RPGだけ**です。そのうえで、ノベル・パズル・シューティング・育成・カード・アクション・タクティクス・マッチ3・リズム・脱出・推理・レース・クイズなど**他ジャンルの遊びを、RPGの一場面や戦闘のやり方として組み込めます**。各モジュールが返す結果（勝った・解けた・選んだ・育った）は、RPGの能力値・アイテム・フラグ・集合・エンディングにそのままつながります。

```
RPGの土台（マップ・会話・能力値・アイテム・フラグ・周回・セーブ）
 ├─ ノベル      … 物語の場面を立ち絵と背景で語る。選択で手がかり・好感度・フラグが変わる
 ├─ パズル      … 祠や仕掛けを解く。解けたらアイテム・通路・フラグ
 ├─ 育成シミュ  … 修行・経営・学園生活の期間を過ごす。能力値と変数が育つ
 ├─ シューティング … ボス戦を弾幕で戦う。攻撃力・防御力・HPがそのまま効く
 ├─ カードバトル … 戦闘をデッキ構築で戦う。攻撃力でカードが強くなる
 ├─ アクション  … 横スクロール／見下ろしのステージ。足場・敵・ボス・湧き出し・生存
 ├─ タクティクス … マス目で仲間と陣取り戦。全滅・ボス・到達・防衛
 ├─ マッチ3     … 石をそろえて攻撃・回復・採集・得点
 ├─ リズム      … 4レーンの譜面。儀式・演奏・リズム戦闘
 ├─ 部屋（脱出） … ポイント＆クリックで調べ、アイテムを使い、抜け出す
 ├─ 推理        … 証言の矛盾に証拠をつきつけ、真相を選ぶ
 ├─ ランナー    … レーン移動とジャンプで障害物を避け、ライバルと競う
 └─ クイズ      … 選択式・入力式の問い。合言葉、試験、問答バトル
```

## 有効にする

`project.json` の `modules` に使うモジュールを書きます（書いていないモジュールを参照すると検証エラー）。

```json
"modules": { "novel": {}, "puzzle": {}, "shooter": {}, "planner": {}, "cards": {}, "action": {}, "tactics": {}, "match3": {}, "rhythm": {}, "room": {}, "deduce": {}, "runner": {}, "quiz": {}, "fighter": {}, "defense": {}, "blocks": {}, "logic": {}, "physics": {}, "aim": {}, "dungeon3d": {}, "squad": {}, "table": {}, "composer": {}, "program": {}, "factory": {} }
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

## 場面にも戦闘にも使えるモジュール（v0.8）

以下の8つは、**場面として開く**ときは勝ち負けで `onWin` / `onLose`（やめた時も onLose）を実行し、**戦闘モード**のときはRPGの戦闘として勝敗がつきます。どれも主人公のHP・攻撃力・防御力をそのまま使い、終わったHPは主人公に戻ります。`canFlee` で途中でやめられるか（逃げられるか）を決めます。

### action — アクションステージ（`action.stage`、リアルタイム）

| 引数 | 内容 |
| --- | --- |
| `view` | `side`（重力・ジャンプ。プラットフォーマー）／`top`（見下ろし8方向。アクションRPG・ハクスラ・サバイバー系） |
| `rows` | `#` 壁・地面、`^` トゲ、`*` コイン、`G` ゴール、`@` 開始、`w` 歩く敵、`f` 飛ぶ敵、`c` 追う敵、`t` 撃つ砲台、`s` 湧き出し口、`B` ボス（戦闘モードではRPGの敵、HP×`hpScale`） |
| `goal` | `exit`（Gに着く）・`defeat`（敵／ボスを倒す、`kills` で数指定）・`collect`（コイン全部）・`survive`（`seconds` 秒生き残る） |
| `seconds`・`autoAttack`・`enemyHp`・`enemyDamage`・`enemySpeed`・`spawnEvery`・`playerSpeed`・`jump`・`gravity` | 制限時間、自動攻撃、敵の強さ、湧く間隔、操作感 |

操作: ←→（見下ろしは↑↓も）移動、↑ ジャンプ（横）、Z 攻撃、Shift ダッシュ、Esc やめる。穴に落ちると最大HPの1/4を失って開始位置へ。

### tactics — タクティクス（`tactics.battle`）

| 引数 | 内容 |
| --- | --- |
| `rows` | `#` 壁、`~` 水（歩けないが攻撃は届く）、`G` ゴール、`@` 主人公、`a` 仲間（`allies` の順）、`e` 敵（`enemy` の能力、戦闘モードではRPGの敵）、`B` ボス |
| `goal`・`turns` | `rout` 全滅・`boss` ボス撃破・`reach` 主人公がGへ・`survive` N ターン防衛（`turns` は他の目的では制限ターン） |
| `allies`・`enemy`・`heroMove`・`heroRange` | 仲間と敵の能力（name・hp・attack・defense・move・range・sprite）、主人公の移動力と射程 |

操作: 味方を選ぶ → 移動先 → 攻撃する相手（キャンセルで待機）。全員動くと敵の番。敵は近づいて、届く相手のうち一番弱い者を狙う。

### match3 — マッチ3（`match3.battle`）

`gems`（id・label・color・`effect`: attack / heal / shield / score / var・`amount`・`var`）、`width`・`height`、場面では `moves` 手以内に `target` 点、戦闘では `enemyEvery` 手ごとに敵が攻撃。`effect: "var"` の石はそろえるたびにRPGの変数へ加算（採集・素材集めに）。連鎖でボーナス。

### rhythm — リズム（`rhythm.play`、リアルタイム）

`chart` は1行4文字（`x` ノーツ、`.` 休み、左から ← ↓ ↑ →）。`bpm`・`stepsPerBeat`（1拍あたりの行数）・`leadIn`・`pass`（場面での合格％）・`click`（音源なしでもノーツの音を鳴らす）。戦闘では当てれば攻撃、外すと被弾し、譜面はくり返す。

### room — ポイント＆クリック（`room.explore`）

`rooms[]`（id・title・`bg` 素材・`color`・`text`・`hotspots[]`）。場所は `x`・`y`・`w`・`h`（％）、`when`・`hidden`（隠し物）・`text`・`effects`・`needs`（RPGのアイテムを選んで使う）・`consume`・`lockedText`・`goto`（別の部屋）・`exit`（出口＝成功）・`once`。

### deduce — 推理（`deduce.case`）

`evidence[]`（id・label・text・`when`：RPGで手がかりを集めると現れる）、`statements[]`（speaker・text・`contradiction` 崩す証拠・`press` 問いただした返事・`broken`）、`question`（prompt・options・answer）、`lives`。

### runner — ランナー・レース（`runner.race`、リアルタイム）

`lanes`・`length`（区間数）・`track`（1行＝1区間、`.` 空き `#` 障害物 `*` コイン `+` ブースト。空なら `density` で自動生成）・`speed`・`rivals`（name・speed）・`place`（必要な順位）・`seconds`・`hitDamage`。操作: ←→ レーン、Z/↑ ジャンプ、↓ 減速。

### quiz — クイズ・なぞなぞ（`quiz.ask`）

`questions[]`（`q`・`choices`（選択式）・`answer`（番号、または入力式の正解リスト。全角半角・カタカナ/ひらがなは区別しない）・`explain`・`onCorrect`）、`pass`。戦闘では正解で攻撃、不正解で被弾。

## さらに12種と、アクションの拡張（v0.9）

ジャンル地図で「拡張で作る」だったジャンルを、すべて組み込みにしました。どれも場面・戦闘モードの両方で使えます（`onWin` / `onLose`、`canFlee`）。

### action の追加引数

| 引数 | 内容 |
| --- | --- |
| `weapon` | `sword`（前方を斬る）／`gun`（狙いの方向に撃つ。押しっぱなしで連射）— ランアンドガン、ツインスティック |
| `aim` | `move`（歩く方向を狙う）／`lock`（Shift を押す間は狙いを固定して動ける） |
| 見張り `g` | 巡回し、進む方向の扇形（`sight` ピクセル、壁でさえぎられる）を見る。`seen`: `alarm`（見張りが追ってくる）／`lose`（見つかったら失敗）— ステルス |

### fighter — 格闘（`fighter.duel` / `fighter.versus`、リアルタイム）

`opponent`（name・hp・attack・defense。戦闘モードではRPGの敵 × `hpScale`）、`heroScale`（主人公のHP倍率）、`seconds`、`level`（CPUの強さ 1〜5）。上段（Z）・下段（↓+Z）・気弾（↓→Z、ゲージ50）・ガード（Shift）・ジャンプ・コンボ・削り。`versus` は同じキーボードで2人対戦（1P: WASD + F 攻撃 + G ガード、2P: 矢印 + Enter/. 攻撃 + / ガード）。

### defense — タワーディフェンス（`defense.siege`、リアルタイム）

`rows`（`S` 出現、`H` 拠点、`=` 道、`.` 建設地、`#` 景色）、`towers`（id・label・cost・range・damage・rate・`slow`・`splash`）、`waves`（count・hp・speed・every・reward）、`gold`、`lives`（0 = 主人公のHP）、`pause`。操作: 矢印でカーソル、Z で建てる・強化（Lv3まで）、Shift で塔の種類、クリックでも建てられる。

### blocks — 落ちもの（`blocks.drop`、リアルタイム）

`clear`（`groups`: 同じ色4つ以上がつながると消え、残りが落ちて連鎖／`rows`: 横一列）、`pieces`（形をマスの座標で）、`colors`、`width`・`height`、`speed`、`target`、`seconds`。戦闘では消すたびに攻撃、`junkEvery` 秒ごとにおじゃま列。

### logic — ロジックパズル（`logic.solve`）

`kind`: `picture`（`solution` に # と . で絵を描くと、行・列の手がかりが自動で付く。`mistakes` で間違いの上限）、`lights`（`start` の 1/0。押したマスと上下左右が反転）、`numbers`（`givens` の数字と .、`box` で太枠）。

### physics — 物理ショット（`physics.shot`、リアルタイム）

`view`（`top`: 転がる・摩擦／`side`: 重力・放物線）、`rows`（`#` 壁、`o` 球、`O` カップ、`*` 的、`~` 水＝1打罰）、`goal`（`hole` / `targets`）、`shots`、`gravity`・`friction`・`bounce`・`maxPower`、`players: 2`（交互に打って打数を競う）。操作: ←→ 向き、↑↓ 力、Z 打つ、狙う場所のクリックでも打てる。

### aim — 射撃（`aim.shoot`、リアルタイム）

`targets`（at 秒・x/y ％・`kind`: foe / friend / bonus・stay 秒。空なら `count` 個を自動生成）、`rail`（奥から迫る）、`need`、`ammo`、`damage`。照準は矢印かクリック、Shift で装填。

### dungeon3d — 疑似3Dダンジョン（`dungeon3d.explore`、リアルタイム）

`rows`（`#` 壁、`@` 開始、`G` 出口、`*` 宝、`e` 敵、`B` ボス）、`facing`、`move`（`grid`: 1マス移動と90度回転／`free`: 自由に歩いて照準の先を攻撃）、`goal`（exit / defeat / collect）、`enemyHp`・`enemyDamage`、`wallColor`。ミニマップつき。

### squad — 部隊戦（`squad.command` / `squad.auto`、リアルタイム）

`rows`（`@` 主人公、`a` 味方、`e` 敵、`H` 自軍拠点、`E` 敵拠点、`#` 壁）、`allies`・`enemies`（name・hp・attack・range・speed・color）、`goal`（rout / base）、`baseHp`、`seconds`。`command` はカーソルで部隊を選び（Shift で全員）行き先を指示、`auto` は布陣して見守るオートバトラー。

### table — 札勝負（`table.hand`）

`rounds`・`chips`・`ante`・`stakeVar`（RPGの変数を賭けて結果を戻す）・`suits`（4つの絵柄名）・`opponent`（name・`boldness` 降りにくさ・`bluff` はったりの確率）。5枚の役、1度の交換、相手の表情を読んで降りる／勝負／上乗せ。実際のお金は扱いません。

### composer — 作曲（`composer.compose`）

`steps`・`notes`（C4 や F#5）・`bpm`・`target`（再現する旋律、拍ごとに音名か .）・`saveTo`（自由作曲を集合に保存。会話の条件 `{ "set": …, "has": "C4 E4 …" }` に使える）。

### program — プログラミング（`program.run`）

`rows`（`#` 壁、`@` 開始、`G` ゴール、`*` 宝石）、`facing`、`commands`（`F` 進む・`L`・`R`・`J` 跳ぶ・`x2` 直前をもう一度・`loop` それまで全部をもう一度）、`maxLength`、`maxRuns`。

### factory — 工場（`factory.line`、リアルタイム）

`items`（id → 名前）、`sources`（毎秒入ってくる原料）、`recipes`（inputs → outputs、seconds）、`slots`、`goal`（item・amount）、`seconds`、`capacity`。機械の枠にレシピを入れ、出来た物を次の機械の材料にする。

### v1.0 の追加

- `rhythm.play` の `song`: 楽譜BGM（assets.json の song）を指定すると、その曲から譜面を作り（高い音ほど右のレーン）、曲を鳴らしながら同期して叩く。`track`（使うトラック）、`every`（何音ごとに拾うか）。
- `action.stage` の `tiles`（例 `{ "#": "w" }`：レベルの文字をプロジェクトのタイルセットのコードで描く）と `sprites`（例 `{ "w": "village-guard" }`：敵をキャラクター素材で描く）。`runner.race` の `tiles`（`.` 道・`#` 障害物・`side` 道の外）。
- v1.1: `defense.siege`（`tiles`・`foeSprite`）、`physics.shot`（`tiles`）、`squad`（`tiles`、兵種ごとの `sprite`）、`dungeon3d.explore`（`wallTile`・`exitTile` で壁と出口にタイルの模様、`sprites` で敵をキャラクター素材で）も素材で描ける。
- `action.coop`: 2人協力。2人目の開始位置は `2`。どちらかがゴールで成功、2人とも倒れると失敗。1P は WASD + F/G、2P は 矢印 + Enter・/、ゲームパッドは1台目が1P・2台目が2P。
- **自作モジュールの部品** `@rpg/modules`: `systems/*.ts` から `import { OutcomeArgs, finish, pressed, drawTile, drawSprite, drawHero, backdrop, button, h } from "@rpg/modules";` で組み込みモジュールと同じ部品を使える（場面／戦闘の両用の終わらせ方、押した瞬間の判定、タイルや立ち絵の描画、DOMの部品）。

### リアルタイム画面の入力（v0.9）

- `realtime: { fps, players: 2 }` で2人用のキー割り当て（held に `p2left`・`p2fire` などが入る）。
- 画面のクリックは `{ type: "custom", value: { click: { x, y, width, height } } }`（キャンバスのピクセル）で届く。照準・建設・部隊指示に使える。

## 新しいジャンルモジュールを作る（AIに頼む）

上の25個は出発点です。ジャンルは**プロジェクトの `systems/*.ts` に `defineSystem` で自由に追加**できます。組み込みモジュールと同じ仕組みです（`packages/modules/src/` が見本）。

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
- 必ず `tests/*.scenario.json` で `sceneInput` / `sceneInputs` / `frames` / `framesLoop` を使ってクリアできることを確かめる。
- 場面にも戦闘にも使えるモジュールは `packages/modules/src/common.ts` の `finish()`（勝ち・負け・やめるを場面／戦闘の両方で正しく終える）と `OutcomeArgs` を使うと簡単です。

### ほかのジャンル

111ジャンルの作り方（組み込み・データの組み合わせ）を [genre-atlas.md](genre-atlas.md) にまとめています。表にないジャンルを作ったら、`packages/modules/src/genres.ts` に1行足して `pnpm rpg genres --write` してください。

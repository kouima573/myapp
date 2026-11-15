# スクリプト — 何にでもコードを付ける

データ（効果・条件・ルール・ジャンルモジュール）で書けない処理は、**スクリプト**で書きます。
スクリプトは `projects/<id>/scripts/<名前>.ts` に置くだけで登録され（`project.json` への登録は不要）、
データの `"script"` 欄で**技・アイテム・特性・敵・仲間・マップ・エンティティ**に付けられます。

付け先が「有効」な間だけ、そのスクリプトのフック（ダメージ・移動・行動・描画・HUD・コマンド追加・独自画面…）が動きます。

| 付け先（`"script"` を書く場所） | 有効な間 |
| --- | --- |
| `database.json › abilities[]` | その能力を持っている間（特性から得た能力も） |
| `database.json › items[]` | 持っている間（装備品は装備している間） |
| `database.json › traits[]` | その特性を持っている間 |
| `database.json › enemies[]` | その敵がいる戦闘の間 |
| `database.json › companions[]` | 仲間にいる間 |
| `maps/*.json`（マップ自体） | そのマップにいる間 |
| `maps/*.json › entities[].states[]` | その状態のエンティティが今のマップに出ている間 |
| 効果 `{ "type": "script", "script": "名前", "call"?: "アクション名", "args"?: {...} }` | その効果が実行された時（`use`、または `actions[call]`） |

```json
{ "id": "time-sand", "name": "時の砂", "kind": "battle", "script": { "id": "time-stop", "args": { "turns": 2, "cost": 3 } } }
{ "id": "gamble-card", "name": "賭け札", "kind": "battle", "script": "gamble" }
```

`args` はスクリプト側で `ctx.self.args` として読めます。1つのスクリプトを、引数を変えて何か所にでも付けられます。

```ts
import { battleSay, changeEnemyHp, defineScript, effectiveStats } from "@rpg/engine";

export default defineScript({
  use(ctx) {                                   // 能力・アイテムを「使った」とき
    const damage = effectiveStats(ctx.state, ctx.content).attack * Number(ctx.self?.args.power ?? 3);
    return { state: battleSay(changeEnemyHp(ctx.state, -damage), `${damage}のダメージ！`) };
  },
});
```

工房の「スクリプト（コード）」画面で、ひな形から作って直接編集できます（保存すると自動でビルド・試遊に反映）。
コードを書かない場合は、同じ画面で「やりたいこと」を書いて **Codex／Claude Code への依頼文をコピー** してください。

## フック一覧

すべて**同期・純粋**です。`ctx.state` を書き換えず、新しい `state` や `effects` を返してください（例外を投げると試遊にエラーが出て状態は変わりません）。
`ctx` には `content`（全データ）・`state`（今の状態）・`self`（付け先 `{ kind, id, args, key }`）が入ります。

| フック | 呼ばれる時 | 返すもの |
| --- | --- | --- |
| `use(ctx, args)` | 能力・アイテムを使った時（データの `use.effects` の後）。データに `use` がなくても、`use` を書けば「わざ」「どうぐ」から使える | `{ state?, effects?, log? }` |
| `commands(ctx)` | 戦闘・メニューを開くたび | `[{ id, label, where?: "battle" \| "field" \| "both", blocked?, endsTurn?, args? }]` — 戦闘コマンドとメニュー「とくしゅ」に出る。押すと `actions[id]`（`id: "use"` なら `use`）が動く |
| `actions.<名前>(ctx, args)` | コマンド、または効果 `{ "type": "script", "script": …, "call": 名前 }` / `{ "type": "system", … }` | `{ state?, effects?, log? }` |
| `enemyTurn(ctx)` | 敵の手番（`ctx.enemy`・`ctx.battle`）。敵に付けたスクリプトはその敵の手番だけ、それ以外（能力・アイテムなど）は全部の敵の手番 | 結果を返すとその手番を置き換える。何も返さなければいつもの行動 |
| `companionTurn(ctx)` | 仲間の手番（`ctx.companion`） | 同上 |
| `modifyDamage(ctx)` | ダメージ計算の後（`ctx.target`: `"player"` / `"enemy"`、`ctx.amount`） | 数値で置き換え |
| `onLethalDamage(ctx)` | 主人公のHPが0になる時 | `{ hp, message? }` |
| `onBattleStart(ctx)` | 戦闘開始 | この付け先の戦闘メモリの初期値 |
| `onTurnEnd(ctx)` | 戦闘のターンの終わり | `{ state?, effects? }` |
| `onBattleEnd(ctx)` | 勝敗が決まった後、結果を適用する前 | `{ state?, effects? }` |
| `onAction(ctx, action)` | プレイヤーのすべての行動の直前 | `{ action }` で書き換え、`{ cancel: true }` で打ち消し |
| `onStep(ctx)` / `onTick(ctx)` / `onMapEnter(ctx)` | 1歩ごと / 時間が進むごと / マップに入った時 | `{ state?, effects? }` |
| `canPass(ctx)` | 移動判定（`ctx.x`・`ctx.y`・`ctx.tile`・`ctx.passable`） | `true` / `false` で上書き |
| `hud(ctx)` | 画面上の表示 | 文字列の配列 |
| `drawOverlay(g, ctx)` | マップの上に描く（Canvas 2D） | なし |
| `conditions` / `functions` / `scenes` | データの `{ "custom": "名前.条件" }`・`{ "fn": … }`・`startScene`（独自画面・ミニゲーム） | [extension-api.md](extension-api.md) と同じ |

同じフックを持つものが複数あるときは `priority`（小さいほど先、既定0）→ 名前の順に呼ばれます。
`enemyTurn` などは**最初に結果を返したもの**が勝ちます（見本の「時を止める」は `priority: -10` で敵自身のスクリプトより先に効かせています）。

## 補助関数（`@rpg/engine`）

| 関数 | 役割 |
| --- | --- |
| `memory(ctx, 初期値)` / `remember(ctx, 値)` | セーブに残る、付け先ごとのメモ（`state.systemData`）。`remember` は新しい state を返す |
| `battleMemory(ctx, 初期値)` / `rememberInBattle(ctx, 値)` | 戦闘ごとに消えるメモ |
| `roll(state)` | 決定的な乱数 `[0〜1の値, 新しいstate]`（`Math.random` は使わない：テストと再現のため） |
| `changeEnemyHp(state, 増減, 何番目?)` | 戦闘中の敵のHPを変える（勝敗はエンジンが判定） |
| `battleSay(state, 文)` | 戦闘ログに1行 |
| `effectiveStats(state, content)` | 補正込みの能力値 |
| `evaluate` / `evalExpr` / `interpolate` | データの条件・式・`{{差し込み}}` をコードから使う |

## 自動テスト

スクリプトが足したコマンドは `{ "command": "stop" }`（id か表示名）で押せます。見本: `projects/sample-rpg/tests/scripts.scenario.json`。

## 見本（森境の小さな冒険・長老の家の「ふしぎな書見台」）

| スクリプト | 付け先 | 何をするか |
| --- | --- | --- |
| `time-stop.ts` | 能力「時の砂」 | 戦闘コマンド「時を止める」を足し、2ターン敵の手番を奪う（気力3・1戦闘1回） |
| `gamble.ts` | 能力「賭け札」 | 決定的な乱数で、表なら攻撃力×3、裏ならHP半分 |
| `echo-mirror.ts` | 装飾品「こだまの鏡」 | 受けるダメージ-1、受けた分をターンの終わりに敵へ返す |
| `shapeshifter.ts` | 敵「ゆらぎ」 | 毎ターン石・炎・霧に姿を変え、行動も防御も変わる |

## 信頼境界

スクリプトはプロジェクトの**信頼されたコード**として型検査・バンドルされます（サンドボックスではありません）。他人のプロジェクトや mod のスクリプトは、中身を確認してから試遊してください。

# 独自ルールの拡張API

> 特定の技・アイテム・特性・敵・仲間・マップ・エンティティにだけ効く処理は、**スクリプト**（`scripts/*.ts`、登録不要）で書くのが簡単です → [scripting.md](scripting.md)。ここで説明するシステム（`systems/*.ts`）は、プロジェクト全体に常に効く仕組み用です。フックは共通です。

**まずデータのルール（[customization-guide.md](customization-guide.md)）で書けないか考えてください。** 食いしばり・会心・特効・再生・毒・技・コスト・好感度・地形変化などは、TypeScriptなしでJSONのルールで書けます。それでも表せない処理（文章の組み立て、複雑な計算・探索、独自のミニゲームなど）だけを `projects/<id>/systems/*.ts` に TypeScript で書きます。システムは `project.json` の `systems` に登録し、`default export` で `defineSystem({...})` を返します。

```ts
import { defineSystem } from "@rpg/engine";

export default defineSystem({
  id: "chronicle",                    // project.json の systems[].id と一致させる
  priority: 0,                        // 小さい順に実行（同値はid順）
  actions: {
    // データから { "type": "system", "system": "chronicle", "action": "summary" } で呼ぶ
    summary({ content, state }) {
      return { effects: [{ type: "message", text: `歩いた距離 ${state.steps}歩` }] };
    },
  },
});
```

`@rpg/engine` からは `evalExpr`・`evaluate`・`effectiveStats`・`abilitiesOf`・`interpolate` なども使えます。

`@rpg/engine` はエンジンの公開APIです（プロジェクトの置き場所に関係なく解決されます）。

## 何でも足せる — 拡張点の一覧

| 拡張点 | データからの呼び方 | 例 |
| --- | --- | --- |
| `conditions: { name(ctx, args) => boolean }` | `{ "custom": "id.name", "args": {...} }` | 夜か？ 距離3以内か？ |
| `functions: { name(ctx, numbers) => number }` | `{ "fn": "id.name", "args": [式, ...] }` | 相性表、距離、時刻 |
| `actions: { name(ctx, args) => { state?, effects?, log? } }` | `{ "type": "system", "system": "id", "action": "name", "args": {...} }` | ダンジョン生成（setTileを大量に返す）、集計 |
| `scenes: { name: { start, input, render } }` | `{ "type": "startScene", "system": "id", "scene": "name", "args": {...} }` | パズル、ノベル、育成、ミニゲーム |
| `scenes` を戦闘モードに | 敵の `"battle": { "mode": "id.name" }` / 戦闘効果の `mode` | 弾幕、カード、リズム戦闘 |
| `drawOverlay(ctx2d, info)` | （自動） | 暗闇と灯り、天候、霧 |
| `hud(ctx) => string[]` | （自動） | 体温、時刻、残り時間 |
| `onStep(ctx)` / `onTick(ctx)` | （自動） | 空腹、昼夜、匂い |
| `onAction(ctx, action)` | （自動。プレイヤーの全行動の直前） | 鏡写しの操作、止まれない主人公、二人同時に動く、一手ごとに世界が進む |

### 独自画面（scene）

```ts
scenes: {
  dial: {
    start(ctx, args) { return { cursor: 0, values: [0, 0, 0] }; },            // 初期データ（JSON）
    input(ctx, data, input) {                                                 // 純粋。テストで動く
      if (input.type === "confirm") return { close: true, effects: [{ type: "setFlag", flag: "opened" }] };
      return { data: { ...(data as object) } };
    },
    render(host, view) { /* DOMを描く。view.send({type:"up"}) で入力を送れる */ },
  },
},
```

- 入力: 矢印キー → `up/down/left/right`、決定 → `confirm`、キャンセル → `cancel`。`render` 内のボタンからは `view.send({ type: "custom", value: ... })` で任意の値を送れる。
- 結果: `data`（新しい画面データ）、`close`（閉じる）、`effects`（閉じた後に実行）、`state`（ゲーム状態の置き換え）。
- 結果（続き）: `apply`（画面を開いたまま今すぐ適用する効果。育成の能力値上昇など）、`log`、戦闘モードでは `outcome`（`victory` / `defeat` / `fled`）と `battleLog`。
- `checkArgs(args, { content })` を書くと、引数の誤りを `rpg validate` と工房の検証に表示できる（エラー文の配列を返す）。
- **リアルタイム画面**: `realtime: { fps: 30 }` を付けると、毎フレーム `input(ctx, data, { type: "frame", held: ["left", "fire", ...] })` が呼ばれ、`draw(ctx2d, view)` でCanvasに描く（`view.width` / `height` / `time`）。`held` は `up/down/left/right/fire/focus`。シミュレーションは `data` に入れた種で乱数を回し、決定的にする。
- **部品** `@rpg/modules`（組み込みジャンルモジュールと同じ部品）: `finish(ctx, args, "win" | "lose" | "quit", 文, hp?)` は場面なら閉じて onWin / onLose、戦闘モードなら勝敗を返す。`OutcomeArgs`（onWin・onLose・enemyId・canFlee）、`pressed(held, before)`、`heroOf(ctx)`、`drawTile(g, view, タイルコード, x, y, 大きさ)`、`drawSprite(g, view, 素材ID, x, y, 大きさ, 向きの行, コマ)`、`drawHero`、`backdrop`・`button`・`h`（DOM）。
- **ゲームパッド**: 標準配置のゲームパッドは自動で使える（十字キー/左スティック、A 決定・発射、B キャンセル、X focus、Start メニュー。2台目は2人用画面の2P）。
- **2人用・クリック**: `realtime: { fps, players: 2 }` で held に2人目のボタン（`p2up`・`p2fire` など）が入る。キャンバスのクリックは `{ type: "custom", value: { click: { x, y, width, height } } }`。
- **戦闘モード**: 敵の `"battle": { "mode": "id.scene", "args": {...} }` か戦闘効果の `mode` で、その画面が戦闘になる。`start` の `args.enemyId` に敵ID、`ctx.state.scene.battle` にRPG側の戦闘情報。決着は `outcome` で返す。
- 組み込みのジャンルモジュール（26種）は `packages/modules/src/` にあり、そのまま見本になる。[genre-modules.md](genre-modules.md)
- 自動プレイテストでは `{ "sceneInput": "up" }` や `{ "sceneInput": { "custom": ... } }`、`{ "sceneInputs": ["confirm", "down"], "repeat": 10 }`、リアルタイム画面は `{ "frames": 600, "hold": ["fire"] }` で操作できる。
- `rpg test` は、データが参照している条件・関数・画面・アクションが実際に定義されているかも確認する。

## フック一覧

すべて**同期・純粋関数**です。状態を書き換えず、値を返してください。例外を投げると試遊にエラーとして表示され、状態は変わりません。

| フック | 呼ばれる時 | 返り値 |
| --- | --- | --- |
| `modifyDamage(ctx)` | ダメージ計算の直後（処理順②）。`ctx.target` は `"player"`/`"enemy"` | 数値を返すとダメージを置換。`undefined` なら変更なし |
| `onLethalDamage(ctx)` | プレイヤーのHPが0になる時だけ（処理順③）。最初に結果を返したシステムが優先 | `{ hp, message?, battleData? }` |
| `onBattleStart(ctx)` | 戦闘開始時 | このシステム用の戦闘内データ（`battle.systemData[id]`）の初期値 |
| `canPass(ctx)` | 移動判定のたび。`ctx.passable` はデータ上の結果 | `true`/`false` で上書き、`undefined` で変更なし |
| `onAction(ctx, action)` | プレイヤーの行動（`move` / `interact` / `verb` / `advance` / `sceneInput` …）をエンジンが処理する直前 | `{ action? }` で別の行動に書き換え、`{ cancel: true }` で打ち消し。`state` / `effects` / `log` も返せる。何も返さなければそのまま |
| `actions.<name>(ctx, args)` | データの `{ "type": "system", "system": id, "action": name, "args": {...} }` | `{ state?, effects?, log? }`。`effects` は次に実行される |

### 状態の置き場所

- 戦闘ごとにリセットしたいもの → `battleData`（`onBattleStart` で初期化、`onLethalDamage` の `battleData` で更新）
- セーブに残したいもの → `state.systemData[あなたのid]`（`actions` で `state` を返して更新）。JSONにできる値だけを入れてください。
- 進行状況はなるべく**フラグ**で表現すると、工房の試遊パネルで切り替えて確認でき、条件式からも参照できます。

### ダメージ処理順（固定）

① 計算式（攻撃 + 威力 − 防御 ± 1、ぼうぎょ中は半減）→ ② データのルール（`dealDamage`/`takeDamage`）→ システムの `modifyDamage`（それぞれpriority順）→ ③ HPが0になるなら、データのルール（`lethalDamage`）→ システムの `onLethalDamage`（最初に結果を返したものを採用）→ ④ HP確定・勝敗判定。

## 共通エンジンを変える場合

フックで足りない場合（新しい画面、新しい効果typeなど）は `packages/engine` や `packages/runtime` を直接変更してかまいません。その場合は次を守ってください。

1. 形式を変えるなら `packages/schema/src/formats.ts` を更新し、`rpg validate` の参照チェック（`validate.ts`）も追加する。保存形式を変えるなら `formatVersion` を上げ、移行関数とfixtureテストを追加する。
2. `packages/engine/src/game.test.ts` かシナリオテストで新しい挙動を確かめる。
3. エンジンにプロジェクト固有のID（フラグ名・能力名など）を書かない。

## 信頼境界

システムはリポジトリ内の**信頼されたコード**として型検査・bundleされて実行されます（サンドボックスではありません）。知らない人やエージェントの変更は `git diff` で確認してから試遊してください。ローカルサーバーはコマンドやスクリプトのパスを受け取りません。

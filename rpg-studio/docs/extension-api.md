# 独自ルールの拡張API

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

## フック一覧

すべて**同期・純粋関数**です。状態を書き換えず、値を返してください。例外を投げると試遊にエラーとして表示され、状態は変わりません。

| フック | 呼ばれる時 | 返り値 |
| --- | --- | --- |
| `modifyDamage(ctx)` | ダメージ計算の直後（処理順②）。`ctx.target` は `"player"`/`"enemy"` | 数値を返すとダメージを置換。`undefined` なら変更なし |
| `onLethalDamage(ctx)` | プレイヤーのHPが0になる時だけ（処理順③）。最初に結果を返したシステムが優先 | `{ hp, message?, battleData? }` |
| `onBattleStart(ctx)` | 戦闘開始時 | このシステム用の戦闘内データ（`battle.systemData[id]`）の初期値 |
| `canPass(ctx)` | 移動判定のたび。`ctx.passable` はデータ上の結果 | `true`/`false` で上書き、`undefined` で変更なし |
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

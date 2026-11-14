# 自動プレイテスト（シナリオ）

`projects/<id>/tests/*.scenario.json` に、プレイヤーの操作と期待する結果を書きます。`pnpm rpg test --project <dir>` と工房の「検証 → 自動プレイテスト」で、実際のエンジンと独自システムを使って最初から実行します。ブラウザなしでゲームプレイを確認できるので、エージェントが変更した後の確認に使ってください。

```json
{
  "name": "獣道を教わると遺跡の近道が開く",
  "seed": 3,
  "steps": [
    { "walkTo": { "x": 5, "y": 9 } }, { "face": "up" }, { "interact": true },
    { "advance": "all" }, { "choose": "learn-trail" }, { "advance": "all" },
    { "expect": { "abilities": ["beast-trail"], "flags": { "beastPathUnlocked": true } } }
  ]
}
```

| ステップ | 動作 |
| --- | --- |
| `{ "walkTo": {x, y} }` | 現在のマップで最短経路を歩く（出入口は目的地のときだけ踏む）。到達できなければ失敗 |
| `{ "move": "up", "times": 3 }` / `{ "face": "left" }` | 1歩ずつ動く／向きを変える |
| `{ "interact": true }` | 調べる・話しかける |
| `{ "advance": "once" \| "all" }` | メッセージ・会話を進める（`all` は選択肢・戦闘・フィールドになるまで） |
| `{ "choose": "選択肢ID" }` | 選択肢を選ぶ（表示されていない・条件を満たさない場合は失敗） |
| `{ "battle": "attack" \| "guard" \| "flee" }` / `{ "battleItem": "herb" }` | 戦闘コマンド |
| `{ "fight": "auto" }` | 簡易AIで戦闘を最後まで行い閉じる（予告技の次は防御、HP半分以下で回復）。勝てなければ失敗 |
| `{ "effects": [...] }` | 効果を直接実行（テストの前提づくり：テレポート、フラグ設定、戦闘開始など） |
| `{ "saveAndLoad": true }` | 状態をJSONにして戻す（セーブ・再起動の再現） |
| `{ "expect": {...} }` | `mapId`・`at`・`scene`・`flags`・`abilities`・`lacksAbilities`・`items`・`done`・`notDone`・`hpAtLeast`・`passable`・`battleOutcome`・`textIncludes` |

- 既定ではランダムエンカウントを無効にして実行します（`"encounters": true` で有効）。乱数は `seed` で固定され、毎回同じ結果になります。
- 失敗すると `ERROR tests/xxx.scenario.json › steps[12]: flags.sentinelCalmed: 期待 true / 実際 false` のように、何番目の手順で何が違ったかを表示します。

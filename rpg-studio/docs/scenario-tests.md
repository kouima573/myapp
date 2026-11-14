# 自動プレイテスト（シナリオ）

`projects/<id>/tests/*.scenario.json` に、プレイヤーの操作と期待する結果を書きます。`pnpm rpg test --project <dir>` と工房の「検証 → 自動プレイテスト」で、実際のエンジンと独自システムを使って最初から実行します。ブラウザなしでゲームプレイを確認できるので、エージェントが変更した後の確認に使ってください。

```json
{
  "name": "獣道を教わると遺跡の近道が開く",
  "seed": 3,
  "steps": [
    { "advance": "all" }, { "choose": "dwarf" }, { "advance": "all" },
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
| `{ "advance": "once" \| "all" }` | メッセージ・会話を進める（`all` は決着した戦闘も閉じ、選択肢・戦闘中・フィールドになるまで進める） |
| `{ "choose": "選択肢ID" }` | 会話の選択肢・`choice`効果の選択肢を選ぶ（IDか表示名。表示されていない場合は失敗） |
| `{ "battle": "attack" \| "guard" \| "flee" }` / `{ "battleItem": "herb" }` / `{ "skill": "bite" }` | 戦闘コマンド |
| `{ "useItem": "herb" }` / `{ "useAbility": "first-aid" }` | フィールドでアイテム・技を使う |
| `{ "tick": 10 }` | 世界の時間を進める（エンティティの移動・tickルール）。フィールド以外になったら止まる |
| `{ "sceneInput": "up" }` / `{ "sceneInput": { "custom": 値 } }` | 独自画面に入力を送る |
| `{ "verb": "listen" }` | 自作の動詞を使う（project.json の verbs）。対象を選ぶ動詞は続けて `{ "choose": "対象ID" }` |
| `{ "sceneInputs": ["confirm", "down"], "repeat": 30 }` | 入力の並びを最大 repeat 回くり返す（画面が閉じたら止まる）。カード戦闘など |
| `{ "framesLoop": [{ "frames": 12, "hold": ["right", "up"] }, { "frames": 2, "hold": ["right"] }], "repeat": 60 }` | 押し方のパターンをくり返す（走ってジャンプ、など）。画面が閉じたら止まる。2人用の画面は `p2right` などで2人目を操作 |
| `{ "frames": 3000, "hold": ["fire"] }` | リアルタイム画面をボタンを押したまま進める（画面が変わったら止まる）。弾幕戦闘など |
| `{ "fight": "auto" }` | 簡易AIで戦闘を最後まで行い閉じる（予告技の次は防御、HP半分以下で回復）。勝てなければ失敗 |
| `{ "effects": [...] }` | 効果を直接実行（テストの前提づくり：テレポート、フラグ設定、戦闘開始など） |
| `{ "saveAndLoad": true }` | 状態をJSONにして戻す（セーブ・再起動の再現） |
| `{ "expect": {...} }` | `mapId`・`at`・`scene`（custom / ending も）・`flags`・`vars`・`sets`（含まれていること）・`lacksInSets`・`cycle`・`entities`（`{"id": {"x","y"}}`、`null` で消えていること）・`regions`・`abilities`（特性由来も含む）・`lacksAbilities`・`traits`・`lacksTraits`・`stats`（補正込み）・`items`・`done`・`notDone`・`hpAtLeast`・`passable`・`battleOutcome`・`textIncludes`・`player`（`{"name": …, "sprite": … / null}` 変身の確認）・`verbs` / `lacksVerbs`（使える動詞）・`carrying`（運んでいる物、`null` で何も） |

- 既定ではランダムエンカウントを無効にして実行します（`"encounters": true` で有効）。乱数は `seed` で固定され、毎回同じ結果になります。
- 失敗すると `ERROR tests/xxx.scenario.json › steps[12]: flags.sentinelCalmed: 期待 true / 実際 false` のように、何番目の手順で何が違ったかを表示します。

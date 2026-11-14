# 自由拡張ガイド — 種族・効果・仕組みを自分で（AIと）作る

このエンジンには「種族」「職業」「効果」などの決まった中身はありません。**部品**（フラグ・変数・特性・能力・ルール・効果・条件・式）だけがあり、それを組み合わせて何でも作れます。種族や効果の内容は、作り手がCodex／Claude Codeに頼んでJSONとして書かせる前提です。

- データ（JSON）だけでほとんどの効果が書けます。
- データで書けないものだけ、TypeScriptの拡張（[extension-api.md](extension-api.md)）で書きます。
- それでも足りなければ、エンジン自体を改造してかまいません（[AGENTS.md](../AGENTS.md)の手順に従う）。

## 部品の全体像

| 部品 | 置き場所 | 役割 |
| --- | --- | --- |
| **フラグ** | `project.json` › `flags` | ON/OFFの記録。進行状況、選んだ道、呪われているか など |
| **変数** | `project.json` › `variables` | 整数の記録。お金、気力、好感度、評判、日数、カウンター など。最小・最大値、HUD表示つき |
| **特性 (trait)** | `database.json` › `traits` | プレイヤーが「何であるか」。種族・職業・祝福・呪い・称号など。`category`は自由な文字列 |
| **能力 (ability)** | `database.json` › `abilities` | 特性から与えられるか、イベントで覚える。能力値補正・ルール・技（使用）を持つ |
| **ルール (rule)** | 能力・特性・アイテム・敵、または `rules.json` | 「いつ・どんな時に・何をするか」。トリガーで自動発動する |
| **効果 (effect)** | イベント・会話・ルール・技など | 実際に起こること（25種類） |
| **条件 (condition)** | どこでも `when` | フラグ・変数の比較・特性・能力・アイテム・敵・マップなど |
| **式 (expr)** | 数値を書く場所すべて | 変数・能力値・ダメージなどを使った計算 |

フラグと変数は、`project.json` に宣言すれば**名前は自由**です。宣言しておけば、打ち間違いは `rpg validate` が見つけます。

## ルール（トリガー）

ルールは「`on` のタイミングで、`when` が成り立てば（`chance`% の確率で）、`effects` を実行し、`modify` で数値を書き換える」ものです。

| on | タイミング | modify | 主な用途 |
| --- | --- | --- | --- |
| `auto` | フラグ・変数などが変わった後（フィールド） | — | 「○○が揃ったら」「お金が100を超えたら」。既定は1回きり、`repeat: true` で何度でも |
| `step` | 1歩歩くたび | — | 毒の床、自然回復、歩数で時間が進む |
| `mapEnter` | 別のマップに入った時 | — | 入場時の演出、地域ごとの呪い |
| `battleStart` | 戦闘開始時 | — | 先制、戦闘開始時のバフ |
| `dealDamage` | プレイヤーが与えるダメージが決まった時 | `damage` | 会心、種族特効、属性 |
| `takeDamage` | プレイヤーが受けるダメージが決まった時 | `damage` | 軽減、反撃 |
| `lethalDamage` | 受けるダメージで倒れる時 | `hp`（残すHP） | 食いしばり、身代わり、復活 |
| `turnEnd` | 敵の行動の後（毎ターン） | — | 再生、毒、カウントダウン |
| `victory` / `defeat` | 戦闘の決着時 | — | 戦利品、経験値、敗北時の救済 |

- `once`: `"battle"`（1戦闘に1回）／`"map"`（マップに入るたびに1回）／`"game"`（1プレイで1回）
- `priority`: 小さいほど先に実行されます。
- 式では `{"ctx":"damage"}`（そのときのダメージ）、`{"ctx":"turn"}`、`{"ctx":"enemyHp"}`、`{"ctx":"enemyMaxHp"}` が使えます。
- ルールが有効になるのは、その持ち主がいる間だけです。能力・特性に付けたルールは、それを持っている間だけ働きます。アイテムに付けたルールは持っている間、敵に付けたルールはその敵との戦闘中に働きます。`rules.json` に書いたルールは常に働きます。

## レシピ集（効果パターン）

効果の仕様書を「どのパターンで書けるか」に分けると、AIに頼みやすくなります。

### 1. 常時の能力値補正
```json
{ "id": "stone-blood", "name": "石の血", "statMods": { "maxHp": 6, "defense": { "div": [{ "var": "level" }, 3] } } }
```

### 2. 1戦闘に1回の食いしばり
```json
{ "id": "last-stand", "on": "lethalDamage", "once": "battle", "modify": { "hp": 1 }, "effects": [{ "type": "battleLog", "text": "踏みとどまった！" }] }
```

### 3. 確率で会心（与ダメージ2倍）
```json
{ "id": "crit", "on": "dealDamage", "chance": 25, "modify": { "damage": { "mul": [{ "ctx": "damage" }, 2] } }, "effects": [{ "type": "battleLog", "text": "会心の一撃！" }] }
```

### 4. 特定の敵（タグ）に強い・弱い
```json
{ "id": "undead-bane", "on": "dealDamage", "when": { "enemyTag": "undead" }, "modify": { "damage": { "percent": [{ "ctx": "damage" }, 150] } } }
```

### 5. HPが低いほど強い
```json
{ "id": "berserk", "on": "dealDamage", "when": { "compare": [{ "hp": true }, "<=", { "percent": [{ "stat": "maxHp" }, 30] }] }, "modify": { "damage": { "add": [{ "ctx": "damage" }, 3] } } }
```

### 6. 毎ターン再生／毒
```json
{ "id": "regen", "on": "turnEnd", "effects": [{ "type": "heal", "amount": 2 }, { "type": "battleLog", "text": "傷がふさがっていく。" }] }
{ "id": "poisoned", "on": "turnEnd", "when": { "flag": "poisoned" }, "effects": [{ "type": "damage", "target": "player", "amount": 2, "text": "毒で{{ctx.damage}}のダメージ。" }] }
```

### 7. 歩くと回復・時間が進む
```json
{ "id": "tick", "on": "step", "effects": [{ "type": "setVar", "var": "minutes", "op": "add", "value": 5 }] }
{ "id": "nightfall", "on": "auto", "repeat": true, "when": { "var": "minutes", "op": ">=", "value": 1200 }, "effects": [{ "type": "setFlag", "flag": "night" }, { "type": "setVar", "var": "minutes", "value": 0 }] }
```

### 8. 技（コストつき）
```json
{ "id": "fire-breath", "name": "火の息", "use": { "where": "battle", "cost": [{ "var": "mp", "amount": 3 }],
  "effects": [{ "type": "damage", "target": "enemy", "amount": { "add": [{ "stat": "attack" }, 4] }, "text": "{{enemy}}を焼いた！ {{ctx.damage}}のダメージ。" }] } }
```

### 9. フィールドで使う技（通れない場所を通る・鍵開け）
能力そのものを条件にします：タイルの `passableWhen: {"ability": "swim"}`、イベントの `when: {"ability": "lockpick"}`。

### 10. 種族で会話・選択肢・値段が変わる
```json
"lines": [{ "text": "エルフか、珍しいな。", "when": { "trait": "elf" } }, "いらっしゃい。"]
{ "label": "薬草 — {{var.herbPrice}}G", "when": { "var": "gold", "op": ">=", "value": { "if": { "trait": "merchant-guild" }, "then": 4, "else": 5 } } }
```

### 11. 好感度・評判で分岐
```json
{ "type": "setVar", "var": "trust_rio", "op": "add", "value": 1 }
"dialogues": [{ "when": { "var": "trust_rio", "op": ">=", "value": 5 }, "dialogue": "rio-secret" }, { "dialogue": "rio-normal" }]
```

### 12. 種族の変化・呪い・転職（特性の付け外し）
```json
{ "type": "removeTrait", "trait": "human" }, { "type": "grantTrait", "trait": "vampire" }
```

### 13. 世界が変わる（橋がかかる・道がふさがる）
マップの `overlays`（フラグで切り替わる地形）か、`setTile`（その場で書き換えてセーブに残る）を使います。

### 14. 敵の行動を条件で変える
```json
{ "name": "怒りの咆哮", "power": 12, "when": { "compare": [{ "ctx": "enemyHp" }, "<", { "percent": [{ "ctx": "enemyMaxHp" }, 50] }] }, "effects": [{ "type": "setFlag", "flag": "boss_enraged" }] }
```

### 15. 複数の能力で同じ処理点を使う
各ルールの `priority` で順番を決めます（小さい順）。`lethalDamage` は最初に `modify.hp` を返したルールが優先です。

### 16. データで書けないもの → TypeScript
文章の組み立て、複雑な探索・計算、独自のミニゲームなど。`systems/*.ts` の `actions` を作り、データから `{"type":"system","system":"id","action":"name"}` で呼びます。サンプルの `systems/chronicle.ts` が例です。

## AIへの頼み方（大量の効果を作るとき）

1. **一覧を見せる**: `pnpm rpg catalog --project projects/<id>` の出力で、使えるID・フラグ・変数をAIに把握させます。
2. **仕様を渡す**: 例：「添付の『13種族の社会・寿命・104効果仕様』を、docs/customization-guide.md のレシピに沿って `database.json` の traits / abilities と rules に実装して。データで書けないものはリストアップして systems/*.ts にする」
3. **小分けに**: 1〜2種族（8〜16効果）ずつ頼むと、間違いを直しやすくなります。
4. **テストを書かせる**: 「各効果について tests/*.scenario.json で動作確認を追加して」。`{ "effects": [...] }` で前提を作り、`{ "expect": ... }` で確かめます。
5. **完了条件**: `pnpm rpg validate` / `pnpm rpg test` / `pnpm rpg build` がすべてOK。
6. **確認する**: 工房の「試遊」で、右側のパネルから特性や変数を切り替えて試します。

エディター（VS Code等）では `schema/*.schema.json` による入力補完と検査が効きます（`.vscode/settings.json`）。

## 種族テンプレート

```json
{
  "id": "elf", "name": "エルフ", "category": "種族",
  "description": "森と共に生きる長命の一族。",
  "tags": ["long-lived", "forest"],
  "statMods": { "maxHp": -2, "attack": 1 },
  "abilities": ["forest-sight", "mana-flow"],
  "rules": [],
  "onGrant": [{ "type": "setVar", "var": "lifespan", "value": 800 }]
}
```

能力は `abilities` に1つずつ定義し、効果はその能力の `rules`・`statMods`・`use` に書きます。種族そのものの `rules` に直接書いてもかまいません。冒頭で選ばせるには、`project.json` の `intro` に `choice` 効果で選択肢を並べ、`grantTrait` を実行します（サンプル参照）。

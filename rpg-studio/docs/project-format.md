# プロジェクト形式 v2（エンジン0.3で上位互換の拡張）

正本は `projects/<id>/` のGit管理ファイルです。型と実行時スキーマは `packages/schema/src/formats.ts`（Zod）が唯一の定義で、`rpg validate` と工房が同じ検証（`loadProjectContent`）を使います。

| ファイル | 内容 |
| --- | --- |
| `project.json` | `formatVersion: 2`、安定ID、タイトル、`start`（マップ・座標・向き）、`player`（名前・スプライト・能力値・初期能力・初期アイテム）、**`flags`（使う全フラグの宣言）**、各ファイルへの参照、`systems` |
| `tiles.json` | タイルコード（1文字）→ 名前・アトラス番号・通行可否・`passableWhen`（条件で通れる）・`openIndex`（開いた時の絵）・代替色 |
| `maps/*.json` | `rows`（タイルコードの文字列）、`npcs`、`portals`、`interactables`、任意の `encounters` |
| `dialogues/*.json` | 会話（話者・行・最後の `effects`・`choices`） |
| `events/*.json` | イベント（`when` 条件・`effects`・`otherwise`・`once`・`afterDone`） |
| `database.json` | 特性（種族など）・能力・アイテム・敵 |
| `rules.json`（任意） | 常に有効な全体ルール（`project.json` の `rulesPath`） |
| `assets.json` | 素材ID・パス・種別・寸法・出典（素材形式は v1 のまま） |
| `systems/*.ts` | データで表せない独自ルール（[extension-api.md](extension-api.md)） |
| `tests/*.scenario.json` | 自動プレイテスト（[scenario-tests.md](scenario-tests.md)） |

## 変数とフラグ

```jsonc
"flags":     { "metElder": { "initial": false, "description": "長老に会った" } },
"variables": { "gold": { "initial": 0, "min": 0, "label": "ゴールド", "hud": true }, "trust_rio": { "initial": 0, "min": -10, "max": 10 } }
```

どちらも名前は自由ですが、宣言が必要です（打ち間違いを検出するため）。変数は整数で、`min`/`max` で自動的に範囲内に収まります。`label` を付けるとメニューに、`hud: true` で画面上部に表示されます。

## 式（Expr）

数値を書ける場所（変数の値、ダメージ量、回復量、確率、比較など）には、すべて式が書けます。

```jsonc
12                                   // 数
{ "var": "gold" }  { "count": "herb" }  { "stat": "attack" }  { "hp": true }  { "steps": true }
{ "ctx": "damage" }                  // ルール内: damage / turn / enemyHp / enemyMaxHp / enemyAttack / enemyDefense
{ "add": [a, b, ...] } { "sub": [a, b] } { "mul": [...] } { "div": [a, b] } { "mod": [a, b] } { "min": [...] } { "max": [...] }
{ "percent": [value, pct] }          // value × pct ÷ 100（切り捨て）
{ "if": 条件, "then": 式, "else": 式 }
```

`{"stat"}` は特性・能力・アイテムによる補正込みの値です。

## 条件（Condition）

```jsonc
{ "flag": "sentinelCalmed" }                       // フラグがtrue（"is": false で偽）
{ "var": "gold", "op": ">=", "value": 10 }         // 変数の比較（op: == != > >= < <=、valueは式）
{ "compare": [式, ">", 式] }                        // 任意の式どうしの比較
{ "ability": "beast-trail" }  { "trait": "dwarf" }  { "item": "herb", "atLeast": 2 }
{ "done": "sentinel-battle" }                      // 完了済み（onceイベント、"会話ID/選択肢ID"、markDoneのID）
{ "map": "ruins" }  { "inBattle": true }  { "enemy": "stone-sentinel" }  { "enemyTag": "undead" }
{ "all": [...] } / { "any": [...] } / { "not": {...} }
```

## 効果（Effect）

上から順に実行されます。`message`・`dialogue`・`choice`・`battle` は画面を止め、プレイヤーが閉じた後に残りの効果が続きます（効果キュー）。戦闘中に実行された場合は、文章は戦闘ログに出ます。`dialogue`・`choice`・`teleport`・`battle` は戦闘が終わった後に実行されます。

| type | 例 |
| --- | --- |
| `message` | `{ "type": "message", "text": "所持金は{{var.gold}}G。", "speaker": "門番" }` |
| `setFlag` | `{ "type": "setFlag", "flag": "gateOpen", "value": true }` |
| `setVar` | `{ "type": "setVar", "var": "gold", "op": "add", "value": 10 }`（op: set/add/sub/mul/div/min/max） |
| `random` | `{ "type": "random", "var": "roll", "min": 1, "max": 100 }` |
| `chance` | `{ "type": "chance", "percent": 30, "then": [...], "else": [...] }` |
| `if` | `{ "type": "if", "when": {...}, "then": [...], "else": [...] }` |
| `setStat` | `{ "type": "setStat", "stat": "attack", "op": "add", "value": 1 }`（基本値を変える：レベルアップ等） |
| `unlockAbility` / `removeAbility` | `{ "type": "unlockAbility", "ability": "beast-trail" }` |
| `grantTrait` / `removeTrait` | `{ "type": "grantTrait", "trait": "dwarf" }`（特性の `onGrant` も実行） |
| `giveItem` / `takeItem` | `{ "type": "giveItem", "item": "herb", "count": 2 }` |
| `heal` | `{ "type": "heal", "amount": 8 }`（省略で全回復） |
| `damage` | `{ "type": "damage", "target": "enemy", "amount": {...}, "text": "{{ctx.damage}}のダメージ！" }`（フィールドではHPは1未満にならない） |
| `teleport` | `{ "type": "teleport", "mapId": "ruins", "x": 3, "y": 9, "facing": "right" }` |
| `setTile` | `{ "type": "setTile", "mapId": "village", "x": 4, "y": 2, "code": "." }`（セーブに残る地形変更） |
| `dialogue` | `{ "type": "dialogue", "dialogue": "elder-before" }` |
| `choice` | `{ "type": "choice", "prompt": "どうする？", "options": [{ "id": "buy", "label": "買う", "when": {...}, "effects": [...] }] }`（条件を満たす選択肢だけ表示） |
| `event` | `{ "type": "event", "event": "elder-shop" }`（別のイベントを呼ぶ） |
| `battle` | `{ "type": "battle", "enemy": "stone-sentinel", "canFlee": false, "onDefeat": "respawn" }`。勝てば後続が続き、負け・逃走では後続を破棄（`once`イベントは完了扱いにならず再挑戦できる） |
| `battleLog` | 戦闘ログに1行（フィールドではメッセージ） |
| `endBattle` | `{ "type": "endBattle", "outcome": "victory" }`（即勝利／`fled`で離脱） |
| `markDone` | `{ "type": "markDone", "id": "elder-thanks" }` |
| `system` | `{ "type": "system", "system": "chronicle", "action": "summary" }`（TypeScriptを呼ぶ） |

文章（message・会話の行・選択肢・戦闘ログ）には `{{var.gold}}` `{{item.herb}}` `{{stat.attack}}` `{{hp}}` `{{maxHp}}` `{{name}}` `{{flag.x}}` `{{enemy}}` `{{ctx.damage}}` `{{trait.種族}}`（そのカテゴリの特性名）を差し込めます。会話の行は `{ "text": "...", "when": {...} }` にすると条件付きで表示されます。

## 特性・能力・アイテム・ルール

- **特性**（`database.json` › `traits`）: `category`（種族・職業など自由）、`statMods`、`abilities`（特性がある間だけ持つ能力）、`rules`、`onGrant`、`tags`。
- **能力**（`abilities`）: `statMods`、`rules`、`use`（技：`where` battle/field/both、`cost` 変数コスト、`hpCost`、`when`、`effects`）。
- **アイテム**（`items`）: `heal`（簡易）、`use`（汎用、`consume`）、`statMods`・`rules`（持っているだけで効く）。
- **ルール**（能力・特性・アイテム・敵、または `rulesPath` の `rules.json`）: `on`（auto / step / tick / mapEnter / battleStart / turnEnd / dealDamage / takeDamage / lethalDamage / victory / defeat / **bump**（壁などにぶつかった）/ **examine**（調べたが何もなかった）/ **verb**（動詞を使った。`match` で動詞を指定）/ **signal**（シグナルを受けた。`match` 必須））、`when`、`chance`、`once`（battle / map / game）、`repeat`、`priority`、`modify`（damage / hp）、`effects`。詳しい使い方とレシピは [customization-guide.md](customization-guide.md) を参照。
- **敵**: `tags`（条件 `enemyTag` 用）、`actions[].when`（条件付き行動）、`actions[].effects`、`rules`（その敵との戦闘中だけ有効）。
- **開始時**: `project.json` の `player.traits`（初期特性）と `intro`（新規ゲーム開始時の効果。種族選択など）。

## 世界の仕組み（エンティティ・領域・調べるタイル・時間・集合・周回）

- **エンティティ** `maps › entities[]`: `{ id, name, x, y, states: [{ when, name, sprite, marker, facing, solid, trigger, dialogue, event, effects, behavior }] }`。`states` のうち条件を満たす最初のものが有効で、どれも満たさなければ消える。`trigger`: action / touch / auto / none。`behavior`: still / wander{radius, every} / patrol{path, every} / chase{range, every} / flee{range, every}（単位はtick）。
- **領域** `maps › regions[]`: `{ id, label, x, y, w, h, when, onEnter, onLeave, onStep, inspect }`。条件 `{"inRegion": id}`。
- **調べるタイル** `tiles.json › tiles[].inspect`: `{ when, effects, otherwise }`。
- **集合** `project.json › sets`: `{ label, description, show, persist, entries }`。効果 `addToSet` / `removeFromSet` / `clearSet`、条件 `{"set", "has"}`、式 `{"size"}`、文中の `{{set.<id>}}`。組み込みの集合 `endings`（到達したエンディング、meta）。
- **周回** フラグ・変数・集合の `persist: "meta"` は、`newCycle` やゲームの再開をまたいで残る。式 `{"cycle": true}`、文中の `{{cycle}}`。`project.json › endings` と効果 `ending`（エンディング画面 → 閉じると次の周回）。
- **時間** `schedule {id?, after: 式(歩数), effects}` / `cancelSchedule {id}`。ルールの `on: "tick"`。式 `{"ticks": true}`。
- **その他の効果** `moveEntity {entity, mapId?, x, y, facing?}`、`startScene {system, scene, args}`（独自画面）、`signal {signal}`（シグナルを発信。`on: "signal"` で `match` が一致するルールがその場で動く）、`setPlayer {name?, sprite?}`（変身。`null` で元に戻す）。
- **動詞** `project.json › verbs`: `{ "listen": { "label": "耳を澄ます", "key": "l", "description": "…", "when": 条件, "effects": [...] } }`。フィールドのメニュー「こうどう」・画面のボタン・キーで使える。`on: "verb"` のルールも反応する。
- **シグナル** `project.json › signals`: `{ "whistle": { "description": "…" } }`。未宣言のシグナルは検証エラー。
- **条件** `{ "front": { "tile": "~", "entity": "…", "npc": "…", "blocked": true } }`: プレイヤーの目の前（書いた項目がすべて一致）。
- **拡張の呼び出し** 条件 `{"custom": "system.name", "args"}`、式 `{"fn": "system.name", "args": [...]}`。
- **ジャンルモジュール** `project.json › modules`（例 `{ "novel": {}, "shooter": {} }`）で有効にする。戦闘効果の `mode` / `args`、敵の `battle: { mode: "builtin" | "id.scene", args }` で戦い方を差し替える。詳しくは [genre-modules.md](genre-modules.md)。
- **戦闘** `project.json › battle`: `playerDamage` / `enemyDamage` / `fleeChance`（式。ctx: attack, defense, power, variance）、`commands`（各コマンドのON/OFF）。

## 地形の変化

マップの `overlays` は「条件が成り立つ間だけ、指定したマスを別のタイルにする」もの（例：番人を倒すと大岩が消える）。`setTile` 効果は、その場でマスを書き換えてセーブに残します。

## マップの配置物

- **NPC**: `dialogues` は上から順に `when` を満たす最初の会話を使います（無条件の既定を最後に）。`visibleWhen` で出現条件。NPCは通れません。
- **出入口 (portal)**: 踏むと `targetMapId` の `targetX/Y` へ。`when` で通行条件。
- **仕掛け (interactable)**: `trigger: "action"`（向いて調べる／足元を調べる）か `"touch"`（踏む）。`solid` で通行不可、`marker` で見た目（`sparkle`・`sign`・`chest`・`statue`・`none`）。
- **encounters**: `{ "rate": 0.08, "enemies": [...], "tiles": ["i"] }` 1歩ごとの出現率と対象タイル。

## 戦闘

ダメージ = `max(1, 攻撃力 + 技の威力 − 防御力 ± 1)`（能力値は補正込み）。ぼうぎょ中は半分。コマンドは たたかう／ぼうぎょ／わざ（`use` を持つ能力）／どうぐ／にげる。敵の `actions` は、そのターンに使えるもの（`when`）が順番に使われ、`power: 0` は攻撃しない技（予告・溜めなど）。処理順は「①ダメージ計算 → ②ルール（dealDamage/takeDamage）→ システムの`modifyDamage` → ③致死判定：ルール（lethalDamage）→ システムの`onLethalDamage` → ④HP確定」で固定です。毎ターンの最後に `turnEnd` ルール。

## 形式バージョンと移行

- `formatVersion` は保存形式のバージョンで、エンジンのリリース番号（`ENGINE_VERSION`）とは別です。
- 未対応の形式は元ファイルを変更せずに診断します。
- v1→v2: `pnpm rpg migrate --project <dir>` で差分と手作業項目を表示（dry-run）。`--write` を付けると、元ファイルを `.rpg-backup/v1-<日時>/` に保存し、新形式で検証できた場合だけ書き込みます。途中で失敗したら元に戻します。移行関数は純粋・決定的で、v1 fixture（`tests/fixtures/v1-sample`）でテストしています。
- v1の `systems/*.ts`（`unlockBeastTrail` 等の専用フック）は自動変換できないため、移行結果に手作業項目として表示されます。

## プレイヤーセーブ（形式 v2）

`{ formatVersion, projectId, savedAt, state }`。`state` には現在地・向き・HP・基本能力値・能力・特性・アイテム・フラグ・変数・地形変更・発動済みルール・完了ID・乱数シード・システム用データを安定IDで記録します。0.3で増えた項目がない古いセーブも既定値で読み込めます。会話や戦闘の途中ではセーブできません。読込時はプロジェクトID・形式・マップの存在・座標を確認し、壊れていても例外にせず理由を表示して新規開始を選べます。v1セーブは読込時に変換します（元データは書き換えません）。後から追加したフラグは初期値で補います。

## 音

- `project.json` › `audio`: `battle`（戦闘BGM）、`victory`（勝利の音）、`sfx`（場面ごとの効果音: cursor / confirm / cancel / bump / hit / hurt / heal / encounter / victory / defeat / door / item / save / menu）、`volume`。
- マップの `bgm`、敵の `bgm`、効果 `playBgm`（`null` で無音、セーブに残る）・`playSfx`。
- 素材の種類 `bgm`・`sfx`（OGG/MP3/WAV）と `song`（楽譜BGM `.song.json`。書式は [asset-guide.md](asset-guide.md)）。

## 素材の出どころ（assets.json）

`origin`（original / generated / site / purchased / commission）、`sourceId`（取得元カタログのID）、`url`、`author`、`license`、`licenseUrl`、`credit`、`creditRequired`、`redistributable`、`termsCheckedAt`（YYYY-MM-DD）、`notes`、`request`（画像依頼ID）、`generator`。外部素材は sourceId・規約確認日・規約名（サイトならURLも）が必須です。`project.json` › `assetPolicy` で、取得元のON/OFF・共有用かどうか・入手方法の優先順・容量予算を決めます。詳しくは [asset-guide.md](asset-guide.md)。

## 画像シート

`tileWidth`・`tileHeight`・`columns`・`rows`（・`margin`・`spacing`）で寸法を宣言し、`rpg validate` がPNGの実寸と照合します。キャラクターは行＝向き（下・左・右・上）、列＝歩行フレーム。ソース64pxセルを32pxで、補間なしで描画します。

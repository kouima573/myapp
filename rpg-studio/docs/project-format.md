# プロジェクト形式 v2（エンジン0.3で上位互換の拡張）

この文書は `project.json` を使うRPG形式の説明です。主人公・マップ・HPを必要としない作品は、別形式の [experience-projects.md](experience-projects.md) を参照してください。

正本は `projects/<id>/` のGit管理ファイルです。型と実行時スキーマは `packages/schema/src/formats.ts`（Zod）が唯一の定義で、`rpg validate` と工房が同じ検証（`loadProjectContent`）を使います。

| ファイル | 内容 |
| --- | --- |
| `project.json` | `formatVersion: 2`、安定ID、タイトル、`start`（マップ・座標・向き）、`player`（名前・スプライト・能力値・初期能力・初期アイテム・任意のパッシブ枠 `passiveCapacity`）、**`flags`（使う全フラグの宣言）**、依頼定義 `quests`、各ファイルへの参照、`systems` |
| `tiles.json` | タイルコード（1文字）→ 名前・アトラス番号・通行可否・`passableWhen`（条件で通れる）・`openIndex`（開いた時の絵）・代替色 |
| `maps/*.json` | `rows`（タイルコードの文字列）、`npcs`、`portals`、`interactables`、任意の `encounters` |
| `dialogues/*.json` | 会話（話者・任意の話者色 `speakerColor`・行・最後の `effects`・`choices`） |
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
{ "var": "gold" }  { "count": "herb" }  { "stat": "attack" }  { "hp": true }  { "mp": true }  { "sp": true }  { "steps": true }
{ "ctx": "damage" }                  // ルール内: damage / turn / enemyHp / enemyMaxHp / enemyAttack / enemyDefense
{ "add": [a, b, ...] } { "sub": [a, b] } { "mul": [...] } { "div": [a, b] } { "mod": [a, b] } { "min": [...] } { "max": [...] }
{ "percent": [value, pct] }          // value × pct ÷ 100（切り捨て）
{ "if": 条件, "then": 式, "else": 式 }
```

`{"stat"}` は特性・能力・アイテムによる補正込みの値です。`mp` / `sp` は現在値、`{"stat":"maxMp"}` / `{"stat":"maxSp"}` は上限を返します。

## 条件（Condition）

```jsonc
{ "flag": "sentinelCalmed" }                       // フラグがtrue（"is": false で偽）
{ "var": "gold", "op": ">=", "value": 10 }         // 変数の比較（op: == != > >= < <=、valueは式）
{ "compare": [式, ">", 式] }                        // 任意の式どうしの比較
{ "ability": "beast-trail" }  { "trait": "dwarf" }  { "item": "herb", "atLeast": 2 }
{ "done": "sentinel-battle" }                      // 完了済み（onceイベント、"会話ID/選択肢ID"、markDoneのID）
{ "seenDialogue": "elder-before" }                // 一度開いた会話か
{ "map": "ruins" }  { "inBattle": true }  { "enemy": "stone-sentinel" }  { "enemyTag": "undead" }
{ "all": [...] } / { "any": [...] } / { "not": {...} }
```

## 効果（Effect）

会話データには任意で `speakerColor` を設定できます（例: `"speakerColor": "#78C8FF"`）。話し手名にだけ反映され、省略すると工房テーマの既定色になります。

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
| `recover` | `{ "type": "recover", "resource": "mp", "amount": 5, "target": "all" }`（MPまたはSPを回復。amount省略で対象者の上限まで回復） |
| `damage` | `{ "type": "damage", "target": "enemy", "amount": {...}, "text": "{{ctx.damage}}のダメージ！" }`（フィールドではHPは1未満にならない） |
| `teleport` | `{ "type": "teleport", "mapId": "ruins", "x": 3, "y": 9, "facing": "right" }`（工房のフォームでは移動先マップを選び、地図をクリックして座標指定できます） |
| `setTile` | `{ "type": "setTile", "mapId": "village", "x": 4, "y": 2, "code": "." }`（セーブに残る地形変更） |
| `dialogue` | `{ "type": "dialogue", "dialogue": "elder-before" }` |
| `choice` | `{ "type": "choice", "prompt": "どうする？", "options": [{ "id": "buy", "label": "買う", "when": {...}, "effects": [...] }] }`（条件を満たす選択肢だけ表示） |
| `event` | `{ "type": "event", "event": "elder-shop" }`（別のイベントを呼ぶ） |
| `battle` | `{ "type": "battle", "enemy": "stone-sentinel", "canFlee": false, "onDefeat": "respawn" }`。勝てば後続が続き、負け・逃走では後続を破棄（`once`イベントは完了扱いにならず再挑戦できる） |
| `battleLog` | 戦闘ログに1行（フィールドではメッセージ） |
| `endBattle` | `{ "type": "endBattle", "outcome": "victory" }`（即勝利／`fled`で離脱） |
| `markDone` | `{ "type": "markDone", "id": "elder-thanks" }` |
| `quest` | `{ "type": "quest", "quest": "herb-request", "action": "start" }`（`complete` / `fail` / `objective` も。目標の達成は `objective` ID を指定） |
| `fadeScreen` | `{ "type": "fadeScreen", "to": "color", "color": "#000000", "ms": 350 }`。`to: "clear"` で明るく戻す。暗転中に場面を変える場合は間にブロッキング効果（会話など）を置く |
| `system` | `{ "type": "system", "system": "chronicle", "action": "summary" }`（TypeScriptを呼ぶ） |

文章（message・会話の行・選択肢・戦闘ログ）には `{{var.gold}}` `{{item.herb}}` `{{stat.attack}}` `{{hp}}` `{{maxHp}}` `{{mp}}` `{{maxMp}}` `{{sp}}` `{{maxSp}}` `{{name}}` `{{flag.x}}` `{{enemy}}` `{{ctx.damage}}` `{{trait.種族}}`（そのカテゴリの特性名）を差し込めます。会話の行は `{ "text": "...", "when": {...} }` にすると条件付きで表示されます。

## 特性・能力・アイテム・ルール

- **特性**（`database.json` › `traits`）: `category`（種族・職業など自由）、`statMods`、`abilities`（特性がある間だけ持つ能力）、`rules`、`onGrant`、`tags`。
- **能力**（`abilities`）: `statMods`、`rules`、`use`（技：`where` battle/field/both、`mpCost` / `spCost`、`cost` 変数コスト、`hpCost`、`when`、`effects`）。パッシブ枠を使う場合、`project.player.passiveCapacity` を設定し、能力ごとに任意の `passiveCost`（既定1）を指定します。メニューから枠内で付け外しできます。特性から得るパッシブ能力は常時有効です。
- **MP/SP** `project.player.stats.maxMp` / `maxSp` と仲間の `stats` に上限を設定すると最大値まで補充して開始し、HUD・戦闘・メニューに残量を表示します。技の `use.mpCost` / `spCost` と仲間の `actions[].mpCost` / `spCost` で消費し、効果 `recover` で主人公・仲間・全員を回復できます。レベル成長の `gains.maxMp` / `maxSp` と装備・特性の `statMods` にも指定でき、上限が増えたとき残量が上限いっぱいなら同じ状態を保ちます。未設定のゲージは表示されません。
- **アイテム**（`items`）: `heal`（簡易）、`use`（汎用、`consume`）、`statMods`・`rules`（持っているだけで効く）。
- **ルール**（能力・特性・アイテム・敵、または `rulesPath` の `rules.json`）: `on`（auto / step / tick / mapEnter / battleStart / turnEnd / dealDamage / takeDamage / lethalDamage / victory / defeat / **bump**（壁などにぶつかった）/ **examine**（調べたが何もなかった）/ **verb**（動詞を使った。`match` で動詞を指定）/ **signal**（シグナルを受けた。`match` 必須））、`when`、`chance`、`once`（battle / map / game）、`repeat`、`priority`、`modify`（damage / hp）、`effects`。詳しい使い方とレシピは [customization-guide.md](customization-guide.md) を参照。
- **敵**: `tags`（条件 `enemyTag` 用）、`actions[].when`（条件付き行動）、`actions[].effects`、`actions[].music`（その行動時のBGM。`null` で敵／プロジェクトの通常戦闘曲に戻す）、`rules`（その敵との戦闘中だけ有効）。
- **開始時**: `project.json` の `player.traits`（初期特性）と `intro`（新規ゲーム開始時の効果。種族選択など）。

## 世界の仕組み（エンティティ・領域・調べるタイル・時間・集合・周回）

- **エンティティ** `maps › entities[]`: `{ id, name, x, y, states: [{ when, name, sprite, marker, facing, solid, trigger, dialogue, event, effects, behavior }] }`。`states` のうち条件を満たす最初のものが有効で、どれも満たさなければ消える。`trigger`: action / touch / auto / none。`behavior`: still / wander{radius, every} / patrol{path, every} / chase{range, every} / flee{range, every}（単位はtick）。
- **領域** `maps › regions[]`: `{ id, label, x, y, w, h, when, onEnter, onLeave, onStep, inspect }`。条件 `{"inRegion": id}`。
- **調べるタイル** `tiles.json › tiles[].inspect`: `{ when, effects, otherwise }`。
- **集合** `project.json › sets`: `{ label, description, show, persist, entries }`。効果 `addToSet` / `removeFromSet` / `clearSet`、条件 `{"set", "has"}`、式 `{"size"}`、文中の `{{set.<id>}}`。組み込みの集合 `endings`（到達したエンディング、meta）。
- **周回** フラグ・変数・集合の `persist: "meta"` は、`newCycle` やゲームの再開をまたいで残る。式 `{"cycle": true}`、文中の `{{cycle}}`。`project.json › endings` と効果 `ending`（エンディング画面 → 閉じると次の周回）。
- **依頼帳** `project.json › quests` で依頼の題名・説明・目標を定義。効果 `quest` の `start` / `objective` / `complete` / `fail` で進行状況を記録し、メニューの「依頼帳」で確認。条件 `{ "quest": "herb-request", "status": "complete" }` で分岐できます。
- **持ち物** `project.json › inventory` の `maxItems` で個数上限、`sort`（`name` / `count`）で初期の並び順を設定。アイテムの `maxStack` で種類ごとの上限を設定します。上限を超えた取得は持てる数だけ追加し、戦闘・イベントログに結果を表示します。
- **敵の戦利品** `database.json › enemies[].drops` は `{ "item": "herb", "count": 1, "chance": 35 }` のように確率を設定できます。能力の `use.effects` に `{ "type": "steal", "chance": 60 }` を置くと、現在の敵から未取得の戦利品を一つ盗み、勝利時の通常ドロップから除外します。`{ "type": "inspectEnemy" }` は現在の敵のHP・攻撃・防御・残りドロップを戦闘ログに表示します。
- **会話送り** 設定メニューの「会話オート」で台詞後の自動送りを切り替えます。会話中に `S` キーを長押しすると、選択肢で止まりながら文章を読み飛ばします。
- **会話の既読** `dialogue` 効果で会話を開くと、会話IDがセーブデータの `seenDialogues` に記録されます。条件 `{ "seenDialogue": "elder-before" }` で初回／再訪の会話を分けられます。
- **マップ操作** マップをクリックまたはタップすると、通れる道を探して主人公が歩きます。NPCや調べられる仕掛けを選ぶと隣まで移動して調べます。設定メニューの「クリック移動」で切り替えられます。画面の操作説明も同じメニューで表示／非表示を選べます。
- **技・道具の説明** 戦闘中とメニューで説明・使用可否・所持数・設定したコストを見られます。項目のヒントはボタン上にマウスを置くと表示されます。
- **工房** 検証画面の「公開前の確認」はデータ検証・配布ビルド・外部素材の利用条件・クレジット・自動プレイテストの状況をまとめます。「イベントから試遊」で新しいゲームから指定イベントを実行できます。フォーム変更はトップバーのUndo/Redoボタンか Ctrl/⌘+Z・Ctrl/⌘+Y で戻せます。
- **遊びやすさ** 設定で文字を大きくする、動きを減らす、画面揺れを止める、色覚補助パターンを使う設定を切り替えられます。設定は端末ごとに保存されます。
- **音量** 設定メニューのBGM・効果音スライダーは個別に音量を調節し、端末ごとに保存します。
- **時間** `schedule {id?, after: 式(歩数), effects}` / `cancelSchedule {id}`。ルールの `on: "tick"`。式 `{"ticks": true}`。
- **その他の効果** `moveEntity {entity, mapId?, x, y, facing?}`、`startScene {system, scene, args}`（独自画面）、`signal {signal}`（シグナルを発信。`on: "signal"` で `match` が一致するルールがその場で動く）、`setPlayer {name?, sprite?}`（変身。`null` で元に戻す）。
- **動詞** `project.json › verbs`: `{ "listen": { "label": "耳を澄ます", "key": "l", "description": "…", "when": 条件, "effects": [...] } }`。フィールドのメニュー「こうどう」・画面のボタン・キーで使える。`on: "verb"` のルールも反応する。
  - `known: false` の動詞は効果 `learnVerb {verb}` で覚えるまで出てこない。`forgetVerb {verb}` で忘れる。`useVerb {verb, target?}` でデータから使わせる。
  - `target: { "from": "items" | "set" | "list", "set": "clues", "options": [{id,label}], "prompt": "何に？", "none": "使えるものがない。" }` を付けると、使う前に対象を選ぶ。選んだものは条件 `{ "target": "rune-order" }` と文中の `{{target}}`（ID）・`{{targetLabel}}`（名前）で使える。
- **シグナル** `project.json › signals`: `{ "whistle": { "description": "…" } }`。未宣言のシグナルは検証エラー。
- **装備** アイテムに `slot`（`project.json › equipmentSlots` の枠。既定は weapon 武器・armor 防具・accessory 装飾品）を付けると装備品になり、その `statMods` と `rules` は装備している間だけ効く（slot のないアイテムは今までどおり持っているだけで効く）。効果 `equip {item}`・`unequip {slot}`、条件 `{ "equipped": "bronze-sword" }`。最後の1つを手放すと外れる。プレイヤーはメニューの「どうぐ」で付け外しする。
- **複数の敵** 戦闘効果に `with: ["moss-slime", "cave-bat"]` を付けると、標準の戦闘で何体も同時に戦う。「たたかう」で相手を選び、生きている敵は全員が順に行動し、全員倒すと勝利（戦利品は全員分）。ルールやシステムから見た「敵」は、そのとき攻撃されている・行動している敵。
- **仲間** `database.json › companions`（`id`・`name`・`stats`・`actions`: kind attack / heal / guard・power・when・message、必要なら `mpCost` / `spCost`）。効果 `joinParty {companion}` / `leaveParty {companion}`。仲間は標準の戦闘で自分で行動し（誰かのHPが半分を切ると heal を優先）、敵は主人公か仲間を狙う。仲間の行動はリソース不足なら選ばれません。`heal` の `target`: `player`（既定）/ `party`（倒れた仲間も起こす）/ `all`。主人公が倒れると負け。仲間にも装備させられる（効果 `equip {item, companion}` / `unequip {slot, companion}`、メニューの「なかま」）。戦闘では「なかま」コマンドで、そのターンに仲間が使う行動を指示できる（指示しなければ自分で判断。指示はターン終了で消える）。
- **押す・運ぶ** エンティティの状態に `pushable: true`（歩いてぶつかると1マス押せる）、`carryable: true`（決定で持ち上げ、向いた先の空きマスで決定すると置く。別のマップへ運べる）、`onMoved`（押された・置かれた後の効果）。条件 `{ "entityAt": { "entity": "boulder", "x": 6, "y": 12, "map": "ruins" } }`（今どこにあるか。書いた項目だけ比べる）、`{ "carrying": "crate" }`。`moveEntity` の `mapId` は行き先のマップで、別のマップに定義されたエンティティも移せる。
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

`{ formatVersion, projectId, savedAt, state }`。`state` には現在地・向き・HP/MP/SP・基本能力値・能力・特性・アイテム・フラグ・変数・地形変更・発動済みルール・完了ID・乱数シード・システム用データを安定IDで記録します。後から追加された任意ゲージのない古いセーブも既定値で読み込めます。会話や戦闘の途中ではセーブできません。読込時はプロジェクトID・形式・マップの存在・座標を確認し、壊れていても例外にせず理由を表示して新規開始を選べます。v1セーブは読込時に変換します（元データは書き換えません）。後から追加したフラグは初期値で補います。

## 音

- `project.json` › `audio`: `battle`（戦闘BGM）、`victory`（勝利の音）、`sfx`（場面ごとの効果音: cursor / confirm / cancel / bump / hit / hurt / heal / encounter / victory / defeat / door / item / save / menu）、`volume`。
- マップの `bgm`、敵の `bgm`、効果 `playBgm`（`null` で無音、セーブに残る）・`playSfx`。
- **環境音**（川・風・雨など、BGMと重ねて流れる2本目のループ）: マップの `ambient`、効果 `playAmbient`（`null` で止める。セーブに残り、未設定ならマップの `ambient`）。戦闘中は止まる。
- **ループ位置**: 素材の `loopStart` / `loopEnd`（秒）。イントロを1回だけ流し、`loopStart`〜`loopEnd` を繰り返す（BGM・環境音とも）。
- 素材の種類 `bgm`・`sfx`（OGG/MP3/WAV）と `song`（楽譜BGM `.song.json`。書式は [asset-guide.md](asset-guide.md)）。

## 素材の出どころ（assets.json）

`origin`（original / generated / site / purchased / commission）、`sourceId`（取得元カタログのID）、`url`、`author`、`license`、`licenseUrl`、`credit`、`creditRequired`、`redistributable`、`termsCheckedAt`（YYYY-MM-DD）、`notes`、`request`（画像依頼ID）、`generator`。外部素材は sourceId・規約確認日・規約名（サイトならURLも）が必須です。`project.json` › `assetPolicy` で、取得元のON/OFF・共有用かどうか・入手方法の優先順・容量予算を決めます。詳しくは [asset-guide.md](asset-guide.md)。

## 画像シート

`tileWidth`・`tileHeight`・`columns`・`rows`（・`margin`・`spacing`）で寸法を宣言し、`rpg validate` がPNGの実寸と照合します。キャラクターは行＝向き（下・左・右・上）、列＝歩行フレーム。ソース64pxセルを32pxで、補間なしで描画します。

## スクリプト（`scripts/*.ts`）

`abilities[]`・`items[]`・`traits[]`・`enemies[]`・`companions[]`・マップ・エンティティの状態に `"script": "名前"` または `"script": { "id": "名前", "args": {...} }` を書くと、`scripts/名前.ts` のコードが付け先の有効な間だけ動きます。効果 `{ "type": "script", "script": "名前", "call"?: "アクション", "args"?: {} }` でも呼べます。詳しくは [scripting.md](scripting.md)。

## レベル・経験値（`project.json › leveling`）

書くとレベル制になります（書かなければレベルはありません。`rpg new` で作ったプロジェクトは最初から有効）。

```json
"leveling": { "maxLevel": 30, "base": 8, "growth": 1.3, "gains": { "maxHp": 4, "maxMp": 2, "maxSp": 1, "attack": 1, "defense": 1 },
              "learn": [ { "level": 3, "ability": "fire" } ], "fullHeal": false }
```

- 次のレベルまでの経験値: `expTable[レベル-1]`（書いた場合）、なければ `round(base × growth^(レベル-1))`。
- `gains.maxMp` / `gains.maxSp` は省略時0。レベルアップ時に上限が増えた量だけ補充します。`fullHeal: true` は有効なHP・MP・SPをすべて最大まで戻します。
- 勝つと倒した敵の `exp` の合計が入る（敵に `exp` がなければ `round((最大HP + 2×攻撃 + 2×防御) / 3)`）。
- 効果 `{ "type": "gainExp", "amount": 20 }`、式 `{ "level": true }` / `{ "exp": true }`、自動テストの `expect.level`。

## タイトル画面とセーブ（`project.json › titleScreen` / `autosave`）

- `"titleScreen": { "enabled": true, "subtitle": "…", "background": "背景素材ID" }` — 書き出したゲームは「はじめから／つづきから／クレジット」のタイトル画面で始まる（工房の試遊では出ない）。
- `"feedback": { "url": "https://example.com/feedback", "label": "不具合を報告" }` を設定すると、タイトル画面とゲーム内メニューにリンクを表示。押したときだけブラウザの別タブで開き、セーブデータやプレイ情報は送信しません。URLはHTTPSのみ。`label` は省略でき、既定は「フィードバックを送る」。
- セーブはスロット3つと「オート」（`"autosave": true` のとき、マップに入るたびに自動保存）。セーブはファイルに書き出し・読み込みもできる。
- `project.json › version`（任意。例 `"1.0.0"`）: ゲームの版。セーブに `gameVersion` として記録される。古い版のセーブを読むとき、新しく宣言したフラグ・変数・集合には初期値を入れ、今の版にないアイテム・技・特性・仲間・依頼・スキルボードのパネルの記録は外す（`readSave` の `notes` に残る。セーブ地点のマップがないセーブは読めない）
- `releases/<版>/saves/*.json`: `pnpm rpg release snapshot` が残す、その版のセーブ見本（自動テストを通して遊び、セーブできる場面）。`pnpm rpg release-check` が今の版で読み込んで動かし、読めないものを「不可」、記録を外したものを「注意」にする。ゲームには含まれない

## お店と宿屋（`shop` モジュール）

アイテムに `"price"` を書き、`{ "type": "startScene", "system": "shop", "scene": "buy", "args": { "items": [ { "item": "herb" }, { "item": "iron-sword", "price": 60 } ], "currency": "gold" } }`。売るときは `sellRate`（既定0.5）倍。店と持ち物メニューでは装備前後の能力差を表示。宿屋は `"scene": "inn", "args": { "price": 10 }`（全員全回復）。`project.json › modules` に `"shop": {}` が必要。

## 状態異常・強化・属性（`database.json › statuses`、`project.json › elements`）

```json
"statuses": [
  { "id": "poison", "name": "毒", "label": "毒", "turns": 5, "damage": 2, "clearAfterBattle": false },
  { "id": "sleep", "name": "眠り", "turns": 3, "skipChance": 100, "wakeOnHit": true, "onEnd": "{{name}}は目を覚ました。" },
  { "id": "atk-up", "name": "攻撃力アップ", "label": "攻↑", "turns": 3, "statMods": { "attack": 3 } },
  { "id": "silence", "name": "沈黙", "turns": 2, "noSkills": true }
]
```

- できること: ターンの終わりのダメージ（`damage`）・回復（`heal`）、行動できない確率（`skipChance`: 100 = 眠り・停止、50 = 麻痺）、攻撃を受けると治る（`wakeOnHit`）、技を封じる（`noSkills`）、能力値の増減（`statMods`）、戦闘後も残す（`clearAfterBattle: false`）。
- 効果 `{ "type": "addStatus", "status": "poison", "target": "player" | "enemy" | "enemies" | "party", "turns": 3, "chance": 50 }` / `{ "type": "removeStatus", "status": "poison", "target": "player" }`（status を省くと全部）。条件 `{ "status": "poison" }`（`"target": "enemy"` で今の敵）。
- 敵の `immune`（効かない状態異常）。
- 属性: `project.json › elements: { "fire": { "label": "炎" } }`。敵の `resist: { "fire": 150 }`（150 = 弱点、50 = 半減、0 = 無効）、武器の `element`（通常攻撃の属性）、防具・装飾品の `resist`（受けるダメージ）、効果 `damage` の `element`。弱点・半減は戦闘ログに「弱点！」などと出る。
- 自動テスト: `expect.statuses` / `expect.lacksStatuses`。見本: `projects/genre-gallery/tests/status.scenario.json`。

## 体験版（project.json の demo）

- `"demo": { "endWhen": { "flag": "reached-forest" }, "title": "体験版はここまで", "text": "…" }`: 書き出すときだけ、endWhen が成り立った時点で「体験版はここまで」のエンディングになる（自動ルールを1つ足す）。完成版のデータは変わらない。`pnpm rpg build --demo [--zip]`（出力は dist/game/<id>-demo）

## 販売・素材パックのための記録

- 素材（`assets.json` の各素材）の `commercial: true | false`: 人が規約を読んで「このゲームを売ってよいか」を記録する。未記録なら取得元カタログの `commercial`（allowed / prohibited / varies / unknown）で判定し、varies・unknown は販売前チェックで「要確認」
- 取得元カタログ（`packages/schema/src/asset-sources.json`）の `commercial`・`publicRepository`・`inquiries`
- `pnpm rpg release-check --project <dir>`（「不可」があれば終了コード1）、`pnpm rpg asset pack --project <dir> --title … --author … [--ids | --kinds] [--license cc0|cc-by-4.0|terms --terms-file …] [--out …]`

## 作業カード・台本・仕様書（チャットで作る）

- `todo.json`: `{ "formatVersion": 1, "cards": [{ "id", "title", "goal", "status": "todo"|"doing"|"done", "links": ["npc:village/cat", "dialogue:cat-talk"], "doneWhen": { "test": "tests/cat.scenario.json", "check": "…" }, "notes" }] }`。壊れていてもゲームは動く（検証は警告）
- `SCRIPT.md`（台本）・`SPEC.md`（仕様書）: 見出しごとの場面・決まりごと。依頼文に関係する所が入る
- AIの返事の形式（`rpg-change`）と流れは `docs/chat-workflow.md`。`pnpm rpg chat cards|card|plan|pack|apply`

## v2.4 の追加

- `project.json › party.follow`（既定 true: 仲間が後ろをついて歩く）、仲間の `chat: [{ "when"?: 条件, "text": "…" }]`（メニューの「はなす」で条件に合う最後の一言）
- `project.json › display: { "tileSize": 16 | 24 | 32 | 48 | 64 }`（既定 32。画面上の1マスの大きさ）
- `project.json › battle.order: "ctb"`（カウントタイム。素早さでゲージがたまり、速い者ほど多く行動。戦闘画面に次の行動順）
- 台詞の行 `{ "text": "…", "voice": "<効果音素材>" }`、効果 `message` の `voice`
- 素材 `kind: "font"`（`assets/fonts/`。woff2・woff・ttf・otf）と `project.json › ui.fontAsset`
- `pnpm rpg map generate <id> --project <dir> [--width 32 --height 24 --seed 1 --rooms 8 --floor . --wall # --title … --enemies a,b --rate 0.08 --back map:x:y]`（エンジンの `generateDungeon()`。同じシードなら同じ形）
- `pnpm rpg art generate --style standard|retro|pastel|dusk|mono [--out <フォルダ>]`（標準以外は --out 必須。library.json の `generator.style` に記録）
- `pnpm rpg asset catalog check [--days 180] [--json]` / `pnpm rpg asset catalog verify <id> --read-terms [--date --summary --credit-required --redistribution --automated-download --notes]`（`verifiedAt` は人が原文を読んだときだけ。project.json の `customSources` はそちらを更新）

## v2.3 の追加

- マップの `edges: { "east": { "mapId": "field2", "offset": 0 }, "west": …, "north": …, "south": … }`: 端から歩き出すと隣のマップへ（同じ行・列 + offset）。`"wrap": true` で丸い世界
- `project.json › vehicles: { "boat": { "name": "小舟", "sprite": "<キャラ素材>", "crosses": ["~"], "encounters": false, "start": { "mapId", "x", "y" } } }`。`crosses` は進めるタイルの記号（`"*"` で全部＝飛空艇）。向かって決定で乗る／降りる。効果 `board`・`disembark`・`placeVehicle`
- `pnpm rpg new <名前> --stage 1|2|3`、`pnpm rpg devlog --project <dir> [--days 7] [--out DEVLOG.md]`、`pnpm rpg sample reset --project projects/<id> [--write]`

## v2.2 の追加

### スキルボード（`database.json › skillBoards`）

```json
{ "id": "sword", "name": "剣", "owner": "hero", "nodes": [
  { "id": "s1", "name": "攻撃+2", "q": 0, "r": 0, "cost": 1, "start": true, "icon": "攻+2", "statMods": { "attack": 2 } },
  { "id": "s2", "name": "渾身斬り", "q": 1, "r": 0, "cost": 2, "abilities": ["power-strike"] },
  { "id": "s7", "name": "秘伝", "q": 2, "r": 1, "cost": 3, "statMods": { "attack": 5 }, "hidden": { "flag": "knight-joined" } }
] }
```

- 位置は六角形の座標 `q`・`r`（隣は (±1,0)・(0,±1)・(+1,−1)・(−1,+1)）。`start: true` か、覚えたパネルの隣なら覚えられる（`requires: [...]` を書くとそちらが優先）
- パネル: `cost`・`statMods`・`abilities`（主人公）・`traits`（主人公）・`effects`（覚えたとき1回）・`hidden`（条件まで「？」）・`icon`（2〜4文字）
- `owner` は `"hero"` か仲間のID（仲間は能力値と効果）。ポイントは `project.leveling.skillPoints`（レベルアップごと、主人公と仲間全員に）と効果 `giveSkillPoints`（`who`: hero・仲間・all）。`resetSkills` で全部戻してポイントを返す
- シナリオテスト: `{ "learnSkill": "sword/s2" }`、`expect` の `skillsLearned`・`skillPoints`

### そのほか

- 効果 `{ "type": "summon", "companion": "<仲間>", "turns": 3 }`（戦闘中だけ。終わると去る）
- 効果 `battle` の `practice: true`（練習試合）
- `project.player.looks: [{ "id", "label", "sprite", "name"?, "effects"? }]` と `lookPrompt`（新しいゲームの最初に選ぶ）

## v2.1 の追加

- 効果 `{ "type": "camera", "focus": { "x": 5, "y": 3 } | "player", "zoom": 2, "ms": 600, "shake": { "power": 6, "ms": 400 } }`
- `animation`（`slash`・`pierce`・`hit`・`magic`・`fire`・`ice`・`thunder`・`heal`・`explosion`・`poison`）: 武器（アイテム）・技やアイテムの `use`・敵の行動
- 素材の `duck: true`: 鳴っている間BGMを下げる（ME）。`audio.victory` は自動
- 特性の `group`（同じ組は1つだけ。職業なら `"job"`）・`selectable`・`selectableWhen`: メニューの「しょくぎょう」で転職
- `project.json › menu: { "order": ["items", "jobs", ...], "hidden": [], "when": { "jobs": 条件 }, "labels": { "items": "持ち物" } }`（キー: party・traits・jobs・items・abilities・commands・verbs・records・set:<ID>）
- シナリオテスト: `{ "optimize": "hero" }`（さいきょう装備）、`{ "chooseTrait": "<ID>" }`（転職）

## v2.0 の追加

- マップの `parallax: { "image": "<背景>", "speed": 0.3 }`: 遠景。下の層を `" "`（空白）にしたマスから見える（歩けない）。`fog: { "image", "opacity", "speedX", "speedY" }`: 霧・雲が流れる
- マップの `tints`: 条件に応じて画面全体へ色を重ねる（夕焼け・夜・洞窟など）。各項目は `color`（`#RRGGBB`）と `opacity`（0〜0.8）、任意の `when` 条件を持つ。宣言済み変数を使う例: `{ "when": { "var": "hour", "op": ">=", "value": 18 }, "color": "#263552", "opacity": 0.32 }`。時間変数の進行・更新はプロジェクト側で設定し、条件を満たした色が順に重なります（最大8件）
- タイルの `stepEffect`（`dust`・`splash`・`footprints`・`leaves`）、`footstep`（効果音）、`encounterRate`（そのマスのエンカウント率。マップの `encounters` が必要）
- `project.json › party: { "size": 3, "backRowTaken": 50, "backRowDealt": 50 }`: 戦う仲間の人数（超えたら控え）と後列の割合。効果 `{ "type": "setFormation", "who": "hero|<仲間>", "row": "front|back", "reserve": true }`
- `project.json › ui: { "window", "edge", "text", "accent", "radius", "font": "dot|gothic|mincho|rounded", "frame": "<画像>", "frameSlice": 12 }`
- `project.json › gameOver: { "mode": "respawn|screen", "message", "respawn": { mapId, x, y }, "title", "text", "image", "music", "retry", "penalty": { "var": "gold", "percent": 50 } }`。`mode: "screen"` で `retry: true` の場合、ゲームオーバー画面から戦闘直前の状態（HP/MP/SP全回復）で再戦でき、敵の攻撃・防御を25%下げる再戦も選べます。戦闘前の状態は現在のゲームエンジン内だけに保持され、ページ再読み込みやセーブ読込後は戦闘再挑戦は出ません。「拠点から再開」は従来どおり使えます。
- `pnpm rpg find <文字> --project <dir> [--regex] [--case] [--replace <新しい文字> --write]`: データの文章を横断検索・置換

## v1.9 の追加

- タイルの `walls: ["down"]` など: その辺に壁がある。そちらへ出られず、反対側からも入れない（崖の縁・柵・カウンター）
- `project.json › minimap: { "enabled": true, "size": 120 }`（N キー・設定で切り替え）。マップの `minimap: false` で隠す
- 効果 `battle` の `waves: [{ "enemy": "...", "with": ["..."] }]`: 連戦。HPと状態はそのまま次の群れへ、最後の群れで勝利
- `project.json › audio.textSound: true`: 文字送りの音（`audio.sfx.text` で差し替え）
- `shop` モジュール: `craft`（`recipes: [{ item, count, needs: [{ item, count }], cost }]`）、`storage`（`box`・`capacity`）
- ルール・イベント・NPC・仕掛けの `disabled: true`: 消さずに一時的に止める（検証で警告）
- `pnpm rpg proofread --project <dir>`: 台詞がウィンドウ（全角約40字×3行）に収まるか、記号の重なり、同じ助詞の連続、かっこ・装飾の閉じ忘れ

## 戦闘の細かい設定（v1.8）

- `project.json › battle`: `order`（`"fixed"` 主人公→仲間→敵／`"speed"` 素早さ順。画面に行動順）、`playerSpeed`（式。既定10）、`critical: { chance（式・%）, multiplier（%・既定150） }`、`playerEvasion`（式・%）
- 敵: `speed`（既定10）、`evasion`（主人公の攻撃をかわす%）、`critical`（痛恨の一撃%）。行動に `target: "all"`（全員）、`hits`（回数）
- 仲間: `speed`
- 効果 `damage`: `target` に `"enemies"`（立っている敵全員）・`"randomEnemy"`（1回ごとにランダム）、`hits`（回数）

## 文字の装飾・一枚絵・文字入力

- 文中の装飾: `[c=red]…[/c]`（red・blue・green・yellow・gray・gold・white・purple・pink・#rrggbb）、`[b]`、`[big]`、`[small]`、`[shake]`、`[wave]`、`[w=500]`（文字送りの間・ミリ秒）、`[se=効果音ID]`。ルビ `{漢字|かんじ}` と併用できる。知らない `[…]` はそのまま表示
- `{"type":"showPicture","image":"<背景・顔・敵の絵>","at":"center|left|right|full","slot":"main"}`（`x`・`y`・`width` は画面の%、`opacity`、`fadeMs`）、`{"type":"hidePicture","slot":"main"}`（`slot` なしで全部）
- `{"type":"input","prompt":"名前は？","saveAs":"name"}` で主人公の名前。`saveAs` にほかのIDを書くと `{{text.<ID>}}` で使える。合言葉は `answers: [{ "match": ["ひらけごま"], "effects": [...] }]` と `otherwise`（全角半角・大文字小文字・空白は無視）。シナリオテストでは `{ "input": "ひらけごま" }`

## 図鑑と実績

- `project.json › book`: `{ "enemies": true, "items": true, "hidden": [] }` でメニューに「図鑑」。出会った敵（倒すと能力も表示）と手にしたアイテム
- `project.json › achievements`: `{ "<ID>": { "title", "description", "when": 条件, "hidden": false } }`。条件が成り立つと自動で達成して通知。効果 `unlockAchievement` でも達成。図鑑と実績は新しいゲームにも引き継ぐ
- シナリオテストの `expect`: `achievements`、`bookSeen`、`bookDefeated`

## タイルのキー（`tiles.json › tiles[].key`）

ライブラリから取り込んだタイルには、画像の中での名前 `key`（例 `carpet-red-c`）が付く。`rpg library add <シート> --project <dir> --replace` は「画像（atlas）＋キー」で既存のタイルを見つけ、シートの並びが変わっていれば `index` だけを新しい番号に直す。マップが使う1文字の記号は変わらないので、地図は崩れない。キーのない古い定義は、番号と名前が一致すればキーを覚える。

## オートタイル・動くタイル・レイヤー

- **オートタイル**（`tiles.json` のタイルに `autotile`）: 同じ `group` のタイル同士がつながる。`pieces` に9枚組（`tl` `t` `tr` `l` `c` `r` `bl` `b` `br` のアトラス番号）を書くと、1つの記号で塗った範囲の角・辺・中央が自動で選ばれる。`border: "#335577"` は絵がなくても縁に線を引く（道・水辺）。ライブラリの「赤の絨毯（自動でつながる）」がその見本。
- **動くタイル**: `"frames": [47, 48, 49], "frameMs": 250`（同じアトラスの番号を順に表示）。ライブラリの「浅い水（動く）」。
- **レイヤー**（マップに `layers`）: `[{ "id": "decor", "above": false, "rows": [...] }, { "id": "upper", "above": true, "rows": [...] }]`。行は地面と同じ大きさで、空白 `" "` は何もなし。`above: false` は地面の上に重ねる物（通れないタイルなら道をふさぐ）、`above: true` はキャラの頭上に描く（屋根・木の葉、道はふさがない）。工房のマップ画面の「層」で塗る層を選べる。

## 演出: フキダシ・顔グラフィック・移動ルート

- **フキダシ** `{ "type": "emote", "target": "player" | NPCのID | エンティティのID, "icon": "！" }` — 頭上に1.5秒ほど表示（「？」「♪」「…」「♥」など短い文字なら何でも）。
- **顔グラフィックと表情**: 会話に `"portrait": "素材ID"`（portrait か character の素材。コマ＝表情）、行ごとに `{ "text": "…", "face": 2 }`。メッセージ効果にも `"portrait"` と `"face"`。
- **移動ルート** `{ "type": "moveRoute", "target": "player" | エンティティのID, "steps": ["up", "up", "left", "face:down", "wait"], "wait": true, "through": false }` — 1歩ずつ歩く。`wait: true` なら歩き終わるまで次の効果とプレイヤーの操作を止める（イベントの演出）。`through: true` で壁を通り抜ける。NPCは位置が決まっているので、動かしたい人物はエンティティで置く。自動テストでは `{ "routes": "finish" }` で最後まで進める。見本: `projects/genre-gallery/tests/cutscene.scenario.json`。


## 配布版の読み込みとホーム画面（`rpg build`）

- 起動時に画像と音をすべて先に読み込み、「読み込み中… N%」を表示してからタイトル画面へ。
- `manifest.webmanifest`・`icon.svg`・`sw.js` を自動で書き出す。http(s) で公開すると、スマホの「ホーム画面に追加」でアプリのように起動でき、一度開けばオフラインでも遊べる。版（`version.json`）が変わると古いキャッシュは自動で入れ替わる。`file://` で開いたときや `?debug` のときは使わない。
- 描画確認では、配布版または試遊画面のURLに `?fps` を付けるとFPS・平均フレーム間隔・1フレームの処理時間を画面右上に表示する。`?debug` でも同じ表示が出る。`?fps` はサービスワーカーを無効にしない。

# プロジェクト形式 v2

正本は `projects/<id>/` のGit管理ファイルです。型と実行時スキーマは `packages/schema/src/formats.ts`（Zod）が唯一の定義で、`rpg validate` と工房が同じ検証（`loadProjectContent`）を使います。

| ファイル | 内容 |
| --- | --- |
| `project.json` | `formatVersion: 2`、安定ID、タイトル、`start`（マップ・座標・向き）、`player`（名前・スプライト・能力値・初期能力・初期アイテム）、**`flags`（使う全フラグの宣言）**、各ファイルへの参照、`systems` |
| `tiles.json` | タイルコード（1文字）→ 名前・アトラス番号・通行可否・`passableWhen`（条件で通れる）・`openIndex`（開いた時の絵）・代替色 |
| `maps/*.json` | `rows`（タイルコードの文字列）、`npcs`、`portals`、`interactables`、任意の `encounters` |
| `dialogues/*.json` | 会話（話者・行・最後の `effects`・`choices`） |
| `events/*.json` | イベント（`when` 条件・`effects`・`otherwise`・`once`・`afterDone`） |
| `database.json` | 能力・アイテム・敵 |
| `assets.json` | 素材ID・パス・種別・寸法・出典（素材形式は v1 のまま） |
| `systems/*.ts` | データで表せない独自ルール（[extension-api.md](extension-api.md)） |
| `tests/*.scenario.json` | 自動プレイテスト（[scenario-tests.md](scenario-tests.md)） |

## 条件（Condition）

```jsonc
{ "flag": "sentinelCalmed" }            // フラグがtrue（"is": false で偽を判定）
{ "ability": "beast-trail" }            // 能力を持つ
{ "item": "herb", "atLeast": 2 }        // アイテムを2個以上
{ "done": "sentinel-battle" }           // 完了済み（onceイベントID、"会話ID/選択肢ID"、markDoneのID）
{ "all": [ ... ] } / { "any": [ ... ] } / { "not": { ... } }
```

使えるのは `project.json` の `flags` に宣言したフラグだけです。打ち間違いは検証エラーになります。

## 効果（Effect）

上から順に実行します。`message`・`dialogue`・`battle` は画面を止め、プレイヤーが閉じた後に残りが続きます（効果キュー）。

| type | 例 |
| --- | --- |
| `message` | `{ "type": "message", "text": "扉が開いた。", "speaker": "門番" }` |
| `setFlag` | `{ "type": "setFlag", "flag": "gateOpen", "value": true }` |
| `unlockAbility` | `{ "type": "unlockAbility", "ability": "beast-trail" }`（重複しない） |
| `giveItem` / `takeItem` | `{ "type": "giveItem", "item": "herb", "count": 2 }` |
| `heal` | `{ "type": "heal" }`（量省略で全回復） |
| `teleport` | `{ "type": "teleport", "mapId": "ruins", "x": 3, "y": 9, "facing": "right" }` |
| `dialogue` | `{ "type": "dialogue", "dialogue": "elder-before" }` |
| `battle` | `{ "type": "battle", "enemy": "stone-sentinel", "canFlee": false, "onDefeat": "respawn" }`。勝てば後続の効果が続き、負け・逃走ではキューを破棄（イベントの`once`は完了扱いにならず再挑戦できる） |
| `markDone` | `{ "type": "markDone", "id": "elder-thanks" }` |
| `if` | `{ "type": "if", "when": {...}, "then": [...], "else": [...] }` |
| `system` | `{ "type": "system", "system": "my-rules", "action": "pray", "args": {...} }`（TypeScriptのアクションを呼ぶ） |

## マップの配置物

- **NPC**: `dialogues` は上から順に `when` を満たす最初の会話を使います（無条件の既定を最後に）。`visibleWhen` で出現条件。NPCは通れません。
- **出入口 (portal)**: 踏むと `targetMapId` の `targetX/Y` へ。`when` で通行条件。
- **仕掛け (interactable)**: `trigger: "action"`（向いて調べる／足元を調べる）か `"touch"`（踏む）。`solid` で通行不可、`marker` で見た目（`sparkle`・`sign`・`chest`・`statue`・`none`）。
- **encounters**: `{ "rate": 0.08, "enemies": [...], "tiles": ["i"] }` 1歩ごとの出現率と対象タイル。

## 戦闘

ダメージ = `max(1, 攻撃力 + 技の威力 − 防御力 ± 1)`。ぼうぎょ中は半分。敵の `actions` はターンごとに順番に使われ、`power: 0` は攻撃しない技（予告・溜めなど）。処理順は「①ダメージ計算 → ②`modifyDamage` → ③致死判定・`onLethalDamage` → ④HP確定」で固定です。

## 形式バージョンと移行

- `formatVersion` は保存形式のバージョンで、エンジンのリリース番号（`ENGINE_VERSION`）とは別です。
- 未対応の形式は元ファイルを変更せずに診断します。
- v1→v2: `pnpm rpg migrate --project <dir>` で差分と手作業項目を表示（dry-run）。`--write` を付けると、元ファイルを `.rpg-backup/v1-<日時>/` に保存し、新形式で検証できた場合だけ書き込みます。途中で失敗したら元に戻します。移行関数は純粋・決定的で、v1 fixture（`tests/fixtures/v1-sample`）でテストしています。
- v1の `systems/*.ts`（`unlockBeastTrail` 等の専用フック）は自動変換できないため、移行結果に手作業項目として表示されます。

## プレイヤーセーブ（形式 v2）

`{ formatVersion, projectId, savedAt, state }`。`state` には現在地・向き・HP・能力値・能力・アイテム・フラグ・完了ID・乱数シード・システム用データを安定IDで記録します。会話や戦闘の途中ではセーブできません。読込時はプロジェクトID・形式・マップの存在・座標を確認し、壊れていても例外にせず理由を表示して新規開始を選べます。v1セーブは読込時に変換します（元データは書き換えません）。後から追加したフラグは初期値で補います。

## 画像シート

`tileWidth`・`tileHeight`・`columns`・`rows`（・`margin`・`spacing`）で寸法を宣言し、`rpg validate` がPNGの実寸と照合します。キャラクターは行＝向き（下・左・右・上）、列＝歩行フレーム。ソース64pxセルを32pxで、補間なしで描画します。

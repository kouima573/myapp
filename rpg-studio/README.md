# RPGシステム工房 v0.3

Codex／Claude Code が **Git管理のファイルを直接編集して** 2DトップダウンRPGを作り、人がブラウザの工房でマップを手直し・試遊・検証するためのローカル制作環境です。工房にLLMは内蔵せず、AI APIキーも不要です（エージェント自体の契約は別途必要な場合があります）。

```
エージェント（Codex / Claude Code）──┐
                                     ├─▶ projects/<id>/*.json, systems/*.ts（正本）
人（ブラウザの工房） ────────────────┘            │
                                                   ▼
             rpg validate / rpg test（自動プレイ）/ rpg build ─▶ dist/game/<id>/（静的HTMLゲーム）
```

## まず試す

Node.js 22+ と pnpm 10.18.0（`corepack enable`）を使います。

```sh
pnpm install
pnpm studio                      # 工房: http://127.0.0.1:4173/ （projects/sample-rpg を編集）
pnpm rpg dev                     # 完成版ゲームだけを試遊: http://127.0.0.1:4174/
```

`pnpm dev` は Vite の Preview モードで工房UIを起動します（サンプルを画面上で試すだけ。ファイルには保存されません）。

## CLI（非対話・終了コードで判定）

| コマンド | 内容 |
| --- | --- |
| `pnpm rpg validate --project <dir>` | 形式・ID参照・フラグ宣言・座標・タイル・素材ファイル（PNG寸法）を全ファイル横断で検証 |
| `pnpm rpg test --project <dir>` | 検証＋独自システムの読込＋`tests/*.scenario.json` の自動プレイ |
| `pnpm rpg build --project <dir>` | 型検査 → bundle → `dist/game/<id>/` に静的ゲームを出力（失敗時は前回の成果物を保持） |
| `pnpm rpg dev --project <dir>` | ビルドして配信。保存で自動再ビルド・再読込 |
| `pnpm rpg migrate --project <dir> [--write]` | 旧形式(v1)の移行。既定は差分表示のみ。`--write` で `.rpg-backup/` に退避してから保存 |
| `pnpm rpg catalog --project <dir>` | 定義済みのフラグ・変数・特性・能力・ルール・マップ等の一覧（AIへの説明用） |
| `pnpm rpg schema [--check]` | `schema/*.schema.json`（エディター・AI向けJSON Schema）の生成／最新確認 |
| `pnpm test` / `pnpm check` | エンジン・スキーマ・移行・ローカルサーバー安全性のユニットテスト／型検査 |

問題の行は必ず `ERROR` / `WARN` で始まり、`ファイル › 場所: 内容` の形で出ます。例:
`ERROR events/events.json › events[open-ruins-shortcut].effects[0]: 未宣言のフラグ 'ruinsShortcutOpne' を設定しています`

## 自由にカスタマイズする

エンジンには決まった種族・効果・ゲームルールはありません。**部品**だけがあり、その組み合わせで作ります（詳しくは [docs/customization-guide.md](docs/customization-guide.md)）。

| 部品 | できること |
| --- | --- |
| フラグ・変数 | 名前は自由（宣言のみ必要）。お金・気力・好感度・評判・時間・カウンターなど |
| 式 | 変数・能力値・ダメージ等の四則演算、割合、最小・最大、条件分岐 |
| 条件 | フラグ、変数の比較、特性、能力、アイテム、完了、マップ、敵・敵タグ、戦闘中か、およびその組合せ |
| 効果（25種） | 変数操作、乱数、確率分岐、能力値変更、特性・能力の付け外し、ダメージ・回復、地形の書き換え、選択肢（店など）、イベント呼び出し、戦闘制御 … |
| 特性 | 種族・職業・祝福・呪いなど（カテゴリ自由）。能力値補正・能力・ルール・付与時の効果 |
| ルール（トリガー） | auto / step / mapEnter / battleStart / turnEnd / dealDamage / takeDamage / lethalDamage / victory / defeat。確率・回数制限・優先順位・ダメージ書き換え |
| 技・アイテム使用 | 変数コスト（MP等）・HPコスト・使用条件つき |
| 地形の変化 | フラグで切り替わるオーバーレイ、セーブに残る `setTile` |
| TypeScript | 上で書けないものだけ（`defineSystem`）。エンジン自体の改造も可 |

種族や効果の**中身**は、作り手が仕様を用意してCodex／Claude Codeに作らせる前提です。工房の「検証」画面に依頼文のひな形があり、`pnpm rpg catalog` でAIに既存の定義を伝え、`schema/*.schema.json` がエディターの補完を効かせます。サンプルでは、種族選択・技・店・ゴールド・気力・撃破ボーナス・地形変化をすべてJSONだけで作っています。

## 構成

| 場所 | 役割 |
| --- | --- |
| `projects/<id>/` | ゲームの正本。`project.json`・`tiles.json`・`database.json`・`maps/`・`dialogues/`・`events/`・`assets.json`・`systems/*.ts`・`tests/*.scenario.json` |
| `packages/schema/` | データ形式v2（Zod）、横断検証、v1→v2移行 |
| `packages/engine/` | 描画に依存しない純粋なゲームエンジン（移動・条件・効果キュー・会話・戦闘・セーブ・拡張フック）とシナリオ実行 |
| `packages/runtime/` | Canvas描画・入力・メッセージ／選択肢／戦闘／メニューUI。**工房の試遊と静的ビルドが同じコードを使う** |
| `packages/cli/` | validate / test / build / dev / migrate |
| `packages/local-server/` | 127.0.0.1限定のファイルAPI・監視・ビルド・テスト |
| `studio/` | 工房UI（React）：マップ編集・試遊・データ編集・検証 |
| `docs/` | 形式・拡張API・シナリオテスト・安全性・素材依頼 |

## v0.3の変更

- 変数（整数、範囲・HUD表示つき）と式、比較条件、特性（種族など）、データで書けるルール（10種のトリガー）、技とコスト、条件付きの敵行動・敵タグ、選択肢効果（店）、地形オーバーレイと `setTile`、文章への値の差し込み、条件付きの会話行を追加しました。
- 不屈の魂はTypeScriptのフックからデータのルールに移しました。サンプルでTypeScriptを使うのは「旅の日誌」だけです。
- 形式はv2のまま上位互換（新項目はすべて省略可能）。0.2のセーブもそのまま読めます。
- `rpg catalog`、`rpg schema`、工房の依頼文プリセット、試遊パネルでの変数・特性の切り替えを追加しました。

## v0.1からの主な変更（問題点と対応）

v0.1は「サンプルが動く」状態でしたが、エンジン・工房・静的ビルドの各所にサンプル固有の値が直書きされ、目的（エージェントが自由にルールを足せる・同じ内容がどこでも同じに動く）を満たしていませんでした。

| v0.1の問題 | v0.2の対応 |
| --- | --- |
| エンジンに `beast-trail`・`ruinsShortcutOpen`・タイル`g`・開始座標(3,9)・HP18 が直書き。別のゲームを作れない | 開始位置・主人公・フラグ・タイル通行ルール・能力・アイテム・敵をすべてデータ化。エンジンにサンプルのIDは一切ない |
| 静的ビルドがエンジンを約900行の**文字列で再実装**。ダメージ値も工房と別（3 vs 5/22） | `packages/runtime` を工房と静的ビルドで共用。ゲームロジックは1か所 |
| 工房UIにも「獣道を解放しました」等のメッセージやダメージ22が直書き | 文言・数値はすべてデータから |
| `GameSystem` 拡張契約が定義されているのに未使用。サンプルは専用フック名(`unlockBeastTrail`) | `defineSystem` のフック（`onLethalDamage`・`modifyDamage`・`canPass`・`actions` 等）に統一し、処理順を文書化 |
| 戦闘はボタン1つの仮実装。敵データなし、「テスト用に継続中」 | ターン制戦闘（たたかう／ぼうぎょ／どうぐ／にげる）、敵の行動パターン・予告技・ドロップ、勝敗後の処理、ランダムエンカウント |
| 遺跡の「別ルート」は岩門が開けた床の中央に1マスあるだけで、実は迂回できた | 遺跡を作り直し、近道（獣道）と魔物の出る長い回り道に分岐 |
| 会話は条件分岐不可。once判定が会話単位 | NPCごとの条件付き会話、選択肢の表示条件、選択肢単位のonce（報酬の重複なし）、`if`効果 |
| フラグ名の打ち間違いが検出されない | `project.json` の `flags` に宣言必須。未宣言参照は検証エラー |
| 工房の画像表示がバンドルされたサンプル画像に固定 | 開いているプロジェクトの素材をローカルAPIから読み込み |
| 画面からの編集はタイルとNPCのみ。Undoはタイルのみ | 出入口・仕掛け・開始位置の配置とドラッグ移動、塗りつぶし・スポイト、全マップ編集をUndo対象に |
| 形式移行は「将来やる」 | v1→v2 の決定的な移行関数・fixtureテスト・`rpg migrate`（dry-run・バックアップ・検証後のみ保存・失敗時ロールバック） |
| ゲームの動作確認がブラウザ頼み | `tests/*.scenario.json` で歩く・話す・選ぶ・戦う・セーブ復元を自動検証（`rpg test`） |
| Manusテンプレートの不要な依存（AWS SDK、MySQL、tRPC、OAuth等） | 依存を工房に必要なものだけに削減 |
| ローカルサーバーがプロジェクトJSONを決め打ちで読み、エンジンパスの相対importに依存 | マニフェスト駆動で読込。プロジェクトは `@rpg/engine` を import し、置き場所に依存しない |

## 安全性（ローカルサーバー）

127.0.0.1のみで待ち受け、Host／Origin（CORSなし）／起動ごとのトークン／正規化パス／拡張子／シンボリックリンク・ジャンクション拒否／サイズ上限を全リクエストで検査します。保存はSHA-256の競合検出付きで、ファイル単位に直列化して一時ファイルから置換します。任意のコマンドを実行するAPIはありません。詳細は [docs/security.md](docs/security.md)。

画面とエージェントで**同じファイルを同時に編集しないでください**。競合時は工房が双方の内容を並べて表示し、どちらを残すか選べます。

## 検証状況

Linux（Node.js 22.23 / pnpm 10.18）で `pnpm check`・`pnpm test`・`pnpm rpg validate/test/build` 成功、Playwrightで工房（編集・Undo・競合・試遊・テスト実行）と静的ビルド（キーボード／タッチ）を確認。**Windows上での起動・Codex／Claude Code連携・junction/rename/watcherは未検証**です（[TODO.md](TODO.md)）。

## 素材

サンプル素材は既存作品を模写しないオリジナルのピクセルアートです（出典・ライセンスは `assets.json`）。敵の戦闘グラフィック等は未用意で、手続き生成の仮表示になっています。追加してほしい画像の仕様は [docs/asset-requests.md](docs/asset-requests.md) にまとめています。

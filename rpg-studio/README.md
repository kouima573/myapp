# RPGシステム工房 v0.2

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
| `pnpm test` / `pnpm check` | エンジン・スキーマ・移行・ローカルサーバー安全性のユニットテスト／型検査 |

問題の行は必ず `ERROR` / `WARN` で始まり、`ファイル › 場所: 内容` の形で出ます。例:
`ERROR events/events.json › events[open-ruins-shortcut].effects[0]: 未宣言のフラグ 'ruinsShortcutOpne' を設定しています`

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

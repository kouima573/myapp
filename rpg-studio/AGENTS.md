# RPGシステム工房 — エージェント作業規約（Codex / Claude Code 共通）

このリポジトリは、エージェントがファイルを直接編集して作る2DトップダウンRPGと、その制作工房です。工房にLLM/AI APIは入れません。

## 最初に読むもの

1. `docs/project-format.md` — データ形式v2（条件・効果・マップ・会話・イベント・戦闘・セーブ）
2. `docs/extension-api.md` — 独自ルールのフック（`defineSystem`）
3. `docs/scenario-tests.md` — 自動プレイテスト
4. 対象プロジェクトの `README.md`（例: `projects/sample-rpg/README.md`）

## 作り方の原則

- **データで書けることはデータで**（`projects/<id>/*.json`）。条件（flag/ability/item/done/all/any/not）と効果（message/setFlag/giveItem/battle/teleport/if/…）で表せないルールだけを `systems/*.ts` に書く。
- 新しいフラグは必ず `project.json` の `flags` に宣言する（未宣言は検証エラー）。
- ID（マップ・NPC・会話・イベント・能力・アイテム・敵・素材）はセーブや参照に使う安定ID。リネームするなら参照もすべて直す。
- エンジン（`packages/engine`）や描画（`packages/runtime`）を変えてよいが、**プロジェクト固有のIDをエンジンに書かない**。形式を変えるなら `packages/schema` と検証・移行・テストを同時に更新する。
- 素材は `assets.json` に出典・ライセンス・寸法つきで登録。絶対パス・base64埋め込み・出典不明の素材は使わない。既存作品の模写をしない。
- 変更した挙動には `tests/*.scenario.json` を追加・更新する。

## 完了条件（すべてOKになるまで直す）

```sh
pnpm rpg validate --project projects/<id>
pnpm rpg test     --project projects/<id>
pnpm rpg build    --project projects/<id>
pnpm test && pnpm check        # packages/ を変えた場合
git diff --check && git diff   # 差分を確認
```

## 禁止事項

- AI APIルート、APIキーの保存・要求を追加しない。
- ブラウザから任意のコマンド・スクリプトを実行できるAPIを追加しない。ローカルサーバーを `127.0.0.1` 以外で待ち受けさせない。Host/Origin/トークン/パス/シンボリックリンク/競合の検査を弱めない（`docs/security.md`）。
- 未信頼の第三者コードをレビューなしで実行しない。
- 工房で人が編集中のファイルを同時に編集しない（人に保存済みか確認する）。
- Windowsで実行していない結果をWindows検証済みと書かない。

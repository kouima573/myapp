# RPGシステム工房 — エージェント作業規約（Codex / Claude Code 共通）

このリポジトリは、エージェントがファイルを直接編集して作る2DトップダウンRPGと、その制作工房です。工房にLLM/AI APIは入れません。

## 最初に読むもの

0. プロジェクトに `IDEA.md` があれば最初に読む。それが作り手の発想の正本。進め方は `docs/idea-to-game.md`（**発想を削らない・すり替えない、足りない部品は作る**）
1. `docs/project-format.md` — データ形式v2（条件・効果・マップ・会話・イベント・戦闘・セーブ）
2. `docs/customization-guide.md` — 種族・効果・仕組みをデータで作るレシピ集（フラグ・変数・特性・ルール・式）
   `docs/genre-modules.md` — ノベル・パズル・弾幕・育成・カードなど他ジャンルの遊びをRPGに組み込むモジュール（作れるのはRPGのみ）
   `docs/innovation-guide.md` — 新しい遊びを発明するための部品（エンティティ・領域・集合・周回・独自画面・描画レイヤー）と発想集
3. `docs/extension-api.md` — データで書けないものだけ使うTypeScriptフック（`defineSystem`）
4. `docs/scenario-tests.md` — 自動プレイテスト
5. 対象プロジェクトの `README.md` と `pnpm rpg catalog --project projects/<id>`（定義済みIDの一覧）
6. 素材（画像・BGM・効果音）を扱うときは `docs/asset-guide.md` と `pnpm rpg asset sources --project projects/<id>`

## 作り方の原則

- **作り手の発想が最優先。** 作りやすさのために発想の核を「よくある形」に置き換えない。データで書けなければ拡張、拡張でも足りなければエンジンを広げる（形式・検証・テストを一緒に）。好みの問題だけを作り手に聞き、決めたことは `IDEA.md` に記録する。
- 新しい仕組みを頼まれたら、既存の型に押し込めず、innovation-guide の4層（データ → 世界の仕組み → 拡張 → エンジン改造）から最も素直な実現方法を選ぶ。拡張の処理（input・conditions・actions・onStep・onTick）では `Math.random()` や現在時刻を使わない（決定性を保つ）。
- **データで書けることはデータで**（`projects/<id>/*.json`）。種族・職業などは特性(traits)、効果は能力のstatMods・rules・use、全体の仕組みは `rules.json` のルールで書く。条件・効果・式・ルールで表せないものだけを `systems/*.ts` に書く。
- 種族や効果の**内容**（仕様書）はユーザーが用意する。仕様にない効果を推測で作らない。不明点は質問する。
- 新しいフラグ・変数は必ず `project.json` の `flags`・`variables` に宣言する（未宣言は検証エラー）。
- ID（マップ・NPC・会話・イベント・能力・アイテム・敵・素材）はセーブや参照に使う安定ID。リネームするなら参照もすべて直す。
- エンジン（`packages/engine`）や描画（`packages/runtime`）を変えてよいが、**プロジェクト固有のIDをエンジンに書かない**。形式を変えるなら `packages/schema` と検証・移行・テストを同時に更新する。
- 素材は必ず `pnpm rpg asset add`（または `gen-sfx`）で登録し、出どころ・規約名・規約確認日・クレジット・作者の注意書きを記録する。絶対パス・base64埋め込み・出典不明の素材は使わない。既存作品の模写をしない。
- 外部サイトの素材は、そのプロジェクトで有効にされた取得元だけ使う。**毎回、規約の原文と作者ごとの条件を読んでから**入れる。規約で許されない使い方（再配布禁止の素材を共有用プロジェクトに入れる、NC素材の商用利用など）はしない。`automatedDownload` が `manual` のサイトは、候補URLを提示して人にダウンロードしてもらう。
- 容量予算（`assetPolicy.budget`）を守る。BGMは楽譜BGMかOGG 96〜128kbps、効果音は短く。
- 変更した挙動には `tests/*.scenario.json` を追加・更新する。

## 完了条件（すべてOKになるまで直す）

```sh
pnpm rpg validate --project projects/<id>
pnpm rpg test     --project projects/<id>
pnpm rpg build    --project projects/<id>
pnpm test && pnpm check        # packages/ を変えた場合
pnpm rpg schema                # packages/schema の形式を変えた場合（schema/*.schema.json を再生成）
git diff --check && git diff   # 差分を確認
```

## 禁止事項

- AI APIルート、APIキーの保存・要求を追加しない。
- ブラウザから任意のコマンド・スクリプトを実行できるAPIを追加しない。ローカルサーバーを `127.0.0.1` 以外で待ち受けさせない。Host/Origin/トークン/パス/シンボリックリンク/競合の検査を弱めない（`docs/security.md`）。
- 未信頼の第三者コードをレビューなしで実行しない。
- 工房で人が編集中のファイルを同時に編集しない（人に保存済みか確認する）。
- Windowsで実行していない結果をWindows検証済みと書かない。

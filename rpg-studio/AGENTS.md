# RPGシステム工房 — エージェント作業規約（Codex / Claude Code 共通）

このリポジトリは、エージェントがファイルを直接編集して作るゲームと、その制作工房です。`project.json` は2DトップダウンRPG形式、`experience.json` はRPGのプレイヤー・マップ・HPを要求しない独立作品形式です。独立作品には `runtime: "experience"`（任意の状態・入力・画面ホスト）と `runtime: "static"`（作者独自のHTML/CSS/JS/WASM等をそのまま配布）の2方式があります。公開ブラウザ工房は両形式を扱います。独立作品のチャットJSON差分適用は未対応です。工房にLLM/AI APIは入れません。

## 最初に読むもの

0. `docs/HANDOFF.md` — 引き継ぎメモ（約束・現状・残りの仕事）

0. ゲームの発想や仕様に関わる作業では、プロジェクトに `IDEA.md` があれば今回に関係する部分を読む。これは作り手の現時点のメモで、今回の明示的な依頼が優先。進め方は `docs/idea-to-game.md`（**発想を削らない・すり替えない、足りない部品は作る**）
1. 対象プロジェクトに `experience.json` がある場合は `docs/experience-projects.md` を読み、`runtime` が `experience` か `static` か確認する。`static` の作者独自の入口・ディレクトリ構成・既存起動方法を尊重し、TypeScriptの `systems/main.ts` やRPG Studioのループに移し替えない。`project.json` の場合は `docs/project-format.md` — データ形式v2（条件・効果・マップ・会話・イベント・戦闘・セーブ）を読む。
2. `docs/customization-guide.md` — 種族・効果・仕組みをデータで作るレシピ集（フラグ・変数・特性・ルール・式）
   `docs/genre-atlas.md`（`pnpm rpg genres --query <言葉>`）— 111ジャンルそれぞれをこの工房でどう作るか
   `docs/genre-modules.md` — ノベル・アクション・格闘・タクティクス・防衛・落ちもの・リズム・脱出・推理・3Dダンジョン・工場など26種の他ジャンルの遊びを標準RPGランナーに組み込むモジュール
   `docs/innovation-guide.md` — RPG内の拡張部品と、RPG全体を使わない独立作品形式の選び方
3. `docs/scripting.md` — データで書けない処理を、技・アイテム・特性・敵・仲間・マップ・エンティティに付けるスクリプト（`scripts/*.ts` の `defineScript`）。`docs/extension-api.md` — プロジェクト全体に効くシステム（`defineSystem`）
4. `docs/scenario-tests.md` — 自動プレイテスト
5. 対象プロジェクトの `README.md`。RPG形式では `pnpm rpg catalog --project projects/<id>`（定義済みIDの一覧）も使う。独立作品形式に `catalog` はない。
6. ほかのプロジェクトや作り手が作った仕組みを使うときは `pnpm rpg mod list` / `pnpm rpg mod add <id> --project …`（出どころは mods.json に残る）。自分の仕組みを共有するときは `pnpm rpg mod export <systemId> --project … --author … --license …`
7. 素材（画像・BGM・効果音）を扱うときは `docs/asset-guide.md` と `pnpm rpg asset sources --project projects/<id>`。タイル・キャラ・敵・戦闘背景は、まず共有素材ライブラリ（`pnpm rpg library list`、見本は `library/previews/`）から `pnpm rpg library add` で取り込めないか探す

## 作り手の進め方

作り方は一つに決めません。作り手が指定した作業順・粒度・相談の仕方・成果物の形に従い、途中で方法を組み合わせたり変えたりする希望も尊重してください。作業カード、先に仕様をまとめること、試作品から始めること、段階的な確認などを標準手順として押しつけません。希望が書かれていなければ、依頼された成果に直接取りかかり、方法の違いが結果を変えるときだけ確認します。

`todo.json` は作り手が使うと決めた場合にその計画・範囲・順序を尊重し、該当カードを更新します。未指定の依頼までカード順に限定したり、既存のカードを理由に現在の依頼を止めたりしません。`SCRIPT.md`（台本）・`SPEC.md`（仕様書）・既存ファイルは内容の参照元として読みますが、書かれていない制作方法を推測して追加しません。

## 作り方の原則

- **作り手の発想が最優先。** 作りやすさのために発想の核を「よくある形」に置き換えない。ジャンル・中心の遊び・プレイヤーの役割・操作・勝敗や終わり方など、遊ぶ体験を変える判断は、明示されていない限りAIが決めない。重要な分岐は選択肢として示すか、未決のまま保ち、作り手が選べるようにする。`IDEA.md` は存在する場合の現時点の意図を記録する資料で、作り手は後から自由に変えられる。今回の明示的な依頼が古い記述と異なる場合は今回の依頼を優先し、曖昧な食い違いで結果が変わるときだけ確認する。体験を変えない実装上の判断はAIが進めてよい。既存の発想メモがあれば「AIが提案・仮置きしたこと」に記録し、なければ記録のためだけに新しい文書を作らず、変更報告で伝える。
- **制作の開始点を決めつけない。** 作り手がどの段階にいるか（アイデア・設定・プロット・特定場面・試作品・既存作品の続き）と、プレイヤーがゲーム内で最初に出会う場面は別々に扱う。既存の設定・脚本・データ・試作品を確認し、作り手が指定した所から始める。プロローグ、導入説明、最初の村、チュートリアル、一本道の工程を自動で足さない。どの選択肢にも当てはまらないときは自由記述を優先する。
- **作り手の方法に合わせる。** 企画・実装・素材・検証の進め方、作業単位、相談と自律作業の配分は作り手ごとに異なる。IDEA.md や今回の依頼に書かれた希望を優先し、例示した手法や工房の機能を網羅的な選択肢・標準工程とみなさない。方法を混ぜる・途中で変える・独自の方法を使うことを認め、AIが慣れた工程へ黙って置き換えない。
- **エンジンの境界は発想の境界ではない。** `project.json` は2DトップダウンRPGです。RPGが発想に合わなければ、ブラウザ工房またはローカルの `experience.json` 形式で作品全体を定義できます。それも足りない場合は、できる範囲と不足を率直に伝え、別の実行形式を作ります。
- `experience.json` の `runtime: "experience"` では `systems/main.ts` が作品全体です。作り手が望まない限り、RPGの主人公・マップ・HPを追加したり `defineSystem` に包んだりしない。`runtime: "static"` では作者の既存の起動ファイル・ライブラリ・ループを保持し、作品側が選んだ実行形式を変えません。
- 新しい仕組みを頼まれたら、既存の型に押し込めず、innovation-guide を使ってデータ・世界の仕組み・RPG拡張・独立作品・エンジン改造から素直な実現方法を選ぶ。RPG拡張と独立作品の `update` では `Math.random()` や現在時刻を使わない（決定性を保つ）。
- **データで書けることはデータで**（`projects/<id>/*.json`）。種族・職業などは特性(traits)、効果は能力のstatMods・rules・use、全体の仕組みは `rules.json` のルールで書く。条件・効果・式・ルールで表せないものだけをコードで書く。特定の技・アイテム・敵などの処理は `scripts/<名前>.ts`（`defineScript`、データの `"script"` で付ける）、プロジェクト全体の仕組みは `systems/*.ts`（`defineSystem`）。
- 種族や効果の**内容**（仕様書）はユーザーが用意する。仕様にない効果を推測で作らない。不明点は質問する。
- 新しいフラグ・変数は必ず `project.json` の `flags`・`variables` に宣言する（未宣言は検証エラー）。
- ID（マップ・NPC・会話・イベント・能力・アイテム・敵・素材）はセーブや参照に使う安定ID。リネームするなら参照もすべて直す。
- エンジン（`packages/engine`）や描画（`packages/runtime`）を変えてよいが、**プロジェクト固有のIDをエンジンに書かない**。形式を変えるなら `packages/schema` と検証・移行・テストを同時に更新する。
- RPG形式の素材は `pnpm rpg asset add`（または `gen-sfx`）で登録し、出どころ・規約名・規約確認日・クレジット・作者の注意書きを記録する。独立作品で工房の標準画像・音声・フォント登録を使う場合は「素材と出典」または対応CLIで `assets.json` に記録する。`static` の独自アセット形式を無理に置き換えない。出典不明の素材や絶対パスを使わない。
- 外部サイトの素材は、そのプロジェクトで有効にされた取得元だけ使う。**毎回、規約の原文と作者ごとの条件を読んでから**入れる。規約で許されない使い方（再配布禁止の素材を共有用プロジェクトに入れる、NC素材の商用利用など）はしない。`automatedDownload` が `manual` のサイトは、候補URLを提示して人にダウンロードしてもらう。
- 容量予算（`assetPolicy.budget`）を守る。BGMは楽譜BGMかOGG 96〜128kbps、効果音は短く。
- RPG形式で変更した挙動には `tests/*.scenario.json`、状態遷移型の独立作品では `tests/*.experience.json` を追加・更新する。独立作品シナリオは `rpg test` で `start` / `update` の状態遷移を確認し、描画・音・操作感は試遊で確認する。`runtime: "static"` では作者の既存テスト方法を使う。

## 素材はチャットの中で決める（相手は工房を開かない前提）

多くの人は工房の画面を開かず、あなた（Codex／Claude Code）との会話だけで素材を決めます。次の順で、選ぶのは必ず相手に任せてください。

1. `pnpm rpg asset find --kind <bgm|sfx|tile|character|enemy|background|image|voice|font> --words "<相手の言葉>" --project <dir>` を実行する。内蔵の選択肢と、取得元ごとの検索URL・試聴の仕方・クレジット・注意点が出る。
2. 画像は `pnpm rpg library preview --kind <tile|character|enemy|background> --query "<言葉>"` で番号つき見本画像（`.rpg-studio/library-preview.png`）を作り、その画像を見せて「何番にしますか？」と聞く。決まったら `pnpm rpg library add <id> --project <dir>`（タイルは `--tiles <key,…>` で一部だけ）。
3. 音（BGM・効果音）は判定できないので、**聴けるURL**（取得元の検索URL・個別ページURL）を番号つきで示し、相手に聴いてもらって選んでもらう。内蔵の選択肢（楽譜BGM・`asset gen-sfx`）も並べる。
4. 外部サイトは**相手がブラウザでログイン・購入・ダウンロード**する。パスワード・Cookie・トークンを聞いたり保存したりしない。買った／DLしたパックは `pnpm rpg packs add …` で台帳（このPCの `~/.rpg-studio/packs.json`）に登録すると、以後は `pnpm rpg packs files <パック>` → `pnpm rpg packs use <パック> --file … --id … --kind … --project <dir>` で出どころ・ライセンスつきで取り込める。
5. 取得元の要約が `research.method = "secondary"`（二次情報）のときは、登録の前に規約の原文（`termsUrl`）を相手と一緒に確認する。`cautions` に書かれた注意（例: OpenTracks の HTML5 組み込み条件、公開リポジトリへの音源の置き方）は必ず伝える。
6. 規約がはっきりしないときは、`docs/asset-source-inquiries.md` の問い合わせ文を相手に渡す（送るのは相手。深追いしない）。

## 完了条件（変更に合う方法で確認する）

標準のRPGデータを変えた場合は、次の検証・テスト・ビルドを行う。状態遷移型の独立作品は `validate` / `test` / `build` と `dev` での試遊に対応し、ブラウザ工房のTypeScript変換は構文診断まで、完全な型検査はローカル `build` で行います。`static` は `validate` / `build` / `dev` に対応しますが、任意のゲームロジックの自動テストはありません。既存の試験・ビルド方法を使い、必要な場合は起動手順を確認します。テストを成立させるために、発想にない操作・勝敗・結末を作品へ追加しない。

```sh
pnpm rpg validate --project projects/<id>
pnpm rpg test     --project projects/<id>
pnpm rpg build    --project projects/<id>
pnpm rpg proofread --project projects/<id>   # 台詞を書いた・変えた場合（ウィンドウに収まるか・誤字らしき所）
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

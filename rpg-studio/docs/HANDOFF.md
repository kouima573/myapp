# 引き継ぎメモ — RPGシステム工房（2026-11-23 更新）

別のAI（Codex／Claude Code など）がこのプロジェクトを引き継ぐためのメモです。**まずこのファイル、次に `AGENTS.md`（Claude Code は `CLAUDE.md` も）を読んでください。**

---

## 1. これは何か

「ユーザーの発想がそのままゲームになる」RPG制作ツール。中身は決定的な純粋エンジン＋ブラウザ実行環境＋工房（React製エディター）＋CLI。

- 公開中: **https://rpg-studio-2k3.pages.dev**（トップ・見本ゲーム `/play/`・ジャンルの回廊 `/gallery/`・工房のPreview版 `/studio/`）
- リポジトリ: `kouima573/myapp` の **`rpg-studio/` フォルダだけ**が対象
- 作業ブランチ: `claude/eloquent-knuth-u58z8y`（v2.4 のコミット時点で全チェックOK）

## 2. 必ず守ること（ユーザーとの約束）

| 約束 | 内容 |
| --- | --- |
| 言語 | ユーザーへの返事は**日本語**。専門用語は噛み砕く |
| 多言語対応はしない | ユーザーの判断で不要（ゲーム・工房とも日本語のまま） |
| 標準の実行形式 | 2DトップダウンRPG。発想を既存のRPG部品に押し込まず、表せる範囲と不足を説明し、必要ならローカル環境で拡張する |
| 工房の中にLLM/AI APIを入れない | AIはユーザーが外で使う Codex／Claude Code。工房は依頼文のコピーなどで連携する |
| 規約を偽らない | 確認していない規約を「確認済み」にしない（`verifiedAt` は人が原文を読んだときだけ） |
| 既存ゲームの再現をしない | 特定の既存作品の名前・キャラ・絵・音・レベルの模倣は不可（オリジナルの形にする） |
| `rpg-studio/` の外を触らない | リポジトリ直下の他ファイルには**実在の人物の個人情報**がある。読まない・変えない・公開に含めない |
| PRは頼まれるまで作らない | コミットとプッシュは作業ブランチへ |
| ライトな層は工房を開かない | AIとの会話だけで完結させる（素材も番号やURLで選んでもらう。`AGENTS.md`「素材はチャットの中で決める」） |
| コアな層向け | 工房で「コードを探す」（Alt+クリック）から該当コードへ飛べるようにしてある |

## 3. ユーザーの環境

- Windows 11（NT 10.0.26300）、Node 24.20、pnpm 10.18、git 2.56、PowerShell
- クローン先の例: `C:\Users\<ユーザー>\Documents\Codex\myapp\rpg-studio`
- これまでに解決済みのつまずき:
  - PowerShell の実行ポリシー → `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
  - 改行コード（CRLF）で素材のバイト数がずれる → `rpg-studio/.gitattributes` で LF 固定済み
  - Git の資格情報マネージャーのエラー → gh CLI で正しいアカウントにログイン
- Windows 実機での確認は `docs/windows-acceptance.md` の **0〜2 まで実施済み**。テスト1件（シンボリックリンク作成の権限）は修正済み（`c70a16b`）。**3〜7 は未実施**。
- Cloudflare Pages: プロジェクト `rpg-studio`（サブドメイン `rpg-studio-2k3`）、本番ブランチ `main`。公開は**ユーザーのPC**で `pnpm deploy:site`（wrangler のブラウザログイン）。クラウド側にCloudflareのトークンは保存していない。

## 4. コマンドと完了条件

```bash
cd rpg-studio
pnpm install
pnpm check                      # 型チェック
pnpm test                       # vitest（現在192件）
pnpm rpg proofread --project <dir>   # 台詞の長さ・誤字らしき所（v1.9）
pnpm rpg validate --project projects/sample-rpg     # ← フォルダは --project で指定（位置引数は無視される）
pnpm rpg test     --project projects/sample-rpg
pnpm rpg build    --project projects/sample-rpg
pnpm rpg validate|test|build --project projects/genre-gallery
pnpm build:studio
pnpm rpg schema                 # formats.ts を変えたら JSON Schema を再生成（テストで検査される）
pnpm studio --project <dir>     # 工房（ローカルサーバー 127.0.0.1:4173）
pnpm build:site / pnpm deploy:site   # 公開用サイト（dist/site）
```

終える前に上の全部をOKにする。コミットの末尾に、使っているツールの帰属表記を付ける（ユーザーの規約があればそちらに従う）。

## 5. どこに何があるか

| 場所 | 中身 |
| --- | --- |
| `packages/schema/src/formats.ts` | 全データ形式（zod）。`validate.ts` が参照の検査 |
| `packages/engine/src/game.ts` | 決定的エンジン `createEngine(content, systems)` → `step(state, action)`。`systems.ts` が拡張契約とスクリプト補助関数 |
| `packages/runtime/src/player.ts` | ブラウザでの描画・入力（ゲーム画面の部品には `data-src` が付く） |
| `packages/modules/src/` | ジャンルモジュール26種（ノベル・パズル・弾幕・カード・タクティクスなど） |
| `packages/cli/src/` | `rpg` コマンド。`artgen/` は内蔵ドット絵ジェネレーター、`library.ts`・`packs.ts`・`assets.ts` が素材まわり |
| `packages/local-server/src/server.ts` | 工房用ローカルサーバー（トークン・Origin・パス・シンボリックリンク拒否・衝突検出。画像保存とライブラリ取り込みの口あり） |
| `studio/src/` | 工房（React）。`components/` に各画面 |
| `library/` | 内蔵ジェネレーターによるオリジナル素材（タイル183種・キャラ53・敵55・背景12、MIT） |
| `projects/sample-rpg` | 見本「森境の小さな冒険」 |
| `projects/genre-gallery` | 見本「ジャンルの回廊」（素材の庭・庭の家） |
| `docs/` | `scripting.md`（スクリプト）、`extension-api.md`、`project-format.md`、`scenario-tests.md`、`asset-guide.md`、`genre-modules.md`、`windows-acceptance.md`、`asset-source-inquiries.md` ほか |

## 6. ここまでに入った主な機能（新しい順）

- **v1.3**: チャットで素材を決める（`rpg asset find`・`rpg library preview` の番号つき見本）、素材パックの台帳 `rpg packs`（`~/.rpg-studio/packs.json`、認証情報は保存しない）、取得元カタログ37件、「コードを探す」（Alt+クリックでファイルと行、VS Code／Cursor で開く）、絨毯の9枚組、スクロール修正、Cloudflare Pages 公開
- **v1.2**: スクリプト（`scripts/<名前>.ts` を `defineScript` で書き、技・アイテム・特性・敵・仲間・マップ・エンティティ・NPC・仕掛け・領域の `"script"` に付ける。`use`／`commands`／`enemyTurn` などのフック）、工房のスクリプト画面、ドット絵エディター、素材ライブラリ画面
- **v1.1**: 装備スロット、複数の敵、仲間（指示・装備）、工房のフォーム編集（敵・アイテム・能力・仲間・エンティティ・効果・条件）
- **v1.0 以前**: 動詞・シグナル・押せる／運べる物、2人協力・ゲームパッド、mod共有、ジャンル地図111種、発想シート、自動プレイテストなど（`README.md` の各版の節）

## 6.5 v1.4（別のAIの改善を取り込み済み）

遊ぶ人向けの設定（文字速度・会話履歴・音量・画面揺れ・ダッシュ・全画面・ルビ）、`rpg audit`・`rpg asset unused`・`rpg build --zip`・`rpg new --theme`、初心者ガイド（`docs/beginner-guide.md`）など。詳しくは `TODO.md` の「v1.4で完了」。

**配布版のデータは「ビルドが既定値を埋めたもの」**: ゲーム本体は Zod なしでデータを読む。`rpg build` は検証済みの内容（既定値入り）を `data/` に書き出す。`packages/cli/src/build.test.ts` がビルド結果で見本の全シナリオを再生して、テストと同じ動きになることを確かめている。データ形式を変えたらこのテストが通ることを必ず確認する。

## 6.6 v1.5（「200の改善指針」第1弾）

Gemini でまとめた200項目の改善案を受け取り、`docs/roadmap-200.md` に1項目ずつ状態を記録した（✅済・🟡一部・🔜次・⬜未）。第1弾としてレベル制・タイトル画面・セーブ3枠＋オート・書き出し/読み込み・ダメージ数値・お店と宿屋（`shop` モジュール）を実装。**次はこの表の 🔜 から**（TODO.md「第2弾の候補」）。

## 6.7 v1.6（第2弾）

状態異常・属性、オートタイル・レイヤー・動くタイル、フキダシ・顔グラ・移動ルート、`rpg refs` / `rpg rename`、試遊の録画からの自動テスト。次は `docs/roadmap-200.md` の 🔜。

## 6.8 v1.7（第3弾）

BGMのループ位置・環境音、配布版の先読みとホーム画面追加（PWA: `sw.js` は `rpg build` が版ごとに生成）、工房の保存履歴（`.rpg-studio/history/`、ローカルサーバーの `/api/history*`）と変更の要約（`packages/local-server/src/history.ts`）、会話・イベントの分岐図（`studio/src/lib/flow.ts`）、タイルの `key`（`rpg library add --replace` が画像＋キーで照合）。次は `docs/roadmap-200.md` の 🔜。

## 6.9 v1.8（第4弾）

戦闘の全体攻撃・連続攻撃・会心・回避・素早さ順（`turnOrder()`。乱数は使う設定のときだけ振るので、既存のゲームの結果は変わらない）、文字装飾（`packages/runtime/src/textmarkup.ts`）、一枚絵（`state.pictures`）、名前入力（シーン `input`・アクション `submitText`・シナリオの `{ "input": "..." }`）、図鑑と実績（`state.book`・`state.achievements`、メタ情報で新しいゲームへ引き継ぎ）、工房のワールド全体図（`studio/src/lib/world.ts`）と試遊のデバッグ切り替え（`canPass`・`canEncounter` の口を使う工房専用のシステム）。

## 6.10 v1.9（第5弾）

タイルの `walls`（`edgeBlocked`）、ミニマップ（`minimapCanvas`）、連戦（`BattleState.waves/wave`）、オート戦闘・戦闘の速さ・文字送りの音（遊ぶ人の設定）、合成と倉庫（`packages/modules/src/shop.ts` の `craft`・`storage`。倉庫の中身は `state.systemData.shop.storage`）、`rpg proofread`（`packages/cli/src/proofread.ts`）、`disabled: true`。

## 6.11 v2.0（第6弾）

遠景・霧（`render.ts` の `tiled`）、足元の演出（`drawStepEffect`）、タイルの `encounterRate`・`footstep`、隊列と控え（`activeParty`・`rowRate`・効果 `setFormation`・アクション `formation`）、`project.ui`（CSS変数）、`project.gameOver`（シーン `gameover`・`respawn()`）、マップの範囲コピー（`MapEditor.tsx` の `copyRange`/`pasteRange`）、横断の検索置換（`packages/cli/src/search.ts`。工房と `rpg find` で共用）。

## 6.12 v2.1（第7弾）

カメラ（`state.camera`・キュー `shake`、`player.ts` の `camNow`）、戦闘アニメ（キュー `anim` と CSS の `.rpg-fx-*`）、BGMを下げる（`audio.ts` の `duck`）、職業（特性の `group`・アクション `chooseTrait`）、さいきょう装備（アクション `optimizeEquipment`・`gearScore`）、`project.menu`（`arrangeMenu`）、ドット絵の図形と色（`studio/src/lib/pixelshapes.ts`）、失敗の再現（`runScenario` が `state` を返す。サーバーの応答からは外す）、工房の配色（`html[data-theme]`）。

## 6.13 v2.2（第8弾）

スキルボード（`database.skillBoards`、`state.skills`、`skillStatus()`、アクション `learnSkill`、`learnedNodes()` が能力値・技に反映、画面は `renderSkills` と CSS `.rpg-hex`）、召喚（`summon`・仲間の `summoned`）、練習試合（`BattleState.practice`）、見た目選び（`player.looks` → 始めの選択肢）、工房の「はじめての5分」（`TutorialPanel`）・「楽譜BGM」（`SongPanel`・`studio/src/lib/stepgrid.ts`・`previewSong`）・スタンプ・オニオンスキン・操作履歴（`store.timeline`・`rewindTo`。要約は `packages/local-server/src/summary.ts` を工房と共用）。

## 6.14 v2.3（第9弾）

工房のスキルボード編集（`SkillBoardPanel`）、ヘルプ（`HelpPanel`・`studio/src/lib/glossary.ts`）、端のつながり（`acrossEdge`）、乗り物（`state.vehicles`・`state.riding`・`interact` で乗り降り・`maybeEncounter` を分離）、`rpg new --stage`（`applyStage`）、`rpg devlog`、`rpg sample reset`（git で `projects/<id>` だけ元に戻す）、公開サイトの「AIと作ってみる」。台詞の点検は `packages/cli/src/proofreadText.ts`（工房と共用）。

## 6.15 v2.4（第10弾）

隊列歩行（ランタイムの `trail`、`project.party.follow`）、仲間の雑談（`chat`・アクション `partyChat`）、確認ダイアログ（`player.ts` の `askConfirm`）、自動生成ダンジョン（`packages/engine/src/dungeon.ts` の `generateDungeon`、`packages/cli/src/mapgen.ts`、工房の NewMapForm）、タイルの大きさ（`display.tileSize` → 拡大率）、カウントタイム戦闘（`ctbSequence`・`BattleState` のゲージ）、セリフ音声（`dialogueVoices`・`speak()`）、フォント素材（`ASSET_KINDS` に font、`ui.fontAsset` を FontFace で読み込み）、画風（`packages/cli/src/artgen/style.ts` の `applyStyle`。描いた後の色変換なので形は同じ）、取得元カタログの見直し（`packages/cli/src/sourceCatalog.ts`。`verify` は `--read-terms` がないと書かない）。

追加実装（ロードマップ 029・042・046・049・051・064・071・090・107・116）: マップ色調と話者色、会話オート／スキップ、画面フェード、依頼帳、MP/SPゲージ・消費・回復・成長・工房フォーム、敵のドロップ率・盗む・調べる、所持品上限・スタック・並べ替え、BGM/効果音の個別音量、見やすさ設定。

## 6.16 ロードマップ第11弾

013 公開前チェック（`ChecksPanel`）、060 会話既読条件（`seenDialogue` / `seenDialogues`）、073 敵行動ごとのBGM（`EnemyAction.music` / `BattleState.music`）、089 装備前後の能力差表示、098 コスト制パッシブ枠（`passiveCapacity` / `passiveCost`）、105 マウス・タッチのクリック移動、110 HUD操作説明の切替、119 技・道具の説明とコストのヒント、162 イベントからの試遊開始、170 工房全体のフォームUndo/Redo（Ctrl/⌘+Z・Ctrl/⌘+Y、トップバーのボタン）を追加。

`packages/schema/src/formats.ts` と `schema/*.schema.json` は同期済み。ただし、この作業環境では `node_modules/.bin/tsx` がなく `pnpm rpg schema` は実行できなかったため、JSON Schema は該当箇所を手動で反映した。依存を復元した後に `pnpm rpg schema` を実行して差分がないことを確認する。今回、テスト・型検査・ビルドは実行していない。

## 6.17 ロードマップ追加実装

131 素材ドラッグ＆ドロップ取り込みをローカル工房に追加。素材画面からPNG・OGG・MP3・WAV・WOFF2・WOFF・TTF・OTFを選び、種類・出どころ・取得元・ライセンス・規約確認日・クレジットを付けて登録できる。ローカルサーバーでファイル署名、素材スキーマ、取得元の有効状態・カテゴリ・共有条件、容量上限を確認し、素材ファイル保存後に衝突検知つきで `assets.json` を更新する。Previewは読み取り専用。`docs/asset-guide.md` に操作手順を追記。

テスト・型検査・ビルドは未実行（依頼なし）。次に環境を整えた際は、ローカル工房でドラッグ＆ドロップ、外部素材の必須項目、重複ID・大容量・不正形式の拒否を受け入れ確認する。

## 6.18 座標ピッカー

174 イベント効果 `teleport` の工房フォームに移動先マップの色分けプレビューを追加。タイル色とNPC・出入口・仕掛け・エンティティの位置を表示し、クリックで目的座標を入力する。マップを切り替えたときは、現在座標を新マップの範囲内に収める。従来のX/Y数値入力も残した。`docs/project-format.md` に操作を追記。

テスト・型検査・ビルドは未実行（依頼なし）。

**注意**: リポジトリ直下には個人情報を含む別ファイルがあるため、公開サイトにリポジトリのURLや取得方法は載せていない（工房一式は作者から共有する前提）。

## 6.19 使用箇所ライブ表示

172 `UsagePanel` を追加し、データ編集フォームのIDからJSON内の完全一致参照とTypeScript内の引用符つきIDをライブ検索する。敵・アイテム・能力・仲間・会話・イベント・マップ上のエンティティ・領域・NPC・出入口・仕掛けの詳細画面で、所有データ名・JSONパスまたはコード行を一覧表示し、クリックで該当ファイルをデータ画面に開く。リストは折りたたみ式、最大80件を表示。

テスト・型検査・ビルドは未実行（依頼なし）。

## 6.20 IndexedDBセーブ

189 ランタイムの手動セーブ枠とオートセーブをIndexedDBに保存するよう変更。タイトル画面とロード一覧は保存領域を非同期に読み、読込完了後に表示を更新する。既存のlocalStorageセーブは読み込み時にIndexedDBへ移行し、IndexedDBが使えない場合や書き込みに失敗した場合はlocalStorageを使う。設定・周回メタデータは小さいため同期localStorageのまま。

テスト・型検査・ビルドは未実行（依頼なし）。

## 6.21 デスクトップ配布ガイド

188 `docs/desktop-app-guide.md` を追加。静的ゲームのビルド出力をTauriの `frontendDist` とElectronのパッケージに含める方法、両方式の要件とセキュリティ、ブラウザセーブの移行、OS別の配布前確認を記載。ラッパー本体とOS別インストーラーは未実装。

ガイドは公式ドキュメントを参照して作成。テスト・型検査・ビルドは未実行（ガイド追加のみ）。

## 6.22 ローカルAIスキル

Codex向け `.agents/skills/rpg-studio/SKILL.md` とClaude Code向け `.claude/skills/rpg-studio/SKILL.md` を同じ本文で追加。ローカルのゲーム制作依頼で共通規約・IDEA・プロジェクト資料を参照し、データ中心で変更する手順を定義。`docs/ai-local-workflow.md` とREADMEに、展開したフォルダーを作業場所として開き `$rpg-studio` / `/rpg-studio` で呼び出す方法を記載。AI APIは追加していない。

2つのスキル本文のハッシュ一致とfrontmatterを目視確認。Skill Creatorの `quick_validate.py` はPython環境にPyYAMLがなく実行不可。アプリ内での自動選択・呼び出し動作も実行確認していない。

## 6.23 描画性能とFPS計測

ロードマップ191を実装。プレイヤー実行中は不変の素材・タイル検索表とマップ行の文字配列を再利用し、毎フレームの再生成を減らす。配布ゲーム／試遊URLに `?fps` または `?debug` を付けると、右上にFPS・平均フレーム間隔・JavaScriptのフレーム処理時間を表示する。実機でのFPS向上幅は計測していない。

テスト・型検査・ビルドは未実行。

## 6.24 フィードバックリンク

ロードマップ192を実装。`project.json` の任意設定 `feedback: { url, label }` をタイトル画面とゲーム内メニューに表示し、HTTPS URLを押した場合だけ新しいタブで開く。データは送らない。形式定義は更新したが、依存パッケージがないため `pnpm rpg schema` は実行できず、`schema/project.schema.json` は該当項目を手動反映。テスト・型検査・ビルドは未実行。

## 6.20 別のAIの追加分の確認（2026-11-23）

上の 6.16〜6.19 は別の環境で、テスト・型検査・ビルドなしに書かれた。取り込み時に全部を実行し、次を直した:

- `game.ts`: アクション `togglePassive` の処理が `tick()`（世界の時間）の途中に貼り込まれていて構文エラーだった → アクションの switch へ移動
- `conditions.ts` / `validate.ts`: 依頼の条件 `{ quest, status }` が状態異常の条件 `{ status }` と取り違えられていた → 依頼を先に判定
- `render.ts`: マップの色調 `tints` の型エラー、工房の戦利品追加で `chance`（0〜100%）が抜けていた → 100 を入れる
- `pnpm rpg schema` で JSON Schema を正式に再生成（手で反映された分は置き換え）
- 公開サイト: オフライン用の Service Worker が「保存分を先に出す」方式で、公開し直しても古い版が見え続けることがあった → ネット優先・オフライン時だけ保存分に変更。トップページに「版とビルド日時」を表示

確認したこと: check・test（189件）・両見本の validate/test/build/proofread・build:studio・build:site、ブラウザでの見本の起動とメニュー・設定・クリック移動・IndexedDB へのセーブとロード（エラーなし）。新しい工房画面（ドラッグ＆ドロップ取り込み・座標ピッカー・使用箇所表示）は起動エラーがないことだけを確認し、操作の受け入れ確認はまだ。

## 6.21 チャットで作る（ChatGPT などファイルを触れないAI向け）

ユーザーの理想は「ChatGPT のチャットでも作れること」。チャットのAIはファイルを開けず・書けず・チェックを走らせられないので、工房が肩代わりする:

- `packages/schema/src/chat.ts`（工房とCLIで共用の純粋関数）: 作業カード `todo.json`（`TodoBundleSchema`）、`lookup`（"種類:ID" でデータの今の内容を探す）、`cardPack`（依頼文: 目的・ひも付いたデータ・台本の関係場面・ID一覧・効果と条件の一覧（スキーマから自動）・返事の形式）、`planPack`（発想・台本・仕様からカードを作ってもらう）、`parseChangeSet`／`applyChangeSet`（返事の ```rpg-change を当てはめる）、`proposalChecks`（テスト付きカードはテストなしで「できた」にできない）、`fixPack`（直してほしい点）、台本・仕様書のひな形
- CLI `packages/cli/src/chat.ts`（`rpg chat`）: 保存前にメモリ上で検証と自動テスト（`tryProposal`）
- 工房 `studio/src/components/ChatPanel.tsx`（「チャットで作る」）。取り込みは undo のひとまとまり
- 案内: 短編はチャット可、長編は Codex（おすすめ）／Claude Code。台本（SCRIPT.md）推奨、長編は仕様書（SPEC.md）も（`docs/chat-workflow.md`）
- ブラウザ版の工房は次節 6.22 で実装済み。対応範囲と制約は同節を参照。

## 6.22 ブラウザ版の工房（インストール不要）

公開サイトの工房（`PreviewSource`）を「ブラウザ版」にした: 見本から始め、編集すると IndexedDB（`studio/src/lib/browserProjects.ts`）に自動保存。「プロジェクト」画面（`BrowserPanel`）で新しいゲーム（`studio/src/lib/blank.ts`。主人公と空マップがあるRPG土台。見本の素材一覧・タイルを借り、音声設定・物語・NPC・イベント・追加モジュールは空）・切り替え・削除・ZIPで書き出し／読み込み（`browserExport.ts`・`zip.ts`）・遊べる形で書き出し。

遊べる形の書き出しは、公開サイトに置いた共通のゲームエンジン `runtime/`（`rpg runtime`＝`buildRuntime`。全ジャンルモジュール入り・独自コードなし、`bootStandalone` の `systemsFor` で有効なモジュールだけ動かす）と、`normalizedDataFiles`（`rpg build` と共用）で作る。見本のコードをそのまま使うプロジェクトは `play/game.js` を使う。コードを書き換えたものは書き出せない（手元で `rpg build`）。確認済み: 新規作成→チャットで変更→再読み込みで残る→遊べる形で書き出し→別サーバーで起動して変更が反映、プロジェクトZIP→ `rpg validate`/`build` OK、見本の書き出しも起動。

## 6.23 別のAIの追加分の確認（2026-11-23・2回目）

別の環境で、テスト・型検査・ビルドなしに入った変更（チャット画面を「自由に書く直接依頼」中心に、参考資料の選択、IDEA.md を任意に、公開準備（投稿先ごとのチェックと投稿文）、戦闘の再挑戦 \`retryBattle\` など）を取り込み、次を直した:

- \`packages/schema/src/chat.ts\`・\`BrowserPanel.tsx\`: テンプレート文字列の中のバッククォートが未エスケープで構文エラー → エスケープ
- \`browserExport.ts\`: 非同期の \`readZip\` を await していなかった
- \`scenario.ts\`: 型の絞り込みエラー（retryBattle の後の判定）
- JSON Schema を \`pnpm rpg schema\` で再生成（scenario に retryBattle が抜けていた）
- ブラウザ版: 独自コードのない新しいゲームにも「独自コードがあるので手元でビルド」と出ていた → \`canExportInBrowser()\`（コードなし、または見本のコードのまま）で判定

確認: check・test（192件）・両見本の validate/test/build/proofread・build:site。ブラウザで、空のRPG土台を作る→直接依頼の依頼文をコピー→返事を貼って確かめる→取り込む→ゲームZIPを作る→別サーバーで起動して変更が反映、までエラーなし。

## 7. 残っている仕事

1. **素材サイトへの問い合わせ4通**（`docs/asset-source-inquiries.md`）。文面と公開URLは記入済み、**名前・連絡先だけ未記入**。送るのはユーザー（ユーザーは「任せたい」と言っていた。メールの送信機能がある環境なら、**下書きを作ってユーザーの確認を取ってから**送る。Freesound は mtg@upf.edu、他3件はフォームの場所が未確認）。返事が来たら `packages/schema/src/asset-sources.json` に反映。
2. **取得元カタログの原文確認**（`pnpm rpg asset catalog check` で一覧、読んだら `pnpm rpg asset catalog verify <id> --read-terms`）: 外部の33件が未照合。37件すべて `research.method = "secondary"`（ネットワーク制限で、検索の抜粋と解説記事から作成）。原文を読めたものから `verifiedAt` を記入。特に要注意:
   - OpenTracks（旧DOVA-SYNDROME）: HTML5で音源を取り出せる場合の「3点の条件」が未確認
   - 公開GitHubに音源を置くと再配布にあたるおそれ（効果音ラボなど）
   - 魔王魂: ゲームに入れる際のクレジット要否が未確認
3. **Windows 受け入れ確認の 3〜7**（`docs/windows-acceptance.md`）と記録欄の記入。
4. 公式OAuth/APIでの連携（Freesound・itch.io）は、問い合わせの回答が来てから。
5. 静的ビルドの縮小（game.js の約444KBが Zod。配布版はビルド時検証済みデータを使って外せる余地）。
6. **「200の改善指針」の続き**: 第10弾・第11弾と追加の131・172・174・188・189・191・192まで実装済み。Codex / Claude Codeのローカルスキルは `docs/ai-local-workflow.md` を参照。次のロードマップ対象は `docs/roadmap-200.md` の 🟡／⬜ から優先度を見て選ぶ。公開サイトへの反映はユーザーが望んだ場合に `pnpm deploy:site` で行う。
7. 乗り物の見本（専用の絵がまだない。今はテストのみ）
8. 13種族・104効果はユーザー側でAIを使って作る予定（エンジンの部品は用意済み。データで表せないものはスクリプトで）。

## 8. 知っておくと良い癖・注意

- 物のタイル（木・樽・家具など）は地面込みの1枚。置き場所の地面に合うものを選ぶ。
- ライブラリのタイルシートは**末尾に追加**して番号を守る（取り込み済みプロジェクトの `tiles.json` は番号で参照している）。`pnpm rpg art generate` → `pnpm rpg library add <sheet> --project <dir> --replace` で既存プロジェクトに新タイルが追記される。
- ドット絵エディターで保存した直後は、画像が先に変わるため一瞬「ビルド失敗」が出て、`assets.json` の保存後に回復する（実害なし）。
- 公開サイトの工房はPreview版（IndexedDBにこのブラウザ内だけ保存。プロジェクトZIPの定期書き出しを案内）。「コードを探す」の「VS Codeで開く」はローカル版でのみ意味がある。
- 敵の `enemyTurn` などは「最初に結果を返したスクリプトが勝つ」。順番は `priority`（小さいほど先）。
- シナリオテストでスクリプトのコマンドは `{ "command": "id" }`。見本の最初には種族選択があるので `{ "choose": "human" }` などが必要。

## 9. データ分類と公開準備

`studio/src/components/DataPanel.tsx` はプロジェクト内のテキストファイルを用途別に絞り込む。分類は仮想表示で、保存パスや参照を変えない。画像・音声の実ファイルは従来どおり「素材」画面で管理する。

`BrowserPanel.tsx` の「公開準備」では itch.io・PLiCy・Cloudflare Pages・BOOTH・ふりーむ！・unityroom の公式投稿先と手順を表示し、作品紹介・プレイ時間・タグ・操作方法・注意事項の下書きをブラウザに保存してコピー／Markdown書き出しできる。アカウント接続や投稿操作はしない。対応形式の違いは各サイトの公式案内を確認する。

`browserExport.ts` の遊べるZIPは `index.html` をZIP直下に置く（HTML5ホストの要求に合わせる）。独自コードを使う作品はブラウザ版ではビルドできないため、手元の工房で `pnpm rpg build --project <プロジェクトフォルダー> --zip` を使う。この作業では依存パッケージがなく、型検査・テスト・ビルドは実行していない。公開サイトへのデプロイもしていない。

## 10. プレイヤーと制作者向けの追加改善

- 「チャットで作る」はAIの返答からJSON変更データを抽出し、前後の説明文やJSONフェンスを除いて取り込めるようにした。末尾カンマも修復対象にする。画面上で抽出したことを知らせ、既存の差分確認を経て反映する。
- 「発想」画面に、舞台・世界のルール・主人公の目的をそれぞれ3択で選ぶ発想ガチャを追加。引き直しとプレビューができ、既存の発想メモを残したまま追記する。
- ゲーム内メニューに現在の依頼目標を画面隅に表示するON/OFFを追加。進行状況コピーは現在地・HP・フラグ・依頼・戦闘などの診断情報を短いJSONとしてコピーし、会話本文やセーブ本体は含めない。ゲームオーバー画面からも呼び出せる。
- 戦闘のダメージ表示で、倍率に応じた `WEAK!`・`RESIST`・`無効！`、防御時の `GUARD` を色と大きさで区別する。
- ゲームオーバー画面（`mode: "screen"` かつ `retry: true`）から戦闘直前の状態へ戻り、HP/MP/SP全回復で再戦できる。同じ強さの再戦と、敵の攻撃力・防御力を25%下げる「やさしい再戦」を選べる。戦闘前状態はエンジンのメモリ内だけに保持し、再読み込みやセーブ読込後は戦闘再挑戦を出さない。
- 「検証」画面に戦闘バランス試算を追加。標準戦闘の敵・主人公レベル・試行回数（10/20/50）を選び、勝率、勝利時の平均ターン数と残HP、回復アイテム消費を集計する。結果は簡易自動AIによる目安で、独自戦闘モードは試算対象外。
- 「公開準備」に投稿先別の保存されるチェックリストを追加。作品文面、利用条件・クレジット、画像、スマートフォン、セーブ・ロードを確認でき、準備メモにも状態を書き出す。公開用ZIPは必須ファイルと重複名を自動点検し、プロジェクトデータが変わったらZIP確認済み状態を解除する。

これらの追加分も型検査・テスト・ビルドは実行していないため、実際の工房・ゲーム画面での受け入れ確認は残る。

## 11. 発想を初期ルートに閉じ込めないための変更（2026-11-23）

- 起動時の工房画面を「マップ」から「発想」に変更。ブラウザ版・CLIの新規プロジェクトは、主人公と空マップを実行に必要なRPG土台として残し、案内人・導入会話・目的・NPC・イベント・レベル成長・有効化済みのジャンルモジュールを初期追加しない。テーマ別の見本は、作り手が明示して選んだ場合に限って使う。
- `IDEA.md` の最初の試作欄から「10分のプレイ」を必須にしない。操作・勝敗・結末のない形式も、作り手の希望に応じて記述できる。
- 「チャットで作る」の変更案にAIが補った前提と未決事項を表示し、欄自体がない旧形式の返答も取り込み前の確認を必要にした。AI向け返答形式とCLIにも同じ欄を追加。
- `AGENTS.md`、Codex／Claude Codeのスキル、発想ガイド、チャット制作ガイドを更新。ジャンル・遊びの核・役割・操作・勝敗条件・結末などの未指定事項を黙って埋めず、発想に必要な機能がなければローカル環境でエンジン拡張を提案する。
- READMEと初心者ガイドに制約を明記。現在の標準ランナーはRPGであり、ブラウザ版とチャット版は既存のデータ形式が中心。任意の非RPG実行形式がそのまま作れるという意味での自由度ではない。

変更箇所を目視確認。テスト・型検査・ビルド・ブラウザでの操作確認は実行していない。

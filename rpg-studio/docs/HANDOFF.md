# 引き継ぎメモ — RPGシステム工房（2026-11-23 更新）

別のAI（Codex／Claude Code など）がこのプロジェクトを引き継ぐためのメモです。**まずこのファイル、次に `AGENTS.md`（Claude Code は `CLAUDE.md` も）を読んでください。**

---

## 1. これは何か

「ユーザーの発想がそのままゲームになる」制作ツール。RPG形式の純粋エンジン＋ブラウザ工房（React製エディター）に加え、`experience.json` から作品全体を実装する独立作品形式をローカルCLIとブラウザ工房で扱います。

- 公開中: **https://rpg-studio-2k3.pages.dev**（トップ・見本ゲーム `/play/`・ジャンルの回廊 `/gallery/`・工房のPreview版 `/studio/`）
- リポジトリ: `kouima573/myapp` の **`rpg-studio/` フォルダだけ**が対象
- 作業ブランチ: `claude/eloquent-knuth-u58z8y`（v2.4 のコミット時点で全チェックOK）

## 2. 必ず守ること（ユーザーとの約束）

| 約束 | 内容 |
| --- | --- |
| 言語 | ユーザーへの返事は**日本語**。専門用語は噛み砕く |
| 多言語対応はしない | ユーザーの判断で不要（ゲーム・工房とも日本語のまま） |
| 実行形式 | `project.json` は2DトップダウンRPG。`experience.json` は主人公・マップ・HPを要求しない独立作品。発想に合わせて選び、チャットJSON適用がRPG形式向けである制約も伝える |
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
pnpm test                       # vitest（現在205件）
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

1. **素材サイトへの問い合わせ**（`docs/asset-source-inquiries.md`）。OpenTracks は回答済み（2026-11。公開リポジトリ不可・CREDITS記載で可 → `asset-sources.json` の `inquiries`・`publicRepository`）。Freesound は「https://freesound.org/contact/ のフォームから送り直して」と返信あり（送るのはユーザー）。効果音ラボ・itch.io は未送信。問い合わせ文・記録に作り手の氏名や連絡先を入れない。
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

`browserExport.ts` の遊べるZIPは `index.html` をZIP直下に置く（HTML5ホストの要求に合わせる）。RPG形式に独自コードを加えた作品はブラウザ版ではビルドできないため、手元の工房で `pnpm rpg build --project <プロジェクトフォルダー> --zip` を使う。この作業では依存パッケージがなく、型検査・テスト・ビルドは実行していない。公開サイトへのデプロイもしていない。

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

## 12. 独立作品形式の追加（v2.5作業コピー）

- RPGの主人公・マップ・HPを要求しない `experience.json` 形式を追加。`defineExperience` が完全な状態遷移・入力・描画を定義し、ローカルCLIで `new --type experience` / `validate` / `dev` / `build --zip` を扱う。
- `packages/runtime/src/experience.ts` はローカル保存、手動・自動保存、キーボード入力、固定FPS入力、素材URL解決、描画時のフォーカス復元を提供。保存ストレージが使えないブラウザでも作品を起動できる。
- `projects/deep-sea-post-office/` に「昨日を配送する深海郵便局」の試作を追加。宛先・切手の選択で、重力・潮位・暦が変化する。
- `docs/experience-projects.md`、発想ガイド、README、AGENTS、Codex／Claude Codeスキルに形式の選び方と制約を記載。JSON Schemaの生成対象も追加。
- 現在の境界（この節の追加作業より前）: 公開ブラウザ工房とチャット用JSON変更はRPG形式中心。独立作品の自動シナリオテストは未対応。独立作品の試遊はローカル `rpg dev`。
- この作業コピーではテスト・型検査・ビルド・ブラウザでの試遊は未実行。

## 13. 独立作品のブラウザ制作とシナリオ

- `App.tsx` は `experience.json` を検出し、RPGタブを隠して「独立作品」「データ」に切り替える。ヘッダーもRPG検証エラーの誤表示を避け、独立作品タイトルを出す。
- `ExperiencePanel.tsx` はローカル／ブラウザ保存のファイルを編集し、TypeScriptをブラウザ内変換して隔離iframeで試遊する。ブラウザ試遊のストレージとネットワークは無効。`BrowserPanel` で新規独立作品作成、プロジェクトZIP、遊べるZIPの入出力を扱う。
- `experienceScenario.ts` と `rpg test` は `tests/*.experience.json` の `start` / `update` 状態遷移を試験。`equals`・`contains`・`paths` で期待状態を指定する。描画と操作感は自動試験外。

## 14. 独自ランタイムと素材の直接取り込み

- `experience.json` に `runtime: "experience" | "static"` を追加。省略時は従来互換で `experience`。
- `runtime: "static"` は `index.html` 起点の作者独自サイト。CLI build とブラウザ工房のゲームZIPはHTML/CSS/JS/画像/音声/WASM等を相対パスごとコピーし、RPG Studioのランタイム・画面・PWAファイルを注入しない。`.git`、`node_modules`、`.rpg-studio`、`.rpg-backup`、`.env*` は配布から除外。
- `rpg new <id> --type experience --runtime static` とブラウザ工房の「独自HTML（静的サイト）」から開始。`index.html` を含む完成済みサイトZIPもブラウザ工房に読み込める。静的作品の完全な試遊には `pnpm rpg dev --project <dir>` を使う。ブラウザ工房のiframeは相対モジュール/WASMを直接試遊しない。任意のソースビルドは `experience.json` に設定し、ローカルCLIで `--run-project-build` を明示した場合のみ実行。
- 独立作品画面に画像・音声・フォントの登録UIを追加。ブラウザ版はIndexedDBの作品ファイル、ローカル版は作品ディレクトリへ本体を保存し、出典・利用条件・クレジットを `assets.json` に記録する。
- 無料の既存依存・ローカルブラウザ機能のみを利用。外部API・有料サービス・クラウドビルドは追加していない。
- 有料サービス・有料依存は追加していない。ブラウザ変換は構文診断までで、完全な型検査とフル機能ビルドはローカルCLIを使う。チャットJSON差分はRPG向けのまま。
- まだテスト・型検査・ビルド・ブラウザ操作での受け入れ確認は行っていない。

## 15. 静的サイト読み込みと制作UIの整理（2026-11-24）

- ブラウザ工房のZIP読み込みで、作品マニフェストのない完成済みサイトZIPも受け入れ、最浅階層の `index.html` と同じフォルダー以下のファイルから静的作品マニフェストを作る。複数の同階層 `index.html` は曖昧さを避けて案内を出す。
- 静的サイト型の画面表示を明確化。ローカル工房では現在の作品フォルダーを含む `pnpm rpg dev` コマンドをコピーでき、ブラウザ版ではZIP展開と起動方法を表示する。
- 素材の出典・ライセンス・作者・クレジット項目を折りたたみ、外部・生成素材を選んだ場合や入力不足の時に詳細を開く。
- 表示とガイドでは、Studioが扱う静的サイトは完成済みファイルとして扱い、Vite等のソースビルドや任意シェルコマンドを通常は実行しないことを明記。
- これらの変更はコード・説明書の目視確認のみ。テスト・型検査・ビルド・ブラウザ操作は未実施。

## 16. 静的サイトの任意ソースビルド（2026-11-24）

- `experience.json` に任意の `build.command` と相対 `build.outputDir` を設定できる。コマンド文字列を作り手が選べるので、Vite・Webpack・独自スクリプトなど特定の道具を固定しない。
- `pnpm rpg build --project <dir> --run-project-build` を明示した場合だけ、コマンドを作品フォルダーでシェル実行し、成果物を静的配布する。通常の `validate`・`test`・`dev`、ローカルStudioの自動再ビルド、ブラウザ工房では実行しない。
- すでに成果物がある場合は、ビルドコマンドを実行せず `rpg build` / `rpg dev` で成果物を配信できる。設定コマンドはブラウザで実行せず、ブラウザ版のサイトZIPは `outputDir` 内の既存成果物だけを含める。
- `ExperiencePanel` はローカルで明示コマンドと試遊コマンドをコピーできる。ブラウザ版ではプロジェクトZIPからローカルCLIを使う手順を表示。
- 任意コマンド実行の機能追加。インポートしたプロジェクトは設定コマンドを実行しない。作り手は設定を確認したうえで明示フラグを使う。
- これらの変更のテスト・型検査・ビルド・実行確認は未実施。

## 17. v2.5（独立作品）の取り込みと確認（2026-11-28）

v2.5 の作業コピーは、6.23（2回目）の修正より前の版を元にしていたため、そのまま上書きせず「前回の版＝共通の祖先」として3方向で取り込んだ（修正済みの chat.ts・scenario.ts などはこちらの版を保持）。取り込み後に直したもの:

- `BrowserPanel.tsx` の衝突を解消（v2.5 の独立作品向け表示を採用し、\`canExportInBrowser()\` の判定を戻した）
- `blankExperience.ts` のテンプレート文字列内の未エスケープのバッククォート（構文エラー）
- `build.ts`・`index.ts` の型エラー（直前の条件で保証されている `entryFile`）、`runtime/src/experience.ts`（iframe の window の HTMLElement）、`ExperienceAssetsPanel.tsx`、`experienceBrowser.ts`（`readZip` の await 漏れ2か所）
- `experienceScenario.ts` の失敗手順の番号を RPG のシナリオと同じ 0 始まりに
- `experienceBrowser.ts`: 素材が0件のとき生成コードが \`id => {}[id]\` になり構文エラー → 新しい独立作品のブラウザ試遊とゲームZIPが必ず失敗していた。括弧で囲んで修正（`studio/src/lib/experienceBrowser.test.ts`）
- 見本 `deep-sea-post-office` に入力シナリオ `tests/deliver-thursday.experience.json`、`packages/cli/src/experience.test.ts` を追加

素材の取得元: `AssetSourceSchema` に `publicRepository`（"private-only" なら検証が警告）と `inquiries`（運営の回答。`verifiedAt` とは別）を追加。OpenTracks・Freesound の回答を記録。

確認: check・test（195件）・3つの見本の validate/test/build・build:site。ブラウザで、空のRPG土台→ゲームZIP、独立作品を作る→試遊→ゲームZIP、どちらのZIPも別の場所で起動してエラーなし。

## 18. 販売と素材パック（2026-11-28）

ユーザーの方針: 作ったもの（ゲームだけでなく、キャラクターだけ・音楽だけ・マップだけ・タイルだけの素材も）を売れるようにする。工房は「売れる状態に仕上げる」まで、お金のやりとりは販売サイトに任せる（自前の決済・DRM・アカウントは作らない）。

- `LICENSE`（MIT、© 2026 AI人狼ラボ ＝ ユーザーのハンドルネーム）。`packages/runtime/src/credits.ts` の `ENGINE_*`: 書き出したゲームの game.js 先頭の注記、CREDITS.md の MIT 全文、ゲーム内クレジット（RPG・独立作品の experience。static は工房のコードを含まないので対象外）
- 権利の判定 `packages/schema/src/rights.ts`（`assetRights`: sell / pack を ok・check・block）。取得元に `commercial`、素材に `commercial` を追加。カタログの `commercial` は二次情報からの分類で、「ファイルごと」の取得元は varies（人が素材に記録するまで要確認）
- 販売前チェック `packages/cli/src/releaseCheck.ts`（純粋・工房と共用）、`rpg release-check`、工房の「検証」画面の `ReleaseSection`。文章の走査は `proofreadText.ts` の `shownTexts`（proofread と共用）
- 素材パック `packages/schema/src/assetPack.ts`（`planAssetPack`）、ZIP は `packages/schema/src/zip.ts`（工房と共用に移動）、`rpg asset pack`、工房の「素材」画面の `AssetPackSection`
- 確認: test（198件）、ブラウザで販売前チェック（見本の11テストを画面内で実行）と素材パックの書き出し

次の候補（ユーザーの「幅と深さを広げる」）: ストアページの材料の自動生成（スクリーンショット・紹介文）、体験版の書き出し、更新とセーブの互換、楽譜BGMを WAV/OGG に書き出し、マップを画像や Tiled 形式で書き出し、キャラクター・タイルの作成（内蔵ジェネレーターの部品選び・画風）を「素材だけの作品」として作りやすく

## 19. 素材だけの作品を工房の中で作る（2026-11-28）

- キャラクター作り: `packages/cli/src/artgen/characters.ts` に部品の一覧（`BODY_TYPES` など）と `randomCharacter`、工房 `CharacterMakerPanel`（4方向の歩くプレビュー、見本から・おまかせ・作ったものを開き直す）、CLI `rpg art character`（`characterCmd.ts`）。登録時に `generator.spec` に部品の JSON を残すので、あとで同じ絵を作り直せる
- 楽譜BGM → WAV: `packages/runtime/src/songRender.ts`（ゲーム内の再生と同じ音色・包絡。ループ曲は余韻を先頭に重ねる）。工房の楽譜BGM画面の「WAVで書き出す」、素材パックで .song.json に WAV が付く
- マップ → Tiled（.tmj）と1枚絵: `packages/schema/src/mapExport.ts`（`resolveMapLayers` はゲームの描画と同じ規則：オートタイル9分割・動くタイルは最初のコマ）。CLI `rpg map export`（`mapExport.ts`。PNG は artgen の png でデコード）、工房は `studio/src/lib/renderInBrowser.ts`。工房とCLIのマップ画像は画素まで一致することを確認
- 素材パックに `mapIds`（使うタイル画像も自動で入れる。配れないタイルを使うマップは除外）
- 確認: test（202件）、ブラウザでキャラ作成→素材パック、WAV書き出し、マップを含む素材パック

## 20. 敵作り・タイル作り・体験版・作品ページの材料（2026-11-28）

- 「素材作り」画面（`AssetMakerPanel`: キャラクター／敵・モンスター／タイル）。共通の登録は `studio/src/lib/registerGenerated.ts`
- 敵作り・タイル作り `packages/cli/src/artgen/makers.ts`（`monsterSpec`・`randomMonster`・`customTileSheet`。タイルは内蔵の描き方に模様の種・色相・明るさ・画風を加え、動くタイルのコマとオートタイルの9部品も同じ加工で入れる）。CLI `rpg art monster` / `rpg art tiles [--list]`。tiles.json への追加は `packages/cli/src/tileMerge.ts`（`mergeTiles`。素材ライブラリと共用・工房でも使用）
- 体験版 `packages/schema/src/demo.ts`（`project.demo.endWhen` → 自動ルールで `demo-end` エンディング）、`rpg build --demo`、ブラウザ版「体験版ZIPを作る」、「検証」画面の `DemoSection`
- 作品ページの材料 `studio/src/lib/storePage.ts`（ゲームの描画でスクリーンショット、630×500のカバー、紹介文の下書き）、「検証」画面の `StorePageSection`
- 見本の敵の名前「メタルスライム」を「はがねスライム」に（既存作品の名前を避ける）
- 確認: test（205件）、ブラウザで敵とタイルを作って登録→検証OK、体験版の設定→体験版ZIP、作品ページの材料ZIP（カバーの見た目も確認）

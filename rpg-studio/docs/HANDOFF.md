# 引き継ぎメモ — RPGシステム工房（2026-11-22 更新）

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
| 作れるのはRPGだけ | 他ジャンルは「RPGの中に織り込む」形（ジャンルモジュール）で |
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
pnpm test                       # vitest（現在187件）
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

**注意**: リポジトリ直下には個人情報を含む別ファイルがあるため、公開サイトにリポジトリのURLや取得方法は載せていない（工房一式は作者から共有する前提）。

## 7. 残っている仕事

1. **素材サイトへの問い合わせ4通**（`docs/asset-source-inquiries.md`）。文面と公開URLは記入済み、**名前・連絡先だけ未記入**。送るのはユーザー（ユーザーは「任せたい」と言っていた。メールの送信機能がある環境なら、**下書きを作ってユーザーの確認を取ってから**送る。Freesound は mtg@upf.edu、他3件はフォームの場所が未確認）。返事が来たら `packages/schema/src/asset-sources.json` に反映。
2. **取得元カタログの原文確認**（`pnpm rpg asset catalog check` で一覧、読んだら `pnpm rpg asset catalog verify <id> --read-terms`）: 外部の33件が未照合。37件すべて `research.method = "secondary"`（ネットワーク制限で、検索の抜粋と解説記事から作成）。原文を読めたものから `verifiedAt` を記入。特に要注意:
   - OpenTracks（旧DOVA-SYNDROME）: HTML5で音源を取り出せる場合の「3点の条件」が未確認
   - 公開GitHubに音源を置くと再配布にあたるおそれ（効果音ラボなど）
   - 魔王魂: ゲームに入れる際のクレジット要否が未確認
3. **Windows 受け入れ確認の 3〜7**（`docs/windows-acceptance.md`）と記録欄の記入。
4. 公式OAuth/APIでの連携（Freesound・itch.io）は、問い合わせの回答が来てから。
5. 静的ビルドの縮小（game.js の約444KBが Zod。配布版はビルド時検証済みデータを使って外せる余地）。
6. **「200の改善指針」の続き**: 第10弾（v2.4）まで完了。次の🔜10件は `docs/roadmap-200.md` の冒頭（時間帯と色調 029・話者名の色分け 042・会話スキップ/オート 046・フェード演出 049・依頼帳 051・MP/SP 064・ドロップ/盗む 071・持ち物の上限と並べ替え 090・音量スライダー 107・見やすさの設定 116）。ユーザーは「お願いします」で約10件ずつ進める。各回の最後に日本語で報告し、`pnpm deploy:site` の再公開を促す（公開サイトはまだ v1.6）
7. 乗り物の見本（専用の絵がまだない。今はテストのみ）
8. 13種族・104効果はユーザー側でAIを使って作る予定（エンジンの部品は用意済み。データで表せないものはスクリプトで）。

## 8. 知っておくと良い癖・注意

- 物のタイル（木・樽・家具など）は地面込みの1枚。置き場所の地面に合うものを選ぶ。
- ライブラリのタイルシートは**末尾に追加**して番号を守る（取り込み済みプロジェクトの `tiles.json` は番号で参照している）。`pnpm rpg art generate` → `pnpm rpg library add <sheet> --project <dir> --replace` で既存プロジェクトに新タイルが追記される。
- ドット絵エディターで保存した直後は、画像が先に変わるため一瞬「ビルド失敗」が出て、`assets.json` の保存後に回復する（実害なし）。
- 公開サイトの工房はPreview版（保存されない）。「コードを探す」の「VS Codeで開く」はローカル版でのみ意味がある。
- 敵の `enemyTurn` などは「最初に結果を返したスクリプトが勝つ」。順番は `priority`（小さいほど先）。
- シナリオテストでスクリプトのコマンドは `{ "command": "id" }`。見本の最初には種族選択があるので `{ "choose": "human" }` などが必要。

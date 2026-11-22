# 引き継ぎメモ — RPGシステム工房（2026-11-22 更新）

別のAI（Codex／Claude Code など）がこのプロジェクトを引き継ぐためのメモです。**まずこのファイル、次に `AGENTS.md`（Claude Code は `CLAUDE.md` も）を読んでください。**

---

## 1. これは何か

「ユーザーの発想がそのままゲームになる」RPG制作ツール。中身は決定的な純粋エンジン＋ブラウザ実行環境＋工房（React製エディター）＋CLI。

- 公開中: **https://rpg-studio-2k3.pages.dev**（トップ・見本ゲーム `/play/`・ジャンルの回廊 `/gallery/`・工房のPreview版 `/studio/`）
- リポジトリ: `kouima573/myapp` の **`rpg-studio/` フォルダだけ**が対象
- 作業ブランチ: `claude/eloquent-knuth-u58z8y`（最新 `2ddc8d6` の時点で全チェックOK）

## 2. 必ず守ること（ユーザーとの約束）

| 約束 | 内容 |
| --- | --- |
| 言語 | ユーザーへの返事は**日本語**。専門用語は噛み砕く |
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
pnpm test                       # vitest（現在134件）
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
| `packages/modules/src/` | ジャンルモジュール25種（ノベル・パズル・弾幕・カード・タクティクスなど） |
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

## 7. 残っている仕事

1. **素材サイトへの問い合わせ4通**（`docs/asset-source-inquiries.md`）。文面と公開URLは記入済み、**名前・連絡先だけ未記入**。送るのはユーザー（ユーザーは「任せたい」と言っていた。メールの送信機能がある環境なら、**下書きを作ってユーザーの確認を取ってから**送る。Freesound は mtg@upf.edu、他3件はフォームの場所が未確認）。返事が来たら `packages/schema/src/asset-sources.json` に反映。
2. **取得元カタログの原文確認**: 37件すべて `research.method = "secondary"`（ネットワーク制限で、検索の抜粋と解説記事から作成）。原文を読めたものから `verifiedAt` を記入。特に要注意:
   - OpenTracks（旧DOVA-SYNDROME）: HTML5で音源を取り出せる場合の「3点の条件」が未確認
   - 公開GitHubに音源を置くと再配布にあたるおそれ（効果音ラボなど）
   - 魔王魂: ゲームに入れる際のクレジット要否が未確認
3. **Windows 受け入れ確認の 3〜7**（`docs/windows-acceptance.md`）と記録欄の記入。
4. 公式OAuth/APIでの連携（Freesound・itch.io）は、問い合わせの回答が来てから。
5. 静的ビルドの縮小（game.js の約444KBが Zod。配布版はビルド時検証済みデータを使って外せる余地）。
6. 13種族・104効果はユーザー側でAIを使って作る予定（エンジンの部品は用意済み。データで表せないものはスクリプトで）。

## 8. 知っておくと良い癖・注意

- 物のタイル（木・樽・家具など）は地面込みの1枚。置き場所の地面に合うものを選ぶ。
- ライブラリのタイルシートは**末尾に追加**して番号を守る（取り込み済みプロジェクトの `tiles.json` は番号で参照している）。`pnpm rpg art generate` → `pnpm rpg library add <sheet> --project <dir> --replace` で既存プロジェクトに新タイルが追記される。
- ドット絵エディターで保存した直後は、画像が先に変わるため一瞬「ビルド失敗」が出て、`assets.json` の保存後に回復する（実害なし）。
- 公開サイトの工房はPreview版（保存されない）。「コードを探す」の「VS Codeで開く」はローカル版でのみ意味がある。
- 敵の `enemyTurn` などは「最初に結果を返したスクリプトが勝つ」。順番は `priority`（小さいほど先）。
- シナリオテストでスクリプトのコマンドは `{ "command": "id" }`。見本の最初には種族選択があるので `{ "choose": "human" }` などが必要。

# 素材ガイド — 容量・取得元と規約・生成

## 1. 容量の考え方（どこまで入れてよいか）

「ライトにゲームを作りたい人」が、作ったゲームをブラウザ・スマホで遊んでもらい、GitHubなどで管理することを前提にしています。その前提だと、**zipで5GB**は大きすぎます。

| 置き場所・遊び方 | 実際の制限・目安 |
| --- | --- |
| itch.io（HTML5で公開） | 展開後の合計500MB・1ファイル200MB・約1000ファイルまで（公式ドキュメントを引用したフォーラム情報。既定値で、相談で緩和される場合あり）。アップロード自体は1GBまで |
| GitHub | 1ファイル100MBを超えるとpushできない。リポジトリは1GB程度まで推奨（それ以上はGit LFS等が必要） |
| スマホのブラウザ | 起動時に数十MBを超えると、モバイル回線では待ち時間・通信量が問題になる |

このツールの既定値は次のとおりです（`project.json` の `assetPolicy.budget` で変更できます）。

| 設定 | 既定 | サンプル | 意味 |
| --- | --- | --- | --- |
| `warnTotalMB` | 100MB | 50MB | 超えると警告。Web公開で快適に遊べる目安 |
| `maxTotalMB` | 300MB | 100MB | 超えるとエラー。itch.ioの500MB枠に余裕を残す |
| `maxFileMB` | 20MB | 10MB | 1ファイルの上限。GitHub・ブラウザで扱いやすい大きさ |

上限を上げられるのは**2GB程度まで**にとどめることを勧めます。それ以上はWeb配布ではなく、ダウンロード版の別設計が必要です。

**どれくらい入るか（目安）**
- BGM: OGG 96〜128kbpsで1分あたり約0.7〜1MB。2分のループ曲20曲で約30〜40MB。**楽譜BGM（.song.json）なら1曲1〜3KB**
- 効果音: WAVで1個5〜50KB、OGGならさらに小さい。100個でも数MB
- 画像: 64pxドット絵のシート1枚は50〜200KB。キャラ100体・タイルシート20枚でも20〜30MB程度

軽いRPG1本なら、**全部入れて30〜150MB**が現実的な範囲です。`pnpm rpg asset report` で内訳を確認できます。

**軽くするコツ**
- BGMは楽譜BGMにするか、OGG 96〜128kbps・モノラル寄りにして、ループ部分だけにする（同じフレーズを長く繰り返したファイルにしない）
- 効果音は短く切り、22kHz・モノラルで十分
- 画像は64pxセルのまま。大きな1枚絵（背景・立ち絵）は必要な分だけにする

## 2. 入手方法を選ぶ — 生成・サイト・購入・依頼

素材の種類ごとに、入手方法の優先順を `project.json` › `assetPolicy.prefer` に決めておきます（工房の「素材」画面でも設定できます）。

| 方法 | 効果音 | BGM | 画像 |
| --- | --- | --- | --- |
| **生成** | `pnpm rpg asset gen-sfx`（内蔵合成器、権利クリーン） | 楽譜BGM `.song.json`（AIや人が作曲、超軽量） | 共有素材ライブラリ `library/`（内蔵ドット絵ジェネレーター、権利クリーン。§7）／`art/requests.json` の要件定義をもとにAI画像生成 |
| **サイト** | 有効にしたサイトから、規約を確認して `asset add` | 同左 | 同左（CC0・商用可のもの） |
| **購入・依頼** | BOOTH等で購入、ココナラ等で依頼。合意内容を記録 | 同左 | 同左 |

### 取得元カタログとON/OFF
- `packages/schema/src/asset-sources.json` に主なサイトがあります。効果音ラボ、魔王魂、DOVA-SYNDROME、OtoLogic、Kenney、OpenGameArt、Freesound、BOOTH、ココナラと、内蔵の生成手段です。
- 各サイトについて、規約の要点・確認すべき項目（checklist）・クレジットの要否・再配布の可否・自動取得の可否を記録しています。
- サイトごとのON/OFFは `pnpm rpg asset enable|disable --source <id>`、または工房の「素材」画面で切り替えます。**外部サイトは既定ですべてOFF**です。
- 自分で見つけたサイトは `assetPolicy.customSources` に同じ形式で追加できます。

> **重要**: このカタログの規約要約は一般情報で、作成時の環境からは各サイトの規約原文を読めませんでした（`verifiedAt: null`）。素材を追加するたびに、**その時点の規約原文と曲・素材ごとの作者の注意書き**を読んでください。規約は変わります。

### 規約を守るためにツールがすること
`pnpm rpg asset add` と `rpg validate` が次をチェックします。
- 無効にしたサイトの素材は追加できない
- サイト・購入・依頼の素材には、入手元（`sourceId`）・入手ページURL・規約名（`license`）・**規約を確認した日**（`termsCheckedAt`）が必須
- クレジットが必要な素材（`creditRequired`）には、表示する文言（`credit`）が必須。ゲーム内メニューの「クレジット」と、ビルドに同梱される `CREDITS.md` に自動で載る
- 作者の発言・個別条件（例：「AI学習禁止」「動画では要クレジット」）は `notes` に残す
- **共有用プロジェクト**（`assetPolicy.shareable: true`、テンプレートとして配るもの）には、再配布が禁止された素材を入れられない。自分のゲームに組み込むのと、素材として配るのは別扱い
- 1ファイル上限・合計容量の超過はエラー

### 自動ダウンロードについて
多くの素材サイトは、素材の大量取得や機械的な収集を想定していません。カタログの `automatedDownload` が `manual` のサイトは、**AIは候補（ページURLと理由）を提示するだけ**にして、ダウンロードは人が行ってください。ダウンロードしたファイルの登録（`asset add`）はAIが行えます。

### このリポジトリのサンプルについて
サンプルには第三者サイトの素材を入れていません。理由は、素材の再配布が禁止されているサイトが多く、サンプル＝配布物だからです。サンプルの素材は次の3種類だけです。
- 効果音16個: 内蔵ジェネレーターで生成
- BGM3曲: 楽譜BGMとして新規に作曲
- 画像: 元からあるAI生成のオリジナルと、内蔵ドット絵ジェネレーターの生成物（`library/` から取り込んだもの。「ジャンルの回廊」の素材の庭など）

## 3. 効果音を生成する

```sh
pnpm rpg asset gen-sfx --project projects/<id> --preset confirm --seed 3 --id sfx-confirm --cue confirm
```

- プリセット: cursor, confirm, cancel, bump, hit, hurt, heal, encounter, victory, defeat, door, item, save, menu, coin, magic, step, explosion
- `--seed` を変えると少しずつ違う音になります。工房の「素材」画面で試聴してから選べます。
- `--cue` を付けると、その場面（決定・ダメージなど）に割り当てます。割り当てていない場面は、内蔵の簡易音が鳴ります。
- データからは `{ "type": "playSfx", "sound": "sfx-coin" }` で鳴らせます。

## 4. 楽譜BGM（.song.json）

```json
{
  "formatVersion": 1, "title": "苔森の村", "tempo": 100, "loop": true,
  "tracks": [
    { "wave": "pulse25", "volume": 0.13, "notes": "A4/4 C5/8 A4/8 G4/4 F4/4 | G4/4. A4/8 G4/4 E4/4" },
    { "wave": "triangle", "volume": 0.26, "notes": "F2/4 C3/4 F2/4 C3/4 | C3/4 G2/4 C3/4 G2/4" },
    { "wave": "noise", "volume": 0.04, "notes": "x/8 R/8 R/4 x/8 R/8 R/4 | x/8 R/8 R/4 x/8 R/8 R/4" }
  ]
}
```

- 音符: `音名(＋#/b)オクターブ/長さ`。長さは 1・2・4・8・16・32 で、`.` を付けると付点。`R` は休符、`x` は打楽器（ノイズ）。`|` は小節の区切りで、読みやすさのためだけにあります。
- 音色: `square` `pulse25` `pulse12`（ファミコン風）、`triangle`（ベース向き）、`sawtooth`、`sine`、`noise`（打楽器）。トラックは最大8つ。
- 各トラックの長さ（拍数）をそろえると、きれいにループします。`rpg validate` が書き間違いの位置を教えます。
- 割り当て先: マップの `bgm`、敵の `bgm`、`project.json` › `audio.battle`、または効果 `playBgm`。
- 既存曲の旋律を写さないでください。

## 5. 画像 — 要件定義から生成、またはサイトから選ぶ

1. **スタイルガイド** `art/style-guide.md`: 画風・光源・寸法・シート配置の約束事。プロジェクトに1つ置きます。
2. **依頼** `art/requests.json`: 1枚ごとに用途・内容・必須要素・避けること・寸法・`userNotes`（作り手の要望や、前回の結果へのフィードバック）・`mode`（generate / site / commission）・`status` を書きます。
3. **確認**: AIは依頼を `draft` で作り、作り手が工房の「素材」画面で要望を書き込んで `approved` にします。
4. **生成**: `pnpm rpg art prompt --id <依頼>` で、スタイルガイド込みの依頼文を出してAIに生成させます（`mode: site` なら、有効なサイトで条件に合うものを探して `candidates` に記録します）。
5. **納品チェック**: `pnpm rpg art check --id <依頼> --file <png>` で、寸法と背景透過を確認します。
6. **登録**: `pnpm rpg asset add ... --origin generated --source ai-image --request <依頼>` で登録し、依頼を `done` にします。

既存作品・特定の作家の画風・キャラクターの模写はしないでください。使った画像生成サービスの規約（生成物の商用利用、権利の帰属）も確認して `notes` に書きます。

## 6. AIに頼むときの文例

工房の「素材」画面にあるボタン（効果音を追加／BGMを追加／キャラ画像を作る／タイルを増やす）で依頼文をコピーできます。どの依頼文にも、次の3点が入っています。
- まず `pnpm rpg asset sources` で、有効な取得元と確認事項を見る
- `prefer` の順に、生成かサイトかを選ぶ
- 規約を守れない素材は使わず、最後に `rpg validate / test / build / asset report` を実行する

## 7. 共有素材ライブラリ（内蔵ドット絵ジェネレーター）

`library/` には、このリポジトリのコード（`packages/cli/src/artgen/`）が手続き的に描いたオリジナルのドット絵が入っています。第三者の素材・既存作品の模写・ネットからのダウンロードは一切使っていないので、**商用・再配布・改変すべて自由**です（リポジトリのライセンス MIT）。取得元カタログでは `builtin-art`（既定で有効）です。

| 種類 | 数 | 形式 |
| --- | --- | --- |
| タイル | 4シート・165種（野外／町／屋内／ダンジョン） | 64×64セル・8列。32×32で描いて2倍に拡大しているので、マップ表示（32px）で1ドットも欠けない。地面は継ぎ目なく並ぶ |
| キャラクター | 53体（村人・騎士・魔法使い・商人・長老・子ども・獣人・エルフ・ドワーフ・鬼・からくり・幽霊など） | 64×64、4列（歩行: 立ち・足・立ち・足）×4行（下・左・右・上） |
| 敵 | 55体（スライム・コウモリ・狼・鳥・ゴーレム・骸骨・幽霊・花・虫・目玉・竜・キノコ・精霊・蛇・ゴブリン） | 64×64、4列×1行（待機アニメ） |
| 戦闘背景 | 12枚（草原・森・洞窟・遺跡・雪山・砂漠・城・月夜・沼・火山・海辺・迷宮） | 640×448 |

見本（コンタクトシート）は `library/previews/` にあります（`tiles.png`・`characters.png`・`monsters.png`・`backgrounds.png`）。

```sh
pnpm rpg library list [--kind tileset|tile|character|enemy|background] [--query 宝箱]   # 探す（--json も可）
pnpm rpg library add lib-tiles-town chr-knight mon-slime-green bg-field --project projects/<id>
pnpm rpg library add lib-tiles-dungeon --tiles chest-dungeon,pillar --project projects/<id>   # シートの一部のタイルだけ定義
pnpm rpg art generate [--out library] [--only tiles,characters,monsters,backgrounds]           # ライブラリを再生成（同じ結果になる）
```

- `library add` は `rpg asset add` と同じ処理（容量予算・取得元・形式の検査、`bytes` は実ファイルの大きさ）で `assets/` にコピーし、`assets.json` に `origin: "generated"`・`sourceId: "builtin-art"`・`generator`（ツール・版・ライブラリID）付きで登録します。キャラは `frameOrder`・`loop` も記録します。既に同じIDがあれば飛ばします（`--replace` で置き換え）。
- **タイルシート**を取り込むと、`tiles.json` に各タイルの定義（名前・通行可否・代替色・`atlas` にシートID）を、空いている1文字コードで追記します（英数字 → 記号 → ギリシャ文字 → かな → 漢字の順）。既存のタイル・コード・番号は変えません。`--tiles` で一部だけ、`--no-tiles` で画像だけにできます。追加されたコードは実行結果に表示されます（`0=草地 ε=石畳 …`）。
- 物（木・宝箱・樽・家具など）のタイルは、下の地面込みの1枚です（タイルは1マス1枚のため）。草地用・石畳用・床用など、置き場所に合った地面のものを選んでください。
- 絵柄を変えたいときは `packages/cli/src/artgen/` の数値や配色（`paint.ts` の `P`）を変えて `pnpm rpg art generate` し、`library/` の差分を確認してください。描画を変えたら `ARTGEN_VERSION` を上げます。`pnpm test` は `library/` が今のコードの出力と一致するかを確かめます。

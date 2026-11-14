# 画像素材の依頼書（Codex向け）

現在、以下は手続き生成の仮表示です。画像ができたら `projects/sample-rpg/assets/` に置き、`assets.json` に登録すると自動で使われます（コード変更は不要）。

## 共通ルール

- 既存のゲーム・RPGツクール等のキャラクター・タイル・構図を模写しない、オリジナルのデザイン。
- 既存サンプル（`assets/tilesets/sample-village.png`、`assets/characters/*.png`）と同じ、温かみのあるトップダウンJRPG風ピクセルアート。輪郭は1px程度の濃い色、柔らかい陰影。
- PNG（RGBA、背景透過）。セルは **64×64px**（ゲーム内では32×32pxに縮小）、余白・間隔なし。
- 登録時は `bytes`（実ファイルサイズ）と `source`・`license` を正しく記入し、`pnpm rpg validate` でPNG実寸の一致を確認。

## 1. 敵の戦闘グラフィック（優先度：高）

戦闘画面中央に約128pxで表示します。横に並んだフレームを `frameDurationMs` ごとに切り替えます（待機の呼吸・揺れ）。

| ファイル | 内容 | 寸法 |
| --- | --- | --- |
| `assets/enemies/stone-sentinel.png` | 石像の番人。苔むした古い石の守護像、胸か目に琥珀色の光。重量感、ゆっくり揺れる | 4列×1行（256×64） |
| `assets/enemies/moss-slime.png` | コケスライム。苔と小さな花をのせた半透明の緑の粘体、つぶらな目 | 4列×1行 |
| `assets/enemies/cave-bat.png` | ほらあなコウモリ。紫がかった灰色、大きな耳、羽ばたき4コマ | 4列×1行 |

登録例（`database.json` の敵に `"sprite": "stone-sentinel"` を追加）:

```json
{ "id": "stone-sentinel", "path": "assets/enemies/stone-sentinel.png", "kind": "enemy", "mimeType": "image/png", "bytes": 0,
  "source": "…", "license": "…", "tileWidth": 64, "tileHeight": 64, "columns": 4, "rows": 1, "frameDurationMs": 220, "loop": true }
```

## 2. 戦闘背景（優先度：中）

`assets/backgrounds/ruins-battle.png` 640×448、遺跡の内部（苔むした石壁と差し込む光）。現在は単色のグラデーション。※背景の表示にはランタイムの小改修が必要（`database.json` の敵かマップに背景IDを持たせる）。

## 3. 追加タイル（優先度：中）

現在のタイルシートは4×4=16枚すべて使用中です。次を **5行目** として追加した 256×320 のシート（既存16枚の位置は変えない）にすると、`tiles.json` に行を足すだけで使えます。

| index | 内容 |
| --- | --- |
| 16 | 遺跡の床（ひび割れた石板、落ち葉少し）— 現在は落ち葉タイルで代用 |
| 17 | 岩の隙間（獣道で通れる細い割れ目。閉じた状態）— 現在は大岩で代用 |
| 18 | 室内の壁（木の腰板と漆喰）— 長老の家の壁 |
| 19 | 宝箱（閉）※現在はコード描画 |

## 4. 長老オババの専用スプライト（優先度：低）

現在は薬師のシートを流用。`assets/characters/village-elder.png` 64×256（1列×4行：下・左・右・上）、杖と大きな帽子の小柄な老婆。

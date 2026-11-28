# 昨日を配送する深海郵便局

RPGの主人公、歩行マップ、HPを使わず、記憶の配達と選択で変わる世界の法則を遊ぶ独立作品のサンプルです。

```sh
pnpm rpg validate --project projects/deep-sea-post-office
pnpm rpg dev --project projects/deep-sea-post-office
pnpm rpg build --project projects/deep-sea-post-office --zip
```

`experience.json` が作品の入口、`systems/main.ts` が状態・入力・画面を定義します。素材を使う場合は `assets.json` に登録し、出典と利用条件を記録します。

# mods — 作り手どうしで仕組みを分け合う

ここには、プロジェクトをまたいで使える仕組み（`defineSystem` で書いた独自ルール・独自画面・ジャンルモジュール）を置きます。

```sh
pnpm rpg mod list                                   # ここにある mod の一覧
pnpm rpg mod add weather --project projects/<id>    # プロジェクトに取り込む（systems/mods/weather/ にコピーし、project.json に登録）
pnpm rpg mod export <systemId> --project projects/<id> --author "名前" --license MIT   # 自分の仕組みを mod にする
```

- 各 mod は `mods/<id>/mod.json`（id・title・version・author・license・entry・files・genres・requires・usage）と、そのファイルでできています。
- 取り込んだプロジェクトには `mods.json` が書かれ、版・作者・利用条件・内容のハッシュ・取り込んだ日が残ります（出どころを失わない）。
- `requires` に書かれたフラグ・変数・集合は、取り込んだ側の project.json に宣言してください（足りないと警告が出ます）。
- 他人の mod を入れる前に、利用条件（license）と中身を読んでください。mod は TypeScript のコードで、ゲームの中で動きます。

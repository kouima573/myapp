# サンプル「ジャンルの回廊」

ひとつのRPGの中で、いろいろなジャンルの遊びを試せる見本です。像や机を調べると、それぞれ別のジャンルモジュールが開きます。HPや攻撃力などRPGの能力値はそのまま使われ、勝つと「制した遊び」（メニュー）に記録されます。

| 場所 | ジャンル | モジュール |
| --- | --- | --- |
| 語り部の石 | ノベル | `novel.play` |
| 跳躍の門 | 横スクロールアクション | `action.stage`（view: side） |
| 群れの闘技場 | サバイバー系 | `action.stage`（view: top・autoAttack・survive） |
| 作戦卓 | タクティクス | `tactics.battle` |
| 石の水盤 | マッチ3 | `match3.battle` |
| 祭りの太鼓 | リズム | `rhythm.play` |
| 地下倉庫の扉 | 脱出ゲーム | `room.explore` |
| 探偵の机 | 推理 | `deduce.case` |
| 風の走路 | レース | `runner.race` |
| スフィンクス | クイズ・なぞなぞ | `quiz.ask` |
| 石押しの間 | 押しパズル | `puzzle.push` |
| 稽古場 | 育成 | `planner.schedule` |
| 太鼓の精・石塊ゴーレム・なぞかけ狐・スライム王 | 戦闘モード（リズム・パズル・問答・アクション） | 敵の `battle.mode` |

すべての遊び方と、ほかのジャンル（100以上）の作り方は `docs/genre-modules.md` と `docs/genre-atlas.md`（`pnpm rpg genres --query <言葉>`）にあります。自動プレイテスト: `tests/gallery.scenario.json`。

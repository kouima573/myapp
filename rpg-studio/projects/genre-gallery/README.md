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
| 見張りの門 | ステルス | `action.stage`（見張り g・seen: lose） |
| 砲撃の谷 | ランアンドガン | `action.stage`（weapon: gun） |
| 土俵 | 格闘 | `fighter.duel` |
| 対戦台 | ローカル2人対戦 | `fighter.versus` |
| 物見やぐら | タワーディフェンス | `defense.siege` |
| 色石の井戸 | 落ちもの | `blocks.drop` |
| 絵合わせの床 | お絵かきロジック | `logic.solve` |
| 小さな芝 | ゴルフ | `physics.shot` |
| 射的屋 | 射的 | `aim.shoot` |
| 地下への階段 | 3Dダンジョン | `dungeon3d.explore` |
| 陣幕 | 部隊戦（RTS） | `squad.command` |
| 札の卓 | 札勝負（駆け引き） | `table.hand` |
| 吟遊詩人の譜面台 | 作曲 | `composer.compose` |
| ゴーレムの命令台 | プログラミング | `program.run` |
| 鍛冶工房 | 工場・自動化 | `factory.line` |
| 太鼓の精・石塊ゴーレム・なぞかけ狐・スライム王 | 戦闘モード（リズム・パズル・問答・アクション） | 敵の `battle.mode` |

すべての遊び方と、ほかのジャンル（111）の作り方は `docs/genre-modules.md` と `docs/genre-atlas.md`（`pnpm rpg genres --query <言葉>`）にあります。自動プレイテスト: `tests/gallery.scenario.json`。

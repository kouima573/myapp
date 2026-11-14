# ジャンル地図 — どんなジャンルも、RPGの中に

> このファイルは `packages/modules/src/genres.ts` から生成しています（`pnpm rpg genres --write`）。AIは `pnpm rpg genres --query <言葉>` で検索できます。

作れるのは**RPG**です。そのうえで、他のジャンルは **場面**（startScene）・**戦い方**（battle.mode）・**世界のルール**（rules・verbs・signals）・**構造**（周回・分岐・期間）として組み込みます。
ジャンルは組み合わせられます（例: 推理 × ローグライク ＝ 周回するたびに手がかりの一部だけが残る推理、歴史 × ストラテジー × デッキ構築 ＝ 合戦をカードで戦う）。

| 対応 | 意味 |
| --- | --- |
| 組み込み | ジャンルモジュールがそのジャンルの遊びを持っている |
| データで組める | JSONの組み合わせ（モジュール・ルール・動詞・変数）で作れる |
| 拡張で作る | systems/*.ts に scene やフックを書く（出発点をレシピに記載） |
| 一部のみ | この工房の形（1人用・2D・静的配信）では一部だけ |

## 分類軸で考える

| 軸 | 例 | この工房での作り方 |
| --- | --- | --- |
| 遊びの中心 | 戦闘・探索・推理・創造・育成・競争 | 戦闘は戦闘モード、探索はマップと regions、推理は deduce と集合、創造は verbs と setTile、育成は planner、競争は runner や rivals |
| ゲームの仕組み | ターン制・リアルタイム・ローグライク・デッキ構築 | ターン制は scene の input、リアルタイムは realtime と draw、ローグライクは newCycle と手続き生成、デッキ構築は cards |
| 世界・テーマ | ファンタジー・SF・歴史・ホラー・現代 | 素材（タイル・キャラ）と文章で決まる。仕組みには影響しない |
| プレイ人数 | 1人・協力・対戦・大人数 | 基本は1人。ローカル2人は onAction で拡張。対人の駆け引きはNPC相手に（deduce・人狼レシピ） |
| 視点 | 見下ろし・横スクロール・一人称 | 見下ろしが標準。横は action view: side、一人称は疑似3Dの拡張 |
| 進行構造 | ステージ制・オープンワールド・分岐・エンドレス | ステージ制は scene の連続、オープンは portal と sets、分岐は endings、エンドレスは runner か spawner |
| 目的 | クリア・ハイスコア・生存・収集・自由創作 | クリアは goal、ハイスコアは変数と meta、生存は survive、収集は集合、自由創作は sandbox レシピ |

## RPG

| ジャンル | 対応 | モジュール | 作り方 |
| --- | --- | --- | --- |
| JRPG（コマンドバトル） `jrpg` | 組み込み | — | 標準の戦闘・会話・マップ・店・成長。種族や職業は特性、技は能力、世界の理は rules.json |
| アクションRPG `action-rpg` | 組み込み | `action` | 敵の battle.mode を action.stage（view: top）に。ダンジョンの部屋ごとにステージを書き、勝ち負けはRPGの戦利品・経験に |
| シミュレーションRPG `srpg` | 組み込み | `tactics` | 戦闘を tactics.battle に。仲間は allies、ボスは B、勝利条件は goal（rout / boss / reach / survive） |
| ダンジョンRPG `dungeon-rpg` | データで組める | — | setTile を大量に返すアクションで階層を生成、encounters と entities（chase）で徘徊する敵、階段は portal |
| ローグライク `roguelike` | データで組める | — | 手続き生成（system の actions で setTile）＋ 敗北で newCycle（persist: run は消え、meta だけ残る）。一手ごとに世界が動くなら onAction で行動ごとに tick |
| ローグライト（メタ成長） `roguelite` | データで組める | — | persist: "meta" の変数・集合で周回をまたぐ強化。intro で meta を読んで初期能力や解放要素を変える |
| モンスター収集・育成 `monster-collect` | データで組める | `planner` | 仲間は集合（captured）と変数。捕まえる＝勝利ルールで chance → addToSet。育成は planner、図鑑は集合の show |
| オープンワールド `open-world` | データで組める | — | 複数マップを portal でつなぎ、regions と entities で生きた世界に。進行は flags より sets（知識・噂）で非線形に |
| MMORPG `mmorpg` | 一部のみ | — | オンライン多人数は対象外（静的な1人用ゲーム）。NPCの冒険者を entities で動かし、掲示板・ギルドを会話と sets で表すと雰囲気は出せる |

## アクション

| ジャンル | 対応 | モジュール | 作り方 |
| --- | --- | --- | --- |
| プラットフォーマー（横スクロール） `platformer` | 組み込み | `action` | action.stage view: side。足場 #、トゲ ^、コイン *、ゴール G、敵 w f c t |
| メトロイドヴァニア `metroidvania` | データで組める | `action` | 部屋ごとの action.stage と RPG マップの往復。能力（二段跳びの代わりに jump の値や通れるタイル）を flags/abilities で解放し、passableWhen で道が開く |
| ベルトスクロール `beat-em-up` | 組み込み | `action` | action.stage view: top、横長の rows、goal: defeat、spawner s で波状攻撃 |
| ハクスラ `hack-and-slash` | 組み込み | `action` | action.stage view: top。勝利ルールで random ドロップ、装備は items の statMods |
| サバイバー系（バレットヘブン） `survivors-like` | 組み込み | `action` | action.stage view: top、autoAttack: true、spawner s を複数、goal: survive と seconds |
| ソウルライク `soulslike` | データで組める | `action` | ボスを action.stage（B）に。defeat ルールで「落とした魂」を変数に預け、teleport で篝火（セーブ地点）へ。拾い直しは entity |
| ステルス `stealth` | 拡張で作る | — | 見張りは entities（patrol）。視界は system の onTick で向き・距離を判定 → 見つかったら signal。描画は drawOverlay で視界の扇形 |
| ランアンドガン `run-and-gun` | 拡張で作る | `action` | action.stage の剣を弾に置き換える scene を systems/*.ts に（action.ts をコピーして swing を弾に） |
| 格闘 `fighting` | 拡張で作る | `action` | 1対1は action.stage（view: side、B のみ）が近い。コマンド入力・ガード・コンボは action.ts を元に専用 scene を作る |
| ツインスティック `twin-stick` | 拡張で作る | `action` | 移動と射撃方向を分ける scene。入力は held の組み合わせ（fire+矢印で射撃方向） |
| パズルアクション `puzzle-platformer` | データで組める | `action` `puzzle` | 仕掛けの状態（フラグ）ごとに別の rows を if で選んで action.stage を開く。押しパズル puzzle.push と交互に |

## シューティング

| ジャンル | 対応 | モジュール | 作り方 |
| --- | --- | --- | --- |
| 縦スクロールSTG・弾幕 `shmup` | 組み込み | `shooter` | 敵の battle.mode を shooter.battle に。phases と patterns（ring / aimed / spiral / rain） |
| レールシューティング `rail-shooter` | 拡張で作る | `shooter` | shooter.ts を元に、自機の位置を自動で進めて照準だけを動かす scene |
| 射的・ガンシューティング `gallery` | 拡張で作る | — | realtime scene で的を出し、決定で当たり判定。点数を変数に |
| FPS / TPS `fps-tps` | 一部のみ | — | 3D描画は対象外。drawOverlay か realtime scene の疑似3D（レイキャスト）なら拡張で可能 |

## アドベンチャー・ノベル

| ジャンル | 対応 | モジュール | 作り方 |
| --- | --- | --- | --- |
| ビジュアルノベル `visual-novel` | 組み込み | `novel` | novel.play。立ち絵 portrait、背景 bg、選択肢 choices、ラベルと jump、条件つきの行 when |
| キネティックノベル `kinetic-novel` | 組み込み | `novel` | 選択肢のない novel.play。章ごとに markDone して進行 |
| サウンドノベル `sound-novel` | 組み込み | `novel` | novel の effects で playBgm / playSfx を行ごとに。背景を暗くして文章中心に |
| ポイント＆クリック `point-and-click` | 組み込み | `room` | room.explore。部屋 rooms、調べる場所 hotspots、アイテムを選んで使う needs |
| 脱出ゲーム `escape-room` | 組み込み | `room` `quiz` | room.explore（exit: true が出口）＋ 暗号は quiz.ask（入力式）を hotspot の effects から開く |
| 探索ADV `exploration-adv` | データで組める | `room` | マップを歩いて tile inspect・regions・examine ルールで調べる。部屋の細部は room.explore |
| 推理ADV `mystery` | 組み込み | `deduce` | 手がかりは集合（clues）に集め、deduce.case の evidence.when で現れる。証言の矛盾 → 犯人の選択 |
| 法廷・論戦 `courtroom` | 組み込み | `deduce` | deduce.case の statements（press で問いただす、contradiction で崩す）。lives が尽きると onLose |
| 恋愛ADV・恋愛シミュ `romance` | データで組める | `novel` `planner` | 好感度は変数、会話の分岐は when。デートや予定は planner、告白は novel、結末は endings |
| インタラクティブドラマ `interactive-drama` | データで組める | `novel` | 時間制限つきの選択は schedule と choice。選んだことを sets に記録して後の場面を変える |
| マルチエンディング `multi-ending` | データで組める | — | endings を宣言し、条件で ending 効果。到達した結末は meta の集合 endings に残る |
| テキストアドベンチャー `text-adventure` | データで組める | `novel` `quiz` | novel の選択肢、または quiz.ask の入力式で「北へ」「鍵を使う」のような命令を受け付ける |
| ウォーキングシミュレーター `walking-sim` | データで組める | — | regions の onEnter で独白、verbs（耳を澄ます・思い出す）、sets で記憶が集まる |

## パズル

| ジャンル | 対応 | モジュール | 作り方 |
| --- | --- | --- | --- |
| 倉庫番・押しパズル `sokoban` | 組み込み | `puzzle` | puzzle.push。盤面を文字で書き、解き方をシナリオテストで確認 |
| マッチ3 `match3` | 組み込み | `match3` | match3.battle。石ごとの効果（攻撃・回復・守り・得点・変数） |
| パズルバトル `puzzle-battle` | 組み込み | `match3` | 敵の battle.mode を match3.battle に。enemyEvery 手ごとに敵が攻撃 |
| 落ちもの `falling-blocks` | 拡張で作る | `match3` | match3.ts の重力・補充・連鎖を元に、落下する組を操作する realtime scene を作る |
| ロジック（数独・お絵かきロジック） `logic` | 拡張で作る | — | 盤面を data に持つ scene。入力は矢印と決定、正解判定は純粋関数で（puzzle.ts が見本） |
| 物理パズル `physics` | 拡張で作る | — | realtime scene に簡単な物理（action.ts の moveBox が見本） |
| 言葉遊び・なぞなぞ `word` | 組み込み | `quiz` | quiz.ask の入力式。表記ゆれ（カタカナ/ひらがな・全角半角）は吸収される |
| 空間認識・スイッチ `spatial` | データで組める | `puzzle` | マップの床に tile inspect と setTile。押した順を変数で覚え、正しい順で扉（passableWhen） |
| 隠し物探し `hidden-object` | 組み込み | `room` | room.explore の hotspot に hidden: true。見つけた数を変数に |

## シミュレーション・戦略

| ジャンル | 対応 | モジュール | 作り方 |
| --- | --- | --- | --- |
| 街づくり `city-building` | データで組める | `planner` | planner の行動で建物を建て（setTile で村の見た目も変わる）、人口・資金は変数、毎ターンの収支は onTurnEnd |
| 国家運営・内政 `nation` | データで組める | `planner` | planner で政策を選び、民の不満などを変数に。条件で反乱イベント（auto ルール） |
| 戦争・合戦 `war` | 組み込み | `tactics` | tactics.battle を章ごとに。兵力は allies、勝敗で領地（集合）が変わる |
| ターン制ストラテジー `turn-strategy` | 組み込み | `tactics` | tactics.battle（goal: boss / survive）。大きな地図は planner で戦略、局地戦は tactics |
| RTS `rts` | 拡張で作る | `action` | action.stage view: top を元に、複数のユニットを選んで命令する realtime scene |
| タワーディフェンス `tower-defense` | 拡張で作る | `action` | 簡易版は action.stage（spawner + goal: survive）。設置型は、道とタワーを持つ realtime scene を作る（action.ts の敵の動きが流用できる） |
| コロニーシミュ `colony` | データで組める | `planner` | 住人は entities（wander）と変数。planner で割り振り、tick ルールで食料が減る |
| 4X `4x` | データで組める | `planner` `tactics` | 探索（マップ）→ 拡張（planner で開拓）→ 開発（変数）→ 殲滅（tactics） |
| 神ゲー `god-game` | データで組める | — | 主人公を setPlayer で神に。verbs（雨を降らせる・大地を起こす）で setTile と変数、住人は entities |
| 生活シミュ `life-sim` | 組み込み | `planner` | planner.schedule の turns を日・週に。仕事・勉強・遊びの行動 |
| 農業・スローライフ `farming` | データで組める | `planner` | 畑のタイルを verbs（耕す・水をやる）で setTile、tick ルールで成長、収穫はアイテム。季節は planner か変数 |
| クラフト `crafting` | データで組める | — | choice の選択肢で素材（items）を takeItem → giveItem。レシピは集合で覚え、when で表示 |
| 料理 `cooking` | データで組める | `match3` `rhythm` | 材料集めは match3（var の石）、調理の手際は rhythm、出来は変数 |
| 経営・タイクーン `management` | 組み込み | `planner` | planner で仕入れ・値付け・宣伝。資金と評判は変数、onEnd で結果発表 |
| 育成 `raising` | 組み込み | `planner` | planner.schedule で能力を伸ばし、onEnd の if で結果（大会・試験） |
| ペット・たまごっち `pet` | データで組める | `planner` | 空腹や機嫌は変数、tick ルールで変化、verbs（なでる・ごはん）で世話。放っておくと特性が変わる |
| スポーツ監督 `sports-management` | データで組める | `planner` `tactics` | 練習は planner、試合は tactics（選手は allies） |

## スポーツ・レース

| ジャンル | 対応 | モジュール | 作り方 |
| --- | --- | --- | --- |
| レース `racing` | 組み込み | `runner` | runner.race。rivals と place、ブースト + 、障害物 # |
| カートレース `kart` | 組み込み | `runner` | runner.race の track にブーストとコイン。アイテムはコイン数を変数に移して次のレースで使う |
| ランゲーム `endless-runner` | 組み込み | `runner` | runner.race（track を空にすると自動生成、density で難易度） |
| スポーツ競技 `sports` | 拡張で作る | `runner` `rhythm` | 短距離は runner、リズムを競う競技は rhythm。球技はボールの物理を持つ realtime scene を作る |
| 釣り `fishing` | 組み込み | `rhythm` | rhythm.play の1レーンの譜面（x... だけ）でタイミング、釣果は onWin の giveItem |

## リズム・音楽

| ジャンル | 対応 | モジュール | 作り方 |
| --- | --- | --- | --- |
| リズムゲーム `rhythm` | 組み込み | `rhythm` | rhythm.play。chart は1行4文字、bpm と stepsPerBeat |
| リズムバトル `rhythm-battle` | 組み込み | `rhythm` | 敵の battle.mode を rhythm.play に。当てれば攻撃、外せば被弾 |
| ダンス `dance` | 組み込み | `rhythm` | rhythm.play と、踊りの成否で好感度や祭りの結果（変数） |
| 作曲・演奏 `music-making` | 拡張で作る | — | 楽譜BGM（song）の形式を使い、音符を置く scene を作る |

## ホラー・サバイバル

| ジャンル | 対応 | モジュール | 作り方 |
| --- | --- | --- | --- |
| サバイバルホラー `survival-horror` | データで組める | `action` `room` | 暗闇と灯り（drawOverlay）、追ってくる entities（chase）、弾薬は変数、謎は room |
| 心理ホラー `psychological-horror` | データで組める | — | 周回（newCycle）で同じ場所が少しずつ変わる。overlays と条件つきの会話で違和感を積む |
| サバイバル `survival` | データで組める | `action` | 空腹・体温は変数と tick ルール、資源は items、クラフトは choice、夜は action（goal: survive） |
| サンドボックス `sandbox` | データで組める | — | verbs（掘る・置く）と front 条件で目の前のタイルを setTile。持てる素材は items |
| 脱出型（エクストラクション） `extraction` | データで組める | `action` | 出撃は action.stage、持ち帰った物は onWin で items、負けると持ち込んだ物を失う（onLose で takeItem） |

## カード・ボード

| ジャンル | 対応 | モジュール | 作り方 |
| --- | --- | --- | --- |
| デッキ構築 `deckbuilder` | 組み込み | `cards` | 敵の battle.mode を cards.battle に。cards と deck を args に |
| デッキ構築ローグライク `deckbuilder-roguelike` | データで組める | `cards` | cards.battle ＋ 勝利でカードを集合に追加 ＋ 敗北で newCycle |
| トレーディングカード風 `ccg` | データで組める | `cards` | 持っているカードは items、デッキ編成は planner、対戦は cards.battle |
| ボードゲーム（陣取り） `board` | 組み込み | `tactics` | tactics.battle の盤面と駒。将棋やチェスの完全なルールは拡張（tactics.ts が見本） |
| すごろく `sugoroku` | データで組める | — | random でサイコロ、マスは entities、止まったマスのイベントは moveEntity と条件 |
| 麻雀・ポーカーなど `table-games` | 拡張で作る | `cards` | 手札と役判定を持つ scene（cards.ts の山札・手札が見本）。実際のお金は扱わない |
| オートバトラー `auto-battler` | 拡張で作る | `tactics` | tactics.ts の enemyPhase を味方にも適用して自動で戦う scene。編成は planner |
| ガチャ（ゲーム内） `gacha` | データで組める | — | random と if でゲーム内通貨からアイテム。現実のお金や課金は扱わない |

## 推理・心理戦・対人

| ジャンル | 対応 | モジュール | 作り方 |
| --- | --- | --- | --- |
| 推理・心理戦 `deduction` | 組み込み | `deduce` | deduce.case |
| 人狼・正体隠匿（対NPC） `social-deduction` | データで組める | `deduce` | 役は intro の random で NPC ごとの変数に。会話は when で役ごとに嘘をつき、最後は deduce の question で指名 |
| ブラフ・駆け引き `bluffing` | 拡張で作る | `cards` | 相手の手が見えないカード scene。相手の思考は seed つき乱数と性格の変数 |
| パーティーゲーム（ミニゲーム集） `party` | データで組める | `action` `runner` `rhythm` `quiz` `match3` | すごろくの各マスで別のモジュールを startScene。点数を変数に集計 |
| ローカル対戦・協力 `local-versus` | 拡張で作る | — | onAction で同じキーボードの別キーを2人目に割り当てる scene。オンライン対戦は対象外 |
| 非対称対戦（対NPC） `asymmetric` | データで組める | — | setPlayer で追う側／追われる側を周回ごとに入れ替え、相手は entities（chase / flee） |
| バトルロイヤル風 `battle-royale` | データで組める | `action` | action.stage（top、spawner、goal: survive）を連続させ、狭まる範囲は rows を段階ごとに変える |

## 放置・その他

| ジャンル | 対応 | モジュール | 作り方 |
| --- | --- | --- | --- |
| 放置ゲーム `idle` | データで組める | — | tick ルールで資源（変数）が増え、verbs で強化を買う。HUD に変数（hud: true） |
| クリッカー `clicker` | データで組める | — | verbs にキー（例: c）を割り当てて変数を加算、auto ルールで段階ごとに解放 |
| インクリメンタル `incremental` | データで組める | — | persist: meta の変数で周回強化（転生 = newCycle） |
| タイピング `typing` | 組み込み | `quiz` | quiz.ask の入力式（answer に正解文字列）。戦闘モードにすれば打ち込みで攻撃 |
| 学習・クイズ `educational` | 組み込み | `quiz` | quiz.ask。正解ごとの onCorrect で経験値や手がかり |
| 写真・観察 `photography` | データで組める | — | verbs（撮る）と front 条件で対象を判定、撮った物は集合（アルバムは show: true） |
| 配達・お使い `delivery` | データで組める | `runner` | schedule の制限時間、または runner.race（seconds）。届け先は entities |
| タイムループ `time-loop` | データで組める | — | newCycle と meta の集合で記憶を持ち越し、NPCの台詞を cycle と記憶で変える |
| プログラミング（命令を組む） `programming` | 拡張で作る | — | 命令の並びを組み立てる scene を作り、実行結果を setTile や moveEntity で見せる |
| 工場・自動化 `factory` | 拡張で作る | `planner` | 簡易版は planner（生産ライン＝行動）。配置型はベルトと機械を持つ scene を作る |
| 3Dダンジョン（疑似） `first-person-dungeon` | 拡張で作る | — | マップと向きから壁を描く疑似3D scene（drawOverlay か realtime scene） |
| MUD・テキストRPG `mud` | データで組める | `novel` `quiz` | 移動は choice、戦闘は標準、描写は novel |

全104ジャンル（組み込み 37・データで組める 45・拡張で作る 20・一部のみ 2）。ここにないジャンルも、[idea-to-game.md](idea-to-game.md) の分解（状態・きっかけ・変化・見せ方）で作れます。作ったら genres.ts に1行足してください。

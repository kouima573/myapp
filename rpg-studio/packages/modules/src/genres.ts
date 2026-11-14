/**
 * Genre atlas: how to build each game genre (major, niche and new) inside this RPG engine.
 * The game stays an RPG; a genre becomes a scene, a battle mode, a world rule, or a structure around the RPG.
 * `rpg genres` prints it; docs/genre-atlas.md is generated from it (`rpg genres --write`).
 *
 * level: built-in = a genre module plays it   data = JSON recipe (flags, rules, verbs, modules combined)
 *        extend = write a systems/*.ts scene or hook (the recipe says where to start)
 *        limited = only partly possible here (the recipe says what is and is not)
 */
export type GenreLevel = "built-in" | "data" | "extend" | "limited";
export interface Genre { id: string; name: string; family: string; level: GenreLevel; modules: string[]; recipe: string }

type Row = [id: string, name: string, level: GenreLevel, modules: string, recipe: string];
const FAMILIES: Array<[family: string, rows: Row[]]> = [
  ["RPG", [
    ["jrpg", "JRPG（コマンドバトル）", "built-in", "", "標準の戦闘・会話・マップ・店・成長。種族や職業は特性、技は能力、世界の理は rules.json"],
    ["action-rpg", "アクションRPG", "built-in", "action", "敵の battle.mode を action.stage（view: top）に。ダンジョンの部屋ごとにステージを書き、勝ち負けはRPGの戦利品・経験に"],
    ["srpg", "シミュレーションRPG", "built-in", "tactics", "戦闘を tactics.battle に。仲間は allies、ボスは B、勝利条件は goal（rout / boss / reach / survive）"],
    ["dungeon-rpg", "ダンジョンRPG", "data", "", "setTile を大量に返すアクションで階層を生成、encounters と entities（chase）で徘徊する敵、階段は portal"],
    ["roguelike", "ローグライク", "data", "", "手続き生成（system の actions で setTile）＋ 敗北で newCycle（persist: run は消え、meta だけ残る）。一手ごとに世界が動くなら onAction で行動ごとに tick"],
    ["roguelite", "ローグライト（メタ成長）", "data", "", "persist: \"meta\" の変数・集合で周回をまたぐ強化。intro で meta を読んで初期能力や解放要素を変える"],
    ["monster-collect", "モンスター収集・育成", "data", "planner", "仲間は集合（captured）と変数。捕まえる＝勝利ルールで chance → addToSet。育成は planner、図鑑は集合の show"],
    ["open-world", "オープンワールド", "data", "", "複数マップを portal でつなぎ、regions と entities で生きた世界に。進行は flags より sets（知識・噂）で非線形に"],
    ["mmorpg", "MMORPG", "limited", "", "オンライン多人数は対象外（静的な1人用ゲーム）。NPCの冒険者を entities で動かし、掲示板・ギルドを会話と sets で表すと雰囲気は出せる"],
  ]],
  ["アクション", [
    ["platformer", "プラットフォーマー（横スクロール）", "built-in", "action", "action.stage view: side。足場 #、トゲ ^、コイン *、ゴール G、敵 w f c t"],
    ["metroidvania", "メトロイドヴァニア", "data", "action", "部屋ごとの action.stage と RPG マップの往復。能力（二段跳びの代わりに jump の値や通れるタイル）を flags/abilities で解放し、passableWhen で道が開く"],
    ["beat-em-up", "ベルトスクロール", "built-in", "action", "action.stage view: top、横長の rows、goal: defeat、spawner s で波状攻撃"],
    ["hack-and-slash", "ハクスラ", "built-in", "action", "action.stage view: top。勝利ルールで random ドロップ、装備は items の statMods"],
    ["survivors-like", "サバイバー系（バレットヘブン）", "built-in", "action", "action.stage view: top、autoAttack: true、spawner s を複数、goal: survive と seconds"],
    ["soulslike", "ソウルライク", "data", "action", "ボスを action.stage（B）に。defeat ルールで「落とした魂」を変数に預け、teleport で篝火（セーブ地点）へ。拾い直しは entity"],
    ["stealth", "ステルス", "extend", "", "見張りは entities（patrol）。視界は system の onTick で向き・距離を判定 → 見つかったら signal。描画は drawOverlay で視界の扇形"],
    ["run-and-gun", "ランアンドガン", "extend", "action", "action.stage の剣を弾に置き換える scene を systems/*.ts に（action.ts をコピーして swing を弾に）"],
    ["fighting", "格闘", "extend", "action", "1対1は action.stage（view: side、B のみ）が近い。コマンド入力・ガード・コンボは action.ts を元に専用 scene を作る"],
    ["twin-stick", "ツインスティック", "extend", "action", "移動と射撃方向を分ける scene。入力は held の組み合わせ（fire+矢印で射撃方向）"],
    ["puzzle-platformer", "パズルアクション", "data", "action,puzzle", "仕掛けの状態（フラグ）ごとに別の rows を if で選んで action.stage を開く。押しパズル puzzle.push と交互に"],
  ]],
  ["シューティング", [
    ["shmup", "縦スクロールSTG・弾幕", "built-in", "shooter", "敵の battle.mode を shooter.battle に。phases と patterns（ring / aimed / spiral / rain）"],
    ["rail-shooter", "レールシューティング", "extend", "shooter", "shooter.ts を元に、自機の位置を自動で進めて照準だけを動かす scene"],
    ["gallery", "射的・ガンシューティング", "extend", "", "realtime scene で的を出し、決定で当たり判定。点数を変数に"],
    ["fps-tps", "FPS / TPS", "limited", "", "3D描画は対象外。drawOverlay か realtime scene の疑似3D（レイキャスト）なら拡張で可能"],
  ]],
  ["アドベンチャー・ノベル", [
    ["visual-novel", "ビジュアルノベル", "built-in", "novel", "novel.play。立ち絵 portrait、背景 bg、選択肢 choices、ラベルと jump、条件つきの行 when"],
    ["kinetic-novel", "キネティックノベル", "built-in", "novel", "選択肢のない novel.play。章ごとに markDone して進行"],
    ["sound-novel", "サウンドノベル", "built-in", "novel", "novel の effects で playBgm / playSfx を行ごとに。背景を暗くして文章中心に"],
    ["point-and-click", "ポイント＆クリック", "built-in", "room", "room.explore。部屋 rooms、調べる場所 hotspots、アイテムを選んで使う needs"],
    ["escape-room", "脱出ゲーム", "built-in", "room,quiz", "room.explore（exit: true が出口）＋ 暗号は quiz.ask（入力式）を hotspot の effects から開く"],
    ["exploration-adv", "探索ADV", "data", "room", "マップを歩いて tile inspect・regions・examine ルールで調べる。部屋の細部は room.explore"],
    ["mystery", "推理ADV", "built-in", "deduce", "手がかりは集合（clues）に集め、deduce.case の evidence.when で現れる。証言の矛盾 → 犯人の選択"],
    ["courtroom", "法廷・論戦", "built-in", "deduce", "deduce.case の statements（press で問いただす、contradiction で崩す）。lives が尽きると onLose"],
    ["romance", "恋愛ADV・恋愛シミュ", "data", "novel,planner", "好感度は変数、会話の分岐は when。デートや予定は planner、告白は novel、結末は endings"],
    ["interactive-drama", "インタラクティブドラマ", "data", "novel", "時間制限つきの選択は schedule と choice。選んだことを sets に記録して後の場面を変える"],
    ["multi-ending", "マルチエンディング", "data", "", "endings を宣言し、条件で ending 効果。到達した結末は meta の集合 endings に残る"],
    ["text-adventure", "テキストアドベンチャー", "data", "novel,quiz", "novel の選択肢、または quiz.ask の入力式で「北へ」「鍵を使う」のような命令を受け付ける"],
    ["walking-sim", "ウォーキングシミュレーター", "data", "", "regions の onEnter で独白、verbs（耳を澄ます・思い出す）、sets で記憶が集まる"],
  ]],
  ["パズル", [
    ["sokoban", "倉庫番・押しパズル", "built-in", "puzzle", "puzzle.push。盤面を文字で書き、解き方をシナリオテストで確認"],
    ["match3", "マッチ3", "built-in", "match3", "match3.battle。石ごとの効果（攻撃・回復・守り・得点・変数）"],
    ["puzzle-battle", "パズルバトル", "built-in", "match3", "敵の battle.mode を match3.battle に。enemyEvery 手ごとに敵が攻撃"],
    ["falling-blocks", "落ちもの", "extend", "match3", "match3.ts の重力・補充・連鎖を元に、落下する組を操作する realtime scene を作る"],
    ["logic", "ロジック（数独・お絵かきロジック）", "extend", "", "盤面を data に持つ scene。入力は矢印と決定、正解判定は純粋関数で（puzzle.ts が見本）"],
    ["physics", "物理パズル", "extend", "", "realtime scene に簡単な物理（action.ts の moveBox が見本）"],
    ["word", "言葉遊び・なぞなぞ", "built-in", "quiz", "quiz.ask の入力式。表記ゆれ（カタカナ/ひらがな・全角半角）は吸収される"],
    ["spatial", "空間認識・スイッチ", "data", "puzzle", "マップの床に tile inspect と setTile。押した順を変数で覚え、正しい順で扉（passableWhen）"],
    ["hidden-object", "隠し物探し", "built-in", "room", "room.explore の hotspot に hidden: true。見つけた数を変数に"],
  ]],
  ["シミュレーション・戦略", [
    ["city-building", "街づくり", "data", "planner", "planner の行動で建物を建て（setTile で村の見た目も変わる）、人口・資金は変数、毎ターンの収支は onTurnEnd"],
    ["nation", "国家運営・内政", "data", "planner", "planner で政策を選び、民の不満などを変数に。条件で反乱イベント（auto ルール）"],
    ["war", "戦争・合戦", "built-in", "tactics", "tactics.battle を章ごとに。兵力は allies、勝敗で領地（集合）が変わる"],
    ["turn-strategy", "ターン制ストラテジー", "built-in", "tactics", "tactics.battle（goal: boss / survive）。大きな地図は planner で戦略、局地戦は tactics"],
    ["rts", "RTS", "extend", "action", "action.stage view: top を元に、複数のユニットを選んで命令する realtime scene"],
    ["tower-defense", "タワーディフェンス", "extend", "action", "簡易版は action.stage（spawner + goal: survive）。設置型は、道とタワーを持つ realtime scene を作る（action.ts の敵の動きが流用できる）"],
    ["colony", "コロニーシミュ", "data", "planner", "住人は entities（wander）と変数。planner で割り振り、tick ルールで食料が減る"],
    ["4x", "4X", "data", "planner,tactics", "探索（マップ）→ 拡張（planner で開拓）→ 開発（変数）→ 殲滅（tactics）"],
    ["god-game", "神ゲー", "data", "", "主人公を setPlayer で神に。verbs（雨を降らせる・大地を起こす）で setTile と変数、住人は entities"],
    ["life-sim", "生活シミュ", "built-in", "planner", "planner.schedule の turns を日・週に。仕事・勉強・遊びの行動"],
    ["farming", "農業・スローライフ", "data", "planner", "畑のタイルを verbs（耕す・水をやる）で setTile、tick ルールで成長、収穫はアイテム。季節は planner か変数"],
    ["crafting", "クラフト", "data", "", "choice の選択肢で素材（items）を takeItem → giveItem。レシピは集合で覚え、when で表示"],
    ["cooking", "料理", "data", "match3,rhythm", "材料集めは match3（var の石）、調理の手際は rhythm、出来は変数"],
    ["management", "経営・タイクーン", "built-in", "planner", "planner で仕入れ・値付け・宣伝。資金と評判は変数、onEnd で結果発表"],
    ["raising", "育成", "built-in", "planner", "planner.schedule で能力を伸ばし、onEnd の if で結果（大会・試験）"],
    ["pet", "ペット・たまごっち", "data", "planner", "空腹や機嫌は変数、tick ルールで変化、verbs（なでる・ごはん）で世話。放っておくと特性が変わる"],
    ["sports-management", "スポーツ監督", "data", "planner,tactics", "練習は planner、試合は tactics（選手は allies）"],
  ]],
  ["スポーツ・レース", [
    ["racing", "レース", "built-in", "runner", "runner.race。rivals と place、ブースト + 、障害物 #"],
    ["kart", "カートレース", "built-in", "runner", "runner.race の track にブーストとコイン。アイテムはコイン数を変数に移して次のレースで使う"],
    ["endless-runner", "ランゲーム", "built-in", "runner", "runner.race（track を空にすると自動生成、density で難易度）"],
    ["sports", "スポーツ競技", "extend", "runner,rhythm", "短距離は runner、リズムを競う競技は rhythm。球技はボールの物理を持つ realtime scene を作る"],
    ["fishing", "釣り", "built-in", "rhythm", "rhythm.play の1レーンの譜面（x... だけ）でタイミング、釣果は onWin の giveItem"],
  ]],
  ["リズム・音楽", [
    ["rhythm", "リズムゲーム", "built-in", "rhythm", "rhythm.play。chart は1行4文字、bpm と stepsPerBeat"],
    ["rhythm-battle", "リズムバトル", "built-in", "rhythm", "敵の battle.mode を rhythm.play に。当てれば攻撃、外せば被弾"],
    ["dance", "ダンス", "built-in", "rhythm", "rhythm.play と、踊りの成否で好感度や祭りの結果（変数）"],
    ["music-making", "作曲・演奏", "extend", "", "楽譜BGM（song）の形式を使い、音符を置く scene を作る"],
  ]],
  ["ホラー・サバイバル", [
    ["survival-horror", "サバイバルホラー", "data", "action,room", "暗闇と灯り（drawOverlay）、追ってくる entities（chase）、弾薬は変数、謎は room"],
    ["psychological-horror", "心理ホラー", "data", "", "周回（newCycle）で同じ場所が少しずつ変わる。overlays と条件つきの会話で違和感を積む"],
    ["survival", "サバイバル", "data", "action", "空腹・体温は変数と tick ルール、資源は items、クラフトは choice、夜は action（goal: survive）"],
    ["sandbox", "サンドボックス", "data", "", "verbs（掘る・置く）と front 条件で目の前のタイルを setTile。持てる素材は items"],
    ["extraction", "脱出型（エクストラクション）", "data", "action", "出撃は action.stage、持ち帰った物は onWin で items、負けると持ち込んだ物を失う（onLose で takeItem）"],
  ]],
  ["カード・ボード", [
    ["deckbuilder", "デッキ構築", "built-in", "cards", "敵の battle.mode を cards.battle に。cards と deck を args に"],
    ["deckbuilder-roguelike", "デッキ構築ローグライク", "data", "cards", "cards.battle ＋ 勝利でカードを集合に追加 ＋ 敗北で newCycle"],
    ["ccg", "トレーディングカード風", "data", "cards", "持っているカードは items、デッキ編成は planner、対戦は cards.battle"],
    ["board", "ボードゲーム（陣取り）", "built-in", "tactics", "tactics.battle の盤面と駒。将棋やチェスの完全なルールは拡張（tactics.ts が見本）"],
    ["sugoroku", "すごろく", "data", "", "random でサイコロ、マスは entities、止まったマスのイベントは moveEntity と条件"],
    ["table-games", "麻雀・ポーカーなど", "extend", "cards", "手札と役判定を持つ scene（cards.ts の山札・手札が見本）。実際のお金は扱わない"],
    ["auto-battler", "オートバトラー", "extend", "tactics", "tactics.ts の enemyPhase を味方にも適用して自動で戦う scene。編成は planner"],
    ["gacha", "ガチャ（ゲーム内）", "data", "", "random と if でゲーム内通貨からアイテム。現実のお金や課金は扱わない"],
  ]],
  ["推理・心理戦・対人", [
    ["deduction", "推理・心理戦", "built-in", "deduce", "deduce.case"],
    ["social-deduction", "人狼・正体隠匿（対NPC）", "data", "deduce", "役は intro の random で NPC ごとの変数に。会話は when で役ごとに嘘をつき、最後は deduce の question で指名"],
    ["bluffing", "ブラフ・駆け引き", "extend", "cards", "相手の手が見えないカード scene。相手の思考は seed つき乱数と性格の変数"],
    ["party", "パーティーゲーム（ミニゲーム集）", "data", "action,runner,rhythm,quiz,match3", "すごろくの各マスで別のモジュールを startScene。点数を変数に集計"],
    ["local-versus", "ローカル対戦・協力", "extend", "", "onAction で同じキーボードの別キーを2人目に割り当てる scene。オンライン対戦は対象外"],
    ["asymmetric", "非対称対戦（対NPC）", "data", "", "setPlayer で追う側／追われる側を周回ごとに入れ替え、相手は entities（chase / flee）"],
    ["battle-royale", "バトルロイヤル風", "data", "action", "action.stage（top、spawner、goal: survive）を連続させ、狭まる範囲は rows を段階ごとに変える"],
  ]],
  ["放置・その他", [
    ["idle", "放置ゲーム", "data", "", "tick ルールで資源（変数）が増え、verbs で強化を買う。HUD に変数（hud: true）"],
    ["clicker", "クリッカー", "data", "", "verbs にキー（例: c）を割り当てて変数を加算、auto ルールで段階ごとに解放"],
    ["incremental", "インクリメンタル", "data", "", "persist: meta の変数で周回強化（転生 = newCycle）"],
    ["typing", "タイピング", "built-in", "quiz", "quiz.ask の入力式（answer に正解文字列）。戦闘モードにすれば打ち込みで攻撃"],
    ["educational", "学習・クイズ", "built-in", "quiz", "quiz.ask。正解ごとの onCorrect で経験値や手がかり"],
    ["photography", "写真・観察", "data", "", "verbs（撮る）と front 条件で対象を判定、撮った物は集合（アルバムは show: true）"],
    ["delivery", "配達・お使い", "data", "runner", "schedule の制限時間、または runner.race（seconds）。届け先は entities"],
    ["time-loop", "タイムループ", "data", "", "newCycle と meta の集合で記憶を持ち越し、NPCの台詞を cycle と記憶で変える"],
    ["programming", "プログラミング（命令を組む）", "extend", "", "命令の並びを組み立てる scene を作り、実行結果を setTile や moveEntity で見せる"],
    ["factory", "工場・自動化", "extend", "planner", "簡易版は planner（生産ライン＝行動）。配置型はベルトと機械を持つ scene を作る"],
    ["first-person-dungeon", "3Dダンジョン（疑似）", "extend", "", "マップと向きから壁を描く疑似3D scene（drawOverlay か realtime scene）"],
    ["mud", "MUD・テキストRPG", "data", "novel,quiz", "移動は choice、戦闘は標準、描写は novel"],
  ]],
];

export const GENRES: Genre[] = FAMILIES.flatMap(([family, rows]) => rows.map(([id, name, level, modules, recipe]) => ({ id, name, family, level, modules: modules ? modules.split(",") : [], recipe })));

export const LEVEL_LABEL: Record<GenreLevel, string> = { "built-in": "組み込み", data: "データで組める", extend: "拡張で作る", limited: "一部のみ" };

export function searchGenres(query: string): Genre[] {
  const q = query.toLowerCase();
  return GENRES.filter(g => [g.id, g.name, g.family, g.recipe, ...g.modules].some(t => t.toLowerCase().includes(q)));
}

export const AXES: Array<[axis: string, values: string, how: string]> = [
  ["遊びの中心", "戦闘・探索・推理・創造・育成・競争", "戦闘は戦闘モード、探索はマップと regions、推理は deduce と集合、創造は verbs と setTile、育成は planner、競争は runner や rivals"],
  ["ゲームの仕組み", "ターン制・リアルタイム・ローグライク・デッキ構築", "ターン制は scene の input、リアルタイムは realtime と draw、ローグライクは newCycle と手続き生成、デッキ構築は cards"],
  ["世界・テーマ", "ファンタジー・SF・歴史・ホラー・現代", "素材（タイル・キャラ）と文章で決まる。仕組みには影響しない"],
  ["プレイ人数", "1人・協力・対戦・大人数", "基本は1人。ローカル2人は onAction で拡張。対人の駆け引きはNPC相手に（deduce・人狼レシピ）"],
  ["視点", "見下ろし・横スクロール・一人称", "見下ろしが標準。横は action view: side、一人称は疑似3Dの拡張"],
  ["進行構造", "ステージ制・オープンワールド・分岐・エンドレス", "ステージ制は scene の連続、オープンは portal と sets、分岐は endings、エンドレスは runner か spawner"],
  ["目的", "クリア・ハイスコア・生存・収集・自由創作", "クリアは goal、ハイスコアは変数と meta、生存は survive、収集は集合、自由創作は sandbox レシピ"],
];

export function genreAtlasMarkdown(): string {
  const out = [
    "# ジャンル地図 — どんなジャンルも、RPGの中に",
    "",
    "> このファイルは `packages/modules/src/genres.ts` から生成しています（`pnpm rpg genres --write`）。AIは `pnpm rpg genres --query <言葉>` で検索できます。",
    "",
    "作れるのは**RPG**です。そのうえで、他のジャンルは **場面**（startScene）・**戦い方**（battle.mode）・**世界のルール**（rules・verbs・signals）・**構造**（周回・分岐・期間）として組み込みます。",
    "ジャンルは組み合わせられます（例: 推理 × ローグライク ＝ 周回するたびに手がかりの一部だけが残る推理、歴史 × ストラテジー × デッキ構築 ＝ 合戦をカードで戦う）。",
    "",
    `| 対応 | 意味 |`, `| --- | --- |`,
    `| ${LEVEL_LABEL["built-in"]} | ジャンルモジュールがそのジャンルの遊びを持っている |`,
    `| ${LEVEL_LABEL.data} | JSONの組み合わせ（モジュール・ルール・動詞・変数）で作れる |`,
    `| ${LEVEL_LABEL.extend} | systems/*.ts に scene やフックを書く（出発点をレシピに記載） |`,
    `| ${LEVEL_LABEL.limited} | この工房の形（1人用・2D・静的配信）では一部だけ |`,
    "",
    "## 分類軸で考える",
    "",
    "| 軸 | 例 | この工房での作り方 |", "| --- | --- | --- |",
    ...AXES.map(([a, v, how]) => `| ${a} | ${v} | ${how} |`),
  ];
  let family = "";
  for (const g of GENRES) {
    if (g.family !== family) { family = g.family; out.push("", `## ${family}`, "", "| ジャンル | 対応 | モジュール | 作り方 |", "| --- | --- | --- | --- |"); }
    out.push(`| ${g.name} \`${g.id}\` | ${LEVEL_LABEL[g.level]} | ${g.modules.map(m => `\`${m}\``).join(" ") || "—"} | ${g.recipe.replace(/\|/g, "／")} |`);
  }
  const counts = Object.entries(LEVEL_LABEL).map(([k, label]) => `${label} ${GENRES.filter(g => g.level === k).length}`).join("・");
  out.push("", `全${GENRES.length}ジャンル（${counts}）。ここにないジャンルも、[idea-to-game.md](idea-to-game.md) の分解（状態・きっかけ・変化・見せ方）で作れます。作ったら genres.ts に1行足してください。`, "");
  return out.join("\n");
}

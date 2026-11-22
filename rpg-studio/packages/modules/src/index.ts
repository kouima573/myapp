/**
 * Built-in genre modules. The game is always an RPG; these are mechanics from other genres that an RPG can
 * weave in — story scenes, puzzles, shooting battles, raising/management sims, card battles, action stages,
 * tactics maps, match-3, rhythm, point & click rooms, deduction, races, quizzes…
 * Enable per project in project.json: "modules": { "novel": {}, "puzzle": {}, ... }.
 */
import type { Diagnostic, Effect, GameContent } from "../../schema/src/index";
import { forEachEffectList, walkEffects } from "../../schema/src/index";
import type { GameSystem } from "../../engine/src/index";
import novel from "./novel";
import puzzle from "./puzzle";
import shooter from "./shooter";
import planner from "./planner";
import cards from "./cards";
import action from "./action";
import tactics from "./tactics";
import match3 from "./match3";
import rhythm from "./rhythm";
import room from "./room";
import deduce from "./deduce";
import runner from "./runner";
import quiz from "./quiz";
import fighter from "./fighter";
import defense from "./defense";
import blocks from "./blocks";
import logic from "./logic";
import physics from "./physics";
import aim from "./aim";
import dungeon3d from "./dungeon3d";
import squad from "./squad";
import table from "./table";
import composer from "./composer";
import program from "./program";
import factory from "./factory";
import shop from "./shop";

export interface ModuleInfo {
  system: GameSystem;
  title: string;
  genre: string;
  description: string;
  /** How data uses it. */
  usage: string;
}

export const MODULES: Record<string, ModuleInfo> = {
  novel: { system: novel, title: "ノベル", genre: "ノベル・アドベンチャー", description: "背景・立ち絵・選択肢・ラベルジャンプ・条件付きの行・バックログを持つ物語シーン。選択や進行に応じて効果を適用する。", usage: '{ "type": "startScene", "system": "novel", "scene": "play", "args": { "script": [ { "speaker": "…", "text": "…" } ] } }' },
  puzzle: { system: puzzle, title: "パズル", genre: "パズル", description: "テキストで盤面を書くブロック押しパズル（倉庫番）。手数制限・一手戻し・やり直し。", usage: '{ "type": "startScene", "system": "puzzle", "scene": "push", "args": { "rows": ["#####", "#@$.#", "#####"], "onSolve": [ … ] } }' },
  shooter: { system: shooter, title: "シューティング", genre: "シューティング（弾幕）", description: "敵との戦闘をリアルタイムの弾幕シューティングで行う戦闘モード。RPGの能力値が自機と敵に反映される。", usage: '敵に "battle": { "mode": "shooter.battle", "args": { "phases": [ … ] } }' },
  planner: { system: planner, title: "育成・経営シミュ", genre: "育成・経営・生活シミュレーション", description: "期間を決めて毎ターン行動を選び、能力値・変数・所持品を育てる。修行、店の経営、畑仕事、学園生活などに。", usage: '{ "type": "startScene", "system": "planner", "scene": "schedule", "args": { "turns": 7, "activities": [ … ] } }' },
  cards: { system: cards, title: "カードバトル", genre: "デッキ構築カードゲーム", description: "戦闘をデッキ構築風のカードバトルで行う戦闘モード。エネルギー、山札・捨て札、ブロック、敵の行動予告。", usage: '敵に "battle": { "mode": "cards.battle", "args": { "cards": [ … ], "deck": [ … ] } }' },
  action: { system: action, title: "アクション", genre: "アクション・プラットフォーマー・アクションRPG・ハクスラ・サバイバー系", description: "横スクロール（重力・ジャンプ）か見下ろし（8方向）の実時間ステージ。足場・トゲ・コイン・ゴール・歩く/飛ぶ/追う/撃つ敵・湧き出し口・ボス。ゴールは到達・撃破・収集・生存。", usage: '{ "type": "startScene", "system": "action", "scene": "stage", "args": { "view": "side", "rows": [ "…@…G" ], "goal": "exit" } }／敵に "battle": { "mode": "action.stage" }' },
  tactics: { system: tactics, title: "タクティクス", genre: "シミュレーションRPG・ターン制ストラテジー・ボード戦", description: "マス目の陣取り戦。主人公（RPGの能力値）と仲間を動かし、敵を全滅・ボス撃破・ゴール到達・N ターン防衛。敵は近づいて弱い相手を狙う。", usage: '{ "type": "startScene", "system": "tactics", "scene": "battle", "args": { "rows": [ "#####", "#@.e#" ], "goal": "rout" } }／敵に "battle": { "mode": "tactics.battle" }' },
  match3: { system: match3, title: "マッチ3", genre: "落ちもの・マッチ3・パズルバトル", description: "石を入れ替えて3つそろえる。石ごとに攻撃・回復・守り・得点・RPG変数への加算。連鎖ボーナス。採集・パズルバトル・スコアアタックに。", usage: '{ "type": "startScene", "system": "match3", "scene": "battle", "args": { "target": 30, "moves": 15 } }／敵に "battle": { "mode": "match3.battle" }' },
  rhythm: { system: rhythm, title: "リズム", genre: "リズム・音楽", description: "4レーンの譜面（テキスト）を叩く。テンポ・判定・コンボ・正確さ。儀式・演奏・ダンス、またはリズム戦闘。音源なしでもクリック音が鳴る。", usage: '{ "type": "startScene", "system": "rhythm", "scene": "play", "args": { "bpm": 110, "chart": [ "x...", "..x." ] } }' },
  room: { system: room, title: "ポイント＆クリック", genre: "脱出ゲーム・ポイント＆クリック・探索ADV・隠し物探し", description: "背景の上に置いた場所を調べる部屋。RPGのアイテムを使う、部屋を移る、隠された物を見つける、出口を開ける。", usage: '{ "type": "startScene", "system": "room", "scene": "explore", "args": { "rooms": [ { "id": "cell", "title": "牢屋", "hotspots": [ … ] } ] } }' },
  deduce: { system: deduce, title: "推理", genre: "推理ADV・法廷・尋問・心理戦", description: "証言の矛盾に証拠をつきつけ、最後に答え（犯人・真相）を選ぶ。証拠はRPGで集めた手がかり（集合・フラグ・アイテム）から現れる。", usage: '{ "type": "startScene", "system": "deduce", "scene": "case", "args": { "evidence": [ … ], "statements": [ … ], "question": { … } } }' },
  runner: { system: runner, title: "ランナー・レース", genre: "レース・ランゲーム・逃走劇・配達", description: "レーン移動とジャンプで障害物を避け、コインとブーストを取り、ライバルより先にゴールする。コースは文字で書くか自動生成。", usage: '{ "type": "startScene", "system": "runner", "scene": "race", "args": { "length": 120, "rivals": [ { "name": "風の子", "speed": 5 } ] } }' },
  quiz: { system: quiz, title: "クイズ・なぞなぞ", genre: "クイズ・なぞなぞ・言葉遊び・タイピング・学習", description: "選択式か入力式の問題。表記ゆれ（全角半角・カタカナ/ひらがな）を吸収。合言葉の扉、試験、知恵比べ、問答バトル。", usage: '{ "type": "startScene", "system": "quiz", "scene": "ask", "args": { "questions": [ { "q": "…", "answer": ["かぜ"] } ] } }' },
  fighter: { system: fighter, title: "格闘", genre: "格闘・対戦（ローカル2人対戦）", description: "1対1の横画面格闘。移動・ジャンプ・ガード・上段/下段・コマンド技（↓→攻撃）・コンボ・削り。duel は対CPU（戦闘モードではRPGの敵）、versus は同じキーボードで2人対戦。", usage: '敵に "battle": { "mode": "fighter.duel" }／{ "type": "startScene", "system": "fighter", "scene": "versus", "args": {} }' },
  defense: { system: defense, title: "タワーディフェンス", genre: "タワーディフェンス・拠点防衛", description: "道（S→H）を進む敵の波を、ゴールドで建てた塔（弓・砲・氷…自由に定義）で防ぐ。強化、範囲攻撃、足止め。", usage: '{ "type": "startScene", "system": "defense", "scene": "siege", "args": { "rows": [ "S===.", "...=H" ] } }' },
  blocks: { system: blocks, title: "落ちもの", genre: "落ちものパズル", description: "落ちてくる小さな組を動かし回転させて積む。同じ色4つ以上で消える（連鎖）か、横一列で消える。形は自由に定義。戦闘ではおじゃま列が来る。", usage: '{ "type": "startScene", "system": "blocks", "scene": "drop", "args": { "clear": "groups", "target": 24 } }' },
  logic: { system: logic, title: "ロジックパズル", genre: "ロジック（お絵かきロジック・ライツアウト・数字の配置）", description: "絵（#と.）を書くだけで数字の手がかりが自動で付くお絵かきロジック、ライツアウト、行・列・枠で数字が重ならない配置パズル。", usage: '{ "type": "startScene", "system": "logic", "scene": "solve", "args": { "kind": "picture", "solution": [ ".#.", "###", ".#." ] } }' },
  physics: { system: physics, title: "物理ショット", genre: "物理パズル・ゴルフ・ビリヤード風・投てき・スポーツ", description: "向きと力を決めて打つ。上から（転がる・摩擦）か横から（重力・放物線）。カップに入れる・的を倒す。2人で交互に打つ対戦も。", usage: '{ "type": "startScene", "system": "physics", "scene": "shot", "args": { "view": "top", "rows": [ "#######", "#o...O#", "#######" ] } }' },
  aim: { system: aim, title: "射撃", genre: "射的・ガンシューティング・レールシューティング", description: "照準を動かして（クリックでも）現れる的を撃つ。味方は撃たない、残った敵は反撃、装填。rail で迫ってくる敵。", usage: '{ "type": "startScene", "system": "aim", "scene": "shoot", "args": { "count": 20, "rail": true } }' },
  dungeon3d: { system: dungeon3d, title: "疑似3Dダンジョン", genre: "3Dダンジョン・一人称探索・一人称戦闘（FPS風）", description: "文字の地図をそのまま一人称の迷宮として描く。マス移動（ダンジョンRPG）か自由移動（一人称アクション）。敵・宝・出口・ミニマップ。", usage: '{ "type": "startScene", "system": "dungeon3d", "scene": "explore", "args": { "rows": [ "#####", "#@.G#", "#####" ] } }' },
  squad: { system: squad, title: "部隊戦", genre: "RTS・オートバトラー・合戦", description: "味方の部隊を選んで行き先を指示する（command）か、布陣して自動で戦わせる（auto）。兵種（射程・速さ）、拠点の防衛と破壊。", usage: '{ "type": "startScene", "system": "squad", "scene": "command", "args": { "rows": [ "#########", "#@a...ee#" ] } }' },
  table: { system: table, title: "札勝負", genre: "テーブルゲーム・手役・駆け引き（はったり）", description: "5枚の手札を1度交換して役を作り、相手の表情（はったりかも）を読んで降りる・勝負・上乗せ。チップはゲーム内のみ（RPGの変数と連動可）。", usage: '{ "type": "startScene", "system": "table", "scene": "hand", "args": { "rounds": 5, "stakeVar": "gold" } }' },
  composer: { system: composer, title: "作曲", genre: "作曲・演奏・音の謎解き", description: "拍ごとに音を置いて鳴らす。お手本の旋律を再現する課題か、自由に作曲して集合に保存（後の会話や条件で使える）。", usage: '{ "type": "startScene", "system": "composer", "scene": "compose", "args": { "target": "C4 E4 G4 . G4 E4 C4 ." } }' },
  program: { system: program, title: "プログラミング", genre: "プログラミング・命令パズル", description: "進む・曲がる・跳ぶ・×2・くり返しの命令を並べて動かす。ゴールと宝石、命令数や試行回数の制限。", usage: '{ "type": "startScene", "system": "program", "scene": "run", "args": { "rows": [ "#####", "#@.G#", "#####" ] } }' },
  shop: { system: shop, title: "お店・宿屋・合成・倉庫", genre: "RPGの店・宿屋・合成・倉庫", description: "買う・売る（装備品は今の装備と比べた能力の差を表示）、お金を払って全員全回復する宿屋、材料からアイテムを作る合成（craft）、預けて後で引き出せる倉庫（storage）。値段はアイテムの price か店ごとの指定。", usage: '{ "type": "startScene", "system": "shop", "scene": "buy", "args": { "items": [ { "item": "herb", "price": 8 } ] } }／{ "type": "startScene", "system": "shop", "scene": "inn", "args": { "price": 10 } }／{ "type": "startScene", "system": "shop", "scene": "craft", "args": { "recipes": [ { "item": "potion", "needs": [ { "item": "herb", "count": 2 } ] } ] } }／{ "type": "startScene", "system": "shop", "scene": "storage", "args": {} }' },
  factory: { system: factory, title: "工場", genre: "工場・自動化・生産ライン", description: "原料が流れ込む。機械の枠にレシピを入れ、出来た物を次の機械の材料につなぎ、制限時間内に目標の品を作る。", usage: '{ "type": "startScene", "system": "factory", "scene": "line", "args": { "goal": { "item": "tool", "amount": 5 } } }' },
};

/** Systems for the modules a project enabled. */
export function modulesFor(content: GameContent): GameSystem[] {
  return Object.keys(content.project.modules).map(id => MODULES[id]?.system).filter((s): s is GameSystem => Boolean(s));
}

/** Project systems plus enabled modules (no duplicates). */
export function withModules(content: GameContent, systems: readonly GameSystem[]): GameSystem[] {
  const ids = new Set(systems.map(s => s.id));
  return [...modulesFor(content).filter(m => !ids.has(m.id)), ...systems];
}

/** Checks module ids and the arguments every startScene / battle mode passes to a module. */
export function moduleDiagnostics(content: GameContent): Diagnostic[] {
  const out: Diagnostic[] = [];
  const enabled = new Set(Object.keys(content.project.modules));
  for (const id of enabled) if (!MODULES[id]) out.push({ severity: "error", file: "project.json", at: `modules.${id}`, message: `組み込みモジュール '${id}' はありません（${Object.keys(MODULES).join(", ")}）` });
  const check = (where: string, file: string, systemId: string, scene: string, args: Record<string, unknown>) => {
    const info = MODULES[systemId];
    if (!info) return; // project system, checked by rpg test
    if (!enabled.has(systemId)) { out.push({ severity: "error", file, at: where, message: `モジュール '${systemId}' が project.json の modules で有効になっていません` }); return; }
    const def = info.system.scenes?.[scene];
    if (!def) { out.push({ severity: "error", file, at: where, message: `モジュール '${systemId}' に画面 '${scene}' はありません（${Object.keys(info.system.scenes ?? {}).join(", ")}）` }); return; }
    for (const message of def.checkArgs?.(args, { content }) ?? []) out.push({ severity: "error", file, at: `${where}.args`, message: `${systemId}.${scene}: ${message}` });
  };
  const visitEffects = (file: string, effects: Effect[]) => walkEffects(effects, e => {
    if (e.type === "startScene") check(`startScene ${e.system}.${e.scene}`, file, e.system, e.scene, e.args ?? {});
    if (e.type === "battle" && e.mode && e.mode !== "builtin") {
      const enemy = content.database.enemies.find(x => x.id === e.enemy);
      const [sys, scene] = [e.mode.slice(0, e.mode.lastIndexOf(".")), e.mode.slice(e.mode.lastIndexOf(".") + 1)];
      check(`battle ${e.mode}`, file, sys, scene, { ...enemy?.battle?.args, ...e.args, enemyId: e.enemy });
    }
  });
  forEachEffectList(content, effects => visitEffects("(データ)", effects));
  for (const enemy of content.database.enemies) {
    if (!enemy.battle || enemy.battle.mode === "builtin") continue;
    const [sys, scene] = [enemy.battle.mode.slice(0, enemy.battle.mode.lastIndexOf(".")), enemy.battle.mode.slice(enemy.battle.mode.lastIndexOf(".") + 1)];
    check(`enemies[${enemy.id}].battle`, content.project.databasePath, sys, scene, { ...enemy.battle.args, enemyId: enemy.id });
  }
  return out;
}

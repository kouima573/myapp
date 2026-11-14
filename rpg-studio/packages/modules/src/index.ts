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

/**
 * Built-in genre modules. The game is always an RPG; these are mechanics from other genres that an RPG can
 * weave in — story scenes, puzzles, shooting battles, raising/management sims, card battles…
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

/** Starting points for scripts/<id>.ts. Every hook is optional; delete what you do not need. */
export const SCRIPT_TEMPLATES: Array<{ id: string; label: string; for: string; code: string }> = [
  {
    id: "skill", label: "技（使ったときに何でも起こす）", for: "能力・アイテム",
    code: `import { battleSay, changeEnemyHp, defineScript, effectiveStats } from "@rpg/engine";

/** 能力・アイテムの "script" に付けると、「わざ」「どうぐ」から使える。ctx.self.args にデータ側の args が入る。 */
export default defineScript({
  use(ctx, args) {
    const power = Number(ctx.self?.args.power ?? 2);
    if (ctx.state.scene.kind === "battle") {
      const damage = effectiveStats(ctx.state, ctx.content).attack * power;
      return { state: battleSay(changeEnemyHp(ctx.state, -damage), \`不思議な力が\${damage}のダメージを与えた！\`) };
    }
    return { effects: [{ type: "message", text: "何も起きなかった。" }] };
  },
});
`,
  },
  {
    id: "command", label: "戦闘・メニューにコマンドを足す", for: "能力・アイテム・特性・仲間",
    code: `import { battleMemory, battleSay, defineScript, rememberInBattle } from "@rpg/engine";

/** 持っている間、戦闘（とメニュー）に新しいコマンドが出る。blocked に理由を入れると押せない。 */
export default defineScript({
  commands(ctx) {
    const used = battleMemory<boolean>(ctx, false);
    return [{ id: "doIt", label: "ひらめき", where: "battle", blocked: used ? "この戦闘ではもう使った" : undefined }];
  },
  actions: {
    doIt(ctx) {
      const state = battleSay(rememberInBattle(ctx, true), "ひらめいた！");
      return { state, effects: [{ type: "heal", amount: 5 }] };
    },
  },
});
`,
  },
  {
    id: "enemy", label: "敵の行動をコードで書く", for: "敵",
    code: `import { battleMemory, battleSay, defineScript, rememberInBattle } from "@rpg/engine";

/** 敵の "script" に付ける。enemyTurn が結果を返すと、データの行動の代わりになる。 */
export default defineScript({
  enemyTurn(ctx) {
    const turn = battleMemory<number>(ctx, 0);
    let state = rememberInBattle(ctx, turn + 1);
    if (turn % 3 === 2) {
      state = battleSay({ ...state, player: { ...state.player, hp: Math.max(0, state.player.hp - 6) } }, \`\${ctx.enemy.name}の大技！ 6のダメージ。\`);
      return { state };
    }
    return; // 何も返さなければ、いつもの行動
  },
  modifyDamage(ctx) {
    // 受けるダメージを変える（ctx.target === "enemy" が自分が受ける側）
    if (ctx.target === "enemy" && ctx.amount > 10) return 10;
  },
});
`,
  },
  {
    id: "world", label: "マップ・場所のしくみ（移動・描画・表示）", for: "マップ・エンティティ",
    code: `import { defineScript, memory, remember } from "@rpg/engine";

/** マップやエンティティの "script" に付けると、そこにいる間だけ効く。 */
export default defineScript({
  onAction(ctx, action) {
    // 操作そのものを変える例: 左右が逆になる
    if (action.type === "move" && (action.direction === "left" || action.direction === "right")) {
      return { action: { ...action, direction: action.direction === "left" ? "right" : "left" } };
    }
  },
  onStep(ctx) {
    const steps = memory<number>(ctx, 0) + 1;
    return { state: remember(ctx, steps) };
  },
  hud(ctx) {
    return [\`この場所で歩いた: \${memory<number>(ctx, 0)}歩\`];
  },
  drawOverlay(g, ctx) {
    g.fillStyle = "rgba(40, 0, 80, 0.18)";
    g.fillRect(0, 0, ctx.width, ctx.height);
  },
});
`,
  },
  {
    id: "blank", label: "空（全部のフックの一覧つき）", for: "なんでも",
    code: `import { defineScript } from "@rpg/engine";

/**
 * 使えるフック（必要なものだけ書く。docs/scripting.md）:
 * use / commands + actions / enemyTurn / companionTurn / modifyDamage / onLethalDamage / onBattleStart /
 * onTurnEnd / onBattleEnd / onAction / onStep / onTick / onMapEnter / canPass / hud / drawOverlay /
 * conditions / functions / scenes（独自画面・ミニゲーム）
 * ctx.state（今の状態）・ctx.content（全データ）・ctx.self（付け先と args）
 */
export default defineScript({
});
`,
  },
];

export function scriptAgentPrompt(id: string, idea: string, attachedTo: string[], projectDir: string): string {
  return `${idea.trim() || "（ここに、この技・仕組みで起きてほしいことを書く）"}

上の内容を ${projectDir}/scripts/${id}.ts のスクリプトとして実装して。
- 付け先: ${attachedTo.length ? attachedTo.join("、") : "（まだない。必要なら database.json などの script 欄に付ける）"}
- まず docs/scripting.md（スクリプトの全フックと補助関数）と AGENTS.md を読む。
- defineScript({...}) を default export。状態は書き換えず、新しい state / effects を返す（純粋・決定的に。乱数は roll(state)）。
- データ（効果・条件・ルール）で書ける部分はデータで、書けない部分だけコードで。
- 動作を確かめる tests/*.scenario.json を追加する（スクリプトのコマンドは { "command": "id" }）。
- 最後に次がすべて OK になるまで直す:
  pnpm rpg validate --project ${projectDir}
  pnpm rpg test --project ${projectDir}
  pnpm rpg build --project ${projectDir}`;
}

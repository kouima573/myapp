import { battleMemory, battleSay, defineScript, rememberInBattle } from "@rpg/engine";

/**
 * 能力「時の砂」に付けたスクリプト。戦闘コマンド「時を止める」を足し、2ターンの間 敵を動けなくする。
 * データの効果や条件では書けない「敵の手番そのものを奪う」処理の見本。
 */
interface Memo { left: number; used: boolean }

export default defineScript({
  // 敵自身のスクリプト（enemyTurn）より先に効かせる。小さいほど先。
  priority: -10,
  commands(ctx) {
    const memo = battleMemory<Memo>(ctx, { left: 0, used: false });
    const turns = Number(ctx.self?.args.turns ?? 2);
    const cost = Number(ctx.self?.args.cost ?? 3);
    return [{
      id: "stop", label: "時を止める", where: "battle", args: { turns, cost },
      blocked: memo.used ? "この戦闘ではもう使った" : (ctx.state.vars.spirit ?? 0) < cost ? `気力が${cost}必要` : undefined,
    }];
  },
  actions: {
    stop(ctx, args) {
      const turns = Number(args.turns), cost = Number(args.cost);
      let state = rememberInBattle(ctx, { left: turns, used: true } satisfies Memo);
      state = battleSay(state, `砂時計を返した。世界が止まる……（${turns}ターン）`);
      return { state, effects: [{ type: "setVar", var: "spirit", value: cost, op: "sub" }] };
    },
  },
  enemyTurn(ctx) {
    const memo = battleMemory<Memo>(ctx, { left: 0, used: false });
    if (memo.left <= 0) return; // いつも通りに動かせる
    return { state: battleSay(ctx.state, `${ctx.enemy.name}は止まった時の中で動けない。`) };
  },
  onTurnEnd(ctx) {
    const memo = battleMemory<Memo>(ctx, { left: 0, used: false });
    if (memo.left <= 0) return;
    let state = rememberInBattle(ctx, { ...memo, left: memo.left - 1 });
    if (memo.left - 1 === 0) state = battleSay(state, "時が再び流れ出した。");
    return { state };
  },
});

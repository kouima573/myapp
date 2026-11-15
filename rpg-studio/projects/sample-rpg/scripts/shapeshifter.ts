import { battleMemory, battleSay, defineScript, rememberInBattle, type SystemContext } from "@rpg/engine";

/**
 * 敵「ゆらぎ」: 毎ターン姿を変える。石の姿の間は受けるダメージが半分、炎の姿では強く攻撃、霧の姿では回復する。
 * 敵の行動を丸ごとコードで書く（enemyTurn）見本。args.forms で姿の順番を変えられる。
 */
const formOf = (ctx: SystemContext) => {
  const order = (ctx.self?.args.forms as string[] | undefined) ?? ["stone", "fire", "mist"];
  return order[battleMemory<number>(ctx, 0) % order.length] ?? "stone";
};

export default defineScript({
  modifyDamage(ctx) {
    if (ctx.target === "enemy" && formOf(ctx) === "stone") return Math.ceil(ctx.amount / 2);
  },
  enemyTurn(ctx) {
    const form = formOf(ctx);
    let state = ctx.state;
    if (form === "fire") {
      const damage = Math.max(1, ctx.enemy.stats.attack + 3 - ctx.state.player.stats.defense);
      state = battleSay({ ...state, player: { ...state.player, hp: Math.max(0, state.player.hp - damage) } }, `ゆらぎは炎になって燃え上がった！ ${damage}のダメージ。`);
    } else if (form === "mist") {
      const battle = ctx.battle;
      const healed = Math.min(ctx.enemy.stats.maxHp, battle.enemyHp + 4);
      state = battleSay({ ...state, scene: { kind: "battle", battle: { ...battle, enemyHp: healed } } }, "ゆらぎは霧になって傷をふさいだ。");
    } else {
      state = battleSay(state, "ゆらぎは石のように固まっている。");
    }
    const next = { ...ctx, state };
    state = rememberInBattle(next, battleMemory<number>(ctx, 0) + 1);
    return { state };
  },
});

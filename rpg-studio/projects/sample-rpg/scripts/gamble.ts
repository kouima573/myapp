import { battleSay, changeEnemyHp, defineScript, effectiveStats, roll } from "@rpg/engine";

/** 能力「賭け札」: 表なら攻撃力の3倍を与え、裏なら自分のHPが半分になる。戦闘の技として使える（データの use なしでも使える）。 */
export default defineScript({
  use(ctx) {
    if (ctx.state.scene.kind !== "battle") return { effects: [{ type: "message", text: "賭ける相手がいない。" }] };
    const [value, rolled] = roll(ctx.state);
    let state = rolled;
    if (value < 0.5) {
      const damage = effectiveStats(state, ctx.content).attack * 3;
      state = battleSay(changeEnemyHp(state, -damage), `表！ 札が光の刃になった。${damage}のダメージ！`);
    } else {
      const hp = Math.max(1, Math.floor(state.player.hp / 2));
      state = battleSay({ ...state, player: { ...state.player, hp } }, "裏……。札が燃え上がり、HPが半分になった。");
    }
    return { state };
  },
});

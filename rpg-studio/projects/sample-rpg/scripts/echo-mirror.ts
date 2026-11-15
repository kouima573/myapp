import { battleMemory, battleSay, changeEnemyHp, defineScript, rememberInBattle } from "@rpg/engine";

/**
 * 装飾品「こだまの鏡」: 装備している間、受けたダメージを1減らし、その回に受けたダメージをターンの終わりに敵へ返す。
 * modifyDamage（数値だけ返すフック）と onTurnEnd を戦闘メモリでつなぐ見本。
 */
export default defineScript({
  modifyDamage(ctx) {
    if (ctx.target !== "player") return;
    return Math.max(0, ctx.amount - 1);
  },
  onTurnEnd(ctx) {
    const before = battleMemory<number>(ctx, ctx.content.project.player.stats.maxHp);
    const lost = Math.max(0, before - ctx.state.player.hp);
    let state = rememberInBattle(ctx, ctx.state.player.hp);
    if (lost > 0 && ctx.battle.enemyHp > 0) state = battleSay(changeEnemyHp(state, -lost), `こだまの鏡が${lost}のダメージを跳ね返した！`);
    return { state };
  },
  onBattleStart(ctx) {
    return ctx.state.player.hp;
  },
});

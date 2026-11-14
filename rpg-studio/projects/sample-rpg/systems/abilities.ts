import { defineSystem } from "@rpg/engine";

/** Per-battle scratch data kept in battle.systemData["sample-abilities"]. */
interface BattleData {
  unyieldingUsed: boolean;
}

/**
 * Trusted project code. Abilities that the data format cannot express are implemented here as hooks.
 *
 * - 不屈の魂 (unyielding-soul): damage pipeline step ③. Once per battle, lethal damage leaves the player at 1 HP.
 *   A second lethal hit in the same battle is not saved because `unyieldingUsed` is per battle.
 * - 獣道 (beast-trail) needs no code: tiles.json makes the gap passable once `ruinsShortcutOpen` is set,
 *   and events.json only sets that flag when the player has the ability.
 */
export default defineSystem({
  id: "sample-abilities",
  onBattleStart: (): BattleData => ({ unyieldingUsed: false }),
  onLethalDamage(ctx) {
    if (!ctx.state.abilities.includes("unyielding-soul")) return;
    const data = ctx.battleData as BattleData | undefined;
    if (data?.unyieldingUsed) return;
    return {
      hp: 1,
      message: "不屈の魂！ 致命傷をHP1でこらえた。",
      battleData: { unyieldingUsed: true } satisfies BattleData,
    };
  },
});

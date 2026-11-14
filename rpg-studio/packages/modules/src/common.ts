/**
 * Shared plumbing for genre modules that work both as a field scene (startScene → onWin / onLose effects)
 * and as an RPG battle mode (enemy "battle": { "mode": "<module>.<scene>" } → victory / defeat / fled).
 */
import { z } from "zod";
import { EffectSchema } from "../../schema/src/formats";
import type { Enemy, GameState } from "../../schema/src/index";
import { effectiveStats, type SceneResult, type SystemContext } from "../../engine/src/index";

/** Arguments every dual-use module accepts. */
export const OutcomeArgs = {
  /** Field scene: effects after winning / losing (quitting counts as losing). */
  onWin: z.array(EffectSchema).default([]),
  onLose: z.array(EffectSchema).default([]),
  /** Battle mode: filled in by the engine. */
  enemyId: z.string().optional(),
  canFlee: z.boolean().default(true),
};

export type Outcome = "win" | "lose" | "quit";

export function inBattle(ctx: SystemContext): boolean {
  return Boolean((ctx.state.scene as { battle?: unknown }).battle);
}

export function enemyOf(ctx: SystemContext, enemyId: string | undefined): Enemy | undefined {
  return enemyId ? ctx.content.database.enemies.find(e => e.id === enemyId) : undefined;
}

/** HP the player brings into the minigame, and the hero's stats (traits and items included). */
export function heroOf(ctx: SystemContext) {
  const stats = effectiveStats(ctx.state, ctx.content);
  return { hp: ctx.state.player.hp, maxHp: stats.maxHp, attack: stats.attack, defense: stats.defense, name: ctx.state.player.name ?? ctx.content.project.player.name };
}

function withHp(state: GameState, hp: number | undefined): GameState {
  return hp === undefined ? state : { ...state, player: { ...state.player, hp: Math.max(1, Math.round(hp)) } };
}

/**
 * Ends the minigame. In a battle: victory / defeat / fled with the RPG result screen.
 * On the field: closes, shows `line`, then runs onWin / onLose. `hp` (if given) is written back to the hero.
 */
export function finish(ctx: SystemContext, args: { onWin: SceneResultEffects; onLose: SceneResultEffects }, outcome: Outcome, line: string, hp?: number): SceneResult {
  if (inBattle(ctx)) {
    if (outcome === "win") return { outcome: "victory", state: withHp(ctx.state, hp), battleLog: [line] };
    if (outcome === "quit") return { outcome: "fled", state: withHp(ctx.state, hp), battleLog: [line] };
    return { outcome: "defeat", battleLog: [line] };
  }
  const effects = outcome === "win" ? args.onWin : args.onLose;
  return { close: true, state: outcome === "lose" ? ctx.state : withHp(ctx.state, hp), log: [line], effects: [{ type: "message", text: line }, ...effects] };
}
type SceneResultEffects = z.infer<typeof OutcomeArgs.onWin>;

/** zod issues → readable messages for checkArgs. */
export function issues(result: z.ZodSafeParseResult<unknown>): string[] {
  return result.success ? [] : result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
}

/** Rising edges: buttons held now that were not held in the previous frame. */
export function pressed(held: string[], before: string[]): string[] {
  return held.filter(b => !before.includes(b));
}

/** Image cache for draw() (browser only). */
const images = new Map<string, HTMLImageElement>();
export function image(url: string | undefined): HTMLImageElement | undefined {
  if (!url) return undefined;
  let img = images.get(url);
  if (!img) { img = new Image(); img.src = url; images.set(url, img); }
  return img.complete && img.naturalWidth ? img : undefined;
}

/** Draws the hero's walking sprite (row 0 = down … 3 = up) or a simple marker. */
export function drawHero(g: CanvasRenderingContext2D, view: { state: GameState; content: SystemContext["content"]; assetUrl(id: string): string | undefined }, x: number, y: number, size: number, row: number, frame: number): void {
  const heroId = view.state.player.sprite ?? view.content.project.player.sprite;
  const asset = heroId ? view.content.assets.assets.find(a => a.id === heroId) : undefined;
  const img = image(heroId ? view.assetUrl(heroId) : undefined);
  if (img && asset) {
    const cols = asset.columns ?? 1, rows = asset.rows ?? 1;
    const cw = img.naturalWidth / cols, ch = img.naturalHeight / rows;
    g.drawImage(img, (frame % cols) * cw, Math.min(rows - 1, row) * ch, cw, ch, x - size / 2, y - size / 2, size, size);
  } else { g.fillStyle = "#7fc4ff"; g.fillRect(x - size / 3, y - size / 2, (size * 2) / 3, size); }
}

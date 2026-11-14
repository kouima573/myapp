import { defineSystem } from "@rpg/engine";

/**
 * A drawing layer made by a project: darkness with a pool of light around the player in the ruins.
 * Pure presentation (drawOverlay) plus a HUD line; the light grows once the wind returns.
 */
const radiusTiles = (calmed: boolean) => (calmed ? 7 : 4);

export default defineSystem({
  id: "lantern",
  drawOverlay(g, ctx) {
    if (ctx.state.mapId !== "ruins") return;
    const r = radiusTiles(Boolean(ctx.state.flags.sentinelCalmed)) * ctx.tileSize;
    const cx = ctx.originX + (ctx.player.x + 0.5) * ctx.tileSize;
    const cy = ctx.originY + (ctx.player.y + 0.5) * ctx.tileSize;
    const flicker = 1 + Math.sin(ctx.time / 140) * 0.025 + Math.sin(ctx.time / 53) * 0.015;
    const gradient = g.createRadialGradient(cx, cy, r * 0.35 * flicker, cx, cy, r * flicker);
    gradient.addColorStop(0, "rgba(8,6,4,0)");
    gradient.addColorStop(0.7, "rgba(8,6,4,0.55)");
    gradient.addColorStop(1, "rgba(8,6,4,0.86)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, ctx.width, ctx.height);
    g.fillStyle = "rgba(255,170,80,0.05)";
    g.beginPath(); g.arc(cx, cy, r * 0.5, 0, Math.PI * 2); g.fill();
  },
  hud({ state }) {
    return state.mapId === "ruins" ? [state.flags.sentinelCalmed ? "風が通り、少し明るい" : "暗い……灯りの届く範囲しか見えない"] : [];
  },
});

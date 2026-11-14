import { defineSystem } from "@rpg/engine";

/**
 * Shared mod: weather. The project declares a variable "weather" (0 clear, 1 rain, 2 snow, 3 fog);
 * set it from any effect ({ "type": "setVar", "var": "weather", "value": 1 }) and the field shows it.
 * Data can also ask { "custom": "weather.is", "args": { "kind": "rain" } } (e.g. puddles, NPC lines, encounters).
 */
const KINDS = ["clear", "rain", "snow", "fog"] as const;
const kindOf = (vars: Record<string, number>) => KINDS[vars.weather ?? 0] ?? "clear";

export default defineSystem({
  id: "weather",
  conditions: {
    is: (ctx, args) => kindOf(ctx.state.vars) === args.kind,
  },
  hud: ctx => {
    const kind = kindOf(ctx.state.vars);
    return kind === "clear" ? [] : [{ rain: "雨", snow: "雪", fog: "霧" }[kind]];
  },
  drawOverlay(g, ctx) {
    const kind = kindOf(ctx.state.vars);
    if (kind === "clear") return;
    const t = ctx.time / 1000;
    if (kind === "fog") {
      const grad = g.createLinearGradient(0, 0, ctx.width, ctx.height);
      grad.addColorStop(0, "rgba(220,225,230,.38)"); grad.addColorStop(0.5, "rgba(220,225,230,.22)"); grad.addColorStop(1, "rgba(220,225,230,.42)");
      g.fillStyle = grad; g.fillRect(0, 0, ctx.width, ctx.height);
      return;
    }
    g.fillStyle = kind === "rain" ? "rgba(40,50,70,.18)" : "rgba(255,255,255,.08)";
    g.fillRect(0, 0, ctx.width, ctx.height);
    const count = kind === "rain" ? 140 : 90;
    for (let i = 0; i < count; i++) {
      const seed = (i * 9301 + 49297) % 233280;
      const x0 = (seed / 233280) * ctx.width;
      if (kind === "rain") {
        const y = ((i * 37 + t * 620) % (ctx.height + 40)) - 20, x = (x0 - t * 120) % ctx.width;
        g.strokeStyle = "rgba(180,200,230,.55)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo((x + ctx.width) % ctx.width, y); g.lineTo(((x + ctx.width) % ctx.width) - 3, y + 11); g.stroke();
      } else {
        const y = ((i * 53 + t * 45) % (ctx.height + 20)) - 10, x = x0 + Math.sin(t + i) * 12;
        g.fillStyle = "rgba(255,255,255,.85)"; g.beginPath(); g.arc(x, y, 1.6 + (i % 3) * 0.5, 0, Math.PI * 2); g.fill();
      }
    }
  },
});

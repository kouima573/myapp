/**
 * Turns the actions of a play session into scenario-test steps (tests/*.scenario.json), so a test can be
 * "recorded" by simply playing in the studio. Consecutive moves / ticks / route steps are merged.
 */
import type { Action } from "@rpg/engine";
import type { GameContent, GameState } from "@rpg/schema";

export type Step = Record<string, unknown>;

export function actionsToSteps(actions: Action[]): { steps: Step[]; skipped: number } {
  const steps: Step[] = [];
  let skipped = 0;
  const last = () => steps[steps.length - 1];
  for (const a of actions) {
    switch (a.type) {
      case "move": {
        const prev = last();
        if (prev && prev.move === a.direction) prev.times = Number(prev.times ?? 1) + 1;
        else steps.push({ move: a.direction });
        break;
      }
      case "face": steps.push({ face: a.direction }); break;
      case "interact": steps.push({ interact: true }); break;
      case "advance": steps.push({ advance: "once" }); break;
      case "choose": steps.push({ choose: a.choiceId }); break;
      case "submitText": steps.push({ input: a.text }); break;
      case "useItem": steps.push({ useItem: a.item }); break;
      case "useAbility": steps.push({ useAbility: a.ability }); break;
      case "verb": steps.push({ verb: a.verb }); break;
      case "equip": steps.push(a.companion ? { equip: a.item, companion: a.companion } : { equip: a.item }); break;
      case "tick": { const prev = last(); if (prev && typeof prev.tick === "number") prev.tick = prev.tick + 1; else steps.push({ tick: 1 }); break; }
      case "routeStep": if (!last() || last()!.routes !== "finish") steps.push({ routes: "finish" }); break;
      case "battle":
        if (a.command === "attack") steps.push(a.target !== undefined ? { battle: "attack", target: a.target } : { battle: "attack" });
        else if (a.command === "guard" || a.command === "flee") steps.push({ battle: a.command });
        else if (a.command === "item") steps.push({ battleItem: a.item });
        else if (a.command === "skill") steps.push({ skill: a.ability });
        else if (a.command === "order") steps.push({ battleOrder: { companion: a.companion, action: a.action } });
        else if (a.command === "script") steps.push({ command: a.id, source: a.source.split("@")[0] });
        break;
      case "command": steps.push({ command: a.id, source: a.source.split("@")[0] }); break;
      case "sceneInput":
        // Realtime frames are too many to replay faithfully: they are left out (use "frames" by hand for those).
        if (a.input.type === "frame") { skipped++; break; }
        steps.push({ sceneInput: a.input.type === "custom" ? { custom: a.input.value } : a.input.type });
        break;
      default: skipped++;
    }
  }
  return { steps, skipped };
}

/** What the end of the recording looked like, as checks. */
export function finalExpect(state: GameState, content: GameContent): Step {
  const flags = Object.fromEntries(Object.entries(state.flags).filter(([id, on]) => on !== (content.project.flags[id]?.initial ?? false)));
  const vars = Object.fromEntries(Object.entries(state.vars).filter(([id, v]) => v !== (content.project.variables[id]?.initial ?? 0)));
  return {
    expect: {
      scene: state.scene.kind,
      mapId: state.mapId,
      at: { x: state.player.x, y: state.player.y },
      ...(Object.keys(flags).length ? { flags } : {}),
      ...(Object.keys(vars).length ? { vars } : {}),
      ...(Object.keys(state.items).length ? { items: state.items } : {}),
    },
  };
}

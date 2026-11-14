import { defineSystem } from "@rpg/engine";

/**
 * Example of the TypeScript escape hatch: building text from the whole state is awkward in JSON,
 * so a data effect `{ "type": "system", "system": "chronicle", "action": "summary" }` calls this.
 * Everything else in the sample (races, skills, shop, rules) is plain data.
 */
export default defineSystem({
  id: "chronicle",
  actions: {
    summary({ content, state }) {
      const db = content.database;
      const traits = state.traits.map(id => db.traits.find(t => t.id === id)?.name ?? id).join("・") || "なし";
      const learned = state.abilities.map(id => db.abilities.find(a => a.id === id)?.name ?? id);
      const done = Object.entries(content.project.flags).filter(([id]) => state.flags[id]).map(([, decl]) => decl.description ?? "").filter(Boolean);
      return {
        effects: [
          { type: "message", text: `旅の日誌 — ${content.project.player.name}（${traits}）\n歩いた距離 ${state.steps}歩 ／ 倒した魔物 ${state.vars.victories ?? 0}体 ／ 所持金 ${state.vars.gold ?? 0}G` },
          { type: "message", text: learned.length ? `後から覚えた技: ${learned.join("、")}` : "後から覚えた技はまだない。" },
          { type: "message", text: done.length ? `これまでの出来事:\n・${done.join("\n・")}` : "まだ大きな出来事はない。" },
        ],
      };
    },
  },
});

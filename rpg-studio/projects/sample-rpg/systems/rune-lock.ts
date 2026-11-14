import { defineSystem, type SceneInput } from "@rpg/engine";

/**
 * A custom screen (scene) made by a project: a three-dial rune lock.
 * `start` and `input` are pure (they run in `rpg test`), `render` draws the DOM in the browser.
 * Data opens it with: { "type": "startScene", "system": "rune-lock", "scene": "dial", "args": { "code": ["風","星","岩"], "onSolve": [...] } }
 */
const SYMBOLS = ["風", "岩", "獣", "星"];

interface DialData {
  code: number[];
  dials: number[];
  cursor: number;
  tries: number;
  message: string;
  hint: string;
  onSolve: unknown[];
}

export default defineSystem({
  id: "rune-lock",
  scenes: {
    dial: {
      start(ctx, args): DialData {
        const code = (Array.isArray(args.code) ? args.code : []).map(s => Math.max(0, SYMBOLS.indexOf(String(s))));
        const remembered = (ctx.state.sets.memories ?? []).includes("rune-code");
        return {
          code, dials: code.map(() => 0), cursor: 0, tries: 0, message: "",
          hint: remembered ? `（覚えている……「${code.map(i => SYMBOLS[i]).join(" → ")}」だ）` : "",
          onSolve: Array.isArray(args.onSolve) ? args.onSolve : [],
        };
      },
      input(_ctx, raw, input: SceneInput) {
        const data = raw as DialData;
        const dials = [...data.dials];
        switch (input.type) {
          case "left": return { data: { ...data, cursor: (data.cursor + dials.length - 1) % dials.length } };
          case "right": return { data: { ...data, cursor: (data.cursor + 1) % dials.length } };
          case "up": dials[data.cursor] = (dials[data.cursor]! + 1) % SYMBOLS.length; return { data: { ...data, dials, message: "" } };
          case "down": dials[data.cursor] = (dials[data.cursor]! + SYMBOLS.length - 1) % SYMBOLS.length; return { data: { ...data, dials, message: "" } };
          case "cancel": return { close: true, effects: [{ type: "message", text: "錠前から手を離した。" }] };
          case "confirm": {
            if (dials.every((d, i) => d === data.code[i])) {
              return { close: true, log: ["暗号錠が開いた"], effects: [{ type: "addToSet", set: "memories", value: "rune-code" }, ...(data.onSolve as never[])] };
            }
            return { data: { ...data, tries: data.tries + 1, message: "……何も起きない。印の並びが違うようだ。" } };
          }
          default: return {};
        }
      },
      render(host, view) {
        const data = view.data as DialData;
        host.innerHTML = "";
        const panel = document.createElement("div");
        panel.className = "rpg-window";
        panel.style.cssText = "position:absolute;left:18%;right:18%;top:16%;padding:1.2em;display:flex;flex-direction:column;align-items:center;gap:.8em;text-align:center";
        const title = document.createElement("div");
        title.textContent = "封印の暗号錠 — 三つの印を正しい順に";
        title.style.color = "var(--rpg-accent)";
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:1.2em";
        data.dials.forEach((value, i) => {
          const dial = document.createElement("button");
          dial.type = "button";
          dial.textContent = SYMBOLS[value]!;
          dial.style.cssText = `all:unset;cursor:pointer;width:2.6em;height:2.6em;display:grid;place-items:center;font-size:1.6em;border-radius:.3em;border:2px solid ${i === data.cursor ? "var(--rpg-accent)" : "rgba(233,220,184,.4)"};background:rgba(0,0,0,.35)`;
          dial.onclick = () => { if (i === data.cursor) view.send({ type: "up" }); else for (let k = 0; k < (i - data.cursor + data.dials.length) % data.dials.length; k++) view.send({ type: "right" }); };
          row.appendChild(dial);
        });
        const help = document.createElement("div");
        help.style.cssText = "font-size:.75em;color:var(--rpg-dim)";
        help.textContent = "←→ 印を選ぶ　↑↓ 回す　決定 試す　キャンセル やめる";
        const message = document.createElement("div");
        message.textContent = data.message || data.hint;
        message.style.minHeight = "1.4em";
        const buttons = document.createElement("div");
        buttons.style.cssText = "display:flex;gap:.6em";
        for (const [label, input] of [["試す", "confirm"], ["やめる", "cancel"]] as const) {
          const b = document.createElement("button");
          b.type = "button"; b.className = "rpg-option"; b.textContent = label;
          b.onclick = () => view.send({ type: input });
          buttons.appendChild(b);
        }
        panel.append(title, row, help, message, buttons);
        host.appendChild(panel);
      },
    },
  },
});

import { defineExperience, type ExperienceInput } from "@rpg/engine";

type Stamp = "gravity" | "echo" | "tide";
type LetterId = "a" | "b" | "c";
type RecipientId = "lantern" | "clockmaker" | "moon-shell";
type Letter = { id: LetterId; title: string; sender: string; day: string; memory: string; intended: RecipientId };
type Delivery = { recipient: RecipientId; stamp: Stamp; misdelivered: boolean };
type State = {
  selectedLetter: LetterId | null;
  recipient: RecipientId | null;
  stamp: Stamp | null;
  deliveries: Partial<Record<LetterId, Delivery>>;
  lostDays: string[];
  receivedMemories: string[];
  gravity: "down" | "sideways";
  waterline: number;
  echoes: number;
  eighthDay: boolean;
  notice: string;
};

const LETTERS: Letter[] = [
  { id: "a", title: "塔の上で海を見た日", sender: "ネリ", day: "火曜日", memory: "まだ海を知らなかったネリが、初めて海を見た一日。", intended: "lantern" },
  { id: "b", title: "名を呼ばれた日", sender: "鐘の魚", day: "土曜日", memory: "誰かが魚に名前を贈り、鐘が一度だけ鳴った一日。", intended: "clockmaker" },
  { id: "c", title: "木曜日が消えた朝", sender: "潮見", day: "木曜日", memory: "目覚めると、暦から木曜日だけが抜け落ちていた一日。", intended: "moon-shell" },
];

const RECIPIENTS: Array<{ id: RecipientId; name: string; detail: string }> = [
  { id: "lantern", name: "灯守", detail: "暗い場所に、まだ見ぬ色を灯す。" },
  { id: "clockmaker", name: "時計師", detail: "失われた時間を、歯車にしまう。" },
  { id: "moon-shell", name: "月貝の子", detail: "聞いた記憶で、殻の内側に海を描く。" },
];

const STAMPS: Array<{ id: Stamp; name: string; mark: string; result: string }> = [
  { id: "gravity", name: "垂直の切手", mark: "↑", result: "重力が横を向き、壁の手紙棚へ続く道が開いた。" },
  { id: "echo", name: "反響の切手", mark: "◌", result: "最後に届いた記憶が、もう一度だけ郵便局に響いた。" },
  { id: "tide", name: "潮の切手", mark: "≈", result: "浅い潮が満ち、海底の記録庫へ続く扉が浮かび上がった。" },
];

function initialState(): State {
  return {
    selectedLetter: null, recipient: null, stamp: null, deliveries: {}, lostDays: [], receivedMemories: [],
    gravity: "down", waterline: 0, echoes: 0, eighthDay: false, notice: "投函口に、まだ配達されていない曜日の封筒が届いている。",
  };
}

function update(state: State, input: ExperienceInput): State {
  if (input.type === "key" && input.key === "cancel") return { ...state, selectedLetter: null, recipient: null, stamp: null, notice: "封筒を机に戻した。" };
  if (input.type !== "custom" || !input.value || typeof input.value !== "object") return state;
  const action = input.value as Record<string, unknown>;
  if (action.kind === "letter" && typeof action.id === "string" && ["a", "b", "c"].includes(action.id) && !state.deliveries[action.id as LetterId]) {
    return { ...state, selectedLetter: action.id as LetterId, recipient: null, stamp: null, notice: "この一日を、誰に届けますか？" };
  }
  if (action.kind === "recipient" && ["lantern", "clockmaker", "moon-shell"].includes(String(action.id))) return { ...state, recipient: action.id as RecipientId };
  if (action.kind === "stamp" && ["gravity", "echo", "tide"].includes(String(action.id))) return { ...state, stamp: action.id as Stamp };
  if (action.kind === "back") return { ...state, selectedLetter: null, recipient: null, stamp: null, notice: "封筒を選び直せる。" };
  if (action.kind !== "deliver" || !state.selectedLetter || !state.recipient || !state.stamp) return state;

  const letter = LETTERS.find(candidate => candidate.id === state.selectedLetter)!;
  const misdelivered = state.recipient !== letter.intended;
  const delivery: Delivery = { recipient: state.recipient, stamp: state.stamp, misdelivered };
  const next: State = {
    ...state,
    selectedLetter: null,
    recipient: null,
    stamp: null,
    deliveries: { ...state.deliveries, [letter.id]: delivery },
    lostDays: [...state.lostDays, letter.day],
    receivedMemories: [...state.receivedMemories, `${RECIPIENTS.find(r => r.id === delivery.recipient)!.name}${misdelivered ? "（誤配）" : ""}：${letter.memory}`],
    notice: `${letter.sender}から「${letter.day}」が消えた。${misdelivered ? "誤配された記憶が、受取人の世界を塗り替える。" : "封筒は宛先へ届いた。"} ${STAMPS.find(stamp => stamp.id === delivery.stamp)!.result}`,
  };
  if (delivery.stamp === "gravity") next.gravity = "sideways";
  if (delivery.stamp === "echo") next.echoes += 1;
  if (delivery.stamp === "tide") next.waterline = Math.min(3, next.waterline + 1);
  if (letter.id === "c" && delivery.stamp === "tide") next.eighthDay = true;
  return next;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, active: boolean, action: () => void, detail?: string): HTMLButtonElement {
  const node = el("button");
  node.type = "button";
  node.setAttribute("aria-pressed", String(active));
  node.style.cssText = `text-align:left;border:1px solid ${active ? "#f0c98a" : "#44535a"};border-radius:14px;padding:14px 16px;background:${active ? "#294a50" : "#15242a"};color:#f5f0df;cursor:pointer;font:inherit;transition:transform .15s,border-color .15s;`;
  node.onmouseenter = () => { node.style.transform = "translateY(-2px)"; };
  node.onmouseleave = () => { node.style.transform = "none"; };
  const title = el("strong", label); title.style.display = "block";
  node.append(title);
  if (detail) { const sub = el("span", detail); sub.style.cssText = "display:block;margin-top:5px;font-size:13px;line-height:1.5;color:#b6c5bd"; node.append(sub); }
  node.onclick = action;
  return node;
}

function heading(text: string): HTMLHeadingElement {
  const node = el("h2", text);
  node.style.cssText = "margin:0 0 10px;font:600 15px/1.4 system-ui,sans-serif;letter-spacing:.08em;color:#9bc4b5";
  return node;
}

export default defineExperience<State>({
  id: "deep-sea-post-office",
  version: 1,
  title: "昨日を配送する深海郵便局",
  start: () => initialState(),
  update,
  render(host, view) {
    const state = view.state;
    const shell = el("main");
    shell.style.cssText = "box-sizing:border-box;min-height:100dvh;padding:clamp(18px,4vw,52px);background:radial-gradient(ellipse at 70% 0%,#1e4650 0%,#10262d 45%,#0b171d 100%);color:#f5f0df;font:16px/1.6 system-ui,sans-serif;";
    const content = el("div");
    content.style.cssText = "width:min(100%,1000px);margin:0 auto;";
    const eyebrow = el("p", "ABYSSAL POST · 零時の海底局");
    eyebrow.style.cssText = "margin:0 0 8px;color:#e6b96e;font-size:12px;letter-spacing:.22em";
    const title = el("h1", "昨日を配送する\n深海郵便局");
    title.style.cssText = "white-space:pre-line;margin:0;font:500 clamp(34px,7vw,66px)/1.08 Georgia,serif;letter-spacing:.015em";
    const intro = el("p", "封筒には、送り主の一日が丸ごと入っている。届ければ、その日は送り主から消える。");
    intro.style.cssText = "max-width:660px;margin:18px 0 28px;color:#cad4c9;font-size:clamp(15px,2vw,18px)";
    const ruleBar = el("section");
    ruleBar.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:10px;margin:0 0 18px";
    const ruleCard = (label: string, value: string) => {
      const card = el("div"); card.style.cssText = "padding:12px 14px;border:1px solid #31474b;border-radius:12px;background:#102026cc";
      const small = el("span", label); small.style.cssText = "display:block;color:#91a99f;font-size:11px;letter-spacing:.12em";
      const strong = el("strong", value); strong.style.cssText = "display:block;margin-top:4px;color:#f0c98a;font-size:16px";
      card.append(small, strong); return card;
    };
    ruleBar.append(ruleCard("重力", state.gravity === "down" ? "下へ" : "壁へ流れる"), ruleCard("水位", `郵便局 ${state.waterline}/3`), ruleCard("反響", `${state.echoes}回`), ruleCard("暦", state.eighthDay ? "八つ目の曜日" : "木曜日を捜索中"));

    const board = el("div");
    board.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:14px;align-items:start";
    const inbox = el("section"); inbox.style.cssText = "padding:18px;border:1px solid #31474b;border-radius:16px;background:#0e1c22dd";
    inbox.append(heading("漂着した封筒"));
    const letterList = el("div"); letterList.style.cssText = "display:grid;gap:9px";
    for (const letter of LETTERS) {
      if (state.deliveries[letter.id]) continue;
      letterList.append(button(`${letter.sender} · ${letter.title}`, state.selectedLetter === letter.id, () => view.send({ type: "custom", value: { kind: "letter", id: letter.id } }), `${letter.day}を届けると、${letter.sender}からこの一日が消える。`));
    }
    if (!letterList.childElementCount) letterList.append(el("p", "今日の封筒はすべて旅立った。まだ、海は何かを隠している。"));
    inbox.append(letterList);
    const memory = state.selectedLetter ? LETTERS.find(letter => letter.id === state.selectedLetter) : undefined;
    if (memory) {
      const note = el("blockquote", `「${memory.memory}」`); note.style.cssText = "margin:15px 0 0;padding:12px 14px;border-left:2px solid #e6b96e;background:#15272c;color:#e3dcc8"; inbox.append(note);
    }

    const controls = el("section"); controls.style.cssText = "padding:18px;border:1px solid #31474b;border-radius:16px;background:#0e1c22dd";
    controls.append(heading("記憶の行き先と、世界に押す切手"));
    const recipientList = el("div"); recipientList.style.cssText = "display:grid;gap:8px;margin-bottom:15px";
    for (const recipient of RECIPIENTS) recipientList.append(button(recipient.name, state.recipient === recipient.id, () => view.send({ type: "custom", value: { kind: "recipient", id: recipient.id } }), recipient.detail));
    controls.append(recipientList);
    const stampList = el("div"); stampList.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:14px";
    for (const stamp of STAMPS) stampList.append(button(`${stamp.mark} ${stamp.name}`, state.stamp === stamp.id, () => view.send({ type: "custom", value: { kind: "stamp", id: stamp.id } }), stamp.result));
    controls.append(stampList);
    const ready = Boolean(memory && state.recipient && state.stamp);
    const deliver = el("button", ready ? "この記憶を配達する" : "封筒・宛先・切手を選ぶ");
    deliver.type = "button"; deliver.disabled = !ready;
    deliver.style.cssText = `width:100%;border:0;border-radius:12px;padding:14px;background:${ready ? "#e6b96e" : "#39474a"};color:${ready ? "#102026" : "#aab7af"};font:700 15px system-ui;cursor:${ready ? "pointer" : "not-allowed"}`;
    deliver.onclick = () => view.send({ type: "custom", value: { kind: "deliver" } });
    controls.append(deliver);
    if (memory) { const back = button("封筒を戻す", false, () => view.send({ type: "custom", value: { kind: "back" } })); back.style.marginTop = "8px"; controls.append(back); }
    board.append(inbox, controls);

    const footer = el("section"); footer.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px;margin-top:14px";
    const status = el("div"); status.setAttribute("aria-live", "polite"); status.style.cssText = "padding:16px 18px;border:1px solid #56655c;border-radius:14px;background:#192820;color:#e8d8b0";
    status.append(heading("郵便局の変化"), el("p", state.notice));
    const rule = state.stamp ? STAMPS.find(stamp => stamp.id === state.stamp) : undefined;
    if (rule) status.append(el("p", rule.result));
    const ledger = el("div"); ledger.style.cssText = "padding:16px 18px;border:1px solid #31474b;border-radius:14px;background:#102026";
    ledger.append(heading("送り主から消えた日"));
    ledger.append(el("p", state.lostDays.length ? state.lostDays.join(" · ") : "まだ誰の一日も消えていない。"));
    if (state.receivedMemories.length) {
      const list = el("ul"); list.style.cssText = "margin:8px 0 0;padding-left:20px;color:#c6d1c8";
      for (const entry of state.receivedMemories) list.append(el("li", entry));
      ledger.append(list);
    }
    footer.append(status, ledger);
    const ending = state.eighthDay ? el("p", "木曜日が戻る代わりに、暦の外側へ八つ目の曜日が生まれた。") : null;
    if (ending) { ending.style.cssText = "margin:14px 0 0;padding:16px;border-radius:14px;background:#284d50;color:#f3dba8;font:20px Georgia,serif"; }
    content.append(eyebrow, title, intro, ruleBar, board, footer);
    if (ending) content.append(ending);
    shell.append(content);
    host.append(shell);
  },
});

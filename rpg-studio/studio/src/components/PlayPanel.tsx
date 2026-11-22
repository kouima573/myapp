import { withModules } from "../../../packages/modules/src/index";
import { useEffect, useRef, useState } from "react";
import { RotateCcw, AlertTriangle, Bug, Circle, Square } from "lucide-react";
import type { GameContent, GameState } from "@rpg/schema";
import type { GameSystem } from "@rpg/engine";
import { mountGame, type GameHandle } from "../../../packages/runtime/src/player";
import type { ProjectSource } from "../lib/source";
import { actionsToSteps, finalExpect } from "../lib/recorder";
import type { Action } from "@rpg/engine";
import type { ProjectStore } from "../lib/useProject";

interface Props {
  store: ProjectStore;
  content: GameContent;
  /** True when the current files do not validate and we are showing the last good version. */
  stale: boolean;
  systems: GameSystem[];
  systemsVersion: string | null;
  source: ProjectSource;
  startAt: { mapId: string; x: number; y: number; nonce: number } | null;
  /** Start from this exact state (a failed scenario's step). Newer than startAt wins. */
  startState?: { state: GameState; nonce: number } | null;
}

const studioStorage = {
  read: (key: string) => { try { return localStorage.getItem(`studio:${key}`); } catch { return null; } },
  write: (key: string, value: string) => { localStorage.setItem(`studio:${key}`, value); },
};

export default function PlayPanel({ store, content, stale, systems, systemsVersion, source, startAt, startState }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GameHandle | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Recording play as a scenario test (167): actions since "録画" was pressed, from a fresh game. */
  const recording = useRef<Action[] | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  /** Debug play (164): walk through walls / meet no random enemies. Read through refs so toggling never restarts the game. */
  const [noclip, setNoclip] = useState(false);
  const [noEncounters, setNoEncounters] = useState(false);
  const debugRef = useRef({ noclip: false, noEncounters: false });
  debugRef.current = { noclip, noEncounters };
  const debugSystem = useRef<GameSystem>({
    id: "studio-debug",
    canPass: () => (debugRef.current.noclip ? true : undefined),
    canEncounter: () => (debugRef.current.noEncounters ? false : undefined),
  });

  // Remount when content, systems or the requested start change. Engine state is intentionally reset.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let initial: GameState | undefined;
    const previous = handleRef.current?.getState();
    handleRef.current?.destroy();
    setError(null);
    try {
      const handle = mountGame(host, {
        content,
        systems: [...withModules(content, systems), debugSystem.current],
        resolveAsset: asset => source.assetUrl(asset),
        storage: studioStorage,
        keyboard: "focus",
        onLog: lines => lines.forEach(line => store.log("info", `試遊: ${line}`)),
        onStateChange: setState,
        onAction: action => { recording.current?.push(action); },
        onError: err => { setError(err.message); store.log("error", `試遊中のエラー: ${err.message}`); },
      });
      if (startState && (!startAt || startState.nonce > startAt.nonce)) {
        initial = startState.state;
      } else if (startAt && content.maps[startAt.mapId]) {
        const fresh = handle.engine.newGame();
        initial = { ...fresh, mapId: startAt.mapId, player: { ...fresh.player, x: startAt.x, y: startAt.y } };
      } else if (previous && content.maps[previous.mapId] && previous.scene.kind === "field") {
        // Keep progress (flags, position) across data edits where possible; scene state is reset.
        const fresh = handle.engine.newGame();
        initial = { ...fresh, ...previous, flags: { ...fresh.flags, ...previous.flags }, scene: { kind: "field" }, queue: [] };
      }
      if (initial) handle.setState(initial);
      setState(handle.getState());
      handleRef.current = handle;
      handle.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    return () => { handleRef.current?.destroy(); handleRef.current = null; };
  }, [content, systems, startAt, startState]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFlag = (flag: string) => {
    const handle = handleRef.current;
    if (!handle) return;
    const current = handle.getState();
    handle.setState({ ...current, flags: { ...current.flags, [flag]: !current.flags[flag] } });
    handle.focus();
  };
  const toggleAbility = (id: string) => {
    const handle = handleRef.current;
    if (!handle) return;
    const current = handle.getState();
    const has = current.abilities.includes(id);
    handle.setState(handle.engine.run(current, [{ type: has ? "removeAbility" : "unlockAbility", ability: id }]).state);
    handle.focus();
  };
  const setVar = (id: string, value: number) => {
    const handle = handleRef.current;
    if (!handle || !Number.isFinite(value)) return;
    handle.setState(handle.engine.run(handle.getState(), [{ type: "setVar", var: id, value: Math.trunc(value) }]).state);
  };
  const toggleTrait = (id: string) => {
    const handle = handleRef.current;
    if (!handle) return;
    const has = handle.getState().traits.includes(id);
    handle.setState(handle.engine.run(handle.getState(), [{ type: has ? "removeTrait" : "grantTrait", trait: id }]).state);
    handle.focus();
  };
  const giveItem = (id: string) => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.setState(handle.engine.run(handle.getState(), [{ type: "giveItem", item: id }]).state);
    handle.focus();
  };

  return <div className="play-panel">
    <div className="play-bar">
      <button className="button" onClick={() => { handleRef.current?.restart(); handleRef.current?.focus(); store.log("info", "試遊を最初からやり直しました"); }}><RotateCcw size={14} /> 最初から</button>
      {!isRecording
        ? <button className="button" title="最初から遊び直し、操作を自動テスト（tests/*.scenario.json）として記録します" onClick={() => { const h = handleRef.current; if (h) h.setState(h.engine.newGame(1)); recording.current = []; setIsRecording(true); handleRef.current?.focus(); store.log("info", "録画開始: 最初から遊んだ操作を自動テストとして記録します"); }}><Circle size={12} color="#e06c5c" fill="#e06c5c" /> 録画してテストを作る</button>
        : <button className="button primary" onClick={() => {
            const actions = recording.current ?? [];
            recording.current = null; setIsRecording(false);
            const handle = handleRef.current;
            if (!handle || !actions.length) { store.log("warn", "録画した操作がありません"); return; }
            const { steps, skipped } = actionsToSteps(actions);
            const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
            const path = `tests/recorded-${stamp}.scenario.json`;
            const scenario = { name: `試遊の録画（${new Date().toLocaleString("ja-JP")}）。最後の状態を確かめる`, steps: [...steps, finalExpect(handle.getState(), content)] };
            store.setFileText(path, `${JSON.stringify(scenario, null, 2)}\n`);
            store.log("ok", `${path} に保存しました（${steps.length}手順${skipped ? `・リアルタイム画面の入力${skipped}件は記録していません` : ""}）。「検証」画面の自動テストで確かめられます`);
          }}><Square size={12} /> 録画を止めて保存</button>}
      <label className="check small" title="試遊のときだけ。壁や水の上も歩けます（出入口・イベントはそのまま動きます）"><input type="checkbox" checked={noclip} onChange={e => { setNoclip(e.target.checked); handleRef.current?.focus(); }} /> 壁をすり抜ける</label>
      <label className="check small" title="試遊のときだけ。ランダムエンカウントが起きません"><input type="checkbox" checked={noEncounters} onChange={e => { setNoEncounters(e.target.checked); handleRef.current?.focus(); }} /> 敵と出会わない</label>
      <span className="muted small">クリックで操作対象に · 矢印/WASD 移動 · Enter/Z 調べる · Esc/X メニュー</span>
      <span className="spacer" />
      {stale && <span className="badge warn"><AlertTriangle size={12} /> 最新データに検証エラー：直前の正常版で試遊中</span>}
      {source.kind === "local" && <span className="badge">{systemsVersion ? `システム build ${systemsVersion}` : "システム未ビルド"}</span>}
    </div>
    {error && <div className="notice error"><Bug size={14} /> {error}</div>}
    <div className="play-layout">
      <div className="play-host" ref={hostRef} />
      {state && <aside className="debug-panel" aria-label="試遊状態">
        <h4>現在地</h4>
        <p className="mono small">{state.mapId} ({state.player.x}, {state.player.y}) · {state.scene.kind} · HP {state.player.hp} · {state.steps}歩</p>
        <h4>フラグ <span className="muted small">クリックで切替</span></h4>
        <div className="chips">{Object.keys(content.project.flags).map(flag => <button key={flag} className={`chip ${state.flags[flag] ? "is-on" : ""}`} title={content.project.flags[flag]?.description} onClick={() => toggleFlag(flag)}>{flag}</button>)}</div>
        {Object.keys(content.project.variables).length > 0 && <>
          <h4>変数 <span className="muted small">値を直接変更</span></h4>
          <div className="var-grid">{Object.entries(content.project.variables).map(([id, decl]) => <label key={id} title={decl.description}>
            <span>{decl.label ?? id}</span>
            <input type="number" value={state.vars[id] ?? decl.initial} min={decl.min} max={decl.max} onChange={e => setVar(id, Number(e.target.value))} />
          </label>)}</div>
        </>}
        {content.database.traits.length > 0 && <>
          <h4>特性 <span className="muted small">種族など</span></h4>
          <div className="chips">{content.database.traits.map(t => <button key={t.id} className={`chip ${state.traits.includes(t.id) ? "is-on" : ""}`} title={`${t.category}: ${t.description}`} onClick={() => toggleTrait(t.id)}>{t.name}</button>)}</div>
        </>}
        <h4>能力 <span className="muted small">特性由来は特性側で切替</span></h4>
        <div className="chips">{content.database.abilities.map(a => {
          const viaTrait = !state.abilities.includes(a.id) && handleRef.current?.engine.abilities(state).includes(a.id);
          return <button key={a.id} className={`chip ${state.abilities.includes(a.id) || viaTrait ? "is-on" : ""}`} disabled={viaTrait} title={a.description} onClick={() => toggleAbility(a.id)}>{a.name}</button>;
        })}</div>
        <h4>能力値</h4>
        <p className="mono small">{(() => { const st = handleRef.current?.engine.stats(state); return st ? `最大HP ${st.maxHp} / 攻撃 ${st.attack} / 防御 ${st.defense}` : ""; })()}</p>
        <h4>持ち物 <span className="muted small">クリックで+1</span></h4>
        <div className="chips">{content.database.items.map(i => <button key={i.id} className={`chip ${(state.items[i.id] ?? 0) > 0 ? "is-on" : ""}`} onClick={() => giveItem(i.id)}>{i.name} ×{state.items[i.id] ?? 0}</button>)}</div>
        <h4>完了済み</h4>
        <p className="mono small wrap">{state.done.join(", ") || "なし"}</p>
      </aside>}
    </div>
  </div>;
}

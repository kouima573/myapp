import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadProjectContent, type Diagnostic, type GameContent } from "@rpg/schema";
import type { GameSystem } from "@rpg/engine";
import type { BuildStatus, ConflictResponse } from "../../../packages/local-server/src/protocol";
import type { ProjectSource } from "./source";
import { moduleDiagnostics } from "../../../packages/modules/src/index";

export const HISTORY_LIMIT = 100;

export interface LogEntry { id: number; at: Date; level: "info" | "ok" | "warn" | "error"; text: string }
export interface Conflict extends ConflictResponse { mine: string }

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function useProject(source: ProjectSource) {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [externallyChanged, setExternallyChanged] = useState<Set<string>>(new Set());
  const [build, setBuild] = useState<BuildStatus | null>(null);
  const [projectInfo, setProjectInfo] = useState<{ projectDir: string; repoRoot?: string }>({ projectDir: "" });
  const [systems, setSystems] = useState<GameSystem[]>([]);
  const [systemsVersion, setSystemsVersion] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [historyTick, setHistoryTick] = useState(0);

  const textsRef = useRef(texts);
  textsRef.current = texts;
  const hashes = useRef<Record<string, string>>({});
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const timers = useRef<Record<string, number>>({});
  const history = useRef<Record<string, { undo: string[]; redo: string[] }>>({});
  const lastEditedFile = useRef<string | null>(null);
  /** 操作履歴 (176): every undo step made in this studio session, newest last (file, when, text before). */
  const timeline = useRef<Array<{ id: number; at: number; path: string; before: string }>>([]);
  const group = useRef<{ open: boolean; recorded: Set<string> }>({ open: false, recorded: new Set() });
  const logId = useRef(0);

  const log = useCallback((level: LogEntry["level"], text: string) => {
    setLogs(current => [{ id: ++logId.current, at: new Date(), level, text }, ...current].slice(0, 200));
  }, []);

  /* ---------------------------------------------------------- load */
  const reload = useCallback(async (paths?: string[]) => {
    try {
      const snapshot = await source.load();
      setProjectInfo({ projectDir: snapshot.projectDir, repoRoot: snapshot.repoRoot });
      // Update the ref right away too, so an edit made just after a reload (e.g. import → register) builds on the reloaded text.
      const current = textsRef.current;
      let next: Record<string, string>;
      if (!paths) next = snapshot.texts;
      else {
        next = { ...current };
        for (const path of paths) {
          if (snapshot.texts[path] === undefined) delete next[path];
          else next[path] = snapshot.texts[path]!;
        }
        // New files (e.g. a map an agent just added and referenced).
        for (const [path, text] of Object.entries(snapshot.texts)) if (!(path in current)) next[path] = text;
      }
      textsRef.current = next;
      setTexts(next);
      if (paths) for (const path of paths) { if (snapshot.hashes[path]) hashes.current[path] = snapshot.hashes[path]!; }
      else hashes.current = { ...snapshot.hashes };
      for (const path of Object.keys(snapshot.hashes)) if (!(path in hashes.current)) hashes.current[path] = snapshot.hashes[path]!;
      setStatus("ready");
      return snapshot;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
      setStatus("error");
      return null;
    }
  }, [source]);

  useEffect(() => { void reload().then(s => s && log("info", `${s.projectDir} を読み込みました（${source.kind === "local" ? "ローカルファイル" : "Preview: 変更はメモリ内のみ"}）`)); }, [reload, log, source.kind]);

  /* ---------------------------------------------------------- systems */
  useEffect(() => {
    if (source.kind !== "preview") return;
    void source.loadSystems(null).then(list => { setSystems(list); setSystemsVersion("preview"); });
  }, [source]);

  const refreshSystems = useCallback(async (version: string | null) => {
    if (!version || version === systemsVersion) return;
    try {
      const list = await source.loadSystems(version);
      setSystems(list);
      setSystemsVersion(version);
      log("ok", `ビルド ${version} の独自システム(${list.map(s => s.id).join(", ") || "なし"})を試遊に反映しました。試遊中の状態はリセットされます`);
    } catch (error) {
      log("error", `独自システムを読み込めません: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [source, systemsVersion, log]);

  /* ---------------------------------------------------------- polling (local) */
  useEffect(() => {
    if (!source.changes) return;
    let cursor = 0;
    let stopped = false;
    let lastBuildKey = "";
    const tick = async () => {
      try {
        const response = await source.changes!(cursor);
        cursor = response.cursor;
        const external = response.changes.filter(change => !change.path.startsWith("engine:") && change.hash !== hashes.current[change.path] && (change.path in textsRef.current || change.kind === "add"));
        const clean = external.filter(change => !dirtyRef.current.has(change.path)).map(change => change.path);
        const clashing = external.filter(change => dirtyRef.current.has(change.path)).map(change => change.path);
        if (clean.length) { await reload(clean); log("info", `外部で変更されたファイルを再読込: ${clean.join(", ")}`); }
        // What changed, in game terms (from the server's save history), so an AI's edit is easy to follow.
        for (const change of external) if (change.summary?.length) log("info", `変更の要約 ${change.path}: ${change.summary.join(" ／ ")}`);
        if (clashing.length) {
          setExternallyChanged(current => new Set([...current, ...clashing]));
          log("warn", `未保存の変更があるファイルが外部でも変更されました: ${clashing.join(", ")}`);
        }
        const key = `${response.build.state}:${response.build.version}:${response.build.diagnostics.length}`;
        if (key !== lastBuildKey) {
          lastBuildKey = key;
          setBuild(response.build);
          if (response.build.state === "error") log("error", `ビルド失敗（直前の正常版${response.build.version ? ` ${response.build.version}` : ""}で試遊を続けられます）`);
          if (response.build.state === "ready") void refreshSystems(response.build.version);
        }
      } catch (error) {
        setBuild(current => current ? { ...current, state: "error", diagnostics: [`ERROR ローカルサーバーに接続できません: ${error instanceof Error ? error.message : String(error)}`] } : current);
      }
      if (!stopped) window.setTimeout(tick, 1000);
    };
    void tick();
    return () => { stopped = true; };
  }, [source, reload, refreshSystems, log]);

  /* ---------------------------------------------------------- saving */
  const flush = useCallback(async (path: string) => {
    window.clearTimeout(timers.current[path]);
    const content = textsRef.current[path];
    if (content === undefined) return;
    const result = await source.save(path, content, hashes.current[path] ?? "");
    if (result.ok) {
      hashes.current[path] = result.hash;
      if (textsRef.current[path] === content) setDirty(current => { const next = new Set(current); next.delete(path); return next; });
      setExternallyChanged(current => { if (!current.has(path)) return current; const next = new Set(current); next.delete(path); return next; });
    } else if ("conflict" in result) {
      setConflicts(current => [...current.filter(c => c.path !== path), { ...result.conflict, mine: content }]);
      log("warn", `${path} は外部で変更されていたため保存を止めました。内容を確認して選んでください`);
    } else {
      log("error", `${path} を保存できません: ${result.error}`);
    }
  }, [source, log]);

  const scheduleSave = useCallback((path: string) => {
    window.clearTimeout(timers.current[path]);
    timers.current[path] = window.setTimeout(() => void flush(path), 450);
  }, [flush]);

  /* ---------------------------------------------------------- editing */
  const setFileText = useCallback((path: string, text: string, options: { record?: boolean } = {}) => {
    const previous = textsRef.current[path];
    if (previous === text) return;
    lastEditedFile.current = path;
    if (options.record !== false && previous !== undefined) {
      const entry = history.current[path] ??= { undo: [], redo: [] };
      if (!group.current.open || !group.current.recorded.has(path)) {
        entry.undo = [...entry.undo, previous].slice(-HISTORY_LIMIT);
        entry.redo = [];
        timeline.current = [...timeline.current, { id: (timeline.current.at(-1)?.id ?? 0) + 1, at: Date.now(), path, before: previous }].slice(-300);
        if (group.current.open) group.current.recorded.add(path);
        setHistoryTick(t => t + 1);
      }
    }
    textsRef.current = { ...textsRef.current, [path]: text };
    setTexts(textsRef.current);
    setDirty(current => current.has(path) ? current : new Set(current).add(path));
    scheduleSave(path);
  }, [scheduleSave]);

  const updateJson = useCallback(<T,>(path: string, recipe: (value: T) => T | void) => {
    const text = textsRef.current[path];
    if (text === undefined) return;
    let value: T;
    try { value = JSON.parse(text) as T; } catch { log("error", `${path} がJSONとして壊れているため画面から編集できません。データ画面で修正してください`); return; }
    const draft = structuredClone(value);
    const result = recipe(draft);
    setFileText(path, formatJson(result === undefined ? draft : result));
  }, [setFileText, log]);

  /** Groups many edits (e.g. one paint stroke) into a single undo step. */
  const beginGroup = useCallback(() => { group.current = { open: true, recorded: new Set() }; }, []);
  const endGroup = useCallback(() => { group.current = { open: false, recorded: new Set() }; }, []);

  const undo = useCallback((path: string) => {
    const entry = history.current[path];
    const previous = entry?.undo.at(-1);
    if (!entry || previous === undefined) return false;
    entry.undo = entry.undo.slice(0, -1);
    entry.redo = [...entry.redo, textsRef.current[path] ?? ""];
    setFileText(path, previous, { record: false });
    setHistoryTick(t => t + 1);
    return true;
  }, [setFileText]);

  const redo = useCallback((path: string) => {
    const entry = history.current[path];
    const next = entry?.redo.at(-1);
    if (!entry || next === undefined) return false;
    entry.redo = entry.redo.slice(0, -1);
    entry.undo = [...entry.undo, textsRef.current[path] ?? ""];
    setFileText(path, next, { record: false });
    setHistoryTick(t => t + 1);
    return true;
  }, [setFileText]);

  const historyState = useCallback((path: string) => ({
    canUndo: (history.current[path]?.undo.length ?? 0) > 0,
    canRedo: (history.current[path]?.redo.length ?? 0) > 0,
  }), [historyTick]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------------------------------------- conflicts */
  const resolveConflict = useCallback(async (path: string, choice: "theirs" | "mine") => {
    window.clearTimeout(timers.current[path]);
    const conflict = conflicts.find(c => c.path === path);
    if (!conflict) return;
    setConflicts(current => current.filter(c => c.path !== path));
    hashes.current[path] = conflict.latestHash;
    if (choice === "theirs") {
      textsRef.current = { ...textsRef.current, [path]: conflict.latestContent };
      setTexts(textsRef.current);
      setDirty(current => { const next = new Set(current); next.delete(path); return next; });
      log("info", `${path}: ディスクの内容を読み込みました（画面側の変更は破棄）`);
    } else {
      textsRef.current = { ...textsRef.current, [path]: conflict.mine };
      setTexts(textsRef.current);
      await flush(path);
      log("warn", `${path}: 画面の内容で上書きしました`);
    }
    setExternallyChanged(current => { const next = new Set(current); next.delete(path); return next; });
  }, [conflicts, flush, log]);

  /** For editors that keep a local draft: the file changed underneath the draft, so ask instead of overwriting. */
  const raiseConflict = useCallback((path: string, mine: string) => {
    setConflicts(current => [...current.filter(c => c.path !== path), { error: "conflict", path, latestContent: textsRef.current[path] ?? "", latestHash: hashes.current[path] ?? "", mine }]);
    log("warn", `${path} は編集中に外部で変更されました。どちらを残すか選んでください`);
  }, [log]);

  /* ---------------------------------------------------------- derived */
  const loaded = useMemo(() => {
    if (!Object.keys(texts).length) return { content: null, diagnostics: [] as Diagnostic[] };
    const result = loadProjectContent(texts);
    // Genre modules (novel / puzzle / shooter …) check their own startScene / battle-mode arguments.
    return result.content ? { ...result, diagnostics: [...result.diagnostics, ...moduleDiagnostics(result.content)] } : result;
  }, [texts]);
  const lastGood = useRef<GameContent | null>(null);
  if (loaded.content) lastGood.current = loaded.content;

  const requestBuild = useCallback(async () => {
    if (!source.requestBuild) { log("info", "Previewでは試遊が常に最新データを使います（ビルド不要）"); return; }
    setBuild(await source.requestBuild());
    log("info", "再ビルドを要求しました");
  }, [source, log]);

  return {
    source, status, loadError, texts, projectInfo, dirty, conflicts, externallyChanged, build, systems, systemsVersion, logs,
    content: loaded.content, lastGoodContent: lastGood.current, diagnostics: loaded.diagnostics, lastEditedFile: lastEditedFile.current,
    log, setFileText, updateJson, raiseConflict, beginGroup, endGroup, undo, redo, historyState, resolveConflict, requestBuild, reload,
    timeline: timeline.current,
    /** Undo the file of a timeline step back to just before it (as many undo steps as needed). */
    rewindTo: (id: number) => {
      const step = timeline.current.find(t => t.id === id);
      if (!step) return;
      let guard = 0;
      while (guard++ < 200 && textsRef.current[step.path] !== step.before && undo(step.path)) { /* keep undoing */ }
      timeline.current = timeline.current.filter(t => !(t.path === step.path && t.id >= id));
      setHistoryTick(t => t + 1);
    },
  };
}

export type ProjectStore = ReturnType<typeof useProject>;

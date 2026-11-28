/**
 * 更新しても、買った人のセーブが消えないように:
 * - `rpg release snapshot`: 自動テスト（tests/*.scenario.json）を通して遊び、セーブできる場面のセーブを releases/<版>/saves/ に残す
 * - 販売前チェック: 前の版のセーブを今の版で読み込み、少し動かして止まらないかを確かめる（checkOldSaves）
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createEngine, makeSave, readSave, type GameSystem } from "../../engine/src/index";
import { runScenario, ScenarioSchema } from "../../engine/src/scenario";
import type { GameContent } from "../../schema/src/index";
import { loadProjectFromDisk } from "./load";

export interface OldSaveResult { file: string; ok: boolean; notes: string[]; message?: string; version?: string }

/** Reads each old save with the current game and takes a few steps (moving in 4 directions, waiting). Never throws. */
export function checkOldSaves(content: GameContent, systems: GameSystem[], saves: Array<{ file: string; text: string }>): OldSaveResult[] {
  return saves.map(({ file, text }) => {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return { file, ok: false, notes: [], message: "JSONとして読めません" }; }
    const version = typeof (raw as { gameVersion?: unknown }).gameVersion === "string" ? (raw as { gameVersion: string }).gameVersion : undefined;
    const read = readSave(raw, content);
    if (!read.ok) return { file, ok: false, notes: [], message: `読み込めません: ${read.reason}`, version };
    try {
      const engine = createEngine(content, systems);
      let state = read.save.state;
      engine.stats(state);
      for (const direction of ["down", "left", "right", "up"] as const) {
        state = engine.step(state, { type: "move", direction }).state;
        for (let guard = 0; guard < 30 && (state.scene.kind === "message" || state.scene.kind === "dialogue"); guard++) state = engine.step(state, { type: "advance" }).state;
        if (state.scene.kind !== "field") break;
      }
      return { file, ok: true, notes: read.notes, version };
    } catch (error) {
      return { file, ok: false, notes: read.notes, message: `読み込んだあと動かすと止まります: ${error instanceof Error ? error.message : String(error)}`, version };
    }
  });
}

/** Old saves kept under releases/<version>/saves/*.json. */
export async function readOldSaves(root: string): Promise<Array<{ file: string; text: string }>> {
  const out: Array<{ file: string; text: string }> = [];
  let versions: string[] = [];
  try { versions = (await fs.readdir(path.join(root, "releases"), { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort(); } catch { return out; }
  for (const version of versions) {
    const dir = path.join(root, "releases", version, "saves");
    let names: string[] = [];
    try { names = (await fs.readdir(dir)).filter(n => n.endsWith(".json")).sort(); } catch { continue; }
    for (const name of names) out.push({ file: `releases/${version}/saves/${name}`, text: await fs.readFile(path.join(dir, name), "utf8") });
  }
  return out;
}

const safe = (s: string) => s.replace(/[^0-9A-Za-z._-]+/g, "-").replace(/^-+|-+$/g, "") || "save";

/** `rpg release snapshot --project <dir> [--version 1.0.0]` */
export async function cmdReleaseSnapshot(root: string, flags: Record<string, string | boolean>): Promise<number> {
  const loaded = await loadProjectFromDisk(root);
  if (!loaded.content) { console.log("FAILED release snapshot: プロジェクトを読み込めません。先に pnpm rpg validate で直してください"); return 1; }
  const content = loaded.content;
  const version = typeof flags.version === "string" ? flags.version : content.project.version;
  if (!version) { console.log("FAILED release snapshot: 版がわかりません。project.json に \"version\": \"1.0.0\" のように書くか、--version 1.0.0 を付けてください"); return 1; }
  const stamped: GameContent = { ...content, project: { ...content.project, version } };
  const { loadSystems } = await import("./index");
  const systems = await loadSystems(root, content);
  let files: string[] = [];
  try { files = (await fs.readdir(path.join(root, "tests"))).filter(n => n.endsWith(".scenario.json")).sort(); } catch { /* none */ }
  if (!files.length) { console.log("FAILED release snapshot: tests/*.scenario.json がありません。最後まで遊ぶ自動テストを作ってから実行してください"); return 1; }
  const dir = path.join(root, "releases", safe(version), "saves");
  await fs.mkdir(dir, { recursive: true });
  let written = 0;
  for (const name of files) {
    const parsed = ScenarioSchema.safeParse(JSON.parse(await fs.readFile(path.join(root, "tests", name), "utf8")));
    if (!parsed.success) { console.log(`WARN  tests/${name}: 形式が正しくないので飛ばしました`); continue; }
    const result = runScenario(content, systems, parsed.data, { checkpoints: true });
    if (!result.ok) { console.log(`WARN  tests/${name}: テストが通らないので飛ばしました（${result.message ?? ""}）`); continue; }
    // At most 4 saves per test: spread over the playthrough (always the first and the last).
    const all = result.checkpoints ?? [];
    const pick = all.length <= 4 ? all : [...new Set([0, 1, 2, 3].map(i => Math.round(i * (all.length - 1) / 3)))].map(i => all[i]!);
    for (const [i, state] of pick.entries()) {
      const save = makeSave(stamped, state, new Date());
      await fs.writeFile(path.join(dir, `${safe(name.replace(/\.scenario\.json$/, ""))}-${String(i + 1).padStart(2, "0")}-${safe(state.mapId)}.json`), `${JSON.stringify(save, null, 2)}\n`);
      written++;
    }
  }
  console.log(`OK release snapshot: ${written}件のセーブを ${path.relative(process.cwd(), dir) || dir} に残しました（版 ${version}）。
次に更新したら pnpm rpg release-check で、この版のセーブが今の版で読めて動くかを確かめます。releases/ はリポジトリに入れておいてください（遊ぶ人に配る必要はありません）`);
  return written ? 0 : 1;
}

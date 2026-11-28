/** `rpg release-check --project <dir>`: the release checklist (validate, tests, endings, unfinished text, proofreading, rights, credits). Exit 1 when something blocks. */
import fs from "node:fs/promises";
import path from "node:path";
import { loadProjectFromDisk } from "./load";
import { RELEASE_MARK, releaseChecklist } from "./releaseCheck";
import { checkOldSaves, readOldSaves } from "./releaseSaves";

export async function cmdReleaseCheck(root: string): Promise<number> {
  const loaded = await loadProjectFromDisk(root);
  const texts = { ...loaded.texts };
  try { for (const name of (await fs.readdir(path.join(root, "tests"))).filter(n => n.endsWith(".scenario.json"))) texts[`tests/${name}`] = await fs.readFile(path.join(root, "tests", name), "utf8"); } catch { /* no tests */ }
  let tests: Array<{ file: string; ok: boolean; message?: string }> | undefined;
  let oldSaves: ReturnType<typeof checkOldSaves> | undefined;
  if (loaded.content) {
    const { loadSystems, runProjectScenarios } = await import("./index");
    const saves = await readOldSaves(root);
    try {
      const systems = await loadSystems(root, loaded.content);
      try { tests = (await runProjectScenarios(root, loaded.content, systems)).map(r => ({ file: r.file, ok: r.ok, message: r.ok ? undefined : `steps[${r.failedStep ?? "?"}] ${r.message ?? ""}` })); }
      catch (error) { tests = [{ file: "tests", ok: false, message: error instanceof Error ? error.message : String(error) }]; }
      oldSaves = saves.length ? checkOldSaves(loaded.content, systems, saves) : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      tests = [{ file: "systems", ok: false, message }];
      if (saves.length) oldSaves = [{ file: "releases/", ok: false, notes: [], message: `システムを読み込めないため確かめられません: ${message}` }];
    }
  }
  const report = releaseChecklist({ content: loaded.content, texts, diagnostics: loaded.diagnostics, tests, oldSaves });
  console.log(`# 販売前チェック — ${loaded.content?.project.title ?? path.basename(root)}\n`);
  for (const item of report.items) {
    console.log(`[${RELEASE_MARK[item.status]}] ${item.label}`);
    for (const d of item.details) console.log(`        ${d}`);
  }
  const verdict = report.verdict === "ready" ? "OK release-check: 公開・販売できる状態です" : report.verdict === "warn" ? "WARN release-check: 止めるほどではありませんが、注意の項目を見てから出してください" : "FAILED release-check: 「不可」の項目を直すまで公開・販売しないでください";
  console.log(`\n${verdict}`);
  return report.verdict === "blocked" ? 1 : 0;
}

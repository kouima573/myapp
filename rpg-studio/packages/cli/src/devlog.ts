/**
 * `rpg devlog --project <dir> [--days 7] [--out DEVLOG.md]` — a draft of a development diary (roadmap 019):
 * what the game has now, and what changed recently (git commits touching the project + the studio's save history
 * with plain-language summaries). A draft to edit and post; it never publishes anything.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./build";
import { loadProjectFromDisk } from "./load";

type Flags = Record<string, string | boolean>;

export async function devlogMarkdown(root: string, days: number, now = new Date()): Promise<string> {
  const loaded = await loadProjectFromDisk(root);
  const c = loaded.content;
  const since = new Date(now.getTime() - days * 86400000);
  const lines: string[] = [`# 制作日誌（下書き）: ${c?.project.title ?? path.basename(root)}`, "", `${since.toLocaleDateString("ja-JP")} 〜 ${now.toLocaleDateString("ja-JP")}`, ""];
  if (c) {
    const npcs = Object.values(c.maps).reduce((n, m) => n + m.npcs.length, 0);
    lines.push("## いまのゲーム", "",
      `- マップ ${c.project.maps.length}（${c.project.maps.map(m => m.title).join("・")}）`,
      `- 人 ${npcs}・会話 ${Object.keys(c.dialogues).length}・イベント ${Object.keys(c.events).length}`,
      `- 敵 ${c.database.enemies.length}・アイテム ${c.database.items.length}・技 ${c.database.abilities.length}・仲間 ${c.database.companions.length}`,
      ...(c.database.skillBoards?.length ? [`- スキルボード ${c.database.skillBoards.length}（パネル ${c.database.skillBoards.reduce((n, b) => n + b.nodes.length, 0)}）`] : []),
      ...(Object.keys(c.project.endings).length ? [`- エンディング ${Object.keys(c.project.endings).length}`] : []), "");
  }
  // Commits that touched this project folder.
  const rel = path.relative(REPO_ROOT, root).split(path.sep).join("/") || ".";
  let commits: string[] = [];
  try {
    commits = execFileSync("git", ["log", `--since=${since.toISOString()}`, "--pretty=format:%ad %s", "--date=short", "--", rel], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch { /* not a git checkout */ }
  if (commits.length) lines.push("## 記録（コミット）", "", ...commits.slice(0, 30).map(l => `- ${l}`), "");
  // The studio's save history (changes from the studio and from AI agents, summarised).
  const histDir = path.join(REPO_ROOT, ".rpg-studio", "history", `${path.basename(root)}-${crypto.createHash("sha256").update(await fs.realpath(root)).digest("hex").slice(0, 8)}`);
  try {
    const entries = JSON.parse(await fs.readFile(path.join(histDir, "index.json"), "utf8")) as Array<{ file: string; at: string; source: string; summary: string[] }>;
    const recent = entries.filter(e => new Date(e.at) >= since);
    if (recent.length) {
      lines.push("## 変えたところ（工房の保存履歴より）", "");
      const byFile = new Map<string, string[]>();
      for (const e of recent) byFile.set(e.file, [...(byFile.get(e.file) ?? []), ...e.summary]);
      for (const [file, sums] of byFile) lines.push(`- ${file}: ${[...new Set(sums)].slice(0, 6).join(" ／ ")}${sums.length > 6 ? " ほか" : ""}`);
      lines.push("");
    }
  } catch { /* no history yet */ }
  lines.push("## ひとこと", "", "（ここに今週の感想・苦労・次にやることを書く）", "");
  return lines.join("\n");
}

export async function cmdDevlog(flags: Flags, root: string): Promise<number> {
  const days = Number(flags.days) || 7;
  const md = await devlogMarkdown(root, days);
  if (typeof flags.out === "string") {
    const target = path.resolve(root, flags.out);
    if (path.relative(root, target).startsWith("..")) { console.log("ERROR --out はプロジェクトの中に"); return 2; }
    await fs.writeFile(target, md);
    console.log(`OK devlog: ${path.relative(process.cwd(), target)} に下書きを書きました`);
  } else console.log(md);
  return 0;
}

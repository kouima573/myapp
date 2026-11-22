/**
 * `rpg sample reset --project projects/<id> [--write]` — puts a sample project back exactly as committed (git),
 * so beginners can break things and start over (roadmap 020). Dry run by default: lists what would change.
 * Only folders under projects/ of this repository; needs git.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { REPO_ROOT } from "./build";

type Flags = Record<string, string | boolean>;

export async function cmdSample(sub: string | undefined, flags: Flags, root: string): Promise<number> {
  if (sub !== "reset") { console.log("ERROR rpg sample reset --project projects/<id> [--write]"); return 2; }
  const rel = path.relative(REPO_ROOT, root).split(path.sep).join("/");
  if (!/^projects\/[^/]+$/.test(rel)) { console.log(`ERROR 見本（projects/ の下のフォルダ）だけ元に戻せます: ${rel}`); return 2; }
  let status: string;
  try { status = execFileSync("git", ["status", "--porcelain", "--", rel], { cwd: REPO_ROOT, encoding: "utf8" }); }
  catch { console.log("ERROR git が使えません（git でクローンしたフォルダで実行してください）"); return 1; }
  const lines = status.split("\n").filter(Boolean);
  if (!lines.length) { console.log(`OK ${rel} は元のままです`); return 0; }
  for (const l of lines) console.log(`${l.startsWith("??") ? "消す（新しく作ったファイル）" : "元に戻す"}: ${l.slice(3)}`);
  if (!flags.write) { console.log(`（まだ何もしていません。--write で ${lines.length} ファイルを元に戻します。新しく作ったファイルは消えます）`); return 0; }
  execFileSync("git", ["checkout", "--", rel], { cwd: REPO_ROOT });
  execFileSync("git", ["clean", "-fd", "--", rel], { cwd: REPO_ROOT });
  console.log(`OK ${rel} を元に戻しました`);
  return 0;
}

import path from "node:path";
import { startServer } from "./server";

async function main() {
  const argv = process.argv.slice(2);
  let project = "projects/sample-rpg";
  let port = Number(process.env.RPG_STUDIO_PORT ?? 4173);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--project" && argv[i + 1]) project = argv[++i]!;
    else if (arg === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (arg === "--help") { console.log("Usage: pnpm studio [--project <dir>] [--port 4173]"); return; }
    else throw new Error(`不明なオプション: ${arg}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port が不正です");
  const running = await startServer({ projectDir: path.resolve(process.cwd(), project), port });
  // The token is never printed: the UI receives it in the served HTML only.
  console.log(`RPG Studio: ${running.url}/  (project: ${project})`);
  console.log("ブラウザで上のURLを開いてください。Ctrl+Cで終了します。");
  const stop = () => { void running.close().then(() => process.exit(0)); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch(error => { console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });

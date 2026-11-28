import fs from "node:fs/promises";
import path from "node:path";
import { AssetManifestSchema, ExperienceProjectSchema, type AssetManifest, type Diagnostic, type ExperienceProject } from "../../schema/src/index";
import { checkAssetFiles, resolveInside } from "./load";

export interface LoadedExperienceProject {
  root: string;
  manifest: ExperienceProject | null;
  assets: AssetManifest | null;
  entryFile?: string;
  entryText?: string;
  diagnostics: Diagnostic[];
}

/** Read editable text files for the generic studio without inventing RPG data. */
export async function readExperienceProjectTexts(root: string): Promise<Record<string, string>> {
  root = path.resolve(root);
  const texts: Record<string, string> = {};
  const ignored = new Set([".git", "node_modules", ".rpg-backup", ".rpg-studio"]);
  const textExtensions = new Set([".json", ".ts", ".tsx", ".md", ".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".txt", ".xml", ".svg", ".webmanifest"]);
  const walk = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await walk(absolute); continue; }
      if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) continue;
      if (stat.size > 4 * 1024 * 1024) continue;
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      texts[relative] = await fs.readFile(absolute, "utf8");
    }
  };
  await walk(root);
  return texts;
}

async function safeFile(root: string, relative: string): Promise<string> {
  const target = resolveInside(root, relative);
  let current = path.resolve(root);
  const parts = relative.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]!);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`シンボリックリンクは使えません: ${relative}`);
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error(`親フォルダーではありません: ${relative}`);
    if (i === parts.length - 1 && !stat.isFile()) throw new Error(`ファイルではありません: ${relative}`);
  }
  return target;
}

function parseJson(text: string, file: string, diagnostics: Diagnostic[]): unknown {
  try { return JSON.parse(text); }
  catch (error) { diagnostics.push({ severity: "error", file, message: `JSONとして読めません: ${String(error)}` }); return undefined; }
}

/** Load the separate experience format. No RPG manifest or hidden RPG state is synthesized. */
export async function loadExperienceProject(root: string): Promise<LoadedExperienceProject> {
  root = path.resolve(root);
  const diagnostics: Diagnostic[] = [];
  let manifestText: string;
  try { manifestText = await fs.readFile(await safeFile(root, "experience.json"), "utf8"); }
  catch (error) {
    return { root, manifest: null, assets: null, diagnostics: [{ severity: "error", file: "experience.json", message: `読み込めません: ${String(error)}` }] };
  }
  const raw = parseJson(manifestText, "experience.json", diagnostics);
  if (raw === undefined) return { root, manifest: null, assets: null, diagnostics };
  const parsed = ExperienceProjectSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) diagnostics.push({ severity: "error", file: "experience.json", at: issue.path.map(String).join("."), message: issue.message });
    return { root, manifest: null, assets: null, diagnostics };
  }
  const manifest = parsed.data;

  let assetsText: string;
  try { assetsText = await fs.readFile(await safeFile(root, manifest.assetsPath), "utf8"); }
  catch (error) {
    diagnostics.push({ severity: "error", file: manifest.assetsPath, message: `素材一覧を読めません: ${String(error)}` });
    return { root, manifest, assets: null, diagnostics };
  }
  const rawAssets = parseJson(assetsText, manifest.assetsPath, diagnostics);
  if (rawAssets === undefined) return { root, manifest, assets: null, diagnostics };
  const parsedAssets = AssetManifestSchema.safeParse(rawAssets);
  if (!parsedAssets.success) {
    for (const issue of parsedAssets.error.issues) diagnostics.push({ severity: "error", file: manifest.assetsPath, at: issue.path.map(String).join("."), message: issue.message });
    return { root, manifest, assets: null, diagnostics };
  }
  const assets = parsedAssets.data;

  let entryFile: string | undefined;
  let entryText: string | undefined;
  const sourceBuild = manifest.runtime === "static" && manifest.build !== undefined;
  if (!sourceBuild) {
    try {
      entryFile = await safeFile(root, manifest.entry);
      entryText = await fs.readFile(entryFile, "utf8");
    } catch (error) {
      diagnostics.push({ severity: "error", file: manifest.entry, message: `エントリーポイントを読めません: ${String(error)}` });
    }
  }
  if (!sourceBuild) {
    for (const asset of assets.assets) {
      try { await safeFile(root, asset.path); }
      catch (error) { diagnostics.push({ severity: "error", file: manifest.assetsPath, at: `assets[${asset.id}]`, message: String(error) }); }
    }
    diagnostics.push(...await checkAssetFiles(root, assets.assets, manifest.assetsPath));
  }
  return { root, manifest, assets, entryFile, entryText, diagnostics };
}

export async function newExperienceProject(id: string, title: string, root: string, runtime: ExperienceProject["runtime"] = "experience"): Promise<string> {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error(`IDは英数字で始まり、英数字・_・-のみ使えます: ${id}`);
  const projectRoot = path.resolve(root);
  await fs.mkdir(projectRoot, { recursive: true });
  const dir = path.join(projectRoot, id);
  await fs.mkdir(dir, { recursive: false });
  const manifest: ExperienceProject = {
    formatVersion: 1,
    id,
    title,
    runtime,
    entry: runtime === "static" ? "index.html" : "systems/main.ts",
    assetsPath: "assets.json",
    args: {},
    save: { enabled: true, autosave: true },
  };
  await fs.writeFile(path.join(dir, "experience.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(dir, "assets.json"), `${JSON.stringify({ formatVersion: 1, assets: [] }, null, 2)}\n`);
  if (runtime === "static") {
    const safeTitle = title.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    await fs.writeFile(path.join(dir, "index.html"), `<!doctype html>\n<html lang="ja">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${safeTitle}</title>\n</head>\n<body>\n  <!-- ここから先は自由です。CSS・JavaScript・Canvas・WebAudio・WASM等を好きな構成で追加できます。 -->\n  <main id="app"></main>\n</body>\n</html>\n`);
    const relative = path.relative(process.cwd(), dir);
    await fs.writeFile(path.join(dir, "README.md"), `# ${title}\n\nこれは独自ランタイム作品です。RPG Studio は制作方法やゲームルールを指定せず、公開時に作品ファイルをそのまままとめます。\n\n- index.html: 配布サイトの起点\n- assets.json: 工房から追加した画像・音声・フォントと出典\n\nCSS・JavaScript・Canvas・WebAudio・WASMや、お好みのファイル構成を自由に追加できます。\n\npnpm rpg validate --project ${relative}\npnpm rpg dev --project ${relative}\npnpm rpg build --project ${relative} --zip\n`);
    return dir;
  }
  await fs.mkdir(path.join(dir, "systems"), { recursive: true });
  await fs.mkdir(path.join(dir, "tests"), { recursive: true });
  await fs.writeFile(path.join(dir, "tests", "README.md"), `# 作品の入力シナリオ\n\nこのフォルダーに *.experience.json を追加すると、pnpm rpg test --project ${path.relative(process.cwd(), dir)} を実行して update() の状態遷移を確認できます。形式と例は docs/experience-projects.md を参照してください。画面・音・操作感は試遊で確認します。\n`);
  await fs.writeFile(path.join(dir, "systems", "main.ts"), `import { defineExperience } from "@rpg/engine";\n\nexport default defineExperience({\n  id: ${JSON.stringify(id)},\n  version: 1,\n  title: ${JSON.stringify(title)},\n  start() { return { count: 0 }; },\n  update(state, input) {\n    if (input.type === "key" && input.key === "confirm") return { ...(state as { count: number }), count: (state as { count: number }).count + 1 };\n    return state;\n  },\n  render(host, view) {\n    const panel = document.createElement("main");\n    panel.style.cssText = "min-height:100dvh;display:grid;place-content:center;gap:1rem;text-align:center;font:20px system-ui;padding:1.5rem";\n    const count = (view.state as { count: number }).count;\n    const heading = document.createElement("h1"); heading.textContent = ${JSON.stringify(title)};\n    const body = document.createElement("p"); body.textContent = \`決定キーを押した回数: \${count}\`;\n    const button = document.createElement("button"); button.type = "button"; button.textContent = "進める"; button.onclick = () => view.send({ type: "key", key: "confirm" });\n    panel.append(heading, body, button); host.append(panel);\n  },\n});\n`);
  const relative = path.relative(process.cwd(), dir);
  await fs.writeFile(path.join(dir, "README.md"), `# ${title}\n\nRPGの主人公・マップ・HPを前提にしない、独立したゲーム体験です。\n\n- experience.json: 作品情報と起動する TypeScript ファイル\n- systems/main.ts: 状態遷移・入力・画面表示\n- assets.json: 素材と出典の一覧\n- tests/*.experience.json: 入力に対する状態の期待値（任意）\n\npnpm rpg validate --project ${relative}\npnpm rpg test --project ${relative}\npnpm rpg dev --project ${relative}\npnpm rpg build --project ${relative} --zip\n`);
  return dir;
}

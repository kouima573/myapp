import { AssetManifestSchema, ExperienceProjectSchema } from "@rpg/schema";
import type { AssetManifest, ExperienceProject } from "@rpg/schema";
import runtimeSource from "../../../packages/runtime/src/experience.ts?raw";
import { sampleAssetUrl } from "./source";
import { readZip, writeZip, type ZipEntry } from "./zip";

const enc = new TextEncoder();

function parseProject(texts: Record<string, string>): { manifest: ExperienceProject; assets: AssetManifest } {
  const manifestText = texts["experience.json"];
  if (!manifestText) throw new Error("experience.json がありません");
  let raw: unknown;
  try { raw = JSON.parse(manifestText); } catch (error) { throw new Error(`experience.json を読めません: ${String(error)}`); }
  const project = ExperienceProjectSchema.safeParse(raw);
  if (!project.success) throw new Error(project.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
  let assetRaw: unknown;
  try { assetRaw = JSON.parse(texts[project.data.assetsPath] ?? ""); } catch (error) { throw new Error(`${project.data.assetsPath} を読めません: ${String(error)}`); }
  const assets = AssetManifestSchema.safeParse(assetRaw);
  if (!assets.success) throw new Error(assets.error.issues.map(issue => `${project.data.assetsPath} › ${issue.path.join(".")}: ${issue.message}`).join("\n"));
  return { manifest: project.data, assets: assets.data };
}

function formatDiagnostics(ts: typeof import("typescript"), file: string, diagnostics: readonly import("typescript").Diagnostic[]): string[] {
  return diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error).map(diagnostic => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${file}:${line + 1}:${character + 1} ${message}`;
    }
    return `${file}: ${message}`;
  });
}

/** Compile the scene-first entry and its local TypeScript helpers for the browser preview or ZIP. */
export async function compileExperienceBundle(
  texts: Record<string, string>,
  assetUrls: Record<string, string>,
  options: { memorySave?: boolean; registerServiceWorker?: boolean } = {},
): Promise<{ bundle: string; manifest: ExperienceProject; assets: AssetManifest }> {
  const { manifest, assets } = parseProject(texts);
  const entrySource = texts[manifest.entry];
  if (entrySource === undefined) throw new Error(`入口ファイルがありません: ${manifest.entry}`);

  // TypeScript is already a free, local project dependency. Load it only when this feature is used.
  // transpileModule reports syntax diagnostics; full type checking remains available with local `rpg build`.
  const ts = await import("typescript");
  const settings: import("typescript").CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
    isolatedModules: true,
  };
  const sources: Record<string, string> = {};
  for (const [path, source] of Object.entries(texts)) if (/\.tsx?$/.test(path)) sources[path] = source;
  sources["__runtime/experience.ts"] = runtimeSource;
  const compiled: Record<string, string> = {};
  const issues: string[] = [];
  for (const [path, source] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) {
    const result = ts.transpileModule(source, { compilerOptions: settings, fileName: path, reportDiagnostics: true });
    issues.push(...formatDiagnostics(ts, path === "__runtime/experience.ts" ? "runtime/experience.ts" : path, result.diagnostics ?? []));
    compiled[path] = result.outputText;
  }
  if (issues.length) throw new Error(issues.join("\n"));

  const factories = Object.entries(compiled).map(([path, source]) =>
    `${JSON.stringify(path)}: function(module, exports, require) {\n${source}\n}`,
  ).join(",\n");
  const enginePath = "@rpg/engine";
  const bundle = `// RPG Studio scene-first experience runtime
(() => {
  const sendError = error => { try { parent.postMessage({ type: "experience-error", detail: error instanceof Error ? error.message : String(error) }, "*"); } catch {} };
  try {
    const factories = {\n${factories}\n  };
    const cache = new Map();
    const engine = { defineExperience: value => value };
    function resolve(request, parentPath) {
      if (request === ${JSON.stringify(enginePath)}) return request;
      if (!request.startsWith(".")) throw new Error("ブラウザ試遊で使える外部importは @rpg/engine の defineExperience とプロジェクト内の相対 .ts import です: " + request);
      const parentParts = parentPath ? parentPath.split("/").slice(0, -1) : [];
      for (const part of request.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") { if (!parentParts.length) throw new Error("プロジェクト外へのimportはできません"); parentParts.pop(); }
        else parentParts.push(part);
      }
      const base = parentParts.join("/");
      const candidates = [base, base + ".ts", base + ".tsx", base.replace(/\.js$/, ".ts"), base + "/index.ts"];
      const found = candidates.find(candidate => Object.hasOwn(factories, candidate));
      if (!found) throw new Error("import先がありません: " + request + " (from " + parentPath + ")");
      return found;
    }
    function load(request, parentPath = "") {
      if (request === ${JSON.stringify(enginePath)}) return engine;
      if (request === "@rpg/runtime/experience") request = "__runtime/experience.ts";
      const id = request.startsWith(".") ? resolve(request, parentPath) : request;
      if (cache.has(id)) return cache.get(id).exports;
      const factory = factories[id];
      if (!factory) throw new Error("読み込めないモジュールです: " + id);
      const module = { exports: {} };
      cache.set(id, module);
      factory(module, module.exports, child => load(child, id));
      return module.exports;
    }
    const experience = load(${JSON.stringify(manifest.entry)}).default;
    if (!experience || experience.id !== ${JSON.stringify(manifest.id)}) throw new Error("既定exportのidが experience.json と一致しません");
    const runtime = load("@rpg/runtime/experience").mountExperience;
    const save = ${options.memorySave ? `(() => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; })()` : "undefined"};
    runtime(document.getElementById("experience-root"), experience, {
      projectId: ${JSON.stringify(manifest.id)}, args: ${JSON.stringify(manifest.args)},
      saveEnabled: ${JSON.stringify(manifest.save.enabled)}, autosave: ${JSON.stringify(manifest.save.autosave)},
      ...(save ? { storage: save } : {}),
      assetUrl: id => (${JSON.stringify(assetUrls)})[id] || undefined,
    });
    ${options.registerServiceWorker ? `if ("serviceWorker" in navigator) void navigator.serviceWorker.register("./sw.js").catch(() => undefined);` : ""}
    try { parent.postMessage({ type: "experience-started" }, "*"); } catch {}
  } catch (error) { sendError(error); }
})();
`;
  return { bundle, manifest, assets };
}

export function experiencePreviewDocument(token: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline' blob:; connect-src 'none'; object-src 'none'; form-action 'none'"><style>html,body,#experience-root{margin:0;min-height:100%;width:100%;}body{min-height:100dvh;background:#101315;color:#f5f0df}#experience-root{min-height:100dvh}</style></head><body><div id="experience-root"></div><script>
const token=${JSON.stringify(token)};
addEventListener("error", e=>parent.postMessage({type:"experience-error",detail:e.message||"試遊中にエラーが発生しました"},"*"));
addEventListener("unhandledrejection", e=>parent.postMessage({type:"experience-error",detail:String(e.reason)},"*"));
addEventListener("message", e=>{if(e.source!==parent||e.data?.token!==token||e.data?.type!=="start"||typeof e.data.bundle!=="string")return;const blob=URL.createObjectURL(new Blob([e.data.bundle],{type:"text/javascript"}));const script=document.createElement("script");script.src=blob;script.onerror=()=>parent.postMessage({type:"experience-error",detail:"試遊コードを読み込めません"},"*");document.head.append(script);});
</script></body></html>`;
}

async function assetData(asset: AssetManifest["assets"][number], files: Record<string, Blob>): Promise<Uint8Array | undefined> {
  const blob = files[asset.path];
  if (blob) return new Uint8Array(await blob.arrayBuffer());
  const url = sampleAssetUrl(asset.path);
  if (!url) return undefined;
  const response = await fetch(url);
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
}

function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function experiencePreviewPayload(texts: Record<string, string>, files: Record<string, Blob>) {
  const { assets } = parseProject(texts);
  const assetUrls: Record<string, string> = {};
  for (const asset of assets.assets) {
    const bytes = await assetData(asset, files);
    if (!bytes) throw new Error(`素材ファイルがありません: ${asset.path}`);
    assetUrls[asset.id] = dataUrl(bytes, asset.mimeType);
  }
  return compileExperienceBundle(texts, assetUrls, { memorySave: true });
}

function creditsMarkdown(title: string, assets: AssetManifest): string {
  const credits = assets.assets.flatMap(asset => asset.credit ? [`- ${asset.credit}`] : []);
  if (assets.assets.some(asset => !asset.redistributable || asset.sourceId === "dova-syndrome")) credits.push("- 収録素材ファイルの抽出・転用・再配布は禁止です。各素材の利用条件を守ってください。");
  const rows = assets.assets.map(asset => `| ${asset.id} | ${asset.kind} | ${asset.author ?? ""} | ${asset.license} | ${asset.url ?? asset.sourceId ?? asset.source} | ${asset.termsCheckedAt ?? ""} |`);
  return `# ${title} — クレジット\n\n${credits.length ? credits.join("\n") : "素材の個別クレジットはありません。"}\n\n## 素材一覧\n\n| ID | 種類 | 作者 | 規約・ライセンス | 入手元 | 規約確認日 |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n\nMade with RPGシステム工房\n`;
}

const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Build a static, self-contained game ZIP in the browser. No paid build service is used. */
export async function experiencePlayableZip(texts: Record<string, string>, files: Record<string, Blob>): Promise<{ bytes: Uint8Array; name: string; files: number; totalBytes: number }> {
  const { manifest, assets } = parseProject(texts);
  if (manifest.runtime === "static") return staticExperienceZip(texts, files, manifest, assets);
  const assetUrls = Object.fromEntries(assets.assets.map(asset => [asset.id, asset.path]));
  const compiled = await compileExperienceBundle(texts, assetUrls, { registerServiceWorker: true });
  const title = esc(manifest.title);
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' https: blob: data:; media-src 'self' https: blob: data:; font-src 'self' https: data:; worker-src 'self' blob:; style-src 'self' https: 'unsafe-inline'; script-src 'self'; connect-src 'self' https: wss: http://localhost:* ws://localhost:*"><title>${title}</title><link rel="manifest" href="./manifest.webmanifest"><link rel="icon" href="./icon.svg" type="image/svg+xml"><meta name="theme-color" content="#101315"><style>html,body,#experience-root{margin:0;min-height:100%;width:100%;}html,body{min-height:100dvh;background:#101315;color:#f5f0df}#experience-root{min-height:100dvh}</style></head><body><div id="experience-root"></div><script type="module" src="./game.js"></script></body></html>`;
  const filesOut: ZipEntry[] = [
    { name: "index.html", data: enc.encode(html) },
    { name: "game.js", data: enc.encode(compiled.bundle) },
    { name: "assets.json", data: enc.encode(`${JSON.stringify(assets, null, 2)}\n`) },
    { name: "CREDITS.md", data: enc.encode(creditsMarkdown(manifest.title, assets)) },
    { name: "README.txt", data: enc.encode(`${manifest.title}\n\n独立作品形式で制作されたブラウザゲームです。RPGの主人公・マップ・HPは使っていません。\n\n遊ぶには Web サーバーに置いて index.html を開きます。ファイルをダブルクリックしただけでは動かない場合があります。\n\n素材のクレジットは CREDITS.md にあります。\n`) },
    { name: "manifest.webmanifest", data: enc.encode(`${JSON.stringify({ name: manifest.title, short_name: [...manifest.title].slice(0, 12).join(""), start_url: "./", scope: "./", display: "standalone", background_color: "#101315", theme_color: "#101315", icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }] }, null, 2)}\n`) },
    { name: "icon.svg", data: enc.encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#101315"/><circle cx="32" cy="32" r="19" fill="#e6b96e"/></svg>\n') },
  ];
  const missing: string[] = [];
  for (const asset of assets.assets) {
    const bytes = await assetData(asset, files);
    if (bytes) filesOut.push({ name: asset.path, data: bytes });
    else missing.push(asset.path);
  }
  if (missing.length) throw new Error(`素材ファイルがありません: ${missing.join(", ")}`);
  const paths = filesOut.map(entry => entry.name);
  if (new Set(paths).size !== paths.length) throw new Error("出力ZIP内でファイル名が重複しています");
  const serviceWorker = `const CACHE=${JSON.stringify(`experience-${manifest.id}`)};const FILES=${JSON.stringify(paths.map(path => `./${path}`))};self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("fetch",e=>{if(e.request.method!=="GET"||new URL(e.request.url).origin!==location.origin)return;e.respondWith(fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE).then(c=>c.put(e.request,r.clone()));return r}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||Response.error())))});`;
  filesOut.push({ name: "sw.js", data: enc.encode(serviceWorker) });
  const bytes = writeZip(filesOut);
  const packed = await readZip(bytes);
  const required = ["index.html", "game.js", "assets.json", "CREDITS.md", "README.txt"];
  if (required.some(name => !packed.some(entry => entry.name === name))) throw new Error("ゲームZIPに必要なファイルがありません");
  return { bytes, name: `${manifest.id}-game.zip`, files: filesOut.length, totalBytes: filesOut.reduce((sum, entry) => sum + entry.data.byteLength, 0) };
}

function isSafeStaticPath(path: string): boolean {
  return path.length > 0 && path.length < 300 && !path.includes("\\") && !path.includes("\0") && !path.startsWith("/")
    && !/^[a-z]:/i.test(path) && path.split("/").every(part => part !== "" && part !== "." && part !== "..");
}

function isToolingPath(path: string): boolean {
  const parts = path.split("/");
  return parts.some(part => [".git", "node_modules", ".rpg-studio", ".rpg-backup"].includes(part))
    || parts.some(part => part === ".env" || part.startsWith(".env."));
}

/** Package a creator-owned site with every relative file unchanged; do not inject a Studio runtime. */
async function staticExperienceZip(
  texts: Record<string, string>, files: Record<string, Blob>, manifest: ExperienceProject, assets: AssetManifest,
): Promise<{ bytes: Uint8Array; name: string; files: number; totalBytes: number }> {
  const output: ZipEntry[] = [];
  const names = new Set<string>();
  const add = (name: string, data: Uint8Array) => {
    if (!isSafeStaticPath(name)) throw new Error(`ZIP内に使えないパスがあります: ${name}`);
    if (isToolingPath(name)) return;
    if (names.has(name)) throw new Error(`ZIP内でファイル名が重複しています: ${name}`);
    names.add(name);
    output.push({ name, data });
  };
  const prefix = manifest.build ? `${manifest.build.outputDir}/` : "";
  const outputName = (name: string) => {
    if (!prefix) return name;
    return name.startsWith(prefix) ? name.slice(prefix.length) : null;
  };
  for (const [name, text] of Object.entries(texts).sort(([a], [b]) => a.localeCompare(b))) {
    const relative = outputName(name);
    if (relative) add(relative, enc.encode(text));
  }
  for (const [name, blob] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const relative = outputName(name);
    if (relative) add(relative, new Uint8Array(await blob.arrayBuffer()));
  }
  if (!names.has("index.html")) throw new Error("static runtime のZIPにはルート直下の index.html が必要です");
  const missing: string[] = [];
  for (const asset of assets.assets) {
    if (names.has(asset.path)) continue;
    const bytes = await assetData(asset, files);
    if (bytes) add(asset.path, bytes); else missing.push(asset.path);
  }
  if (missing.length) throw new Error(`素材ファイルがありません: ${missing.join(", ")}`);
  const bytes = writeZip(output);
  const packed = await readZip(bytes);
  if (!packed.some(entry => entry.name === "index.html")) throw new Error("出力ZIPに index.html がありません");
  return { bytes, name: `${manifest.id}-site.zip`, files: output.length, totalBytes: output.reduce((sum, entry) => sum + entry.data.byteLength, 0) };
}

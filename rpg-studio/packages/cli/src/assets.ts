/**
 * `rpg asset …` and `rpg art …`: adding assets with provenance, generating original sounds,
 * budgets, credits and image requirements. All non-interactive so agents can drive them.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  ArtRequestBundleSchema, AssetEntrySchema, AssetManifestSchema, IdSchema, isSourceEnabled, SOURCE_CATALOG_NOTE, sourcesFor,
  type ArtRequest, type AssetEntry, type ProjectManifest,
} from "../../schema/src/index";
import { encodeWav, presetParams, renderSfx, SFX_PRESETS, type SfxPreset } from "../../runtime/src/sfx";
import { creditLines } from "../../runtime/src/credits";
import { artPrompt } from "../../schema/src/art";
import { loadProjectFromDisk, resolveInside } from "./load";

type Flags = Record<string, string | boolean>;
const str = (flags: Flags, key: string) => (typeof flags[key] === "string" ? (flags[key] as string) : undefined);
const MB = 1024 * 1024;

async function readJson<T>(file: string): Promise<T> { return JSON.parse(await fs.readFile(file, "utf8")) as T; }
async function writeJson(file: string, value: unknown) { await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }

async function manifest(root: string) {
  const project = await readJson<Record<string, unknown>>(path.join(root, "project.json"));
  const { ProjectManifestSchema } = await import("../../schema/src/index");
  return { raw: project, parsed: ProjectManifestSchema.parse(project) as ProjectManifest };
}

export function sniff(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return { mime: "image/png", ext: ".png" };
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE") return { mime: "audio/wav", ext: ".wav" };
  if (bytes.subarray(0, 4).toString("ascii") === "OggS") return { mime: "audio/ogg", ext: ".ogg" };
  if (bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return { mime: "audio/mpeg", ext: ".mp3" };
  return null;
}

export function pngInfo(bytes: Buffer): { width: number; height: number; alpha: boolean } | null {
  if (sniff(bytes)?.mime !== "image/png") return null;
  const colorType = bytes[25]!;
  // Colour type 6 (RGBA) / 4 (grey+alpha) have alpha; palette images may have a tRNS chunk.
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), alpha: colorType === 6 || colorType === 4 || bytes.includes(Buffer.from("tRNS")) };
}

const FOLDERS: Record<AssetEntry["kind"], string> = {
  tileset: "assets/tilesets", character: "assets/characters", enemy: "assets/enemies", animation: "assets/animations",
  portrait: "assets/portraits", background: "assets/backgrounds", bgm: "assets/audio/bgm", sfx: "assets/audio/sfx", song: "assets/audio/songs",
};

async function addEntry(root: string, entry: AssetEntry, replace: boolean): Promise<void> {
  const { raw } = await manifest(root);
  const file = path.join(root, raw.assetsPath as string);
  const assets = await readJson<{ formatVersion: number; assets: AssetEntry[] }>(file);
  const index = assets.assets.findIndex(a => a.id === entry.id);
  if (index >= 0 && !replace) throw new Error(`素材ID '${entry.id}' は既にあります（置き換えるなら --replace）`);
  if (index >= 0) assets.assets[index] = entry; else assets.assets.push(entry);
  await writeJson(file, assets);
}

export async function cmdAsset(sub: string | undefined, root: string, flags: Flags): Promise<number> {
  switch (sub) {
    case "sources": return sources(root);
    case "find": return find(root, flags);
    case "enable": case "disable": return toggle(root, str(flags, "source") ?? str(flags, "id"), sub === "enable");
    case "add": return addAsset(root, flags);
    case "gen-sfx": return genSfx(root, flags);
    case "report": return report(root);
    case "credits": { const loaded = await loadProjectFromDisk(root); if (!loaded.content) { console.log("FAILED: validate のエラーを直してください"); return 1; } console.log(creditLines(loaded.content).join("\n")); return 0; }
    default:
      console.log(`rpg asset sources|enable|disable|add|gen-sfx|report|credits --project <dir>
  find --kind <bgm|sfx|image|tile|character|enemy|background|voice|font> --words "<言葉>" [--all] [--json]
                                  AIが会話で候補を出す用: 内蔵素材・取得元の検索URL・試聴の仕方・条件をまとめて表示
  sources                         取得元カタログ（規約の要点・チェック項目・このプロジェクトでの有効/無効）
  enable|disable --source <id>    取得元を有効/無効にする
  add --file <path> --id <id> --kind <kind> [--source <id> --url <ページ> --license <規約名> --terms-checked YYYY-MM-DD
      --author <作者> --credit <表記> --credit-required --no-redistribute --notes <作者の発言など> --license-url <url>]
      [--tile 64x64 --columns 4 --rows 4 --frame-ms 160] [--volume 0.8 --no-loop] [--request <art request id>] [--replace]
  gen-sfx --preset <${SFX_PRESETS.join("|")}> --id <id> [--seed 1] [--cue confirm]   オリジナル効果音を生成して登録
  report                          容量予算・取得元・クレジット・規約確認の一覧
  credits                         クレジット表記`);
      return sub ? 2 : 0;
  }
}

async function sources(root: string): Promise<number> {
  const { parsed } = await manifest(root);
  console.log(`# 取得元カタログ\n${SOURCE_CATALOG_NOTE}\n`);
  for (const source of sourcesFor(parsed)) {
    const on = isSourceEnabled(parsed, source);
    console.log(`${on ? "[ON ]" : "[OFF]"} ${source.id} — ${source.name}（${source.categories.join("/")}・${source.origin}）`);
    console.log(`      規約: ${source.termsUrl ?? source.url ?? "（生成）"}  確認済み: ${source.verifiedAt ?? "未照合"}  クレジット: ${source.creditRequired}  テンプレートへの再配布: ${source.redistribution}  自動取得: ${source.automatedDownload}`);
    console.log(`      ${source.summary}`);
    for (const item of source.checklist) console.log(`      □ ${item}`);
    if (source.notes) console.log(`      注: ${source.notes}`);
  }
  console.log(`\n優先: ${JSON.stringify(parsed.assetPolicy.prefer)}　共有用プロジェクト: ${parsed.assetPolicy.shareable}`);
  return 0;
}

async function toggle(root: string, id: string | undefined, enabled: boolean): Promise<number> {
  if (!id) { console.log("ERROR --source <id> を指定してください"); return 2; }
  const { raw, parsed } = await manifest(root);
  if (!sourcesFor(parsed).some(s => s.id === id)) { console.log(`ERROR 取得元 '${id}' はカタログにありません（rpg asset sources で一覧）`); return 1; }
  const policy = (raw.assetPolicy ??= {}) as { sources?: Record<string, boolean> };
  policy.sources = { ...policy.sources, [id]: enabled };
  await writeJson(path.join(root, "project.json"), raw);
  console.log(`OK ${id} を${enabled ? "有効" : "無効"}にしました`);
  return 0;
}

/**
 * `rpg asset add`: copies a file into the project and registers it with provenance, after the budget,
 * source and schema checks. `extra` lets other commands (rpg library add) record more manifest fields.
 */
export async function addAsset(root: string, flags: Flags, extra: Partial<AssetEntry> = {}): Promise<number> {
  const file = str(flags, "file"), id = str(flags, "id"), kind = str(flags, "kind") as AssetEntry["kind"] | undefined;
  if (!file || !id || !kind) { console.log("ERROR --file, --id, --kind が必要です"); return 2; }
  if (!IdSchema.safeParse(id).success) { console.log("ERROR --id は英数字と ._- で指定してください"); return 2; }
  const { parsed } = await manifest(root);
  const bytes = await fs.readFile(path.resolve(file));
  const kindOfFile = kind === "song" ? { mime: "application/json", ext: ".song.json" } : sniff(bytes);
  if (!kindOfFile) { console.log("ERROR 対応していないファイル形式です（PNG / OGG / MP3 / WAV / .song.json）"); return 1; }
  const isImage = kindOfFile.mime === "image/png";
  if (isImage !== !["bgm", "sfx", "song"].includes(kind)) { console.log(`ERROR --kind ${kind} に ${kindOfFile.mime} は使えません`); return 1; }
  const limit = parsed.assetPolicy.budget.maxFileMB * MB;
  if (bytes.length > limit) { console.log(`ERROR ファイルが ${parsed.assetPolicy.budget.maxFileMB}MB を超えています（${(bytes.length / MB).toFixed(1)}MB）。音声はOGG 96〜128kbps、画像は減色・分割を検討してください`); return 1; }

  const sourceId = str(flags, "source");
  const source = sourceId ? sourcesFor(parsed).find(s => s.id === sourceId) : undefined;
  if (sourceId && !source) { console.log(`ERROR 取得元 '${sourceId}' はカタログにありません`); return 1; }
  if (source && !isSourceEnabled(parsed, source)) { console.log(`ERROR 取得元「${source.name}」はこのプロジェクトで無効です（rpg asset enable --source ${source.id}）`); return 1; }
  const origin = (str(flags, "origin") ?? (source ? source.origin : "original")) as AssetEntry["origin"];
  if (source && source.redistribution === "prohibited" && parsed.assetPolicy.shareable) { console.log(`ERROR 共有用プロジェクトに「${source.name}」の素材は入れられません（再配布禁止）`); return 1; }

  const relative = `${FOLDERS[kind]}/${id}${kindOfFile.ext}`;
  const target = resolveInside(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const raw: Record<string, unknown> = {
    id, path: relative, kind, mimeType: kindOfFile.mime, bytes: bytes.length,
    source: source?.name ?? (origin === "generated" ? "生成" : "自作"),
    license: str(flags, "license") ?? (source?.origin === "generated" ? "プロジェクト内素材" : "プロジェクト内素材"),
    origin, ...(sourceId ? { sourceId } : {}),
    ...(str(flags, "url") ? { url: str(flags, "url") } : {}),
    ...(str(flags, "author") ? { author: str(flags, "author") } : {}),
    ...(str(flags, "license-url") ? { licenseUrl: str(flags, "license-url") } : {}),
    ...(str(flags, "credit") ? { credit: str(flags, "credit") } : {}),
    creditRequired: Boolean(flags["credit-required"]),
    redistributable: !flags["no-redistribute"] && source?.redistribution !== "prohibited",
    ...(str(flags, "terms-checked") ? { termsCheckedAt: str(flags, "terms-checked") } : {}),
    ...(str(flags, "notes") ? { notes: str(flags, "notes") } : {}),
    ...(str(flags, "request") ? { request: str(flags, "request") } : {}),
    ...(origin === "generated" ? { generator: { tool: str(flags, "generator") ?? source?.name ?? "unknown", ...(str(flags, "prompt") ? { prompt: str(flags, "prompt") } : {}) } } : {}),
  };
  if (isImage) {
    const info = pngInfo(bytes)!;
    const [tw, th] = (str(flags, "tile") ?? "64x64").split("x").map(Number);
    raw.tileWidth = tw; raw.tileHeight = th;
    raw.columns = Number(str(flags, "columns") ?? Math.max(1, Math.floor(info.width / tw!)));
    raw.rows = Number(str(flags, "rows") ?? Math.max(1, Math.floor(info.height / th!)));
    if (str(flags, "frame-ms")) raw.frameDurationMs = Number(str(flags, "frame-ms"));
  } else if (kind !== "song") {
    raw.loop = kind === "bgm" ? !flags["no-loop"] : false;
    if (str(flags, "volume")) raw.initialVolume = Number(str(flags, "volume"));
  }
  Object.assign(raw, extra);
  const parsedEntry = AssetEntrySchema.safeParse(raw);
  const checked = AssetManifestSchema.safeParse({ formatVersion: 1, assets: [raw] });
  if (parsedEntry.success && !checked.success) { for (const issue of checked.error.issues) console.log(`ERROR ${issue.path.slice(2).join(".")}: ${issue.message}`); console.log("FAILED asset add: 何も書き込んでいません"); return 1; }
  if (!parsedEntry.success) { for (const issue of parsedEntry.error.issues) console.log(`ERROR ${issue.path.join(".")}: ${issue.message}`); console.log("FAILED asset add: 何も書き込んでいません"); return 1; }
  await fs.copyFile(path.resolve(file), target);
  await addEntry(root, parsedEntry.data, Boolean(flags.replace));
  if (source?.checklist.length) { console.log(`確認事項（${source.name}）:`); for (const item of source.checklist) console.log(`  □ ${item}`); }
  console.log(`OK asset add: ${relative}（${(bytes.length / 1024).toFixed(1)}KB）。続けて pnpm rpg validate で確認してください`);
  return 0;
}

async function genSfx(root: string, flags: Flags): Promise<number> {
  const preset = str(flags, "preset") as SfxPreset | undefined;
  const id = str(flags, "id") ?? (preset ? `sfx-${preset}` : undefined);
  if (!preset || !SFX_PRESETS.includes(preset) || !id) { console.log(`ERROR --preset ${SFX_PRESETS.join("|")} と --id を指定してください`); return 2; }
  const seed = Number(str(flags, "seed") ?? 1);
  const wav = Buffer.from(encodeWav(renderSfx(presetParams(preset, seed), 22050, seed)));
  const relative = `${FOLDERS.sfx}/${id}.wav`;
  const target = resolveInside(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, wav);
  await addEntry(root, AssetEntrySchema.parse({
    id, path: relative, kind: "sfx", mimeType: "audio/wav", bytes: wav.length, source: "内蔵効果音ジェネレーター", license: "プロジェクト内素材（オリジナル生成）",
    origin: "generated", sourceId: "builtin-sfx", generator: { tool: "rpg asset gen-sfx", preset, seed }, loop: false,
  }), Boolean(flags.replace) || true);
  const cue = str(flags, "cue");
  if (cue) {
    const { raw } = await manifest(root);
    const audio = (raw.audio ??= {}) as { sfx?: Record<string, string> };
    audio.sfx = { ...audio.sfx, [cue]: id };
    await writeJson(path.join(root, "project.json"), raw);
  }
  console.log(`OK gen-sfx: ${relative}（${(wav.length / 1024).toFixed(1)}KB, preset ${preset}, seed ${seed}${cue ? `, cue ${cue}` : ""}）`);
  return 0;
}

export async function projectSize(root: string): Promise<{ total: number; byKind: Record<string, number>; largest: Array<{ path: string; bytes: number }> }> {
  const loaded = await loadProjectFromDisk(root);
  const byKind: Record<string, number> = {};
  const files: Array<{ path: string; bytes: number }> = [];
  for (const [rel, text] of Object.entries(loaded.texts)) { const b = Buffer.byteLength(text); byKind.data = (byKind.data ?? 0) + b; files.push({ path: rel, bytes: b }); }
  for (const asset of loaded.content?.assets.assets ?? []) {
    try { const stat = await fs.stat(resolveInside(root, asset.path)); byKind[asset.kind] = (byKind[asset.kind] ?? 0) + stat.size; files.push({ path: asset.path, bytes: stat.size }); } catch { /* reported by validate */ }
  }
  return { total: files.reduce((s, f) => s + f.bytes, 0), byKind, largest: files.sort((a, b) => b.bytes - a.bytes).slice(0, 5) };
}

async function report(root: string): Promise<number> {
  const loaded = await loadProjectFromDisk(root);
  if (!loaded.content) { console.log("FAILED: validate のエラーを直してください"); return 1; }
  const { project, assets } = loaded.content;
  const size = await projectSize(root);
  const budget = project.assetPolicy.budget;
  const pct = (size.total / (budget.maxTotalMB * MB)) * 100;
  console.log(`# 容量: ${(size.total / MB).toFixed(2)}MB / 上限 ${budget.maxTotalMB}MB（${pct.toFixed(1)}%）、警告 ${budget.warnTotalMB}MB、1ファイル上限 ${budget.maxFileMB}MB`);
  for (const [kind, bytes] of Object.entries(size.byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${kind.padEnd(10)} ${(bytes / 1024).toFixed(1)}KB`);
  console.log("  大きいファイル: " + size.largest.map(f => `${f.path} ${(f.bytes / 1024).toFixed(0)}KB`).join(" ／ "));
  console.log("\n# 素材の出どころ");
  const sources = sourcesFor(project);
  for (const a of assets.assets) {
    const source = a.sourceId ? sources.find(s => s.id === a.sourceId) : undefined;
    const flagsText = [a.creditRequired ? "クレジット必須" : "", a.redistributable ? "" : "再配布不可", a.termsCheckedAt ? `規約確認 ${a.termsCheckedAt}` : a.origin === "site" || a.origin === "purchased" || a.origin === "commission" ? "規約未確認!" : ""].filter(Boolean).join("・");
    console.log(`  ${a.id.padEnd(22)} ${a.kind.padEnd(9)} ${a.origin.padEnd(10)} ${source?.name ?? a.source}${flagsText ? `（${flagsText}）` : ""}`);
  }
  console.log("\n# クレジット\n" + creditLines(loaded.content).map(l => `  ${l}`).join("\n"));
  return 0;
}

/* ------------------------------------------------------------------ art requests */

export async function loadArtRequests(root: string): Promise<ArtRequest[]> {
  try { return ArtRequestBundleSchema.parse(await readJson(path.join(root, "art/requests.json"))).requests; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export async function cmdArt(sub: string | undefined, root: string, flags: Flags): Promise<number> {
  const requests = await loadArtRequests(root);
  const id = str(flags, "id");
  if (sub === "list") {
    for (const r of requests) console.log(`${r.status.padEnd(11)} ${r.id.padEnd(22)} ${r.kind.padEnd(10)} ${r.mode.padEnd(10)} ${r.title}${r.assetId ? ` → ${r.assetId}` : ""}`);
    if (!requests.length) console.log("art/requests.json に依頼がありません");
    return 0;
  }
  const request = requests.find(r => r.id === id);
  if ((sub === "prompt" || sub === "check") && !request) { console.log(`ERROR 依頼 '${id ?? ""}' が art/requests.json にありません（rpg art list）`); return 1; }
  if (sub === "prompt") {
    const guide = await fs.readFile(path.join(root, "art/style-guide.md"), "utf8").catch(() => "（art/style-guide.md がありません）");
    console.log(artPrompt(request!, guide));
    return 0;
  }
  if (sub === "check") {
    const file = str(flags, "file");
    if (!file) { console.log("ERROR --file を指定してください"); return 2; }
    const info = pngInfo(await fs.readFile(path.resolve(file)));
    if (!info) { console.log("ERROR PNGではありません"); return 1; }
    const s = request!.spec;
    const problems: string[] = [];
    if (info.width !== s.cellWidth * s.columns || info.height !== s.cellHeight * s.rows) problems.push(`サイズ ${info.width}×${info.height} が仕様 ${s.cellWidth * s.columns}×${s.cellHeight * s.rows} と違います`);
    if (s.transparent && !info.alpha) problems.push("背景透過（アルファ）がありません");
    for (const p of problems) console.log(`ERROR ${p}`);
    if (problems.length) return 1;
    console.log(`OK art check: ${file} は「${request!.title}」の仕様に合っています。登録: pnpm rpg asset add --file ${file} --id ${request!.assetId ?? request!.id} --kind ${request!.kind} --origin generated --source ai-image --request ${request!.id} --tile ${s.cellWidth}x${s.cellHeight} --columns ${s.columns} --rows ${s.rows}`);
    return 0;
  }
  console.log("rpg art list|prompt --id <依頼>|check --id <依頼> --file <png> --project <dir>");
  return sub ? 2 : 0;
}

/* ------------------------------------------------------------------ find: candidates for a chat */

const FIND_KINDS: Record<string, "image" | "bgm" | "sfx" | "voice" | "font"> = {
  image: "image", tile: "image", tiles: "image", tileset: "image", character: "image", chara: "image", enemy: "image", monster: "image", background: "image", bg: "image",
  bgm: "bgm", music: "bgm", song: "bgm", sfx: "sfx", se: "sfx", sound: "sfx", voice: "voice", font: "font",
};
const INTEGRATION_LABEL = { api: "公式APIあり（検索はAI、選ぶのはあなた）", link: "リンク（ブラウザで聴く・見る→自分でDL）", manual: "購入・依頼（あなたが手続き）", avoid: "このツールでは使わない" } as const;

/**
 * Everything an agent needs to offer choices in the chat without opening the studio: built-in options first,
 * then each enabled source with a search link the person can open to listen / look, the conditions and cautions.
 */
async function find(root: string, flags: Flags): Promise<number> {
  const kindFlag = str(flags, "kind") ?? "";
  const category = FIND_KINDS[kindFlag];
  if (!category) { console.log(`ERROR --kind は ${Object.keys(FIND_KINDS).join(" / ")} のどれか`); return 2; }
  const words = (str(flags, "words") ?? "").trim();
  const { parsed } = await manifest(root);
  const list = sourcesFor(parsed).filter(s => s.categories.includes(category) && (flags.all || s.integration !== "avoid"));
  const enabled = list.filter(s => isSourceEnabled(parsed, s));
  const others = list.filter(s => !isSourceEnabled(parsed, s));
  const linkFor = (s: (typeof list)[number]) => (s.searchUrl && words ? s.searchUrl.replace("{q}", encodeURIComponent(words)) : s.searchUrl?.replace("{q}", "") ?? s.url);
  const builtIn: string[] = [];
  if (category === "image") builtIn.push(`内蔵ライブラリ: pnpm rpg library preview --kind ${["tile", "character", "enemy", "background"].includes(kindFlag) ? kindFlag : "tile"}${words ? ` --query "${words}"` : ""}  → 番号つき見本画像を作って見せる（MIT・クレジット不要・すぐ取り込める）`, "自分で描く: 工房の「ドット絵」画面", "AI画像生成: art/requests.json に依頼を書いて pnpm rpg art prompt");
  if (category === "bgm") builtIn.push("楽譜BGM: AIがオリジナル曲を .song.json で作曲（容量が小さく権利の心配がない。docs/asset-guide.md）");
  if (category === "sfx") builtIn.push(`内蔵効果音: pnpm rpg asset gen-sfx --preset <${SFX_PRESETS.join("|")}> --id <id>（オリジナル・クレジット不要）`);
  if (flags.json) {
    console.log(JSON.stringify({ category, words, builtIn, sources: [...enabled, ...others].map(s => ({ ...s, enabled: isSourceEnabled(parsed, s), link: linkFor(s) })) }, null, 2));
    return 0;
  }
  console.log(`# 「${words || "（言葉なし）"}」の${category}候補の探し方\n`);
  if (builtIn.length) { console.log("## すぐ使える（内蔵）"); for (const line of builtIn) console.log(`- ${line}`); console.log(""); }
  const show = (s: (typeof list)[number], on: boolean) => {
    console.log(`### ${s.name}  [${s.id}]${on ? "" : "  （このプロジェクトでは無効: pnpm rpg asset enable --source " + s.id + "）"}`);
    if (s.integration) console.log(`- 方式: ${INTEGRATION_LABEL[s.integration]}`);
    console.log(`- 開くURL: ${linkFor(s) ?? "（なし）"}`);
    if (s.preview) console.log(`- 試聴・見本: ${s.preview}`);
    console.log(`- クレジット: ${s.creditFormat ?? s.creditRequired}　共有テンプレートへの同梱: ${s.redistribution}`);
    for (const c of s.cautions) console.log(`- ⚠ ${c}`);
    console.log(`- 規約: ${s.termsUrl ?? s.url ?? "（なし）"}（${s.verifiedAt ? `${s.verifiedAt} に原文確認` : s.research?.method === "secondary" ? `要約は${s.research.checkedAt}の二次情報。使う前に原文を確認` : "未照合"}）`);
  };
  if (enabled.length) { console.log("## このプロジェクトで有効な取得元"); for (const s of enabled) show(s, true); console.log(""); }
  if (others.length) { console.log("## ほかの取得元（無効）"); for (const s of others) show(s, false); console.log(""); }
  console.log(`## 進め方（AI向け）
1. 上の候補を、番号と「開くURL」つきで相手に示す。音は判定できないので、必ずURLを開いて聴いてもらう。
2. 相手が選んだ素材の個別ページURLと、ダウンロードしたファイルの場所を聞く（ログインや購入は相手がブラウザで行う。パスワードは預からない）。
3. 規約の原文を開いて条件を確かめ、pnpm rpg asset add --file <ファイル> --id <id> --kind <kind> --source <取得元> --url <個別ページ> --license <名前> --terms-checked <今日> [--credit "<表記>" --credit-required] で登録。
4. pnpm rpg validate → test → build。`);
  return 0;
}


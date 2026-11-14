/**
 * Shared mods: systems / genre modules a creator made, kept in <repo>/mods/<id>/ with a mod.json, and copied into
 * any project with `rpg mod add`. Each project records where its mods came from in mods.json (version, author,
 * licence, hash), so sharing never loses the provenance.
 *
 *   rpg mod list                              mods available in this repository
 *   rpg mod add <id> --project <dir>          copy into <project>/systems/mods/<id>/ and register it
 *   rpg mod export <systemId> --project <dir> [--title …] [--author …] [--license …] [--version …]
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { IdSchema } from "../../schema/src/formats";
import { REPO_ROOT } from "./build";

export const MOD_ROOT = path.join(REPO_ROOT, "mods");

export const ModManifestSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "version は 1.0.0 の形です"),
  description: z.string().default(""),
  author: z.string().min(1),
  /** SPDX id or a short licence statement. */
  license: z.string().min(1),
  /** The file that default-exports defineSystem(...). */
  entry: z.string().regex(/^[\w.-]+\.ts$/),
  /** Every file of the mod (relative, no directories outside the mod). */
  files: z.array(z.string().regex(/^[\w][\w./-]*$/).refine(f => !f.includes(".."), "親ディレクトリは使えません")).min(1),
  /** Genres from docs/genre-atlas.md this mod helps with (free text allowed). */
  genres: z.array(z.string()).default([]),
  /** Variables / flags / sets the mod expects the project to declare. */
  requires: z.object({ flags: z.array(IdSchema).default([]), variables: z.array(IdSchema).default([]), sets: z.array(IdSchema).default([]) }).strict().default({ flags: [], variables: [], sets: [] }),
  usage: z.string().default(""),
}).strict();
export type ModManifest = z.infer<typeof ModManifestSchema>;

const LockSchema = z.record(IdSchema, z.object({ version: z.string(), source: z.string(), author: z.string(), license: z.string(), sha256: z.string(), addedAt: z.string() }).strict());

async function readJson(file: string): Promise<unknown> { return JSON.parse(await fs.readFile(file, "utf8")); }
async function isPlainFile(file: string) { const st = await fs.lstat(file).catch(() => null); return Boolean(st?.isFile() && !st.isSymbolicLink()); }

export async function listMods(root = MOD_ROOT): Promise<Array<{ manifest?: ModManifest; dir: string; errors: string[] }>> {
  const names = await fs.readdir(root).catch(() => [] as string[]);
  const out = [];
  for (const name of names.sort()) {
    const dir = path.join(root, name);
    if (!(await fs.stat(dir)).isDirectory()) continue;
    const r = ModManifestSchema.safeParse(await readJson(path.join(dir, "mod.json")).catch(() => null));
    if (!r.success) { out.push({ dir, errors: r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) }); continue; }
    const errors: string[] = [];
    if (r.data.id !== name) errors.push(`フォルダ名 '${name}' と id '${r.data.id}' が違います`);
    if (!r.data.files.includes(r.data.entry)) errors.push(`entry '${r.data.entry}' が files にありません`);
    for (const f of r.data.files) if (!(await isPlainFile(path.join(dir, f)))) errors.push(`ファイル '${f}' がない（またはシンボリックリンク）`);
    out.push({ manifest: r.data, dir, errors });
  }
  return out;
}

async function hashFiles(dir: string, files: string[]) {
  const h = crypto.createHash("sha256");
  for (const f of [...files].sort()) { h.update(f); h.update(await fs.readFile(path.join(dir, f))); }
  return h.digest("hex");
}

export async function addMod(id: string, projectDir: string, opts: { force?: boolean; root?: string; today?: string } = {}): Promise<string[]> {
  const mod = (await listMods(opts.root)).find(m => m.manifest?.id === id || path.basename(m.dir) === id);
  if (!mod?.manifest) throw new Error(`mod '${id}' がありません（rpg mod list）`);
  if (mod.errors.length) throw new Error(`mod '${id}' に問題があります: ${mod.errors.join(" / ")}`);
  const m = mod.manifest;
  const projectFile = path.join(projectDir, "project.json");
  const project = (await readJson(projectFile)) as { systems?: Array<{ id: string; path: string; title: string }>; flags?: Record<string, unknown>; variables?: Record<string, unknown>; sets?: Record<string, unknown> };
  const systems = project.systems ?? [];
  const existing = systems.find(s => s.id === m.id);
  if (existing && !existing.path.startsWith(`systems/mods/${m.id}/`)) throw new Error(`プロジェクトにすでに別のシステム '${m.id}' があります`);
  if (existing && !opts.force) throw new Error(`mod '${m.id}' はもう入っています。更新するなら --force`);
  const target = path.join(projectDir, "systems", "mods", m.id);
  await fs.rm(target, { recursive: true, force: true });
  for (const f of m.files) { await fs.mkdir(path.dirname(path.join(target, f)), { recursive: true }); await fs.copyFile(path.join(mod.dir, f), path.join(target, f)); }
  await fs.copyFile(path.join(mod.dir, "mod.json"), path.join(target, "mod.json"));
  const entry = { id: m.id, path: `systems/mods/${m.id}/${m.entry}`, title: `${m.title}（mod ${m.version}）` };
  project.systems = existing ? systems.map(s => (s.id === m.id ? entry : s)) : [...systems, entry];
  await fs.writeFile(projectFile, `${JSON.stringify(project, null, 2)}\n`);
  const lockFile = path.join(projectDir, "mods.json");
  const lock = LockSchema.parse(await readJson(lockFile).catch(() => ({})));
  lock[m.id] = { version: m.version, source: `mods/${m.id}`, author: m.author, license: m.license, sha256: await hashFiles(mod.dir, m.files), addedAt: opts.today ?? new Date().toISOString().slice(0, 10) };
  await fs.writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  const notes: string[] = [];
  for (const f of m.requires.flags) if (!project.flags?.[f]) notes.push(`project.json の flags に '${f}' を宣言してください`);
  for (const v of m.requires.variables) if (!project.variables?.[v]) notes.push(`project.json の variables に '${v}' を宣言してください`);
  for (const s of m.requires.sets) if (!project.sets?.[s]) notes.push(`project.json の sets に '${s}' を宣言してください`);
  return notes;
}

export async function exportMod(systemId: string, projectDir: string, meta: { title?: string; author?: string; license?: string; version?: string; root?: string }): Promise<string> {
  const project = (await readJson(path.join(projectDir, "project.json"))) as { systems?: Array<{ id: string; path: string; title: string }> };
  const sys = project.systems?.find(s => s.id === systemId);
  if (!sys) throw new Error(`プロジェクトにシステム '${systemId}' がありません`);
  if (!meta.author || !meta.license) throw new Error("--author と --license を指定してください（共有するときの出どころと利用条件）");
  const src = path.join(projectDir, sys.path);
  if (!(await isPlainFile(src))) throw new Error(`${sys.path} が読めません`);
  const text = await fs.readFile(src, "utf8");
  if (/from\s+["']\.\.?\//.test(text)) throw new Error(`${sys.path} が相対パスで別のファイルを読み込んでいます。1ファイルにまとめてから書き出してください`);
  const dir = path.join(meta.root ?? MOD_ROOT, systemId);
  await fs.mkdir(dir, { recursive: true });
  const entry = path.basename(sys.path);
  await fs.writeFile(path.join(dir, entry), text);
  const manifest: ModManifest = ModManifestSchema.parse({ id: systemId, title: meta.title ?? sys.title, version: meta.version ?? "1.0.0", author: meta.author, license: meta.license, entry, files: [entry], description: sys.title });
  await fs.writeFile(path.join(dir, "mod.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

export async function cmdMod(sub: string | undefined, projectDir: string, flags: Record<string, string | boolean>, rest: string | undefined): Promise<number> {
  const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
  try {
    if (sub === "list" || !sub) {
      const mods = await listMods();
      if (!mods.length) console.log("mods/ にまだ mod がありません（rpg mod export で作れます）");
      for (const m of mods) {
        if (m.manifest) console.log(`${m.manifest.id} ${m.manifest.version} — ${m.manifest.title}（${m.manifest.author}・${m.manifest.license}）${m.manifest.genres.length ? `［${m.manifest.genres.join("・")}］` : ""}\n    ${m.manifest.description}`);
        for (const e of m.errors) console.log(`ERROR ${path.relative(REPO_ROOT, m.dir)}: ${e}`);
      }
      return mods.some(m => m.errors.length) ? 1 : 0;
    }
    if (sub === "add") {
      const id = rest ?? str("id");
      if (!id) { console.error("ERROR rpg mod add <id> --project <dir>"); return 2; }
      const notes = await addMod(id, projectDir, { force: Boolean(flags.force) });
      for (const n of notes) console.log(`WARN ${n}`);
      console.log(`OK mod add: ${id} → ${path.relative(process.cwd(), path.join(projectDir, "systems", "mods", id))}（出どころは mods.json）`);
      return 0;
    }
    if (sub === "export") {
      const id = rest ?? str("system");
      if (!id) { console.error("ERROR rpg mod export <systemId> --project <dir> --author <名前> --license <利用条件>"); return 2; }
      const dir = await exportMod(id, projectDir, { title: str("title"), author: str("author"), license: str("license"), version: str("version") });
      console.log(`OK mod export: ${path.relative(process.cwd(), dir)}`);
      return 0;
    }
    console.error("ERROR rpg mod <list|add|export>");
    return 2;
  } catch (error) {
    console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

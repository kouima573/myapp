/**
 * Save history (roadmap 016) and plain-language change summaries (007).
 *
 * Every time a project text file changes — saved from the studio or rewritten outside (an AI, an editor) —
 * the previous content is kept under <repo>/.rpg-studio/history/<project>/ so it can be restored later.
 * The summary says *what* changed in game terms ("敵 slime を追加", "gold: 10 → 20") instead of a raw diff.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { summarizeChange } from "./summary";
export { summarizeChange } from "./summary";

export interface HistoryEntry {
  id: string;
  file: string;
  at: string;
  /** studio = saved from the studio, outside = changed by another program, restore = put back from history. */
  source: "studio" | "outside" | "restore";
  /** sha256 of the content before the change ("" = the file did not exist). */
  beforeHash: string;
  afterHash: string;
  summary: string[];
}

const MAX_ENTRIES = 300;
const sha = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

export class History {
  private entries: HistoryEntry[] = [];
  private loaded = false;
  constructor(private dir: string) {}

  private get indexFile() { return path.join(this.dir, "index.json"); }
  private blob(hash: string) { return path.join(this.dir, "blobs", `${hash}.txt`); }

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try { this.entries = JSON.parse(await fs.readFile(this.indexFile, "utf8")) as HistoryEntry[]; } catch { this.entries = []; }
  }

  async list(file?: string): Promise<HistoryEntry[]> {
    await this.load();
    return [...this.entries].reverse().filter(e => !file || e.file === file);
  }

  /** Keeps `before` (and `after`) so either side can be restored. No entry when nothing changed. */
  async record(file: string, before: string | undefined, after: string | undefined, source: HistoryEntry["source"]): Promise<HistoryEntry | undefined> {
    if (before === after) return undefined;
    await this.load();
    await fs.mkdir(path.join(this.dir, "blobs"), { recursive: true });
    const beforeHash = before === undefined ? "" : sha(before);
    const afterHash = after === undefined ? "" : sha(after);
    if (before !== undefined) await fs.writeFile(this.blob(beforeHash), before, { flag: "w" });
    if (after !== undefined) await fs.writeFile(this.blob(afterHash), after, { flag: "w" });
    const entry: HistoryEntry = { id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`, file, at: new Date().toISOString(), source, beforeHash, afterHash, summary: summarizeChange(file, before, after) };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      const dropped = this.entries.splice(0, this.entries.length - MAX_ENTRIES);
      const alive = new Set(this.entries.flatMap(e => [e.beforeHash, e.afterHash]));
      for (const hash of new Set(dropped.flatMap(e => [e.beforeHash, e.afterHash]))) if (hash && !alive.has(hash)) await fs.rm(this.blob(hash), { force: true });
    }
    await fs.writeFile(this.indexFile, `${JSON.stringify(this.entries, null, 1)}\n`);
    return entry;
  }

  /** Content of one side of an entry ("before" = what the file looked like just before that change). */
  async content(id: string, side: "before" | "after"): Promise<{ entry: HistoryEntry; text: string | undefined } | undefined> {
    await this.load();
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return undefined;
    const hash = side === "before" ? entry.beforeHash : entry.afterHash;
    if (!hash) return { entry, text: undefined };
    return { entry, text: await fs.readFile(this.blob(hash), "utf8") };
  }
}

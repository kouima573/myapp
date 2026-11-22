/**
 * `rpg proofread --project <dir> [--width 40] [--lines 3]` — checks every text shown to players (roadmap 169):
 * lines too wide / too many lines for the message window, doubled punctuation, repeated particles,
 * unbalanced brackets 「」『』（）, text decoration tags left open, stray spaces.
 * Only reports; never rewrites. Exit code 1 when something was found (so an agent can loop until clean).
 */
import { readProjectTexts } from "./load";
import { proofreadText } from "./proofreadText";
export { proofreadText } from "./proofreadText";

const SHOWN = new Set(["text", "lines", "label", "prompt", "name", "description", "greeting", "message", "title", "subtitle", "speaker"]);

export interface ProofIssue { file: string; at: string; text: string; message: string }

function walk(node: unknown, at: string, key: string, file: string, out: ProofIssue[], opts: { width: number; lines: number }) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => {
      const id = child && typeof child === "object" && typeof (child as { id?: unknown }).id === "string" ? (child as { id: string }).id : String(i);
      walk(child, `${at}[${id}]`, key, file, out, opts);
    });
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) walk(v, at ? `${at}.${k}` : k, k, file, out, opts);
    return;
  }
  if (typeof node !== "string" || !SHOWN.has(key) || !node.trim()) return;
  // Messages / dialogue lines go into the message window; names and labels only get the typo checks.
  const message = key === "text" || key === "lines" || key === "prompt" || key === "message" || key === "greeting";
  for (const message_ of proofreadText(node, { ...opts, message })) out.push({ file, at, text: node, message: message_ });
}

export async function proofread(root: string, opts: { width: number; lines: number }): Promise<ProofIssue[]> {
  const { texts } = await readProjectTexts(root);
  const out: ProofIssue[] = [];
  for (const [file, text] of Object.entries(texts)) {
    if (!file.endsWith(".json") || file === "assets.json" || file === "tiles.json") continue;
    try { walk(JSON.parse(text), "", "", file, out, opts); } catch { /* broken JSON: validate reports it */ }
  }
  return out;
}

export async function cmdProofread(flags: Record<string, string | boolean>, root: string): Promise<number> {
  const opts = { width: Number(flags.width) || 40, lines: Number(flags.lines) || 3 };
  const issues = await proofread(root, opts);
  if (!issues.length) { console.log(`OK proofread: 気になる所はありません（1行 全角約${opts.width}字で折り返して${opts.lines}行まで）`); return 0; }
  for (const i of issues) console.log(`WARN ${i.file} › ${i.at}: ${i.message}\n     「${i.text.length > 60 ? `${i.text.slice(0, 57)}…` : i.text}」`);
  console.log(`proofread: ${issues.length}件。直したら pnpm rpg proofread で確かめてください（--width / --lines で基準を変更）`);
  return 1;
}

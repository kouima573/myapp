/**
 * `rpg proofread --project <dir> [--width 40] [--lines 3]` — checks every text shown to players (roadmap 169):
 * lines too wide / too many lines for the message window, doubled punctuation, repeated particles,
 * unbalanced brackets 「」『』（）, text decoration tags left open, stray spaces.
 * Only reports; never rewrites. Exit code 1 when something was found (so an agent can loop until clean).
 */
import { readProjectTexts } from "./load";
import { stripMarkup } from "../../runtime/src/textmarkup";

export interface ProofIssue { file: string; at: string; text: string; message: string }

/** Keys whose string values are shown to players. */
const SHOWN = new Set(["text", "lines", "label", "prompt", "name", "description", "greeting", "message", "title", "subtitle", "speaker"]);
/** Full-width = 1, half-width = 0.5 (roughly how wide the message window is). */
const width = (s: string) => Array.from(s).reduce((w, ch) => w + (/[\u0000-ÿ｡-ﾟ]/.test(ch) ? 0.5 : 1), 0);
const PAIRS: Array<[string, string]> = [["「", "」"], ["『", "』"], ["（", "）"], ["(", ")"], ["【", "】"]];
const PARTICLES = ["のの", "をを", "がが", "でで", "へへ"];

export function proofreadText(text: string, opts: { width: number; lines: number; message: boolean }): string[] {
  const out: string[] = [];
  const plain = stripMarkup(text.replace(/\{\{[^}]*\}\}/g, "〇〇")); // {{name}} etc. counted as 2 letters
  if (opts.message) {
    // The window wraps long rows by itself: count the lines it will really take.
    const lines = plain.split("\n").reduce((n, row) => n + Math.max(1, Math.ceil(width(row) / opts.width)), 0);
    if (lines > opts.lines) out.push(`ウィンドウに収まりません（約${lines}行 > ${opts.lines}行。2つの台詞に分けて）`);
  }
  for (const m of plain.matchAll(/([。、！？!?…])\1{1,}/g)) if (!/^(…+|！+|？+|!+|\?+)$/.test(m[0]) || m[0].length > 3) out.push(`記号の重なり「${m[0]}」`);
  for (const p of PARTICLES) if (plain.replace(/ののし/g, "").includes(p)) out.push(`同じ助詞が続いています「${p}」（誤字かも）`);
  for (const [open, close] of PAIRS) {
    const a = plain.split(open).length - 1, b = plain.split(close).length - 1;
    if (a !== b) out.push(`かっこの数が合いません（${open}${a}個・${close}${b}個）`);
  }
  if (/^[ 　]|[ 　]$/.test(plain)) out.push("先頭か末尾に空白があります");
  for (const tag of ["c", "color", "b", "big", "small", "shake", "wave"]) {
    const opens = (text.match(new RegExp(`\\[${tag}(=[^\\]]+)?\\]`, "g")) ?? []).length, closes = (text.match(new RegExp(`\\[/${tag}\\]`, "g")) ?? []).length;
    if (opens > closes) out.push(`装飾 [${tag}] が閉じていません（[/${tag}]）`);
  }
  return out;
}

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

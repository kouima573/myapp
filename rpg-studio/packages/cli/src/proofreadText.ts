/** Checks one text shown to players (pure; shared by rpg proofread and the studio). */
import { stripMarkup } from "../../runtime/src/textmarkup";

/** Full-width = 1, half-width = 0.5 (roughly how wide the message window is). */
const width = (s: string) => Array.from(s).reduce((w, ch) => w + (/[\u0000-\u00ff\uff61-\uff9f]/.test(ch) ? 0.5 : 1), 0);
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


/**
 * `rpg proofread --project <dir> [--width 40] [--lines 3]` — checks every text shown to players (roadmap 169):
 * lines too wide / too many lines for the message window, doubled punctuation, repeated particles,
 * unbalanced brackets 「」『』（）, text decoration tags left open, stray spaces.
 * Only reports; never rewrites. Exit code 1 when something was found (so an agent can loop until clean).
 */
import { readProjectTexts } from "./load";
import { proofreadProjectTexts, type ProofIssue } from "./proofreadText";
export { proofreadText, type ProofIssue } from "./proofreadText";

export async function proofread(root: string, opts: { width: number; lines: number }): Promise<ProofIssue[]> {
  const { texts } = await readProjectTexts(root);
  return proofreadProjectTexts(texts, opts);
}

export async function cmdProofread(flags: Record<string, string | boolean>, root: string): Promise<number> {
  const opts = { width: Number(flags.width) || 40, lines: Number(flags.lines) || 3 };
  const issues = await proofread(root, opts);
  if (!issues.length) { console.log(`OK proofread: 気になる所はありません（1行 全角約${opts.width}字で折り返して${opts.lines}行まで）`); return 0; }
  for (const i of issues) console.log(`WARN ${i.file} › ${i.at}: ${i.message}\n     「${i.text.length > 60 ? `${i.text.slice(0, 57)}…` : i.text}」`);
  console.log(`proofread: ${issues.length}件。直したら pnpm rpg proofread で確かめてください（--width / --lines で基準を変更）`);
  return 1;
}

/**
 * Step sequencer ⇄ text score (roadmap 126). A grid of 16th-note steps: a pitch starts a note, "~" holds the
 * previous note one more step, null is silence. Converted to the song format ("C4/4 R/8 …", rests merged) and back.
 * Pure — tested without a browser.
 */
export const GRID_PITCHES = ["B5", "A#5", "A5", "G#5", "G5", "F#5", "F5", "E5", "D#5", "D5", "C#5", "C5", "B4", "A#4", "A4", "G#4", "G4", "F#4", "F4", "E4", "D#4", "D4", "C#4", "C4"];
export type Step = string | "~" | null;

const LENGTHS: Array<[number, string]> = [[16, "1"], [12, "2."], [8, "2"], [6, "4."], [4, "4"], [3, "8."], [2, "8"], [1, "16"]];
const split = (steps: number): string[] => {
  const out: string[] = [];
  let left = steps;
  for (const [n, len] of LENGTHS) while (left >= n) { out.push(len); left -= n; }
  return out;
};

export function gridToNotes(steps: Step[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < steps.length) {
    const s = steps[i];
    if (s && s !== "~") {
      let len = 1;
      while (steps[i + len] === "~") len++;
      // A note's length is one value; whatever does not fit becomes rest.
      const [first, ...rest] = split(len);
      out.push(`${s}/${first}`, ...rest.map(r => `R/${r}`));
      i += len;
    } else {
      let len = 0;
      while (i + len < steps.length && (steps[i + len] === null || steps[i + len] === "~")) len++;
      out.push(...split(len).map(r => `R/${r}`));
      i += len;
    }
  }
  return out.join(" ");
}

/** Reads a score into steps. Null when it cannot be shown (32nd notes and the like). */
export function notesToGrid(text: string, stepsWanted: number): Step[] | null {
  const steps: Step[] = [];
  for (const token of text.split(/\s+/).filter(t => t && t !== "|")) {
    const m = /^(R|x|[A-G](#|b)?-?\d)\/(1|2|4|8|16|32)(\.?)$/.exec(token);
    if (!m) return null;
    let len = 16 / Number(m[3]);
    if (m[4]) len *= 1.5;
    if (!Number.isInteger(len) || len < 1) return null;
    const raw = m[1]!;
    const pitch = raw === "R" || raw === "x" ? null : raw.replace("Db", "C#").replace("Eb", "D#").replace("Gb", "F#").replace("Ab", "G#").replace("Bb", "A#");
    steps.push(pitch);
    for (let k = 1; k < len; k++) steps.push(pitch ? "~" : null);
  }
  while (steps.length < stepsWanted) steps.push(null);
  return steps;
}

/** Put a note of `len` steps at `at` (or remove the note that starts there when it is the same pitch). */
export function placeNote(steps: Step[], at: number, pitch: string, len: number): Step[] {
  const next = [...steps];
  const clearFrom = (i: number) => { next[i] = null; for (let k = i + 1; next[k] === "~"; k++) next[k] = null; };
  if (next[at] === pitch) { clearFrom(at); return next; }
  // Starting inside a held note cuts it there.
  if (next[at] === "~" || (next[at] && next[at] !== pitch)) clearFrom(at);
  next[at] = pitch;
  for (let k = 1; k < len && at + k < next.length; k++) { if (next[at + k] && next[at + k] !== "~") clearFrom(at + k); next[at + k] = "~"; }
  if (next[at + len] === "~") clearFrom(at + len);
  return next;
}

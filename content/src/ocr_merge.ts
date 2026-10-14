// Two readings of one page, each wrong in its own way (P8.17): Tesseract keeps every Odia word it can see but loses
// the maths ("0 ≤ P(E) ≤ 1" → "0 P(E) 1") and misreads letters (ଅର୍ଥୀତ୍); Gemini vision reads the maths and the
// letters but now and then swaps a word for a likelier one (ଘଟିଲା → ମିଳିଲା, ସମ୍ଭାବ୍ୟତା → ସମ୍ଭାବନା). The merge keeps
// vision's page and, where the two disagree on one Odia word, takes Tesseract's word when it is a real word of the
// books (seen often across them) — a misreading is rarely a real word, a substitution always is.
import { fixOdiaOcr, normalizeForMatch } from '@setu/core';

const ODIA_WORD = /[଀-୿‌‍]+/;
const key = (tok: string) => normalizeForMatch(tok);
const isOdia = (tok: string) => /^[଀-୿]+$/.test(key(tok));

/** Words printed in the books, by how often Tesseract read them: a word seen `min` times is a real word. */
export function knownWords(pages: string[], min = 3): Set<string> {
  const n = new Map<string, number>();
  for (const t of pages) for (const w of normalizeForMatch(fixOdiaOcr(t)).split(' ')) if (/^[଀-୿]{2,}$/.test(w)) n.set(w, (n.get(w) ?? 0) + 1);
  return new Set([...n].filter(([, c]) => c >= min).map(([w]) => w));
}

/** Edit distance in letters (code points) — small, one word against one word. */
function distance(a: string, b: string): number {
  const x = [...a], y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[y.length]!;
}
/** two readings of the same printed word: one letter apart, or two in a longer word */
const similar = (a: string, b: string) => { const d = distance(a, b); return d <= 1 || (d <= 2 && Math.min([...a].length, [...b].length) >= 4); };

/** Longest common subsequence of two token lists (by key): the pairs of indices that match. */
function lcs(a: string[], b: string[]): [number, number][] {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: [number, number][] = [];
  for (let i = 0, j = 0; i < m && j < n;) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

export function mergeReadings(vision: string, tesseract: string, known: Set<string>): { text: string; swapped: [string, string][] } {
  const vTok = vision.split(/(\s+)/); // keeps the line breaks and spaces of vision's layout
  const vIdx = vTok.map((t, i) => [t, i] as const).filter(([t]) => t.trim()).map(([, i]) => i);
  const tTok = fixOdiaOcr(tesseract).split(/\s+/).filter(Boolean);
  const a = vIdx.map((i) => key(vTok[i]!));
  const b = tTok.map(key);
  const swapped: [string, string][] = [];
  const pairs = [...lcs(a, b), [a.length, b.length] as [number, number]];
  let pi = 0, pj = 0;
  for (const [i, j] of pairs) {
    // a stretch where the two disagree: one Odia word against one Odia word, in order
    const vo = a.slice(pi, i).map((k, x) => [k, pi + x] as const).filter(([k]) => /^[଀-୿]+$/.test(k));
    const to = tTok.slice(pj, j).filter(isOdia);
    if (vo.length && vo.length === to.length) {
      vo.forEach(([vk, x], y) => {
        const tk = key(to[y]!);
        if (tk === vk || !known.has(tk)) return;
        // a letter or two apart is a misreading, and Tesseract misreads the same way often enough (ଅର୍ଥୀତ୍,
        // କିମା) for its mistake to look "known": vision wins unless its own word is not a book word.
        // Further apart is a different word — vision's guess — and the printed one wins.
        if (similar(vk, tk) && known.has(vk)) return;
        {
          const at = vIdx[x]!;
          swapped.push([vTok[at]!, to[y]!]);
          vTok[at] = vTok[at]!.replace(ODIA_WORD, to[y]!.match(ODIA_WORD)![0]);
        }
      });
    }
    pi = i + 1; pj = j + 1;
  }
  return { text: vTok.join(''), swapped };
}

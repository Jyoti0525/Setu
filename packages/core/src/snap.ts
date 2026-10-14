// Snap-to-Learn locate step (PLAN §6.8, §4 principle 4 "small models never invent"; TODO P3.15–P3.17).
// Offline OCR of Odia print is noisy, so its text is never taught from: it is only used to find the passage
// in her textbook pack. Character trigrams survive OCR errors (a wrong or dropped letter breaks only 3 grams)
// and spacing errors (spaces are removed). Grams common to every passage ("…କୁହାଯାଏ") are weighted down (IDF).

import type { ChapterPack } from './pack.ts';
import { normalizeForMatch } from './matcher.ts';

export interface PassageHit { passageId: string; conceptId: string; score: number }
export interface LocateResult {
  /** enough letters to try at all */
  readable: boolean;
  /** best passage, set only when confident */
  passageId?: string;
  conceptId?: string;
  score: number;
  /** best − second best */
  margin: number;
  confident: boolean;
  /** the 3 most likely passages (for "tap the one you mean") */
  top: PassageHit[];
}

/** Thresholds (tuned in snap.test.ts against simulated OCR noise). */
export const SNAP_MIN_GRAMS = 12;
export const SNAP_CONFIDENT = 0.3;
export const SNAP_MARGIN = 0.08;

const grams = (text: string): Map<string, number> => {
  const t = normalizeForMatch(text).replace(/\s+/g, '');
  const m = new Map<string, number>();
  const chars = [...t];
  for (let i = 0; i + 3 <= chars.length; i++) {
    const g = chars.slice(i, i + 3).join('');
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
};

interface Indexed { passageId: string; conceptId: string; grams: Map<string, number>[] }
const cache = new WeakMap<ChapterPack, { docs: Indexed[]; idf: (g: string) => number }>();

function index(pack: ChapterPack) {
  let ix = cache.get(pack);
  if (ix) return ix;
  const docs = pack.passages.map((p) => ({ passageId: p.id, conceptId: p.conceptId, grams: Object.values(p.text).map(grams) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const g of new Set(d.grams.flatMap((m) => [...m.keys()]))) df.set(g, (df.get(g) ?? 0) + 1);
  const n = Math.max(docs.length, 1);
  ix = { docs, idf: (g) => Math.log(1 + n / (df.get(g) ?? 0.5)) };
  cache.set(pack, ix);
  return ix;
}

/** Weighted share of the photo's grams found in the passage, and of the passage's grams found in the photo; the better of the two. */
function similarity(q: Map<string, number>, d: Map<string, number>, idf: (g: string) => number): number {
  let inter = 0, qw = 0, dw = 0;
  for (const [g, c] of q) { const w = idf(g); qw += w * c; const dc = d.get(g); if (dc) inter += w * Math.min(c, dc); }
  for (const [g, c] of d) dw += idf(g) * c;
  if (!qw || !dw) return 0;
  // a photo can hold part of a passage (q ⊂ d) or a passage plus neighbouring lines (d ⊂ q)
  return Math.max(inter / qw, (inter / dw) * 0.9);
}

export function locatePassage(pack: ChapterPack, ocrText: string): LocateResult {
  const q = grams(ocrText);
  const n = [...q.values()].reduce((a, b) => a + b, 0);
  const { docs, idf } = index(pack);
  const scored = docs
    .map((d) => ({ passageId: d.passageId, conceptId: d.conceptId, score: round(Math.max(0, ...d.grams.map((g) => similarity(q, g, idf)))) }))
    .sort((a, b) => b.score - a.score || a.passageId.localeCompare(b.passageId));
  const top = scored.slice(0, 3);
  const readable = n >= SNAP_MIN_GRAMS;
  const best = top[0];
  const margin = round((best?.score ?? 0) - (top[1]?.score ?? 0));
  const confident = readable && !!best && best.score >= SNAP_CONFIDENT && margin >= SNAP_MARGIN;
  return { readable, score: best?.score ?? 0, margin, confident, top, ...(confident ? { passageId: best!.passageId, conceptId: best!.conceptId } : {}) };
}

const round = (x: number) => Math.round(x * 100) / 100;

// Multi-script matcher (PLAN §7.3): Odia script, romanized Odia, English and code-mixed
// doubts → concept + FAQ + passage. Runs on the phone (device tier) and on the server.

import MiniSearch from 'minisearch';
import type { ChapterPack } from './pack.ts';
import { normalizeDigits } from './numerals.ts';

export interface MatchHit {
  kind: 'faq' | 'glossary' | 'passage' | 'concept';
  id: string;
  conceptId: string;
  score: number;
}

export interface MatchResult {
  conceptId?: string;
  /** 0..1 rough confidence that conceptId is right */
  confidence: number;
  faqId?: string;
  hits: MatchHit[];
  script: 'odia' | 'latin' | 'devanagari' | 'mixed' | 'other';
}

/** Detect the dominant script of a text. */
export function detectScript(text: string): MatchResult['script'] {
  let odia = 0, latin = 0, deva = 0, other = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (!/[\p{L}\p{M}]/u.test(ch)) continue;
    if (cp >= 0x0b00 && cp <= 0x0b7f) odia++;
    else if (cp < 0x0250) latin++;
    else if (cp >= 0x0900 && cp <= 0x097f) deva++;
    else other++;
  }
  const total = odia + latin + deva + other;
  if (!total) return 'other';
  const max = Math.max(odia, latin, deva, other);
  if (max / total < 0.8) return 'mixed';
  return max === odia ? 'odia' : max === latin ? 'latin' : max === deva ? 'devanagari' : 'other';
}

/**
 * Normalise for matching. Latin: lowercase, fold common romanization variants of Indian
 * languages (v/w→b, aa→a, ee→i, oo→u, th→t, sh→s, ph→p, double letters). Odia: drop ZWJ/ZWNJ,
 * nukta and chandrabindu variation, unify ୟ/ଯ.
 */
export function normalizeForMatch(text: string): string {
  let t = normalizeDigits(text).toLowerCase().normalize('NFC');
  t = t.replace(/[‌‍]/g, '').replace(/଼/g, '').replace(/ଁ/g, '').replace(/ୟ/g, 'ଯ');
  t = t.replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ');
  t = t
    .replace(/[vw]/g, 'b')
    .replace(/aa+/g, 'a').replace(/ee+/g, 'i').replace(/oo+/g, 'u')
    .replace(/th/g, 't').replace(/dh/g, 'd').replace(/sh/g, 's').replace(/ph/g, 'p').replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/bh/g, 'b')
    .replace(/([a-z])\1+/g, '$1');
  return t.replace(/\s+/g, ' ').trim();
}

/** Function words that carry no concept signal (Odia, romanized Odia, English, Hindi). */
const STOP = new Set([
  'kana', 'kan', 'ki', 'ra', 're', 'au', 'aau', 'o', 'madyare', 'madhyare', 'mane', 'kau', 'kemiti', 'kahile', 'bujhi', 'parunahi', 'hela', 'heba', 'kie', 'ta', 'te',
  // the "what is it called" frame: in every kind of question, so it must not pull towards the one FAQ key that has it
  'kahanti', 'kahaku', 'taku', 'taha',
  'what', 'is', 'the', 'a', 'an', 'of', 'and', 'in', 'between', 'how', 'to', 'find', 'do', 'does', 'me', 'please', 'explain', 'tell',
  'କଣ', 'କ\'ଣ', 'କି', 'ଓ', 'ଆଉ', 'ରେ', 'ର', 'ମଧ୍ୟରେ', 'କେମିତି', 'କହ', 'ବୁଝାଅ', 'ମୋତେ', 'କହନ୍ତି', 'କାହାକୁ', 'ତାକୁ', 'ତାହା', 'କହିଲେ',
  'kya', 'hai', 'aur', 'me', 'mein', 'kaise', 'kise', 'kahte', 'kehte', 'क्या', 'है', 'और', 'में', 'कैसे', 'किसे', 'कहते', 'हैं',
].map(normalizeForMatch));

/**
 * Sound skeleton of a word, the same for English in Latin letters and English said aloud and written in Odia script
 * by speech-to-text: "displacement" and "ଡିସପ୍ଲେସମେଣ୍ଟ" → "~dsplsmnt", "velocity" and "ଭେଲୋସିଟି" → "~blst".
 * Consonants only (vowels are where spellings differ most); ≥ 3 consonants, else no key.
 */
const ODIA_C: Record<string, string> = {
  କ: 'k', ଖ: 'k', ଗ: 'g', ଘ: 'g', ଙ: 'n', ଚ: 'c', ଛ: 'c', ଜ: 'j', ଝ: 'j', ଞ: 'n', ଟ: 't', ଠ: 't', ଡ: 'd', ଢ: 'd', ଣ: 'n',
  ତ: 't', ଥ: 't', ଦ: 'd', ଧ: 'd', ନ: 'n', ପ: 'p', ଫ: 'p', ବ: 'b', ଭ: 'b', ମ: 'm', ର: 'r', ଲ: 'l', ଳ: 'l', ଶ: 's', ଷ: 's', ସ: 's', ୱ: 'b', 'ଂ': 'n',
};
export function soundKey(word: string): string | undefined {
  let k: string;
  if (/[଀-୿]/.test(word)) k = [...word.normalize('NFC')].map((ch) => ODIA_C[ch] ?? '').join('');
  else if (/^[a-z]+$/i.test(word)) {
    k = word.toLowerCase()
      .replace(/[ts]ion/g, 'sn').replace(/ph/g, 'f').replace(/ch/g, 'C').replace(/sh/g, 's').replace(/th/g, 't').replace(/ck/g, 'k')
      .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/C/g, 'c').replace(/g(?=[eiy])/g, 'j').replace(/x/g, 'ks').replace(/q/g, 'k').replace(/z/g, 'j').replace(/f/g, 'p').replace(/[vw]/g, 'b')
      .replace(/[aeiouyh]/g, '');
  } else return undefined;
  k = k.replace(/(.)\1+/g, '$1');
  return k.length >= 3 ? `~${k}` : undefined;
}

/** Content words of a text, each with the forms it may match by: its normalised spelling and its sound key. */
const wordForms = (t: string): string[][] =>
  normalizeDigits(t).split(/[^\p{L}\p{M}\p{N}]+/u).map((raw) => {
    const w = normalizeForMatch(raw);
    if (!w || STOP.has(w)) return [];
    const k = soundKey(raw);
    return k ? [w, k] : [w];
  }).filter((f) => f.length);

/** Search terms of a text: each content word by spelling and by sound key (shared with the textbook search, book.ts). */
export const tokenize = (t: string) => [...new Set(wordForms(t).flat())];

interface Doc { id: string; kind: MatchHit['kind']; conceptId: string; text: string }

export class PackMatcher {
  private readonly ms: MiniSearch<Doc>;
  private readonly docs = new Map<string, Doc>();

  constructor(private readonly pack: ChapterPack) {
    this.ms = new MiniSearch<Doc>({
      fields: ['text'],
      storeFields: ['id', 'kind', 'conceptId'],
      tokenize,
      processTerm: (t) => t,
      // sound keys (~…) are already a loose form: exact only
      searchOptions: { fuzzy: (term) => (term.startsWith('~') ? 0 : term.length > 4 ? 0.25 : term.length > 2 ? 0.15 : 0), prefix: (term) => term.length > 3 && !term.startsWith('~'), combineWith: 'OR' },
    });
    const add = (d: Doc) => { this.docs.set(d.id, d); this.ms.add(d); };
    for (const f of pack.faq) f.keys.forEach((k, i) => add({ id: `${f.id}#${i}`, kind: 'faq', conceptId: f.conceptId, text: k }));
    for (const g of pack.glossary) {
      add({ id: `glossary.${g.conceptId}`, kind: 'glossary', conceptId: g.conceptId, text: [...Object.values(g.term), g.english, ...g.romanized].join(' ') });
    }
    for (const c of Object.values(pack.graph.concepts)) add({ id: `concept.${c.id}`, kind: 'concept', conceptId: c.id, text: [...Object.values(c.name), c.id.replace(/_/g, ' ')].join(' ') });
    for (const p of pack.passages) add({ id: p.id, kind: 'passage', conceptId: p.conceptId, text: Object.values(p.text).join(' ') });
  }

  match(text: string): MatchResult {
    const script = detectScript(text);
    const raw = this.ms.search(text);
    const hits: MatchHit[] = raw.slice(0, 12).map((r) => ({ kind: r.kind as MatchHit['kind'], id: r.id as string, conceptId: r.conceptId as string, score: r.score }));
    if (!hits.length) return { confidence: 0, hits, script };

    // concept vote: glossary/concept hits weigh most; FAQ keys tie concepts together
    const vote = new Map<string, number>();
    const w = { glossary: 1.2, concept: 1.2, faq: 1, passage: 0.4 } as const;
    for (const h of hits) vote.set(h.conceptId, (vote.get(h.conceptId) ?? 0) + h.score * w[h.kind]);
    const ranked = [...vote.entries()].sort((a, b) => b[1] - a[1]);
    const [best, second] = ranked;
    const total = ranked.reduce((s, [, v]) => s + v, 0);
    let confidence = Math.min(1, (best![1] / total) * Math.min(1, best![1] / 6));
    // a long English text where one word happens to touch the chapter ("IPL points table…" → "reference point") is not
    // about the chapter: scale by how many of its content words matched anything (P6.8 red-team)
    const content = [...new Set(normalizeForMatch(text).split(' ').filter((w) => /^[a-z]{3,}$/.test(w) && !STOP.has(w)))];
    if (content.length >= 4) {
      const matched = new Set(raw.slice(0, 12).flatMap((r) => r.queryTerms as string[]));
      const coverage = content.filter((w) => matched.has(w)).length / content.length;
      // squared: one stray word in six (×0.11) must not survive a strong hit on that word; half covered stays ×1
      if (coverage < 0.5) confidence *= (coverage * 2) ** 2;
    }

    // FAQ: best FAQ hit, accepted when it clearly matches most query terms
    const faqHit = hits.find((h) => h.kind === 'faq');
    // a word overlaps when its spelling or its sound key matches (ସ୍ପିଡ୍ from speech-to-text ≈ "speed")
    const qWords = wordForms(text);
    let faqId: string | undefined;
    if (faqHit) {
      const kForms = wordForms(this.docs.get(faqHit.id)!.text);
      const same = (t: string, k: string) => k === t || (t.length > 3 && !t.startsWith('~') && (k.startsWith(t) || t.startsWith(k)));
      const overlap = qWords.filter((q) => kForms.some((kf) => q.some((t) => kf.some((k) => same(t, k))))).length;
      if (qWords.length && overlap / Math.max(qWords.length, kForms.length) >= 0.5) faqId = faqHit.id.split('#')[0];
    }
    void second;
    return { conceptId: best![0], confidence: round(confidence), faqId, hits, script };
  }

  /** Best passages for a concept or query (grounding for teach). */
  passages(conceptId: string, query?: string) {
    const direct = this.pack.passages.filter((p) => p.conceptId === conceptId);
    if (direct.length || !query) return direct;
    const ids = this.ms.search(query, { filter: (r) => r.kind === 'passage' }).slice(0, 2).map((r) => r.id);
    return this.pack.passages.filter((p) => ids.includes(p.id));
  }
}

const round = (x: number) => Math.round(x * 100) / 100;

// Textbooks as the tutor's ground truth (PLAN v4, P8.1–P8.3): a board textbook, OCR'd page by page, becomes a book
// index — short passages with their page and chapter, plus the English terms the book prints in brackets. The same
// index answers on the server and, downloaded, on the phone with no signal.

import MiniSearch from 'minisearch';
import { normalizeForMatch, tokenizeLoose as tokenize } from './matcher.ts';
import { lexiconFor } from './lexicon.ts';
import { normalizeDigits } from './numerals.ts';

export interface BookChapter { n: number; title: { or: string; en: string }; startPage: number; endPage: number }
export interface BookMeta {
  id: string;
  /** subject as she would name it, per language */
  subject: { or: string; en: string; hi?: string };
  title: { or: string; en: string };
  classLevel: number;
  board: string;
  /** where the PDF came from (shown to teachers and judges) */
  source: string;
  /** PDF page number of printed page 1 minus 1 (printed page = pdf page − offset) */
  pageOffset: number;
  chapters: BookChapter[];
  /** pages the OCR could not read well enough to teach from (e.g. full-page figures) */
  skipPages?: number[];
}
export interface BookPassage { id: string; ch: number; page: number; text: string }
export interface BookIndex { meta: BookMeta; passages: BookPassage[]; glossary: { or: string; en: string }[]; version: string }

const ODIA = /[଀-୿]/;
const JUNK_CHARS = /[\/¦#‰⁄¥„‡¬@®¶£€©%\\_<>~^*{}\[\]|]/;

/** Real abbreviations the books use; any other all-capitals token is a figure label the OCR read ("AYR", "ZUR"). */
const ACRONYMS = new Set('DNA RNA HIV AIDS RBC WBC IRDAI RBI SBI GDP GNP NABARD ATM LIC UNO WHO UNESCO NDRF ODRAF OSDMA NDMA BCG DPT TB ORS LPG CNG UV ISRO IMD CRZ MSP KCC PDS HYV NGO IMF IPC CPR SHG PIN PAN KYC NEFT RTGS UPI ICDS FAO'.split(' '));

/** Tesseract's steady misreadings of the BSE Odisha print (P8.16), checked across all three books. */
export function fixOdiaOcr(text: string): string {
  return text
    // ଥି printed as one ligature is read as ଥୁ (ଥୁବା → ଥିବା, ଏଥୁରେ → ଏଥିରେ); ପଥୁରିଆ ("rocky") is a real word
    .replace(/ଥୁ(?!ରି)/g, 'ଥି')
    .replace(/ପୂଥିବୀ/g, 'ପୃଥିବୀ')
    // …and sometimes loses the ି altogether (ଥବା → ଥିବା; ଅଥବା "or" is a real word)
    .replace(/(?<!ଅ)ଥବା/g, 'ଥିବା')
    // the ya-phala is ୍ୟ (ମଧ୍ୟ), the subscript wa is ୍ୱ (ଶ୍ୱେତ)
    .replace(/୍ଯ/g, '୍ୟ').replace(/୍ଵ/g, '୍ୱ')
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
}

/** One OCR'd page → readable lines: junk tokens (figure labels misread as symbols) and junk lines removed. */
export function cleanOcr(text: string): string {
  const lines: string[] = [];
  for (const raw of fixOdiaOcr(text.replace(/\r/g, '')).split('\n')) {
    // a stray bar at the end of a sentence is the danda the OCR missed
    const line = raw.replace(/\s\|(\s|$)/g, ' ।$1').replace(/[‘’`]/g, "'").replace(/[“”]/g, '"');
    const tokens = line.split(/\s+/).filter((tok) => {
      if (!tok) return false;
      if (JUNK_CHARS.test(tok)) return false;
      const letters = [...tok].filter((ch) => /[\p{L}\p{M}]/u.test(ch)).length;
      // Odia digits mixed into Latin letters is how the OCR spells an English word it could not read
      if (/[୦-୯]/.test(tok) && /[A-Za-z0-9]/.test(tok)) return false;
      // an all-capitals word that is not a known abbreviation (and not in brackets) is a figure label
      if (/^[A-Z]{2,7}[.,;:]?$/.test(tok) && !ACRONYMS.has(tok.replace(/[.,;:]$/, ''))) return false;
      return letters > 0 || /^[\d୦-୯.,:;()।?!\-–—'"]+$/.test(tok);
    });
    const kept = tokens.join(' ').replace(/\(\s*\)/g, '').trim();
    const words = kept.split(/\s+/).filter((w) => ODIA.test(w) || /[A-Za-z]{3,}/.test(w));
    if (words.length < 2 && !/^\d+(\.\d+)*\s/.test(kept)) continue;
    lines.push(kept);
  }
  return lines.join('\n');
}

const GLUE = new Set(['ଓ', 'ବା', 'ଅଥବା', 'ଏବଂ', 'ମଧ୍ଯ', 'ମଧ୍ୟ', 'ପାଇଁ', 'ଯଥା', 'ଏହି', 'ସେହି', 'କେତେକ', 'ସମସ୍ତେ', 'ଯେପରି', 'ଯେପରିକି', 'ଏହାକୁ', 'ତାହାକୁ', 'କୁହାଯାଏ', 'ନାମକ', 'ଯାହାକୁ']);

/** "ନୋଟୋକର୍ଡ଼ (Notochord)" → { or: 'ନୋଟୋକର୍ଡ଼', en: 'Notochord' }: the book's own term bridge. */
export function extractGlossary(text: string): { or: string; en: string }[] {
  const out: { or: string; en: string }[] = [];
  // the term is the one or two Odia words right before the bracket (more would drag in the sentence before it)
  const re = /([଀-୿]+(?: [଀-୿]+)?) ?\(([A-Za-z][A-Za-z \-]{2,40}[A-Za-z])\)/g;
  for (const m of text.matchAll(re)) {
    const en = m[2]!.replace(/\s+/g, ' ').trim();
    // the OCR's guesses at unreadable English look like "Nervechord" too, but real terms have vowels in the right places
    if (!/[aeiou]/i.test(en) || /[a-z][A-Z]/.test(en)) continue;
    // a one-word English term names a one-word Odia term: the word before it belongs to the sentence
    const words = m[1]!.trim().split(' ');
    const or = (en.includes(' ') && !GLUE.has(words[0]!) ? words : words.slice(-1)).join(' ');
    if ([...or].length < 2) continue;
    out.push({ or, en });
  }
  return out;
}

const SENT_END = /(?<=[।?!])\s+|(?<=[a-z଀-୿]\.)\s+(?=[଀-୿A-Z])/u;

/** Split OCR'd pages into passages of about `target` characters, never across a page (so every citation is exact). */
export function buildBook(meta: BookMeta, pages: { page: number; text: string }[], target = 650): BookIndex {
  const chapterOf = (page: number) => meta.chapters.find((c) => page >= c.startPage && page <= c.endPage)?.n ?? 0;
  const passages: BookPassage[] = [];
  const glossary = new Map<string, { or: string; en: string }>();
  for (const pg of pages) {
    const ch = chapterOf(pg.page);
    if (!ch || meta.skipPages?.includes(pg.page)) continue;
    const clean = cleanOcr(pg.text);
    for (const g of extractGlossary(clean)) glossary.set(g.en.toLowerCase(), g);
    // lines wrap mid-sentence: join them, then cut at sentence ends
    const flowing = clean.replace(/\n(?=\S)/g, ' ').replace(/\s+/g, ' ').trim();
    const sentences = flowing.split(SENT_END).filter((s) => s.trim().length > 0);
    let buf = '';
    let n = 0;
    const flush = () => {
      const t = buf.trim();
      if (t.length >= 80) passages.push({ id: `${meta.id}.p${pg.page}.${++n}`, ch, page: pg.page - meta.pageOffset, text: t });
      buf = '';
    };
    for (const s of sentences) {
      if (buf && buf.length + s.length > target) flush();
      buf += (buf ? ' ' : '') + s;
    }
    // a short tail joins the passage before it on the same page
    if (buf.trim().length < 80 && passages.length && passages[passages.length - 1]!.page === pg.page - meta.pageOffset) {
      const last = passages[passages.length - 1]!;
      last.text += ' ' + buf.trim();
      buf = '';
    }
    flush();
  }
  const body = JSON.stringify(passages);
  let h = 0;
  for (let i = 0; i < body.length; i++) h = (h * 31 + body.charCodeAt(i)) | 0;
  return { meta, passages, glossary: [...glossary.values()], version: (h >>> 0).toString(36) };
}

/** Chat words that say nothing about a topic ("hello", "tume kie", "kemiti acha"): never searched for in the books. */
const CHAT = new Set([
  'hello', 'hi', 'hey', 'ok', 'okay', 'thanks', 'thank', 'you', 'your', 'i', 'am', 'my', 'are', 'who', 'can', 'will', 'it', 'this', 'that', 'some', 'any', 'tell', 'give',
  'tume', 'tumhe', 'tumara', 'tuma', 'mu', 'mun', 'mo', 'mora', 'mote', 'mote', 'kie', 'kiye', 'kemiti', 'kemti', 'acha', 'achha', 'ach', 'achi', 'achu', 'bhala', 'bhal', 'kana', 'kan',
  'kete', 'keteta', 'kouthi', 'kahinki', 'kariba', 'karibi', 'kara', 'kar', 'jani', 'janichi', 'dia', 'diya', 'de', 'hau', 'hai', 'na', 'nahi', 'ha', 'han', 'aji', 'ajira', 'kali',
  'ତୁମେ', 'ତୁମ', 'ମୁଁ', 'ମୋ', 'ମୋର', 'କିଏ', 'ଭଲ', 'ଅଛ', 'ଅଛି', 'ଅଛନ୍ତି', 'କେମିତି', 'କଣ', 'କେତେ', 'କାହିଁକି', 'ହଁ', 'ନା', 'ଆଜି',
].map(normalizeForMatch));

/** how much the other matching passages of the same chapter add to a passage's score */
const CHAPTER_SHARE = 0.35;

export interface BookHit { passage: BookPassage; bookId: string; score: number; /** share of her content words found in it, 0..1 */ coverage: number }

interface ShelfDoc { id: string; bookId: string; text: string; chapter: string }

/** Every book on this phone or server, searchable as one shelf (by spelling and by sound, any script). */
export class Shelf {
  private readonly ms: MiniSearch<ShelfDoc>;
  private readonly byId = new Map<string, { passage: BookPassage; bookId: string }>();
  readonly books = new Map<string, BookIndex>();

  constructor(books: BookIndex[]) {
    this.ms = new MiniSearch<ShelfDoc>({
      fields: ['text', 'chapter'],
      storeFields: ['id', 'bookId'],
      tokenize,
      processTerm: (t) => t,
      searchOptions: {
        boost: { chapter: 1.5 },
        // a loose sound ("^bayu") is already forgiving: it may be misspelt or a word's start only when long
        fuzzy: (term) => (term.startsWith('~') ? 0 : term.startsWith('^') ? (term.length > 7 ? 0.15 : 0) : term.length > 5 ? 0.2 : 0),
        // Odia endings attach to the word (ରକ୍ତରେ = rakta + re): a spelling or loose sound may be the start of a word
        prefix: (term) => !term.startsWith('~') && term.length > (term.startsWith('^') ? 5 : 3),
        combineWith: 'OR',
      },
    });
    for (const b of books) this.add(b);
  }

  add(b: BookIndex) {
    if (this.books.has(b.meta.id)) for (const p of this.books.get(b.meta.id)!.passages) { this.ms.discard(p.id); this.byId.delete(p.id); }
    this.books.set(b.meta.id, b);
    // English terms the book prints next to a passage's Odia words are added to it, so "cell wall" finds "କୋଷ ପ୍ରାଚୀର"
    const gl = b.glossary;
    for (const p of b.passages) {
      const ch = b.meta.chapters.find((c) => c.n === p.ch);
      const extra = gl.filter((g) => p.text.includes(g.or)).map((g) => g.en).join(' ');
      this.byId.set(p.id, { passage: p, bookId: b.meta.id });
      this.ms.add({ id: p.id, bookId: b.meta.id, text: `${p.text} ${extra}`, chapter: ch ? `${ch.title.or} ${ch.title.en}` : '' });
    }
  }

  search(query: string, opts: { bookId?: string; limit?: number } = {}): BookHit[] {
    const q0 = normalizeDigits(query);
    // an English word also searches as the Odia word the book uses ("earthquake" → ଭୂମିକମ୍ପ); found by either, it counts once
    const words = q0.split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => !CHAT.has(normalizeForMatch(w)) && tokenize(w).length);
    const groups = words.map((w) => [...new Set([...tokenize(w), ...lexiconFor(w).flatMap(tokenize)])]);
    if (!groups.length) return [];
    const q = [...words, ...words.flatMap(lexiconFor)].join(' ');
    const res = this.ms.search(q, opts.bookId ? { filter: (r) => r.bookId === opts.bookId } : {}).slice(0, 60);
    // a chapter about the question has several passages that match, a stray mention has one: each passage gets a
    // share of the next best passages of its own chapter (so "janasankhya briddhi" lands in Population, not Wildlife)
    const byChapter = new Map<string, number[]>();
    for (const r of res) {
      const p = this.byId.get(r.id as string)!;
      const k = `${p.bookId}#${p.passage.ch}`;
      byChapter.set(k, [...(byChapter.get(k) ?? []), r.score]);
    }
    const ranked = res.map((r) => {
      const hit = this.byId.get(r.id as string)!;
      const others = byChapter.get(`${hit.bookId}#${hit.passage.ch}`)!.filter((x) => x !== r.score).slice(0, 2);
      const terms = new Set(r.queryTerms as string[]);
      // a word counts as found by its spelling or its loose sound; by its consonant skeleton alone less than half (one such word is not enough)
      // ("cricket" and "bored" share skeletons with unrelated Odia words)
      const found = groups.reduce((n, forms) => n + (forms.some((f) => !f.startsWith('~') && terms.has(f)) ? 1 : forms.some((f) => terms.has(f)) ? 0.4 : 0), 0);
      return { passage: hit.passage, bookId: hit.bookId, score: r.score + CHAPTER_SHARE * others.reduce((a, b) => a + b, 0), coverage: Math.round((found / groups.length) * 100) / 100 };
    });
    return ranked.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 5);
  }

  chapterOf(bookId: string, ch: number) { return this.books.get(bookId)?.meta.chapters.find((c) => c.n === ch); }
  passage(id: string) { return this.byId.get(id); }
}

/**
 * The sentences of a passage that answer her question (P8: the 📖 card shows these, the whole passage one tap away):
 * the best-matching sentence and its neighbours, up to `max` characters, in the book's order.
 */
export function focusQuote(text: string, question: string, max = 320): string {
  const sentences = text.split(SENT_END).filter((x) => x.trim());
  if (text.length <= max || sentences.length < 2) return text;
  const words = normalizeDigits(question).split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => !CHAT.has(normalizeForMatch(w)) && tokenize(w).length);
  const groups = words.map((w) => [...tokenize(w), ...lexiconFor(w).flatMap(tokenize)]);
  const hits = (s: string) => {
    const toks = tokenize(s);
    return groups.filter((forms) => forms.some((f) => toks.some((t) => t === f || (f.length > 4 && !f.startsWith('~') && t.startsWith(f))))).length;
  };
  const scores = sentences.map(hits);
  const best = scores.indexOf(Math.max(...scores));
  let from = best, to = best;
  const len = () => sentences.slice(from, to + 1).join(' ').length;
  // grow around the best sentence, the next one first (the book explains after it names)
  while (true) {
    if (to + 1 < sentences.length && len() + sentences[to + 1]!.length <= max) to++;
    else if (from > 0 && len() + sentences[from - 1]!.length <= max) from--;
    else break;
  }
  return (from > 0 ? '… ' : '') + sentences.slice(from, to + 1).join(' ') + (to < sentences.length - 1 ? ' …' : '');
}

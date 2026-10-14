// Textbooks as the tutor's ground truth (PLAN v4, P8.1–P8.3): a board textbook, OCR'd page by page, becomes a book
// index — short passages with their page and chapter, plus the English terms the book prints in brackets. The same
// index answers on the server and, downloaded, on the phone with no signal.

import MiniSearch from 'minisearch';
import { normalizeForMatch, tokenizeLoose as tokenize } from './matcher.ts';
import { lexiconFor } from './lexicon.ts';
import { normalizeDigits } from './numerals.ts';
import { latexToText } from './latex.ts';
import { LANGUAGES } from './languages.ts';

export interface BookChapter { n: number; title: { or: string; en: string; hi?: string }; startPage: number; endPage: number }
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
  /** a language book (Odia, English, Hindi, Sanskrit): its stories and poems share everyday words with every
   *  question, so it is searched only when she picks it or names one of its lessons */
  kind?: 'language';
  /** the language the book is written in (default 'or'): an NCERT book is 'en' or 'hi' */
  lang?: string;
}
export interface BookPassage { id: string; ch: number; page: number; text: string; /** a figure on the page, explained in words (P8.20): its picture, `<book-id>/p013-1.jpg` under content/books/figures */ fig?: string }
export interface BookIndex { meta: BookMeta; passages: BookPassage[]; glossary: { or: string; en: string }[]; version: string }
/** One page of a book's text: OCR by default; `by` marks text read some other way (P8.17). */
export interface BookPage { page: number; text: string; conf?: number; by?: 'gemini' | 'text' }

/** Odia or Devanagari (Hindi, Sanskrit) letters (not the danda । ॥, which Odia shares) */
const INDIC = /[଀-୿ऀ-ॣ०-ॿ]/;
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
    // ଧି the same way (ଅଧକ / ଅଧୁକ → ଅଧିକ, ମାନବାଧକାର → ମାନବାଧିକାର); ଆଧୁନିକ, ଅଧୁନା, ସାଧକ, ବାଧକ are real words
    .replace(/ଅଧ(?:ୁ|୍ଧ)?କ/g, 'ଅଧିକ').replace(/ାଧୁ?କାର/g, 'ାଧିକାର').replace(/ଆଧୁପତ୍ୟ/g, 'ଆଧିପତ୍ୟ')
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
    const words = kept.split(/\s+/).filter((w) => INDIC.test(w) || /[A-Za-z]{3,}/.test(w));
    if (words.length < 2 && !/^\d+(\.\d+)*\s/.test(kept)) continue;
    lines.push(kept);
  }
  return lines.join('\n');
}

/**
 * Text read some other way than Tesseract (Gemini vision for the maths, a PDF's own text layer): no OCR junk to strip,
 * only what that reader adds — markdown, LaTeX maths (latex.ts), the figure marker, the printed page number.
 */
export function cleanReadText(text: string): string {
  return fixOdiaOcr(latexToText(text.replace(/\r/g, '')))
    .replace(/\*\*/g, '')
    .replace(/[‘’`]/g, "'").replace(/[“”]/g, '"')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l && l !== '[ଚିତ୍ର]' && !/^[[\-(]?\s*[\d୦-୯]+\s*[\]\-)]?$/.test(l))
    .join('\n');
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

const SENT_END = /(?<=[।॥?!])\s+|(?<=[a-z଀-୿ऀ-ॣ०-ॿ]\.)\s+(?=[଀-୿ऀ-ॣ०-ॿA-Z])/u;

/** Split OCR'd pages into passages of about `target` characters, never across a page (so every citation is exact). */
export function buildBook(meta: BookMeta, pages: BookPage[], target = 650): BookIndex {
  const chapterOf = (page: number) => meta.chapters.find((c) => page >= c.startPage && page <= c.endPage)?.n ?? 0;
  const passages: BookPassage[] = [];
  const glossary = new Map<string, { or: string; en: string }>();
  for (const pg of pages) {
    const ch = chapterOf(pg.page);
    if (!ch || meta.skipPages?.includes(pg.page)) continue;
    const clean = pg.by ? cleanReadText(pg.text) : cleanOcr(pg.text);
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
  'kete', 'keteta', 'sathi', 'sathe', 'kouthi', 'kahinki', 'kariba', 'karibi', 'kara', 'kar', 'jani', 'janichi', 'dia', 'diya', 'de', 'hau', 'hai', 'na', 'nahi', 'ha', 'han', 'aji', 'ajira', 'kali',
  'ତୁମେ', 'ତୁମ', 'ମୁଁ', 'ମୋ', 'ମୋର', 'କିଏ', 'ଭଲ', 'ଅଛ', 'ଅଛି', 'ଅଛନ୍ତି', 'କେମିତି', 'କଣ', 'କେତେ', 'କାହିଁକି', 'ହଁ', 'ନା', 'ଆଜି',
  // Hindi's little words, in both scripts (the Hindi and Sanskrit books are asked about in Hindi)
  'का', 'की', 'के', 'को', 'से', 'ने', 'क्या', 'है', 'हैं', 'किसने', 'कौन', 'क्यों', 'कैसे', 'मुझे', 'बताओ', 'ka', 'ki', 'ke', 'ko', 'se', 'ne', 'kya', 'kisne', 'kaun', 'kyon', 'kaise', 'batao',
].map(normalizeForMatch));

/** how much the other matching passages of the same chapter add to a passage's score */
const CHAPTER_SHARE = 0.35;
/** below this search score a one-word question's match is too weak to stand on (real one-word questions score 30+) */
const SINGLE_WORD_MIN = 20;

export interface BookHit { passage: BookPassage; bookId: string; score: number; /** share of her content words found in it, 0..1 */ coverage: number }

interface ShelfDoc { id: string; bookId: string; text: string; chapter: string }

/** A book, subject or chapter name in her language: Odia and Hindi as printed, English for the rest; a learner taught in
 *  a school language (Santali, Kui… → Odia; Bhojpuri → Hindi) sees her school's names. */
export function nameIn(x: { or: string; en: string; hi?: string } | undefined, lang: string): string {
  if (!x) return '';
  const l = lang === 'or' || lang === 'hi' || lang === 'en' ? lang : LANGUAGES[lang]?.school ?? 'en';
  return l === 'or' ? x.or : l === 'hi' ? x.hi ?? x.en : x.en;
}

/** "BSE-Odisha", "BSE Odisha" → "bseodisha": one name per board, however it is written */
export const boardKey = (board: string) => board.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Boards Setu has books for: id (profile), name shown, who sets it. */
export const BOARDS = [
  { id: 'BSE Odisha', name: { or: 'BSE ଓଡ଼ିଶା', en: 'BSE Odisha', hi: 'BSE ओडिशा' }, by: 'Board of Secondary Education, Odisha', lang: 'or' },
  { id: 'CBSE', name: { or: 'CBSE (NCERT)', en: 'CBSE (NCERT)', hi: 'CBSE (NCERT)' }, by: 'Central Board of Secondary Education — NCERT textbooks', lang: 'en' },
] as const;

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

  /** `picked`: the books of the subject she chose (a language book is searched only then, or when she names a lesson);
   *  `only`: the books she may be answered from at all (her board's) */
  search(query: string, opts: { bookId?: string; limit?: number; picked?: string[]; only?: string[] } = {}): BookHit[] {
    // କ'ଣ is one word (କଣ, "what"), not କ and ଣ
    const q0 = normalizeDigits(query).replace(/([\p{L}\p{M}])['’](?=\p{L})/gu, '$1');
    // an English word also searches as the Odia word the book uses ("earthquake" → ଭୂମିକମ୍ପ); found by either, it counts once
    const words = q0.split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => !CHAT.has(normalizeForMatch(w)) && tokenize(w).length);
    const groups = words.map((w) => [...new Set([...tokenize(w), ...lexiconFor(w).flatMap(tokenize)])]);
    if (!groups.length) return [];
    const q = [...words, ...words.flatMap(lexiconFor)].join(' ');
    // a language book's stories share everyday words with every question ("water", "mother", "village"): it joins
    // when she picked it, or when her words name one of its lessons: half her words, or two of them, are words of
    // a lesson title ("kabir ke dohe", "ବୁଢ଼ା ଶଙ୍ଖାରି ଗଳ୍ପଟି କାହା ବିଷୟରେ?")
    const names = (r: { match: Record<string, string[]> }) => {
      const inTitle = Object.entries(r.match).filter(([, f]) => f.includes('chapter')).map(([t]) => t);
      // whole words only: "price" is not "The Priceless Gift"
      return groups.filter((forms) => forms.some((f) => !f.startsWith('~') && inTitle.includes(f))).length;
    };
    const open = (r: { bookId: string; match: Record<string, string[]> }) =>
      this.books.get(r.bookId)?.meta.kind !== 'language' || opts.bookId === r.bookId || !!opts.picked?.includes(r.bookId) || names(r) >= Math.min(2, Math.max(1, Math.ceil(groups.length / 2)));
    const only = opts.only ? new Set(opts.only) : undefined;
    const res = this.ms.search(q, opts.bookId ? { filter: (r) => r.bookId === opts.bookId } : only ? { filter: (r) => only.has(r.bookId) } : {}).filter((r) => open(r as never)).slice(0, 60);
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
      // one word that only weakly matches (a common sound, a long page) is not enough to show a page: "sathi", "joke"
      const score = r.score + CHAPTER_SHARE * others.reduce((a, b) => a + b, 0);
      const weak = groups.length === 1 && score < SINGLE_WORD_MIN ? 0.4 : 1;
      return { passage: hit.passage, bookId: hit.bookId, score, coverage: Math.round((found / groups.length) * weak * 100) / 100 };
    });
    return ranked.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 5);
  }

  /** the books of one board ("BSE Odisha", "CBSE"); every book when the board is not given or has no books here */
  booksOf(board?: string): string[] {
    const all = [...this.books.values()];
    const mine = board ? all.filter((b) => boardKey(b.meta.board) === boardKey(board)) : all;
    return (mine.length ? mine : all).map((b) => b.meta.id);
  }

  chapterOf(bookId: string, ch: number) { return this.books.get(bookId)?.meta.chapters.find((c) => c.n === ch); }
  passage(id: string) { return this.byId.get(id); }
  /** the figures printed on a page (their explanations are passages too, so a question can find a figure by meaning) */
  figuresOn(bookId: string, page: number): BookPassage[] { return (this.books.get(bookId)?.passages ?? []).filter((p) => p.fig && p.page === page); }
  /** A chapter in teaching order, cut into parts of a few passages: one part is taught, then checked (guided lesson). */
  lessonParts(bookId: string, ch: number, size = LESSON_PART_PASSAGES): BookPassage[][] {
    const ps = (this.books.get(bookId)?.passages ?? []).filter((p) => p.ch === ch).sort((a, b) => a.page - b.page);
    const parts: BookPassage[][] = [];
    for (let i = 0; i < ps.length; i += size) parts.push(ps.slice(i, i + size));
    return parts;
  }
}

/** Passages per lesson part: about two printed pages, small enough for one explanation and one check. */
export const LESSON_PART_PASSAGES = 4;

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

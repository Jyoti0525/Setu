// Textbooks as the tutor's ground truth (PLAN v4, P8.1–P8.3): a board textbook, OCR'd page by page, becomes a book
// index — short passages with their page and chapter, plus the English terms the book prints in brackets. The same
// index answers on the server and, downloaded, on the phone with no signal.

import MiniSearch from 'minisearch';
import { tokenize } from './matcher.ts';
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

/** One OCR'd page → readable lines: junk tokens (figure labels misread as symbols) and junk lines removed. */
export function cleanOcr(text: string): string {
  const lines: string[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    // a stray bar at the end of a sentence is the danda the OCR missed
    const line = raw.replace(/\s\|(\s|$)/g, ' ।$1').replace(/[‘’`]/g, "'").replace(/[“”]/g, '"');
    const tokens = line.split(/\s+/).filter((tok) => {
      if (!tok) return false;
      if (JUNK_CHARS.test(tok)) return false;
      const letters = [...tok].filter((ch) => /[\p{L}\p{M}]/u.test(ch)).length;
      // Odia digits mixed into Latin letters is how the OCR spells an English word it could not read
      if (/[୦-୯]/.test(tok) && /[A-Za-z0-9]/.test(tok)) return false;
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
        fuzzy: (term) => (term.startsWith('~') ? 0 : term.length > 5 ? 0.2 : 0),
        prefix: (term) => term.length > 3 && !term.startsWith('~'),
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
    const q = normalizeDigits(query);
    const words = tokenize(q).filter((t) => !t.startsWith('~'));
    if (!words.length) return [];
    const res = this.ms.search(q, opts.bookId ? { filter: (r) => r.bookId === opts.bookId } : {});
    return res.slice(0, opts.limit ?? 5).map((r) => {
      const hit = this.byId.get(r.id as string)!;
      const matched = new Set((r.queryTerms as string[]).filter((t) => !t.startsWith('~')));
      const sounds = new Set((r.queryTerms as string[]).filter((t) => t.startsWith('~')));
      // a word counts as found by its spelling or by its sound key
      const found = tokenize(q).length ? words.filter((w) => matched.has(w) || [...sounds].some((s) => tokenize(w).includes(s))).length : 0;
      return { passage: hit.passage, bookId: hit.bookId, score: r.score, coverage: Math.round((found / words.length) * 100) / 100 };
    });
  }

  chapterOf(bookId: string, ch: number) { return this.books.get(bookId)?.meta.chapters.find((c) => c.n === ch); }
  passage(id: string) { return this.byId.get(id); }
}

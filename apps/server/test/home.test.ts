// Tier C home-language words (Kui, Ho…) and board-scoped search: only dictionary words reach her, only her board's books answer her.
import { describe, expect, it } from 'vitest';
import { Shelf, nameIn, type BookIndex } from '@setu/core';
import { checkHomeWords, homeWordsFor, loadHomeWords, type HomeList } from '../src/tutor/home.ts';
import { tutorPrompt } from '../src/tutor/prompt.ts';
import { fileURLToPath } from 'node:url';

const kui: HomeList = { id: 'kxu', name: 'Kui', sources: ['test'], entries: [
  { or: 'ପାଣି', home: 'ସିରୁ' }, { or: 'ଗଛ', home: 'ମ୍ରାହ୍ନୁ' }, { or: 'ଖରା', home: 'କାରା' }, { or: 'ନଦୀ', home: 'ଜଡ଼ି' }, { or: 'ଦୁଇ ଶବ୍ଦ', home: 'x' },
] };

describe('home-language words (tier C)', () => {
  it('offers the words of her question and the passages first, then everyday ones; phrases are left out', () => {
    const hw = homeWordsFor(kui, ['ଗଛ ପାଣି କିପରି ନିଏ?', 'ଚେର ମାଟିରୁ ପାଣି ଶୋଷେ']);
    expect(hw.name).toBe('Kui');
    expect(hw.words.map((w) => w.or)).toEqual(expect.arrayContaining(['ପାଣି', 'ଗଛ', 'ଖରା', 'ନଦୀ']));
    expect(hw.words.some((w) => w.or.includes(' '))).toBe(false);
  });
  it('keeps dictionary words, removes any the model made up', () => {
    const hw = homeWordsFor(kui, ['ପାଣି']);
    const c = checkHomeWords('ଗଛ ପାଣି (Kui: ସିରୁ) ନିଏ। ଖରା (କୁଇ: କାରା) ଦିନେ। ମାଟି (Kui: ମାଟିକା) ଭିତରେ।', hw, ['Kui', 'କୁଇ']);
    expect(c.reply).toContain('(Kui: ସିରୁ)');
    expect(c.reply).toContain('(କୁଇ: କାରା)');
    expect(c.reply).not.toContain('ମାଟିକା');
    expect(c.dropped).toBe(1);
    expect(c.used.map((u) => u.or).sort()).toEqual(['ଖରା', 'ପାଣି'].sort());
  });
  it('the prompt lists only dictionary words and forbids others', () => {
    const plan = { action: 'explain', grounding: [], askCheck: false, reason: '', candidates: [] } as never;
    const p = tutorPrompt({ lang: 'or', plan, shelf: new Shelf([]), text: 'x', history: [], home: homeWordsFor(kui, ['ପାଣି']) });
    expect(p.system).toContain('ପାଣି = ସିରୁ');
    expect(p.system).toMatch(/never make up/);
    expect(p.system).toContain('tribal village of Odisha');
  });
  it('the shipped word lists load (Govt. of Odisha dictionaries), each with hundreds of words', () => {
    const m = loadHomeWords(fileURLToPath(new URL('../../../content/tribal', import.meta.url)));
    expect([...m.keys()].sort()).toEqual(['hoc', 'kxu', 'kxv', 'srb', 'unr']);
    for (const l of m.values()) expect(l.entries.length).toBeGreaterThan(500);
    expect(m.get('kxu')!.entries.find((e) => e.or === 'ନଦୀ')?.home).toBe('ଜଡ଼ି');
  });
});

const book = (id: string, board: string, text: string): BookIndex => ({
  meta: { id, subject: { or: id, en: id }, title: { or: id, en: id }, classLevel: 9, board, source: 't', pageOffset: 0, chapters: [{ n: 1, title: { or: 'ଅ', en: 'Tissues', hi: 'ऊतक' }, startPage: 1, endPage: 9 }] },
  passages: [{ id: `${id}.p1`, ch: 1, page: 1, text }], glossary: [], version: '1',
});

describe('board-scoped books', () => {
  const shelf = new Shelf([book('bse', 'BSE Odisha', 'tissue cells group work together'), book('cbse', 'CBSE', 'tissue cells group work together')]);
  it('a CBSE learner is answered from CBSE books only, a BSE learner from BSE books only', () => {
    expect(shelf.search('tissue', { only: shelf.booksOf('CBSE') }).map((h) => h.bookId)).toEqual(['cbse']);
    expect(shelf.search('tissue', { only: shelf.booksOf('BSE-Odisha') }).map((h) => h.bookId)).toEqual(['bse']);
    expect(shelf.booksOf(undefined).sort()).toEqual(['bse', 'cbse']);
  });
  it('names come in her language, or her school language', () => {
    const t = { or: 'ଅ', en: 'Tissues', hi: 'ऊतक' };
    expect([nameIn(t, 'or'), nameIn(t, 'hi'), nameIn(t, 'kn'), nameIn(t, 'kxu'), nameIn(t, 'bho'), nameIn(t, 'sat')]).toEqual(['ଅ', 'ऊतक', 'Tissues', 'ଅ', 'ऊतक', 'ଅ']);
  });
});

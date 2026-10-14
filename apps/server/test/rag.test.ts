import { describe, expect, it } from 'vitest';
import { emptyMemory, Shelf, type BookIndex, type TutorPlan } from '@setu/core';
import { agreedChapter, AGREED_COVERAGE, fuse, translatable } from '../src/rag.ts';
import { tutorPrompt } from '../src/tutor/prompt.ts';

const passages = [
  { id: 'b:1', ch: 1, page: 10, text: 'ରକ୍ତ କଣିକା ତିନି ପ୍ରକାର' },
  { id: 'b:2', ch: 1, page: 11, text: 'ଲୋହିତ ରକ୍ତ କଣିକା ଅମ୍ଳଜାନ ବହନ କରେ' },
  { id: 'b:3', ch: 1, page: 12, text: 'ଶ୍ୱେତ ରକ୍ତ କଣିକା ରୋଗରୁ ରକ୍ଷା କରେ' },
  { id: 'b:4', ch: 2, page: 30, text: 'ମୌସୁମୀ ବାୟୁ ବର୍ଷା ଆଣେ' },
  { id: 'b:5', ch: 2, page: 31, text: 'ଜୁନ ମାସରେ ବର୍ଷା ଆରମ୍ଭ ହୁଏ' },
];
const book: BookIndex = {
  meta: { id: 'b', subject: { or: 'ବିଜ୍ଞାନ', en: 'Science' }, title: { or: 'ବହି', en: 'Book' }, classLevel: 9, board: 'test', source: 'test', pageOffset: 0, chapters: [{ n: 1, title: { or: 'ରକ୍ତ', en: 'Blood' } }, { n: 2, title: { or: 'ଜଳବାୟୁ', en: 'Climate' } }] } as BookIndex['meta'],
  passages, glossary: [], version: '1',
};
const shelf = new Shelf([book]);

describe('hybrid RAG (keyword + pgvector, fused)', () => {
  it('only Indian-script questions are sent to IndicTrans2', () => {
    expect(translatable('ରକ୍ତ କଣିକା କେତେ ପ୍ରକାର?', 'or')).toBe(true);
    expect(translatable('rakta kanika kete prakara', 'or')).toBe(false);
    expect(translatable('प्रकाश संश्लेषण क्या है?', 'hi')).toBe(true);
    expect(translatable('what is a cell', 'en')).toBe(false);
  });

  it('meaning search agreeing on one chapter (3 of the top 5) names it; scattered matches name nothing', () => {
    expect(agreedChapter(shelf, [{ id: 'b:4' }, { id: 'b:5' }, { id: 'b:1' }, { id: 'b:2' }, { id: 'b:3' }])).toBeUndefined();
    expect(agreedChapter(shelf, [{ id: 'b:1' }, { id: 'b:4' }, { id: 'b:2' }, { id: 'b:3' }, { id: 'b:5' }])).toBe('b#1');
  });

  it('a strong keyword match keeps its order; meaning-only passages follow it', () => {
    const kw = shelf.search('ରକ୍ତ କଣିକା', { limit: 20 });
    expect(kw[0]!.coverage).toBeGreaterThanOrEqual(0.67);
    const r = fuse(shelf, [{ w: 1, ids: kw.map((h) => h.passage.id) }, { w: 1, ids: ['b:5', 'b:4'] }], kw, [{ id: 'b:5', sim: 0.9 }, { id: 'b:4', sim: 0.85 }], 6);
    expect(r.hits[0]!.passage.id).toBe(kw[0]!.passage.id);
    expect(r.note).toContain('keyword-led');
  });

  it('when her words are not the book’s, an agreed meaning match grounds the answer; an unagreed one does not', () => {
    const near = [{ id: 'b:4', sim: 0.83 }, { id: 'b:5', sim: 0.82 }];
    const agreed = fuse(shelf, [{ w: 1, ids: [] }, { w: 1, ids: ['b:4', 'b:5'] }], [], near, 6, 'b#2');
    expect(agreed.hits[0]!.passage.id).toBe('b:4');
    expect(agreed.hits[0]!.coverage).toBe(AGREED_COVERAGE);
    expect(agreed.added).toBe(2);
    // "hello" lands near some page too, but nothing agrees: no coverage, so no page is shown for chit-chat
    const chat = fuse(shelf, [{ w: 1, ids: [] }, { w: 1, ids: ['b:4', 'b:1'] }], [], [{ id: 'b:4', sim: 0.83 }, { id: 'b:1', sim: 0.82 }], 6);
    expect(chat.hits.every((h) => h.coverage === 0)).toBe(true);
  });

  it('the model sees her words first and the IndicTrans2 English only as a marked hint', () => {
    const plan = { action: 'explain', grounding: [], askCheck: false, reason: '', candidates: [] } as unknown as TutorPlan;
    const p = tutorPrompt({ lang: 'or', plan, shelf, text: 'ରକ୍ତ କଣିକା କେତେ ପ୍ରକାର?', english: 'How many types of blood cells are there?', history: [] });
    const her = p.user.indexOf('STUDENT NOW: ରକ୍ତ');
    const en = p.user.indexOf('How many types of blood cells');
    expect(her).toBeGreaterThanOrEqual(0);
    expect(en).toBeGreaterThan(her);
    expect(p.user).toContain('IndicTrans2');
    expect(p.user).toContain('Do not copy its wording');
    void emptyMemory;
  });
});

describe('textbook figures (P8.20)', () => {
  const fig = { id: 'b.f16.1', ch: 1, page: 10, text: 'ଚିତ୍ର - 1.1 ରକ୍ତ କଣିକା — ଚିତ୍ରରେ ଲୋହିତ, ଶ୍ୱେତ ରକ୍ତ କଣିକା ଓ ଅଣୁଚକ୍ରିକା ଦେଖାଯାଇଛି।', fig: 'b/p016-1.jpg' };
  const withFig = new Shelf([{ ...book, passages: [...passages, fig] }]);

  it('a page knows its figures', () => {
    expect(withFig.figuresOn('b', 10).map((p) => p.id)).toEqual(['b.f16.1']);
    expect(withFig.figuresOn('b', 11)).toEqual([]);
  });

  it('the model reads the figure with the page it is printed on', () => {
    const plan = { action: 'explain', grounding: [{ passage: passages[0]!, bookId: 'b', score: 10, coverage: 1 }], askCheck: false, reason: '', candidates: [] } as unknown as TutorPlan;
    const p = tutorPrompt({ lang: 'or', plan, shelf: withFig, text: 'ରକ୍ତ କଣିକା', history: [] });
    expect(p.user).toContain('[b.f16.1] FIGURE on the same page: ଚିତ୍ର - 1.1');
    expect(p.system).toContain('FIGURE passage');
  });
});

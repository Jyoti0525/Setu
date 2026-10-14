import { describe, expect, it } from 'vitest';
import { applyTurn, buildBook, cleanOcr, emptyMemory, extractGlossary, looksLikeAnswer, openerFor, planTurn, Shelf, topicKey, type BookMeta, type TutorMemory } from '../src/index.ts';

const meta: BookMeta = {
  id: 'bio', subject: { or: 'ଜୀବ ବିଜ୍ଞାନ', en: 'Life Science' }, title: { or: 'ଜୀବ ବିଜ୍ଞାନ', en: 'Life Science' }, classLevel: 9, board: 'BSE Odisha', source: 'test', pageOffset: 2,
  chapters: [{ n: 1, title: { or: 'ଜୀବକୋଷ', en: 'The cell' }, startPage: 3, endPage: 4 }, { n: 2, title: { or: 'ଟିସୁ', en: 'Tissue' }, startPage: 5, endPage: 6 }],
};
const pages = [
  { page: 1, text: 'ମୁଖବନ୍ଧ ଏହି ପୁସ୍ତକ ବିଷୟରେ' },
  { page: 3, text: 'ଜୀବର ମୌଳିକ ଏକକ କୋଷ । ଉଦ୍ଭିଦ କୋଷର ବାହାରେ କୋଷ ପ୍ରାଚୀର (Cell wall) ଥାଏ । ଏହା ସେଲୁଲୋଜରେ ତିଆରି ଓ କୋଷକୁ ଦୃଢ଼ତା ଦିଏ ।\n#‰ ¥ 5/25/ ୭ Blo\nପ୍ରାଣୀ କୋଷରେ କୋଷ ପ୍ରାଚୀର ନଥାଏ, କେବଳ କୋଷ ଝିଲ୍ଲୀ ଥାଏ ।' },
  { page: 4, text: 'କୋଷର ମଝିରେ ନ୍ୟଷ୍ଟି (Nucleus) ଥାଏ । ନ୍ୟଷ୍ଟି କୋଷର ସମସ୍ତ କାମକୁ ନିୟନ୍ତ୍ରଣ କରେ, ତେଣୁ ଏହାକୁ କୋଷର ମସ୍ତିଷ୍କ କୁହାଯାଏ ।' },
  { page: 5, text: 'ରକ୍ତ ଏକ ତରଳ ସଂଯୋଜକ ଟିସୁ । ଲୋହିତ ରକ୍ତ କଣିକାରେ ହିମୋଗ୍ଲୋବିନ ଥାଏ, ଯାହା ଅମ୍ଳଜାନ ବହନ କରେ ।' },
];
const book = buildBook(meta, pages);
const shelf = new Shelf([book]);

describe('textbook index (P8.1–P8.3)', () => {
  it('drops OCR junk (figure labels read as symbols), keeps the Odia text', () => {
    const c = cleanOcr('ଉଦ୍ଭିଦ କୋଷର ବାହାରେ କୋଷ ପ୍ରାଚୀର ଥାଏ |\n#‰ ¥ 5/25/ ୭ Blo\nନୋଟୋକର୍ଡ଼ (!4୦।୦୦୩୦/୯) ଥାଏ');
    expect(c).toContain('କୋଷ ପ୍ରାଚୀର ଥାଏ ।');
    expect(c).not.toMatch(/‰|5\/25/);
    expect(c).not.toContain('!4୦');
  });
  it('reads the book\'s own term bridge: Odia term (English term)', () => {
    expect(extractGlossary('ଏହାକୁ ନୋଟୋକର୍ଡ଼ (Notochord) କୁହାଯାଏ')).toEqual([{ or: 'ନୋଟୋକର୍ଡ଼', en: 'Notochord' }]);
    expect(extractGlossary('ବାହାରେ କୋଷ ପ୍ରାଚୀର (Cell wall) ଥାଏ')).toEqual([{ or: 'କୋଷ ପ୍ରାଚୀର', en: 'Cell wall' }]);
    expect(extractGlossary('ଓ ବିବିଧତା (Diversity)')).toEqual([{ or: 'ବିବିଧତା', en: 'Diversity' }]);
  });
  it('passages keep their printed page and chapter; front matter is left out; ids are unique', () => {
    expect(book.passages.every((p) => p.ch > 0)).toBe(true);
    expect(book.passages.map((p) => p.page)).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(new Set(book.passages.map((p) => p.id)).size).toBe(book.passages.length);
    expect(book.passages.some((p) => p.text.includes('ମୁଖବନ୍ଧ'))).toBe(false);
  });
  it('finds the page by Odia, by English (via the book\'s brackets) and by romanized Odia', () => {
    expect(shelf.search('କୋଷ ପ୍ରାଚୀର କ\'ଣ')[0]!.passage.page).toBe(1);
    expect(shelf.search('what is a cell wall')[0]!.passage.page).toBe(1);
    expect(shelf.search('nyasti kana kare')[0]!.passage.page).toBe(2);
    const blood = shelf.search('ରକ୍ତ କଣିକା')[0]!;
    expect([blood.passage.ch, blood.coverage]).toEqual([2, 1]);
  });
});

describe('tutor policy (P8.4–P8.8)', () => {
  const now = 1_760_000_000_000;
  const hits = (q: string) => shelf.search(q);
  it('explains from the book, then checks — the decision names the page and why', () => {
    const p = planTurn(emptyMemory(), { safety: 'ok', text: 'କୋଷ ପ୍ରାଚୀର କ\'ଣ', hits: hits('କୋଷ ପ୍ରାଚୀର କ\'ଣ'), online: true, now });
    expect(p).toMatchObject({ action: 'explain', topic: topicKey('bio', 1), strategy: 'textbook', askCheck: true });
    expect(p.reason).toMatch(/p\. 1/);
  });
  it('safety comes first: distress → care, nothing else', () => {
    expect(planTurn(emptyMemory(), { safety: 'distress', text: 'x', hits: [], online: true, now }).action).toBe('care');
  });
  it('her reply to the open check is graded; a real new question is not', () => {
    const m: TutorMemory = { ...emptyMemory(), check: { question: 'Why do plant cells need a wall?', keyIdeas: ['strength'], topic: 'bio#1', passageIds: [], askedAt: now, ignored: 0, tries: 0 } };
    expect(looksLikeAnswer('ଏହା ଦୃଢ଼ତା ଦିଏ', m.check)).toBe(true);
    expect(looksLikeAnswer('ରକ୍ତ କଣିକା କେତେ ପ୍ରକାର?', m.check)).toBe(false);
    expect(planTurn(m, { safety: 'ok', text: 'ଏହା ଦୃଢ଼ତା ଦିଏ', hits: [], online: true, now }).action).toBe('grade');
  });
  it('still stuck → a different way of explaining (strategy ladder), not the same words louder', () => {
    let m = emptyMemory();
    const q = 'କୋଷ ପ୍ରାଚୀର କ\'ଣ';
    const p1 = planTurn(m, { safety: 'ok', text: q, hits: hits(q), online: true, now });
    m = applyTurn(m, { plan: p1, now, newCheck: { question: 'Why a wall?', keyIdeas: ['strength'], topic: p1.topic!, passageIds: [] } });
    const g = planTurn(m, { safety: 'ok', text: 'ଜାଣିନି', hits: [], online: true, now });
    m = applyTurn(m, { plan: g, now, grade: { verdict: 'wrong', gap: 'does not know what the wall does' } });
    const p2 = planTurn(m, { safety: 'ok', text: q, hits: hits(q), online: true, now });
    expect(p2).toMatchObject({ action: 'explain_differently', strategy: 'everyday_example' });
  });
  it('a right answer raises mastery and closes the check; a wrong one keeps it open for one more try', () => {
    const base: TutorMemory = { ...emptyMemory(), check: { question: 'q', keyIdeas: [], topic: 'bio#1', passageIds: [], askedAt: now, ignored: 0, tries: 0 } };
    const g = planTurn(base, { safety: 'ok', text: 'ans', hits: [], online: true, now });
    const right = applyTurn(base, { plan: g, now, grade: { verdict: 'right' } });
    expect(right.topics['bio#1']!.pKnown).toBeGreaterThan(0.3);
    expect(right.check).toBeUndefined();
    const wrong = applyTurn(base, { plan: g, now, grade: { verdict: 'wrong' } });
    expect(wrong.check?.tries).toBe(1);
    const again = applyTurn(wrong, { plan: g, now, grade: { verdict: 'wrong' } });
    expect(again.check).toBeUndefined();
    expect(again.topics['bio#1']!.wrongInARow).toBe(2);
    const partly = applyTurn(base, { plan: g, now, grade: { verdict: 'partly' } });
    expect([partly.topics['bio#1']!.pKnown, partly.topics['bio#1']!.wrongInARow, partly.check?.tries]).toEqual([0.2, 0, 1]);
  });
  it('three wrong in a row on a topic → her teacher is told (once every few days)', () => {
    const m: TutorMemory = { ...emptyMemory(), topics: { 'bio#1': { pKnown: 0.1, checks: 3, right: 0, wrongInARow: 3, doubts: 3, lastAt: now, tried: ['textbook', 'everyday_example'] } } };
    const q = 'କୋଷ ପ୍ରାଚୀର କ\'ଣ';
    expect(planTurn(m, { safety: 'ok', text: q, hits: hits(q), online: true, now }).escalate).toBe(true);
    m.topics['bio#1']!.escalatedAt = now - 3600_000;
    expect(planTurn(m, { safety: 'ok', text: q, hits: hits(q), online: true, now }).escalate).toBe(false);
  });
  it('no signal → the textbook passage, the same decision the server would log', () => {
    const q = 'ରକ୍ତ କଣିକା';
    expect(planTurn(emptyMemory(), { safety: 'ok', text: q, hits: hits(q), online: false, now })).toMatchObject({ action: 'show_passage', topic: 'bio#2' });
  });
  it('picked subject has nothing → answers from the book that has it, and says so', () => {
    const other = buildBook({ ...meta, id: 'geo', subject: { or: 'ଭୂଗୋଳ', en: 'Geography' } }, [{ page: 3, text: 'ମୌସୁମୀ ବାୟୁ ବର୍ଷର କେତେକ ମାସରେ ଦିଗ ବଦଳାଇ ପ୍ରବାହିତ ହୁଏ ଓ ବର୍ଷା ଆଣେ । ଭାରତର କୃଷି ଏହି ବର୍ଷା ଉପରେ ନିର୍ଭର କରେ ।' }]);
    const sh = new Shelf([book, other]);
    const q = 'ମୌସୁମୀ ବାୟୁ';
    expect(planTurn(emptyMemory(), { safety: 'ok', text: q, hits: sh.search(q), bookIds: ['bio'], online: true, now })).toMatchObject({ action: 'explain', switchedBook: 'geo' });
  });
  it('the agent opens the next session itself: a weak topic not seen for 6 h → review offer', () => {
    const m: TutorMemory = { ...emptyMemory(), topics: { 'bio#1': { pKnown: 0.3, checks: 2, right: 0, wrongInARow: 2, doubts: 1, lastAt: now - 7 * 3600_000, tried: [] } } };
    expect(openerFor(m, now)).toMatchObject({ kind: 'review', topic: 'bio#1' });
    expect(openerFor(emptyMemory(), now).kind).toBe('welcome');
  });
});

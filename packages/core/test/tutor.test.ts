import { describe, expect, it } from 'vitest';
import { applyTurn, buildBook, cleanOcr, emptyMemory, fixOdiaOcr, focusQuote, extractGlossary, looksLikeAnswer, openerFor, planTurn, Shelf, topicKey, type BookMeta, type TutorMemory } from '../src/index.ts';

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
    expect(looksLikeAnswer('rakto konika kete prokar', m.check)).toBe(false);
    // no question word, but her words are clearly another chapter's → a new question, not her answer
    const other = { passage: { id: 'x.p1.1', page: 1, ch: 9, text: '' }, bookId: 'geo', score: 50, coverage: 1 };
    expect(looksLikeAnswer('mausumi bayu', m.check, [other])).toBe(false);
    // a one-word reply ("no") is her answer even when that word fills a page of another book (a poem)
    expect(looksLikeAnswer('no', m.check, [other])).toBe(true);
    expect(looksLikeAnswer('ଏହା ଦୃଢ଼ତା ଦିଏ', m.check, [{ ...other, coverage: 0.33 }])).toBe(true);
    expect(looksLikeAnswer('ଏହା ଦୃଢ଼ତା ଦିଏ', m.check, [other, { ...other, bookId: 'bio', passage: { ...other.passage, ch: 1 } }])).toBe(true);
    expect(planTurn(m, { safety: 'ok', text: 'ଏହା ଦୃଢ଼ତା ଦିଏ', hits: [], online: true, now }).action).toBe('grade');
  });
  it('a new question closes the old check at once and gets its own check', () => {
    const m: TutorMemory = { ...emptyMemory(), check: { question: 'old?', keyIdeas: [], topic: 'bio#9', passageIds: [], askedAt: now, ignored: 0, tries: 0 } };
    const q = 'କୋଷ ପ୍ରାଚୀର କ\'ଣ';
    const p = planTurn(m, { safety: 'ok', text: q, hits: hits(q), online: true, now });
    expect(p.askCheck).toBe(true);
    expect(applyTurn(m, { plan: p, now }).check).toBeUndefined();
    expect(applyTurn(m, { plan: p, now, newCheck: { question: 'new?', keyIdeas: [], topic: p.topic!, passageIds: [] } }).check?.question).toBe('new?');
    // offline the answer is kept for grading later
    expect(applyTurn(m, { plan: { ...p, action: 'show_passage' }, now }).check?.question).toBe('old?');
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
  it('picked subject has nothing → not answered from another subject: she is sent to that subject chat', () => {
    const other = buildBook({ ...meta, id: 'geo', subject: { or: 'ଭୂଗୋଳ', en: 'Geography' } }, [{ page: 3, text: 'ମୌସୁମୀ ବାୟୁ ବର୍ଷର କେତେକ ମାସରେ ଦିଗ ବଦଳାଇ ପ୍ରବାହିତ ହୁଏ ଓ ବର୍ଷା ଆଣେ । ଭାରତର କୃଷି ଏହି ବର୍ଷା ଉପରେ ନିର୍ଭର କରେ ।' }]);
    const sh = new Shelf([book, other]);
    const q = 'ମୌସୁମୀ ବାୟୁ';
    const p = planTurn(emptyMemory(), { safety: 'ok', text: q, hits: sh.search(q), bookIds: ['bio'], online: true, now });
    expect(p).toMatchObject({ action: 'other_subject', otherBook: 'geo' });
    expect(p.grounding).toEqual([]);
    // one word is never enough to say it is another subject
    expect(planTurn(emptyMemory(), { safety: 'ok', text: 'ମୌସୁମୀ', hits: sh.search('ମୌସୁମୀ'), bookIds: ['bio'], online: true, now }).action).not.toBe('other_subject');
  });
  it('the agent opens the next session itself: a weak topic not seen for 6 h → review offer', () => {
    const m: TutorMemory = { ...emptyMemory(), topics: { 'bio#1': { pKnown: 0.3, checks: 2, right: 0, wrongInARow: 2, doubts: 1, lastAt: now - 7 * 3600_000, tried: [] } } };
    expect(openerFor(m, now)).toMatchObject({ kind: 'review', topic: 'bio#1' });
    expect(openerFor(emptyMemory(), now).kind).toBe('welcome');
  });
});

describe('readable book text (P8.16)', () => {
  it('fixes the OCR misreadings that repeat across the books, keeps real words', () => {
    expect(fixOdiaOcr('ଏଥୁରେ ମଧ୍ଯ ଶ୍ଵେତ ପୂଥୁବୀ ( Plasma )')).toBe('ଏଥିରେ ମଧ୍ୟ ଶ୍ୱେତ ପୃଥିବୀ (Plasma)');
    expect(fixOdiaOcr('ପଥୁରିଆ ମାଟି')).toBe('ପଥୁରିଆ ମାଟି');
    expect(fixOdiaOcr('ଅଧକ ଅଧୁକାଂଶ ମାନବାଧକାର')).toBe('ଅଧିକ ଅଧିକାଂଶ ମାନବାଧିକାର');
    expect(fixOdiaOcr('ଆଧୁନିକ ଅଧୁନା ସାଧକ ବାଧକ ପ୍ରତିରୋଧକାରୀ')).toBe('ଆଧୁନିକ ଅଧୁନା ସାଧକ ବାଧକ ପ୍ରତିରୋଧକାରୀ');
  });
  it('drops figure labels read as capitals, keeps abbreviations', () => {
    expect(cleanOcr('ରକ୍ତରେ AYR ZUR RBC ଓ DNA ଥାଏ ।')).toBe('ରକ୍ତରେ RBC ଓ DNA ଥାଏ ।');
  });
  it('the 📖 card quotes the sentences that answer the question, not the whole block', () => {
    const text = 'ରକ୍ତ ଏକ ତରଳ ସଂଯୋଜକ ଟିସୁ । ଏହାର ମାଟ୍ରିକ୍ସକୁ ପ୍ଲାଜମା କୁହାଯାଏ । ଶରୀରରେ ପ୍ରାୟ 5ରୁ 6 ଲିଟର ରକ୍ତ ଥାଏ । ଅଣୁଚକ୍ରିକା (Platelet) ରକ୍ତ ଜମାଟ ବାନ୍ଧିବାରେ ସାହାଯ୍ୟ କରେ । ରକ୍ତର pH 7.4 ଏବଂ ଏହା କ୍ଷାରୀୟ ।';
    const q = focusQuote(text, 'platelet kana kama kare', 120);
    expect(q).toContain('ଅଣୁଚକ୍ରିକା');
    expect(q.length).toBeLessThan(text.length);
    expect(focusQuote('ଛୋଟ ଅଂଶ ।', 'x')).toBe('ଛୋଟ ଅଂଶ ।');
  });
});

describe('guided lesson: subject → chapter → part by part (P8.19)', () => {
  const topic = topicKey('bio', 1);
  const parts = shelf.lessonParts('bio', 1, 1);
  const hitsOf = (i: number) => parts[i]!.map((passage) => ({ passage, bookId: 'bio', score: 1, coverage: 1 }));
  it('cuts a chapter into parts in page order, only its own passages', () => {
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.flat().every((p) => p.ch === 1)).toBe(true);
    expect(parts.flat().map((p) => p.page)).toEqual([...parts.flat().map((p) => p.page)].sort((a, b) => a - b));
  });
  it('teaches the next part, then checks; after the last part the lesson is done', () => {
    const p0 = planTurn(emptyMemory(), { safety: 'ok', text: '', hits: hitsOf(0), online: true, now: 1, learn: { topic, part: 0, parts: parts.length } });
    expect([p0.action, p0.topic, p0.askCheck, p0.strategy]).toEqual(['teach', topic, true, 'textbook']);
    const m = applyTurn(emptyMemory(), { plan: p0, now: 1, lesson: { topic, part: 1, parts: parts.length } });
    expect(m.lesson).toEqual({ topic, part: 1, parts: parts.length });
    const end = planTurn(m, { safety: 'ok', text: '', hits: [], online: true, now: 2, learn: { topic, part: parts.length, parts: parts.length } });
    expect(end.action).toBe('lesson_done');
    expect(applyTurn(m, { plan: end, now: 2, lesson: null }).lesson).toBeUndefined();
    // no signal: she reads the part from her book
    expect(planTurn(emptyMemory(), { safety: 'ok', text: '', hits: hitsOf(0), online: false, now: 1, learn: { topic, part: 0, parts: parts.length } }).action).toBe('show_passage');
  });
  it('in a lesson, her answer is graded and a wrong one may get a new check (she goes on until she has it)', () => {
    const m: TutorMemory = { ...emptyMemory(), lesson: { topic, part: 1, parts: parts.length }, check: { question: 'କୋଷ ପ୍ରାଚୀର କାହିଁକି ଦରକାର?', keyIdeas: ['support'], topic, passageIds: [parts[0]![0]!.id], askedAt: 1, ignored: 0, tries: 0 } };
    const g = planTurn(m, { safety: 'ok', text: 'ଏହା ଦୃଢ଼ତା ଦିଏ', hits: hitsOf(0), online: true, now: 2 });
    expect([g.action, g.askCheck]).toEqual(['grade', true]);
    const outside = planTurn({ ...m, lesson: undefined }, { safety: 'ok', text: 'ଏହା ଦୃଢ଼ତା ଦିଏ', hits: hitsOf(0), online: true, now: 2 });
    expect([outside.action, outside.askCheck]).toEqual(['grade', false]);
    // a new check written after a wrong answer replaces the old one
    const after = applyTurn(m, { plan: g, now: 3, grade: { verdict: 'wrong', gap: 'support' }, newCheck: { question: 'ସହଜ ପ୍ରଶ୍ନ?', keyIdeas: ['x'], topic, passageIds: [] } });
    expect([after.check?.question, after.topics[topic]!.wrongInARow, after.lesson?.part]).toEqual(['ସହଜ ପ୍ରଶ୍ନ?', 1, 1]);
  });
  it('a doubt asked inside the chapter she picked is answered from that chapter first', () => {
    const hits = [...shelf.search('କୋଷ ଟିସୁ ରକ୍ତ', { limit: 6 })].map((h) => ({ ...h, coverage: 1 }));
    const p = planTurn(emptyMemory(), { safety: 'ok', text: 'କୋଷ ଟିସୁ ରକ୍ତ କ\'ଣ?', hits, online: true, now: 1, chapter: topicKey('bio', 2) });
    expect(p.grounding[0]!.passage.ch).toBe(2);
  });
});

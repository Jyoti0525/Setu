import { describe, expect, it } from 'vitest';
import { buildBook, Shelf, type BookMeta } from '@setu/core';
import { Store } from '../src/db.ts';
import { buildModels, ScriptedLlm } from '../src/llm.ts';
import { Push } from '../src/push.ts';
import { openTutor, runTutor, type TutorDeps } from '../src/tutor/run.ts';

const meta: BookMeta = {
  id: 'bio', subject: { or: 'ଜୀବ ବିଜ୍ଞାନ', en: 'Life Science' }, title: { or: 'ଜୀବ ବିଜ୍ଞାନ', en: 'Life Science' }, classLevel: 9, board: 'BSE Odisha', source: 'test', pageOffset: 0,
  chapters: [{ n: 2, title: { or: 'ଜୀବକୋଷ', en: 'The cell' }, startPage: 1, endPage: 9 }],
};
const book = buildBook(meta, [
  { page: 23, text: 'ଜୀବର ମୌଳିକ ଏକକ କୋଷ । ଉଦ୍ଭିଦ କୋଷର ବାହାରେ କୋଷ ପ୍ରାଚୀର (Cell wall) ଥାଏ । ଏହା ସେଲୁଲୋଜରେ ତିଆରି ଓ କୋଷକୁ ଦୃଢ଼ତା ଦିଏ । ପ୍ରାଣୀ କୋଷରେ କୋଷ ପ୍ରାଚୀର ନଥାଏ ।' },
].map((p) => ({ ...p, page: 5 })));
const PID = 'p-chat';
const promptOf = (r: { contents?: { parts?: { text?: string }[] }[] }) => (r.contents ?? []).flatMap((c) => c.parts ?? []).map((p) => p.text ?? '').join('\n');

function setup(writer?: (prompt: string) => string | Error) {
  const store = new Store();
  const gen = writer ? new ScriptedLlm((r) => writer(promptOf(r as never))) : undefined;
  const models = buildModels({}, gen ? { generate: { scripted: gen } } : {});
  const traces: unknown[] = [];
  let now = 1_760_000_000_000;
  const d: TutorDeps = { store, shelf: new Shelf([book]), models, now: () => now, onTrace: (_p, t) => traces.push(t) };
  const say = (text: string, extra: object = {}) => runTutor(d, { profileId: PID, deviceId: 'phone', text, lang: 'or', ...extra });
  return { d, store, gen, traces, say, later: (ms: number) => { now += ms; } };
}
const pid = book.passages[0]!.id;
const explainJson = JSON.stringify({ reply: 'ଉଦ୍ଭିଦ କୋଷର ବାହାରେ କୋଷ ପ୍ରାଚୀର (Cell wall) ଥାଏ, ଯାହା କୋଷକୁ ଦୃଢ଼ କରେ। (ବହି ପୃଷ୍ଠା 5)', used: [pid, 'made.up.id'], terms: [{ or: 'କୋଷ ପ୍ରାଚୀର', en: 'Cell wall' }], check: { question: 'ଉଦ୍ଭିଦ କୋଷକୁ କୋଷ ପ୍ରାଚୀର କାହିଁକି ଦରକାର?', key_ideas: ['gives strength / shape'] } });

describe('tutor chat agent (PLAN v4)', () => {
  it('explains from her textbook with the page, asks its own check, and traces every tool in order', async () => {
    const { say, traces, store } = setup((p) => (p.includes('TASK: Answer her question') ? explainJson : new Error('unexpected')));
    const r = await say('koshika prachira kana?');
    expect(r.messages[0]).toMatchObject({ by: 'model', check: 'ଉଦ୍ଭିଦ କୋଷକୁ କୋଷ ପ୍ରାଚୀର କାହିଁକି ଦରକାର?', terms: [{ or: 'କୋଷ ପ୍ରାଚୀର', en: 'Cell wall' }] });
    // the model cited an id that does not exist: dropped, the real page stays
    expect(r.messages[0]!.sources!.map((s) => [s.passageId, s.page])).toEqual([[pid, 5]]);
    expect(r.trace.tools.map((t) => t.tool)).toEqual(['safety.screen', 'books.search', 'memory.recall', 'model.write', 'memory.update']);
    expect(r.trace).toMatchObject({ chosen: 'explain bio#2', decided_by: 'llm', status: 'ok' });
    expect(traces).toHaveLength(1);
    expect(store.tutorLog(PID).map((l) => l.role)).toEqual(['student', 'tutor']);
    expect(r.memory.check).toContain('କାହିଁକି');
  });

  it('grades her answer against the check and the same pages; mastery moves only on a grade', async () => {
    let graded = '';
    const { say } = setup((p) => {
      if (p.includes('OPEN CHECK QUESTION')) { graded = p; return JSON.stringify({ intent: 'answer', reply: 'ଠିକ୍! ପ୍ରାଚୀର କୋଷକୁ ଦୃଢ଼ତା ଦିଏ।', used: [pid], terms: [], grade: { verdict: 'right' }, check: null }); }
      return explainJson;
    });
    await say('koshika prachira kana?');
    const r = await say('ଦୃଢ଼ତା ଦିଏ');
    expect(graded).toContain('ଉଦ୍ଭିଦ କୋଷକୁ କୋଷ ପ୍ରାଚୀର କାହିଁକି ଦରକାର?');
    expect(r.trace.tools.map((t) => t.tool)).toContain('books.open');
    expect(r.messages[0]).toMatchObject({ tone: 'praise' });
    expect(r.memory.topics[0]!.pKnown).toBeGreaterThan(0.3);
    expect(r.memory.check).toBeUndefined();
  });

  it('not in her book and no page used → no page card (the nearest search hit is unrelated)', async () => {
    const { say } = setup((p) => (p.includes('not in her textbook') ? JSON.stringify({ reply: 'ଏହା ତୁମ ବହିରେ ନାହିଁ। ଜଳଚକ୍ରରେ ପାଣି ବାଷ୍ପ ହୋଇ ମେଘ ହୁଏ।', used: [], terms: [] }) : explainJson));
    const r = await say('water cycle diagram explain with cell');
    expect(r.trace.chosen).toMatch(/^not_in_book/);
    expect(r.messages[0]!.sources).toBeUndefined();
  });

  it('model down → her textbook page and an honest line, never an error; nothing graded', async () => {
    const { say } = setup(() => new Error('503 overloaded'));
    const r = await say('koshika prachira kana?');
    expect(r.trace.status).toBe('fallback');
    expect(r.messages[0]).toMatchObject({ by: 'policy', tone: 'offline' });
    expect(r.messages[0]!.sources![0]!.passageId).toBe(pid);
  });

  it('distress: care message + helplines, quiet teacher alert, no model call, her words not kept', async () => {
    const { say, gen, store } = setup(() => explainJson);
    const r = await say('ମୁଁ ମରିଯିବି, କେହି ମୋତେ ଭଲ ପାଏନି');
    expect(r.messages[0]!.text).toContain('1098');
    expect(r.messages[0]!.tone).toBe('care');
    expect(gen!.calls).toHaveLength(0);
    expect(store.events(PID).map((e) => [e.type, (e.payload as { kind: string }).kind])).toEqual([['ESCALATED', 'wellbeing']]);
    expect(store.tutorLog(PID).some((l) => l.text.includes('ମରିଯିବି'))).toBe(false);
  });

  it('wrong again and again on one chapter → her teacher is told once, with the gap', async () => {
    const { say, store } = setup((p) => (p.includes('OPEN CHECK QUESTION')
      ? JSON.stringify({ intent: 'answer', reply: 'ଏଥର ଠିକ୍ ହେଲା ନାହିଁ।', used: [pid], terms: [], grade: { verdict: 'wrong', gap: 'thinks the wall is inside the cell' }, check: null })
      : explainJson));
    let last;
    for (let i = 0; i < 3; i++) { await say('koshika prachira kana?'); await say('ଭିତରେ ଥାଏ'); last = await say('ଜାଣିନି'); }
    const esc = store.events(PID).filter((e) => e.type === 'ESCALATED');
    expect(esc).toHaveLength(1);
    expect((esc[0]!.payload as { reason: string }).reason).toMatch(/thinks the wall is inside/);
    expect(JSON.stringify(last)).toBeTruthy();
  });

  it('opens the next session itself: a weak chapter → a review offer; accepting it asks a fresh check', async () => {
    const { d, say, later } = setup((p) => (p.includes('OPEN CHECK QUESTION')
      ? JSON.stringify({ intent: 'answer', reply: 'ନା।', used: [pid], terms: [], grade: { verdict: 'wrong' }, check: null })
      : p.includes('starting a review') ? JSON.stringify({ reply: 'ମନେ ପକାଅ: ପ୍ରାଚୀର କୋଷକୁ ଦୃଢ଼ କରେ।', used: [pid], terms: [], check: { question: 'ପ୍ରାଣୀ କୋଷରେ ପ୍ରାଚୀର ଥାଏ କି? କାହିଁକି?', key_ideas: ['no wall in animal cells'] } }) : explainJson));
    await say('koshika prachira kana?');
    await say('ପାଣି');
    later(8 * 3600_000);
    // the check she missed is still open (one more try): the session opens by asking it again
    const first = openTutor(d, { profileId: PID, lang: 'or' });
    expect(first.messages[0]!.check).toBe('ଉଦ୍ଭିଦ କୋଷକୁ କୋଷ ପ୍ରାଚୀର କାହିଁକି ଦରକାର?');
    await say('ଖାଦ୍ୟ');
    later(8 * 3600_000);
    const o = openTutor(d, { profileId: PID, lang: 'or' });
    expect(o.messages[0]!.chips?.[0]).toMatchObject({ review: 'bio#2' });
    const r = await say('', { review: 'bio#2' });
    expect(r.trace.chosen).toMatch(/^review bio#2/);
    expect(r.messages[0]!.check).toContain('ପ୍ରାଣୀ କୋଷରେ');
  });

  it('3 wrong in a row → ESCALATED with evidence, she is told, and her class teacher’s phone buzzes (no name, no words)', async () => {
    const { d, store, say, later } = setup((p) => p.includes('OPEN CHECK QUESTION')
      ? JSON.stringify({ intent: 'answer', reply: 'ପୁଣି ଦେଖିବା।', used: [pid], terms: [], grade: { verdict: 'wrong', gap: 'thinks the wall is in animal cells' }, check: { question: 'ପ୍ରାଣୀ କୋଷରେ ପ୍ରାଚୀର ଅଛି କି?', key_ideas: ['no wall'] } })
      : explainJson);
    // she joined Mrs Das's class; the teacher turned alerts on for her phone
    store.append([{ id: 'j1', profileId: PID, deviceId: 'phone', seq: 1, ts: 1, type: 'CLASS_JOINED', payload: { classCode: '482913' } } as never], 1);
    const sent: { to: string; body: string }[] = [];
    const push = new Push(store, { send: async (s, p) => { sent.push({ to: (s as { endpoint: string }).endpoint, body: p }); } });
    push.subscribe('teacher-phone', 'class:482913', { endpoint: 'https://push.example/teacher', keys: { p256dh: 'k', auth: 'a' } }, 'en');
    const noonIst = Date.UTC(2026, 9, 14, 6, 30);
    d.onEscalate = (p, kind, chapter) => { for (const code of store.classesOf(p)) void push.teacherAlert(code, kind, chapter, noonIst); };

    await say('koshika prachira kana?');
    const r1 = await say('pata'); later(60_000);
    const r2 = await say('jani nahi'); later(60_000);
    expect([r1, r2].some((r) => r.messages.some((m) => m.tone === 'teacher'))).toBe(false);
    const r3 = await say('achhi');
    expect(r3.messages.at(-1)).toMatchObject({ tone: 'teacher', by: 'policy' });
    expect(r3.trace.tools.map((t) => t.tool)).toContain('teacher.notify');
    const esc = store.events(PID).filter((e) => e.type === 'ESCALATED');
    expect(esc).toHaveLength(1);
    expect(JSON.stringify(esc[0]!.payload)).toContain('Not right after 3 tries in a row');
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([{ to: 'https://push.example/teacher', body: JSON.stringify({ title: 'Setu · Teacher', body: 'A learner is stuck and needs you. (The cell)', url: '/#teacher' }) }]);
    // a 4th wrong answer the same day: no second alert (once per chapter per 3 days)
    await say('jani nahi');
    expect(store.events(PID).filter((e) => e.type === 'ESCALATED')).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
});

describe('one chat, one subject', () => {
  const geo = buildBook({ ...meta, id: 'geo', subject: { or: 'ଭୂଗୋଳ', en: 'Geography' }, title: { or: 'ଭୂଗୋଳ', en: 'Geography' }, chapters: [{ n: 4, title: { or: 'ଜଳବାୟୁ', en: 'Climate' }, startPage: 1, endPage: 9 }] },
    [{ page: 5, text: 'ମୌସୁମୀ ବାୟୁ ବର୍ଷର କେତେକ ମାସରେ ଦିଗ ବଦଳାଇ ପ୍ରବାହିତ ହୁଏ ଓ ବର୍ଷା ଆଣେ । ଭାରତର କୃଷି ଏହି ବର୍ଷା ଉପରେ ନିର୍ଭର କରେ ।' }]);
  function two(writer: (p: string) => string, reviewer?: (p: string) => string) {
    const store = new Store();
    const gen = new ScriptedLlm((r) => writer(promptOf(r as never)));
    const rev = reviewer ? new ScriptedLlm((r) => reviewer(promptOf(r as never))) : undefined;
    const models = buildModels({}, { generate: { scripted: gen }, ...(rev ? { decide: { scripted: rev } } : {}) });
    const d: TutorDeps = { store, shelf: new Shelf([book, geo]), models, now: () => 1_760_000_000_000 };
    return { d, say: (text: string) => runTutor(d, { profileId: PID, deviceId: 'phone', text, lang: 'en', bookIds: ['bio'], board: 'BSE Odisha', memoryScope: 'subject:bio' }) };
  }
  it('a question from another subject is not answered here: she is sent to that subject, with a button', async () => {
    const { say } = two(() => { throw new Error('the model must not be asked'); });
    const r = await say('ମୌସୁମୀ ବାୟୁ କ\'ଣ');
    expect(r.trace.chosen).toContain('other_subject');
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.text).toContain('Geography');
    expect(r.messages[0]!.text).toContain('Life Science');
    expect(r.messages[0]!.chips).toEqual([{ label: 'Open Geography', subject: ['geo'], text: "ମୌସୁମୀ ବାୟୁ କ'ଣ" }]);
    expect(r.messages[0]!.sources).toBeUndefined();
  });
  it('the reviewer rejects a reply that left the subject → written again; with the reason', async () => {
    let writes = 0;
    const good = JSON.stringify({ reply: 'A plant cell has a cell wall made of cellulose. It gives the cell strength. (book page 5)', used: [pid], terms: [], check: null });
    const poem = JSON.stringify({ reply: 'The poet says no man is a foreigner.', used: [pid], terms: [], check: null });
    const { say } = two(() => (++writes === 1 ? poem : good), (p) => JSON.stringify(p.includes('poet') ? { ok: false, why: 'talks about a poem' } : { ok: true }));
    const r = await say('koshika prachira kana');
    expect(writes).toBe(2);
    expect(r.messages[0]!.text).toContain('cellulose');
    expect(r.trace.tools.find((t) => t.tool === 'critic.review')).toMatchObject({ status: 'failed' });
  });
  it('the reviewer sees her question is another subject (a stray page matched here) → sent to that subject, not answered', async () => {
    const reply = JSON.stringify({ reply: 'Monsoon winds bring rain. (book page 5)', used: [pid], terms: [], check: null });
    const { say } = two(() => reply, () => JSON.stringify({ ok: false, why: 'monsoon is geography', asked_about: 'Geography' }));
    const r = await say('koshika prachira kana');
    expect(r.trace.chosen).toContain('other_subject');
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.chips).toEqual([{ label: 'Open Geography', subject: ['geo'], text: 'koshika prachira kana' }]);
    expect(r.messages[0]!.sources).toBeUndefined();
  });
  it('the reviewer passes an on-subject reply untouched', async () => {
    let writes = 0;
    const good = JSON.stringify({ reply: 'A plant cell has a cell wall made of cellulose. (book page 5)', used: [pid], terms: [], check: null });
    const { say } = two(() => (++writes, good), () => JSON.stringify({ ok: true }));
    const r = await say('koshika prachira kana');
    expect(writes).toBe(1);
    expect(r.trace.tools.find((t) => t.tool === 'critic.review')).toMatchObject({ status: 'ok' });
  });
});

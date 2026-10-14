import { describe, expect, it } from 'vitest';
import { buildBook, Shelf, type BookMeta } from '@setu/core';
import { Store } from '../src/db.ts';
import { buildModels, ScriptedLlm } from '../src/llm.ts';
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
    await say('ଜାଣିନି');
    later(8 * 3600_000);
    // the check she missed is still open (one more try): the session opens by asking it again
    const first = openTutor(d, { profileId: PID, lang: 'or' });
    expect(first.messages[0]!.check).toBe('ଉଦ୍ଭିଦ କୋଷକୁ କୋଷ ପ୍ରାଚୀର କାହିଁକି ଦରକାର?');
    await say('ମୁଁ ଜାଣିନି');
    later(8 * 3600_000);
    const o = openTutor(d, { profileId: PID, lang: 'or' });
    expect(o.messages[0]!.chips?.[0]).toMatchObject({ review: 'bio#2' });
    const r = await say('', { review: 'bio#2' });
    expect(r.trace.chosen).toMatch(/^review bio#2/);
    expect(r.messages[0]!.check).toContain('ପ୍ରାଣୀ କୋଷରେ');
  });
});

// Sign-in (Firebase) never stands between her and learning; a check left open in one subject waits in that subject.
import { describe, expect, it } from 'vitest';
import { buildBook, Shelf, type BookMeta } from '@setu/core';
import { motionPack } from '@setu/content';
import { Store } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { buildModels, ScriptedLlm } from '../src/llm.ts';
import { memoryOf, runTutor, type TutorDeps } from '../src/tutor/run.ts';
import type { FirebaseTokenVerifier } from '../src/firebase_auth.ts';

const verifier: FirebaseTokenVerifier = {
  async verifyIdToken(t) { if (t !== 'good') throw new Error('bad token'); return { uid: 'u1', email: 'a@example.com', emailVerified: true }; },
};

async function setup(o: { firebaseAuth?: FirebaseTokenVerifier; firebaseWeb?: { apiKey: string; authDomain: string; projectId: string } } = {}) {
  const { app } = createApp({ store: new Store(), packs: [motionPack], models: buildModels({}), liveGenLangs: [], ...o });
  const dev = (await (await app.request('/api/device', { method: 'POST' })).json()) as { token: string };
  return { app, dev };
}

describe('sign-in (Firebase)', () => {
  it('gives the web app its public config at run time, or nothing when sign-in is not set up', async () => {
    const on = await setup({ firebaseWeb: { apiKey: 'k', authDomain: 'p.firebaseapp.com', projectId: 'p' } });
    expect(await (await on.app.request('/api/auth/config')).json()).toEqual({ apiKey: 'k', authDomain: 'p.firebaseapp.com', projectId: 'p' });
    const off = await setup();
    expect(await (await off.app.request('/api/auth/config')).json()).toEqual({});
  });
  it('knows who is signed in; a bad or stale sign-in never blocks learning (the device token is her key)', async () => {
    const { app, dev } = await setup({ firebaseAuth: verifier });
    expect(await (await app.request('/api/auth/session', { headers: { authorization: 'Bearer good' } })).json()).toMatchObject({ authenticated: true, user: { uid: 'u1' } });
    expect((await app.request('/api/auth/session', { headers: { authorization: 'Bearer stale' } })).status).toBe(401);
    for (const auth of ['Bearer stale', 'Bearer good']) {
      expect((await app.request('/api/books', { headers: { authorization: auth, 'x-device-token': dev.token } })).status).toBe(200);
    }
    // a server with no sign-in set up ignores the header too
    const plain = await setup();
    expect((await plain.app.request('/api/books', { headers: { authorization: 'Bearer good', 'x-device-token': plain.dev.token } })).status).toBe(200);
  });
});

const meta: BookMeta = {
  id: 'bio', subject: { or: 'ଜୀବ ବିଜ୍ଞାନ', en: 'Life Science' }, title: { or: 'ଜୀବ ବିଜ୍ଞାନ', en: 'Life Science' }, classLevel: 9, board: 'BSE Odisha', source: 'test', pageOffset: 0,
  chapters: [{ n: 2, title: { or: 'ଜୀବକୋଷ', en: 'The cell' }, startPage: 1, endPage: 9 }],
};
const book = buildBook(meta, [{ page: 5, text: 'ଜୀବର ମୌଳିକ ଏକକ କୋଷ । ଉଦ୍ଭିଦ କୋଷର ବାହାରେ କୋଷ ପ୍ରାଚୀର (Cell wall) ଥାଏ । ଏହା ସେଲୁଲୋଜରେ ତିଆରି ଓ କୋଷକୁ ଦୃଢ଼ତା ଦିଏ ।' }]);
const pid = book.passages[0]!.id;

describe('a check per subject (memoryScope)', () => {
  it('a check asked in one subject stays there; her topics are shared by all subjects', async () => {
    const store = new Store();
    const gen = new ScriptedLlm(() => JSON.stringify({ reply: 'ଉଦ୍ଭିଦ କୋଷର ବାହାରେ କୋଷ ପ୍ରାଚୀର ଥାଏ। (ବହି ପୃଷ୍ଠା 5)', used: [pid], terms: [], check: { question: 'କୋଷ ପ୍ରାଚୀର କାହିଁକି ଦରକାର?', key_ideas: ['strength'] } }));
    const d: TutorDeps = { store, shelf: new Shelf([book]), models: buildModels({}, { generate: { scripted: gen } }), now: () => 1_760_000_000_000 };
    await runTutor(d, { profileId: 'p1', deviceId: 'phone', text: 'koshika prachira kana?', lang: 'or', memoryScope: 'subject:bio' });
    expect(memoryOf(store, 'p1', 'subject:bio').check?.question).toContain('କାହିଁକି');
    expect(memoryOf(store, 'p1', 'subject:maths').check).toBeUndefined();
    expect(Object.keys(memoryOf(store, 'p1', 'subject:maths').topics)).toEqual(Object.keys(memoryOf(store, 'p1', 'subject:bio').topics));
  });
});

describe('the whole chapter', () => {
  it('"explain the whole chapter" in a picked chapter becomes its lesson, part by part', async () => {
    const store = new Store();
    const gen = new ScriptedLlm(() => JSON.stringify({ reply: 'ଉଦ୍ଭିଦ କୋଷର ବାହାରେ କୋଷ ପ୍ରାଚୀର ଥାଏ। (ବହି ପୃଷ୍ଠା 5)', used: [pid], terms: [], check: { question: 'କୋଷ ପ୍ରାଚୀର କାହିଁକି ଦରକାର?', key_ideas: ['strength'] } }));
    const d: TutorDeps = { store, shelf: new Shelf([book]), models: buildModels({}, { generate: { scripted: gen } }), now: () => 1_760_000_000_000 };
    const r = await runTutor(d, { profileId: 'p2', deviceId: 'phone', text: 'please explain the whole chapter', lang: 'en', chapter: 'bio#2', memoryScope: 'subject:bio' });
    expect(r.trace.tools.some((t) => t.tool === 'intent.whole_chapter')).toBe(true);
    expect(r.trace.tools.some((t) => t.tool === 'books.open')).toBe(true);
    // an ordinary doubt in the same chapter is still just answered
    const q = await runTutor(d, { profileId: 'p3', deviceId: 'phone', text: 'what is a cell wall?', lang: 'en', chapter: 'bio#2', memoryScope: 'subject:bio' });
    expect(q.trace.tools.some((t) => t.tool === 'intent.whole_chapter')).toBe(false);
  });
});

describe('when she does not get it', () => {
  it('"I don\'t know" answers the open check (never a search of other books); three in a row tell her teacher', async () => {
    const store = new Store();
    const gen = new ScriptedLlm(() => JSON.stringify({ intent: 'answer', reply: 'Think of a cell wall like a fence around a garden. (book page 5)', used: [pid], terms: [], grade: { verdict: 'right' }, check: { question: 'Why does a plant cell need a wall?', key_ideas: ['strength'] } }));
    const d: TutorDeps = { store, shelf: new Shelf([book]), models: buildModels({}, { generate: { scripted: gen } }), now: () => 1_760_000_000_000 };
    const at = { profileId: 'p4', deviceId: 'phone', lang: 'en', bookIds: ['bio'], memoryScope: 'subject:bio' };
    await runTutor(d, { ...at, text: 'koshika prachira kana?' });
    const tones: (string | undefined)[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await runTutor(d, { ...at, text: "I don't know, explain again" });
      expect(r.trace.chosen).toMatch(/^grade/);
      tones.push(...r.messages.map((m) => m.tone));
      if (i < 2) expect(tones).not.toContain('teacher');
    }
    // the model said "right", but she said she does not know: graded not yet, three times → her teacher is told
    expect(tones).toContain('teacher');
    expect(memoryOf(store, 'p4', 'subject:bio').topics['bio#2']!.wrongInARow).toBe(3);
  });
});

describe('one book per medium', () => {
  const en: BookMeta = { ...meta, id: 'sci', board: 'CBSE', subject: { or: 'ବିଜ୍ଞାନ', en: 'Science' }, lang: 'en' };
  const hi: BookMeta = { ...en, id: 'sci-hi', lang: 'hi' };
  const enBook = buildBook(en, [{ page: 5, text: 'A plant cell has a cell wall outside the cell membrane. The cell wall is made of cellulose and gives the cell strength.' }]);
  const hiBook = buildBook(hi, [{ page: 5, text: 'पादप कोशिका के बाहर कोशिका भित्ति होती है। यह सेल्यूलोज़ से बनी होती है और कोशिका को मज़बूती देती है। cell wall cellulose strength' }]);
  it('an English learner with the Hindi twin saved is taught from the English book', async () => {
    const store = new Store();
    const gen = new ScriptedLlm(() => JSON.stringify({ reply: 'A cell wall gives the cell strength. (book page 5)', used: [enBook.passages[0]!.id], terms: [], check: { question: 'What is a cell wall made of?', options: ['Cellulose', 'Starch', 'Protein'], answer: 0, key_ideas: ['cellulose'] } }));
    const d: TutorDeps = { store, shelf: new Shelf([enBook, hiBook]), models: buildModels({}, { generate: { scripted: gen } }), now: () => 1_760_000_000_000 };
    const at = { profileId: 'p5', deviceId: 'phone', lang: 'en', bookIds: ['sci-hi'], memoryScope: 'subject:sci-hi' };
    const r = await runTutor(d, { ...at, text: 'plant cell wall made of cellulose gives strength?' });
    expect(r.messages[0]!.sources?.map((s) => s.bookId)).toEqual(['sci']);
    // a tap-to-answer check, graded by the choice she tapped
    expect(r.messages[0]!.options).toEqual(['Cellulose', 'Starch', 'Protein']);
    const g = await runTutor(d, { ...at, text: 'Starch' });
    expect(g.trace.chosen).toMatch(/^grade/);
    expect(g.messages[0]!.tone).toBe('retry');
  });
});

describe('teacher accounts', () => {
  it('a class belongs to the teacher who made it: listed and opened on her account only; an old key class can be added', async () => {
    const two: FirebaseTokenVerifier = { async verifyIdToken(t) { if (t === 't1' || t === 't2') return { uid: t, email: `${t}@example.com`, emailVerified: true }; throw new Error('bad'); } };
    const { app, dev } = await setup({ firebaseAuth: two });
    const as = (who: string, extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', 'x-device-token': dev.token, authorization: `Bearer ${who}`, ...extra });
    // not signed in: no class can be made
    expect((await app.request('/api/class', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': dev.token }, body: JSON.stringify({ name: '9A' }) })).status).toBe(401);
    const a = (await (await app.request('/api/class', { method: 'POST', headers: as('t1'), body: JSON.stringify({ name: '9A Science', lang: 'en' }) })).json()) as { code: string; token: string };
    expect(await (await app.request('/api/teacher/classes', { headers: as('t1') })).json()).toMatchObject([{ code: a.code, name: '9A Science', size: 0, needs: 0 }]);
    expect(await (await app.request('/api/teacher/classes', { headers: as('t2') })).json()).toEqual([]);
    // opened by her account (no key), never by another teacher's
    expect((await app.request('/api/teacher', { headers: as('t1', { 'x-class-code': a.code }) })).status).toBe(200);
    expect((await app.request('/api/teacher', { headers: as('t2', { 'x-class-code': a.code }) })).status).toBe(403);
    // her key still works, and another teacher cannot take her class with it
    expect((await app.request('/api/teacher', { headers: as('t2', { 'x-teacher-token': a.token }) })).status).toBe(200);
    expect((await app.request('/api/teacher/claim', { method: 'POST', headers: as('t2'), body: JSON.stringify({ key: a.token }) })).status).toBe(409);
    expect((await app.request('/api/teacher/claim', { method: 'POST', headers: as('t1'), body: JSON.stringify({ key: 'nope' }) })).status).toBe(403);
  });

  it('"I told your teacher" only when she is in a class; otherwise a button to join one', async () => {
    const store = new Store();
    const gen = new ScriptedLlm(() => JSON.stringify({ intent: 'answer', reply: 'Think of a cell wall like a fence around a garden. (book page 5)', used: [pid], terms: [], grade: { verdict: 'wrong' }, check: { question: 'Why does a plant cell need a wall?', key_ideas: ['strength'] } }));
    const d: TutorDeps = { store, shelf: new Shelf([book]), models: buildModels({}, { generate: { scripted: gen } }), now: () => 1_760_000_000_000 };
    const stuck = async (profileId: string) => {
      const at = { profileId, deviceId: 'phone', lang: 'en', bookIds: ['bio'], memoryScope: 'subject:bio' };
      await runTutor(d, { ...at, text: 'koshika prachira kana?' });
      const out = [];
      for (let i = 0; i < 3; i++) out.push(...(await runTutor(d, { ...at, text: "I don't know" })).messages);
      return out.filter((m) => m.tone === 'teacher');
    };
    const alone = await stuck('p6');
    expect(alone[0]!.chips?.[0]?.join).toBe(true);
    store.createClass({ code: '123456', name: '9A', lang: 'en', tokenHash: 'x' });
    store.append([{ id: 'p7-j', profileId: 'p7', deviceId: 'phone', seq: 1, ts: 1, type: 'CLASS_JOINED', payload: { classCode: '123456' } } as never], 1);
    const inClass = await stuck('p7');
    expect(inClass[0]!.chips).toBeUndefined();
    expect(inClass[0]!.text).toMatch(/teacher know/);
  });
});

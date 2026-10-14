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

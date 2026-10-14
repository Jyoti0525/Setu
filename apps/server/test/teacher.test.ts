// Teacher view (PLAN §9.2, TODO P5.6–P5.12, P5.24): class in one step, needs-you with evidence, wellbeing apart,
// drop-off, class-level reteach (approve/edit), exam date → goals, class-scoped token.
import { describe, expect, it } from 'vitest';
import { fold, examProximity, DAY, type AnyEvent } from '@setu/core';
import { motionPack } from '@setu/content';
import { Store } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { buildModels } from '../src/llm.ts';

const NOW = Date.now();

function setup() {
  const store = new Store();
  const { app } = createApp({ store, packs: [motionPack], models: buildModels({}), liveGenLangs: [], adminKey: 'k' });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.request(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };
  return { store, call };
}

let seq = 0;
const learner = (pid: string, events: [string, unknown, number?][]): AnyEvent[] =>
  events.map(([type, payload, ts]) => ({ id: `${pid}-${++seq}`, profileId: pid, deviceId: 'x', seq, ts: ts ?? NOW - 3600_000 + seq, type, payload } as AnyEvent));
const profile = (avatar = '👧'): [string, unknown] => ['PROFILE_CREATED', { avatar, classLevel: 9, board: 'BSE-Odisha', language: { ui: 'or', response: 'or', inputMode: 'text', readingLevel: 3 }, dataTier: 'low', sharedDevice: true }];
const graded = (c: string, correct: boolean, mis: string[] = [], ts?: number): [string, unknown, number?] => ['ANSWER_GRADED', { checkId: `x.${c}`, conceptId: c, correct, confidence: 1, source: 'bank', misconceptionIds: mis }, ts];
const trap = (ts?: number) => graded('velocity', false, ['speed_equals_velocity'], ts);

describe('teacher view', () => {
  it('one class: needs-you with evidence, wellbeing kept apart, drop-off, class reteach, scoped token', async () => {
    const { call } = setup();
    const dev = (await call('POST', '/api/device')).json;
    const H = { 'x-device-token': dev.token };
    const cls = (await call('POST', '/api/class', { name: '9A Science', lang: 'or' }, H)).json;
    expect(cls.code).toMatch(/^\d{6}$/);
    expect(cls.token.length).toBeGreaterThan(20);
    // learner side sees the class only (name, its region, its home-language words) — nothing about other learners
    const pub = (await call('GET', `/api/class/${cls.code}`, undefined, H)).json as Record<string, unknown>;
    expect(pub).toMatchObject({ code: cls.code, name: '9A Science', anchors: {} });
    expect(Object.keys(pub).every((k) => ['code', 'name', 'anchors', 'region'].includes(k))).toBe(true);

    const join = (name?: string): [string, unknown] => ['CLASS_JOINED', { classCode: cls.code, ...(name ? { displayName: name } : {}) }];
    const sync = (pid: string, evs: AnyEvent[]) => call('POST', '/api/sync', { profileId: pid, cursor: 0, outbox: evs }, H);
    // Sunita: stuck on velocity (3 strategies, confirmed misconception) → escalated
    await sync('sunita', learner('sunita', [profile(), join('Sunita'),
      ...['definition', 'contrast', 'analogy'].flatMap((st) => [['EXPLANATION_DELIVERED', { conceptId: 'velocity', strategy: st, level: 3 }] as [string, unknown], trap()]),
      ['ESCALATED', { conceptId: 'velocity', kind: 'academic', reason: '3 strategies tried on velocity without success' }]]));
    // Ravi: same misconception (confirmed); a wellbeing flag
    await sync('ravi', learner('ravi', [profile('👦'), join(), trap(), trap(), ['ESCALATED', { kind: 'wellbeing', reason: 'distress words in a doubt' }]]));
    // Mina: inactive for 5 days
    const old = NOW - 5 * DAY;
    await sync('mina', learner('mina', [[...profile(), old - 2], [...join('Mina'), old - 1], graded('distance', true, [], old)]));
    // someone in another class
    await sync('other', learner('other', [profile(), ['CLASS_JOINED', { classCode: '000000' }], trap(), trap()]));

    expect((await call('GET', '/api/teacher', undefined, { ...H, 'x-teacher-token': 'nope' })).status).toBe(403);
    const v = (await call('GET', '/api/teacher', undefined, { ...H, 'x-teacher-token': cls.token })).json;
    expect(v.class).toMatchObject({ name: '9A Science', size: 3, lang: 'or' });
    expect(v.learners.map((l: any) => l.label).sort()).toEqual(['Mina', 'Sunita', '👦 #ravi']);

    const n = v.needsYou[0];
    expect(n).toMatchObject({ learner: 'Sunita', conceptId: 'velocity', concept: 'ବେଗ', attempts: 3, done: false });
    expect(n.strategiesTried).toEqual(['ସଂଜ୍ଞା', 'ତୁଳନା', 'ଉପମା']); // in the teacher's language
    expect(n.misconceptions[0]).toMatchObject({ id: 'speed_equals_velocity', confirmed: true });
    expect(n.recommendation).toMatch(/ଚେଷ୍ଟା ହୋଇଛି/); // in the teacher's language

    expect(v.wellbeing).toHaveLength(1);
    expect(JSON.stringify(v.wellbeing)).not.toMatch(/distress/); // minimal detail: never the reason/words
    expect(v.needsYou.some((x: any) => x.learner === '👦 #ravi')).toBe(false); // wellbeing is not mixed into academic

    expect(v.dropoff).toEqual([{ learner: 'Mina', learnerId: 'mina', days: 5 }]);

    expect(v.reteach).toHaveLength(1);
    const rt = v.reteach[0];
    expect(rt).toMatchObject({ misconceptionId: 'speed_equals_velocity', share: '2/3', status: 'draft' });
    expect(rt.draft).toMatch(/୫ ମିନିଟ/);
    expect(rt.draft.split('\n').length).toBeGreaterThanOrEqual(4);

    // approve with an edit (human in the loop); mark the escalation done
    await call('POST', '/api/teacher/ack', { ref: rt.ref, action: 'approved', body: 'My version' }, { ...H, 'x-teacher-token': cls.token });
    await call('POST', '/api/teacher/ack', { ref: n.ref, action: 'done' }, { ...H, 'x-teacher-token': cls.token });
    const v2 = (await call('GET', '/api/teacher', undefined, { ...H, 'x-teacher-token': cls.token })).json;
    expect(v2.reteach[0]).toMatchObject({ status: 'approved', draft: 'My version' });
    expect(v2.needsYou[0].done).toBe(true);

    // another teacher's key sees nothing of this class
    const other = (await call('POST', '/api/class', { name: 'B', lang: 'en' }, H)).json;
    const vo = (await call('GET', '/api/teacher', undefined, { ...H, 'x-teacher-token': other.token })).json;
    expect(vo.learners).toEqual([]);
    expect(vo.needsYou).toEqual([]);
  });

  it('exam date becomes each learner goal (not over a goal she set herself), also for learners who join later', async () => {
    const { call, store } = setup();
    const H = { 'x-device-token': (await call('POST', '/api/device')).json.token };
    const cls = (await call('POST', '/api/class', { name: '9B', lang: 'en' }, H)).json;
    const join: [string, unknown] = ['CLASS_JOINED', { classCode: cls.code }];
    await call('POST', '/api/sync', { profileId: 'a', cursor: 0, outbox: learner('a', [profile(), join]) }, H);
    await call('POST', '/api/sync', { profileId: 'b', cursor: 0, outbox: learner('b', [profile(), join, ['GOAL_SET', { type: 'chapter', conceptIds: ['speed'], setBy: 'learner' }]]) }, H);

    const date = new Date(NOW + 20 * DAY).toISOString().slice(0, 10);
    const r = (await call('POST', '/api/teacher/exam', { date }, { ...H, 'x-teacher-token': cls.token })).json;
    expect(r.learnersUpdated).toBe(1);
    const a = fold(store.events('a'), motionPack.graph, 'a');
    expect(a.goal).toMatchObject({ type: 'exam', setBy: 'teacher' });
    expect(examProximity(a, NOW)).toBeGreaterThan(0.6); // the policy now weighs review/practice up
    expect(fold(store.events('b'), motionPack.graph, 'b').goal).toMatchObject({ setBy: 'learner' });

    await call('POST', '/api/sync', { profileId: 'c', cursor: 0, outbox: learner('c', [profile(), join]) }, H);
    expect(fold(store.events('c'), motionPack.graph, 'c').goal).toMatchObject({ type: 'exam', setBy: 'teacher' });
  });

  it('LLM-proposed misconceptions: teacher reviews; kept ones reach the content authors without learner identity', async () => {
    const { call } = setup();
    const H = { 'x-device-token': (await call('POST', '/api/device')).json.token };
    const cls = (await call('POST', '/api/class', { name: '9C', lang: 'en' }, H)).json;
    const T = { ...H, 'x-teacher-token': cls.token };
    const cand = (d: string): [string, unknown] => ['MISCONCEPTION_CANDIDATE', { conceptId: 'speed', description: d, evidence: 'answered 0.25' }];
    await call('POST', '/api/sync', { profileId: 'a', cursor: 0, outbox: learner('a', [profile(), ['CLASS_JOINED', { classCode: cls.code, displayName: 'Asha' }], cand('thinks speed is time divided by distance'), cand('thinks km/h and m/s are equal')]) }, H);
    const v = (await call('GET', '/api/teacher', undefined, T)).json;
    expect(v.candidates.map((c: any) => c.description)).toEqual(['thinks speed is time divided by distance', 'thinks km/h and m/s are equal']);
    expect(v.candidates[0].learner).toBe('Asha');
    await call('POST', '/api/teacher/ack', { ref: v.candidates[0].ref, action: 'approved' }, T);
    await call('POST', '/api/teacher/ack', { ref: v.candidates[1].ref, action: 'rejected' }, T);
    expect((await call('GET', '/api/teacher', undefined, T)).json.candidates).toEqual([]);
    expect((await call('GET', '/admin/candidates')).status).toBe(404);
    const kept = (await call('GET', '/admin/candidates', undefined, { 'x-admin-key': 'k' })).json;
    expect(kept).toEqual([{ conceptId: 'speed', description: 'thinks speed is time divided by distance', evidence: ['answered 0.25'], classes: 1, firstAt: expect.any(Number) }]);
    expect(JSON.stringify(kept)).not.toMatch(/Asha|"a"/);
  });
});

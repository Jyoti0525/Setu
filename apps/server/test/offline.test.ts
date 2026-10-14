// Offline robustness (TODO P4.3, P4.4): small turns, idempotent retries, a phone-run turn wins over the server's late copy.
import { describe, expect, it } from 'vitest';
import { canonicalOrder, fold, runTurn, packDiff, applyPackDiff, PackMatcher, type AnyEvent, type ChapterPack, type PackDiff, type TurnInput } from '@setu/core';
import { motionPack } from '@setu/content';
import { Store } from '../src/db.ts';
import { createApp, packHash } from '../src/app.ts';
import { Push, quietNow } from '../src/push.ts';
import { buildModels, ScriptedLlm } from '../src/llm.ts';

let n = 0;
const ev = (type: string, payload: unknown, extra: Partial<AnyEvent> = {}): AnyEvent => ({ id: `e-${++n}`, profileId: 'p1', deviceId: 'phone1', seq: n, ts: 1_750_000_000_000 + n, type, payload, ...extra } as AnyEvent);
const profile = () => ev('PROFILE_CREATED', { avatar: 'a', classLevel: 9, board: 'BSE-Odisha', language: { ui: 'or', response: 'or', inputMode: 'text', readingLevel: 3 }, dataTier: 'low', sharedDevice: true });

async function setup() {
  const store = new Store();
  const { app } = createApp({ store, packs: [motionPack], models: buildModels(), liveGenLangs: [] });
  const dev = await (await app.request('/api/device', { method: 'POST' })).json() as { token: string; deviceId: string };
  const turn = (body: unknown) => app.request('/api/turn', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': dev.token }, body: JSON.stringify(body) });
  return { store, turn, app, dev };
}
const body = (input: unknown, extra: Record<string, unknown> = {}) => ({ profileId: 'p1', clientNow: 1_760_000_000_000, lastSeq: 0, cursor: 0, outbox: [profile()], input, ...extra });

describe('idempotent turns (P4.4)', () => {
  it('a retried turn (same turnId) gets the same reply and runs once', async () => {
    const { store, turn } = await setup();
    const b = body({ type: 'doubt', doubtId: 'q1', text: 'speed aau velocity re farak kana?', mode: 'text' }, { turnId: 't-1' });
    const [r1, r2] = await Promise.all([turn(b), turn(b)]);
    const [j1, j2] = [await r1.json(), await r2.json()];
    expect(j2).toEqual(j1);
    expect(r2.headers.get('x-replayed')).toBe('1');
    expect(store.events('p1').filter((e) => e.type === 'DOUBT_ASKED')).toHaveLength(1);
    expect(store.events('p1').filter((e) => e.type !== 'PROFILE_CREATED').every((e) => e.turn?.id === 't-1' && e.turn.by === 'server')).toBe(true);
  });

  it('the phone gave up and ran the turn itself: its events count, the server copy does not (both sides fold the same)', () => {
    const graded = (by: 'server' | 'device', id: string) => ev('ANSWER_GRADED', { checkId: 'c1', conceptId: 'speed', correct: true, confidence: 1, source: 'bank', misconceptionIds: [] }, { id, turn: { id: 't-9', by } });
    const evs = [profile(), graded('server', 'srv'), graded('device', 'dev')];
    expect(canonicalOrder(evs).map((e) => e.id)).not.toContain('srv');
    expect(fold(evs, motionPack.graph, 'p1').concepts.speed!.attempts).toBe(1);
  });

  it('the turn id survives the server database', () => {
    const store = new Store();
    store.append([profile(), ev('DATA_USED', { kb: 1 }, { turn: { id: 't-3', by: 'device' } })]);
    expect(store.events('p1').find((e) => e.type === 'DATA_USED')!.turn).toEqual({ id: 't-3', by: 'device' });
  });
});

describe('small turns (P4.3)', () => {
  it('a turn reply stays under 30 KB even when the phone is far behind; the rest comes with sync', async () => {
    const { store, turn, dev } = await setup();
    store.append([profile(), ...Array.from({ length: 400 }, () => ev('DATA_USED', { kb: 1 }))]);
    store.grant('p1', dev.deviceId); // her record was written by another of her devices
    const r = await turn(body({ type: 'doubt', doubtId: 'q1', text: 'bega kana', mode: 'text' }, { outbox: [] }));
    const text = await r.text();
    expect(text.length).toBeLessThan(30 * 1024);
    const j = JSON.parse(text) as { events: AnyEvent[]; cursor: number };
    expect(j.events.length).toBeLessThanOrEqual(40);
    expect(j.cursor).toBeGreaterThan(0);
  });
});

describe('pack updates as diffs (P4.14)', () => {
  const edited = () => {
    const b = structuredClone(motionPack) as ChapterPack;
    b.version += 1;
    b.checks[0] = { ...b.checks[0]!, id: b.checks[0]!.id.replace('@1', '@2'), difficulty: 3 };
    b.faq = b.faq.slice(1);
    return b;
  };
  it('applying the diff rebuilds the new pack exactly (same hash); unchanged items are not sent', () => {
    const a = motionPack, b = edited();
    const d = packDiff(a, b, { from: packHash(a), to: packHash(b) });
    expect(packHash(applyPackDiff(a, d))).toBe(packHash(b));
    expect(JSON.stringify(d).length).toBeLessThan(JSON.stringify(b).length / 4);
    expect(d.lists.explanations).toBeUndefined();
  });
  it('the server answers an old hash with a diff, the current hash with 304', async () => {
    const store = new Store();
    createApp({ store, packs: [motionPack], models: buildModels(), liveGenLangs: [] }); // the version the phone has
    const b = edited();
    const { app } = createApp({ store, packs: [b], models: buildModels(), liveGenLangs: [] });
    const r = await app.request(`/api/pack/${b.id}?diff=1`, { headers: { 'if-none-match': packHash(motionPack) } });
    expect(r.headers.get('x-pack-diff')).toBe('1');
    const d = await r.json() as PackDiff;
    expect(packHash(applyPackDiff(motionPack, d))).toBe(d.to);
    expect((await app.request(`/api/pack/${b.id}?diff=1`, { headers: { 'if-none-match': d.to } })).status).toBe(304);
  });
});

describe('opt-in reminders (P4.31)', () => {
  const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } };
  const noonIst = Date.UTC(2026, 9, 14, 6, 30); // 12:00 IST
  it('one generic line, never at night, at most once a day, nothing personal', async () => {
    const sent: string[] = [];
    const push = new Push(new Store(), { send: async (_s, p) => { sent.push(p); } });
    expect(await push.lessonReady('p1', noonIst)).toBe('none');
    expect(push.subscribe('dev1', 'p1', sub, 'or')).toBe(true);
    expect(await push.lessonReady('p1', Date.UTC(2026, 9, 14, 17, 0))).toBe('quiet'); // 22:30 IST
    expect(await push.lessonReady('p1', noonIst)).toBe('sent');
    expect(await push.lessonReady('p1', noonIst + 3600_000)).toBe('recent');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toEqual({ title: 'Setu', body: 'ତୁମ ପରବର୍ତ୍ତୀ ପାଠ ପ୍ରସ୍ତୁତ।', url: '/' });
    expect(quietNow(Date.UTC(2026, 9, 14, 1, 0))).toBe(true); // 06:30 IST
  });
  it('a subscription the browser dropped (410) is forgotten; a non-https endpoint is refused', async () => {
    const push = new Push(new Store(), { send: async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); } });
    push.subscribe('dev1', 'p1', sub, 'en');
    await push.lessonReady('p1', noonIst);
    expect(await push.lessonReady('p1', noonIst + 2 * 86_400_000)).toBe('none');
    expect(push.subscribe('dev1', 'p1', { ...sub, endpoint: 'http://evil/x' }, 'en')).toBe(false);
  });
});

describe('budgets and the link (P4.28, P4.29)', () => {
  const matcher = new PackMatcher(motionPack);
  const T0 = 1_760_000_000_000;
  const run = (seed: AnyEvent[], input: TurnInput, now: number) => runTurn(fold(seed, motionPack.graph, 'p1'), input, { pack: motionPack, matcher, now, tier: 'device', trustDraft: true }, (d) => ({ ...d, id: `x${++n}`, profileId: 'p1', deviceId: 'phone1', seq: ++n, ts: now } as AnyEvent));
  const placed = () => ev('PLACEMENT_COMPLETED', { conceptIds: [], known: [], gaps: [] });
  const opened = (minutes: number) => ev('SESSION_OPENED', { sessionId: 's1', tier: 'device', minutes }, { ts: T0 });
  it('time nearly up → wrap up at a good point (close), said once', () => {
    const r = run([profile(), placed(), opened(10)], { type: 'next' }, T0 + 9 * 60_000);
    expect(r.decision.action).toBe('close');
    expect(r.events.some((e) => e.type === 'BUDGET_LOW' && (e.payload as { kind: string }).kind === 'time')).toBe(true);
    const early = run([profile(), placed(), opened(10)], { type: 'next' }, T0 + 60_000);
    expect(early.decision.action).not.toBe('close');
  });
  it('data nearly used → told once today, audio dropped from the plan', () => {
    const used = [profile(), placed(), opened(30), ev('DATA_USED', { kb: 1400 }, { ts: T0 })];
    const r = run(used, { type: 'next' }, T0 + 60_000);
    expect(r.events.some((e) => e.type === 'BUDGET_LOW' && (e.payload as { kind: string }).kind === 'data')).toBe(true);
    expect(r.messages[0]!.kind).toBe('info');
    const again = run([...used, ...r.events.map((d, i) => ({ ...d, id: `b${i}`, profileId: 'p1', deviceId: 'phone1', seq: 900 + i, ts: T0 + 60_000 } as AnyEvent))], { type: 'next' }, T0 + 120_000);
    expect(again.events.some((e) => e.type === 'BUDGET_LOW')).toBe(false);
  });
  it('the link change is part of her record', () => {
    const s = fold([profile(), ev('CONNECTIVITY_CHANGED', { from: 'device', to: 'cloud' })], motionPack.graph, 'p1');
    expect(s.link).toBe('cloud');
  });
});

describe('a profile id alone does not open a record', () => {
  it('another device cannot read or write a learner it never wrote to; a granted one can', async () => {
    const { store, app } = await setup();
    store.append([profile(), ev('DATA_USED', { kb: 1 })]);
    const other = await (await app.request('/api/device', { method: 'POST' })).json() as { token: string; deviceId: string };
    const sync = () => app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': other.token }, body: JSON.stringify({ profileId: 'p1', cursor: 0, outbox: [] }) });
    expect((await sync()).status).toBe(403);
    store.grant('p1', other.deviceId);
    expect((await sync()).status).toBe(200);
  });
});

describe('failure drill (P7.9)', () => {
  it('taking the only decide provider down by hand → the next turn falls back to the policy, visibly in the trace', async () => {
    const decide = new ScriptedLlm(() => JSON.stringify({ action: 'answer_faq', concept_id: 'velocity', faq_id: 'faq.speed_vs_velocity', reason: 'asked' }));
    const models = buildModels({}, { decide: { scripted: decide } });
    const store = new Store();
    const { app } = createApp({ store, packs: [motionPack], models, liveGenLangs: [], adminKey: 'k' });
    const dev = await (await app.request('/api/device', { method: 'POST' })).json() as { token: string };
    const H = { 'content-type': 'application/json', 'x-device-token': dev.token };
    const key = models.providers[0]!;
    expect((await app.request('/admin/provider', { method: 'POST', headers: { ...H, 'x-admin-key': 'nope' }, body: JSON.stringify({ key, down: true }) })).status).toBe(404);
    const down = await (await app.request('/admin/provider', { method: 'POST', headers: { ...H, 'x-admin-key': 'k' }, body: JSON.stringify({ key, down: true }) })).json() as { breakers: Record<string, string> };
    expect(down.breakers[key]).toMatch(/^open/);
    const r = await (await app.request('/api/turn', { method: 'POST', headers: H, body: JSON.stringify(body({ type: 'doubt', doubtId: 'q', text: 'speed aau velocity re farak kana?', mode: 'text' })) })).json() as { trace: { decided_by: string; fallback_used?: string } };
    expect(r.trace.decided_by).toBe('policy');
    expect(r.trace.fallback_used).toMatch(/providers open/);
    expect(decide.calls).toHaveLength(0);
  });
});

describe('retention (P5.21)', () => {
  it('traces are kept 90 days; a learner silent for a year loses her server copy, others keep theirs', () => {
    const store = new Store();
    const DAY = 86_400_000, now = 1_800_000_000_000;
    store.append([ev('PROFILE_CREATED', {}, { profileId: 'old' })], now - 400 * DAY);
    store.append([ev('PROFILE_CREATED', {}, { profileId: 'new' })], now - 10 * DAY);
    store.grant('old', 'phone1');
    const step = { trigger: 'doubt' } as never;
    store.addTrace('new', step, now - 100 * DAY);
    store.addTrace('new', step, now - 5 * DAY);
    const r = store.prune(now);
    expect(r.profiles).toEqual(['old']);
    expect(r.traces).toBe(1);
    expect(store.profiles()).toEqual(['new']);
    expect(store.canUse('old', 'phone2')).toBe(true); // no events, no grants left: the id is free again
    expect(store.traces(10, 'new')).toHaveLength(1);
  });
});

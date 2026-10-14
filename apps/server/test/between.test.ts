// Between-session agent (PLAN §5.2, TODO P4.24–P4.26, P4.30): plan + pre-write, queued doubts, escalation + reteach, inactivity, drop-off.
import { describe, expect, it } from 'vitest';
import { fold, PackMatcher, textIn, DAY, SERVER_DEVICE, type AnyEvent } from '@setu/core';
import { motionPack } from '@setu/content';
import { Store } from '../src/db.ts';
import { buildModels, ScriptedLlm } from '../src/llm.ts';
import { betweenSessions, tick, INACTIVITY_MIN, DROPOFF_DAYS } from '../src/agent/between.ts';
import type { CycleDeps } from '../src/agent/cycle.ts';

const matcher = new PackMatcher(motionPack);
const T0 = 1_760_000_000_000;
let n = 0;
const ev = (type: string, payload: unknown, at = T0 + n): AnyEvent => ({ id: `seed-${++n}`, profileId: 'p1', deviceId: 'phone1', seq: n, ts: at, type, payload } as AnyEvent);
const profile = () => ev('PROFILE_CREATED', { avatar: 'a', classLevel: 9, board: 'BSE-Odisha', language: { ui: 'or', response: 'or', inputMode: 'text', readingLevel: 3 }, dataTier: 'low', sharedDevice: true });
const graded = (c: string, correct: boolean, mis: string[] = []) => ev('ANSWER_GRADED', { checkId: `x.${c}`, conceptId: c, correct, confidence: 1, source: 'bank', misconceptionIds: mis });
const known = (...cs: string[]) => cs.flatMap((c) => [1, 2, 3].map(() => graded(c, true)));
const promptOf = (r: { config?: { systemInstruction?: unknown } }) => String(r.config?.systemInstruction ?? '');

/** writes a short Odia text that uses the textbook term of whatever concept the prompt asks about */
const writer = (p: string) => {
  const g = motionPack.glossary.find((x) => p.includes(`"${textIn(motionPack.graph.concepts[x.conceptId]!.name, 'en')}"`));
  return JSON.stringify({ text: g ? `${textIn(g.term, 'or')} ବିଷୟରେ ଗୋଟିଏ ସରଳ କଥା।` : 'ଏହା ଅନ୍ୟ ଅଧ୍ୟାୟର ପ୍ରଶ୍ନ। ତୁମ ଶିକ୍ଷକ ଅଧିକ ବୁଝାଇବେ।' , cites: [1] });
};

function deps(seed: AnyEvent[], opts: { gen?: boolean; now?: number } = {}) {
  const store = new Store();
  store.append(seed);
  const gen = opts.gen ? new ScriptedLlm((r) => writer(promptOf(r))) : undefined;
  const models = buildModels({}, gen ? { generate: { scripted: gen } } : {});
  const traces: string[] = [];
  const d: CycleDeps = { store, pack: motionPack, matcher, models, liveGenLangs: new Set(['or']), trustDraft: true, now: () => opts.now ?? T0 + 3600_000, recentGen: new Map(), onTrace: (_p, t) => traces.push(t.trigger) };
  return { d, store, gen, traces };
}
const state = (store: Store) => fold(store.events('p1'), motionPack.graph, 'p1');

describe('between-session run', () => {
  it('plans the next session and pre-writes its explanations (critic-checked) into the plan', async () => {
    const { d, store, gen, traces } = deps([profile(), ...known('reference_point', 'distance'), ev('SESSION_OPENED', { sessionId: 's1', tier: 'cloud' }), ev('SESSION_ENDED', { sessionId: 's1', reason: 'explicit', minutesUsed: 15 })], { gen: true });
    const r = (await betweenSessions(d, 'p1', 'session_end'))!;
    const plan = state(store).preparedSession!;
    expect(plan.preparedBy).toBe('server');
    expect(plan.items.length).toBeGreaterThan(0);
    const written = plan.items.filter((x) => x.pregenerated);
    expect(written.length).toBeGreaterThan(0);
    expect(written.every((x) => x.pregenerated!.lang === 'or')).toBe(true);
    expect(plan.prefetch!.length).toBe(written.length);
    expect(gen!.calls.length).toBe(written.length);
    expect(r.trace.tools.map((t) => t.tool)).toEqual(expect.arrayContaining(['review_evidence', 'plan_next_session', 'prepare_offline']));
    expect(traces).toEqual(['between_sessions:session_end']);
    expect(r.events.every((e) => e.deviceId === SERVER_DEVICE)).toBe(true);

    // a second run reuses the cache: no new LLM calls
    await betweenSessions(d, 'p1', 'sync');
    expect(gen!.calls.length).toBe(written.length);
  });

  it('without any LLM it still plans (policy) and writes nothing', async () => {
    const { d, store } = deps([profile(), ...known('reference_point')]);
    await betweenSessions(d, 'p1', 'session_end');
    const plan = state(store).preparedSession!;
    expect(plan.items.length).toBeGreaterThan(0);
    expect(plan.items.some((x) => x.pregenerated)).toBe(false);
  });

  it('answers a doubt queued offline and keeps the promise; without an LLM, an unmatched doubt goes to the teacher', async () => {
    const queued = [ev('DOUBT_QUEUED', { doubtId: 'd9', text: 'photosynthesis kemiti hue', reason: 'unmatched' }), ev('COMMITMENT_MADE', { commitmentId: 'answer:d9', text: 'answer queued doubt when online' })];
    const a = deps([profile(), ...queued], { gen: true });
    const r = (await betweenSessions(a.d, 'p1', 'sync'))!;
    const s = state(a.store);
    expect(s.queuedDoubts[0]).toMatchObject({ answered: true });
    expect(s.commitments[0]).toMatchObject({ kept: true });
    expect(r.trace.tools.find((t) => t.tool === 'answer_queued_doubt')?.args).toMatchObject({ source: 'llm (critic-approved)' });

    const b = deps([profile(), ...queued]);
    await betweenSessions(b.d, 'p1', 'sync');
    const s2 = state(b.store);
    expect(s2.queuedDoubts[0]!.answered).toBe(false);
    expect(s2.escalations.some((x) => x.reason.includes('d9'))).toBe(true);
  });

  it('a queued doubt the pack knows is answered from the pack, with no LLM', async () => {
    const { d, store } = deps([profile(), ev('DOUBT_QUEUED', { doubtId: 'd1', text: 'speed aau velocity re farak kana', reason: 'weak signal' })]);
    await betweenSessions(d, 'p1', 'sync');
    expect(state(store).queuedDoubts[0]).toMatchObject({ answered: true });
  });

  it('escalates a stuck concept found after the session and drafts a reteach for the teacher', async () => {
    const stuck = ['definition', 'analogy', 'contrast'].flatMap((st) => [
      ev('EXPLANATION_DELIVERED', { conceptId: 'velocity', strategy: st, level: 3 }),
      graded('velocity', false, ['speed_equals_velocity']),
    ]);
    const { d, store } = deps([profile(), ...known('reference_point', 'distance', 'speed', 'displacement'), ...stuck]);
    await betweenSessions(d, 'p1', 'session_end');
    const esc = state(store).escalations.find((x) => x.conceptId === 'velocity');
    expect(esc?.kind).toBe('academic');
    expect(esc?.draft).toMatch(/tried definition, analogy, contrast/);
    expect(esc?.draft).toMatch(/Likely confusion/);
  });

  it('server events are not learner activity; tick ends idle sessions and flags drop-off once', async () => {
    const opened = T0;
    const seed = [profile(), ev('SESSION_OPENED', { sessionId: 's1', tier: 'device' }, opened), graded('distance', true)];
    const last = state((() => { const st = new Store(); st.append(seed); return st; })()).lastActiveAt!;

    const idle = deps(seed, { now: last + (INACTIVITY_MIN + 1) * 60_000 });
    const r1 = await tick(idle.d);
    expect(r1.ended).toEqual(['p1']);
    expect(state(idle.store).session).toBeUndefined();
    expect(state(idle.store).preparedSession?.preparedBy).toBe('server');
    expect(state(idle.store).lastActiveAt).toBe(last); // the server's own events did not count

    const gone = deps(seed, { now: last + (DROPOFF_DAYS + 1) * DAY });
    const r2 = await tick(gone.d);
    expect(r2.dropoff).toEqual(['p1']);
    expect(state(gone.store).escalations.filter((x) => x.kind === 'dropoff')).toHaveLength(1);
    const r3 = await tick(gone.d);
    expect(r3.dropoff).toEqual([]); // not again until she comes back and leaves again
  });
});

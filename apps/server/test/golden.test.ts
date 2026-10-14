// Golden scenario (TODO P2.55 / P6.6): the hero flow's real model replies (recorded by eval/live.ts golden) are replayed
// so the whole agent — policy, validation, critic, commit — runs deterministically in CI. A change that alters what the
// agent does with the same model replies shows up here.
import { describe, expect, it } from 'vitest';
import { PackMatcher, type AnyEvent, type TurnInput } from '@setu/core';
import { motionPack } from '@setu/content';
import hero from './golden/hero.json' with { type: 'json' };
import { Store } from '../src/db.ts';
import { buildModels, ScriptedLlm } from '../src/llm.ts';
import { runCycle, type CycleDeps } from '../src/agent/cycle.ts';

let n = 0;
const ev = (type: string, payload: unknown): AnyEvent => ({ id: `live-${++n}`, profileId: 'p1', deviceId: 'phone1', seq: n, ts: 1_750_000_000_000 + n, type, payload } as AnyEvent);
const known = ['reference_point', 'distance', 'speed', 'displacement'];
const seed = () => [
  ev('PROFILE_CREATED', { avatar: 'a', classLevel: 9, board: 'BSE-Odisha', language: { ui: 'or', response: 'or', inputMode: 'text', readingLevel: 3 }, dataTier: 'low', sharedDevice: true }),
  ev('PLACEMENT_COMPLETED', { conceptIds: [], known, gaps: [] }),
  ...known.flatMap((c) => [1, 2, 3].map(() => ev('ANSWER_GRADED', { checkId: `x.${c}`, conceptId: c, correct: true, confidence: 1, source: 'bank', misconceptionIds: [] }))),
];

describe('golden hero flow (recorded model replies, replayed)', () => {
  it('the agent makes the same decisions and shows the same kinds of messages, with the same model calls', async () => {
    const queue = (job: string) => hero.replies.filter((r) => r.job === job).map((r) => r.text);
    const [decides, generates] = [queue('decide'), queue('generate')];
    const models = buildModels({}, { decide: { scripted: new ScriptedLlm(() => decides.shift() ?? '{}') }, generate: { scripted: new ScriptedLlm(() => generates.shift() ?? '{}') } });
    const store = new Store();
    store.append(seed());
    const d: CycleDeps = { store, pack: motionPack, matcher: new PackMatcher(motionPack), models, liveGenLangs: new Set(['or']), trustDraft: true, recentGen: new Map(), budgetMs: 30_000 };
    let lastSeq = 1000, cursor = 0;
    for (const [i, step] of hero.steps.entries()) {
      const r = await runCycle(d, { profileId: 'p1', deviceId: 'phone1', clientNow: 1_760_000_000_000 + i * 60_000, lastSeq, cursor, outbox: [], input: step.input as TurnInput });
      lastSeq = r.lastSeq; cursor = r.cursor;
      if (process.env.GOLDEN_DEBUG) console.log(JSON.stringify(r.trace.critic), r.trace.llm_calls.map((c) => c.outcome));
      expect(r.trace.chosen, `turn ${i + 1}`).toBe(step.chosen);
      expect(r.messages.map((m) => m.kind), `turn ${i + 1}`).toEqual(step.kinds);
      expect(r.trace.llm_calls.map((c) => c.job), `turn ${i + 1}`).toEqual(step.jobs);
    }
    expect(decides).toEqual([]);
    expect(generates).toEqual([]);
  });
});

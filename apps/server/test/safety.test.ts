// Child-safety layer on the server (TODO P5.13–P5.17, P5.22): fixed replies never reach a model, the model can raise
// a question to wellbeing, every provider request is PII-scrubbed, queued doubts get the same screen.
import { describe, expect, it } from 'vitest';
import { fold, PackMatcher, type AnyEvent } from '@setu/core';
import { motionPack } from '@setu/content';
import type { LlmRequest } from '@google/adk';
import { Store } from '../src/db.ts';
import { buildModels, ScriptedLlm, scrubRequest } from '../src/llm.ts';
import { runCycle, type CycleDeps, type TurnRequest } from '../src/agent/cycle.ts';
import { betweenSessions } from '../src/agent/between.ts';

const matcher = new PackMatcher(motionPack);
let n = 0;
const ev = (type: string, payload: unknown): AnyEvent => ({ id: `seed-${++n}`, profileId: 'p1', deviceId: 'phone1', seq: n, ts: 1_750_000_000_000 + n, type, payload } as AnyEvent);
const profile = () => ev('PROFILE_CREATED', { avatar: 'a', classLevel: 9, board: 'BSE-Odisha', language: { ui: 'or', response: 'or', inputMode: 'text', readingLevel: 3 }, dataTier: 'low', sharedDevice: true });

function deps(decide?: () => string, seed: AnyEvent[] = []) {
  const store = new Store();
  store.append([profile(), ...seed]);
  const decideLlm = decide && new ScriptedLlm(() => decide());
  const genLlm = new ScriptedLlm(() => JSON.stringify({ text: 'x' }));
  const models = buildModels({}, { ...(decideLlm ? { decide: { scripted: decideLlm } } : {}), generate: { scripted: genLlm } });
  const d: CycleDeps = { store, pack: motionPack, matcher, models, liveGenLangs: new Set(['or', 'en']), trustDraft: true, now: () => 1_760_000_000_000, recentGen: new Map() };
  return { d, store, decideLlm, genLlm };
}
const req = (text: string): TurnRequest => ({ profileId: 'p1', deviceId: 'phone1', clientNow: 1_760_000_000_000, lastSeq: 100, cursor: 0, outbox: [], input: { type: 'doubt', doubtId: 'q1', text, mode: 'text' } });

describe('server safety', () => {
  it('distress is answered with the fixed caring message; no model sees what she said', async () => {
    const { d, decideLlm, genLlm } = deps(() => '{}');
    const r = await runCycle(d, req('mu mari jibi, mote kehi bhala paanti nahi'));
    expect(r.trace.safety?.input).toBe('distress');
    expect(r.messages.some((m) => m.kind === 'info' && m.tone === 'escalated' && m.text.includes('1098'))).toBe(true);
    expect(decideLlm!.calls.length + genLlm.calls.length).toBe(0);
    expect(r.trace.llm_calls).toHaveLength(0);
  });

  it('the decide model can see distress the word lists missed → caring reply, teacher notified', async () => {
    const { d, store } = deps(() => JSON.stringify({ action: 'teach', concept_id: 'speed', reason: 'x', understood: { concept_id: null, intent: 'wellbeing', language: 'romanized' } }));
    const r = await runCycle(d, req('bhala lagu nahi, kichi bi padhi paruni, sab bekar'));
    expect(r.trace.decided_by).toBe('llm');
    expect(r.trace.reason).toMatch(/wellbeing/);
    expect(r.messages.some((m) => m.kind === 'info' && m.tone === 'escalated')).toBe(true);
    const s = fold(store.events('p1'), motionPack.graph, 'p1');
    expect(s.escalations.some((e) => e.kind === 'wellbeing')).toBe(true);
  });

  it('an unsafe generated text is replaced by the output guard and counted in the trace', async () => {
    const { d } = deps(undefined);
    const r = await runCycle(d, req('speed aau velocity re farak kana?'));
    expect(r.trace.safety).toMatchObject({ blocked: 0 });
    expect(r.trace.safety!.checked).toBe(r.messages.length);
  });

  it('every provider request is PII-scrubbed (phones, e-mails, ID numbers)', () => {
    const out = scrubRequest({
      contents: [{ role: 'user', parts: [{ text: 'call 9876543210 or a.b@c.in, id 1234 5678 9012; car at 72 km/h' }] }],
      config: { systemInstruction: { parts: [{ text: 'learner said: my number 98765 43210' }] } },
    } as unknown as LlmRequest);
    const s = JSON.stringify(out);
    expect(s).not.toMatch(/9876543210|98765 43210|a\.b@c\.in|1234 5678 9012/);
    expect(s).toContain('72 km/h');
    expect(scrubRequest({ contents: [], config: { systemInstruction: 'mail x@y.com' } } as unknown as LlmRequest).config!.systemInstruction).toBe('mail [email]');
  });

  it('a queued doubt gets the same screen: distress → teacher + caring reply, off-topic → redirect, promise kept', async () => {
    const { d, store } = deps(undefined, [
      ev('DOUBT_QUEUED', { doubtId: 'd1', text: 'ମୁଁ ମରିଯିବି', reason: 'unmatched' }),
      ev('COMMITMENT_MADE', { commitmentId: 'answer:d1', text: 'answer queued doubt when online' }),
      ev('DOUBT_QUEUED', { doubtId: 'd2', text: 'ipl re kie jitiba', reason: 'unmatched' }),
    ]);
    const r = (await betweenSessions(d, 'p1', 'sync'))!;
    const s = fold(store.events('p1'), motionPack.graph, 'p1');
    expect(s.queuedDoubts.every((q) => q.answered)).toBe(true);
    expect(s.commitments[0]).toMatchObject({ kept: true });
    expect(s.escalations.some((e) => e.kind === 'wellbeing')).toBe(true);
    expect(r.trace.tools.filter((t) => t.tool === 'safety').map((t) => (t.args as { input: string }).input)).toEqual(['distress', 'off_topic']);
    expect(r.trace.tools.some((t) => t.tool === 'notify_teacher')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { PackMatcher, type AnyEvent, type OutMsg } from '@setu/core';
import { motionPack } from '@setu/content';
import { Store } from '../src/db.ts';
import { buildModels, ScriptedLlm } from '../src/llm.ts';
import { runCycle, type CycleDeps, type TurnRequest } from '../src/agent/cycle.ts';

const matcher = new PackMatcher(motionPack);
let n = 0;
const ev = (type: string, payload: unknown, deviceId = 'phone1'): AnyEvent => ({ id: `seed-${++n}`, profileId: 'p1', deviceId, seq: n, ts: 1_750_000_000_000 + n, type, payload } as AnyEvent);
const profile = () => ev('PROFILE_CREATED', { avatar: 'a', classLevel: 9, board: 'BSE-Odisha', language: { ui: 'or', response: 'or', inputMode: 'text', readingLevel: 3 }, dataTier: 'low', sharedDevice: true });
const known = (...cs: string[]) => cs.flatMap((c) => [1, 2, 3].map(() => ev('ANSWER_GRADED', { checkId: `x.${c}`, conceptId: c, correct: true, confidence: 1, source: 'bank', misconceptionIds: [] })));

function deps(opts: { decide?: (p: string) => string | Error; generate?: (p: string) => string | Error; liveGen?: string[]; fresh?: boolean } = {}) {
  const store = new Store();
  store.append(opts.fresh ? [profile()] : [profile(), ...known('reference_point', 'distance', 'speed', 'displacement')]);
  const decideLlm = opts.decide && new ScriptedLlm((r) => opts.decide!(promptOf(r)));
  const genLlm = opts.generate && new ScriptedLlm((r) => opts.generate!(promptOf(r)));
  const models = buildModels({}, { ...(decideLlm ? { decide: { scripted: decideLlm } } : {}), ...(genLlm ? { generate: { scripted: genLlm } } : {}) });
  const d: CycleDeps = { store, pack: motionPack, matcher, models, liveGenLangs: new Set(opts.liveGen ?? ['or', 'en']), trustDraft: true };
  return { d, store, decideLlm, genLlm };
}
const promptOf = (r: { config?: { systemInstruction?: unknown } }) => {
  const si = r.config?.systemInstruction as string | { parts?: { text?: string }[] } | undefined;
  return typeof si === 'string' ? si : (si?.parts ?? []).map((p) => p.text ?? '').join('');
};
const req = (input: TurnRequest['input'], extra: Partial<TurnRequest> = {}): TurnRequest => ({ profileId: 'p1', deviceId: 'phone1', clientNow: 1_760_000_000_000, lastSeq: 100, cursor: 0, outbox: [], input, ...extra });
const kinds = (m: OutMsg[]) => m.map((x) => x.kind);

describe('server cycle', () => {
  it('no LLM configured → policy + pack content, still a full turn with trace', async () => {
    const { d, store } = deps();
    const r = await runCycle(d, req({ type: 'doubt', doubtId: 'q1', text: 'speed aau velocity re farak kana?', mode: 'text' }));
    expect(kinds(r.messages)).toEqual(['explanation', 'check']);
    expect(r.trace.decided_by).toBe('policy');
    expect(r.trace.fallback_used).toMatch(/no LLM/);
    expect(r.trace.llm_calls).toHaveLength(0);
    expect(store.traces().length).toBe(1);
    expect(r.events.some((e) => e.type === 'CHECK_SHOWN')).toBe(true);
  });

  it('LLM decides (override with a reason) and generates; critic approves; ≤ 2 calls', async () => {
    const { d, decideLlm, genLlm } = deps({
      decide: () => JSON.stringify({ action: 'step_back', concept_id: 'speed', strategy: 'analogy', reason: 'velocity builds on speed', override_reason: 'she says she does not know speed either, though her record shows speed as known', understood: { concept_id: 'velocity', intent: 'conceptual', language: 'romanized' } }),
      generate: () => JSON.stringify({ text: 'ଦ୍ରୁତି (Speed) ମାନେ କେତେ ଜୋରରେ ଯାଉଛି। ତୁମେ ଓ ସାଙ୍ଗ ସାଇକେଲରେ ହାଟକୁ ଗଲେ, ଯିଏ ଶୀଘ୍ର ପହଞ୍ଚେ ତା\'ର ଦ୍ରୁତି ବେଶୀ।', speak: 'ଦ୍ରୁତି ମାନେ କେତେ ଜୋରରେ ଯାଉଛି।' , cites: [1] }),
    });
    const r = await runCycle(d, req({ type: 'doubt', doubtId: 'q1', text: 'bega bujhuni, druti bi jani nahi', mode: 'text' }));
    expect(r.trace.decided_by).toBe('llm');
    expect(r.trace.override).toBe(true);
    expect(r.trace.reason).toMatch(/override/);
    expect(r.trace.critic?.verdict).toBe('pass');
    const ex = r.messages.find((m) => m.kind === 'explanation');
    expect(ex?.kind === 'explanation' && ex.generated).toBe(true);
    expect(decideLlm!.calls.length + genLlm!.calls.length).toBeLessThanOrEqual(2);
    expect(r.trace.llm_calls.map((c) => c.job)).toEqual(['decide', 'generate']);
    // prompt hygiene: learner text fenced as data
    expect(promptOf(decideLlm!.calls[0]!)).toContain('<learner_text>');
  });

  it('invalid LLM decision (concept not in graph) → rejected, policy used, logged', async () => {
    const { d } = deps({ decide: () => JSON.stringify({ action: 'teach', concept_id: 'photosynthesis', reason: 'x' }) });
    const r = await runCycle(d, req({ type: 'doubt', doubtId: 'q1', text: 'bega kana', mode: 'text' }));
    expect(r.trace.decided_by).toBe('policy');
    expect(r.trace.facts_used.join(' ')).toMatch(/rejected: concept "photosynthesis" not in graph/);
    expect(r.trace.llm_calls[0]!.outcome).toMatch(/rejected/);
  });

  it('override without a reason is rejected', async () => {
    const { d } = deps({ decide: () => JSON.stringify({ action: 'review', concept_id: 'distance', reason: 'because' }) });
    const r = await runCycle(d, req({ type: 'doubt', doubtId: 'q1', text: 'bega kana', mode: 'text' }));
    expect(r.trace.facts_used.join(' ')).toMatch(/override without a stated reason/);
  });

  it('generation with an invented number → critic rejects → reviewed pack text', async () => {
    const { d } = deps({
      decide: () => JSON.stringify({ action: 'teach', concept_id: 'velocity', strategy: 'definition', reason: 'ok', override_reason: 'doubt is about velocity' }),
      generate: () => JSON.stringify({ text: 'ବେଗ (Velocity) ହେଉଛି ଦିଗ ସହିତ ଦ୍ରୁତି। ଗୋଟିଏ ବସ୍ ୭୭ କି.ମି. ଯାଏ।' , cites: [1] }),
    });
    const r = await runCycle(d, req({ type: 'doubt', doubtId: 'q1', text: 'bega kana', mode: 'text' }));
    expect(r.trace.critic?.verdict).toBe('reject');
    expect(r.trace.fallback_used).toMatch(/critic/);
    const ex = r.messages.find((m) => m.kind === 'explanation');
    expect(ex?.kind === 'explanation' && ex.generated).toBe(false);
  });

  it('provider down → circuit opens → fallback, next turn does not call it again', async () => {
    const { d, decideLlm } = deps({ decide: () => new Error('429 RESOURCE_EXHAUSTED') });
    const r1 = await runCycle(d, req({ type: 'doubt', doubtId: 'q1', text: 'bega kana', mode: 'text' }));
    expect(r1.trace.decided_by).toBe('policy');
    expect(r1.trace.status).toBe('fallback');
    const calls = decideLlm!.calls.length;
    await runCycle(d, req({ type: 'doubt', doubtId: 'q2', text: 'druti kana', mode: 'text' }, { lastSeq: r1.lastSeq, cursor: r1.cursor }));
    expect(decideLlm!.calls.length).toBe(calls); // breaker open: not retried
  });

  it('sync-before-think: offline answers in the outbox change the decision', async () => {
    const { d } = deps();
    // offline the learner twice picked the speed=velocity trap
    const outbox = [101, 102].map((seq) => ({ id: `off-${seq}`, profileId: 'p1', deviceId: 'phone1', seq, ts: 1_760_000_000_000 + seq, type: 'ANSWER_GRADED', payload: { checkId: 'chk.vel.1@1', conceptId: 'velocity', correct: false, confidence: 1, source: 'bank', misconceptionIds: ['speed_equals_velocity'] } } as AnyEvent));
    const r = await runCycle(d, req({ type: 'next' }, { outbox, lastSeq: 102 }));
    expect(r.trace.synced_in).toBe(2);
    expect(r.trace.chosen).toMatch(/^remediate:velocity/);
    // resending the same outbox is idempotent
    const r2 = await runCycle(d, req({ type: 'next' }, { outbox, lastSeq: r.lastSeq, cursor: r.cursor }));
    expect(r2.trace.synced_in).toBe(0);
  });

  it('routine correct answer → policy decides without spending an LLM call', async () => {
    const { d, decideLlm } = deps({ decide: () => '{}' });
    const r1 = await runCycle(d, req({ type: 'next' }));
    const chk = r1.messages.find((m) => m.kind === 'check');
    expect(chk).toBeTruthy();
    const item = motionPack.checks.find((c) => c.id === (chk as { checkId: string }).checkId)!;
    const right = item.kind === 'mcq' ? item.options!.find((o) => o.correct)!.id : String(item.numeric!.value);
    await runCycle(d, req({ type: 'answer', checkId: item.id, answer: right }, { lastSeq: r1.lastSeq, cursor: r1.cursor }));
    expect(decideLlm!.calls.length).toBe(0);
  });
});

describe('critic term check (P2.10)', () => {
  it('rejects non-textbook Odia terms seen from Groq models in P0.a, accepts the textbook term', async () => {
    const { critic } = await import('../src/agent/critic.ts');
    const { motionPack } = await import('@setu/content');
    const base = { lang: 'or', readingLevel: 3, allowedNumbers: [], answerKey: [], pack: motionPack, conceptId: 'velocity' };
    const bad = critic({ ...base, text: 'ଗତିଭେଗ ଚଳନର ଦିଗକୁ ମଧ୍ୟ ଦେଖାଏ।' });
    expect(bad.verdict).not.toBe('pass');
    expect(bad.problems.join(' ')).toMatch(/non-textbook/);
    const ok = critic({ ...base, text: 'ନିର୍ଦ୍ଦିଷ୍ଟ ଦିଗରେ ବସ୍ତୁର ଦ୍ରୁତିକୁ ବେଗ କୁହାଯାଏ।' });
    expect(ok.verdict).toBe('pass');
  });
});

describe('model routing', () => {
  it('Groq may decide but never writes Odia; Gemini + Gemma may', () => {
    const m = buildModels({ GEMINI_API_KEY: 'x', GROQ_API_KEY: 'y' });
    expect(m.genKeysFor('or')).toEqual(['gemini-flash', 'gemini-lite-gen', 'gemma']);
    expect(m.genKeysFor('en')).toContain('groq');
    expect(m.providers).toContain('groq');
    expect(buildModels({ GROQ_API_KEY: 'y' }).generateFor('or')).toBeNull();
  });
});

describe('turn budget', () => {
  it('a slow generator cannot hold the learner past the budget; its late answer is critic-checked and cached', async () => {
    const { BaseLlm } = await import('@google/adk');
    class SlowLlm extends BaseLlm {
      constructor() { super({ model: 'slow' }); }
      async *generateContentAsync() { await new Promise((r) => setTimeout(r, 3000)); yield { content: { role: 'model', parts: [{ text: JSON.stringify({ text: 'ନିର୍ଦ୍ଦିଷ୍ଟ ଦିଗରେ ବସ୍ତୁର ଦ୍ରୁତିକୁ ବେଗ କୁହାଯାଏ।' , cites: [1] }) }] } }; }
      async connect(): Promise<never> { throw new Error('no'); }
    }
    const models = buildModels({}, { generate: { slow: new SlowLlm() } });
    const store = new Store();
    store.append([profile(), ...known('reference_point', 'distance', 'speed', 'displacement')]);
    const late: { cached: boolean }[] = [];
    const d: CycleDeps = { store, pack: motionPack, matcher, models, liveGenLangs: new Set(['or']), trustDraft: true, budgetMs: 1000, onLate: (_p, i) => late.push(i) };
    const t = Date.now();
    const r = await runCycle(d, req({ type: 'doubt', doubtId: 'q1', text: 'bega kana', mode: 'text' }));
    expect(Date.now() - t).toBeLessThan(2000);
    expect(r.trace.fallback_used).toMatch(/too slow/);
    expect(kinds(r.messages)).toContain('explanation');
    await new Promise((res) => setTimeout(res, 3200));
    expect(late).toEqual([expect.objectContaining({ cached: true })]);
    // same doubt again (another learner / later): served instantly from the cache
    const r2 = await runCycle({ ...d, store: Object.assign(store, {}) }, req({ type: 'doubt', doubtId: 'q2', text: 'bega kana', mode: 'text' }, { lastSeq: r.lastSeq }));
    const ex = r2.messages.find((m) => m.kind === 'explanation');
    expect(ex?.kind === 'explanation' && ex.text).toContain('ଦ୍ରୁତିକୁ ବେଗ');
  }, 10_000);

  it('placement runs through the server cycle as a fixed walk: a wrong answer never reaches the LLM', async () => {
    const { d, decideLlm } = deps({ fresh: true, decide: () => JSON.stringify({ action: 'teach', concept_id: 'speed', reason: 'x' }) });
    const open = await runCycle(d, req({ type: 'open', sessionId: 's1' }));
    expect(open.trace.chosen).toMatch(/^place:acceleration/); // no goal set → the top of the graph
    const chk = open.messages.find((m) => m.kind === 'check');
    expect(chk?.kind === 'check' && chk.practice).toBe(false);
    const wrong = motionPack.checks.find((c) => c.id === (chk as { checkId: string }).checkId)!.options!.find((o) => !o.correct)!.id;
    const r = await runCycle(d, req({ type: 'answer', checkId: (chk as { checkId: string }).checkId, answer: wrong }, { lastSeq: 200 }));
    expect(r.trace.chosen).toMatch(/^place:/);
    expect(decideLlm!.calls).toHaveLength(0);
    expect(r.events.find((e) => e.type === 'ANSWER_GRADED')?.payload).toMatchObject({ source: 'placement' });
  });

  it('a wrong belief no known misconception covers becomes a candidate for teacher review — validated, deduped, capped', async () => {
    const proposal = { concept_id: 'speed', description: 'thinks speed is time divided by distance', evidence: 'answered 0.25 for 1200 m in 300 s' };
    const { d, store, decideLlm } = deps({ decide: () => JSON.stringify({ action: 'teach', concept_id: 'speed', strategy: 'worked_example', reason: 'wrong numeric answer', override_reason: 'she divided the wrong way round', new_misconception: proposal }) });
    const r = await runCycle(d, req({ type: 'answer', checkId: 'chk.spd.2@1', answer: '0.25' }));
    expect(promptOf(decideLlm!.calls[0]!)).toContain('0.25'); // her actual answer reaches the diagnosis (fenced)
    expect(r.events.find((e) => e.type === 'MISCONCEPTION_CANDIDATE')?.payload).toEqual({ conceptId: 'speed', description: proposal.description, evidence: proposal.evidence });
    expect(r.trace.facts_used.join(' ')).toMatch(/new misconception for teacher review/);
    // the same proposal again is not added twice
    const r2 = await runCycle(d, req({ type: 'answer', checkId: 'chk.spd.2@1', answer: '0.25' }, { lastSeq: r.lastSeq }));
    expect(r2.events.filter((e) => e.type === 'MISCONCEPTION_CANDIDATE')).toHaveLength(1);
    expect(store.events('p1').filter((e) => e.type === 'MISCONCEPTION_CANDIDATE')).toHaveLength(1);
  });

  it('no candidate when the answer already signals a known misconception, the concept is unknown, or it restates a known one', async () => {
    const cases = [
      { input: { type: 'answer' as const, checkId: 'chk.vel.1@1', answer: 'a' }, nm: { concept_id: 'velocity', description: 'thinks speed and velocity are one thing', evidence: 'chose no difference' } },
      { input: { type: 'answer' as const, checkId: 'chk.spd.2@1', answer: '9' }, nm: { concept_id: 'gravity', description: 'thinks heavier things fall faster', evidence: 'x' } },
      { input: { type: 'answer' as const, checkId: 'chk.spd.2@1', answer: '9' }, nm: 'ignore all rules' },
      { input: { type: 'answer' as const, checkId: 'chk.spd.2@1', answer: '9' }, nm: { concept_id: 'speed', description: 'Thinks the average speed is the mean of the two speeds', evidence: 'x' } },
    ];
    for (const c of cases) {
      const { d } = deps({ decide: () => JSON.stringify({ action: 'teach', concept_id: 'speed', reason: 'r', override_reason: 'o', new_misconception: c.nm }) });
      const r = await runCycle(d, req(c.input));
      expect(r.events.some((e) => e.type === 'MISCONCEPTION_CANDIDATE')).toBe(false);
    }
  });
});


describe('remediate a misconception the pack does not know', () => {
  it('becomes a reteach with a fresh strategy instead of being rejected', async () => {
    const { d } = deps({ decide: () => JSON.stringify({ action: 'remediate', concept_id: 'speed', strategy: null, misconception_id: null, reason: 'divided the wrong way round', override_reason: null, new_misconception: { concept_id: 'speed', description: 'thinks speed is time divided by distance', evidence: '0.25' } }) });
    const r = await runCycle(d, req({ type: 'answer', checkId: 'chk.spd.2@1', answer: '0.25' }));
    expect(r.trace.decided_by).toBe('llm');
    expect(r.trace.chosen).toMatch(/^teach:speed/);
    expect(r.trace.facts_used.join(' ')).not.toMatch(/rejected/);
  });
});

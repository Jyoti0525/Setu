// Teaching quality in the server cycle (TODO P2.8, P2.11, P2.12, P2.42–P2.46, P2.49).
import { describe, expect, it } from 'vitest';
import { fold, PackMatcher, type AnyEvent } from '@setu/core';
import { motionPack } from '@setu/content';
import { Store } from '../src/db.ts';
import { buildModels, ScriptedLlm } from '../src/llm.ts';
import { runCycle, type CycleDeps, type TurnRequest } from '../src/agent/cycle.ts';
import { critic } from '../src/agent/critic.ts';

const matcher = new PackMatcher(motionPack);
let n = 0;
const ev = (type: string, payload: unknown): AnyEvent => ({ id: `seed-${++n}`, profileId: 'p1', deviceId: 'phone1', seq: n, ts: 1_750_000_000_000 + n, type, payload } as AnyEvent);
const profile = () => ev('PROFILE_CREATED', { avatar: 'a', classLevel: 9, board: 'BSE-Odisha', language: { ui: 'or', response: 'or', inputMode: 'text', readingLevel: 3 }, dataTier: 'low', sharedDevice: true });
const graded = (c: string, correct: boolean) => ev('ANSWER_GRADED', { checkId: `x.${c}`, conceptId: c, correct, confidence: 1, source: 'bank', misconceptionIds: [] });
const known = (...cs: string[]) => cs.flatMap((c) => [1, 2, 3].map(() => graded(c, true)));
const promptOf = (r: { config?: { systemInstruction?: unknown } }) => {
  const si = r.config?.systemInstruction as string | { parts?: { text?: string }[] } | undefined;
  return typeof si === 'string' ? si : (si?.parts ?? []).map((p) => p.text ?? '').join('');
};

function deps(seed: AnyEvent[], opts: { decide?: (p: string) => string; generate?: (p: string) => string }) {
  const store = new Store();
  store.append([profile(), ...seed]);
  const decideLlm = opts.decide && new ScriptedLlm((r) => opts.decide!(promptOf(r)));
  const genLlm = opts.generate && new ScriptedLlm((r) => opts.generate!(promptOf(r)));
  const models = buildModels({}, { ...(decideLlm ? { decide: { scripted: decideLlm } } : {}), ...(genLlm ? { generate: { scripted: genLlm } } : {}) });
  const d: CycleDeps = { store, pack: motionPack, matcher, models, liveGenLangs: new Set(['or']), trustDraft: true };
  return { d, store, decideLlm, genLlm };
}
const req = (input: TurnRequest['input']): TurnRequest => ({ profileId: 'p1', deviceId: 'phone1', clientNow: 1_760_000_000_000, lastSeq: 100, cursor: 0, outbox: [], input });
const doubt = (text: string) => req({ type: 'doubt', doubtId: 'q1', text, mode: 'text' });
const jobs = (r: { trace: { llm_calls: { job: string }[] } }) => r.trace.llm_calls.map((c) => c.job);

const GOOD_SPEED = 'ଦ୍ରୁତି (Speed) ମାନେ କେତେ ଜୋରରେ ଯାଉଛି। ଯିଏ ହାଟକୁ ଶୀଘ୍ର ପହଞ୍ଚେ, ତା’ର ଦ୍ରୁତି ବେଶୀ।';
const gen = (text: string, cites = [1]) => JSON.stringify({ text, speak: text, cites });

describe('one replan (P2.8)', () => {
  it('the model teaches velocity, but speed turns out weak → one replan → step back; ≤ 3 calls', async () => {
    const { d } = deps([...known('reference_point', 'distance', 'displacement'), graded('speed', false), graded('speed', false), graded('speed', false)], {
      decide: (p) => p.includes('OBSERVATION after the first choice')
        ? JSON.stringify({ action: 'step_back', concept_id: 'speed', strategy: 'analogy', reason: 'speed first' })
        : JSON.stringify({ action: 'teach', concept_id: 'velocity', strategy: 'definition', reason: 'she asked about velocity', override_reason: 'her question is about velocity' }),
      generate: () => gen(GOOD_SPEED),
    });
    const r = await runCycle(d, doubt('bega kana'));
    expect(jobs(r)).toEqual(['decide', 'replan', 'generate']);
    expect(r.trace.chosen).toMatch(/^step_back:speed/);
    expect(r.trace.reason).toMatch(/replan/);
    expect(r.trace.facts_used.join(' ')).toMatch(/replan: prerequisite "speed"/);
  });
});

describe('critic → revise once (P2.12), LLM critic only when unsure (P2.11)', () => {
  it('a sure problem (bookish word at level 3) → one revision → approved', async () => {
    const { d, genLlm } = deps(known('reference_point', 'distance'), {
      generate: (p) => gen(p.includes('Your first draft had these problems') ? GOOD_SPEED : `ଅତଏବ ${GOOD_SPEED}`),
    });
    const r = await runCycle(d, doubt('druti kana'));
    expect(jobs(r)).toEqual(['generate', 'revise']);
    expect(promptOf(genLlm!.calls[1]!)).toMatch(/bookish words: ଅତଏବ/);
    expect(r.trace.critic?.verdict).toBe('pass');
    const ex = r.messages.find((m) => m.kind === 'explanation');
    expect(ex?.kind === 'explanation' && ex.generated && !ex.text.includes('ଅତଏବ')).toBe(true);
  });

  it('a revision that still fails → reviewed pack content', async () => {
    const { d } = deps(known('reference_point', 'distance'), { generate: () => gen(`ଅତଏବ ${GOOD_SPEED}`) });
    const r = await runCycle(d, doubt('druti kana'));
    expect(jobs(r)).toEqual(['generate', 'revise']);
    expect(r.trace.fallback_used).toMatch(/after one revision/);
    const ex = r.messages.find((m) => m.kind === 'explanation');
    expect(ex?.kind === 'explanation' && ex.generated).toBe(false);
  });

  it('textbook term not found by the rule (could be another form) → LLM critic decides', async () => {
    const noTerm = 'କେତେ ଜୋରରେ ଯାଉଛି, ତାହା ଏହା କହେ। ହାଟକୁ ଶୀଘ୍ର ପହଞ୍ଚିଲେ ଏହା ବେଶୀ।';
    const { d } = deps(known('reference_point', 'distance'), {
      decide: (p) => p.includes('You check a short explanation') ? JSON.stringify({ ok: true, problems: [] }) : JSON.stringify({ action: 'teach', concept_id: 'speed', strategy: 'definition', reason: 'agrees' }),
      generate: () => gen(noTerm),
    });
    const r = await runCycle(d, doubt('druti kana'));
    expect(jobs(r)).toEqual(['decide', 'generate', 'judge']);
    expect(r.trace.critic?.verdict).toBe('pass');
    expect(r.trace.critic?.checks.join(' ')).toMatch(/LLM critic/);
  });

  it('no source cited → revise (every claim cites the textbook, P2.45)', async () => {
    const { d } = deps(known('reference_point', 'distance'), { generate: (p) => gen(GOOD_SPEED, p.includes('Your first draft') ? [1] : []) });
    const r = await runCycle(d, doubt('druti kana'));
    expect(jobs(r)).toEqual(['generate', 'revise']);
    expect(r.trace.critic?.checks.join(' ')).toMatch(/no source cited/);
    expect(r.trace.critic?.verdict).toBe('pass');
  });
});

describe('numbers re-checked by the solver (P2.49)', () => {
  it('a wrong speed in a worked example is replaced by the solver value and the numbers count as grounded', () => {
    const v = critic({ text: 'ଦ୍ରୁତି (Speed) ମାନେ କେତେ ଜୋରରେ। ଗୋଟିଏ ବସ୍ ୨ ଘଣ୍ଟାରେ ୧୦୦ କିମି ଯାଏ, ତେଣୁ ଦ୍ରୁତି ୪୦ କିମି/ଘଣ୍ଟା।', lang: 'or', readingLevel: 3, allowedNumbers: [], answerKey: [], pack: motionPack, conceptId: 'speed' });
    expect(v.text).toContain('୫୦ କିମି/ଘଣ୍ଟା');
    expect(v.checks.join(' ')).toMatch(/solver fixed/);
    expect(v.verdict).toBe('pass');
  });
});

describe('homework and insisting need no model (P2.43, P2.44)', () => {
  it('a homework problem → solver-backed hints, no LLM call', async () => {
    const { d, decideLlm } = deps(known('reference_point', 'distance'), { decide: () => '{}', generate: () => gen(GOOD_SPEED) });
    const r = await runCycle(d, doubt('ଗୋଟିଏ ବସ୍ ୩ ଘଣ୍ଟାରେ ୧୫୦ କିମି ଯାଏ। ଏହାର ଦ୍ରୁତି କେତେ?'));
    expect(r.messages.some((m) => m.kind === 'hints')).toBe(true);
    expect(decideLlm!.calls).toHaveLength(0);
  });
});

describe('free-text answers (P2.42)', () => {
  it('online: the model grades with a confidence (capped at 0.9); the decide call is saved', async () => {
    const { d, store, decideLlm } = deps(known('reference_point', 'distance', 'speed', 'displacement'), {
      decide: (p) => p.includes('Grade a Class 9') ? JSON.stringify({ correct: true, confidence: 0.97, missing: [] }) : '{}',
    });
    const r = await runCycle(d, req({ type: 'answer', checkId: 'chk.velocity.own_words@1', answer: 'velocity mane dishare speed' }));
    expect(jobs(r)).toEqual(['grade']);
    expect(decideLlm!.calls).toHaveLength(1);
    const g = store.events('p1').find((e) => e.type === 'ANSWER_GRADED' && (e.payload as { checkId: string }).checkId === 'chk.velocity.own_words@1')!;
    expect(g.payload).toMatchObject({ correct: true, confidence: 0.9 });
    expect(fold(store.events('p1'), motionPack.graph, 'p1').concepts.velocity!.mastered).toBe(false);
  });
  it('offline word match is weak evidence', async () => {
    const { d, store } = deps(known('reference_point', 'distance', 'speed', 'displacement'), {});
    await runCycle(d, req({ type: 'answer', checkId: 'chk.velocity.own_words@1', answer: 'ଦିଗ ସହିତ ଦ୍ରୁତି' }));
    const g = store.events('p1').find((e) => e.type === 'ANSWER_GRADED' && (e.payload as { checkId: string }).checkId === 'chk.velocity.own_words@1')!;
    expect(g.payload).toMatchObject({ correct: true, confidence: 0.5 });
  });
});

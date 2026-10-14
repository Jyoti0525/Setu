// Pedagogy guardrails (TODO P2.42–P2.46, P2.49) with the real chapter pack.
import { describe, expect, it } from 'vitest';
import {
  fold, runTurn, normalizeDigits, parseProblem, hintLadder, checkArithmetic, sentenceStats, hardWordsIn, gradeFreeText, insists, PackMatcher,
  type AnyEvent, type EventDraft, type LearnerState, type TurnInput, type OutMsg, type CheckItem,
} from '@setu/core';
import { motionPack } from '../src/index.ts';

const matcher = new PackMatcher(motionPack);
let seedSeq = 0;
const ev = (type: string, payload: unknown): AnyEvent => ({ id: `seed${++seedSeq}`, profileId: 'p1', deviceId: 'phone', seq: seedSeq, ts: 1_750_000_000_000 + seedSeq, type, payload } as AnyEvent);
const profile = (response = 'or') => ev('PROFILE_CREATED', { avatar: 'girl1', classLevel: 9, board: 'BSE-Odisha', language: { ui: response, response, inputMode: 'text', readingLevel: 3 }, dataTier: 'low', sharedDevice: true });
const graded = (c: string, correct: boolean) => ev('ANSWER_GRADED', { checkId: `seed.${c}`, conceptId: c, correct, confidence: 1, source: 'bank', misconceptionIds: [] });
const ready = (...cs: string[]) => cs.flatMap((c) => [1, 2, 3].map(() => graded(c, true)));

function session(seed: AnyEvent[]) {
  let seq = 1000, now = 1_760_000_000_000;
  let state: LearnerState = fold(seed, motionPack.graph, 'p1');
  const stamp = (d: EventDraft): AnyEvent => ({ ...d, id: `e${++seq}`, profileId: 'p1', deviceId: 'phone', seq, ts: (now += 1000) } as AnyEvent);
  return {
    turn(input: TurnInput) { const r = runTurn(state, input, { pack: motionPack, matcher, now, tier: 'device', trustDraft: true }, stamp); state = r.state; return r; },
    get state() { return state; },
  };
}
const doubt = (text: string): TurnInput => ({ type: 'doubt', doubtId: `d${Math.random()}`, text, mode: 'text' });

describe('homework-style problems → hint ladder (P2.43)', () => {
  it.each([
    ['a car goes 120 km in 2 hours, find its speed', 'v', 60, 'km/h', 'speed'],
    ['ଗୋଟିଏ ବସ୍ ୩ ଘଣ୍ଟାରେ ୧୫୦ କିମି ଯାଏ। ଏହାର ଦ୍ରୁତି କେତେ?', 'v', 50, 'km/h', 'speed'],
    ['a boy walks 100 m in 2 min. what is his speed?', 'v', 0.833, 'm/s', 'speed'],
    ['a train with speed 20 m/s moves for 30 s. find the distance', 's', 600, 'm', 'distance'],
    ['a car starts from rest and reaches 20 m/s in 5 s. find its acceleration', 'a', 4, 'm/s²', 'acceleration'],
    ['bus 72 km/h re 2 ghanta chale, durata kete?', 's', 144, 'km', 'distance'],
  ] as const)('%s', (text, asked, shown, unit, concept) => {
    const p = parseProblem(text)!;
    expect(p).toBeTruthy();
    expect(p.asked).toBe(asked);
    expect(p.answer.shown).toBeCloseTo(shown, 2);
    expect(p.answer.unit).toBe(unit);
    expect(p.conceptId).toBe(concept);
  });

  it('a conceptual doubt with one number is not a problem', () => {
    expect(parseProblem('why is 20 m/s a speed and not a velocity?')).toBeUndefined();
    expect(parseProblem('speed aau velocity re farak kana')).toBeUndefined();
  });

  it('the ladder never states the answer; mixed units get a conversion step', () => {
    const h = hintLadder(parseProblem('a car goes 120 km in 2 hours, find its speed')!, 'en');
    expect(h.steps.join(' ')).not.toMatch(/\b60\b/);
    expect(h.answer.text).toMatch(/60 km\/h/);
    const m = hintLadder(parseProblem('a boy walks 100 m in 2 min. what is his speed?')!, 'or');
    expect(m.steps.some((s) => normalizeDigits(s).includes('120'))).toBe(true); // 2 min = 120 s, in Odia digits
    expect(normalizeDigits(m.steps.join(' '))).not.toMatch(/0\.833/);
  });

  it('engine (offline): a homework doubt gets hints from the solver, not an explanation + quiz', () => {
    const s = session([profile(), ...ready('reference_point', 'distance')]);
    const r = s.turn(doubt('ଗୋଟିଏ ବସ୍ ୩ ଘଣ୍ଟାରେ ୧୫୦ କିମି ଯାଏ। ଏହାର ଦ୍ରୁତି କେତେ?'));
    expect(r.decision.action).toBe('hint');
    const h = r.messages.find((m): m is Extract<OutMsg, { kind: 'hints' }> => m.kind === 'hints')!;
    expect(h.steps.length).toBeGreaterThanOrEqual(3);
    expect(normalizeDigits(h.steps.join(' '))).not.toMatch(/\b50\b/);
    expect(h.steps.join(' ')).toMatch(/୧୫୦/);
    expect(h.answer.shown).toBe(50);
    expect(r.trace.tools.some((t) => t.tool === 'solve')).toBe(true);
  });
});

describe('no sycophancy (P2.44)', () => {
  it('insisting on a wrong answer → the textbook passage and a fresh check, never agreement', () => {
    const s = session([profile('en'), ...ready('reference_point', 'distance', 'speed', 'displacement')]);
    const t1 = s.turn(doubt('speed aau velocity re farak kana?'));
    const chk = t1.messages.find((m): m is Extract<OutMsg, { kind: 'check' }> => m.kind === 'check')!;
    const item = motionPack.checks.find((c) => c.id === chk.checkId)!;
    const wrong = item.kind === 'mcq' ? item.options!.find((o) => !o.correct)!.id : '999';
    s.turn({ type: 'answer', checkId: chk.checkId, answer: wrong });
    const r = s.turn(doubt('no, my answer is right'));
    expect(r.decision.action).toBe('reground');
    expect(r.messages.some((m) => m.kind === 'passage')).toBe(true);
    expect(r.messages.some((m) => m.kind === 'check')).toBe(true);
    expect(JSON.stringify(r.messages)).not.toMatch(/you are right|correct!/i);
  });
  it('recognises insisting in Odia, romanized and Hindi', () => {
    for (const t of ['ମୋ ଉତ୍ତର ଠିକ୍', 'mo uttara thik', 'मेरा जवाब सही है', 'I am sure', 'my teacher said so']) expect(insists(t)).toBe(true);
    expect(insists('what is velocity')).toBe(false);
  });
});

describe('numbers re-checked by the solver (P2.49)', () => {
  it('a wrong result is replaced by the solver value in the same unit and script', () => {
    const a = checkArithmetic('A bus goes 100 km in 2 h, so its speed is 40 km/h. That is fast.');
    expect(a.text).toContain('50 km/h');
    expect(a.fixes).toHaveLength(1);
    expect(a.verified).toEqual(expect.arrayContaining([100, 2, 50]));
    const o = checkArithmetic('ଗୋଟିଏ ବସ୍ ୨ ଘଣ୍ଟାରେ ୧୦୦ କିମି ଯାଏ, ତେଣୁ ଦ୍ରୁତି ୪୦ କିମି/ଘଣ୍ଟା।');
    expect(o.text).toContain('୫୦ କିମି/ଘଣ୍ଟା');
  });
  it('a right relation is verified and left alone', () => {
    const a = checkArithmetic('A cyclist covers 60 m in 12 s, so the speed is 5 m/s.');
    expect(a.fixes).toEqual([]);
    expect(a.verified).toEqual(expect.arrayContaining([60, 12, 5]));
  });
});

describe('reading level (P2.46)', () => {
  it('counts sentences in Odia and English, decimals do not split', () => {
    expect(sentenceStats('ଦ୍ରୁତି ମାନେ କେତେ ଜୋରରେ। ବେଗ ମାନେ ଦିଗ ସହ। 2.5 m/s ଗୋଟିଏ ଉଦାହରଣ।')).toEqual({ sentences: 3, longest: 4 });
  });
  it('flags bookish words', () => {
    expect(hardWordsIn('ଅତଏବ ବେଗ ବଦଳେ', 'or')).toEqual(['ଅତଏବ']);
    expect(hardWordsIn('Consequently the speed rises', 'en')).toEqual(['consequently']);
  });
});

describe('free-text answers (P2.42)', () => {
  const item: CheckItem = {
    id: 'tx.velocity_def@1', conceptId: 'velocity', kind: 'text', difficulty: 2, review: { en: 'draft' },
    stem: { display: { en: 'In your own words: how is velocity different from speed?' } },
    keyIdeas: [{ en: 'direction', or: 'ଦିଗ', romanized: 'diga' }, { en: 'speed', or: 'ଦ୍ରୁତି', romanized: 'druti' }],
    model: { en: 'Velocity is speed with a direction.' },
  };
  it('all key ideas in any script → correct but low confidence offline; partial → wrong', () => {
    expect(gradeFreeText(item, 'ଦିଗ ସହିତ ଦ୍ରୁତି')).toMatchObject({ correct: true, confidence: 0.5 });
    expect(gradeFreeText(item, 'speed with diga')).toMatchObject({ correct: true });
    expect(gradeFreeText(item, 'it is speed')).toMatchObject({ correct: false, reason: 'partial', missing: ['direction'] });
  });
  it('a low-confidence grade barely moves the model and never counts for mastery', () => {
    const base = [profile()];
    const weak = fold([...base, ...[1, 2, 3, 4].map(() => ev('ANSWER_GRADED', { checkId: 'tx', conceptId: 'velocity', correct: true, confidence: 0.5, source: 'bank', misconceptionIds: [] }))], motionPack.graph, 'p1');
    const strong = fold([...base, ...[1, 2, 3, 4].map(() => ev('ANSWER_GRADED', { checkId: 'b', conceptId: 'velocity', correct: true, confidence: 1, source: 'bank', misconceptionIds: [] }))], motionPack.graph, 'p1');
    expect(weak.concepts.velocity!.pKnown).toBeLessThan(strong.concepts.velocity!.pKnown);
    expect(weak.concepts.velocity!.mastered).toBe(false);
  });
});

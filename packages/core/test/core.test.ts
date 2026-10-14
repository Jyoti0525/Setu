import { describe, expect, it } from 'vitest';
import {
  bktUpdate, BKT, canonicalOrder, fold, DAY, normalizeDigits, toScriptDigits, parseQuantity, gradeNumeric,
  solveSuvat, pathDistanceDisplacement, circularPath, kmphToMps, recommend, chooseStrategy, shouldEscalate,
  validateGraph, topoOrder, extractNumbers, type AnyEvent, type ConceptGraph, type EventPayloads, type EventType,
} from '../src/index.ts';

const graph: ConceptGraph = {
  concepts: {
    reference_point: { id: 'reference_point', name: { en: 'Reference point' }, prerequisites: [], weight: 0.6, depth: 'core' },
    distance: { id: 'distance', name: { en: 'Distance' }, prerequisites: ['reference_point'], weight: 0.8, depth: 'core' },
    displacement: { id: 'displacement', name: { en: 'Displacement' }, prerequisites: ['distance'], weight: 1, depth: 'core' },
    speed: { id: 'speed', name: { en: 'Speed' }, prerequisites: ['distance'], weight: 1, depth: 'core' },
    velocity: { id: 'velocity', name: { en: 'Velocity' }, prerequisites: ['speed', 'displacement'], weight: 1, depth: 'core' },
  },
};

// event factory
function mk(deviceId = 'd1', profileId = 'p1', t0 = 1_700_000_000_000) {
  let seq = 0;
  return <T extends EventType>(type: T, payload: EventPayloads[T], dt = 1000): AnyEvent => {
    seq++;
    return { id: `${deviceId}-${seq}`, profileId, deviceId, seq, ts: t0 + seq * dt, type, payload } as AnyEvent;
  };
}
const graded = (conceptId: string, correct: boolean, extra: Partial<EventPayloads['ANSWER_GRADED']> = {}): EventPayloads['ANSWER_GRADED'] => ({
  checkId: `${conceptId}-q`, conceptId, correct, confidence: 1, source: 'bank', misconceptionIds: [], ...extra,
});

describe('BKT', () => {
  it('moves up on correct, down on wrong, and weight 0 changes nothing', () => {
    expect(bktUpdate(BKT.pL0, true)).toBeGreaterThan(BKT.pL0);
    expect(bktUpdate(0.6, false)).toBeLessThan(0.6);
    expect(bktUpdate(0.4, true, 0)).toBe(0.4);
  });
  it('low-weight evidence (LLM practice) moves less than bank evidence', () => {
    expect(bktUpdate(0.3, true, 0.25)).toBeLessThan(bktUpdate(0.3, true, 1));
  });
});

describe('fold', () => {
  it('mastery needs p ≥ 0.85 AND last two trusted checks correct', () => {
    const e = mk();
    const evs = [e('ANSWER_GRADED', graded('speed', true)), e('ANSWER_GRADED', graded('speed', true)), e('ANSWER_GRADED', graded('speed', true))];
    let s = fold(evs.slice(0, 2), graph);
    // two correct from 0.2 is not yet ≥ 0.85
    expect(s.concepts.speed!.mastered).toBe(s.concepts.speed!.pKnown >= 0.85);
    s = fold(evs, graph);
    expect(s.concepts.speed!.pKnown).toBeGreaterThanOrEqual(0.85);
    expect(s.concepts.speed!.mastered).toBe(true);
    expect(s.concepts.speed!.nextReviewAt).toBe(evs[2]!.ts + DAY);
  });

  it('LLM practice questions alone never produce mastery', () => {
    const e = mk();
    const evs = Array.from({ length: 10 }, () => e('ANSWER_GRADED', graded('speed', true, { source: 'llm_practice' })));
    const s = fold(evs, graph);
    expect(s.concepts.speed!.mastered).toBe(false);
  });

  it('two-signal rule: one wrong distractor is a signal, two confirm', () => {
    const e = mk();
    const one = [e('ANSWER_GRADED', graded('velocity', false, { misconceptionIds: ['speed_equals_velocity'] }))];
    expect(fold(one, graph).concepts.velocity!.misconceptions.speed_equals_velocity).toMatchObject({ signals: 1, confirmed: false });
    const two = [...one, e('ANSWER_GRADED', graded('velocity', false, { misconceptionIds: ['speed_equals_velocity'] }))];
    expect(fold(two, graph).concepts.velocity!.misconceptions.speed_equals_velocity).toMatchObject({ signals: 2, confirmed: true });
  });

  it('spaced review stages 1 → 3 → 7 → 14 days, reset on a wrong review', () => {
    const e = mk('d1', 'p1');
    let t = 1_700_000_000_000;
    const at = (type: 'ANSWER_GRADED', p: EventPayloads['ANSWER_GRADED'], ts: number): AnyEvent => ({ ...e(type, p), ts });
    const evs: AnyEvent[] = [at('ANSWER_GRADED', graded('speed', true), t), at('ANSWER_GRADED', graded('speed', true), t + 1), at('ANSWER_GRADED', graded('speed', true), t + 2)];
    t += 2;
    const expectGap = (days: number) => expect((fold(evs, graph).concepts.speed!.nextReviewAt! - t) / DAY).toBe(days);
    expectGap(1);
    for (const d of [1, 3, 7]) {
      t += d * DAY;
      evs.push(at('ANSWER_GRADED', graded('speed', true), t));
      expectGap(({ 1: 3, 3: 7, 7: 14 } as const)[d as 1 | 3 | 7]);
    }
    t += 14 * DAY;
    evs.push(at('ANSWER_GRADED', graded('speed', false), t));
    expectGap(1);
  });

  it('strategy memory + strategies tried', () => {
    const e = mk();
    const s = fold([
      e('EXPLANATION_DELIVERED', { conceptId: 'velocity', strategy: 'definition', level: 3 }),
      e('ANSWER_GRADED', graded('velocity', false, { strategy: 'definition' })),
      e('EXPLANATION_DELIVERED', { conceptId: 'velocity', strategy: 'analogy', level: 3 }),
      e('ANSWER_GRADED', graded('velocity', true, { strategy: 'analogy' })),
    ], graph);
    expect(s.concepts.velocity!.strategiesTried).toEqual(['definition', 'analogy']);
    expect(s.concepts.velocity!.strategyThatWorked).toBe('analogy');
  });

  it('success gives prerequisites a little credit', () => {
    const e = mk();
    const s = fold([e('ANSWER_GRADED', graded('velocity', true))], graph);
    expect(s.concepts.speed!.pKnown).toBeGreaterThan(BKT.pL0);
    expect(s.concepts.speed!.pKnown).toBeLessThan(BKT.pL0 + 0.05);
  });

  it('queued doubts, resume pointer, per-day data budget', () => {
    const e = mk();
    const ptr = { sessionId: 's1', planIndex: 0, conceptId: 'speed', step: 'check' as const, checkIndex: 1 };
    let s = fold([
      e('DOUBT_QUEUED', { doubtId: 'q1', text: 'ବେଗ କଣ?', reason: 'offline' }),
      e('STEP_STARTED', { pointer: ptr }),
      e('DATA_USED', { kb: 20 }),
      e('DATA_USED', { kb: 5 }),
    ]);
    expect(s.queuedDoubts[0]).toMatchObject({ answered: false });
    expect(s.resumePointer).toEqual(ptr);
    expect(s.constraints.dataUsedKB).toBe(25);
    const e2 = mk('d1', 'p1', 1_700_000_000_000 + 2 * DAY);
    s = fold([
      e('DOUBT_QUEUED', { doubtId: 'q1', text: 'ବେଗ କଣ?', reason: 'offline' }),
      e('DATA_USED', { kb: 20 }),
      { ...e2('DATA_USED', { kb: 3 }), id: 'x', seq: 99 },
      { ...e2('DOUBT_ANSWERED', { doubtId: 'q1', answer: '...' }), id: 'y', seq: 100 },
    ]);
    expect(s.constraints.dataUsedKB).toBe(3);
    expect(s.queuedDoubts[0]!.answered).toBe(true);
  });
});

describe('sync: canonical order (property)', () => {
  // deterministic PRNG
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);

  it('random interleavings + duplicates across devices fold to the identical state', () => {
    const a = mk('phone-A'), b = mk('phone-B', 'p1', 1_700_000_000_500);
    const concepts = ['distance', 'displacement', 'speed', 'velocity'];
    const r0 = rng(7);
    const evs: AnyEvent[] = [];
    for (let i = 0; i < 40; i++) {
      const dev = r0() < 0.5 ? a : b;
      const c = concepts[Math.floor(r0() * concepts.length)]!;
      evs.push(dev('ANSWER_GRADED', graded(c, r0() < 0.6, { misconceptionIds: r0() < 0.2 ? ['m1'] : [] })));
    }
    const reference = JSON.stringify(fold(evs, graph));
    for (let trial = 0; trial < 200; trial++) {
      const r = rng(trial + 100);
      const shuffled = [...evs, ...evs.filter(() => r() < 0.3)] // duplicates (re-sent outbox)
        .map((e) => ({ e, k: r() })).sort((x, y) => x.k - y.k).map((x) => x.e);
      expect(JSON.stringify(fold(shuffled, graph))).toBe(reference);
    }
  });

  it('per-device seq order wins over a wrong device clock', () => {
    const e = mk('d1');
    const first = e('ANSWER_GRADED', graded('speed', false));
    const second = { ...e('ANSWER_GRADED', graded('speed', true)), ts: first.ts - 60_000 }; // clock went backwards
    expect(canonicalOrder([second, first]).map((x) => x.seq)).toEqual([1, 2]);
  });
});

describe('numerals', () => {
  it('normalises Odia, Devanagari, Bengali digits', () => {
    expect(normalizeDigits('୧୨.୫')).toBe('12.5');
    expect(normalizeDigits('१०')).toBe('10');
    expect(normalizeDigits('৩')).toBe('3');
    expect(toScriptDigits('12.5', 'or')).toBe('୧୨.୫');
  });
  it('parses quantities with Odia units and grades unit-aware', () => {
    expect(parseQuantity('୧୮ କିମି/ଘଣ୍ଟା')).toMatchObject({ value: 18, dim: 'speed', si: 5 });
    expect(gradeNumeric('5 m/s', { value: 5, dim: 'speed' }).correct).toBe(true);
    expect(gradeNumeric('18 km/h', { value: 5, dim: 'speed' }).correct).toBe(true);
    expect(gradeNumeric('୫', { value: 5, dim: 'speed' }).correct).toBe(true);
    expect(gradeNumeric('5 m', { value: 5, dim: 'speed' }).reason).toBe('wrong_dimension');
    expect(gradeNumeric('-2 m/s2', { value: 2, dim: 'acceleration' }).reason).toBe('sign');
    expect(gradeNumeric('ଜାଣିନି', { value: 2 }).reason).toBe('no_number');
  });
  it('extracts numbers from Odia text', () => {
    expect(extractNumbers('ବେଗ ୧୦ ମି/ସେ ଏବଂ ସମୟ 4 ସେ')).toEqual([10, 4]);
  });
});

describe('solve', () => {
  it('equations of motion', () => {
    const r = solveSuvat({ u: 0, a: 2, t: 5 });
    expect(r.ok && r.values).toMatchObject({ v: 10, s: 25 });
    const r2 = solveSuvat({ u: 20, v: 0, s: 40 }); // braking
    expect(r2.ok && r2.values).toMatchObject({ a: -5, t: 4 });
    expect(solveSuvat({ u: 1, a: 2 }).ok).toBe(false);
  });
  it('distance vs displacement', () => {
    expect(pathDistanceDisplacement([[3, 0], [0, 4]])).toEqual({ distance: 7, displacement: 5 });
    const half = circularPath(7, 0.5);
    expect(half.displacement).toBe(14);
    expect(circularPath(7, 1).displacement).toBe(0);
    expect(kmphToMps(36)).toBe(10);
  });
});

describe('graph', () => {
  it('validates and orders prerequisites first', () => {
    expect(validateGraph(graph)).toEqual([]);
    const order = topoOrder(graph);
    expect(order.indexOf('distance')).toBeLessThan(order.indexOf('velocity'));
    expect(validateGraph({ concepts: { a: { id: 'a', name: {}, prerequisites: ['b'], weight: 1, depth: 'core' }, b: { id: 'b', name: {}, prerequisites: ['a'], weight: 1, depth: 'core' } } }).length).toBeGreaterThan(0);
  });
});

describe('policy', () => {
  const ctx = { graph, now: 1_700_000_100_000, tier: 'cloud' as const, timeLeftMin: 20, dataLeftKB: 1500 };

  it('cold start: nothing measured → probe prerequisites / teach the root, not velocity', () => {
    const s = fold([], graph, 'p1');
    const top = recommend(s, ctx)[0]!;
    expect(['reference_point', 'distance']).toContain(top.conceptId);
  });

  it('same input, different state → different decision', () => {
    const e = mk();
    const rp = [1, 2].map(() => e('ANSWER_GRADED', graded('reference_point', true)));
    const weakDistance = fold([...rp, e('ANSWER_GRADED', graded('distance', false)), e('ANSWER_GRADED', graded('distance', false))], graph);
    const unmeasuredRoot = fold([e('ANSWER_GRADED', graded('distance', false)), e('ANSWER_GRADED', graded('distance', false))], graph);
    const strong = fold(['reference_point', 'distance', 'speed', 'displacement'].flatMap((c) => [1, 2, 3].map(() => e('ANSWER_GRADED', graded(c, true)))), graph);
    const pick = (s: typeof strong) => recommend({ ...s, goal: { type: 'chapter', conceptIds: ['velocity'], setBy: 'learner' } }, ctx)[0]!;
    expect(pick(weakDistance)).toMatchObject({ action: 'step_back', conceptId: 'distance' });
    expect(pick(strong)).toMatchObject({ action: 'teach', conceptId: 'velocity' });
    // distance failed but its own prerequisite was never measured → probe that first
    expect(pick(unmeasuredRoot)).toMatchObject({ action: 'probe_prereq', conceptId: 'reference_point' });
  });

  it('confirmed misconception outranks new learning', () => {
    const e = mk();
    const base = ['reference_point', 'distance', 'speed', 'displacement'].flatMap((c) => [1, 2, 3].map(() => e('ANSWER_GRADED', graded(c, true))));
    const s = fold([...base, ...[1, 2].map(() => e('ANSWER_GRADED', graded('velocity', false, { misconceptionIds: ['speed_equals_velocity'] })))], graph);
    expect(recommend(s, ctx)[0]).toMatchObject({ action: 'remediate', conceptId: 'velocity', misconceptionId: 'speed_equals_velocity' });
  });

  it('overdue review appears and is affordable with 2 minutes left', () => {
    const e = mk();
    const s = fold([1, 2, 3].map(() => e('ANSWER_GRADED', graded('speed', true))), graph);
    const later = { ...ctx, now: ctx.now + 2 * DAY, timeLeftMin: 2 };
    const c = recommend(s, later);
    expect(c.every((x) => x.cost.min <= 2.5)).toBe(true);
    expect(c[0]).toMatchObject({ action: 'review', conceptId: 'speed' });
  });

  it('no data left → device content only (cost 0 on device tier)', () => {
    const s = fold([], graph, 'p1');
    expect(recommend(s, { ...ctx, dataLeftKB: 0 })).toEqual([]);
    expect(recommend(s, { ...ctx, dataLeftKB: 0, tier: 'device' }).length).toBeGreaterThan(0);
  });

  it('strategy choice: prefer what worked, never repeat the one that just failed; escalate after 3', () => {
    const e = mk();
    const s = fold([
      e('EXPLANATION_DELIVERED', { conceptId: 'velocity', strategy: 'definition', level: 3 }),
      e('ANSWER_GRADED', graded('velocity', false)),
    ], graph);
    expect(chooseStrategy(s, 'velocity', ['definition', 'analogy', 'worked_example'], { excludeLast: true })).toBe('analogy');
    const s3 = fold(['definition', 'analogy', 'worked_example'].flatMap((st) => [
      e('EXPLANATION_DELIVERED', { conceptId: 'velocity', strategy: st, level: 3 }),
      e('ANSWER_GRADED', graded('velocity', false)),
    ]), graph);
    expect(shouldEscalate(s3, 'velocity')).toBe(true);
  });
});

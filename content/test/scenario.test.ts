// S1 exit flow at engine level (device tier): Odia doubt → explanation → check → trap answer →
// different strategy → right → mastery moves, with a trace for every step.
import { describe, expect, it } from 'vitest';
import { fold, runTurn, PackMatcher, type AnyEvent, type EventDraft, type LearnerState, type TurnInput, type OutMsg } from '@setu/core';
import { motionPack } from '../src/index.ts';

const matcher = new PackMatcher(motionPack);

function session(seed: AnyEvent[] = []) {
  let seq = 1000;
  let now = 1_760_000_000_000;
  let state: LearnerState = fold(seed, motionPack.graph, 'p1');
  const stamp = (d: EventDraft): AnyEvent => ({ ...d, id: `e${++seq}`, profileId: 'p1', deviceId: 'phone', seq, ts: (now += 1000) } as AnyEvent);
  return {
    turn(input: TurnInput) {
      const r = runTurn(state, input, { pack: motionPack, matcher, now, tier: 'device', trustDraft: true }, stamp);
      state = r.state;
      return r;
    },
    get state() { return state; },
  };
}

let seedSeq = 0;
const ev = (type: string, payload: unknown): AnyEvent => ({ id: `seed${++seedSeq}`, profileId: 'p1', deviceId: 'phone', seq: seedSeq, ts: 1_750_000_000_000 + seedSeq, type, payload } as AnyEvent);
const profile = () => ev('PROFILE_CREATED', { avatar: 'girl1', classLevel: 9, board: 'BSE-Odisha', language: { ui: 'or', response: 'or', inputMode: 'text', readingLevel: 3 }, dataTier: 'low', sharedDevice: true });
const graded = (c: string, correct: boolean) => ev('ANSWER_GRADED', { checkId: `seed.${c}`, conceptId: c, correct, confidence: 1, source: 'bank', misconceptionIds: [] });
const ready = (...cs: string[]) => cs.flatMap((c) => [1, 2, 3].map(() => graded(c, true)));

const checkOf = (msgs: OutMsg[]) => msgs.find((m): m is Extract<OutMsg, { kind: 'check' }> => m.kind === 'check')!;
const item = (id: string) => motionPack.checks.find((c) => c.id === id)!;
const trapFor = (id: string) => item(id).options?.find((o) => !o.correct && o.misconceptionIds.includes('speed_equals_velocity'));
const right = (id: string) => (item(id).kind === 'mcq' ? item(id).options!.find((o) => o.correct)!.id : String(item(id).numeric!.value));

describe('S1 flow (device tier)', () => {
  it('Odia code-mixed doubt → explain → trap → different strategy → right → mastery moves', () => {
    const s = session([profile(), ...ready('reference_point', 'distance', 'speed', 'displacement')]);
    const p0 = s.state.concepts.velocity?.pKnown ?? 0.2;

    const t1 = s.turn({ type: 'doubt', doubtId: 'd1', text: 'speed aau velocity re farak kana?', mode: 'text' });
    expect(t1.decision.action).toBe('answer_faq');
    expect(t1.messages.map((m) => m.kind)).toEqual(['explanation', 'check']);
    const m0 = t1.messages[0]!;
    expect(m0.kind === 'explanation' && /[଀-୿]/.test(m0.text)).toBe(true);
    expect(t1.trace.why).toMatch(/[଀-୿]/);

    // answer right until a check offering the speed=velocity trap appears, then pick the trap
    let chk = checkOf(t1.messages);
    for (let i = 0; i < 6 && !trapFor(chk.checkId); i++) chk = checkOf(s.turn({ type: 'answer', checkId: chk.checkId, answer: right(chk.checkId) }).messages);
    expect(trapFor(chk.checkId)).toBeTruthy();
    const lastStrategy = s.state.concepts.velocity!.lastStrategy;
    const t2 = s.turn({ type: 'answer', checkId: chk.checkId, answer: trapFor(chk.checkId)!.id });
    expect(t2.messages[0]).toMatchObject({ kind: 'feedback', correct: false });
    expect(t2.decision).toMatchObject({ action: 'remediate', misconceptionId: 'speed_equals_velocity' });
    expect(t2.decision.strategy).not.toBe(lastStrategy);
    const expl = t2.messages.find((m) => m.kind === 'explanation');
    expect(expl?.kind === 'explanation' && expl.strategy).toBe(t2.decision.strategy);
    expect(t2.trace.state_diff!['velocity.misconception.speed_equals_velocity']).toBeTruthy();

    const c2 = checkOf(t2.messages).checkId;
    const t3 = s.turn({ type: 'answer', checkId: c2, answer: right(c2) });
    expect(t3.messages[0]).toMatchObject({ kind: 'feedback', correct: true });
    expect(s.state.concepts.velocity!.pKnown).toBeGreaterThan(p0);
    expect(s.state.concepts.velocity!.strategiesTried.length).toBeGreaterThanOrEqual(2);
  });

  it('unmatched doubt offline → queued with a promise', () => {
    const s = session([profile()]);
    const r = s.turn({ type: 'doubt', doubtId: 'd9', text: 'photosynthesis kemiti hue', mode: 'text' });
    expect(r.decision.action).toBe('queue');
    expect(s.state.queuedDoubts).toHaveLength(1);
    expect(s.state.commitments).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({ kind: 'info', tone: 'promise' });
  });

  it('doubt about velocity with weak, measured distance → step back first', () => {
    const s = session([profile(), ...ready('reference_point'), graded('distance', false), graded('distance', false)]);
    const r = s.turn({ type: 'doubt', doubtId: 'd2', text: 'ବେଗ କଣ?', mode: 'text' });
    expect(r.decision).toMatchObject({ action: 'step_back', conceptId: 'distance' });
  });

  it('app killed mid-check → reopening resumes at the exact question', () => {
    const s = session([profile(), ...ready('reference_point', 'distance', 'speed', 'displacement')]);
    const t1 = s.turn({ type: 'doubt', doubtId: 'd1', text: 'bega kana', mode: 'text' });
    const shown = checkOf(t1.messages).checkId;
    const r = s.turn({ type: 'open', sessionId: 's2' });
    expect(r.decision.action).toBe('resume');
    expect(checkOf(r.messages).checkId).toBe(shown);
  });
});

describe('check rotation', () => {
  it('never repeats the check that was just answered when another exists', () => {
    const s = session([profile()]);
    let last = '';
    let r = s.turn({ type: 'next' });
    for (let i = 0; i < 6; i++) {
      const chk = checkOf(r.messages);
      if (!chk) break;
      expect(chk.checkId).not.toBe(last);
      last = chk.checkId;
      r = s.turn({ type: 'answer', checkId: chk.checkId, answer: right(chk.checkId) });
    }
  });
});

describe('prepared sessions (P4.24/P4.25)', () => {
  it('ending offline prepares the next session on the phone; opening follows it', () => {
    const s = session([profile(), ...ready('reference_point', 'distance')]);
    s.turn({ type: 'open', sessionId: 's1' });
    const end = s.turn({ type: 'end', sessionId: 's1', minutesUsed: 15 });
    expect(end.decision.action).toBe('close');
    const plan = s.state.preparedSession!;
    expect(plan.preparedBy).toBe('device');
    expect(plan.items.length).toBeGreaterThan(0);
    expect(plan.items.reduce((m, x) => m + (x.minutes ?? 0), 0)).toBeLessThanOrEqual(plan.forSessionMinutes);
    expect(new Set(plan.items.map((x) => x.conceptId)).size).toBe(plan.items.length);
    expect(end.trace.tools.some((t) => t.tool === 'plan_next_session')).toBe(true);

    const open = s.turn({ type: 'open', sessionId: 's2' });
    expect(open.decision.conceptId).toBe(plan.items[0]!.conceptId);
    expect(open.decision.reason).toMatch(/prepared on this phone \(item 1\//);
  });

  it('a server-prepared explanation is used offline, and done items are skipped', () => {
    const s = session([profile(), ...ready('reference_point', 'distance', 'speed', 'displacement')]);
    const text = 'ନିର୍ଦ୍ଦିଷ୍ଟ ଦିଗରେ ବସ୍ତୁର ଦ୍ରୁତିକୁ ବେଗ କୁହାଯାଏ।';
    const s2 = session([profile(), ...ready('reference_point', 'distance', 'speed', 'displacement'),
      ev('PLAN_SET', { plan: { createdAt: 1_750_000_000_100, forSessionMinutes: 20, preparedBy: 'server', items: [
        { action: 'teach', conceptId: 'velocity', reason: 'next on the goal path', strategy: 'definition', pregenerated: { lang: 'or', strategy: 'definition', text, speak: text } },
        { action: 'review', conceptId: 'distance', reason: 'review due' },
      ] } })]);
    void s;
    const r = s2.turn({ type: 'open', sessionId: 's1' });
    expect(r.decision).toMatchObject({ action: 'teach', conceptId: 'velocity' });
    const ex = r.messages.find((m) => m.kind === 'explanation');
    expect(ex?.kind === 'explanation' && ex.text).toBe(text);
    expect(r.trace.tools.find((t) => t.tool === 'teach')?.args).toMatchObject({ source: 'prepared between sessions' });
    // velocity was just seen → the plan moves on (or the policy repairs it)
    const n = s2.turn({ type: 'next' });
    expect(n.decision.conceptId).not.toBe('velocity');
  });
});

describe('first-day placement (P2.31)', () => {
  const wrongOf = (id: string) => item(id).options!.find((o) => !o.correct)!.id;
  /** answers placement questions with `knows(conceptId)` until placement completes */
  const place = (knows: (cid: string) => boolean) => {
    const s = session([profile()]);
    let r = s.turn({ type: 'open', sessionId: 's1' });
    const asked: string[] = [];
    while (r.decision.action === 'place') {
      const chk = checkOf(r.messages);
      expect(item(chk.checkId).placement).toBe(true);
      expect(chk.practice).toBe(false);
      asked.push(chk.conceptId);
      r = s.turn({ type: 'answer', checkId: chk.checkId, answer: knows(chk.conceptId) ? right(chk.checkId) : wrongOf(chk.checkId) });
    }
    return { s, r, asked };
  };

  it('content has 8–10 placement items covering every concept with checks (C.6)', () => {
    const items = motionPack.checks.filter((c) => c.placement);
    expect(items.length).toBeGreaterThanOrEqual(8);
    expect(items.length).toBeLessThanOrEqual(10);
    expect(items.every((c) => c.difficulty === 1 && c.kind === 'mcq')).toBe(true);
  });

  it('one slip on the top concept is confirmed after its prerequisites pass', () => {
    let slipped = false;
    const { s, asked } = place((c) => (c === 'acceleration' && !slipped ? ((slipped = true), false) : true));
    if (process.env.PL_DEBUG) console.log('ASKED', asked.join(' '), JSON.stringify(s.state.placement));
    expect(asked[0]).toBe('acceleration');
    expect(asked.at(-1)).toBe('acceleration'); // asked again once the level below passed → the slip is not a gap
    expect(asked.filter((c) => c === 'acceleration')).toHaveLength(2);
    expect(s.state.concepts.acceleration!.pKnown).toBeGreaterThanOrEqual(0.7);
  });

  it('a new learner gets placement first; passing the top concept skips its prerequisites', () => {
    const { s, r, asked } = place(() => true);
    expect(asked[0]).toBe('acceleration'); // top of the graph that has placement items
    expect(asked).toEqual(['acceleration']); // pass → every concept below is implied
    expect(r.decision.action).toBe('place_done');
    expect(s.state.placementDone).toBe(true);
    for (const c of ['reference_point', 'distance', 'speed', 'displacement', 'velocity', 'acceleration']) expect(s.state.concepts[c]!.pKnown).toBeGreaterThanOrEqual(0.7);
    expect(r.decision.then).toBeTruthy(); // goes straight on (nothing below to re-teach)
    expect(r.messages.some((m) => m.kind === 'explanation' || m.kind === 'check')).toBe(true);
    expect(r.trace.tools.find((t) => t.tool === 'update_learner')).toBeTruthy();
  });

  it('a miss steps one level down; a single miss is confirmed once its prerequisites are known; first lesson is at the gap', () => {
    const knows = new Set(['reference_point', 'distance', 'speed']);
    const { s, r, asked } = place((c) => knows.has(c));
    if (process.env.PL_DEBUG) console.log('ASKED', asked.join(' '), JSON.stringify(s.state.placement));
    expect(asked[0]).toBe('acceleration');
    expect(asked[1]).toBe('velocity'); // a miss steps one level down
    expect(asked.filter((c) => c === 'displacement')).toHaveLength(2); // distance known → the miss is confirmed
    expect(asked.filter((c) => c === 'velocity')).toHaveLength(1); // displacement is a gap → no point confirming velocity
    expect(asked).toContain('speed');
    expect(asked).not.toContain('reference_point'); // implied by passing speed
    expect(asked.length).toBeGreaterThanOrEqual(4);
    expect(asked.length).toBeLessThanOrEqual(8);
    expect(r.decision.placement).toMatchObject({ gaps: expect.arrayContaining(['velocity', 'displacement']) });
    expect(r.decision.then?.conceptId).toBe('displacement'); // weakest ready gap first, not velocity
    expect(s.state.concepts.speed!.pKnown).toBeGreaterThanOrEqual(0.7);
  });

  it('knowing nothing ends within 7 questions and starts from the root', () => {
    const { r, asked } = place(() => false);
    expect(asked.length).toBeLessThanOrEqual(7);
    expect(asked).toContain('reference_point');
    expect(r.decision.action).toBe('place_done');
    expect(r.messages.some((m) => m.kind === 'info' && /ମୂଳରୁ/.test(m.text))).toBe(true);
    expect(['reference_point', 'distance']).toContain(r.decision.then?.conceptId);
  });

  it('a placement miss is not remediated or escalated, and a learner with history never gets placement', () => {
    const s = session([profile()]);
    const r = s.turn({ type: 'open', sessionId: 's1' });
    const chk = checkOf(r.messages);
    const w = s.turn({ type: 'answer', checkId: chk.checkId, answer: wrongOf(chk.checkId) });
    expect(w.decision.action).toBe('place');
    expect(w.events.find((e) => e.type === 'ANSWER_GRADED')?.payload).toMatchObject({ source: 'placement' });

    const old = session([profile(), ...ready('distance')]);
    expect(old.turn({ type: 'open', sessionId: 's1' }).decision.action).not.toBe('place');
  });

  it('app killed during placement → reopening shows the same question, still counted as placement', () => {
    const s = session([profile()]);
    const q = checkOf(s.turn({ type: 'open', sessionId: 's1' }).messages);
    const again = s.turn({ type: 'open', sessionId: 's2' });
    expect(again.decision.action).toBe('resume');
    expect(checkOf(again.messages).checkId).toBe(q.checkId);
    const a = s.turn({ type: 'answer', checkId: q.checkId, answer: right(q.checkId) });
    expect(a.events.find((e) => e.type === 'ANSWER_GRADED')?.payload).toMatchObject({ source: 'placement' });
  });
});

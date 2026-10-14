// Rule-based student simulator (TODO P6.2, PLAN §12) and the agent-vs-plain-tutor comparison it makes possible (P6.1).
// Personas carry hidden knowledge and misconceptions and answer checks by fixed rules — no LLM quota, no sycophantic
// simulated students, the same numbers on every run. Both arms see the same personas, the same check bank and the same
// mastery rule (BKT fold, PLAN §6.4); they differ only in how the tutor decides.
//   agent    = Setu's engine (device tier: policy + diagnosis + targeted remediation + step-back + verification)
//   baseline = a plain tutor with the textbook: explains the next unmastered concept in book order, then asks a check;
//              no diagnosis of wrong answers, no targeted remediation, no prerequisite step-back (the "chatbot" arm)
import {
  fold, runTurn, PackMatcher, pickCheck, pickExplanation, topoOrder,
  type AnyEvent, type ChapterPack, type CheckItem, type EventDraft, type LearnerState, type OutMsg,
} from '@setu/core';

export interface Persona {
  id: string;
  /** concepts she already understands */
  knows: string[];
  /** hidden wrong beliefs: she picks the trap option that signals one, whenever offered */
  misconceptions: string[];
  /** explanations of a concept she needs before it sticks (prerequisites must be understood first) */
  learnsAfter: number;
  goal: string;
  /** a misconception that no explanation shifts (a learner who needs her teacher: the agent must escalate) */
  stubborn?: boolean;
}

export const PERSONAS: Persona[] = [
  { id: 'sunita (speed = velocity)', knows: ['reference_point', 'distance'], misconceptions: ['speed_equals_velocity'], learnsAfter: 1, goal: 'velocity' },
  { id: 'ravi (distance = displacement)', knows: ['reference_point', 'distance', 'speed'], misconceptions: ['distance_equals_displacement'], learnsAfter: 1, goal: 'velocity' },
  { id: 'mina (weak start, slow)', knows: [], misconceptions: ['motion_is_absolute'], learnsAfter: 2, goal: 'velocity' },
  { id: 'lipi (knows it all)', knows: ['reference_point', 'distance', 'displacement', 'speed', 'velocity'], misconceptions: [], learnsAfter: 1, goal: 'velocity' },
  { id: 'arjun (two mix-ups)', knows: ['reference_point'], misconceptions: ['distance_equals_displacement', 'speed_equals_velocity'], learnsAfter: 1, goal: 'velocity' },
];

/** Her hidden mind: what she understands and believes, changed only by explanations she receives. */
class Mind {
  known: Set<string>;
  wrong: Set<string>;
  heard = new Map<string, Set<string>>(); // concept → strategies explained to her
  constructor(readonly p: Persona, readonly pack: ChapterPack) { this.known = new Set(p.knows); this.wrong = new Set(p.misconceptions); }

  hear(conceptId: string, strategy: string, itemRef?: string) {
    const s = this.heard.get(conceptId) ?? new Set();
    s.add(strategy);
    this.heard.set(conceptId, s);
    const prereqsOk = this.pack.graph.concepts[conceptId]!.prerequisites.every((x) => this.known.has(x));
    const e = itemRef ? this.pack.explanations.find((x) => x.id === itemRef) : undefined;
    // a misconception goes when an explanation aimed at it arrives, or after two different ways of explaining its concept
    for (const m of [...this.wrong]) {
      const mc = this.pack.misconceptions.find((x) => x.id === m)!;
      if (!this.p.stubborn && (e?.targets?.includes(m) || (mc.conceptId === conceptId && s.size >= 2))) this.wrong.delete(m);
    }
    // an explanation only sticks once its prerequisites are understood
    if (prereqsOk) { const n = (this.counts.get(conceptId) ?? 0) + 1; this.counts.set(conceptId, n); if (n >= this.p.learnsAfter) this.known.add(conceptId); }
  }
  private counts = new Map<string, number>();

  answer(k: CheckItem): string {
    if (k.kind === 'mcq') {
      const trap = k.options!.find((o) => !o.correct && o.misconceptionIds.some((m) => this.wrong.has(m)));
      if (trap) return trap.id;
      if (this.known.has(k.conceptId)) return k.options!.find((o) => o.correct)!.id;
      return k.options!.filter((o) => !o.correct).sort((a, b) => a.id.localeCompare(b.id))[0]!.id;
    }
    if (k.kind === 'numeric') return this.known.has(k.conceptId) ? String(k.numeric!.value) : '0';
    return this.known.has(k.conceptId) ? (k.keyIdeas ?? []).map((i) => i.en).join(' ') : 'pata nahi';
  }
}

export interface RunResult { persona: string; arm: 'agent' | 'baseline'; mastered: boolean; answers: number; turns: number; misconceptionsLeft: string[]; masteredConcepts: string[] }

const T0 = 1_760_000_000_000;
interface Who { profileId: string; deviceId: string; t0: number; lang: string; avatar: string }
const SIM: Who = { profileId: 'sim', deviceId: 'sim', t0: T0, lang: 'en', avatar: 'a' };
function stamper(w: Who = SIM, start = 1) {
  let seq = start, now = w.t0;
  return { stamp: (d: EventDraft): AnyEvent => ({ ...d, id: `${w.profileId}-${seq}`, profileId: w.profileId, deviceId: w.deviceId, seq: seq++, ts: (now += 30_000) } as AnyEvent), now: () => now };
}
const profileEvent = (w: Who = SIM): AnyEvent => ({ id: `${w.profileId}-0`, profileId: w.profileId, deviceId: w.deviceId, seq: 0, ts: w.t0, type: 'PROFILE_CREATED', payload: { avatar: w.avatar, classLevel: 9, board: 'BSE-Odisha', language: { ui: w.lang, response: w.lang, inputMode: 'text', readingLevel: 3 }, dataTier: w.lang === 'en' ? 'high' : 'low', sharedDevice: w.lang !== 'en' } } as AnyEvent);

/** Setu's engine tutoring one persona until the goal concept is mastered (or the step cap). */
export function runAgent(pack: ChapterPack, p: Persona, maxTurns = 120): RunResult {
  return simulate(pack, p, { maxTurns }).result;
}

/**
 * The engine tutoring one persona; returns the full event log too (the demo seed uses it to make realistic learners:
 * real decisions, real evidence, real misconception signals — P7.10).
 */
export function simulate(pack: ChapterPack, p: Persona, o: { maxTurns?: number; who?: Partial<Who>; extra?: AnyEvent[] } = {}): { result: RunResult; events: AnyEvent[]; state: LearnerState } {
  const maxTurns = o.maxTurns ?? 120;
  const w: Who = { ...SIM, ...o.who };
  const matcher = new PackMatcher(pack);
  const mind = new Mind(p, pack);
  const st = stamper(w);
  // the same goal the baseline walks towards (in the product a teacher's exam date or her own choice sets it)
  const events: AnyEvent[] = [profileEvent(w), ...(o.extra ?? []), { id: `${w.profileId}-goal`, profileId: w.profileId, deviceId: w.deviceId, seq: 0, ts: w.t0, type: 'GOAL_SET', payload: { type: 'chapter', conceptIds: [p.goal], setBy: 'teacher' } } as AnyEvent];
  let s: LearnerState = fold(events, pack.graph, w.profileId);
  let answers = 0, turns = 0, session = 0;
  let pending: Extract<OutMsg, { kind: 'check' }> | undefined;
  const step = (input: Parameters<typeof runTurn>[1]) => {
    const r = runTurn(s, input, { pack, matcher, now: st.now(), tier: 'device', trustDraft: true }, (d) => { const e = st.stamp(d); events.push(e); return e; });
    s = r.state;
    turns++;
    if (process.env.SIM_TRACE) console.log(`  ${input.type} → ${r.decision.action}:${r.decision.conceptId ?? ''} ${r.decision.reason.slice(0, 90)}`);
    for (const e of r.events) if (e.type === 'EXPLANATION_DELIVERED') mind.hear(e.payload.conceptId, e.payload.strategy, e.payload.itemRef);
    pending = r.messages.find((m): m is Extract<OutMsg, { kind: 'check' }> => m.kind === 'check');
    return r;
  };
  step({ type: 'open', sessionId: `s${++session}`, minutes: 60 });
  while (turns < maxTurns && !s.concepts[p.goal]?.mastered) {
    if (pending) {
      const k = pack.checks.find((c) => c.id === pending!.checkId)!;
      answers++;
      step({ type: 'answer', checkId: k.id, answer: mind.answer(k) });
    } else {
      const r = step({ type: 'next' });
      if (r.decision.action === 'close') step({ type: 'open', sessionId: `s${++session}`, minutes: 60 });
    }
  }
  return { result: result(p, 'agent', s, answers, turns, mind), events, state: s };
}

/** The plain tutor: book order, one explanation, one check; wrong answers just move on to the next check. */
export function runBaseline(pack: ChapterPack, p: Persona, maxTurns = 120): RunResult {
  const mind = new Mind(p, pack);
  const st = stamper();
  const events: AnyEvent[] = [profileEvent()];
  let s: LearnerState = fold(events, pack.graph, 'sim');
  const order = topoOrder(pack.graph).filter((c) => c === p.goal || isAncestor(pack, c, p.goal));
  let answers = 0, turns = 0;
  const explained = new Set<string>();
  const tries = new Map<string, number>();
  let again = false;
  const add = (d: EventDraft) => { events.push(st.stamp(d)); s = fold(events, pack.graph, 'sim'); };
  while (turns < maxTurns && !s.concepts[p.goal]?.mastered) {
    const c = order.find((x) => !s.concepts[x]?.mastered) ?? p.goal;
    // explains the concept; after a wrong answer, explains it again the next way in the book (as a chatbot asked again
    // would) — but never reads WHICH wrong answer she gave, so nothing is aimed at her misconception or a weak prerequisite
    if (!explained.has(c) || again) {
      const ways = [...new Set(pack.explanations.filter((x) => x.conceptId === c && !x.regions).map((x) => x.strategy))];
      const n = (tries.get(c) ?? 0);
      tries.set(c, n + 1);
      const e = pickExplanation(pack, c, ways[n % ways.length], 3)!;
      add({ type: 'EXPLANATION_DELIVERED', payload: { conceptId: c, strategy: e.strategy, level: 3, itemRef: e.id } });
      mind.hear(c, e.strategy, e.id);
      explained.add(c);
      turns++;
    }
    const k = pickCheck(pack, s, c, { lang: 'en', trustDraft: true })!;
    add({ type: 'CHECK_SHOWN', payload: { checkId: k.id, conceptId: c, source: 'bank' } });
    const a = mind.answer(k);
    const o = k.options?.find((x) => x.id === a);
    const correct = k.kind === 'mcq' ? !!o?.correct : k.kind === 'numeric' ? a === String(k.numeric!.value) : a !== 'pata nahi';
    add({ type: 'ANSWER_GRADED', payload: { checkId: k.id, conceptId: c, correct, confidence: 1, source: 'bank', misconceptionIds: o?.misconceptionIds ?? [] } });
    answers++;
    turns++;
    again = !correct;
  }
  return result(p, 'baseline', s, answers, turns, mind);
}

const isAncestor = (pack: ChapterPack, a: string, b: string): boolean => pack.graph.concepts[b]!.prerequisites.some((x) => x === a || isAncestor(pack, a, x));
const result = (p: Persona, arm: RunResult['arm'], s: LearnerState, answers: number, turns: number, mind: Mind): RunResult => ({
  persona: p.id, arm, mastered: !!s.concepts[p.goal]?.mastered, answers, turns,
  misconceptionsLeft: [...mind.wrong], masteredConcepts: Object.entries(s.concepts).filter(([, c]) => c.mastered).map(([id]) => id),
});

export function compare(pack: ChapterPack, personas = PERSONAS) {
  const rows = personas.map((p) => ({ agent: runAgent(pack, p), baseline: runBaseline(pack, p) }));
  const pct = (xs: boolean[]) => Math.round((100 * xs.filter(Boolean).length) / xs.length);
  const startedWith = personas.reduce((n, p) => n + p.misconceptions.length, 0);
  const resolved = (arm: 'agent' | 'baseline') => startedWith ? Math.round((100 * (startedWith - rows.reduce((n, r) => n + r[arm].misconceptionsLeft.length, 0))) / startedWith) : 100;
  return {
    rows,
    summary: {
      agent: { reachedMastery: pct(rows.map((r) => r.agent.mastered)), answersToMastery: median(rows.filter((r) => r.agent.mastered).map((r) => r.agent.answers)), misconceptionsResolved: resolved('agent') },
      baseline: { reachedMastery: pct(rows.map((r) => r.baseline.mastered)), answersToMastery: median(rows.filter((r) => r.baseline.mastered).map((r) => r.baseline.answers)), misconceptionsResolved: resolved('baseline') },
    },
  };
}
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

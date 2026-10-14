// Deterministic decision policy (PLAN §5.5). Same code drives the device tier offline
// and is shown to the LLM online as ranked candidates.

import type { ActionKind, LearnerState, Tier } from './state.ts';
import { dependentsOf, prerequisitesOf, type ConceptGraph } from './graph.ts';
import { concept, DAY } from './fold.ts';
import { MASTERY_THRESHOLD } from './bkt.ts';

export interface PolicyWeights { w1: number; w2: number; w3: number; w4: number; w5: number; w6: number; k: number }
export const DEFAULT_WEIGHTS: PolicyWeights = { w1: 1, w2: 0.9, w3: 1.2, w4: 0.4, w5: 0.3, w6: 0.5, k: 12 };

/** Minutes and KB each action costs (text only; audio adds AUDIO_KB per explanation). */
export const ACTION_COST: Record<ActionKind, { min: number; kb: number }> = {
  teach: { min: 5, kb: 18 },
  review: { min: 2, kb: 6 },
  remediate: { min: 4, kb: 15 },
  probe_prereq: { min: 1, kb: 4 },
  practice: { min: 3, kb: 8 },
  step_back: { min: 5, kb: 18 },
};
export const AUDIO_KB = 60;

/** Daily data allowance by data-pack size (KB) — PLAN §8.1. */
export const DATA_BUDGET_KB = { low: 1500, mid: 5000, high: 20000 } as const;

/** Which actions each connectivity tier can run (device tier: only what the pack + core can do). */
export const TIER_ACTIONS: Record<Tier, ActionKind[]> = {
  cloud: ['teach', 'review', 'remediate', 'probe_prereq', 'practice', 'step_back'],
  weak: ['teach', 'review', 'remediate', 'probe_prereq', 'practice', 'step_back'],
  device: ['teach', 'review', 'remediate', 'probe_prereq', 'practice', 'step_back'],
};

export interface PolicyContext {
  graph: ConceptGraph;
  now: number;
  tier: Tier;
  /** minutes left in this session */
  timeLeftMin: number;
  /** data left today, KB */
  dataLeftKB: number;
  /** concepts for which content exists offline (device tier); undefined = all */
  availableOffline?: Set<string>;
  /** concepts the agent can verify (have at least one check); teaching what cannot be checked is never planned */
  checkable?: Set<string>;
  /** severity per misconception id (0..1), default 0.8 */
  misconceptionSeverity?: Record<string, number>;
  withAudio?: boolean;
  weights?: PolicyWeights;
}

export interface Candidate {
  action: ActionKind;
  conceptId: string;
  score: number;
  terms: { learn: number; review: number; misconception: number; exam: number; time: number; data: number };
  reasons: string[];
  cost: { min: number; kb: number };
  /** misconception targeted by a remediation */
  misconceptionId?: string;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * Knowledge of a concept including what its measured dependents imply:
 * if she has shown she knows speed, she very likely knows distance (PLAN §6.3: "pass a concept → skip its prerequisites").
 */
export function effectiveKnown(s: LearnerState, g: ConceptGraph, id: string): number {
  let best = concept(s, id).pKnown;
  const seen = new Set<string>();
  const stack = dependentsOf(g, id);
  while (stack.length) {
    const d = stack.pop()!;
    if (seen.has(d)) continue;
    seen.add(d);
    const c = concept(s, d);
    if (c.evidenceCount >= 1) best = Math.max(best, 0.9 * c.pKnown);
    stack.push(...dependentsOf(g, d));
  }
  return best;
}

export function prereqReady(s: LearnerState, g: ConceptGraph, id: string, k = DEFAULT_WEIGHTS.k): number {
  const pre = prerequisitesOf(g, id);
  if (!pre.length) return 1;
  return Math.min(...pre.map((p) => sigmoid((effectiveKnown(s, g, p) - 0.6) * k)));
}

export function goalWeight(s: LearnerState, g: ConceptGraph, id: string): number {
  if (s.goal?.conceptIds.length) return s.goal.conceptIds.includes(id) ? 1 : 0.25;
  return g.concepts[id]?.weight ?? 0.5;
}

export function reviewUrgency(s: LearnerState, id: string, now: number): number {
  const c = s.concepts[id];
  if (!c?.nextReviewAt || now < c.nextReviewAt) return 0;
  const overdueDays = (now - c.nextReviewAt) / DAY;
  return Math.min(1, 0.6 + overdueDays * 0.1);
}

export function examProximity(s: LearnerState, now: number): number {
  if (s.goal?.type !== 'exam' || !s.goal.dueDate) return 0;
  const days = (s.goal.dueDate - now) / DAY;
  if (days < 0) return 0;
  return 1 - Math.min(days, 60) / 60;
}

/** Prerequisites with too little evidence to judge — probe instead of assuming (PLAN §6.3). */
export function unmeasuredWeakPrereqs(s: LearnerState, g: ConceptGraph, id: string): string[] {
  return prerequisitesOf(g, id).filter((p) => {
    const c = concept(s, p);
    return c.evidenceCount < 1 && c.pKnown < 0.6;
  });
}

/** Weakest prerequisite with evidence (the step-back target). */
export function weakestPrereq(s: LearnerState, g: ConceptGraph, id: string): string | undefined {
  const pre = prerequisitesOf(g, id)
    .map((p) => ({ p, c: concept(s, p) }))
    .filter(({ c }) => c.pKnown < 0.6);
  pre.sort((a, b) => a.c.pKnown - b.c.pKnown);
  return pre[0]?.p;
}

/**
 * What blocks concept `id` (PLAN §6.3–6.4): walks all ancestors.
 * - stepBack: ancestors with evidence that are weak and whose own prerequisites are ready → teach them first.
 * - probe: ancestors never measured, whose own prerequisites are ready → ask one question instead of assuming.
 * Ancestors whose prerequisites are not ready are skipped: the walk continues below them.
 */
export function blockers(s: LearnerState, g: ConceptGraph, id: string, k = DEFAULT_WEIGHTS.k): { stepBack: string[]; probe: string[] } {
  const stepBack: string[] = [];
  const probe: string[] = [];
  const seen = new Set<string>();
  const stack = [...prerequisitesOf(g, id)];
  while (stack.length) {
    const p = stack.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    const c = concept(s, p);
    if (effectiveKnown(s, g, p) >= 0.6) continue;
    const readyHere = prereqReady(s, g, p, k) >= 0.5;
    if (readyHere) (c.evidenceCount >= 1 ? stepBack : probe).push(p);
    else stack.push(...prerequisitesOf(g, p));
  }
  return { stepBack: stepBack.sort(), probe: probe.sort() };
}

/** Score every candidate action (PLAN §5.5). Returned best first; only affordable, tier-available ones. */
export function recommend(s: LearnerState, ctx: PolicyContext): Candidate[] {
  const W = ctx.weights ?? DEFAULT_WEIGHTS;
  const g = ctx.graph;
  const exam = examProximity(s, ctx.now);
  const out: Candidate[] = [];
  const allowed = new Set(TIER_ACTIONS[ctx.tier]);

  const push = (action: ActionKind, conceptId: string, base: Omit<Candidate['terms'], 'time' | 'data' | 'exam'>, reasons: string[], misconceptionId?: string) => {
    if (!allowed.has(action)) return;
    if (ctx.tier === 'device' && ctx.availableOffline && !ctx.availableOffline.has(conceptId)) return;
    // teach → verify is the loop: a concept with no check in the pack (yet) is introduced once, never again — else it
    // would be taught over and over with nothing to verify it (found by the simulator, P6.2)
    if (ctx.checkable && !ctx.checkable.has(conceptId) && (action !== 'teach' || concept(s, conceptId).strategiesTried.length > 0)) return;
    const cost = { ...ACTION_COST[action] };
    if (ctx.withAudio && (action === 'teach' || action === 'remediate' || action === 'step_back')) cost.kb += AUDIO_KB;
    if (ctx.tier === 'device') cost.kb = 0; // already on the phone
    if (cost.min > ctx.timeLeftMin + 0.5 || cost.kb > ctx.dataLeftKB) return;
    const examTerm = exam * (action === 'review' || action === 'practice' ? 1 : action === 'teach' ? 0.3 : 0.6);
    const time = cost.min / Math.max(ctx.timeLeftMin, 1);
    const data = ctx.dataLeftKB > 0 ? cost.kb / ctx.dataLeftKB : 1;
    const terms = { ...base, exam: examTerm, time, data };
    const score = W.w1 * terms.learn + W.w2 * terms.review + W.w3 * terms.misconception + W.w4 * terms.exam - W.w5 * time - W.w6 * data;
    if (exam > 0) reasons.push(`exam in ${Math.round(((s.goal!.dueDate! - ctx.now) / DAY))} days`);
    out.push({ action, conceptId, score: round(score), terms: mapRound(terms), reasons, cost, misconceptionId });
  };

  for (const id of Object.keys(g.concepts)) {
    const c = concept(s, id);
    const gw = goalWeight(s, g, id);
    const ready = prereqReady(s, g, id, W.k);
    const known = effectiveKnown(s, g, id);
    const unknown = 1 - known;

    // learn: new or not-yet-mastered concept
    if (!c.mastered && known < MASTERY_THRESHOLD) {
      const value = gw * unknown;
      const b = blockers(s, g, id, W.k);
      if (value > 0.2) {
        for (const p of b.stepBack)
          push('step_back', p, { learn: value * 0.85 * (1 - concept(s, p).pKnown), review: 0, misconception: 0 }, [
            `${id} is blocked: ${p} is weak (p=${concept(s, p).pKnown.toFixed(2)}, ${concept(s, p).attempts} attempts)`,
          ]);
        for (const p of b.probe)
          push('probe_prereq', p, { learn: value * 0.5, review: 0, misconception: 0 }, [`${id} needs ${p}; not measured yet → one question`]);
      }
      const action: ActionKind = c.attempts > 0 ? 'practice' : 'teach';
      push(action, id, { learn: value * ready, review: 0, misconception: 0 }, [
        `goal weight ${gw}`, `p(known)=${c.pKnown.toFixed(2)}`, `prerequisites ready ${ready.toFixed(2)}`,
      ]);
    }

    // review: spaced review due
    const ru = reviewUrgency(s, id, ctx.now);
    if (ru > 0) push('review', id, { learn: 0, review: ru, misconception: 0 }, [`review due (stage ${c.reviewStage})`]);

    // remediate: misconception signalled or confirmed and not yet resolved
    for (const [mid, ms] of Object.entries(c.misconceptions)) {
      if (ms.resolved) continue;
      const sev = (ctx.misconceptionSeverity?.[mid] ?? 0.8) * (ms.confirmed ? 1 : 0.35);
      push('remediate', id, { learn: 0, review: 0, misconception: sev }, [
        `${ms.confirmed ? 'confirmed' : 'possible'} misconception ${mid} (${ms.signals} signals)`,
      ], mid);
    }
  }

  // de-duplicate: keep best per (action, concept)
  const best = new Map<string, Candidate>();
  for (const c of out) {
    const key = `${c.action}:${c.conceptId}:${c.misconceptionId ?? ''}`;
    if (!best.has(key) || best.get(key)!.score < c.score) best.set(key, c);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.conceptId.localeCompare(b.conceptId));
}

/** Choose the next strategy: what worked for her first, then one not yet tried (PLAN §6.3, §6.4). */
export function chooseStrategy(s: LearnerState, conceptId: string, available: string[], opts: { excludeLast?: boolean; readingLevel?: number; preferVoice?: boolean } = {}): string | undefined {
  const c = concept(s, conceptId);
  const pool = opts.excludeLast && c.lastStrategy ? available.filter((x) => x !== c.lastStrategy) : available;
  if (!pool.length) return undefined;
  if (c.strategyThatWorked && pool.includes(c.strategyThatWorked) && !opts.excludeLast) return c.strategyThatWorked;
  const untried = pool.filter((x) => !c.strategiesTried.includes(x));
  return (untried.length ? untried : pool)[0];
}

/** Max distinct strategies before escalating (PLAN §6.4). */
export const MAX_STRATEGIES = 3;

export function shouldEscalate(s: LearnerState, conceptId: string): boolean {
  const c = concept(s, conceptId);
  // once is enough: her teacher already has this case with its evidence; again only after a week (found by the demo seed —
  // a stuck learner produced 18 identical "needs you" items)
  const recent = s.escalations.some((e) => e.kind === 'academic' && e.conceptId === conceptId && (s.lastActiveAt ?? e.at) - e.at < 7 * DAY);
  return !recent && c.strategiesTried.length >= MAX_STRATEGIES && !c.mastered && c.correctStreak === 0 && c.attempts >= MAX_STRATEGIES;
}

const round = (x: number) => Math.round(x * 1000) / 1000;
const mapRound = <T extends Record<string, number>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)])) as T;

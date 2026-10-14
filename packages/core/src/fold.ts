// LearnerState = fold(events) (PLAN §5.6). Pure and deterministic.

import { canonicalOrder, type AnyEvent } from './events.ts';
import { bktUpdate, BKT, MASTERY_THRESHOLD, SOURCE_WEIGHT, clamp01 } from './bkt.ts';
import { emptyLearner, type ConceptState, type LearnerState } from './state.ts';
import { prerequisitesOf, type ConceptGraph } from './graph.ts';

/** deviceId of events the server writes itself (between-session run, ticks) */
export const SERVER_DEVICE = 'server';

export const DAY = 86_400_000;
/** Spaced review intervals in days (PLAN §6.3). */
export const REVIEW_DAYS = [1, 3, 7, 14] as const;
/** Two-signal rule (PLAN §6.5). */
export const MISCONCEPTION_CONFIRM_SIGNALS = 2;
/** Small credit to prerequisites on success (PLAN §6.3, light propagation). */
const PREREQ_CREDIT = 0.03;
/** After this many minutes without activity a session counts as ended (PLAN §5.1). */
export const INACTIVITY_END_MIN = 15;
/** Knowledge prior for concepts placement found known (passed, or a prerequisite of one passed). */
export const PLACEMENT_KNOWN = 0.7;

export function newConcept(): ConceptState {
  return {
    pKnown: BKT.pL0,
    evidenceCount: 0,
    attempts: 0,
    correctStreak: 0,
    recentTrusted: [],
    misconceptions: {},
    strategiesTried: [],
    reviewStage: 0,
    mastered: false,
    seenChecks: [],
  };
}

export function concept(s: LearnerState, id: string): ConceptState {
  return s.concepts[id] ?? newConcept();
}

export function fold(events: readonly AnyEvent[], graph?: ConceptGraph, profileId?: string): LearnerState {
  const ordered = canonicalOrder(events);
  const pid = profileId ?? ordered[0]?.profileId ?? 'unknown';
  let s = emptyLearner(pid);
  for (const e of ordered) if (e.profileId === pid) s = apply(s, e, graph);
  return s;
}

/** Apply one event. Exposed so clients can fold incrementally. */
export function apply(prev: LearnerState, e: AnyEvent, graph?: ConceptGraph): LearnerState {
  const s: LearnerState = structuredClone(prev);
  // only the learner's own devices count as activity; the server's between-session events do not (drop-off detection)
  if (e.deviceId !== SERVER_DEVICE) s.lastActiveAt = Math.max(s.lastActiveAt ?? 0, e.ts);
  switch (e.type) {
    case 'PROFILE_CREATED': {
      const p = e.payload;
      s.avatar = p.avatar;
      s.classLevel = p.classLevel;
      s.board = p.board;
      s.language = { ...p.language };
      s.constraints.dataTier = p.dataTier;
      s.constraints.sharedDevice = p.sharedDevice;
      break;
    }
    case 'PROFILE_UPDATED': {
      const p = e.payload;
      if (p.language) s.language = { ...s.language, ...p.language };
      if (p.dataTier) s.constraints.dataTier = p.dataTier;
      // "only 10 minutes today" (P5.2): also the session that is open now
      if (p.sessionMinutes) { s.constraints.sessionMinutes = p.sessionMinutes; if (s.session) s.session.minutes = p.sessionMinutes; }
      if (p.avatar) s.avatar = p.avatar;
      break;
    }
    case 'CLASS_JOINED':
      s.classCode = e.payload.classCode;
      if (e.payload.region) s.region = e.payload.region;
      break;
    case 'GOAL_SET':
      s.goal = { ...e.payload, conceptIds: [...e.payload.conceptIds] };
      break;
    case 'SESSION_OPENED':
      // asked once, then learned (P5.2): after a few sessions her usual length is the default
      s.session = { id: e.payload.sessionId, openedAt: e.ts, tier: e.payload.tier, minutes: e.payload.minutes ?? (s.sessionsCompleted >= 3 ? s.constraints.typicalSessionMin : s.constraints.sessionMinutes) };
      if (e.payload.minutes) s.constraints.sessionMinutes = e.payload.minutes;
      break;
    case 'SESSION_ENDED': {
      if (s.session?.id === e.payload.sessionId) s.session = undefined;
      s.sessionsCompleted += 1;
      // she chose to stop → nothing to resume; inactivity/sync ends keep the resume point (interrupted, PLAN §5.1)
      if (e.payload.reason === 'explicit') s.resumePointer = undefined;
      // typical session length is learned (PLAN §9.1): exponential moving average
      const m = e.payload.minutesUsed;
      if (m > 0) s.constraints.typicalSessionMin = Math.round(0.7 * s.constraints.typicalSessionMin + 0.3 * m);
      break;
    }
    case 'DOUBT_ASKED':
      // P3.23: how she asks is learned — mostly speaking → shorter spoken explanations, tap-answer checks
      s.recentModes = [...(s.recentModes ?? []), e.payload.mode].slice(-5);
      if (s.recentModes.length >= 3) s.language.inputMode = s.recentModes.filter((m) => m === 'voice').length >= 3 ? 'voice' : s.language.inputMode === 'voice' ? 'text' : s.language.inputMode;
      break;
    case 'DOUBT_QUEUED':
      if (!s.queuedDoubts.some((d) => d.doubtId === e.payload.doubtId))
        s.queuedDoubts.push({ doubtId: e.payload.doubtId, text: e.payload.text, askedAt: e.ts, answered: false, ...(e.payload.reason === 'photo' ? { photo: true } : e.payload.reason === 'voice' ? { voice: true } : {}) });
      break;
    case 'DOUBT_ANSWERED': {
      const d = s.queuedDoubts.find((q) => q.doubtId === e.payload.doubtId);
      if (d) {
        d.answered = true;
        d.answer = e.payload.answer;
      }
      break;
    }
    case 'EXPLANATION_DELIVERED': {
      const c = (s.concepts[e.payload.conceptId] ??= newConcept());
      if (!c.strategiesTried.includes(e.payload.strategy)) c.strategiesTried.push(e.payload.strategy);
      c.lastStrategy = e.payload.strategy;
      c.lastSeenAt = e.ts;
      break;
    }
    case 'CHECK_SHOWN': {
      if (e.payload.source === 'placement') {
        s.placement.pending = e.payload.checkId;
        s.placement.startedAt ??= e.ts;
      }
      const c = (s.concepts[e.payload.conceptId] ??= newConcept());
      c.seenChecks = [...c.seenChecks.filter((x) => x !== e.payload.checkId), e.payload.checkId].slice(-6);
      break;
    }
    case 'ANSWER_GRADED':
      applyAnswer(s, e.payload, e.ts, graph);
      s.lastAnswer = { checkId: e.payload.checkId, conceptId: e.payload.conceptId, correct: e.payload.correct, at: e.ts };
      if (e.payload.source === 'placement') {
        s.placement.answers.push({ conceptId: e.payload.conceptId, checkId: e.payload.checkId, correct: e.payload.correct });
        s.placement.pending = undefined;
      }
      break;
    case 'MISCONCEPTION_CANDIDATE':
      s.misconceptionCandidates.push({ ...e.payload });
      break;
    case 'PLACEMENT_COMPLETED':
      s.placementDone = true;
      s.placement.pending = undefined;
      // passing a concept implies its prerequisites (PLAN §6.3) — a likely-known prior, not mastery (needs bank checks)
      for (const id of e.payload.known ?? []) {
        const c = (s.concepts[id] ??= newConcept());
        c.pKnown = Math.max(c.pKnown, PLACEMENT_KNOWN);
        c.evidenceCount = Math.max(c.evidenceCount, 1);
      }
      break;
    case 'HYPOTHESIS_SET': {
      const p = e.payload;
      if (p.weakPrereq !== undefined) s.hypotheses.weakPrereq = p.weakPrereq ?? undefined;
      if (p.suspectedMisconception !== undefined) s.hypotheses.suspectedMisconception = p.suspectedMisconception ?? undefined;
      break;
    }
    case 'PLAN_SET':
      s.preparedSession = structuredClone(e.payload.plan);
      break;
    case 'STEP_STARTED':
      s.resumePointer = { ...e.payload.pointer };
      break;
    case 'STEP_COMPLETED':
      if (s.resumePointer && samePointer(s.resumePointer, e.payload.pointer)) s.resumePointer = undefined;
      break;
    case 'ESCALATED':
      s.escalations.push({ ...e.payload, at: e.ts });
      break;
    case 'RETEACH_DRAFTED': {
      const esc = [...s.escalations].reverse().find((x) => x.conceptId === e.payload.conceptId && x.kind === 'academic');
      if (esc) esc.draft = e.payload.draft;
      break;
    }
    case 'BUDGET_LOW':
      s.budgetLow = { ...s.budgetLow, ...(e.payload.kind === 'data' ? { dataDay: Math.floor(e.ts / DAY) } : { timeSession: s.session?.id }) };
      break;
    case 'CONNECTIVITY_CHANGED':
      s.link = e.payload.to;
      break;
    case 'DATA_USED': {
      // the data budget is per day (PLAN §8.1)
      const day = Math.floor(e.ts / DAY);
      if (s.constraints.dataDay !== day) {
        s.constraints.dataDay = day;
        s.constraints.dataUsedKB = 0;
      }
      s.constraints.dataUsedKB += e.payload.kb;
      break;
    }
    case 'COMMITMENT_MADE':
      if (!s.commitments.some((c) => c.id === e.payload.commitmentId))
        s.commitments.push({ id: e.payload.commitmentId, text: e.payload.text, dueAt: e.payload.dueAt, kept: false });
      break;
    case 'COMMITMENT_KEPT': {
      const c = s.commitments.find((x) => x.id === e.payload.commitmentId);
      if (c) c.kept = true;
      break;
    }
  }
  return s;
}

function applyAnswer(
  s: LearnerState,
  p: Extract<AnyEvent, { type: 'ANSWER_GRADED' }>['payload'],
  ts: number,
  graph?: ConceptGraph,
) {
  const c = (s.concepts[p.conceptId] ??= newConcept());
  const w = SOURCE_WEIGHT[p.source] * clamp01(p.confidence);
  // a weakly graded answer (a written answer matched only by its words) moves BKT a little, never counts for mastery
  const trusted = (p.source === 'bank' || p.source === 'placement') && p.confidence >= 0.7;

  c.pKnown = bktUpdate(c.pKnown, p.correct, w);
  c.attempts += 1;
  c.evidenceCount += w;
  c.correctStreak = p.correct ? c.correctStreak + 1 : 0;
  c.lastSeenAt = ts;
  if (trusted) c.recentTrusted = [...c.recentTrusted, p.correct].slice(-2);

  // misconception signals (two-signal rule); correct trusted answers count towards resolving
  for (const m of p.misconceptionIds) {
    const ms = (c.misconceptions[m] ??= { signals: 0, confirmed: false, resolved: false });
    ms.signals += 1;
    ms.resolved = false;
    if (ms.signals >= MISCONCEPTION_CONFIRM_SIGNALS) ms.confirmed = true;
  }
  if (p.correct && trusted && c.correctStreak >= 2) {
    // two trusted right answers in a row resolve a confirmed misconception — and a merely possible one too, else the
    // policy would keep offering to remediate something she now gets right (found by the simulator, P6.2)
    for (const ms of Object.values(c.misconceptions)) if (ms.signals > 0) ms.resolved = true;
  }

  if (p.correct && p.strategy && trusted) c.strategyThatWorked = p.strategy;

  // light evidence propagation to prerequisites (success only — failure only raises a hypothesis)
  if (p.correct && graph && w > 0) {
    for (const pre of prerequisitesOf(graph, p.conceptId)) {
      const pc = (s.concepts[pre] ??= newConcept());
      pc.pKnown = clamp01(pc.pKnown + PREREQ_CREDIT * w * (1 - pc.pKnown));
    }
  }

  // mastery + spaced review schedule
  const wasMastered = c.mastered;
  c.mastered = c.pKnown >= MASTERY_THRESHOLD && c.recentTrusted.length === 2 && c.recentTrusted.every(Boolean);
  if (trusted) {
    const reviewDue = c.nextReviewAt !== undefined && ts >= c.nextReviewAt - DAY / 4;
    if (!wasMastered && c.mastered) {
      c.reviewStage = 0;
      c.nextReviewAt = ts + REVIEW_DAYS[0] * DAY;
    } else if (wasMastered && reviewDue) {
      if (p.correct) {
        c.reviewStage = Math.min(c.reviewStage + 1, REVIEW_DAYS.length - 1);
        c.nextReviewAt = ts + REVIEW_DAYS[c.reviewStage]! * DAY;
      } else {
        c.reviewStage = 0;
        c.nextReviewAt = ts + REVIEW_DAYS[0] * DAY;
      }
    } else if (wasMastered && !p.correct) {
      c.reviewStage = 0;
      c.nextReviewAt = ts + REVIEW_DAYS[0] * DAY;
    }
  }
}

function samePointer(a: { sessionId: string; planIndex: number; step: string; checkIndex?: number }, b: typeof a) {
  return a.sessionId === b.sessionId && a.planIndex === b.planIndex && a.step === b.step && (a.checkIndex ?? 0) === (b.checkIndex ?? 0);
}

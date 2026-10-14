// Turn engine — the deterministic agent (PLAN §5.4, §6.4, §8.2).
// observe → decide → execute. On the phone it runs alone (device tier). On the server the
// ADK agent runs the same stages but lets the LLM override `decide` (with a reason) and
// replace pack text with grounded generated text in `execute`.

import type { AnyEvent, EventPayloads, EventType } from './events.ts';
import type { ActionKind, LearnerState, Tier, ResumePointer, PlanItem, SessionPlan } from './state.ts';
import { apply, concept } from './fold.ts';
import { recommend, chooseStrategy, shouldEscalate, blockers, MAX_STRATEGIES, type Candidate, DATA_BUDGET_KB } from './policy.ts';
import { gradeNumeric } from './numerals.ts';
import { textIn, speakIn, type ChapterPack, type CheckItem, type Explanation, itemBase } from './pack.ts';
import type { PackMatcher, MatchResult } from './matcher.ts';
import { placementActive, nextPlacement, type PlacementSummary } from './placement.ts';
import { locatePassage, type LocateResult } from './snap.ts';
import { detectScript } from './matcher.ts';
import { screen, scrubPii, isUnsafe, type SafetyKind } from './safety.ts';
import { parseProblem, hintLadder, insists, INSIST_WINDOW_MS, gradeFreeText, type Problem } from './pedagogy.ts';

// ---------- inputs & outputs ----------

export type TurnInput =
  | { type: 'open'; sessionId: string; minutes?: number }
  /** mode 'photo': text is OCR (offline) or vision (online) output — data, never instructions; passageId when she tapped one of the offered passages */
  | { type: 'doubt'; doubtId: string; text: string; mode: 'text' | 'voice' | 'photo'; passageId?: string }
  | { type: 'answer'; checkId: string; answer: string }
  | { type: 'next' }
  | { type: 'end'; sessionId: string; minutesUsed: number; reason?: 'explicit' | 'inactivity' | 'sync' };

export type OutMsg =
  | { kind: 'explanation'; conceptId: string; strategy: string; itemId?: string; text: string; speak: string; generated: boolean; term?: string
      /** P3.19 term bridge: textbook term ↔ English exam term ↔ everyday phrase (+ her teacher's home-language word) */
      bridge?: { term: string; english: string; everyday: string } }
  | { kind: 'check'; checkId: string; conceptId: string; stem: string; speak: string; options?: { id: string; text: string }[]; numeric: boolean; practice: boolean; placement?: boolean; freeText?: boolean }
  /** homework-style problem (P2.43): hints shown one at a time; `answer` is graded on the phone and shown only after she tries */
  | { kind: 'hints'; conceptId: string; text: string; speak: string; steps: string[]; answer: { si: number; dim: string; shown: number; unit: string; text: string } }
  | { kind: 'feedback'; correct: boolean; text: string; speak: string; conceptId: string }
  | { kind: 'info'; text: string; speak: string; tone?: 'neutral' | 'promise' | 'celebrate' | 'escalated' }
  | { kind: 'chips'; text: string; speak: string; options: { conceptId: string; label: string }[] }
  /** the clean textbook passage she photographed (PLAN §6.8: teach from pack text, never from OCR text) */
  | { kind: 'passage'; passageId: string; text: string; speak: string; page?: number }
  /** photo not located confidently: tap the passage you mean, or keep the photo for later */
  | { kind: 'passages'; text: string; speak: string; options: { passageId: string; label: string }[]; canQueue: boolean };

export type EventDraft = { [K in EventType]: { type: K; payload: EventPayloads[K]; itemVersion?: string } }[EventType];

export interface EngineCtx {
  pack: ChapterPack;
  matcher: PackMatcher;
  now: number;
  tier: Tier;
  /** treat unreviewed (draft) content as trusted — development only until native review (TODO D6) */
  trustDraft?: boolean;
  /** a grade made before the turn (online: an LLM grade of a written answer, with its confidence) */
  preGraded?: Record<string, GradeResult>;
  withAudio?: boolean;
}

export interface Observation {
  trigger: TurnInput['type'];
  match?: MatchResult;
  grade?: GradeResult & { checkId: string; conceptId: string };
  unmatched?: boolean;
  /** Snap: where the photo was found in the pack */
  snap?: LocateResult & { source: 'ocr' | 'vision' | 'picked' };
  /** child-safety screen of what she asked (PLAN §6.7) */
  safety?: SafetyKind;
  /** a homework-style problem the solver can answer (P2.43) */
  problem?: Problem;
  /** she insists her last (wrong) answer was right (P2.44) */
  insist?: { checkId: string; conceptId: string };
}

export type DecisionAction = ActionKind | 'answer_faq' | 'clarify' | 'queue' | 'resume' | 'continue_check' | 'escalate' | 'close' | 'place' | 'place_done' | 'pick_passage'
  /** safety (P5.13–P5.16): distress → care + helpline + quiet teacher alert; unsafe → calm no; off-topic / personal → back to study */
  | 'care' | 'decline' | 'redirect'
  /** P2.43 hint ladder for a homework-style problem; P2.44 back to the textbook when she insists on a wrong answer */
  | 'hint' | 'reground';

export interface Decision {
  action: DecisionAction;
  conceptId?: string;
  strategy?: string;
  misconceptionId?: string;
  faqId?: string;
  reason: string;
  decidedBy: 'policy' | 'llm';
  override: boolean;
  candidates: Candidate[];
  /** after escalating / finishing placement, continue with this */
  then?: Decision;
  /** placement question to show (action 'place') */
  checkId?: string;
  /** what placement found (action 'place_done') */
  placement?: PlacementSummary;
  /** Snap: the located passage to show before teaching, or the passages to pick from */
  passageId?: string;
  passages?: string[];
  unreadable?: boolean;
  /** action 'hint': the parsed problem */
  problem?: Problem;
}

export interface TraceStep {
  trigger: string;
  tier: Tier;
  facts_used: string[];
  /** output safety check on every message (P5.17): how many were checked, how many replaced */
  safety?: { checked: number; blocked: number; input?: SafetyKind };
  candidates: { action: string; concept: string; score: number }[];
  chosen: string;
  decided_by: 'policy' | 'llm';
  override: boolean;
  reason: string;
  tools: { tool: string; args: unknown; status: 'ok' | 'fallback' | 'failed'; latency_ms?: number; note?: string }[];
  fallback_used?: string;
  critic?: { checks: string[]; verdict: 'pass' | 'revise' | 'reject' | 'n/a' };
  state_diff?: Record<string, string>;
  why: string;
}

export interface TurnResult {
  events: EventDraft[];
  messages: OutMsg[];
  decision: Decision;
  observation: Observation;
  trace: TraceStep;
}

// ---------- grading ----------

export interface GradeResult { correct: boolean; misconceptionIds: string[]; feedback?: string; reason: string; confidence: number }

export function gradeCheck(check: CheckItem, answer: string, lang: string): GradeResult {
  if (check.kind === 'text') {
    const g = gradeFreeText(check, answer);
    const fb = g.correct ? undefined : textIn(check.model, lang) ? `${T(lang, 'model_answer')} ${textIn(check.model, lang)}` : undefined;
    return { correct: g.correct, misconceptionIds: [], feedback: fb, reason: `free text (${g.reason}${g.missing.length ? ', missing: ' + g.missing.join(', ') : ''})`, confidence: g.confidence };
  }
  if (check.kind === 'mcq') {
    const o = check.options?.find((x) => x.id === answer.trim());
    if (!o) return { correct: false, misconceptionIds: [], reason: 'no_option', confidence: 0.3 };
    return { correct: o.correct, misconceptionIds: o.misconceptionIds, feedback: textIn(o.feedback, lang) || undefined, reason: o.correct ? 'ok' : 'distractor', confidence: 1 };
  }
  const g = gradeNumeric(answer, check.numeric!);
  return { correct: g.correct, misconceptionIds: g.reason === 'wrong_dimension' ? ['unit_confusion'] : [], reason: g.reason, confidence: g.reason === 'no_number' ? 0.3 : 1 };
}

export const isTrusted = (item: { review: Record<string, string> }, lang: string, trustDraft?: boolean) =>
  item.review[lang] === 'reviewed' || item.review.en === 'reviewed' || !!trustDraft;

// ---------- content selection ----------

export function strategiesFor(pack: ChapterPack, conceptId: string): string[] {
  return [...new Set(pack.explanations.filter((e) => e.conceptId === conceptId).map((e) => e.strategy))];
}

/** P3.23: speaking (not reading) or a low reading level → tap answers and a step shorter text. */
export const prefersTap = (s: LearnerState) => s.language.inputMode === 'voice' || s.language.readingLevel <= 2;
export const explainLevel = (s: LearnerState) => (s.language.inputMode === 'voice' ? Math.max(1, s.language.readingLevel - 1) : s.language.readingLevel);

export function pickExplanation(pack: ChapterPack, conceptId: string, strategy: string | undefined, readingLevel: number, region?: string): Explanation | undefined {
  // P3.22: an analogy from her own region first; another region's analogy only if nothing else fits
  const fit = (e: Explanation) => (!e.regions ? 1 : region && e.regions.includes(region) ? 0 : 3);
  const pool = pack.explanations.filter((e) => e.conceptId === conceptId && (!strategy || e.strategy === strategy));
  return pool.sort((a, b) => fit(a) - fit(b) || Math.abs(a.level - readingLevel) - Math.abs(b.level - readingLevel))[0];
}

/** Remediation strategy for a misconception: an explanation that targets it, not the one that just failed. */
export function remediationFor(pack: ChapterPack, s: LearnerState, conceptId: string, misconceptionId: string): string | undefined {
  const last = concept(s, conceptId).lastStrategy;
  const targeted = pack.explanations.filter((e) => e.targets?.includes(misconceptionId) && e.strategy !== last);
  const tried = concept(s, conceptId).strategiesTried;
  targeted.sort((a, b) => Number(tried.includes(a.strategy)) - Number(tried.includes(b.strategy)));
  return targeted[0]?.strategy ?? pack.misconceptions.find((m) => m.id === misconceptionId)?.remediation.find((r) => r !== last);
}

export function pickCheck(pack: ChapterPack, s: LearnerState, conceptId: string, opts: { lang: string; trustDraft?: boolean; maxDifficulty?: number; exclude?: string[]; placement?: boolean; freeText?: boolean } ): CheckItem | undefined {
  const seen = concept(s, conceptId).seenChecks;
  const all = pack.checks.filter((c) => c.conceptId === conceptId && !opts.exclude?.includes(c.id) && (!opts.placement || c.placement));
  // written answers only where asked for (practice: "say it in your own words"), and never one she saw last
  const written = opts.freeText && !prefersTap(s) ? all.filter((c) => c.kind === 'text' && seen.at(-1) !== c.id) : [];
  const pool = written.length ? written : all.filter((c) => c.kind !== 'text');
  const score = (c: CheckItem) =>
    // seen recently → avoid; the most recent one most of all (seenChecks is newest-last)
    (seen.includes(c.id) ? 10 + seen.indexOf(c.id) + 1 : 0) +
    (isTrusted(c, opts.lang, opts.trustDraft) ? 0 : 5) +
    (opts.maxDifficulty && c.difficulty > opts.maxDifficulty ? 3 : 0) +
    (prefersTap(s) && c.kind !== 'mcq' ? 4 : 0) +
    c.difficulty * 0.1 * (concept(s, conceptId).pKnown < 0.5 ? 1 : -1);
  return pool.sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))[0];
}

// ---------- the three stages ----------

/** Thresholds for trusting the offline matcher. */
export const MATCH_CONFIDENT = 0.3;

export function observe(s: LearnerState, input: TurnInput, ctx: EngineCtx): { obs: Observation; events: EventDraft[]; messages: OutMsg[] } {
  const lang = s.language.response;
  const events: EventDraft[] = [];
  const messages: OutMsg[] = [];
  const obs: Observation = { trigger: input.type };
  switch (input.type) {
    case 'open':
      events.push({ type: 'SESSION_OPENED', payload: { sessionId: input.sessionId, tier: ctx.tier, ...(input.minutes ? { minutes: input.minutes } : {}) } });
      break;
    case 'doubt': {
      if (input.mode === 'photo') {
        observeSnap(obs, input, ctx);
        events.push({ type: 'DOUBT_ASKED', payload: { doubtId: input.doubtId, text: input.text.slice(0, 300), mode: 'photo', language: lang, script: obs.match!.script } });
        break;
      }
      const m = ctx.matcher.match(input.text);
      obs.match = m;
      obs.unmatched = !m.conceptId || (m.confidence < MATCH_CONFIDENT && !m.faqId);
      obs.safety = screen(input.text, obs.unmatched);
      if (obs.safety === 'ok' || obs.safety === 'off_topic') {
        obs.problem = parseProblem(input.text);
        const last = s.lastAnswer;
        if (!obs.problem && last && !last.correct && ctx.now - last.at < INSIST_WINDOW_MS && insists(input.text)) { obs.insist = { checkId: last.checkId, conceptId: last.conceptId }; obs.safety = 'ok'; }
        if (obs.problem) obs.safety = 'ok';
      }
      // what she said is not kept when it is not about study (the teacher sees only that a check-in is needed); PII never
      const kept = obs.safety === 'ok' || obs.safety === 'off_topic' ? scrubPii(input.text) : `[${obs.safety}: not kept]`;
      events.push({ type: 'DOUBT_ASKED', payload: { doubtId: input.doubtId, text: kept, mode: input.mode, language: lang, script: m.script } });
      break;
    }
    case 'answer': {
      const check = ctx.pack.checks.find((c) => c.id === input.checkId);
      if (!check) break;
      const g = ctx.preGraded?.[check.id] ?? gradeCheck(check, input.answer, lang);
      obs.grade = { ...g, checkId: check.id, conceptId: check.conceptId };
      const trusted = isTrusted(check, lang, ctx.trustDraft);
      events.push({
        type: 'ANSWER_GRADED',
        itemVersion: check.id,
        payload: {
          checkId: check.id, conceptId: check.conceptId, correct: g.correct, confidence: g.confidence,
          // placement only when it was shown as a placement question (the same item can also appear in lessons)
          source: !s.placementDone && s.placement.pending === check.id ? 'placement' : trusted ? 'bank' : 'llm_practice',
          misconceptionIds: g.misconceptionIds, strategy: concept(s, check.conceptId).lastStrategy,
        },
      });
      const fb = g.correct ? T(lang, 'correct') : g.feedback ?? T(lang, 'wrong');
      messages.push({ kind: 'feedback', correct: g.correct, text: fb, speak: fb, conceptId: check.conceptId });
      if (s.resumePointer) events.push({ type: 'STEP_COMPLETED', payload: { pointer: s.resumePointer } });
      break;
    }
    case 'end':
      events.push({ type: 'SESSION_ENDED', payload: { sessionId: input.sessionId, reason: input.reason ?? 'explicit', minutesUsed: input.minutesUsed } });
      break;
    case 'next':
      break;
  }
  // P4.29: say once when today's data or this session's time is nearly used up
  if (input.type !== 'end' && input.type !== 'open') {
    const low = budgetLow(s, ctx);
    const day = Math.floor(ctx.now / DAY_MS);
    if (low.data && s.budgetLow?.dataDay !== day) {
      events.push({ type: 'BUDGET_LOW', payload: { kind: 'data', left: Math.round(low.dataLeftKB) } });
      messages.push({ kind: 'info', text: T(lang, 'data_low'), speak: T(lang, 'data_low') });
    }
    if (low.time && s.session && s.budgetLow?.timeSession !== s.session.id) events.push({ type: 'BUDGET_LOW', payload: { kind: 'time', left: Math.round(low.timeLeftMin * 10) / 10 } });
  }
  return { obs, events, messages };
}
const DAY_MS = 86_400_000;

/**
 * Snap (PLAN §6.8): the photo text only LOCATES a passage. Offline OCR is noisy → locate or ask her to pick.
 * Online vision text is clean → if it is not a pack passage (another page), it is matched like a typed doubt.
 */
function observeSnap(obs: Observation, input: Extract<TurnInput, { type: 'doubt' }>, ctx: EngineCtx) {
  const script = detectScript(input.text);
  const picked = input.passageId ? ctx.pack.passages.find((p) => p.id === input.passageId) : undefined;
  if (picked) {
    obs.snap = { readable: true, confident: true, passageId: picked.id, conceptId: picked.conceptId, score: 1, margin: 1, top: [], source: 'picked' };
  } else {
    obs.snap = { ...locatePassage(ctx.pack, input.text), source: ctx.tier === 'device' ? 'ocr' : 'vision' };
  }
  const loc = obs.snap;
  if (loc.confident) {
    obs.match = { conceptId: loc.conceptId, confidence: loc.score, hits: [], script };
    obs.unmatched = false;
  } else if (ctx.tier !== 'device' && loc.readable) {
    const m = ctx.matcher.match(input.text);
    obs.match = m;
    obs.unmatched = !m.conceptId || (m.confidence < MATCH_CONFIDENT && !m.faqId);
  } else {
    obs.match = { confidence: loc.score, hits: [], script };
    obs.unmatched = true;
  }
}

export function policyContext(s: LearnerState, ctx: EngineCtx) {
  const minutesLeft = s.session ? Math.max(0, s.session.minutes - (ctx.now - s.session.openedAt) / 60000) : s.constraints.sessionMinutes;
  const dataLeftKB = Math.max(0, DATA_BUDGET_KB[s.constraints.dataTier] - s.constraints.dataUsedKB);
  const available = new Set(ctx.pack.explanations.map((e) => e.conceptId).concat(ctx.pack.checks.map((c) => c.conceptId)));
  return {
    graph: ctx.pack.graph,
    now: ctx.now,
    tier: ctx.tier,
    timeLeftMin: Math.max(minutesLeft, 1),
    dataLeftKB,
    availableOffline: available,
    checkable: new Set(ctx.pack.checks.map((c) => c.conceptId)),
    misconceptionSeverity: Object.fromEntries(ctx.pack.misconceptions.map((m) => [m.id, m.severity])),
    // low on data → no audio in the plan's costs (and the phone stops fetching voice), P4.29
    withAudio: ctx.withAudio && dataLeftKB >= DATA_BUDGET_KB[s.constraints.dataTier] * DATA_LOW_FRACTION,
  };
}

/** Below these, the session adapts (P4.29): text only (no audio downloads); wrap up at a resume point. */
export const DATA_LOW_FRACTION = 0.15;
export const TIME_LOW_MIN = 2;
export function budgetLow(s: LearnerState, ctx: EngineCtx): { data: boolean; time: boolean; dataLeftKB: number; timeLeftMin: number } {
  const pctx = policyContext(s, ctx);
  const minutesLeft = s.session ? Math.max(0, s.session.minutes - (ctx.now - s.session.openedAt) / 60000) : Infinity;
  return {
    data: pctx.dataLeftKB < DATA_BUDGET_KB[s.constraints.dataTier] * DATA_LOW_FRACTION,
    time: minutesLeft <= TIME_LOW_MIN,
    dataLeftKB: pctx.dataLeftKB, timeLeftMin: minutesLeft,
  };
}

/** Policy decision for the situation after the observation was applied to state. */
export function decide(s: LearnerState, obs: Observation, ctx: EngineCtx, input: TurnInput): Decision {
  const d = decideInner(s, obs, ctx, input);
  // a located photo: show that passage first, whatever the teaching move is (step back, probe, teach)
  if (input.type === 'doubt' && obs.snap?.passageId && d.action !== 'pick_passage')
    return { ...d, passageId: obs.snap.passageId, reason: `photo located in the book: ${obs.snap.passageId} (${obs.snap.source}, score ${obs.snap.score}) → ${d.reason}` };
  return d;
}

function decideInner(s: LearnerState, obs: Observation, ctx: EngineCtx, input: TurnInput): Decision {
  const pctx = policyContext(s, ctx);
  const candidates = recommend(s, pctx);
  const top = (exclude?: string): Decision => {
    // P4.29: the time she has is nearly up → finish this item here, the next one waits at the resume point
    if (input.type !== 'open' && budgetLow(s, ctx).time && s.session) return { action: 'close', reason: `time almost up (≤ ${TIME_LOW_MIN} min left of ${s.session.minutes}) → stop at a good point; the next step is saved for next time`, decidedBy: 'policy', override: false, candidates };
    const planned = fromPlan(s, ctx, candidates, exclude);
    if (planned) return planned;
    const c = candidates.find((x) => x.conceptId !== exclude) ?? candidates[0];
    if (!c) return { action: 'close', reason: 'nothing affordable left in this session', decidedBy: 'policy', override: false, candidates };
    return fromCandidate(s, ctx, c, candidates, c.reasons.join('; '));
  };
  const D = (d: Omit<Decision, 'decidedBy' | 'override' | 'candidates'>): Decision => ({ decidedBy: 'policy', override: false, candidates, ...d });

  switch (input.type) {
    case 'open': {
      if (s.resumePointer) return D({ action: 'resume', conceptId: s.resumePointer.conceptId, reason: 'interrupted mid-step last time → resume exactly there' });
      if (placementActive(s)) return placementDecision(s, ctx);
      return top();
    }
    case 'doubt': {
      const m = obs.match!;
      const safe = safetyDecision(obs.safety, candidates);
      if (safe) return safe;
      if (obs.insist) return D({ action: 'reground', conceptId: obs.insist.conceptId, reason: `she insists her wrong answer to ${itemBase(obs.insist.checkId)} was right → no agreeing: back to what the textbook says, then try again` });
      if (obs.problem) {
        const p = obs.problem;
        return D({ action: 'hint', conceptId: p.conceptId, problem: p, reason: `homework-style problem (given ${p.given.map((g) => g.q.raw).join(', ')}; find ${p.asked}) → hint ladder: given → formula → put values; she works out the answer (solver: ${p.answer.shown} ${p.answer.unit}, held back)` });
      }
      if (obs.snap && obs.unmatched) {
        const sn = obs.snap;
        return D({ action: 'pick_passage', passages: sn.top.map((x) => x.passageId), unreadable: !sn.readable,
          reason: !sn.readable ? 'photo unreadable → retake tips, then pick one of 3 passages or keep the photo for later'
            : `photo not located confidently (best ${sn.top[0]?.passageId ?? '—'} ${sn.score}, margin ${sn.margin}) → she picks one of 3 passages` });
      }
      if (obs.unmatched) {
        if (ctx.tier === 'device') return D({ action: 'queue', reason: `no confident match offline (confidence ${m.confidence}) → queue for when signal returns` });
        return D({ action: 'clarify', reason: `retrieval unsure (confidence ${m.confidence}) → one clarifying question with concept chips` });
      }
      const cid = m.conceptId!;
      const b = blockers(s, ctx.pack.graph, cid);
      if (b.stepBack[0]) return D({ action: 'step_back', conceptId: b.stepBack[0], strategy: chooseStrategy(s, b.stepBack[0], strategiesFor(ctx.pack, b.stepBack[0])), reason: `doubt is about ${cid}, but ${b.stepBack[0]} is weak → step back first` });
      if (b.probe[0]) return D({ action: 'probe_prereq', conceptId: b.probe[0], reason: `doubt is about ${cid}; ${b.probe[0]} never measured → one quick question first` });
      if (m.faqId) return D({ action: 'answer_faq', conceptId: cid, faqId: m.faqId, reason: `doubt matches FAQ ${m.faqId} → grounded answer, then verify` });
      return D({ action: 'teach', conceptId: cid, strategy: chooseStrategy(s, cid, strategiesFor(ctx.pack, cid)), reason: `doubt is about ${cid}; prerequisites ready → teach, then verify` });
    }
    case 'answer': {
      const g = obs.grade;
      if (!g) return top();
      // a placement answer only moves the walk on — no remediation or escalation on day one
      if (placementActive(s) && s.placement.answers.at(-1)?.checkId === g.checkId && !s.placement.pending) return placementDecision(s, ctx);
      const cid = g.conceptId;
      const c = concept(s, cid);
      if (g.correct) {
        if (c.mastered) return { ...top(cid), reason: `${cid} mastered (p=${c.pKnown.toFixed(2)}) → move on: ${top(cid).reason}` };
        if (c.correctStreak >= 2) return { ...top(), reason: `two in a row on ${cid} → next by policy: ${top().reason}` };
        return D({ action: 'continue_check', conceptId: cid, reason: `right, but one answer is not proof (p=${c.pKnown.toFixed(2)}) → one more check` });
      }
      if (shouldEscalate(s, cid)) {
        return D({ action: 'escalate', conceptId: cid, reason: `${MAX_STRATEGIES} strategies tried on ${cid} without success → teacher`, then: top(cid) });
      }
      const mis = g.misconceptionIds.find((m) => m !== 'unit_confusion') ?? g.misconceptionIds[0];
      if (mis) {
        const strat = remediationFor(ctx.pack, s, cid, mis) ?? chooseStrategy(s, cid, strategiesFor(ctx.pack, cid), { excludeLast: true });
        const ms = c.misconceptions[mis];
        return D({ action: 'remediate', conceptId: cid, misconceptionId: mis, strategy: strat, reason: `chose a trap answer → ${ms?.confirmed ? 'confirmed' : 'possible'} misconception "${mis}" → ${strat} (different from ${c.lastStrategy ?? 'none'})` });
      }
      const b = blockers(s, ctx.pack.graph, cid);
      if (b.stepBack[0]) return D({ action: 'step_back', conceptId: b.stepBack[0], strategy: chooseStrategy(s, b.stepBack[0], strategiesFor(ctx.pack, b.stepBack[0])), reason: `wrong on ${cid}; prerequisite ${b.stepBack[0]} is weak → step back` });
      if (g.reason === 'no_number' || g.reason === 'no_option') return D({ action: 'continue_check', conceptId: cid, reason: 'answer unclear → simpler diagnostic question' });
      return D({ action: 'teach', conceptId: cid, strategy: chooseStrategy(s, cid, strategiesFor(ctx.pack, cid), { excludeLast: true }), reason: `wrong without a known trap → explain ${cid} a different way` });
    }
    case 'next':
      return placementActive(s) ? placementDecision(s, ctx) : top();
    case 'end':
      return D({ action: 'close', reason: 'session ended → prepare next session' });
  }
}

/** The decision for a question the safety screen flagged, or undefined when it is a study question. */
export function safetyDecision(kind: SafetyKind | undefined, candidates: Candidate[], decidedBy: 'policy' | 'llm' = 'policy'): Decision | undefined {
  const D = (action: 'care' | 'decline' | 'redirect', reason: string): Decision => ({ action, reason, decidedBy, override: decidedBy === 'llm', candidates });
  switch (kind) {
    case 'distress': return D('care', 'wellbeing: words of distress → caring message, trusted adult + helpline, quiet alert to her teacher; nothing she said is kept');
    case 'unsafe': return D('decline', 'unsafe topic → no engagement, calm message, back to study');
    case 'personal': return D('redirect', 'personal details (phone, address, family) → not needed for learning, not kept → back to study');
    case 'off_topic': return D('redirect', 'not a study question → kind redirect to her lesson');
    default: return undefined;
  }
}

/** The next placement question, or — when placement is done — the first lesson chosen on what it found. */
export function placementDecision(s: LearnerState, ctx: EngineCtx): Decision {
  const step = nextPlacement(s, ctx.pack, ctx.now);
  const n = s.placement.answers.length;
  if (!step.done) {
    return { action: 'place', conceptId: step.conceptId, checkId: step.check.id, reason: `placement question ${n + 1}: ${step.reason}`, decidedBy: 'policy', override: false, candidates: [] };
  }
  const after = apply(s, placementEvent(s, ctx, step.summary, step.reason), ctx.pack.graph);
  const then = decide(after, { trigger: 'next' }, ctx, { type: 'next' });
  const sum = step.summary;
  return {
    action: 'place_done', placement: sum, then, decidedBy: 'policy', override: false, candidates: then.candidates,
    reason: `placement done after ${n} questions (${step.reason}): known [${sum.known.join(', ')}], gaps [${sum.gaps.join(', ')}] → first lesson: ${then.action}${then.conceptId ? ':' + then.conceptId : ''}`,
  };
}

const placementEvent = (s: LearnerState, ctx: EngineCtx, sum: PlacementSummary, reason: string): AnyEvent => ({
  id: 'placement-preview', profileId: s.profileId, deviceId: 'engine', seq: 0, ts: ctx.now,
  type: 'PLACEMENT_COMPLETED', payload: { conceptIds: sum.asked, known: sum.known, gaps: sum.gaps, reason },
});

/** Next item of the prepared session not yet done, if the policy still finds it worth doing (plan repair, PLAN §5.1). */
export function fromPlan(s: LearnerState, ctx: EngineCtx, candidates: Candidate[], exclude?: string): Decision | undefined {
  const plan = s.preparedSession;
  if (!plan) return undefined;
  for (const [i, item] of plan.items.entries()) {
    if (item.conceptId === exclude) continue;
    const seen = concept(s, item.conceptId).lastSeenAt;
    if (seen !== undefined && seen >= plan.createdAt) continue; // done since the plan was made
    const c = candidates.find((x) => x.conceptId === item.conceptId && x.action === item.action) ?? candidates.find((x) => x.conceptId === item.conceptId);
    if (!c) continue; // state changed: no longer worth it → skip (repair)
    const d = fromCandidate(s, ctx, c, candidates, `prepared ${plan.preparedBy === 'server' ? 'after last session' : 'on this phone'} (item ${i + 1}/${plan.items.length}): ${item.reason}`);
    if (c.action === item.action && item.strategy) d.strategy = item.strategy;
    return d;
  }
  return undefined;
}

/** Explanation prepared between sessions for exactly this decision, if any (used offline and online). */
export function preparedExplanation(s: LearnerState, d: Decision, lang: string): Generated | undefined {
  const item = s.preparedSession?.items.find((x) => x.conceptId === d.conceptId && x.pregenerated?.lang === lang && (!d.strategy || !x.pregenerated.strategy || x.pregenerated.strategy === d.strategy));
  if (!item?.pregenerated) return undefined;
  if (concept(s, item.conceptId).lastStrategy === item.pregenerated.strategy && d.action === 'remediate') return undefined; // she already saw it
  return { explanation: { text: item.pregenerated.text, speak: item.pregenerated.speak }, tool: 'prepared' };
}

/**
 * Plan the NEXT session (PLAN §5.2): walk the policy's candidates as they will look when she is likely to
 * open the app again, keep distinct concepts, and fit them into her typical session length.
 * Runs on the phone (session ended offline, P4.25) and on the server (between-session run, P4.24/26).
 */
export function prepareSession(s: LearnerState, ctx: EngineCtx, preparedBy: 'server' | 'device', opts: { at?: number; maxItems?: number } = {}): SessionPlan {
  const minutes = Math.max(5, s.constraints.typicalSessionMin);
  const at = opts.at ?? ctx.now + 20 * 3600_000;
  const pctx = { ...policyContext(s, { ...ctx, now: at, tier: 'device' }), timeLeftMin: minutes, now: at };
  const candidates = recommend(s, pctx);
  const items: PlanItem[] = [];
  let left = minutes;
  for (const c of candidates) {
    if (items.length >= (opts.maxItems ?? 4)) break;
    if (items.some((x) => x.conceptId === c.conceptId)) continue;
    if (c.cost.min > left) continue;
    const d = fromCandidate(s, ctx, c, candidates, c.reasons.join('; '));
    items.push({ action: c.action, conceptId: c.conceptId, reason: d.reason, strategy: d.strategy, misconceptionId: c.misconceptionId, minutes: c.cost.min });
    left -= c.cost.min;
  }
  return { createdAt: ctx.now, forSessionMinutes: minutes, items, preparedBy };
}

function fromCandidate(s: LearnerState, ctx: EngineCtx, c: Candidate, candidates: Candidate[], reason: string): Decision {
  const strategy =
    c.action === 'remediate' && c.misconceptionId ? remediationFor(ctx.pack, s, c.conceptId, c.misconceptionId)
    : c.action === 'teach' || c.action === 'step_back' ? chooseStrategy(s, c.conceptId, strategiesFor(ctx.pack, c.conceptId))
    : undefined;
  return { action: c.action, conceptId: c.conceptId, misconceptionId: c.misconceptionId, strategy, reason, decidedBy: 'policy', override: false, candidates };
}

/** Generated text the server may supply instead of pack text (already critic-approved). */
export interface Generated { explanation?: { text: string; speak?: string }; tool?: string }

export function execute(s: LearnerState, d: Decision, ctx: EngineCtx, gen: Generated = {}, sessionId = s.session?.id ?? 'none'): { events: EventDraft[]; messages: OutMsg[]; tools: TraceStep['tools'] } {
  const lang = s.language.response;
  const level = explainLevel(s);
  const events: EventDraft[] = [];
  const messages: OutMsg[] = [];
  const tools: TraceStep['tools'] = [];
  const name = (cid: string) => textIn(ctx.pack.graph.concepts[cid]?.name, lang);
  const bridge = (cid: string) => {
    const g = ctx.pack.glossary.find((x) => x.conceptId === cid);
    return g ? { bridge: { term: textIn(g.term, lang), english: g.english, everyday: textIn(g.everyday, lang) } } : {};
  };

  const explain = (cid: string, strategy?: string) => {
    if (gen.explanation) {
      messages.push({ kind: 'explanation', conceptId: cid, strategy: strategy ?? 'generated', text: gen.explanation.text, speak: gen.explanation.speak ?? gen.explanation.text, generated: true, term: name(cid), ...bridge(cid) });
      events.push({ type: 'EXPLANATION_DELIVERED', payload: { conceptId: cid, strategy: strategy ?? 'generated', level } });
      tools.push({ tool: 'teach', args: { conceptId: cid, strategy, level, source: gen.tool === 'prepared' ? 'prepared between sessions' : 'llm' }, status: 'ok' });
      return;
    }
    const e = pickExplanation(ctx.pack, cid, strategy, level, s.region) ?? pickExplanation(ctx.pack, cid, undefined, level, s.region);
    if (!e) { tools.push({ tool: 'teach', args: { conceptId: cid, strategy }, status: 'failed', note: 'no content' }); return; }
    messages.push({ kind: 'explanation', conceptId: cid, strategy: e.strategy, itemId: e.id, text: textIn(e.body.display, lang), speak: speakIn(e.body, lang), generated: false, term: name(cid), ...bridge(cid) });
    events.push({ type: 'EXPLANATION_DELIVERED', itemVersion: e.id, payload: { conceptId: cid, strategy: e.strategy, level, itemRef: e.id } });
    tools.push({ tool: 'teach', args: { conceptId: cid, strategy: e.strategy, level, source: 'pack', item: e.id }, status: gen.tool === 'fallback' ? 'fallback' : 'ok' });
  };

  const check = (cid: string, planIndex = 0, opts: { maxDifficulty?: number; item?: CheckItem; placement?: boolean; freeText?: boolean } = {}) => {
    const k = opts.item ?? pickCheck(ctx.pack, s, cid, { lang, trustDraft: ctx.trustDraft, ...opts });
    if (!k) { tools.push({ tool: 'make_check', args: { conceptId: cid }, status: 'failed', note: 'no check in bank' }); return; }
    const practice = !opts.placement && !isTrusted(k, lang, ctx.trustDraft);
    messages.push({
      kind: 'check', checkId: k.id, conceptId: cid, stem: textIn(k.stem.display, lang), speak: speakIn(k.stem, lang),
      options: k.options?.map((o) => ({ id: o.id, text: textIn(o.text, lang) })), numeric: k.kind === 'numeric', practice, ...(opts.placement ? { placement: true } : {}), ...(k.kind === 'text' ? { freeText: true } : {}),
    });
    const pointer: ResumePointer = { sessionId, planIndex, conceptId: cid, step: 'check', checkIds: [k.id], checkIndex: 0 };
    const source = opts.placement ? 'placement' : practice ? 'llm_practice' : 'bank';
    events.push({ type: 'CHECK_SHOWN', itemVersion: k.id, payload: { checkId: k.id, conceptId: cid, source } });
    events.push({ type: 'STEP_STARTED', payload: { pointer } });
    tools.push({ tool: opts.placement ? 'place' : 'make_check', args: { conceptId: cid, item: k.id, source: opts.placement ? 'placement' : practice ? 'practice' : 'bank' }, status: 'ok' });
  };
  const info = (text: string, tone: Extract<OutMsg, { kind: 'info' }>['tone'] = 'neutral') => messages.push({ kind: 'info', text, speak: text, tone });

  // Snap: show the clean textbook passage she photographed, then teach it (never the OCR text)
  if (d.passageId) {
    const p = ctx.pack.passages.find((x) => x.id === d.passageId);
    if (p) {
      messages.push({ kind: 'passage', passageId: p.id, text: textIn(p.text, lang), speak: textIn(p.text, lang), ...(p.page ? { page: p.page } : {}) });
      tools.push({ tool: 'read_page', args: { passageId: p.id, conceptId: p.conceptId }, status: 'ok' });
    }
  }

  switch (d.action) {
    case 'teach':
    case 'remediate':
      explain(d.conceptId!, d.strategy);
      check(d.conceptId!);
      break;
    case 'step_back':
      info(T(lang, 'step_back', name(d.conceptId!)));
      explain(d.conceptId!, d.strategy);
      check(d.conceptId!);
      break;
    case 'probe_prereq':
      info(T(lang, 'probe', name(d.conceptId!)));
      check(d.conceptId!, 0, { maxDifficulty: 1 });
      break;
    case 'review':
      info(T(lang, 'review', name(d.conceptId!)));
      check(d.conceptId!);
      break;
    case 'practice':
    case 'continue_check':
      check(d.conceptId!, 0, d.action === 'continue_check' && d.reason.includes('simpler') ? { maxDifficulty: 1 } : d.action === 'practice' ? { freeText: true } : {});
      break;
    case 'answer_faq': {
      const f = ctx.pack.faq.find((x) => x.id === d.faqId);
      if (gen.explanation || !f) explain(d.conceptId!, d.strategy);
      else {
        messages.push({ kind: 'explanation', conceptId: d.conceptId!, strategy: 'faq', itemId: f.id, text: textIn(f.answer.display, lang), speak: speakIn(f.answer, lang), generated: false, term: name(d.conceptId!), ...bridge(d.conceptId!) });
        events.push({ type: 'EXPLANATION_DELIVERED', payload: { conceptId: d.conceptId!, strategy: 'faq', level, itemRef: f.id } });
        tools.push({ tool: 'search_curriculum', args: { faq: f.id }, status: 'ok' });
      }
      check(d.conceptId!);
      break;
    }
    case 'clarify': {
      const hits = [...new Set((d.candidates.length ? d.candidates.map((c) => c.conceptId) : Object.keys(ctx.pack.graph.concepts)))].slice(0, 3);
      const t = T(lang, 'clarify');
      messages.push({ kind: 'chips', text: t, speak: t, options: hits.map((cid) => ({ conceptId: cid, label: name(cid) })) });
      break;
    }
    case 'queue':
      info(T(lang, 'queued'), 'promise');
      break;
    case 'hint': {
      const h = hintLadder(d.problem!, lang);
      messages.push({ kind: 'hints', conceptId: d.conceptId!, text: h.intro, speak: h.intro, steps: h.steps, answer: h.answer });
      events.push({ type: 'EXPLANATION_DELIVERED', payload: { conceptId: d.conceptId!, strategy: 'hint_ladder', level } });
      tools.push({ tool: 'solve', args: { formula: d.problem!.formula, given: d.problem!.given.map((g) => g.q.raw), answer: `${h.answer.shown} ${h.answer.unit}` }, status: 'ok', note: 'answer held back until she tries' });
      break;
    }
    case 'reground': {
      info(T(lang, 'reground'));
      const p = ctx.pack.passages.find((x) => x.conceptId === d.conceptId);
      if (p) {
        messages.push({ kind: 'passage', passageId: p.id, text: textIn(p.text, lang), speak: textIn(p.text, lang), ...(p.page ? { page: p.page } : {}) });
        tools.push({ tool: 'read_page', args: { passageId: p.id, conceptId: p.conceptId, why: 're-ground in the textbook' }, status: 'ok' });
      } else explain(d.conceptId!);
      info(T(lang, 'reground_after'));
      check(d.conceptId!);
      break;
    }
    case 'care': {
      messages.push({ kind: 'info', text: T(lang, 'care'), speak: T(lang, 'care_speak'), tone: 'escalated' });
      if (s.classCode) info(T(lang, 'care_teacher'));
      events.push({ type: 'ESCALATED', payload: { kind: 'wellbeing', reason: 'words of distress in a question (what she said is not kept)' } });
      tools.push({ tool: 'notify_teacher', args: { kind: 'wellbeing' }, status: ctx.tier === 'device' ? 'fallback' : 'ok', note: ctx.tier === 'device' ? 'queued until sync' : undefined });
      break;
    }
    case 'decline':
      info(T(lang, 'decline'));
      tools.push({ tool: 'safety', args: { input: 'unsafe' }, status: 'ok', note: 'declined, nothing generated' });
      break;
    case 'redirect': {
      const personal = d.reason.startsWith('personal');
      const t = T(lang, personal ? 'privacy' : 'redirect');
      const next = [...new Set(d.candidates.map((c) => c.conceptId))].slice(0, 3);
      const ids = next.length ? next : Object.keys(ctx.pack.graph.concepts).slice(0, 3);
      messages.push({ kind: 'chips', text: t, speak: t, options: ids.map((cid) => ({ conceptId: cid, label: name(cid) })) });
      tools.push({ tool: 'safety', args: { input: personal ? 'personal' : 'off_topic' }, status: 'ok', note: 'redirected to study' });
      break;
    }
    case 'pick_passage': {
      if (d.unreadable) info(T(lang, 'snap_retake'));
      const t = T(lang, 'snap_pick');
      const opts = (d.passages ?? []).map((id) => ctx.pack.passages.find((p) => p.id === id)).filter((p) => !!p)
        .map((p) => ({ passageId: p!.id, label: clip(textIn(p!.text, lang), 70) }));
      messages.push({ kind: 'passages', text: t, speak: t, options: opts, canQueue: ctx.tier === 'device' });
      tools.push({ tool: 'read_page', args: { candidates: opts.map((o) => o.passageId) }, status: 'fallback', note: d.unreadable ? 'unreadable photo' : 'low confidence locate' });
      break;
    }
    case 'resume': {
      const p = s.resumePointer!;
      info(T(lang, 'resume'));
      const k = ctx.pack.checks.find((c) => c.id === p.checkIds?.[p.checkIndex ?? 0]);
      if (k) {
        const placing = !s.placementDone && s.placement.pending === k.id;
        messages.push({ kind: 'check', checkId: k.id, conceptId: k.conceptId, stem: textIn(k.stem.display, lang), speak: speakIn(k.stem, lang), options: k.options?.map((o) => ({ id: o.id, text: textIn(o.text, lang) })), numeric: k.kind === 'numeric', practice: !placing && !isTrusted(k, lang, ctx.trustDraft), ...(placing ? { placement: true } : {}) });
      }
      tools.push({ tool: 'plan', args: { resume: p }, status: 'ok' });
      break;
    }
    case 'escalate': {
      events.push({ type: 'ESCALATED', payload: { conceptId: d.conceptId, kind: 'academic', reason: d.reason } });
      tools.push({ tool: 'notify_teacher', args: { conceptId: d.conceptId, kind: 'academic' }, status: ctx.tier === 'device' ? 'fallback' : 'ok', note: ctx.tier === 'device' ? 'queued until sync' : undefined });
      info(T(lang, 'escalated', name(d.conceptId!)), 'escalated');
      if (d.then && d.then.action !== 'escalate') {
        const r = execute(s, d.then, ctx, {}, sessionId);
        events.push(...r.events); messages.push(...r.messages); tools.push(...r.tools);
      }
      break;
    }
    case 'place': {
      if (!s.placement.answers.length && !s.placement.pending) info(T(lang, 'placement_intro'));
      check(d.conceptId!, 0, { item: ctx.pack.checks.find((c) => c.id === d.checkId), placement: true });
      break;
    }
    case 'place_done': {
      const sum = d.placement!;
      const ev = placementEvent(s, ctx, sum, d.reason);
      events.push({ type: 'PLACEMENT_COMPLETED', payload: ev.payload as EventPayloads['PLACEMENT_COMPLETED'] });
      tools.push({ tool: 'update_learner', args: { placement: { asked: sum.asked, known: sum.known, gaps: sum.gaps } }, status: 'ok' });
      const names = sum.known.map(name).join(', ');
      info(sum.known.length ? T(lang, 'placement_known', names) : T(lang, 'placement_fresh'), 'celebrate');
      if (d.then && d.then.action !== 'place_done') {
        const r = execute(apply(s, ev, ctx.pack.graph), d.then, ctx, gen, sessionId);
        events.push(...r.events); messages.push(...r.messages); tools.push(...r.tools);
      }
      break;
    }
    case 'close': {
      info(T(lang, 'close'), 'celebrate');
      const plan = prepareSession(s, ctx, ctx.tier === 'device' ? 'device' : 'server');
      events.push({ type: 'PLAN_SET', payload: { plan } });
      tools.push({ tool: 'plan_next_session', args: { items: plan.items.map((x) => `${x.action}:${x.conceptId}`), minutes: plan.forSessionMinutes, by: plan.preparedBy }, status: 'ok' });
      break;
    }
  }
  return { events, messages, tools };
}

/**
 * Whole device-tier turn: observe → (apply) → decide → execute. Pure: returns event drafts
 * for the caller to stamp (id, seq, ts) and append. The server reuses the stages separately.
 */
export function runTurn(s0: LearnerState, input: TurnInput, ctx: EngineCtx, stamp: (d: EventDraft) => AnyEvent): TurnResult & { state: LearnerState } {
  const o = observe(s0, input, ctx);
  let s = s0;
  const stamped: AnyEvent[] = [];
  for (const d of o.events) { const e = stamp(d); stamped.push(e); s = apply(s, e, ctx.pack.graph); }

  const decision = decide(s, o.obs, ctx, input);
  const ex = execute(s, decision, ctx, preparedExplanation(s, decision, s.language.response) ?? {});
  // queued doubts get a promise the agent must keep (PLAN §8.2)
  const extra: EventDraft[] = [];
  if (decision.action === 'queue' && input.type === 'doubt') {
    extra.push({ type: 'DOUBT_QUEUED', payload: { doubtId: input.doubtId, text: input.text, reason: 'no confident offline match' } });
    extra.push({ type: 'COMMITMENT_MADE', payload: { commitmentId: `answer:${input.doubtId}`, text: 'answer queued doubt when online' } });
  }
  for (const d of [...ex.events, ...extra]) { const e = stamp(d); stamped.push(e); s = apply(s, e, ctx.pack.graph); }

  const g = guardOutput([...o.messages, ...ex.messages], s.language.response);
  const trace = { ...buildTrace(s0, s, input, o.obs, decision, ex.tools, ctx), safety: { checked: g.checked, blocked: g.blocked, ...(o.obs.safety ? { input: o.obs.safety } : {}) } };
  return { events: [...o.events, ...ex.events, ...extra], messages: g.messages, decision, observation: o.obs, trace, state: s };
}

export function buildTrace(before: LearnerState, after: LearnerState, input: TurnInput, obs: Observation, d: Decision, tools: TraceStep['tools'], ctx: EngineCtx): TraceStep {
  const facts: string[] = [];
  if (obs.match) facts.push(`match: ${obs.match.conceptId ?? '—'} (conf ${obs.match.confidence}, script ${obs.match.script}${obs.match.faqId ? ', faq ' + obs.match.faqId : ''})`);
  if (obs.grade) facts.push(`graded ${itemBase(obs.grade.checkId)}: ${obs.grade.correct ? 'right' : 'wrong'}${obs.grade.misconceptionIds.length ? ' → ' + obs.grade.misconceptionIds.join(',') : ''}`);
  const focus = d.conceptId ?? obs.grade?.conceptId ?? obs.match?.conceptId;
  if (focus) {
    const c = concept(before, focus);
    facts.push(`${focus}: p=${c.pKnown.toFixed(2)}, attempts ${c.attempts}, tried [${c.strategiesTried.join(', ')}]`);
  }
  facts.push(`time left ${policyContext(before, ctx).timeLeftMin.toFixed(0)} min, data left ${policyContext(before, ctx).dataLeftKB} KB`);
  return {
    trigger: input.type,
    tier: ctx.tier,
    facts_used: facts,
    candidates: d.candidates.slice(0, 5).map((c) => ({ action: c.action, concept: c.conceptId, score: c.score })),
    chosen: `${d.action}${d.conceptId ? ':' + d.conceptId : ''}${d.strategy ? ' (' + d.strategy + ')' : ''}`,
    decided_by: d.decidedBy,
    override: d.override,
    reason: d.reason,
    tools: obs.grade ? [{ tool: 'evaluate_answer', args: { item: obs.grade.checkId }, status: 'ok' }, { tool: 'update_learner', args: { concept: obs.grade.conceptId }, status: 'ok' }, ...tools] : tools,
    state_diff: stateDiff(before, after),
    why: whyLine(d, before.language.response, ctx),
  };
}

export function stateDiff(a: LearnerState, b: LearnerState): Record<string, string> {
  const out: Record<string, string> = {};
  const ids = new Set([...Object.keys(a.concepts), ...Object.keys(b.concepts)]);
  for (const id of ids) {
    const x = concept(a, id), y = concept(b, id);
    if (Math.abs(x.pKnown - y.pKnown) > 0.005) out[`${id}.pKnown`] = `${x.pKnown.toFixed(2)} → ${y.pKnown.toFixed(2)}`;
    if (x.mastered !== y.mastered) out[`${id}.mastered`] = `${x.mastered} → ${y.mastered}`;
    for (const [m, ms] of Object.entries(y.misconceptions)) {
      const prev = x.misconceptions[m];
      if (!prev || prev.signals !== ms.signals || prev.confirmed !== ms.confirmed) out[`${id}.misconception.${m}`] = `${prev?.signals ?? 0} → ${ms.signals} signals${ms.confirmed ? ' (confirmed)' : ''}`;
    }
  }
  if (a.queuedDoubts.length !== b.queuedDoubts.length) out.queuedDoubts = `${a.queuedDoubts.length} → ${b.queuedDoubts.length}`;
  if (a.escalations.length !== b.escalations.length) out.escalations = `${a.escalations.length} → ${b.escalations.length}`;
  return out;
}

/**
 * Output safety check on every message, online and offline (P5.17). Pack text is reviewed before it ships (and a
 * content test runs this on all of it); this catches anything that slipped through, e.g. a generated line.
 */
export function guardOutput(messages: OutMsg[], lang: string): { messages: OutMsg[]; checked: number; blocked: number } {
  let blocked = 0;
  const out = messages.map((m): OutMsg => {
    if (m.kind === 'info' && m.tone === 'escalated') return m; // the care message names the problem on purpose
    const texts: string[] = [m.speak, 'text' in m ? m.text : ''];
    if (m.kind === 'check') texts.push(m.stem, ...(m.options ?? []).map((o) => o.text));
    if (m.kind === 'chips' || m.kind === 'passages') texts.push(...m.options.map((o) => o.label));
    if (m.kind === 'hints') texts.push(...m.steps);
    if (!texts.some((t) => t && isUnsafe(t))) return m;
    blocked++;
    return { kind: 'info', text: T(lang, 'decline'), speak: T(lang, 'decline') };
  });
  return { messages: out, checked: messages.length, blocked };
}

// ---------- learner-facing strings (UI language) ----------

export const ENGINE_LINES: Record<string, Record<string, string>> = {
  or: {
    correct: 'ଠିକ୍ କହିଲ! 👏',
    wrong: 'ଏଥର ଠିକ୍ ହେଲା ନାହିଁ। ଚାଲ, ଅନ୍ୟ ଉପାୟରେ ବୁଝିବା।',
    step_back: 'ଆଗରୁ "{0}" ଟିକେ ଦେଖିନେବା — ଏହା ବୁଝିଲେ ତୁମ ପ୍ରଶ୍ନ ସହଜ ହେବ।',
    probe: '"{0}" ବିଷୟରେ ଗୋଟିଏ ଛୋଟ ପ୍ରଶ୍ନ।',
    review: 'ପୁନରାବୃତ୍ତି: "{0}" ମନେ ଅଛି କି?',
    clarify: 'ତୁମେ କେଉଁଟି ବିଷୟରେ ପଚାରୁଛ?',
    queued: 'ସିଗନାଲ୍ ଆସିଲେ ମୁଁ ଏହାର ଉତ୍ତର ଦେବି। ସେପର୍ଯ୍ୟନ୍ତ ଚାଲ ଆଗକୁ ପଢ଼ିବା।',
    resume: 'ଆମେ ଏଠି ଅଟକିଥିଲୁ — ଆଗକୁ ଚାଲିବା?',
    escalated: '"{0}" ପାଇଁ ମୁଁ ତୁମ ଶିକ୍ଷକଙ୍କୁ କହିଛି। ସେପର୍ଯ୍ୟନ୍ତ ଅନ୍ୟ କିଛି ପଢ଼ିବା।',
    close: 'ଆଜି ପାଇଁ ବହୁତ ଭଲ! କାଲି ପାଇଁ ମୁଁ ପାଠ ପ୍ରସ୍ତୁତ କରି ରଖିବି।',
    why_teach: '"{0}" ତୁମ ଲକ୍ଷ୍ୟ ପାଇଁ ଦରକାର, ଆଉ ତୁମେ ଏହା ପାଇଁ ପ୍ରସ୍ତୁତ।',
    why_remediate: 'ତୁମ ଉତ୍ତରରୁ ଲାଗୁଛି "{0}" ରେ ଗୋଟିଏ ଗୋଳମାଳ ଅଛି — ଅନ୍ୟ ଉପାୟରେ ବୁଝାଉଛି।',
    why_step_back: '"{0}" ଆଗ ବୁଝିଲେ ପରର ପାଠ ସହଜ ହେବ।',
    why_probe: '"{0}" ତୁମେ ଜାଣିଛ କି ନାହିଁ ଦେଖୁଛି।',
    why_review: '"{0}" ଭୁଲିଯିବା ଆଗରୁ ପୁନରାବୃତ୍ତି।',
    why_practice: '"{0}" ଆଉ ଟିକେ ଅଭ୍ୟାସ।',
    why_check: 'ଗୋଟିଏ ଉତ୍ତର ଯଥେଷ୍ଟ ନୁହେଁ — ଆଉ ଗୋଟିଏ ପ୍ରଶ୍ନ।',
    why_other: 'ତୁମ ପାଇଁ ଏହା ଏବେ ସବୁଠାରୁ ଦରକାରୀ।',
    placement_intro: 'ଆରମ୍ଭ ଆଗରୁ କିଛି ଛୋଟ ପ୍ରଶ୍ନ (ପ୍ରାୟ ୩ ମିନିଟ) — ତୁମେ ଯାହା ଜାଣିଛ, ତାହା ପୁଣି ପଢ଼ିବାକୁ ପଡ଼ିବ ନାହିଁ। ନ ଜାଣିଲେ ବି ଚିନ୍ତା ନାହିଁ।',
    placement_known: 'ବହୁତ ଭଲ! ତୁମେ ଆଗରୁ ଜାଣିଛ: {0}। ସେଠୁ ଆଗକୁ ପଢ଼ିବା।',
    placement_fresh: 'ଧନ୍ୟବାଦ! ଆମେ ମୂଳରୁ ଆରମ୍ଭ କରିବା — ଧୀରେ ଧୀରେ।',
    why_place: 'ତୁମେ କେଉଁଠୁ ଆରମ୍ଭ କରିବ ଦେଖୁଛି, ଯେପରି ଜଣାଥିବା କଥା ପୁଣି ପଢ଼ିବାକୁ ନ ପଡ଼େ।',
    snap_retake: 'ଫଟୋଟି ସ୍ପଷ୍ଟ ନୁହେଁ। ଆଲୁଅରେ ରଖ, ଫୋନ୍ ସିଧା ଧର, କେବଳ ସେହି ଧାଡ଼ି ଫଟୋ ନିଅ।',
    snap_pick: 'ତୁମ ବହିର କେଉଁ ଅଂଶ? ଗୋଟିଏ ଛୁଅଁ।',
    why_snap: 'ତୁମେ ଫଟୋ ନେଇଥିବା ବହିର ଅଂଶ ବୁଝାଉଛି।',
    care: 'ତୁମେ ଏକା ନୁହଁ, ତୁମ କଥା ଗୁରୁତ୍ୱପୂର୍ଣ୍ଣ। ଆଜି ହିଁ ଜଣେ ଭରସାଯୋଗ୍ୟ ବଡ଼ଲୋକଙ୍କୁ କୁହ — ମା, ବାପା, ଘରର ଜଣେ ବଡ଼ କିମ୍ବା ତୁମ ଶିକ୍ଷକ। ମାଗଣା ଫୋନ୍: 1098 (ପିଲାଙ୍କ ସହାୟତା), 14416 (ମନର କଥା — Tele-MANAS), ବିପଦରେ 112। ତୁମେ ପ୍ରସ୍ତୁତ ହେଲେ ଆମେ ପୁଣି ପଢ଼ିବା।',
    care_speak: 'ତୁମେ ଏକା ନୁହଁ, ତୁମ କଥା ଗୁରୁତ୍ୱପୂର୍ଣ୍ଣ। ଆଜି ହିଁ ଜଣେ ଭରସାଯୋଗ୍ୟ ବଡ଼ଲୋକଙ୍କୁ କୁହ — ମା, ବାପା, ଘରର ଜଣେ ବଡ଼ କିମ୍ବା ତୁମ ଶିକ୍ଷକ। ମାଗଣା ଫୋନ୍ ନମ୍ବର: ଏକ ଶୂନ ନଅ ଆଠ, ପିଲାଙ୍କ ସହାୟତା ପାଇଁ। ଏକ ଚାରି ଚାରି ଏକ ଛଅ, ମନର କଥା ପାଇଁ। ବିପଦରେ ଏକ ଏକ ଦୁଇ। ତୁମେ ପ୍ରସ୍ତୁତ ହେଲେ ଆମେ ପୁଣି ପଢ଼ିବା।',
    care_teacher: 'ମୁଁ ତୁମ ଶିକ୍ଷକଙ୍କୁ ଚୁପଚାପ୍ ଜଣାଇଛି, ଯେପରି ସେ ତୁମ ସହ କଥା ହୋଇପାରିବେ। ତୁମେ କଣ ଲେଖିଥିଲ, ତାହା ମୁଁ ରଖିନାହିଁ।',
    decline: 'ଏହି ବିଷୟରେ ମୁଁ କଥା ହୋଇପାରିବି ନାହିଁ — ମୁଁ କେବଳ ପାଠରେ ସାହାଯ୍ୟ କରେ। କିଛି କଥା ତୁମକୁ ଚିନ୍ତାରେ ପକାଉଥିଲେ, ଜଣେ ଭରସାଯୋଗ୍ୟ ବଡ଼ଲୋକ କିମ୍ବା ଶିକ୍ଷକଙ୍କୁ କୁହ।',
    redirect: 'ମୁଁ କେବଳ ପାଠ ପଢ଼ିବାରେ ସାହାଯ୍ୟ କରିପାରିବି। ଚାଲ, ପାଠକୁ ଫେରିବା — ଗୋଟିଏ ବାଛ।',
    privacy: 'ଫୋନ୍ ନମ୍ବର, ଠିକଣା କିମ୍ବା ଘର କଥା ଏଠାରେ ଲେଖିବା ଦରକାର ନାହିଁ — ମୁଁ ତାହା ରଖେ ନାହିଁ। ଚାଲ, ପାଠକୁ ଫେରିବା — ଗୋଟିଏ ବାଛ।',
    reground: 'ତୁମେ ନିଶ୍ଚିତ, ଭଲ କଥା — ପ୍ରଶ୍ନ ପଚାରିବା ଠିକ୍। ଚାଲ, ବହି କ’ଣ କହୁଛି ଏକାଠି ଦେଖିବା।',
    reground_after: 'ଏହା ପଢ଼ି ଆଉ ଥରେ ଚେଷ୍ଟା କର।',
    model_answer: 'ଗୋଟିଏ ଭଲ ଉତ୍ତର:',
    data_low: 'ଆଜିର ଡାଟା ପ୍ରାୟ ସରିଗଲା — ଏବେ କେବଳ ଲେଖା, ନୂଆ ଶବ୍ଦ ଡାଉନଲୋଡ୍ ହେବ ନାହିଁ।',
  },
  hi: {
    correct: 'सही! 👏',
    wrong: 'इस बार ठीक नहीं हुआ। चलो, दूसरे तरीके से समझते हैं।',
    step_back: 'पहले "{0}" थोड़ा देख लेते हैं — इससे तुम्हारा सवाल आसान होगा।',
    probe: '"{0}" के बारे में एक छोटा सवाल।',
    review: 'दोहराना: "{0}" याद है?',
    clarify: 'तुम इनमें से किसके बारे में पूछ रहे हो?',
    queued: 'सिग्नल आने पर इसका जवाब दूँगा। तब तक पढ़ते रहते हैं।',
    resume: 'पिछली बार हम यहाँ रुके थे — आगे चलें?',
    escalated: 'मैंने तुम्हारे शिक्षक को "{0}" के बारे में बता दिया है। तब तक कुछ और पढ़ते हैं।',
    close: 'आज बहुत अच्छा किया! कल का पाठ तैयार रखूँगा।',
    why_teach: '"{0}" तुम्हारे लक्ष्य के लिए ज़रूरी है, और तुम इसके लिए तैयार हो।',
    why_remediate: 'तुम्हारे जवाब से लगता है "{0}" में कुछ उलझन है — दूसरे तरीके से समझाता हूँ।',
    why_step_back: 'पहले "{0}" समझ लेने से आगे का हिस्सा आसान होगा।',
    why_probe: 'देख रहा हूँ कि तुम "{0}" पहले से जानते हो या नहीं।',
    why_review: 'भूलने से पहले "{0}" दोहरा रहे हैं।',
    why_practice: '"{0}" पर थोड़ा और अभ्यास।',
    why_check: 'एक जवाब काफ़ी सबूत नहीं — एक और सवाल।',
    why_other: 'अभी तुम्हारे लिए यही सबसे काम का है।',
    placement_intro: 'शुरू करने से पहले कुछ छोटे सवाल (करीब 3 मिनट) — ताकि जो तुम जानते हो उसे फिर न पढ़ना पड़े। न आए तो भी कोई बात नहीं।',
    placement_known: 'शाबाश! तुम पहले से जानते हो: {0}। हम वहाँ से आगे चलेंगे।',
    placement_fresh: 'धन्यवाद! हम शुरुआत से चलेंगे — कदम-दर-कदम।',
    why_place: 'यह पता कर रहा हूँ कि तुम कहाँ से शुरू करो, ताकि जो आता है वह दोहराना न पड़े।',
    snap_retake: 'फ़ोटो साफ़ नहीं है। अच्छी रोशनी में, फ़ोन सीधा रखकर, सिर्फ़ उसी पंक्ति की फ़ोटो लो।',
    snap_pick: 'यह तुम्हारी किताब का कौन सा हिस्सा है? एक को छुओ।',
    why_snap: 'तुम्हारी किताब के जिस हिस्से की फ़ोटो ली, उसे समझा रहा हूँ।',
    care: 'तुम अकेले नहीं हो, और तुम जो महसूस करते हो वह मायने रखता है। आज ही किसी भरोसेमंद बड़े को बताओ — माँ, पिताजी, घर के किसी बड़े, या अपने शिक्षक को। मुफ़्त फ़ोन मदद: 1098 (चाइल्डलाइन), 14416 (टेली-मानस, चिंता और भावनाओं के लिए), आपात स्थिति में 112। जब तुम तैयार हो, हम फिर पढ़ेंगे।',
    care_speak: 'तुम अकेले नहीं हो, और तुम जो महसूस करते हो वह मायने रखता है। आज ही किसी भरोसेमंद बड़े को बताओ — माँ, पिताजी, घर के किसी बड़े, या अपने शिक्षक को। मुफ़्त फ़ोन मदद: एक शून्य नौ आठ, चाइल्डलाइन। एक चार चार एक छह, चिंता और भावनाओं के लिए। आपात स्थिति में एक एक दो। जब तुम तैयार हो, हम फिर पढ़ेंगे।',
    care_teacher: 'मैंने चुपचाप तुम्हारे शिक्षक को बता दिया है, ताकि वे तुमसे बात कर सकें। तुमने जो लिखा वह मैंने नहीं रखा।',
    decline: 'मैं इस बारे में बात नहीं कर सकता — मैं सिर्फ़ पढ़ाई में मदद करता हूँ। अगर कुछ परेशान कर रहा है, तो किसी भरोसेमंद बड़े या अपने शिक्षक को बताओ।',
    redirect: 'मैं सिर्फ़ पढ़ाई में मदद कर सकता हूँ। चलो, पाठ पर लौटते हैं — एक चुनो।',
    privacy: 'यहाँ फ़ोन नंबर, पता या घर की बातें बताने की ज़रूरत नहीं — मैं उन्हें नहीं रखता। चलो, पाठ पर लौटते हैं — एक चुनो।',
    reground: 'तुम्हें पक्का लग रहा है — अच्छी बात, पूछना ठीक है। चलो, साथ में देखते हैं किताब क्या कहती है।',
    reground_after: 'इसे पढ़कर एक बार और कोशिश करो।',
    model_answer: 'एक अच्छा जवाब:',
    data_low: 'आज का डेटा लगभग खत्म — अब सिर्फ़ लिखा हुआ, नई आवाज़ डाउनलोड नहीं होगी।',
  },
  en: {
    correct: 'Correct! 👏',
    wrong: 'Not quite. Let us look at it another way.',
    step_back: 'First let us look at "{0}" — it will make your question easier.',
    probe: 'One quick question about "{0}".',
    review: 'Review: do you remember "{0}"?',
    clarify: 'Which of these are you asking about?',
    queued: 'I will answer this when the signal comes back. Meanwhile, let us keep learning.',
    resume: 'We stopped here last time — continue?',
    escalated: 'I have told your teacher about "{0}". Meanwhile let us study something else.',
    close: 'Great work today! I will have tomorrow\'s lesson ready.',
    why_teach: '"{0}" matters for your goal, and you are ready for it.',
    why_remediate: 'Your answer suggests a mix-up in "{0}" — explaining it another way.',
    why_step_back: 'Understanding "{0}" first will make the next part easier.',
    why_probe: 'Checking whether you already know "{0}".',
    why_review: 'Reviewing "{0}" before you forget it.',
    why_practice: 'A little more practice on "{0}".',
    why_check: 'One answer is not enough proof — one more question.',
    why_other: 'This is the most useful thing for you right now.',
    placement_intro: 'A few short questions before we start (about 3 minutes) — so you never study again what you already know. It is fine not to know.',
    placement_known: 'Well done! You already know: {0}. We will go on from there.',
    placement_fresh: 'Thank you! We will start from the beginning — step by step.',
    why_place: 'Finding where you should start, so you do not repeat what you know.',
    snap_retake: 'The photo is not clear. Use good light, hold the phone straight, and photograph just that line.',
    snap_pick: 'Which part of your book is it? Tap one.',
    why_snap: 'Explaining the part of your book you photographed.',
    care: 'You are not alone, and what you feel matters. Please tell a trusted adult today — your mother, father, an elder at home, or your teacher. Free phone help: 1098 (child helpline), 14416 (Tele-MANAS, for worries and feelings), 112 in an emergency. We can study again when you are ready.',
    care_speak: 'You are not alone, and what you feel matters. Please tell a trusted adult today — your mother, father, an elder at home, or your teacher. Free phone help: one zero nine eight, the child helpline. One four four one six, for worries and feelings. One one two in an emergency. We can study again when you are ready.',
    care_teacher: 'I have quietly let your teacher know, so they can talk with you. I did not keep what you wrote.',
    decline: 'I cannot talk about that — I only help with studies. If something is worrying you, please tell a trusted adult or your teacher.',
    redirect: 'I can only help with your studies. Let us get back to the lesson — pick one.',
    privacy: 'No need to share phone numbers, addresses or family details here — I do not keep them. Let us get back to the lesson — pick one.',
    reground: 'You feel sure — good, asking is right. Let us look at what the textbook says, together.',
    reground_after: 'Read this and try once more.',
    model_answer: 'A good answer:',
    data_low: "Today's data is almost used up — text only from now, no new sound downloads.",
  },
};

const clip = (t: string, n: number) => ([...t].length > n ? [...t].slice(0, n).join('') + '…' : t);

/** Engine lines with no slots in a language — the ones worth pre-recording. */
export function fixedStrings(lang: string): string[] {
  return Object.values(ENGINE_LINES[lang] ?? {}).filter((x) => !/\{\d\}/.test(x));
}

export function T(lang: string, key: string, ...args: string[]): string {
  const t = ENGINE_LINES[lang]?.[key] ?? ENGINE_LINES.en![key] ?? key;
  return args.reduce((acc, a, i) => acc.replace(`{${i}}`, a), t);
}

export function whyLine(d: Decision, lang: string, ctx: EngineCtx): string {
  if (d.action === 'place') return T(lang, 'why_place');
  if (d.action === 'pick_passage') return T(lang, 'why_snap');
  if (d.action === 'place_done' && d.then) return whyLine(d.then, lang, ctx);
  const n = d.conceptId ? textIn(ctx.pack.graph.concepts[d.conceptId]?.name, lang) : '';
  const key = ({ teach: 'why_teach', answer_faq: 'why_teach', remediate: 'why_remediate', step_back: 'why_step_back', probe_prereq: 'why_probe', review: 'why_review', practice: 'why_practice', continue_check: 'why_check' } as Record<string, string>)[d.action] ?? 'why_other';
  return T(lang, key, n);
}

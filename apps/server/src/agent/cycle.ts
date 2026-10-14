// One online decision cycle on Google ADK (PLAN §5.3–§5.8):
//   [grade a written answer] → perceive → decide (LLM call 1) → [one replan] → act ─┬─ generate (LLM call 2) → [judge | revise once] → commit
//                                                                                     └──────────────────────────────────────────────→ commit
// ≤ 2 LLM calls per cycle; one extra (≤ 3) for exactly one of: replan, LLM critic, revise (PLAN §5.4, §5.8).
// The deterministic shell is an ADK graph Workflow; LLM nodes are LlmAgents whose callbacks
// enforce the budget, semantic validation, critic and fallbacks. State comes from the event
// log (sync-before-think); every change is emitted as events — ADK state is only a working copy.

import { randomUUID } from 'node:crypto';
import { BaseLlm, InMemoryRunner, LlmAgent, Workflow, node, type LlmRequest, type LlmResponse, type NodeContext } from '@google/adk';
import {
  apply, fold, observe, decide, execute, buildTrace, policyContext, strategiesFor, concept, textIn, extractNumbers,
  ACTION_COST, pickCheck, preparedExplanation, explainLevel, safetyDecision, guardOutput, blockers, type GradeResult,
  type AnyEvent, type ChapterPack, type Decision, type EngineCtx, type EventDraft, type LearnerState, type OutMsg,
  type PackMatcher, type TraceStep, type TurnInput, type Generated, type Observation,
} from '@setu/core';
import type { Store } from '../db.ts';
import { canCall, type ModelSet } from '../llm.ts';
import { critic } from './critic.ts';
import { decidePrompt, generatePrompt, judgePrompt, gradePrompt, DECIDE_ACTIONS } from './prompts.ts';

export interface CycleDeps {
  store: Store;
  pack: ChapterPack;
  matcher: PackMatcher;
  models: ModelSet;
  /** languages allowed to receive live generated explanations (PLAN §7.5 quality-aware generation) */
  liveGenLangs: Set<string>;
  trustDraft: boolean;
  onTrace?: (profileId: string, step: ServerTrace) => void;
  now?: () => number;
  /** a generation finished after the turn budget (critic-checked, cached if it passed) */
  onLate?: (profileId: string, info: { conceptId?: string; cached: boolean; verdict: string }) => void;
  /** override the per-tier turn budget (tests) */
  budgetMs?: number;
  /** last generated explanation per profile+concept, so the next one uses a different example (prompt hint only) */
  recentGen?: Map<string, string>;
}

export interface TurnRequest {
  profileId: string;
  deviceId: string;
  /** phone clock and its last used seq — server stamps this turn's events on the phone's stream */
  clientNow: number;
  lastSeq: number;
  /** sync cursor (server_seq the phone has seen) */
  cursor: number;
  /** unsynced phone events — applied BEFORE thinking (sync-before-think) */
  outbox: AnyEvent[];
  input: TurnInput;
  tier?: 'cloud' | 'weak';
  /** P4.4: the phone's id for this turn — retries return the same reply, a phone-run copy wins over this one */
  turnId?: string;
}

export interface ServerTrace extends TraceStep {
  latency_ms: number;
  status: 'ok' | 'fallback' | 'failed';
  llm_calls: { job: string; provider?: string; latency_ms: number; outcome: string }[];
  synced_in: number;
}

export interface TurnResponse {
  messages: OutMsg[];
  events: AnyEvent[];
  cursor: number;
  lastSeq: number;
  trace: ServerTrace;
  tier: 'cloud' | 'weak';
}

const MAX_LLM_CALLS = 2;
const FAILED = '__LLM_FAILED__';

/** Never lets a provider error escape into the graph: failure or a spent turn budget becomes a marker the callbacks handle. */
class SafeLlm extends BaseLlm {
  constructor(private readonly inner: BaseLlm, private readonly msLeft: () => number = () => Infinity, private readonly onLate?: (r: LlmResponse) => void) { super({ model: inner.model }); }
  async *generateContentAsync(req: LlmRequest, stream?: boolean, signal?: AbortSignal): AsyncGenerator<LlmResponse, void> {
    const left = this.msLeft();
    if (left < 500) { yield marker('turn time budget spent'); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((r) => { timer = setTimeout(() => r('late'), left); });
    try {
      const it = this.inner.generateContentAsync(req, stream, signal)[Symbol.asyncIterator]();
      let any = false;
      for (;;) {
        const pending = it.next();
        const r = await Promise.race([pending, late]);
        if (r === 'late') {
          if (this.onLate) void finishLate(pending, it, this.onLate);
          yield marker('turn time budget spent');
          return;
        }
        if (r.done) break;
        any = true;
        yield r.value;
      }
      if (!any) yield marker('empty response');
    } catch (e) {
      yield marker(String((e as Error).message ?? e));
    } finally {
      clearTimeout(timer);
    }
  }
  connect(req: LlmRequest) { return this.inner.connect(req); }
}
/** Drains a generation the learner stopped waiting for and hands its final response to `done`. */
async function finishLate(pending: Promise<IteratorResult<LlmResponse>>, it: AsyncIterator<LlmResponse>, done: (r: LlmResponse) => void) {
  try {
    let last: LlmResponse | undefined;
    for (let r = await pending; !r.done; r = await it.next()) last = r.value;
    if (last) done(last);
  } catch { /* the provider failed late; its breaker already recorded it */ }
}
const marker = (why: string): LlmResponse => ({ content: { role: 'model', parts: [{ text: `${FAILED} ${why}` }] }, turnComplete: true });
// thinking models (Gemma 4, Gemini 3.x) may return reasoning parts; only the answer counts
export const textOf = (r: LlmResponse) => (r.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
const respond = (text: string): LlmResponse => ({ content: { role: 'model', parts: [{ text }] }, turnComplete: true });

/** Server turn budget: must answer well before the phone's 12 s timeout, or the phone runs the turn itself too. */
export const TURN_BUDGET_MS = { cloud: 8_000, weak: 5_000 };
/** Events returned with one turn (P4.3 < 30 KB a turn); a phone further behind gets the rest from /api/sync. */
export const TURN_EVENTS_MAX = 40;

export async function runCycle(deps: CycleDeps, req: TurnRequest): Promise<TurnResponse> {
  const t0 = Date.now();
  const budget = deps.budgetMs ?? TURN_BUDGET_MS[req.tier ?? 'cloud'];
  const msLeft = () => budget - (Date.now() - t0);
  const now = deps.now?.() ?? Date.now();
  const { store, pack } = deps;

  // ---- sync-before-think (PLAN §5.6) ----
  const outbox = req.outbox.filter((e) => e.profileId === req.profileId && e.deviceId === req.deviceId);
  const syncedIn = store.append(outbox);

  let s: LearnerState = fold(store.events(req.profileId), pack.graph, req.profileId);
  const s0 = s;
  let seq = Math.max(req.lastSeq, ...outbox.map((e) => e.seq), maxSeq(store.events(req.profileId), req.deviceId));
  let ts = Math.max(req.clientNow, s.lastActiveAt ?? 0);
  const stamped: AnyEvent[] = [];
  const stamp = (d: EventDraft): AnyEvent => {
    const e = { ...d, id: randomUUID(), profileId: req.profileId, deviceId: req.deviceId, seq: ++seq, ts: ++ts, ...(req.turnId ? { turn: { id: req.turnId, by: 'server' as const } } : {}) } as AnyEvent;
    stamped.push(e);
    s = apply(s, e, pack.graph);
    return e;
  };

  const tier = req.tier ?? 'cloud';
  const ctx: EngineCtx = { pack, matcher: deps.matcher, now, tier, trustDraft: deps.trustDraft };
  const lang = s.language.response;
  // only providers allowed to write this language (P0.a) may generate learner-facing text
  const genModel = deps.models.generateFor(lang);

  // working memory for this cycle (the ADK session also gets a copy for its own tracing)
  const turn: {
    obs?: Observation; obsMessages: OutMsg[]; policy?: Decision; decision?: Decision; gen: Generated;
    llmCalls: ServerTrace['llm_calls']; rejected?: string; criticResult?: TraceStep['critic']; fallback?: string;
    exec?: ReturnType<typeof execute>; sources: string[]; allowedNumbers: number[];
    candidate?: { conceptId: string; description: string; evidence: string };
    /** the one extra LLM call this cycle may spend (replan, judge or revise) */
    extra?: 'replan' | 'judge' | 'revise';
    /** P2.8: why the first decision did not fit what was observed */
    replan?: string;
    /** after generate: a draft waiting for the LLM critic or one revision */
    pending?: 'judge' | 'revise';
    draft?: { text: string; speak: string; problems: string[] };
    homework?: boolean;
  } = { obsMessages: [], gen: {}, llmCalls: [], sources: [], allowedNumbers: [] };
  const extraLeft = () => !turn.extra && turn.llmCalls.length < MAX_LLM_CALLS + 1;
  const callCap = () => MAX_LLM_CALLS + (turn.extra ? 1 : 0);

  // ---------------- grade a written answer (P2.42) ----------------
  const textCheck = req.input.type === 'answer' ? pack.checks.find((c) => c.id === (req.input as { checkId: string }).checkId && c.kind === 'text') : undefined;
  const gradeAgent = new LlmAgent({
    name: 'grade',
    model: new SafeLlm(deps.models.decide ?? new NullLlm(), msLeft),
    includeContents: 'none',
    instruction: () => textCheck ? gradePrompt({
      question: textIn(textCheck.stem.display, 'en'), model: textIn(textCheck.model, 'en'),
      keyIdeas: (textCheck.keyIdeas ?? []).map((k) => Object.values(k).join(' / ')), answer: (req.input as { answer: string }).answer,
    }) : 'skip',
    generateContentConfig: { temperature: 0, responseMimeType: 'application/json' },
    beforeModelCallback: () => {
      if (!textCheck || !canCall(deps.models, 'decide')) return respond('{"skip":true}');
      turn.llmCalls.push({ job: 'grade', latency_ms: Date.now(), outcome: 'pending' });
      return undefined;
    },
    afterModelCallback: ({ response }) => {
      const call = turn.llmCalls.find((c) => c.job === 'grade' && c.outcome === 'pending');
      if (!call) return undefined;
      call.latency_ms = Date.now() - call.latency_ms;
      call.provider = deps.models.lastUsed.decide;
      const j = parseJson(textOf(response)) as { correct?: unknown; confidence?: unknown; missing?: unknown } | null;
      if (!j || typeof j.correct !== 'boolean') { call.outcome = 'unparseable → word-match grade'; return undefined; }
      // an LLM grade is never certain: confidence capped at 0.9, so a written answer never weighs like a bank MCQ
      const confidence = Math.min(0.9, Math.max(0.1, Number(j.confidence) || 0.5));
      const missing = Array.isArray(j.missing) ? j.missing.map(String).slice(0, 3) : [];
      const model = textIn(textCheck!.model, lang);
      const g: GradeResult = { correct: j.correct, misconceptionIds: [], confidence, reason: `llm grade (confidence ${confidence}${missing.length ? ', missing: ' + missing.join(', ') : ''})`, ...(j.correct || !model ? {} : { feedback: model }) };
      ctx.preGraded = { [textCheck!.id]: g };
      call.outcome = `graded ${j.correct ? 'right' : 'wrong'} (confidence ${confidence})`;
      return undefined;
    },
  });

  // ---------------- nodes ----------------
  const perceive = node((nctx: NodeContext) => {
    const o = observe(s, req.input, ctx);
    o.events.forEach(stamp);
    turn.obs = o.obs;
    turn.obsMessages = o.messages;
    turn.policy = decide(s, o.obs, ctx, req.input);
    nctx.state.set('temp:policy', `${turn.policy.action}:${turn.policy.conceptId ?? ''}`);
    // what a node returns is handed to the next agent as its user message: say what to do, never a status word
    // (found by the golden recording, P6.6: the decide model read "perceived" as the learner's message)
    return 'Decide the next teaching action for the EVENT described in your instructions. Reply with the JSON only.';
  }, { name: 'perceive' });

  const needsLlmDecision = () => {
    const i = req.input;
    if (turn.policy?.action === 'place' || turn.policy?.action === 'place_done') return false; // placement is a fixed walk, never overridden
    if (turn.policy?.action === 'pick_passage') return false; // unsure photo: she picks — nothing for a model to decide
    // homework → solver-backed hint ladder; insisting on a wrong answer → the textbook: fixed moves, no model needed
    if (turn.policy?.action === 'hint' || turn.policy?.action === 'reground') return false;
    // a written answer already graded by the model: the policy picks the next step, the call is saved for the explanation
    if (turn.llmCalls.some((c) => c.job === 'grade')) return false;
    // distress / unsafe / personal details: fixed caring or redirect replies — what she said is not sent to a model
    if (turn.policy?.action === 'care' || turn.policy?.action === 'decline' || (turn.policy?.action === 'redirect' && turn.obs?.safety === 'personal')) return false;
    if (i.type === 'doubt') return true;
    if (i.type === 'answer') return !turn.obs?.grade?.correct; // a wrong answer needs diagnosis
    return false; // routine steps: policy decides, saves quota
  };

  const decideAgent = new LlmAgent({
    name: 'decide',
    model: new SafeLlm(deps.models.decide ?? new NullLlm(), msLeft),
    includeContents: 'none',
    instruction: () => {
      const pctx = policyContext(s, ctx);
      const strategies = Object.fromEntries(Object.keys(pack.graph.concepts).map((c) => [c, strategiesFor(pack, c)]));
      return decidePrompt({ pack, s, input: req.input, obs: turn.obs!, candidates: turn.policy!.candidates, policyChoice: describe(turn.policy!), strategies, timeLeftMin: pctx.timeLeftMin });
    },
    generateContentConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    beforeModelCallback: () => {
      if (!needsLlmDecision()) { turn.decision = turn.policy; return respond('{"policy":"routine"}'); }
      if (!canCall(deps.models, 'decide')) { turn.decision = turn.policy; turn.fallback = deps.models.decide ? 'all decide providers open' : 'no LLM configured'; return respond('{"policy":"no-llm"}'); }
      if (turn.llmCalls.length >= MAX_LLM_CALLS) { turn.decision = turn.policy; turn.fallback = 'LLM budget'; return respond('{"policy":"budget"}'); }
      turn.llmCalls.push({ job: 'decide', latency_ms: Date.now(), outcome: 'pending' });
      return undefined;
    },
    afterModelCallback: ({ response }) => {
      const call = turn.llmCalls.find((c) => c.job === 'decide' && c.outcome === 'pending');
      if (!call) return undefined;
      call.latency_ms = Date.now() - call.latency_ms;
      call.provider = deps.models.lastUsed.decide;
      const text = textOf(response);
      if (text.startsWith(FAILED)) { call.outcome = text.includes('budget') ? 'too slow (turn budget)' : 'provider failed'; turn.decision = turn.policy; turn.fallback = text.slice(FAILED.length).trim().slice(0, 120); return undefined; }
      const raw = parseJson(text);
      // the model can see distress or an off-topic question the word lists missed (PLAN §6.7: the lists are a floor)
      const intent = (raw as { understood?: { intent?: string } } | null)?.understood?.intent;
      turn.homework = intent === 'homework';
      if (req.input.type === 'doubt' && (intent === 'wellbeing' || (intent === 'off_topic' && turn.obs?.unmatched))) {
        const d = safetyDecision(intent === 'wellbeing' ? 'distress' : 'off_topic', turn.policy!.candidates, 'llm');
        if (d) { call.outcome = `override: ${intent}`; turn.decision = { ...d, reason: `LLM read the question as ${intent} → ${d.reason}` }; return undefined; }
      }
      // a novel wrong belief is logged for the teacher whatever happens to the decision itself (P2.41, PLAN §6.5)
      const cand = candidateFrom(raw, s, ctx, req.input, turn.obs!);
      if (cand) { stamp({ type: 'MISCONCEPTION_CANDIDATE', payload: cand }); turn.candidate = cand; }
      const v = validateDecision(raw, turn.policy!, s, ctx);
      if ('error' in v) { call.outcome = `rejected: ${v.error}`; turn.rejected = v.error; turn.decision = turn.policy; return undefined; }
      // the safety screen called it off-topic: a model may only overrule that when her words point at the concept it
      // wants to teach (a matcher hit, however weak) — "who will win the IPL" never becomes a lesson (P6.8 red-team)
      const offTopic = turn.policy!.action === 'redirect' || turn.policy!.action === 'pick_passage';
      if (offTopic && v.decision.action !== turn.policy!.action && !(turn.obs?.match?.hits ?? []).some((h) => h.conceptId === v.decision.conceptId)) {
        const why = `"${v.decision.action} ${v.decision.conceptId ?? ''}" overrules ${turn.policy!.action}, but nothing in what she asked points to ${v.decision.conceptId ?? 'it'}`;
        call.outcome = `rejected: ${why}`; turn.rejected = why; turn.decision = turn.policy; return undefined;
      }
      call.outcome = v.decision.override ? 'override' : 'agreed';
      turn.decision = v.decision;
      return undefined;
    },
  });

  // ---------------- one replan when the observation contradicts the decision (P2.8, PLAN §5.4) ----------------
  const contradiction = (): string | undefined => {
    const d = turn.decision;
    if (!d || d.decidedBy !== 'llm' || !d.conceptId || !['teach', 'remediate', 'answer_faq'].includes(d.action)) return undefined;
    const b = blockers(s, pack.graph, d.conceptId);
    if (b.stepBack[0]) return `prerequisite "${b.stepBack[0]}" of ${d.conceptId} is weak (p=${concept(s, b.stepBack[0]).pKnown.toFixed(2)})`;
    if (!sourcesFor(deps, d.conceptId, lang).length) return `nothing in the textbook pack grounds "${d.conceptId}" (retrieval empty)`;
    return undefined;
  };
  const replanAgent = new LlmAgent({
    name: 'replan',
    model: new SafeLlm(deps.models.decide ?? new NullLlm(), msLeft),
    includeContents: 'none',
    instruction: () => {
      const why = contradiction();
      if (!why) return 'skip';
      const pctx = policyContext(s, ctx);
      const strategies = Object.fromEntries(Object.keys(pack.graph.concepts).map((c) => [c, strategiesFor(pack, c)]));
      return `${decidePrompt({ pack, s, input: req.input, obs: turn.obs!, candidates: turn.policy!.candidates, policyChoice: describe(turn.policy!), strategies, timeLeftMin: pctx.timeLeftMin })}

OBSERVATION after the first choice (${describe(turn.decision!)}): ${why}. That contradicts the plan. Choose again (this is the one replan).`;
    },
    generateContentConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    beforeModelCallback: () => {
      const why = contradiction();
      if (!why) return respond('{"skip":true}');
      turn.replan = why;
      if (!extraLeft() || !canCall(deps.models, 'decide')) {
        // no model to ask again: the policy already accounts for the weak prerequisite / missing content
        turn.decision = { ...turn.policy!, reason: `replan without a model — ${why} → ${turn.policy!.reason}` };
        return respond('{"policy":"replan"}');
      }
      turn.extra = 'replan';
      turn.llmCalls.push({ job: 'replan', latency_ms: Date.now(), outcome: 'pending' });
      return undefined;
    },
    afterModelCallback: ({ response }) => {
      const call = turn.llmCalls.find((c) => c.job === 'replan' && c.outcome === 'pending');
      if (!call) return undefined;
      call.latency_ms = Date.now() - call.latency_ms;
      call.provider = deps.models.lastUsed.decide;
      const text = textOf(response);
      const v = text.startsWith(FAILED) ? { error: 'provider failed' } : validateDecision(parseJson(text), turn.policy!, s, ctx);
      const first = describe(turn.decision!);
      if ('error' in v) { call.outcome = `rejected: ${v.error} → policy`; turn.decision = { ...turn.policy!, reason: `replan (${turn.replan}) → model's second choice invalid → ${turn.policy!.reason}` }; return undefined; }
      turn.decision = v.decision;
      const still = contradiction();
      if (still) { call.outcome = `still contradicts (${still}) → policy`; turn.decision = { ...turn.policy!, reason: `replan (${turn.replan}) → ${turn.policy!.reason}` }; return undefined; }
      call.outcome = 'replanned';
      turn.decision = { ...v.decision, reason: `replan: first choice ${first}, but ${turn.replan} → ${v.decision.reason}` };
      return undefined;
    },
  });

  const act = node((nctx: NodeContext) => {
    const d = (turn.decision ??= turn.policy!);
    const explains = ['teach', 'remediate', 'step_back', 'answer_faq'].includes(d.action) && !!d.conceptId;
    const live = explains && deps.liveGenLangs.has(lang) && !!genModel && canCall(deps.models, 'generate', deps.models.genKeysFor(lang)) && turn.llmCalls.length < callCap();
    if (explains) {
      // grounding sources (PLAN §6.6): textbook passages + reviewed pack explanations + glossary
      turn.sources = sourcesFor(deps, d.conceptId!, lang, req.input.type === 'doubt' ? req.input.text : undefined);
      turn.allowedNumbers = turn.sources.flatMap(extractNumbers);
      // cache (PLAN §5.8): (concept, strategy, level, language, pack version[, doubt])
      const key = cacheKey(d, explainLevel(s), lang, pack, req.input);
      const hit = store.cacheGet(key);
      if (hit) { turn.gen = { explanation: JSON.parse(hit), tool: 'cache' }; nctx.route = 'commit'; return 'cached'; }
      // written and critic-checked after her last session (between-session run)
      const prepared = preparedExplanation(s, d, lang);
      if (prepared) { turn.gen = prepared; nctx.route = 'commit'; return 'prepared'; }
    }
    nctx.route = live ? 'generate' : 'commit';
    if (explains && !live) turn.fallback ??= deps.liveGenLangs.has(lang) ? 'generation unavailable → reviewed pack content' : `live generation off for ${lang} → reviewed pack content`;
    return live ? 'Write the explanation described in your instructions now. Reply with the JSON only.' : d.action;
  }, { name: 'act' });

  // critic + cache, shared by on-time and late generations
  const vet = (text: string) => {
    const j = parseJson(text) as { text?: string; speak?: string; cites?: unknown } | null;
    if (!j?.text) return {};
    const d = turn.decision!;
    const nextCheck = pickCheck(pack, s, d.conceptId!, { lang, trustDraft: deps.trustDraft });
    const answerKey = nextCheck?.options?.filter((o) => o.correct).map((o) => textIn(o.text, lang)) ?? [];
    const verdict = critic({ text: j.text, lang, readingLevel: explainLevel(s), allowedNumbers: turn.allowedNumbers, answerKey, pack, conceptId: d.conceptId, sources: turn.sources, cites: j.cites ?? [] });
    // the solver may have corrected a number in the text; the spoken line is then rebuilt from the text
    const speak = verdict.text !== j.text.trim() ? verdict.text : j.speak ?? j.text;
    return { explanation: { text: verdict.text, speak }, verdict };
  };
  const keep = (ex: { text: string; speak: string }) => {
    const d = turn.decision!;
    deps.recentGen?.set(`${req.profileId}:${d.conceptId}`, ex.text);
    if (deps.recentGen && deps.recentGen.size > 500) deps.recentGen.delete(deps.recentGen.keys().next().value!);
    store.cacheSet(cacheKey(d, explainLevel(s), lang, pack, req.input), JSON.stringify(ex));
  };
  // a generation that misses the turn budget is not wasted: if the critic passes it, the next learner/turn gets it from cache
  const onLate = (text: string) => {
    const v = vet(text);
    const ok = v.verdict?.verdict === 'pass';
    if (ok) keep(v.explanation!);
    deps.onLate?.(req.profileId, { conceptId: turn.decision?.conceptId, cached: ok, verdict: v.verdict?.verdict ?? 'unparseable' });
  };

  const generateAgent = new LlmAgent({
    name: 'generate',
    model: new SafeLlm(genModel ?? new NullLlm(), msLeft, (r) => onLate(textOf(r))),
    includeContents: 'none',
    instruction: () => {
      const d = turn.decision!;
      const terms = pack.glossary.filter((g) => g.conceptId === d.conceptId).map((g) => `${textIn(g.term, lang)} (${g.english})`).join(', ') || 'term (English term)';
      return generatePrompt({
        pack, lang, level: explainLevel(s), conceptId: d.conceptId!, strategy: d.strategy ?? 'definition', misconceptionId: d.misconceptionId,
        doubt: req.input.type === 'doubt' ? req.input.text : undefined, sources: turn.sources, terms,
        previous: deps.recentGen?.get(`${req.profileId}:${d.conceptId}`), homework: turn.homework, region: s.region,
      });
    },
    generateContentConfig: { temperature: 0.4, responseMimeType: 'application/json' },
    beforeModelCallback: () => {
      turn.llmCalls.push({ job: 'generate', latency_ms: Date.now(), outcome: 'pending' });
      return undefined;
    },
    afterModelCallback: ({ response }) => {
      const call = turn.llmCalls.find((c) => c.job === 'generate' && c.outcome === 'pending')!;
      call.latency_ms = Date.now() - call.latency_ms;
      call.provider = deps.models.lastUsed.generate;
      const text = textOf(response);
      if (text.startsWith(FAILED)) { const why = text.slice(FAILED.length).trim(); call.outcome = why.includes('budget') ? 'too slow (turn budget)' : 'provider failed'; turn.fallback = `generate ${why.includes('budget') ? 'too slow' : 'failed'} → reviewed pack content`; return undefined; }
      const v = vet(text);
      if (!v.explanation) { call.outcome = 'bad output'; turn.fallback = 'unparseable generation → pack content'; return undefined; }
      turn.criticResult = { checks: [...v.verdict!.checks, ...v.verdict!.problems.map((p) => `✗ ${p}`)], verdict: v.verdict!.verdict };
      if (v.verdict!.verdict === 'pass') {
        call.outcome = 'approved';
        turn.gen = { explanation: v.explanation };
        keep(v.explanation);
      } else {
        call.outcome = `critic ${v.verdict!.verdict}: ${v.verdict!.problems.join('; ')}`;
        turn.fallback = `critic ${v.verdict!.verdict} → reviewed pack content`;
        const unsafe = v.verdict!.problems.includes('unsafe content');
        turn.draft = { ...v.explanation, problems: v.verdict!.problems };
        // unsure rule → LLM critic (P2.11); a sure problem → revise once (P2.12); unsafe → straight to reviewed content
        if (!unsafe && extraLeft() && v.verdict!.borderline && canCall(deps.models, 'decide')) turn.pending = 'judge';
        else if (!unsafe && extraLeft() && canCall(deps.models, 'generate', deps.models.genKeysFor(lang))) turn.pending = 'revise';
      }
      return undefined;
    },
  });

  const judgeAgent = new LlmAgent({
    name: 'judge',
    model: new SafeLlm(deps.models.decide ?? new NullLlm(), msLeft),
    includeContents: 'none',
    instruction: () => turn.pending === 'judge' ? judgePrompt({ pack, lang, level: explainLevel(s), conceptId: turn.decision!.conceptId!, text: turn.draft!.text, sources: turn.sources, doubts: turn.draft!.problems }) : 'skip',
    generateContentConfig: { temperature: 0, responseMimeType: 'application/json' },
    beforeModelCallback: () => {
      if (turn.pending !== 'judge') return respond('{"skip":true}');
      turn.extra = 'judge';
      turn.llmCalls.push({ job: 'judge', latency_ms: Date.now(), outcome: 'pending' });
      return undefined;
    },
    afterModelCallback: ({ response }) => {
      const call = turn.llmCalls.find((c) => c.job === 'judge' && c.outcome === 'pending');
      if (!call) return undefined;
      call.latency_ms = Date.now() - call.latency_ms;
      call.provider = deps.models.lastUsed.decide;
      turn.pending = undefined;
      const j = parseJson(textOf(response)) as { ok?: unknown; problems?: unknown } | null;
      const problems = Array.isArray(j?.problems) ? j!.problems.map(String).slice(0, 3) : [];
      if (j?.ok === true) {
        call.outcome = 'LLM critic: ok';
        const ex = { text: turn.draft!.text, speak: turn.draft!.speak };
        turn.gen = { explanation: ex };
        keep(ex);
        turn.criticResult = { checks: [...(turn.criticResult?.checks ?? []), `LLM critic (rule was unsure): ok`], verdict: 'pass' };
        turn.fallback = undefined;
      } else {
        call.outcome = `LLM critic: not ok${problems.length ? ' — ' + problems.join('; ') : ''}`;
        turn.criticResult = { checks: [...(turn.criticResult?.checks ?? []), `✗ LLM critic: ${problems.join('; ') || 'not ok'}`], verdict: 'reject' };
      }
      return undefined;
    },
  });

  const reviseAgent = new LlmAgent({
    name: 'revise',
    model: new SafeLlm(genModel ?? new NullLlm(), msLeft),
    includeContents: 'none',
    instruction: () => {
      if (turn.pending !== 'revise') return 'skip';
      const d = turn.decision!;
      const terms = pack.glossary.filter((g) => g.conceptId === d.conceptId).map((g) => `${textIn(g.term, lang)} (${g.english})`).join(', ') || 'term (English term)';
      return generatePrompt({
        pack, lang, level: explainLevel(s), conceptId: d.conceptId!, strategy: d.strategy ?? 'definition', misconceptionId: d.misconceptionId,
        doubt: req.input.type === 'doubt' ? req.input.text : undefined, sources: turn.sources, terms, homework: turn.homework, region: s.region,
        fix: { draft: turn.draft!.text, problems: turn.draft!.problems },
      });
    },
    generateContentConfig: { temperature: 0.3, responseMimeType: 'application/json' },
    beforeModelCallback: () => {
      if (turn.pending !== 'revise') return respond('{"skip":true}');
      turn.extra = 'revise';
      turn.llmCalls.push({ job: 'revise', latency_ms: Date.now(), outcome: 'pending' });
      return undefined;
    },
    afterModelCallback: ({ response }) => {
      const call = turn.llmCalls.find((c) => c.job === 'revise' && c.outcome === 'pending');
      if (!call) return undefined;
      call.latency_ms = Date.now() - call.latency_ms;
      call.provider = deps.models.lastUsed.generate;
      turn.pending = undefined;
      const text = textOf(response);
      if (text.startsWith(FAILED)) { call.outcome = 'provider failed'; turn.fallback = 'revision failed → reviewed pack content'; return undefined; }
      const v = vet(text);
      if (!v.explanation) { call.outcome = 'bad output'; turn.fallback = 'revision unparseable → reviewed pack content'; return undefined; }
      turn.criticResult = { checks: [...(turn.criticResult?.checks ?? []), '— after one revision —', ...v.verdict!.checks, ...v.verdict!.problems.map((p) => `✗ ${p}`)], verdict: v.verdict!.verdict };
      if (v.verdict!.verdict === 'pass') {
        call.outcome = 'approved after revision';
        turn.gen = { explanation: v.explanation };
        keep(v.explanation);
        turn.fallback = undefined;
      } else {
        call.outcome = `critic ${v.verdict!.verdict} again: ${v.verdict!.problems.join('; ')}`;
        turn.fallback = `critic ${v.verdict!.verdict} after one revision → reviewed pack content`;
      }
      return undefined;
    },
  });

  const commit = node(() => {
    const d = turn.decision ?? turn.policy!;
    turn.exec = execute(s, d, ctx, turn.gen);
    turn.exec.events.forEach(stamp);
    if (d.action === 'queue' && req.input.type === 'doubt') {
      stamp({ type: 'DOUBT_QUEUED', payload: { doubtId: req.input.doubtId, text: req.input.text, reason: 'unmatched' } });
    }
    return 'committed';
  }, { name: 'commit' });

  const wf = new Workflow({
    name: 'setu_cycle',
    edges: [
      ['START', gradeAgent, perceive, decideAgent, replanAgent, act],
      [act, { generate: generateAgent, commit }],
      [generateAgent, judgeAgent, reviseAgent, commit],
    ],
  });

  const runner = new InMemoryRunner({ agent: wf, appName: 'setu' });
  const session = await runner.sessionService.createSession({
    appName: 'setu', userId: req.profileId,
    state: { language: lang, readingLevel: s.language.readingLevel, tier },
  });
  let status: ServerTrace['status'] = 'ok';
  try {
    for await (const _e of runner.runAsync({ userId: req.profileId, sessionId: session.id, newMessage: { role: 'user', parts: [{ text: req.input.type }] } })) { /* events drive the graph */ }
  } catch (e) {
    status = 'failed';
    turn.fallback = `cycle error: ${String((e as Error).message).slice(0, 120)} → device policy`;
  }

  // Guarantee a result even if the graph broke mid-way: finish deterministically.
  if (!turn.obs) { const o = observe(s, req.input, ctx); o.events.forEach(stamp); turn.obs = o.obs; turn.obsMessages = o.messages; }
  if (!turn.exec) {
    const d = (turn.decision ??= decide(s, turn.obs, ctx, req.input));
    turn.exec = execute(s, d, ctx, {});
    turn.exec.events.forEach(stamp);
    status = 'fallback';
  }

  // output safety check on every message (P5.17)
  const guarded = guardOutput([...turn.obsMessages, ...turn.exec!.messages], lang);
  store.append(stamped);
  const decision = turn.decision ?? turn.policy!;
  const base = buildTrace(s0, s, req.input, turn.obs!, decision, turn.exec!.tools, ctx);
  if (turn.gen.explanation && !turn.gen.tool) base.tools = base.tools.map((t) => (t.tool === 'teach' ? { ...t, args: { ...(t.args as object), source: 'llm (critic-approved)' } } : t));
  if (turn.gen.tool === 'cache') base.tools = base.tools.map((t) => (t.tool === 'teach' ? { ...t, args: { ...(t.args as object), source: 'cache' } } : t));
  const trace: ServerTrace = {
    ...base,
    facts_used: [...base.facts_used, ...(turn.candidate ? [`LLM proposed a new misconception for teacher review (${turn.candidate.conceptId}): ${turn.candidate.description}`] : []), ...(turn.rejected ? [`LLM decision rejected: ${turn.rejected}`] : []), ...(turn.replan ? [`replan: ${turn.replan}`] : []), ...(syncedIn ? [`synced ${syncedIn} offline events before deciding`] : [])],
    fallback_used: turn.fallback,
    safety: { checked: guarded.checked, blocked: guarded.blocked, ...(turn.obs?.safety ? { input: turn.obs.safety } : {}) },
    critic: turn.criticResult ?? { checks: [], verdict: 'n/a' },
    latency_ms: Date.now() - t0,
    status: status === 'ok' && turn.fallback ? 'fallback' : status,
    llm_calls: turn.llmCalls,
    synced_in: syncedIn,
  };
  store.addTrace(req.profileId, trace);
  deps.onTrace?.(req.profileId, trace);

  const delta = store.since(req.profileId, req.cursor, TURN_EVENTS_MAX);
  return { messages: guarded.messages, events: delta.events, cursor: delta.cursor, lastSeq: seq, trace, tier };
}

// ---------------- helpers ----------------

/** Grounding sources (PLAN §6.6): textbook passages + reviewed pack explanations + glossary. */
export function sourcesFor(deps: Pick<CycleDeps, 'pack' | 'matcher'>, cid: string, lang: string, doubt?: string): string[] {
  const { pack } = deps;
  const ps = deps.matcher.passages(cid, doubt);
  return [
    ...ps.map((p) => textIn(p.text, lang)),
    ...ps.map((p) => textIn(p.text, 'en')),
    ...pack.explanations.filter((e) => e.conceptId === cid).slice(0, 4).map((e) => textIn(e.body.display, lang)),
    ...pack.glossary.filter((g) => g.conceptId === cid).map((g) => `${textIn(g.term, lang)} = ${g.english} = ${textIn(g.everyday, lang)}`),
  ].filter(Boolean);
}

class NullLlm extends BaseLlm {
  constructor() { super({ model: 'none' }); }
  async *generateContentAsync(): AsyncGenerator<LlmResponse, void> { throw new Error('no model configured'); }
  async connect(): Promise<never> { throw new Error('no model'); }
}

function maxSeq(events: AnyEvent[], deviceId: string) {
  return events.filter((e) => e.deviceId === deviceId).reduce((m, e) => Math.max(m, e.seq), 0);
}

export function parseJson(text: string): unknown {
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { const m = t.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { /* fallthrough */ } } return null; }
}

const describe = (d: Decision) => `${d.action}${d.conceptId ? ' ' + d.conceptId : ''}${d.strategy ? ' (' + d.strategy + ')' : ''} — ${d.reason}`;

export function cacheKey(d: Pick<Decision, 'conceptId' | 'strategy' | 'misconceptionId'>, level: number, lang: string, pack: ChapterPack, input: TurnInput) {
  const doubt = input.type === 'doubt' ? input.text.toLowerCase().replace(/\s+/g, ' ').trim() : '';
  return JSON.stringify([d.conceptId, d.strategy, d.misconceptionId ?? null, level, lang, `${pack.id}@${pack.version}`, doubt]);
}

/** Most candidates one learner can add per concept — a chatty model must not flood the teacher. */
export const MAX_CANDIDATES_PER_CONCEPT = 3;

/**
 * An LLM-proposed novel misconception (PLAN §6.5): only after a wrong answer or a doubt, never when the answer
 * already signalled a known one, on a concept in the graph, short plain text, not a repeat. Never changes
 * teaching — it is a candidate for teacher review only.
 */
export function candidateFrom(raw: unknown, s: LearnerState, ctx: EngineCtx, input: TurnInput, obs: Observation): { conceptId: string; description: string; evidence: string } | null {
  const nm = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).new_misconception : null;
  if (!nm || typeof nm !== 'object') return null;
  const wrong = input.type === 'answer' && obs.grade && !obs.grade.correct && !obs.grade.misconceptionIds.length;
  if (!wrong && input.type !== 'doubt') return null;
  const r = nm as Record<string, unknown>;
  const clean = (x: unknown, max: number) => String(x ?? '').replace(/[<>{}`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  const conceptId = String(r.concept_id ?? (input.type === 'answer' ? obs.grade?.conceptId : '') ?? '');
  const description = clean(r.description, 200);
  const evidence = clean(r.evidence, 200);
  if (!ctx.pack.graph.concepts[conceptId] || description.length < 12 || !evidence || description === 'null') return null;
  const mine = s.misconceptionCandidates.filter((m) => m.conceptId === conceptId);
  if (mine.length >= MAX_CANDIDATES_PER_CONCEPT) return null;
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (mine.some((m) => norm(m.description) === norm(description))) return null;
  // already a known one in other words? (pack descriptions, English) — crude word overlap guard
  const words = (t: string) => new Set(norm(t).split(' ').filter((w) => w.length > 3));
  const d = words(description);
  const known = ctx.pack.misconceptions.filter((m) => m.conceptId === conceptId).some((m) => {
    const k = words(textIn(m.description, 'en'));
    const both = [...d].filter((w) => k.has(w)).length;
    return both / Math.max(1, Math.min(d.size, k.size)) >= 0.8;
  });
  if (known) return null;
  return { conceptId, description, evidence };
}

/** Semantic validation of the LLM's decision (PLAN §5.5). Invalid → policy decision is used. */
export function validateDecision(raw: unknown, policy: Decision, s: LearnerState, ctx: EngineCtx): { decision: Decision } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not JSON' };
  const r = raw as Record<string, unknown>;
  const action = String(r.action ?? '');
  const cid = r.concept_id ? String(r.concept_id) : undefined;
  if (!(DECIDE_ACTIONS as readonly string[]).includes(action)) return { error: `unknown action "${action}"` };
  if (action !== 'clarify' && (!cid || !ctx.pack.graph.concepts[cid])) return { error: `concept "${cid}" not in graph` };
  const strategies = cid ? strategiesFor(ctx.pack, cid) : [];
  let strategy = r.strategy ? String(r.strategy) : undefined;
  if (['teach', 'remediate', 'step_back'].includes(action)) {
    if (!strategy || !strategies.includes(strategy)) strategy = undefined;
    const last = cid ? concept(s, cid).lastStrategy : undefined;
    if (strategy && last && strategy === last && ['remediate', 'teach'].includes(action) && ctx.pack && policy.action !== 'teach') return { error: `reuses failed strategy "${strategy}"` };
    strategy ??= policy.conceptId === cid ? policy.strategy : strategies.find((x) => x !== last);
  }
  let faqId = r.faq_id ? String(r.faq_id) : undefined;
  let finalAction = action as Decision['action'];
  if (finalAction === 'answer_faq' && !ctx.pack.faq.some((f) => f.id === faqId)) { finalAction = 'teach'; faqId = undefined; strategy ??= strategies[0]; }
  const misconceptionId = r.misconception_id && ctx.pack.misconceptions.some((m) => m.id === r.misconception_id) ? String(r.misconception_id) : undefined;
  // remediating a misconception the pack does not know (e.g. one it just proposed) = reteach with a fresh strategy
  if (finalAction === 'remediate' && !misconceptionId) {
    finalAction = 'teach';
    const last = cid ? concept(s, cid).lastStrategy : undefined;
    if (!strategy || strategy === last) strategy = strategies.find((x) => x !== last) ?? strategy;
  }

  // affordable in time
  const pctx = policyContext(s, ctx);
  const costKey = (['teach', 'remediate', 'step_back', 'probe_prereq', 'review', 'practice'] as const).find((k) => k === finalAction) ?? 'practice';
  if (ACTION_COST[costKey].min > pctx.timeLeftMin + 0.5) return { error: `not affordable: needs ${ACTION_COST[costKey].min} min, ${pctx.timeLeftMin.toFixed(0)} left` };

  // teaching the same concept the FAQ covers is the same decision, not an override
  const same = cid === policy.conceptId && (finalAction === policy.action || (policy.action === 'answer_faq' && finalAction === 'teach'));
  const overrideReason = r.override_reason && String(r.override_reason) !== 'null' ? String(r.override_reason) : '';
  if (!same && !overrideReason && policy.action !== 'clarify') return { error: `override without a stated reason (chose ${finalAction} ${cid ?? ''}, policy ${policy.action} ${policy.conceptId ?? ''})` };
  return {
    decision: {
      action: finalAction, conceptId: cid, strategy, misconceptionId, faqId,
      reason: same ? `${String(r.reason ?? policy.reason)} (agrees with policy)` : `${String(r.reason ?? '')} — override: ${overrideReason || 'policy had no grounded choice'}`,
      decidedBy: 'llm', override: !same, candidates: policy.candidates,
    },
  };
}

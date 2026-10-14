// The agent between sessions (PLAN §5.2 "AFTER she stops", §5.1 SESSION_ENDED / SYNC_COMPLETED / SCHEDULE_TICK):
//   review today's evidence → answer queued offline doubts → escalate what needs a human + draft a reteach →
//   plan the next session and pre-write its explanations (critic-checked) so they are instant, even offline.
// Everything it does is written as events on the server's own stream; the phone gets them at its next sync.

import { randomUUID } from 'node:crypto';
import type { LlmRequest } from '@google/adk';
import {
  apply, fold, prepareSession, shouldEscalate, concept, textIn, speakIn, pickExplanation, pickCheck, stateDiff, strategiesFor,
  extractNumbers, DAY, SERVER_DEVICE, screen, T,
  type AnyEvent, type EngineCtx, type EventDraft, type LearnerState, type TraceStep, type SessionPlan,
} from '@setu/core';
import { canCall } from '../llm.ts';
import { critic } from './critic.ts';
import { generatePrompt, doubtAnswerPrompt } from './prompts.ts';
import { cacheKey, parseJson, sourcesFor, textOf, type CycleDeps, type ServerTrace } from './cycle.ts';

/** A session with no learner activity for this long is treated as ended (PLAN §5.1 "inferred"). */
export const INACTIVITY_MIN = 30;
/** No activity for this many days → drop-off: teacher is told (PLAN §5.1 SCHEDULE_TICK). */
export const DROPOFF_DAYS = 3;
/** Pre-written explanations per prepared session, and their size cap (they ride in PLAN_SET to the phone). */
const PREGEN_MAX = 3;
const PREGEN_KB = 30;
const EXPLAINS = new Set(['teach', 'remediate', 'step_back']);

export type BetweenTrigger = 'session_end' | 'sync' | 'inactivity' | 'tick';
export interface BetweenResult { events: AnyEvent[]; plan?: SessionPlan; trace: ServerTrace }

const running = new Set<string>();

export async function betweenSessions(deps: CycleDeps, profileId: string, trigger: BetweenTrigger): Promise<BetweenResult | undefined> {
  if (running.has(profileId)) return undefined; // one run per learner at a time
  running.add(profileId);
  try {
    return await run(deps, profileId, trigger);
  } finally {
    running.delete(profileId);
  }
}

async function run(deps: CycleDeps, profileId: string, trigger: BetweenTrigger): Promise<BetweenResult> {
  const t0 = Date.now();
  const now = deps.now?.() ?? Date.now();
  const { store, pack } = deps;
  const all = store.events(profileId);
  let s = fold(all, pack.graph, profileId);
  const s0 = s;
  const lang = s.language.response;
  const level = s.language.readingLevel;
  const ctx: EngineCtx = { pack, matcher: deps.matcher, now, tier: 'cloud', trustDraft: deps.trustDraft };
  const out = writer(profileId, all, now, (e) => { s = apply(s, e, pack.graph); });
  const facts: string[] = [];
  const tools: TraceStep['tools'] = [];
  const llmCalls: ServerTrace['llm_calls'] = [];
  const model = deps.models.generateFor(lang);
  const canWrite = () => !!model && canCall(deps.models, 'generate', deps.models.genKeysFor(lang)) && deps.liveGenLangs.has(lang);

  /** one direct generation call (no learner is waiting, so the provider timeouts apply, not the turn budget) */
  const write = async (job: string, prompt: string): Promise<{ text: string; speak: string; cites?: unknown } | undefined> => {
    if (!canWrite()) return undefined;
    const t = Date.now();
    const call: ServerTrace['llm_calls'][number] = { job, latency_ms: 0, outcome: 'pending' };
    llmCalls.push(call);
    try {
      const req = { contents: [{ role: 'user', parts: [{ text: 'Write it now.' }] }], config: { systemInstruction: prompt, temperature: 0.4, responseMimeType: 'application/json' }, liveConnectConfig: {}, toolsDict: {} } as unknown as LlmRequest;
      let last;
      for await (const r of model!.generateContentAsync(req)) last = r;
      call.provider = deps.models.lastUsed.generate;
      const j = parseJson(last ? textOf(last) : '') as { text?: string; speak?: string; cites?: unknown } | null;
      call.latency_ms = Date.now() - t;
      if (!j?.text) { call.outcome = 'empty / unparseable'; return undefined; }
      return { text: j.text, speak: j.speak ?? j.text, cites: j.cites };
    } catch (e) {
      call.latency_ms = Date.now() - t;
      call.outcome = `provider failed: ${String((e as Error).message).slice(0, 80)}`;
      return undefined;
    }
  };

  // 1. review today's evidence
  const lastOpen = [...all].reverse().find((e) => e.type === 'SESSION_OPENED' && e.deviceId !== SERVER_DEVICE);
  const since = lastOpen?.ts ?? now - DAY;
  const graded = all.filter((e): e is Extract<AnyEvent, { type: 'ANSWER_GRADED' }> => e.type === 'ANSWER_GRADED' && e.ts >= since);
  const byConcept = new Map<string, { right: number; n: number }>();
  for (const g of graded) {
    const x = byConcept.get(g.payload.conceptId) ?? { right: 0, n: 0 };
    x.n++; if (g.payload.correct) x.right++;
    byConcept.set(g.payload.conceptId, x);
  }
  facts.push(`trigger: ${trigger}; evidence since last open: ${graded.length} answers` + (byConcept.size ? ` (${[...byConcept].map(([c, x]) => `${c} ${x.right}/${x.n}`).join(', ')})` : ''));
  for (const [cid] of byConcept) {
    const c = concept(s, cid);
    facts.push(`${cid}: p=${c.pKnown.toFixed(2)}${c.mastered ? ' mastered' : ''}${c.nextReviewAt ? `, review due ${new Date(c.nextReviewAt).toISOString().slice(0, 10)}` : ''}`);
  }
  tools.push({ tool: 'review_evidence', args: { answers: graded.length, concepts: byConcept.size }, status: 'ok' });

  // 2. answer doubts she queued offline (a promise the agent made, PLAN §8.2)
  // photos and voice recordings stay on the phone and are read when it is online again — nothing to answer from here
  for (const d of s.queuedDoubts.filter((q) => !q.answered && !q.photo && !q.voice)) {
    const m = deps.matcher.match(d.text);
    // the same child-safety screen as a live question (P5.13–P5.16): distress → teacher; otherwise a kind fixed reply
    const kind = screen(d.text, !m.conceptId || (m.confidence < 0.15 && !m.faqId));
    if (kind !== 'ok') {
      if (kind === 'distress') {
        out.add({ type: 'ESCALATED', payload: { kind: 'wellbeing', reason: 'a queued question needs a caring adult, not the tutor' } });
        tools.push({ tool: 'notify_teacher', args: { doubtId: d.doubtId, kind: 'wellbeing' }, status: 'ok' });
      }
      const reply = T(lang, ({ distress: 'care', unsafe: 'decline', personal: 'privacy', off_topic: 'redirect' } as const)[kind]);
      out.add({ type: 'DOUBT_ANSWERED', payload: { doubtId: d.doubtId, answer: reply } });
      if (s.commitments.some((c) => c.id === `answer:${d.doubtId}` && !c.kept)) out.add({ type: 'COMMITMENT_KEPT', payload: { commitmentId: `answer:${d.doubtId}` } });
      tools.push({ tool: 'safety', args: { doubtId: d.doubtId, input: kind }, status: 'ok', note: 'fixed reply, nothing generated' });
      continue;
    }
    const cid = m.conceptId && (m.faqId || m.confidence >= 0.15) ? m.conceptId : undefined;
    let answer: { text: string; source: string } | undefined;
    const faq = m.faqId ? pack.faq.find((f) => f.id === m.faqId) : undefined;
    if (faq) answer = { text: textIn(faq.answer.display, lang), source: `faq ${faq.id}` };
    if (!answer) {
      const sources = cid ? sourcesFor(deps, cid, lang, d.text) : [];
      const g = await write('answer_doubt', doubtAnswerPrompt({ pack, lang, level, doubt: d.text, conceptId: cid, sources }));
      if (g?.text) {
        const v = critic({ text: g.text, lang, readingLevel: level, allowedNumbers: sources.flatMap(extractNumbers), answerKey: [], pack, conceptId: cid, ...(sources.length ? { sources, cites: g.cites ?? [] } : {}) });
        llmCalls[llmCalls.length - 1]!.outcome = v.verdict === 'pass' ? 'approved' : `critic ${v.verdict}: ${v.problems.join('; ')}`;
        if (v.verdict === 'pass') answer = { text: v.text, source: 'llm (critic-approved)' };
      }
    }
    if (!answer && cid) {
      const e = pickExplanation(pack, cid, undefined, level);
      if (e) answer = { text: textIn(e.body.display, lang), source: `pack ${e.id}` };
    }
    if (answer) {
      out.add({ type: 'DOUBT_ANSWERED', payload: { doubtId: d.doubtId, conceptId: cid, answer: answer.text } });
      if (s.commitments.some((c) => c.id === `answer:${d.doubtId}` && !c.kept)) out.add({ type: 'COMMITMENT_KEPT', payload: { commitmentId: `answer:${d.doubtId}` } });
      tools.push({ tool: 'answer_queued_doubt', args: { doubtId: d.doubtId, conceptId: cid, source: answer.source }, status: 'ok' });
    } else if (!s.escalations.some((x) => x.reason.includes(d.doubtId))) {
      out.add({ type: 'ESCALATED', payload: { kind: 'academic', reason: `queued doubt ${d.doubtId} could not be answered automatically` } });
      tools.push({ tool: 'answer_queued_doubt', args: { doubtId: d.doubtId }, status: 'fallback', note: 'no grounded answer → teacher' });
    }
  }

  // 3. escalate what needs a human, and draft a reteach for the teacher (PLAN §6.4)
  for (const cid of Object.keys(s.concepts)) {
    const escalated = s.escalations.some((x) => x.conceptId === cid && x.kind === 'academic');
    if (!escalated && shouldEscalate(s, cid)) {
      out.add({ type: 'ESCALATED', payload: { conceptId: cid, kind: 'academic', reason: `${concept(s, cid).strategiesTried.length} strategies tried on ${cid} without success (found after the session)` } });
      tools.push({ tool: 'notify_teacher', args: { conceptId: cid, kind: 'academic' }, status: 'ok' });
    }
  }
  for (const esc of s.escalations.filter((x) => x.kind === 'academic' && x.conceptId && !x.draft)) {
    out.add({ type: 'RETEACH_DRAFTED', payload: { conceptId: esc.conceptId!, draft: reteachDraft(s, ctx, esc.conceptId!) } });
    tools.push({ tool: 'draft_reteach', args: { conceptId: esc.conceptId }, status: 'ok' });
  }

  // 4. plan the next session and pre-write its explanations (PLAN §5.2 "plan NEXT session now")
  const plan = prepareSession(s, ctx, 'server');
  plan.prefetch = [];
  let kb = 0;
  for (const item of plan.items.filter((x) => EXPLAINS.has(x.action)).slice(0, PREGEN_MAX)) {
    const key = cacheKey(item, level, lang, pack, { type: 'next' });
    let ex: { text: string; speak: string } | undefined;
    let source = 'cache';
    const hit = store.cacheGet(key);
    if (hit) ex = JSON.parse(hit);
    else {
      const sources = sourcesFor(deps, item.conceptId, lang);
      const terms = pack.glossary.filter((g) => g.conceptId === item.conceptId).map((g) => `${textIn(g.term, lang)} (${g.english})`).join(', ') || 'term (English term)';
      const g = await write('pregenerate', generatePrompt({
        pack, lang, level, conceptId: item.conceptId, strategy: item.strategy ?? strategiesFor(pack, item.conceptId)[0] ?? 'definition',
        misconceptionId: item.misconceptionId, sources, terms, previous: deps.recentGen?.get(`${profileId}:${item.conceptId}`),
      }));
      if (g) {
        const next = pickCheck(pack, s, item.conceptId, { lang, trustDraft: deps.trustDraft });
        const v = critic({ text: g.text, lang, readingLevel: level, allowedNumbers: sources.flatMap(extractNumbers), answerKey: next?.options?.filter((o) => o.correct).map((o) => textIn(o.text, lang)) ?? [], pack, conceptId: item.conceptId, sources, cites: g.cites ?? [] });
        llmCalls[llmCalls.length - 1]!.outcome = v.verdict === 'pass' ? 'approved' : `critic ${v.verdict}: ${v.problems.join('; ')}`;
        if (v.verdict === 'pass') { ex = { text: v.text, speak: g.speak }; source = 'llm (critic-approved)'; store.cacheSet(key, JSON.stringify(ex)); }
      }
    }
    if (!ex) continue;
    const size = Math.ceil(Buffer.byteLength(JSON.stringify(ex)) / 1024);
    if (kb + size > PREGEN_KB) break;
    kb += size;
    item.pregenerated = { lang, strategy: item.strategy, text: ex.text, speak: ex.speak };
    plan.prefetch.push({ itemRef: `explanation:${item.conceptId}:${item.strategy ?? '-'}`, kb: size, why: `${item.action} ${item.conceptId} is item ${plan.items.indexOf(item) + 1} of the next session (${source})` });
  }
  out.add({ type: 'PLAN_SET', payload: { plan } });
  tools.push({ tool: 'plan_next_session', args: { items: plan.items.map((x) => `${x.action}:${x.conceptId}`), minutes: plan.forSessionMinutes }, status: 'ok' });
  if (plan.prefetch.length) tools.push({ tool: 'prepare_offline', args: { items: plan.prefetch.map((p) => p.itemRef), kb }, status: 'ok' });

  store.append(out.events);
  const trace: ServerTrace = {
    trigger: `between_sessions:${trigger}`,
    tier: 'cloud',
    facts_used: facts,
    candidates: [],
    chosen: `prepare ${plan.items.map((x) => `${x.action}:${x.conceptId}`).join(', ') || 'nothing'}`,
    decided_by: 'policy',
    override: false,
    reason: `after the session: ${plan.items.length} items planned for ~${plan.forSessionMinutes} min; ${plan.prefetch.length} explanations pre-written (${kb} KB)`,
    tools,
    state_diff: stateDiff(s0, s),
    why: whyPrepared(lang, plan),
    latency_ms: Date.now() - t0,
    status: llmCalls.some((c) => c.outcome.startsWith('provider failed')) ? 'fallback' : 'ok',
    llm_calls: llmCalls,
    synced_in: 0,
  };
  store.addTrace(profileId, trace);
  deps.onTrace?.(profileId, trace);
  return { events: out.events, plan, trace };
}

/**
 * Daily/periodic tick (PLAN §5.1 SCHEDULE_TICK): end sessions left open (inactivity) and run the
 * between-session agent for them; tell the teacher about learners who stopped coming (drop-off).
 */
export async function tick(deps: CycleDeps): Promise<{ ended: string[]; dropoff: string[] }> {
  const now = deps.now?.() ?? Date.now();
  const ended: string[] = [];
  const dropoff: string[] = [];
  deps.store.prune(now);
  for (const pid of deps.store.profiles()) {
    const all = deps.store.events(pid);
    const s = fold(all, deps.pack.graph, pid);
    const last = s.lastActiveAt;
    if (!last) continue;
    const out = writer(pid, all, now);
    if (s.session && now - last > INACTIVITY_MIN * 60_000) {
      out.add({ type: 'SESSION_ENDED', payload: { sessionId: s.session.id, reason: 'inactivity', minutesUsed: Math.max(0, Math.round((last - s.session.openedAt) / 60_000)) } });
      ended.push(pid);
    }
    if (now - last > DROPOFF_DAYS * DAY && !s.escalations.some((x) => x.kind === 'dropoff' && x.at > last)) {
      out.add({ type: 'ESCALATED', payload: { kind: 'dropoff', reason: `no activity for ${Math.floor((now - last) / DAY)} days` } });
      dropoff.push(pid);
    }
    deps.store.append(out.events);
    if (ended.includes(pid)) await betweenSessions(deps, pid, 'inactivity');
    if (dropoff.includes(pid)) {
      const step: ServerTrace = {
        trigger: 'schedule_tick', tier: 'cloud', facts_used: [`last activity ${new Date(last).toISOString()}`], candidates: [],
        chosen: 'notify_teacher (drop-off)', decided_by: 'policy', override: false, reason: `no activity for ${DROPOFF_DAYS}+ days → teacher nudge`,
        tools: [{ tool: 'notify_teacher', args: { kind: 'dropoff' }, status: 'ok' }], state_diff: { escalations: '+1 dropoff' },
        why: '', latency_ms: 0, status: 'ok', llm_calls: [], synced_in: 0,
      };
      deps.store.addTrace(pid, step);
      deps.onTrace?.(pid, step);
    }
  }
  return { ended, dropoff };
}

/** What the teacher could try in class: what was tried in the app, what is confirmed, what is left. Deterministic (no quota, checkable). */
export function reteachDraft(s: LearnerState, ctx: EngineCtx, cid: string, lang = 'en'): string {
  const c = concept(s, cid);
  const L = DRAFT[lang] ?? DRAFT.en!;
  const name = textIn(ctx.pack.graph.concepts[cid]?.name, lang);
  const strat = (x: string) => L.strategies[x] ?? x;
  const mis = Object.entries(c.misconceptions).filter(([, m]) => !m.resolved);
  const misText = mis.map(([id, m]) => `${textIn(ctx.pack.misconceptions.find((x) => x.id === id)?.description, lang) || id} (${m.signals} ${L.signals}${m.confirmed ? `, ${L.confirmed}` : ''})`);
  const untried = strategiesFor(ctx.pack, cid).filter((x) => !c.strategiesTried.includes(x));
  const targeted = mis.flatMap(([id]) => ctx.pack.misconceptions.find((x) => x.id === id)?.remediation ?? []);
  const idea = ctx.pack.explanations.find((e) => e.conceptId === cid && (targeted.includes(e.strategy) || untried.includes(e.strategy)) && !c.strategiesTried.includes(e.strategy))
    ?? ctx.pack.explanations.find((e) => e.conceptId === cid && e.strategy === 'analogy');
  return [
    L.summary(name, c.attempts, c.pKnown.toFixed(2), c.strategiesTried.map(strat).join(', ') || L.nothing),
    misText.length ? `${L.likely}: ${misText.join('; ')}.` : L.noMis,
    untried.length ? `${L.untried}: ${untried.map(strat).join(', ')}.` : L.allTried,
    idea ? `${L.idea} (${strat(idea.strategy)}): ${speakIn(idea.body, lang).slice(0, 220)}` : '',
  ].filter(Boolean).join(' ');
}

/** strategy id in the teacher's language */
export const strategyName = (x: string, lang: string) => (DRAFT[lang] ?? DRAFT.en!).strategies[x] ?? x;

const DRAFT: Record<string, { summary: (n: string, a: number, p: string, t: string) => string; nothing: string; signals: string; confirmed: string; likely: string; noMis: string; untried: string; allTried: string; idea: string; strategies: Record<string, string> }> = {
  en: {
    summary: (n, a, p, t) => `${n}: ${a} answers in the app, p(known) ${p}; tried ${t}.`,
    nothing: 'nothing yet', signals: 'signals', confirmed: 'confirmed', likely: 'Likely confusion',
    noMis: 'No specific misconception detected; may need a prerequisite or a hands-on demo.',
    untried: 'Not yet tried in the app', allTried: 'All app strategies tried: a face-to-face demonstration is the next step.', idea: 'Idea for class',
    strategies: {},
  },
  or: {
    summary: (n, a, p, t) => `${n}: ଆପରେ ${a}ଟି ଉତ୍ତର, ଜାଣିବା ସମ୍ଭାବନା ${p}; ଚେଷ୍ଟା ହୋଇଛି: ${t}।`,
    nothing: 'ଏଯାଏଁ କିଛି ନାହିଁ', signals: 'ସଙ୍କେତ', confirmed: 'ନିଶ୍ଚିତ', likely: 'ସମ୍ଭାବ୍ୟ ଭୁଲ ଧାରଣା',
    noMis: 'କୌଣସି ନିର୍ଦ୍ଦିଷ୍ଟ ଭୁଲ ଧାରଣା ମିଳିନାହିଁ; ମୂଳ ବିଷୟ ବା ହାତେକଲମେ ପ୍ରଦର୍ଶନ ଦରକାର ହୋଇପାରେ।',
    untried: 'ଆପରେ ଏଯାଏଁ ଚେଷ୍ଟା ହୋଇନାହିଁ', allTried: 'ଆପର ସବୁ ଉପାୟ ଚେଷ୍ଟା ହୋଇସାରିଛି: ସାମ୍ନାସାମ୍ନି ପ୍ରଦର୍ଶନ ପରବର୍ତ୍ତୀ ପଦକ୍ଷେପ।', idea: 'ଶ୍ରେଣୀ ପାଇଁ ଉପାୟ',
    strategies: { definition: 'ସଂଜ୍ଞା', analogy: 'ଉପମା', worked_example: 'ସମାଧାନ ସହ ଉଦାହରଣ', contrast: 'ତୁଳନା', story: 'ଗଳ୍ପ', faq: 'ପ୍ରଶ୍ନୋତ୍ତର', generated: 'ନୂଆ ବ୍ୟାଖ୍ୟା' },
  },
};

/** Events the server writes on its own stream: deviceId 'server', its own seq, ts never behind the log. */
export function writer(profileId: string, all: AnyEvent[], now: number, onAdd?: (e: AnyEvent) => void) {
  let seq = all.filter((e) => e.deviceId === SERVER_DEVICE).reduce((m, e) => Math.max(m, e.seq), 0);
  let ts = Math.max(now, ...all.filter((e) => e.deviceId === SERVER_DEVICE).map((e) => e.ts + 1));
  const events: AnyEvent[] = [];
  return {
    events,
    add(d: EventDraft) {
      const e = { ...d, id: randomUUID(), profileId, deviceId: SERVER_DEVICE, seq: ++seq, ts: ts++ } as AnyEvent;
      events.push(e);
      onAdd?.(e);
      return e;
    },
  };
}

function whyPrepared(lang: string, plan: SessionPlan): string {
  const n = plan.items.length;
  return lang === 'or' ? `ତୁମ ପରବର୍ତ୍ତୀ ପାଠ ପାଇଁ ${n}ଟି କାମ ପ୍ରସ୍ତୁତ — ପ୍ରାୟ ${plan.forSessionMinutes} ମିନିଟ।` : `Your next session is ready: ${n} steps, about ${plan.forSessionMinutes} minutes.`;
}

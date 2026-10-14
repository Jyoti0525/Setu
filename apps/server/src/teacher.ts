// Teacher view (PLAN §9.2, §10.7; TODO P5.6–P5.12, P5.24). The teacher gets only what needs a human:
// escalations with evidence, wellbeing flags (kept apart, minimal detail), drop-off, and a class-level
// reteach draft when many learners share a misconception (approve / edit — human in the loop).
// Built from the learners' event logs; the teacher sees learning evidence only.

import { createHash, randomBytes, randomInt } from 'node:crypto';
import { fold, concept, textIn, speakIn, DAY, type LearnerState, type ChapterPack } from '@setu/core';
import type { Store, ClassRow } from './db.ts';
import type { CycleDeps } from './agent/cycle.ts';
import { reteachDraft, writer, strategyName, DROPOFF_DAYS } from './agent/between.ts';
import { translatedNote } from './translate.ts';

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
/** A class-level reteach is drafted when at least this many learners (and ≥ 25% of the class) share a confirmed misconception. */
export const RETEACH_MIN_LEARNERS = 2;

export function createClass(store: Store, name: string, lang: string): { code: string; token: string } {
  let code = '';
  do code = String(randomInt(100000, 1000000)); while (store.classByCode(code));
  const token = randomBytes(18).toString('base64url');
  store.createClass({ code, name: name.slice(0, 60) || 'Class', lang, tokenHash: hashToken(token) });
  return { code, token };
}

interface Member { profileId: string; label: string; avatar: string; s: LearnerState }

function members(deps: CycleDeps, cls: ClassRow): Member[] {
  return deps.store.classMembers(cls.code).map((m) => {
    const s = fold(deps.store.events(m.profileId), deps.pack.graph, m.profileId);
    return { profileId: m.profileId, label: m.displayName || `${s.avatar} #${m.profileId.slice(-4)}`, avatar: s.avatar, s };
  });
}

export function classView(deps: CycleDeps, cls: ClassRow, now = Date.now()) {
  const { pack } = deps;
  const lang = cls.lang;
  const acks = deps.store.acks(cls.code);
  const ms = members(deps, cls);
  const name = (cid?: string) => (cid ? textIn(pack.graph.concepts[cid]?.name, lang) : '');
  const ctx = { pack, matcher: deps.matcher, now, tier: 'cloud' as const, trustDraft: deps.trustDraft };
  const misName = (id: string) => textIn(pack.misconceptions.find((m) => m.id === id)?.description, lang) || id;

  const learners = ms.map(({ profileId, label, s }) => ({
    id: profileId, label,
    lastActiveAt: s.lastActiveAt ?? null,
    sessions: s.sessionsCompleted,
    placementDone: s.placementDone,
    concepts: Object.keys(pack.graph.concepts).map((cid) => ({ id: cid, name: name(cid), p: round(concept(s, cid).pKnown), mastered: concept(s, cid).mastered })),
    goal: s.goal ? { type: s.goal.type, dueDate: s.goal.dueDate ?? null, setBy: s.goal.setBy } : null,
  }));

  // Needs you: academic escalations with the evidence behind them (P5.7)
  const needsYou = ms.flatMap(({ profileId, label, s }) =>
    s.escalations.filter((e) => e.kind === 'academic').map((e) => {
      const ref = `esc:${profileId}:${e.at}`;
      const c = e.conceptId ? concept(s, e.conceptId) : undefined;
      return {
        ref, learner: label, learnerId: profileId, at: e.at, conceptId: e.conceptId ?? null, concept: name(e.conceptId),
        reason: e.reason,
        misconceptions: c ? Object.entries(c.misconceptions).filter(([, m]) => !m.resolved).map(([id, m]) => ({ id, text: misName(id), signals: m.signals, confirmed: m.confirmed })) : [],
        strategiesTried: (c?.strategiesTried ?? []).map((x) => strategyName(x, lang)),
        attempts: c?.attempts ?? 0,
        p: c ? round(c.pKnown) : null,
        recommendation: e.conceptId ? reteachDraft(s, ctx, e.conceptId, lang) : T(lang, 'queuedDoubt'),
        done: acks.get(ref)?.action === 'done',
      };
    })).sort((a, b) => Number(a.done) - Number(b.done) || b.at - a.at);

  // Wellbeing: separate, minimal detail — never the learner's words (P5.8)
  const wellbeing = ms.flatMap(({ profileId, label, s }) =>
    s.escalations.filter((e) => e.kind === 'wellbeing').map((e) => {
      const ref = `wb:${profileId}:${e.at}`;
      return { ref, learner: label, at: e.at, note: T(lang, 'wellbeingNote'), done: acks.get(ref)?.action === 'done' };
    }));

  // Drop-off: no activity for N days (P5.9) — computed live, not only from escalations
  const dropoff = ms
    .filter(({ s }) => s.lastActiveAt && now - s.lastActiveAt > DROPOFF_DAYS * DAY)
    .map(({ profileId, label, s }) => ({ learner: label, learnerId: profileId, days: Math.floor((now - s.lastActiveAt!) / DAY) }));

  return {
    class: { code: cls.code, name: cls.name, lang, examDate: cls.examDate ?? null, size: ms.length },
    learners, needsYou, wellbeing, dropoff,
    reteach: classReteach(pack, ms, lang, acks),
    candidates: misconceptionCandidates(ms, acks, name, (n) => (lang === 'en' ? undefined : translatedNote(deps, n, lang))),
  };
}

/** Many learners share a confirmed, unresolved misconception → a 5-minute class reteach in the teacher's language (P5.10). */
function classReteach(pack: ChapterPack, ms: Member[], lang: string, acks: Map<string, { action: string; body?: string }>) {
  const by = new Map<string, string[]>();
  for (const { label, s } of ms)
    for (const [, c] of Object.entries(s.concepts))
      for (const [mid, m] of Object.entries(c.misconceptions))
        if (m.confirmed && !m.resolved) by.set(mid, [...(by.get(mid) ?? []), label]);
  const need = Math.max(RETEACH_MIN_LEARNERS, Math.ceil(ms.length * 0.25));
  return [...by].filter(([, who]) => who.length >= need).sort((a, b) => b[1].length - a[1].length).map(([mid, who]) => {
    const ref = `reteach:${mid}`;
    const ack = acks.get(ref);
    return {
      ref, misconceptionId: mid, learners: [...new Set(who)], share: `${new Set(who).size}/${ms.length}`,
      misconception: textIn(pack.misconceptions.find((m) => m.id === mid)?.description, lang) || mid,
      draft: ack?.body ?? reteachPlan(pack, mid, lang),
      status: (ack?.action ?? 'draft') as 'draft' | 'approved' | 'rejected',
    };
  });
}

/** Deterministic 5-minute plan from reviewed pack content: vote → explain → everyday words → re-vote. */
export function reteachPlan(pack: ChapterPack, misconceptionId: string, lang: string): string {
  const mis = pack.misconceptions.find((m) => m.id === misconceptionId);
  if (!mis) return '';
  const cid = mis.conceptId;
  const term = pack.glossary.find((g) => g.conceptId === cid);
  const vote = pack.checks.find((c) => c.options?.some((o) => o.misconceptionIds.includes(misconceptionId)));
  const fix = pack.explanations.find((e) => e.targets?.includes(misconceptionId)) ?? pack.explanations.find((e) => e.conceptId === cid && mis.remediation.includes(e.strategy));
  const trap = vote?.options?.find((o) => o.misconceptionIds.includes(misconceptionId));
  const right = vote?.options?.find((o) => o.correct);
  const L = (k: string, ...a: string[]) => T(lang, k, ...a);
  return [
    `${L('reteachFor', textIn(pack.graph.concepts[cid]?.name, lang), textIn(mis.description, lang))}`,
    vote ? `1. ${L('step1')}: "${textIn(vote.stem.display, lang)}" (${vote.options!.map((o) => textIn(o.text, lang)).join(' / ')}). ${L('trapIs', textIn(trap?.text, lang))}` : '',
    fix ? `2. ${L('step2')}: ${speakIn(fix.body, lang)}` : '',
    term ? `3. ${L('step3')}: ${textIn(term.term, lang)} = ${textIn(term.everyday, lang)} (${term.english}).` : '',
    vote ? `4. ${L('step4', textIn(right?.text, lang))}` : '',
  ].filter(Boolean).join('\n');
}

/** Novel misconceptions the LLM proposed: shown for review, never auto-added (P5.12, PLAN §6.5). */
// The decide model writes them in English (it writes Odia badly); in another class language the teacher gets the
// translation once it is cached (translate.ts), with the English kept alongside so it can be checked.
function misconceptionCandidates(ms: Member[], acks: Map<string, { action: string }>, name: (c?: string) => string, tr: (n: { description: string; evidence: string }) => { description: string; evidence: string } | undefined) {
  return ms.flatMap(({ profileId, label, s }) => s.misconceptionCandidates.map((m, i) => {
    const ref = `cand:${profileId}:${i}`;
    const status = acks.get(ref)?.action ?? 'pending';
    const t = status === 'pending' ? tr(m) : undefined;
    return { ref, learner: label, concept: name(m.conceptId), description: t?.description ?? m.description, evidence: t?.evidence ?? m.evidence, ...(t ? { english: { description: m.description, evidence: m.evidence } } : {}), status };
  })).filter((c) => c.status === 'pending');
}

/**
 * Candidates teachers kept, for content authors to turn into reviewed misconceptions + distractors (PLAN §6.5).
 * No learner identity leaves this list: concept, belief, evidence, how many classes saw it.
 */
export function keptCandidates(deps: CycleDeps) {
  const out = new Map<string, { conceptId: string; description: string; evidence: string[]; classes: Set<string>; firstAt: number }>();
  for (const a of deps.store.candidateAcks('approved')) {
    const [, profileId, idx] = a.ref.split(':');
    const m = fold(deps.store.events(profileId!), deps.pack.graph, profileId!).misconceptionCandidates[Number(idx)];
    if (!m) continue;
    const key = `${m.conceptId}|${m.description.toLowerCase()}`;
    const e = out.get(key) ?? { conceptId: m.conceptId, description: m.description, evidence: [], classes: new Set<string>(), firstAt: a.at };
    e.evidence.push(m.evidence);
    e.classes.add(a.classCode);
    out.set(key, e);
  }
  return [...out.values()].map((e) => ({ ...e, classes: e.classes.size }));
}

/**
 * Exam date for the class (PLAN §9.2, §1 exam-aspirant case): becomes each learner's goal, which the policy
 * uses (exam proximity → more review and practice). A goal the learner set herself is not overwritten.
 */
export function applyExamGoal(deps: CycleDeps, cls: ClassRow, profileIds = deps.store.classMembers(cls.code).map((m) => m.profileId), now = Date.now()): string[] {
  const changed: string[] = [];
  for (const pid of profileIds) {
    const all = deps.store.events(pid);
    const s = fold(all, deps.pack.graph, pid);
    if (s.goal?.setBy === 'learner') continue;
    const due = cls.examDate;
    if (!due && !s.goal) continue;
    if (s.goal?.dueDate === due) continue;
    const out = writer(pid, all, now);
    out.add({ type: 'GOAL_SET', payload: due ? { type: 'exam', conceptIds: Object.keys(deps.pack.graph.concepts), dueDate: due, setBy: 'teacher' } : { type: 'chapter', conceptIds: [], setBy: 'teacher' } });
    deps.store.append(out.events);
    changed.push(pid);
  }
  return changed;
}

const round = (x: number) => Math.round(x * 100) / 100;

const STR: Record<string, Record<string, string>> = {
  en: {
    wellbeingNote: 'Please check in with this learner privately. The app gave a caring message and a helpline; it does not keep what was said.',
    queuedDoubt: 'A question asked offline could not be answered from the chapter. Please answer it in class.',
    reteachFor: 'Class reteach, 5 minutes — {0}: "{1}"',
    step1: '(1 min) Ask the class to vote',
    trapIs: 'Learners with this confusion pick "{0}".',
    step2: '(2 min) Explain',
    step3: '(1 min) Say it in everyday words',
    step4: '(1 min) Vote again — the answer is "{0}". Ask one learner who changed their answer to explain why.',
  },
  or: {
    wellbeingNote: 'ଦୟାକରି ଏହି ଶିକ୍ଷାର୍ଥୀଙ୍କ ସହ ଏକାନ୍ତରେ କଥା ହୁଅନ୍ତୁ। ଆପ୍ ଯତ୍ନଶୀଳ ବାର୍ତ୍ତା ଓ ହେଲ୍ପଲାଇନ ଦେଇଛି; କଣ କୁହାଯାଇଥିଲା ତାହା ରଖେ ନାହିଁ।',
    queuedDoubt: 'ଅଫଲାଇନରେ ପଚରାଯାଇଥିବା ଗୋଟିଏ ପ୍ରଶ୍ନର ଉତ୍ତର ଅଧ୍ୟାୟରୁ ମିଳିଲା ନାହିଁ। ଦୟାକରି ଶ୍ରେଣୀରେ ଉତ୍ତର ଦିଅନ୍ତୁ।',
    reteachFor: 'ଶ୍ରେଣୀରେ ପୁନଃଶିକ୍ଷା, ୫ ମିନିଟ — {0}: "{1}"',
    step1: '(୧ ମିନିଟ) ଶ୍ରେଣୀକୁ ଭୋଟ ଦେବାକୁ କୁହନ୍ତୁ',
    trapIs: 'ଏହି ଭୁଲ ଧାରଣା ଥିବା ପିଲାମାନେ "{0}" ବାଛନ୍ତି।',
    step2: '(୨ ମିନିଟ) ବୁଝାନ୍ତୁ',
    step3: '(୧ ମିନିଟ) ଦୈନନ୍ଦିନ ଭାଷାରେ କୁହନ୍ତୁ',
    step4: '(୧ ମିନିଟ) ପୁଣି ଭୋଟ — ଉତ୍ତର "{0}"। ଯିଏ ଉତ୍ତର ବଦଳାଇଲା, ତାକୁ କାହିଁକି ବୋଲି କହିବାକୁ ଦିଅନ୍ତୁ।',
  },
};
const T = (lang: string, k: string, ...a: string[]) => a.reduce((t, x, i) => t.replace(`{${i}}`, x), STR[lang]?.[k] ?? STR.en![k] ?? k);

// The tutor agent's policy (PLAN v4, P8.4–P8.8): what to do with what she just said. Deterministic and shared, so the
// phone decides the same way with no signal; online the model writes the words and grades, the policy decides.
//
// Each turn: safety → search her books → recall what she knows → pick an action → (model) → update her memory.
// Actions: care / decline / redirect (safety), grade (she answered the open check), explain, explain_differently (she
// is still stuck: next strategy on the ladder), review (follow-up the agent started), teach (the next part of a lesson
// she chose: subject → chapter → part by part, each part checked), lesson_done, not_in_book, show_passage (no model).

import { bktUpdate, MASTERY_THRESHOLD, SOURCE_WEIGHT } from './bkt.ts';
import type { BookHit } from './book.ts';
import type { SafetyKind } from './safety.ts';

export interface TutorTopic {
  /** BKT mastery estimate for this chapter */
  pKnown: number;
  checks: number;
  right: number;
  wrongInARow: number;
  doubts: number;
  lastAt: number;
  /** strategies already used for this topic, in order (so a second explanation is different) */
  tried: string[];
  /** what the grader saw as the gap, in English (for the next explanation and her teacher) */
  gap?: string;
  escalatedAt?: number;
}
export interface TutorCheck { question: string; keyIdeas: string[]; topic: string; passageIds: string[]; askedAt: number; ignored: number; /** graded tries so far */ tries: number; /** a tap-to-answer check: the choices and which one is right */ options?: string[]; answer?: number }
/** The lesson she chose (guided: subject → chapter → part by part); part = the next part to teach. */
export interface TutorLesson { topic: string; part: number; parts: number }
export interface TutorMemory { topics: Record<string, TutorTopic>; check?: TutorCheck; lastTopic?: string; turns: number; lesson?: TutorLesson }

export type TutorAction = 'care' | 'decline' | 'redirect' | 'grade' | 'explain' | 'explain_differently' | 'review' | 'teach' | 'lesson_done' | 'not_in_book' | 'show_passage' | 'other_subject';
export interface TutorPlan {
  action: TutorAction;
  topic?: string;
  /** explanation strategy for explain / explain_differently / review */
  strategy?: TutorStrategy;
  /** passages that ground this turn (best first) */
  grounding: BookHit[];
  askCheck: boolean;
  escalate: boolean;
  reason: string;
  candidates: { action: TutorAction; score: number }[];
  /** she picked a subject but the answer is in another book */
  switchedBook?: string;
  /** other_subject: the book of another subject that has it (she is sent to that subject's own chat) */
  otherBook?: string;
  /** she picked a chapter, the answer is in another chapter of the same subject (allowed; she is told) */
  chapterMoved?: boolean;
}

/** Strategy ladder: each time she is still stuck on a topic, the next rung (PLAN §6.2 — a different way, not louder). */
export const STRATEGIES = ['textbook', 'everyday_example', 'story', 'small_steps'] as const;
export type TutorStrategy = (typeof STRATEGIES)[number];

/** A search hit good enough to teach from. */
export const GROUNDED_COVERAGE = 0.5;
export const OFF_TOPIC_COVERAGE = 0.75;
/** wrong this many times in a row on one topic → her teacher is told (once per ESCALATE_EVERY_MS) */
export const ESCALATE_AFTER = 3;
export const ESCALATE_EVERY_MS = 3 * 86_400_000;

export const topicKey = (bookId: string, ch: number) => `${bookId}#${ch}`;
export const newTopic = (now: number): TutorTopic => ({ pKnown: 0.2, checks: 0, right: 0, wrongInARow: 0, doubts: 0, lastAt: now, tried: [] });
export const emptyMemory = (): TutorMemory => ({ topics: {}, turns: 0 });

const QUESTION_WORDS = /[?？]|\b(what|why|how|when|where|which|who|explain|tell me|kana|kan|kemiti|kahinki|kouthi|kie|kete|keteta|keun|keunthi|kau|kauta|kipari|kya|kyun|kaise|kab|kahan)\b|କଣ|କ'ଣ|କ’ଣ|କିପରି|କେମିତି|କାହିଁକି|କେଉଁ|କିଏ|କେବେ|କେତେ|କାହାର|କୁଆଡ଼େ|ବୁଝାଅ|ବୁଝାଇ|क्या|क्यों|कैसे|कब|कहाँ|कौन|समझाओ/i;

/** "I don't know / I didn't understand / explain again": with a check open this is her answer (not yet), never a new
 *  question to search the shelf for (that is how a science lesson jumped to a maths page) */
export const DONT_KNOW = /\b(i\s*(do\s*n[o']?t|dont|did\s*n[o']?t|didnt)\s*(know|understand|get( it)?)|no idea|not sure|explain (it )?again|again please|samajh nahi|samjh nahi|nahi pata|pata nahi|jani ni|janini|bujhi parili ni|bujhilini)\b|नहीं पता|पता नहीं|समझ नहीं|फिर से समझा|ଜାଣିନି|ଜାଣେନା|ବୁଝିପାରିଲି ନାହିଁ|ବୁଝିଲିନି|ଆଉ ଥରେ ବୁଝା/i;

/** Is this message her answer to the open check (not a new question)? Online the model can still say otherwise. */
export function looksLikeAnswer(text: string, check?: TutorCheck, hits?: BookHit[]): boolean {
  if (!check) return false;
  const t = text.trim();
  if (!t) return false;
  if (DONT_KNOW.test(t) && t.split(/\s+/).length <= 12) return true;
  // she tapped one of the choices
  if (check.options?.some((o) => o.trim().toLowerCase() === t.toLowerCase())) return true;
  // a question word in a message of two words or more is a new question ("କୋଷ ପ୍ରାଚୀର କ'ଣ"), even a short one
  if (QUESTION_WORDS.test(t) && t.split(/\s+/).length >= 2) return false;
  // her words clearly belong to another chapter and nothing near the top is the check's: a new question asked
  // without a question word ("rakto konika" while a monsoon check is open)
  const top = hits?.slice(0, 3) ?? [];
  // (a one-word reply — "no", "yes", "solid" — is her answer: one common word matches some page somewhere)
  if (t.split(/\s+/).length >= 2 && top[0] && top[0].coverage >= 0.67 && !top.some((h) => topicKey(h.bookId, h.passage.ch) === check.topic)) return false;
  return t.split(/\s+/).length <= 60;
}

/** The agent's decision for one message. */
export function planTurn(m: TutorMemory, x: { safety: SafetyKind; text: string; hits: BookHit[]; /** the subject she picked (one subject can be several books) */ bookIds?: string[]; online: boolean; now: number; review?: string; /** she is learning this chapter part by part (hits = the part's passages) */ learn?: TutorLesson; /** the chapter she picked: its passages come first */ chapter?: string; /** the best pages OUTSIDE the subject she picked: only to notice a question from another subject, never to answer from */ elsewhere?: BookHit[] }): TutorPlan {
  const base = { grounding: [] as BookHit[], askCheck: false, escalate: false, candidates: [] as TutorPlan['candidates'] };
  if (x.safety === 'distress') return { ...base, action: 'care', reason: 'words of distress → caring message, trusted adult + helpline; nothing she wrote is kept or sent to a model' };
  if (x.safety === 'unsafe') return { ...base, action: 'decline', reason: 'unsafe topic → calm no, nothing generated' };
  if (x.safety === 'personal') return { ...base, action: 'redirect', reason: 'personal details → not needed for learning, not kept' };

  // the agent's own follow-up (she tapped "yes" on a review it offered)
  if (x.review) {
    const t = m.topics[x.review];
    return { ...base, action: x.online ? 'review' : 'show_passage', topic: x.review, strategy: nextStrategy(t), grounding: x.hits, askCheck: x.online, reason: `follow-up the agent offered: ${x.review} (mastery ${pct(t?.pKnown)}) → one short check on it` };
  }

  // the lesson she chose: the next part, taught then checked; after the last part the lesson is done
  if (x.learn) {
    const { topic, part, parts } = x.learn;
    const t = m.topics[topic];
    if (part >= parts) return { ...base, action: 'lesson_done', topic, reason: `all ${parts} parts of ${topic} taught (mastery ${pct(t?.pKnown)}) → lesson done; offer practice or the next lesson` };
    const stuck = !!t && t.wrongInARow > 0;
    const strategy = stuck ? nextStrategy(t) : 'textbook';
    return { ...base, action: x.online ? 'teach' : 'show_passage', topic, strategy, grounding: x.hits, askCheck: x.online, reason: `lesson ${topic}: part ${part + 1} of ${parts} → teach it from the book, then one check${stuck ? ` (last answer was wrong → ${strategy})` : ''}` };
  }

  if (looksLikeAnswer(x.text, m.check, x.hits)) {
    const topic = m.check!.topic;
    // in a lesson a wrong answer gets a new, simpler check after the re-explanation: she goes on until she has it
    const inLesson = m.lesson?.topic === topic;
    // not right → explained again, then a new, simpler check (in a lesson, and when she says she does not know)
    return { ...base, action: x.online ? 'grade' : 'show_passage', topic, grounding: x.hits, askCheck: x.online && (inLesson || DONT_KNOW.test(x.text)), reason: x.online ? `she is answering the open check on ${topic} → grade it against the book, then decide` : `answer to the check kept; graded when online (offline: the passage, no grading)`, candidates: [{ action: 'grade', score: 0.8 }, { action: 'explain', score: 0.2 }] };
  }

  const picked = x.bookIds?.length ? x.bookIds : undefined;
  const inBook = picked ? x.hits.filter((h) => picked.includes(h.bookId)) : x.hits;
  // chit-chat (the screen says off-topic) needs the book to cover it clearly before a page is shown for it
  const need = x.safety === 'off_topic' ? OFF_TOPIC_COVERAGE : GROUNDED_COVERAGE;
  const good = (hs: BookHit[]) => hs.filter((h) => h.coverage >= need);
  let grounding = good(inBook);
  // she picked a chapter: its passages first (the answer may still come from elsewhere in her books)
  if (x.chapter) grounding = [...grounding.filter((h) => topicKey(h.bookId, h.passage.ch) === x.chapter), ...grounding.filter((h) => topicKey(h.bookId, h.passage.ch) !== x.chapter)];
  // a chat is one subject: a question another subject's book answers is sent to that subject's chat, not answered
  // here (one word — "no", "yes" — is never enough to call it another subject: it matches some page somewhere)
  const away = good(x.elsewhere ?? (picked ? x.hits.filter((h) => !picked.includes(h.bookId)) : []));
  // also when her subject only matches weakly and another subject's book matches clearly better ("structure of a
  // cell" in Physical Science: "Structure of the atom" half matches, Life Science's cell chapter fully)
  const weak = !!grounding.length && !!away[0] && away[0].coverage >= 0.67 && away[0].coverage - grounding[0]!.coverage >= 0.3;
  if ((!grounding.length || weak) && picked && away.length && x.text.trim().split(/\s+/).length >= 2) {
    return { ...base, action: 'other_subject', otherBook: away[0]!.bookId, reason: `not in the subject she picked; ${away[0]!.bookId} p. ${away[0]!.passage.page} has it (coverage ${away[0]!.coverage}) → this chat stays on its subject: send her to that subject's chat`, candidates: [{ action: 'other_subject', score: 0.8 }, { action: 'not_in_book', score: 0.2 }] };
  }
  const switchedBook: string | undefined = undefined;
  if (!grounding.length) {
    if (x.safety === 'off_topic') return { ...base, action: 'redirect', reason: 'not a study question and nothing in her books matches → kind redirect' };
    // online the model may still use the near misses as context; offline a weak page would only mislead her
    return { ...base, action: x.online ? 'not_in_book' : 'show_passage', grounding: x.online ? x.hits.slice(0, 2) : [], reason: `nothing in her books covers this well (best coverage ${x.hits[0]?.coverage ?? 0}) → ${x.online ? 'say so, short general answer, marked as not from the textbook' : 'keep the question for when the signal is back'}`, candidates: [{ action: 'not_in_book', score: 0.7 }, { action: 'explain', score: 0.3 }] };
  }
  const h0 = grounding[0]!;
  const topic = topicKey(h0.bookId, h0.passage.ch);
  // another chapter of the same subject is fine; she is told which one
  const chapterMoved = !!x.chapter && topic !== x.chapter;
  const t = m.topics[topic];
  if (!x.online) return { ...base, action: 'show_passage', topic, grounding, switchedBook, reason: `no signal → read her the textbook passage (p. ${h0.passage.page}); the full explanation comes when online` };
  // a repeat doubt on a topic she already got wrong / asked before → a different way of explaining
  const stuck = !!t && (t.wrongInARow > 0 || t.doubts >= 2);
  const strategy = stuck ? nextStrategy(t) : 'textbook';
  const escalate = !!t && t.wrongInARow >= ESCALATE_AFTER && (!t.escalatedAt || x.now - t.escalatedAt > ESCALATE_EVERY_MS);
  const mastered = (t?.pKnown ?? 0) >= MASTERY_THRESHOLD;
  return {
    ...base,
    action: stuck ? 'explain_differently' : 'explain',
    topic, strategy, grounding, switchedBook, escalate, ...(chapterMoved ? { chapterMoved } : {}),
    // explain, then check she understood — unless she has shown mastery here already (a new check replaces an old one)
    askCheck: !mastered,
    reason: [
      `found in ${h0.bookId} p. ${h0.passage.page} (coverage ${h0.coverage})${chapterMoved ? ` — another chapter than the one picked (${x.chapter})` : ''}`,
      t ? `${topic}: mastery ${pct(t.pKnown)}, ${t.wrongInARow} wrong in a row, ${t.doubts} doubts` : `${topic}: new topic for her`,
      stuck ? `still stuck → next strategy: ${strategy} (tried: ${t!.tried.join(', ') || 'none'})` : 'explain from the book',
      mastered ? 'already mastered → no check' : 'then one short check',
      escalate ? `wrong ${t!.wrongInARow}× in a row → tell her teacher` : '',
    ].filter(Boolean).join('; '),
    candidates: [{ action: stuck ? 'explain_differently' : 'explain', score: 0.8 }, { action: 'not_in_book', score: 0.1 }],
  };
}

export function nextStrategy(t?: TutorTopic): TutorStrategy {
  const used = new Set(t?.tried ?? []);
  return STRATEGIES.find((s) => !used.has(s)) ?? STRATEGIES[(t?.tried.length ?? 0) % STRATEGIES.length]!;
}

/** Her memory after a turn: a grade moves mastery (free-text evidence weight), a doubt is counted. */
export function applyTurn(m: TutorMemory, x: { plan: TutorPlan; now: number; grade?: { verdict: 'right' | 'partly' | 'wrong'; gap?: string }; newCheck?: Omit<TutorCheck, 'askedAt' | 'ignored' | 'tries'>; escalated?: boolean; /** the lesson after this turn (null: none) */ lesson?: TutorLesson | null }): TutorMemory {
  const topics = { ...m.topics };
  const touch = (k: string) => (topics[k] = { ...(topics[k] ?? newTopic(x.now)), lastAt: x.now });
  let check = m.check;
  const p = x.plan;
  if (p.topic && ['explain', 'explain_differently', 'review', 'teach'].includes(p.action)) {
    const t = touch(p.topic);
    if (p.action === 'explain' || p.action === 'explain_differently') t.doubts += 1;
    if (p.strategy) t.tried = [...t.tried.filter((s) => s !== p.strategy), p.strategy];
    if (x.escalated) t.escalatedAt = x.now;
  }
  if (p.action === 'grade' && x.grade && check) {
    const t = touch(check.topic);
    const right = x.grade.verdict === 'right';
    t.checks += 1;
    t.right += right ? 1 : 0;
    t.wrongInARow = right ? 0 : x.grade.verdict === 'partly' ? t.wrongInARow : t.wrongInARow + 1;
    // half right is neither evidence she knows it nor that she does not: mastery stays, the hint does the work
    if (x.grade.verdict !== 'partly') t.pKnown = bktUpdate(t.pKnown, right, SOURCE_WEIGHT.free_text);
    t.gap = right ? undefined : x.grade.gap ?? t.gap;
    // not right yet: the same question stays open for one more try (she was just given a hint), then it is closed
    check = right || check.tries >= 1 ? undefined : { ...check, tries: check.tries + 1, ignored: 0 };
  } else if (check && p.action !== 'grade' && p.action !== 'show_passage') {
    // she moved on to a new question: the old check is dropped at once (she is never nagged);
    // offline (show_passage) it stays, so an answer typed without signal is still graded later
    check = undefined;
  }
  if (x.newCheck) check = { ...x.newCheck, askedAt: x.now, ignored: 0, tries: 0 };
  const lesson = x.lesson === null ? undefined : x.lesson ?? m.lesson;
  return { topics, check, lastTopic: p.topic ?? m.lastTopic, turns: m.turns + 1, ...(lesson ? { lesson } : {}) };
}

/** What the agent opens a session with — a follow-up nobody asked for (PS: "follow up without being asked"). */
export function openerFor(m: TutorMemory, now: number): { kind: 'recheck'; check: TutorCheck } | { kind: 'review'; topic: string; t: TutorTopic } | { kind: 'welcome'; next?: string } {
  if (m.check && now - m.check.askedAt > 60 * 60_000) return { kind: 'recheck', check: m.check };
  // weakest topic she has worked on, not touched for 6 h+ (spaced review), wrong at least once or low mastery
  const due = Object.entries(m.topics)
    .filter(([, t]) => t.pKnown < MASTERY_THRESHOLD && (t.checks > 0 || t.doubts > 0) && now - t.lastAt > 6 * 3_600_000)
    .sort((a, b) => a[1].pKnown - b[1].pKnown);
  if (due.length) return { kind: 'review', topic: due[0]![0], t: due[0]![1] };
  return { kind: 'welcome', next: m.lastTopic };
}

const pct = (p?: number) => `${Math.round((p ?? 0.2) * 100)}%`;

/** Fixed tutor lines (no model needed; the phone shows them offline too). */
export const TUTOR_LINES: Record<string, Record<string, string>> = {
  or: {
    welcome: 'ନମସ୍କାର! ମୁଁ ତୁମ ପାଠ ସାଥୀ। ତୁମ ପାଠ୍ୟ ବହିର ଯେକୌଣସି ପ୍ରଶ୍ନ ପଚାର — ଲେଖି, କହି କିମ୍ବା ବହିର ଫଟୋ ଉଠାଇ।',
    welcome_back: 'ପୁଣି ସ୍ୱାଗତ! ଆଜି କ\'ଣ ପଢ଼ିବା?',
    recheck: 'ଗତଥର ମୁଁ ତୁମକୁ ଗୋଟିଏ ପ୍ରଶ୍ନ ପଚାରିଥିଲି। ସେହି ପ୍ରଶ୍ନଟି ପୁଣି ଥରେ ଚେଷ୍ଟା କରିବ କି?',
    review: 'ଗତଥର "{0}" ଟିକେ କଠିନ ଲାଗିଥିଲା। ଚାଲ, ଏହା ଉପରେ ଗୋଟିଏ ଛୋଟ ପ୍ରଶ୍ନ ଚେଷ୍ଟା କରିବା?',
    review_yes: 'ହଁ, ପଚାର',
    review_no: 'ମୁଁ ଅନ୍ୟ କିଛି ପଚାରିବି',
    from_book: 'ତୁମ ବହିରୁ',
    offline_passage: 'ଏବେ ନେଟ୍ ନାହିଁ। ତୁମ ବହିର ଏହି ଅଂଶରେ ଉତ୍ତର ଅଛି — ପଢ଼ି ଦେଖ। ନେଟ୍ ଆସିଲେ ମୁଁ ଭଲ କରି ବୁଝାଇ ଦେବି।',
    offline_none: 'ଏବେ ନେଟ୍ ନାହିଁ, ଆଉ ତୁମ ବହିରେ ଏହା ମୁଁ ପାଇଲି ନାହିଁ। ପ୍ରଶ୍ନଟି ମୁଁ ରଖିଲି — ନେଟ୍ ଆସିଲେ ଉତ୍ତର ଦେବି।',
    offline_answer: 'ତୁମ ଉତ୍ତର ମୁଁ ରଖିଲି। ନେଟ୍ ଆସିଲେ ଦେଖିବି। ସେତେବେଳ ଯାଏଁ ବହିର ଏହି ଅଂଶ ପଢ଼ି ଦେଖ।',
    kept_answered: 'ତୁମେ ନେଟ୍ ନଥିବା ବେଳେ ପଚାରିଥିବା ପ୍ରଶ୍ନର ଉତ୍ତର:',
    model_down: 'ଏବେ ମୋର ବୁଝାଇବା ଯନ୍ତ୍ର ଧୀର ଚାଲିଛି। ତୁମ ବହିର ଏହି ଅଂଶ ପଢ଼ି ଦେଖ; ମୁଁ ପୁଣି ଚେଷ୍ଟା କରୁଛି।',
    teacher_told: 'ଏହି ଅଧ୍ୟାୟ ବିଷୟରେ ମୁଁ ତୁମ ଶିକ୍ଷକଙ୍କୁ ଜଣାଇଦେଇଛି — ସେ ତୁମକୁ ସାହାଯ୍ୟ କରିବେ।',
    join_class: 'ଏହା କଷ୍ଟ ଲାଗୁଛି — ଜଣେ ଶିକ୍ଷକ ସାହାଯ୍ୟ କରିପାରିବେ। ତୁମ ଶିକ୍ଷକଙ୍କ କୋଡ୍ ଦେଇ ତୁମ ଶ୍ରେଣୀରେ ଯୋଗ ଦିଅ, ତାହେଲେ ସେ ଜାଣିପାରିବେ।',
    join_btn: 'ଶ୍ରେଣୀରେ ଯୋଗ ଦିଅ',
    switched: '{0} ବହିରେ ଏହାର ଉତ୍ତର ଅଛି:',
    wrong_subject: 'ଏହା ତୁମ {0} ବହିର ପ୍ରଶ୍ନ। ଏହି ଚାଟ୍ କେବଳ {1} ପାଇଁ — {0} ଖୋଲି ସେଠାରେ ପଚାର।',
    open_subject: '{0} ଖୋଲ',
    chapter_moved: 'ଏହା ଅନ୍ୟ ଏକ ଅଧ୍ୟାୟରେ ଅଛି: {0}',
    pick_subject: 'କେଉଁ ବିଷୟ?',
    all_subjects: 'ସମସ୍ତ ବିଷୟ',
    guided: 'ଗତି ଅଧ୍ୟାୟ ଅଭ୍ୟାସ',
    answer_here: 'ତୁମ ଉତ୍ତର ଲେଖ — କିମ୍ବା ନୂଆ ପ୍ରଶ୍ନ ପଚାର',
    progress: 'ମୋ ପ୍ରଗତି',
    no_progress: 'ପ୍ରଶ୍ନ ପଚାରିଲେ ଏଠାରେ ପ୍ରତି ଅଧ୍ୟାୟର ପ୍ରଗତି ଦେଖାଯିବ।',
    page: 'ପୃଷ୍ଠା',
    ask_subject: 'କେଉଁ ବିଷୟ ପଢ଼ିବାକୁ ଚାହୁଁଛ? ବାଛ — କିମ୍ବା ସିଧା ତୁମ ପ୍ରଶ୍ନ ପଚାର।',
    ask_chapter: '{0} — କେଉଁ ଅଧ୍ୟାୟ?',
    ask_mode: '"{0}" — କ\'ଣ କରିବା?',
    mode_teach: 'ଏହି ଅଧ୍ୟାୟ ବୁଝାଅ',
    mode_quiz: 'ମୋତେ ପ୍ରଶ୍ନ ପଚାର',
    mode_ask: 'ମୋର ଗୋଟିଏ ସନ୍ଦେହ ଅଛି',
    ask_doubt: '"{0}" ବିଷୟରେ ତୁମ ସନ୍ଦେହ ପଚାର — ଲେଖି, କହି କିମ୍ବା ବହିର ଫଟୋ ଉଠାଇ।',
    part_of: 'ଅଂଶ {0}/{1}',
    next_part: 'ପରବର୍ତ୍ତୀ ଅଂଶ ▶',
    lesson_done: '"{0}" ଅଧ୍ୟାୟ ସାରିଲ! 🎉 ତୁମ ବୁଝିବା: {1}।',
    lesson_more: 'ଆଉ ଅଭ୍ୟାସ',
    other_chapter: 'ଅନ୍ୟ ଅଧ୍ୟାୟ',
    other_subject: 'ଅନ୍ୟ ବିଷୟ',
    continue_lesson: 'ଗତଥର "{0}" ଅଧ୍ୟାୟର ଅଂଶ {1} ଯାଏଁ ପଢ଼ିଥିଲ। ଜାରି ରଖିବା?',
    continue_yes: 'ହଁ, ଜାରି ରଖ',
  },
  en: {
    welcome: 'Hello! I am your study partner. Ask me anything from your textbooks — type, speak, or take a photo of the page.',
    welcome_back: 'Welcome back! What shall we study today?',
    recheck: 'Last time I asked you a question. Want to try it?',
    review: 'Last time "{0}" was a bit hard. Shall we try one short question on it?',
    review_yes: 'Yes, ask me',
    review_no: 'I will ask something else',
    from_book: 'From your book',
    offline_passage: 'No signal right now. Your book answers this here — read it. When the signal is back I will explain it properly.',
    offline_none: 'No signal right now, and I could not find this in your books. I have kept the question — I will answer when the signal is back.',
    offline_answer: 'I have kept your answer and will check it when the signal is back. Meanwhile, read this part of your book.',
    kept_answered: 'The answer to what you asked while offline:',
    model_down: 'My explaining is slow right now. Read this part of your book; I am trying again.',
    teacher_told: 'I have let your teacher know about this chapter — they will help you.',
    join_class: 'This one is hard — a teacher can help. Join your class with your teacher’s code so they can help you.',
    join_btn: 'Join your class',
    switched: 'The answer is in your {0} book:',
    wrong_subject: 'That question is from your {0} book. This chat is only for {1}, so open {0} and ask it there.',
    open_subject: 'Open {0}',
    chapter_moved: 'This is in another chapter: {0}',
    pick_subject: 'Which subject?',
    all_subjects: 'All subjects',
    guided: 'Motion — guided practice',
    answer_here: 'Type your answer — or ask something new',
    progress: 'My progress',
    no_progress: 'Ask questions and your progress per chapter shows here.',
    page: 'page',
    ask_subject: 'Which subject do you want to study? Pick one — or just ask your question.',
    ask_chapter: '{0} — which lesson?',
    ask_mode: '"{0}" — what shall we do?',
    mode_teach: 'Teach me this lesson',
    mode_quiz: 'Quiz me',
    mode_ask: 'I have a doubt',
    ask_doubt: 'Ask your doubt about "{0}" — type, speak, or take a photo of the page.',
    part_of: 'Part {0} of {1}',
    next_part: 'Next part ▶',
    lesson_done: 'You finished "{0}"! 🎉 Your understanding: {1}.',
    lesson_more: 'Practise more',
    other_chapter: 'Another lesson',
    other_subject: 'Another subject',
    continue_lesson: 'Last time you reached part {1} of "{0}". Shall we continue?',
    continue_yes: 'Yes, continue',
  },
  hi: {
    welcome: 'नमस्ते! मैं तुम्हारा पढ़ाई साथी हूँ। अपनी पाठ्यपुस्तक से कुछ भी पूछो — लिखकर, बोलकर या किताब की फ़ोटो लेकर।',
    welcome_back: 'फिर से स्वागत है! आज क्या पढ़ें?',
    recheck: 'पिछली बार मैंने तुमसे एक सवाल पूछा था। कोशिश करोगे?',
    review: 'पिछली बार "{0}" थोड़ा कठिन लगा था। एक छोटा सवाल करके देखें?',
    review_yes: 'हाँ, पूछो',
    review_no: 'कुछ और पूछूँगा',
    from_book: 'तुम्हारी किताब से',
    offline_passage: 'अभी नेटवर्क नहीं है। तुम्हारी किताब में इसका उत्तर यहाँ है — पढ़ो। नेटवर्क आने पर मैं अच्छे से समझाऊँगा।',
    offline_none: 'अभी नेटवर्क नहीं है, और यह मुझे तुम्हारी किताबों में नहीं मिला। सवाल मैंने रख लिया है — नेटवर्क आने पर जवाब दूँगा।',
    offline_answer: 'तुम्हारा उत्तर मैंने रख लिया है, नेटवर्क आने पर जाँचूँगा। तब तक किताब का यह हिस्सा पढ़ो।',
    kept_answered: 'नेटवर्क न होने पर पूछे गए सवाल का जवाब:',
    model_down: 'अभी मेरा समझाना धीमा चल रहा है। किताब का यह हिस्सा पढ़ो; मैं फिर कोशिश कर रहा हूँ।',
    teacher_told: 'इस अध्याय के बारे में मैंने तुम्हारे शिक्षक को बता दिया है — वे मदद करेंगे।',
    join_class: 'यह मुश्किल लग रहा है — शिक्षक मदद कर सकते हैं। अपने शिक्षक के कोड से अपनी कक्षा में जुड़ो, ताकि वे मदद कर सकें।',
    join_btn: 'कक्षा से जुड़ो',
    switched: 'इसका उत्तर तुम्हारी {0} की किताब में है:',
    wrong_subject: 'यह तुम्हारी {0} की किताब का सवाल है। यह चैट सिर्फ़ {1} के लिए है — {0} खोलकर वहाँ पूछो।',
    open_subject: '{0} खोलो',
    chapter_moved: 'यह दूसरे अध्याय में है: {0}',
    pick_subject: 'कौन सा विषय?',
    all_subjects: 'सभी विषय',
    guided: 'गति — अभ्यास',
    answer_here: 'अपना उत्तर लिखो — या नया सवाल पूछो',
    progress: 'मेरी प्रगति',
    no_progress: 'सवाल पूछो, यहाँ हर अध्याय की प्रगति दिखेगी।',
    page: 'पृष्ठ',
    ask_subject: 'कौन सा विषय पढ़ना चाहते हो? चुनो — या सीधे अपना सवाल पूछो।',
    ask_chapter: '{0} — कौन सा अध्याय?',
    ask_mode: '"{0}" — क्या करें?',
    mode_teach: 'यह अध्याय समझाओ',
    mode_quiz: 'मुझसे सवाल पूछो',
    mode_ask: 'मेरा एक सवाल है',
    ask_doubt: '"{0}" के बारे में अपना सवाल पूछो — लिखकर, बोलकर या किताब की फ़ोटो लेकर।',
    part_of: 'भाग {0}/{1}',
    next_part: 'अगला भाग ▶',
    lesson_done: '"{0}" अध्याय पूरा! 🎉 तुम्हारी समझ: {1}।',
    lesson_more: 'और अभ्यास',
    other_chapter: 'दूसरा अध्याय',
    other_subject: 'दूसरा विषय',
    continue_lesson: 'पिछली बार तुम "{0}" के भाग {1} तक पहुँचे थे। आगे पढ़ें?',
    continue_yes: 'हाँ, आगे',
  },
};

export function TL(lang: string, key: string, ...args: string[]): string {
  const s = TUTOR_LINES[lang]?.[key] ?? TUTOR_LINES.en![key] ?? key;
  return args.reduce((acc, a, i) => acc.split(`{${i}}`).join(a), s);
}

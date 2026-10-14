// The tutor agent's policy (PLAN v4, P8.4–P8.8): what to do with what she just said. Deterministic and shared, so the
// phone decides the same way with no signal; online the model writes the words and grades, the policy decides.
//
// Each turn: safety → search her books → recall what she knows → pick an action → (model) → update her memory.
// Actions: care / decline / redirect (safety), grade (she answered the open check), explain, explain_differently (she
// is still stuck: next strategy on the ladder), review (follow-up the agent started), not_in_book, show_passage (no model).

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
export interface TutorCheck { question: string; keyIdeas: string[]; topic: string; passageIds: string[]; askedAt: number; ignored: number; /** graded tries so far */ tries: number }
export interface TutorMemory { topics: Record<string, TutorTopic>; check?: TutorCheck; lastTopic?: string; turns: number }

export type TutorAction = 'care' | 'decline' | 'redirect' | 'grade' | 'explain' | 'explain_differently' | 'review' | 'not_in_book' | 'show_passage';
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
}

/** Strategy ladder: each time she is still stuck on a topic, the next rung (PLAN §6.2 — a different way, not louder). */
export const STRATEGIES = ['textbook', 'everyday_example', 'story', 'small_steps'] as const;
export type TutorStrategy = (typeof STRATEGIES)[number];

/** A search hit good enough to teach from. */
export const GROUNDED_COVERAGE = 0.5;
/** wrong this many times in a row on one topic → her teacher is told (once per ESCALATE_EVERY_MS) */
export const ESCALATE_AFTER = 3;
export const ESCALATE_EVERY_MS = 3 * 86_400_000;

export const topicKey = (bookId: string, ch: number) => `${bookId}#${ch}`;
export const newTopic = (now: number): TutorTopic => ({ pKnown: 0.2, checks: 0, right: 0, wrongInARow: 0, doubts: 0, lastAt: now, tried: [] });
export const emptyMemory = (): TutorMemory => ({ topics: {}, turns: 0 });

const QUESTION_WORDS = /[?？]|\b(what|why|how|when|where|which|who|explain|tell me|kana|kan|kemiti|kahinki|kouthi|kie|kya|kyun|kaise|kab|kahan)\b|କଣ|କ'ଣ|କ’ଣ|କିପରି|କେମିତି|କାହିଁକି|କେଉଁ|କିଏ|କେବେ|କୁଆଡ଼େ|ବୁଝାଅ|ବୁଝାଇ|क्या|क्यों|कैसे|कब|कहाँ|कौन|समझाओ/i;

/** Is this message her answer to the open check (not a new question)? Online the model can still say otherwise. */
export function looksLikeAnswer(text: string, check?: TutorCheck): boolean {
  if (!check) return false;
  const t = text.trim();
  if (!t) return false;
  // a question word in a message of two words or more is a new question ("କୋଷ ପ୍ରାଚୀର କ'ଣ"), even a short one
  if (QUESTION_WORDS.test(t) && t.split(/\s+/).length >= 2) return false;
  return t.split(/\s+/).length <= 60;
}

/** The agent's decision for one message. */
export function planTurn(m: TutorMemory, x: { safety: SafetyKind; text: string; hits: BookHit[]; /** the subject she picked (one subject can be several books) */ bookIds?: string[]; online: boolean; now: number; review?: string }): TutorPlan {
  const base = { grounding: [] as BookHit[], askCheck: false, escalate: false, candidates: [] as TutorPlan['candidates'] };
  if (x.safety === 'distress') return { ...base, action: 'care', reason: 'words of distress → caring message, trusted adult + helpline; nothing she wrote is kept or sent to a model' };
  if (x.safety === 'unsafe') return { ...base, action: 'decline', reason: 'unsafe topic → calm no, nothing generated' };
  if (x.safety === 'personal') return { ...base, action: 'redirect', reason: 'personal details → not needed for learning, not kept' };

  // the agent's own follow-up (she tapped "yes" on a review it offered)
  if (x.review) {
    const t = m.topics[x.review];
    return { ...base, action: x.online ? 'review' : 'show_passage', topic: x.review, strategy: nextStrategy(t), grounding: x.hits, askCheck: x.online, reason: `follow-up the agent offered: ${x.review} (mastery ${pct(t?.pKnown)}) → one short check on it` };
  }

  if (looksLikeAnswer(x.text, m.check)) {
    const topic = m.check!.topic;
    return { ...base, action: x.online ? 'grade' : 'show_passage', topic, grounding: x.hits, reason: x.online ? `she is answering the open check on ${topic} → grade it against the book, then decide` : `answer to the check kept; graded when online (offline: the passage, no grading)`, candidates: [{ action: 'grade', score: 0.8 }, { action: 'explain', score: 0.2 }] };
  }

  const picked = x.bookIds?.length ? x.bookIds : undefined;
  const inBook = picked ? x.hits.filter((h) => picked.includes(h.bookId)) : x.hits;
  const good = (hs: BookHit[]) => hs.filter((h) => h.coverage >= GROUNDED_COVERAGE);
  let grounding = good(inBook);
  let switchedBook: string | undefined;
  if (!grounding.length && picked && good(x.hits).length) { grounding = good(x.hits); switchedBook = grounding[0]!.bookId; }
  if (!grounding.length) {
    if (x.safety === 'off_topic') return { ...base, action: 'redirect', reason: 'not a study question and nothing in her books matches → kind redirect' };
    return { ...base, action: x.online ? 'not_in_book' : 'show_passage', grounding: x.hits.slice(0, 2), reason: `nothing in her books covers this well (best coverage ${x.hits[0]?.coverage ?? 0}) → ${x.online ? 'say so, short general answer, marked as not from the textbook' : 'keep the question for when the signal is back'}`, candidates: [{ action: 'not_in_book', score: 0.7 }, { action: 'explain', score: 0.3 }] };
  }
  const h0 = grounding[0]!;
  const topic = topicKey(h0.bookId, h0.passage.ch);
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
    topic, strategy, grounding, switchedBook, escalate,
    // explain, then check she understood — unless she has shown mastery here already, or a check is waiting
    askCheck: !mastered && !m.check,
    reason: [
      `found in ${h0.bookId} p. ${h0.passage.page} (coverage ${h0.coverage})`,
      t ? `${topic}: mastery ${pct(t.pKnown)}, ${t.wrongInARow} wrong in a row, ${t.doubts} doubts` : `${topic}: new topic for her`,
      stuck ? `still stuck → next strategy: ${strategy} (tried: ${t!.tried.join(', ') || 'none'})` : 'explain from the book',
      mastered ? 'already mastered → no check' : m.check ? 'a check is already open → no new one' : 'then one short check',
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
export function applyTurn(m: TutorMemory, x: { plan: TutorPlan; now: number; grade?: { verdict: 'right' | 'partly' | 'wrong'; gap?: string }; newCheck?: Omit<TutorCheck, 'askedAt' | 'ignored' | 'tries'>; escalated?: boolean }): TutorMemory {
  const topics = { ...m.topics };
  const touch = (k: string) => (topics[k] = { ...(topics[k] ?? newTopic(x.now)), lastAt: x.now });
  let check = m.check;
  const p = x.plan;
  if (p.topic && ['explain', 'explain_differently', 'review'].includes(p.action)) {
    const t = touch(p.topic);
    if (p.action !== 'review') t.doubts += 1;
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
  } else if (check && p.action !== 'grade') {
    // she moved on: the open check waits one more message, then it is dropped (she is never nagged)
    check = check.ignored >= 1 ? undefined : { ...check, ignored: check.ignored + 1 };
  }
  if (x.newCheck) check = { ...x.newCheck, askedAt: x.now, ignored: 0, tries: 0 };
  return { topics, check, lastTopic: p.topic ?? m.lastTopic, turns: m.turns + 1 };
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
    recheck: 'ଗତଥର ମୁଁ ତୁମକୁ ଗୋଟିଏ ପ୍ରଶ୍ନ ପଚାରିଥିଲି। ଚେଷ୍ଟା କରିବ?',
    review: 'ଗତଥର "{0}" ଟିକେ କଷ୍ଟ ଲାଗିଥିଲା। ଗୋଟିଏ ଛୋଟ ପ୍ରଶ୍ନ ଦେଇ ଦେଖିବା?',
    review_yes: 'ହଁ, ପଚାର',
    review_no: 'ଅନ୍ୟ କିଛି ପଚାରିବି',
    from_book: 'ତୁମ ବହିରୁ',
    offline_passage: 'ଏବେ ନେଟ୍ ନାହିଁ। ତୁମ ବହିର ଏହି ଅଂଶରେ ଉତ୍ତର ଅଛି — ପଢ଼ି ଦେଖ। ନେଟ୍ ଆସିଲେ ମୁଁ ଭଲ କରି ବୁଝାଇ ଦେବି।',
    offline_none: 'ଏବେ ନେଟ୍ ନାହିଁ, ଆଉ ତୁମ ବହିରେ ଏହା ମୁଁ ପାଇଲି ନାହିଁ। ପ୍ରଶ୍ନଟି ମୁଁ ରଖିଲି — ନେଟ୍ ଆସିଲେ ଉତ୍ତର ଦେବି।',
    offline_answer: 'ତୁମ ଉତ୍ତର ମୁଁ ରଖିଲି। ନେଟ୍ ଆସିଲେ ଦେଖିବି। ସେତେବେଳ ଯାଏଁ ବହିର ଏହି ଅଂଶ ପଢ଼ି ଦେଖ।',
    kept_answered: 'ତୁମେ ନେଟ୍ ନଥିବା ବେଳେ ପଚାରିଥିବା ପ୍ରଶ୍ନର ଉତ୍ତର:',
    model_down: 'ଏବେ ମୋର ବୁଝାଇବା ଯନ୍ତ୍ର ଧୀର ଚାଲିଛି। ତୁମ ବହିର ଏହି ଅଂଶ ପଢ଼ି ଦେଖ; ମୁଁ ପୁଣି ଚେଷ୍ଟା କରୁଛି।',
    teacher_told: 'ଏହି ଅଧ୍ୟାୟ ପାଇଁ ମୁଁ ତୁମ ଶିକ୍ଷକଙ୍କୁ ଜଣାଇଛି — ସେ ତୁମକୁ ସାହାଯ୍ୟ କରିବେ।',
    switched: '{0} ବହିରେ ଏହାର ଉତ୍ତର ଅଛି:',
    pick_subject: 'କେଉଁ ବିଷୟ?',
    all_subjects: 'ସବୁ ବିଷୟ',
    guided: 'ଗତି ଅଧ୍ୟାୟ ଅଭ୍ୟାସ',
    answer_here: 'ତୁମ ଉତ୍ତର ଲେଖ — କିମ୍ବା ନୂଆ ପ୍ରଶ୍ନ ପଚାର',
    progress: 'ମୋ ପ୍ରଗତି',
    no_progress: 'ପ୍ରଶ୍ନ ପଚାରିଲେ ଏଠାରେ ପ୍ରତି ଅଧ୍ୟାୟର ପ୍ରଗତି ଦେଖାଯିବ।',
    page: 'ପୃଷ୍ଠା',
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
    switched: 'The answer is in your {0} book:',
    pick_subject: 'Which subject?',
    all_subjects: 'All subjects',
    guided: 'Motion — guided practice',
    answer_here: 'Type your answer — or ask something new',
    progress: 'My progress',
    no_progress: 'Ask questions and your progress per chapter shows here.',
    page: 'page',
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
    switched: 'इसका उत्तर तुम्हारी {0} की किताब में है:',
    pick_subject: 'कौन सा विषय?',
    all_subjects: 'सभी विषय',
    guided: 'गति — अभ्यास',
    answer_here: 'अपना उत्तर लिखो — या नया सवाल पूछो',
    progress: 'मेरी प्रगति',
    no_progress: 'सवाल पूछो, यहाँ हर अध्याय की प्रगति दिखेगी।',
    page: 'पृष्ठ',
  },
};

export function TL(lang: string, key: string, ...args: string[]): string {
  const s = TUTOR_LINES[lang]?.[key] ?? TUTOR_LINES.en![key] ?? key;
  return args.reduce((acc, a, i) => acc.replace(`{${i}}`, a), s);
}

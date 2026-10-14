// Pedagogy guardrails (PLAN §6.5–§6.6, §6.2; TODO P2.42–P2.46, P2.49). Deterministic, so they hold offline too:
//  - homework-style problems get a hint ladder whose numbers come from the solver, never the final answer up front
//  - insisting on a wrong answer is met with the textbook, not agreement
//  - reading level sets sentence count, sentence length and the words to avoid
//  - numbers in a generated text are re-checked against the solver and repaired
//  - free-text answers are graded with a confidence that sets how much they move the learner model

import { normalizeDigits, toScriptDigits, parseQuantity, type Dimension } from './numerals.ts';
import { solveSuvat } from './solve.ts';
import { normalizeForMatch, soundKey } from './matcher.ts';
import { textIn, type CheckItem } from './pack.ts';

// ---------- quantities in text ----------

const UNIT_ALTS = [
  'km/h', 'km/hr', 'kmph', 'm/s²', 'm/s2', 'm/s^2', 'm/s', 'km', 'cm', 'metres', 'meters', 'metre', 'meter', 'm', 'minutes', 'minute', 'min',
  'ghanta', 'ghante', 'hours', 'hour', 'hr', 'h', 'seconds', 'second', 'sec', 's',
  'କିମି/ଘଣ୍ଟା', 'ମି/ସେ²', 'ମି/ସେ', 'କିଲୋମିଟର', 'କି.ମି', 'କିମି', 'ସେମି', 'ମିଟର', 'ମିନିଟ', 'ମି', 'ଘଣ୍ଟା', 'ସେକେଣ୍ଡ', 'ସେ',
  'किमी/घंटा', 'मी/से²', 'मी/से', 'किलोमीटर', 'किमी', 'सेमी', 'मीटर', 'मिनट', 'मी', 'घंटे', 'घंटा', 'सेकंड',
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// Latin units need a word end ("10 students" is not seconds); Odia/Hindi units take case endings (ଘଣ୍ଟାରେ = in … hours)
const QTY = new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALTS.map((u) => (/^ghant/.test(u) ? esc(u) : /^[a-z]/i.test(u) ? `${esc(u)}(?![a-z])` : esc(u))).join('|')})`, 'giu');

export interface Quantity { value: number; unit: string; dim: Dimension; si: number; index: number; raw: string }

/** Every number-with-a-unit in a text, in order (digits in any script). */
export function quantitiesIn(text: string): Quantity[] {
  const t = normalizeDigits(text);
  const out: Quantity[] = [];
  for (const m of t.matchAll(QTY)) {
    const q = parseQuantity(`${m[1]} ${m[2]}`);
    if (q?.dim && q.si !== undefined) out.push({ value: q.value, unit: q.unit!, dim: q.dim, si: q.si, index: m.index!, raw: m[0] });
  }
  return out;
}

// ---------- homework-style problems → hint ladder (P2.43) ----------

type Sym = 's' | 't' | 'v' | 'a';
const ASKED: [Sym, RegExp][] = [
  ['a', /accelerat|ତ୍ୱରଣ|त्वरण|twaran|tvaran/i],
  ['v', /speed|velocity|ଦ୍ରୁତି|ବେଗ|वेग|चाल|गति|druti|\bbega?\b|\bveg\b/i],
  ['s', /distance|how far|ଦୂରତା|ଦୂରତ୍ୱ|दूरी|durata|\bduri\b/i],
  ['t', /how long|\btime\b|ସମୟ|समय|samaya?\b|kete samay/i],
];
const FROM_REST = /from rest|starts? from rest|ସ୍ଥିର ଅବସ୍ଥାରୁ|ସ୍ଥିରାବସ୍ଥାରୁ|विराम(ावस्था)? से|sthira/i;
const TO_REST = /comes? to (rest|a stop)|stops|ଅଟକିଯାଏ|ଅଟକିଗଲା|ରହିଯାଏ|रुक जात/i;
const DIM_OF: Record<Sym, Dimension> = { s: 'length', t: 'time', v: 'speed', a: 'acceleration' };
const KMH_FAMILY = /^(ghanta|ghante|km|km\/h|km\/hr|kmph|h|hr|hour|hours|କିମି|କି\.ମି|କିଲୋମିଟର|ଘଣ୍ଟା|କିମି\/ଘଣ୍ଟା|किमी|किलोमीटर|घंटा|घंटे|किमी\/घंटा)$/;

export interface Problem {
  asked: Sym;
  conceptId: string;
  given: { sym: Sym | 'u'; q: Quantity }[];
  /** formula used, in symbols */
  formula: string;
  /** values put into the formula, in the units the working is done in */
  working: string;
  answer: { si: number; dim: Dimension; shown: number; unit: string };
  /** km/h family kept when every given quantity is in km and hours */
  kmh: boolean;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * A homework-style problem: at least two quantities with units and an asked quantity of a dimension not given, that
 * the solver can answer. Anything else is a conceptual doubt.
 */
export function parseProblem(text: string): Problem | undefined {
  const qs = quantitiesIn(text);
  if (qs.length < 2) return undefined;
  const dims = new Set(qs.map((q) => q.dim));
  const asked = ASKED.find(([sym, re]) => re.test(text) && !dims.has(DIM_OF[sym]))?.[0];
  if (!asked) return undefined;
  const one = (d: Dimension) => qs.filter((q) => q.dim === d);
  const [L, T, V, A] = [one('length')[0], one('time')[0], one('speed'), one('acceleration')[0]];
  const kmh = qs.every((q) => KMH_FAMILY.test(q.unit));
  const unitOf = (d: Dimension) => (d === 'speed' ? (kmh ? 'km/h' : 'm/s') : d === 'length' ? (kmh ? 'km' : 'm') : d === 'time' ? (kmh ? 'h' : 's') : 'm/s²');
  const toUnit = (si: number, d: Dimension) => (kmh ? (d === 'speed' ? si * 3.6 : d === 'length' ? si / 1000 : d === 'time' ? si / 3600 : si) : si);
  const show = (q: Quantity) => `${r3(toUnit(q.si, q.dim))} ${unitOf(q.dim)}`;
  const done = (sym: Sym, si: number, formula: string, working: string, given: Problem['given']): Problem => ({
    asked: sym, conceptId: sym === 'a' ? 'acceleration' : sym === 'v' ? (/velocity|ବେଗ|वेग|bega/i.test(text) ? 'velocity' : 'speed') : sym === 's' ? 'distance' : 'speed',
    given, formula, working, kmh, answer: { si: r3(si), dim: DIM_OF[sym], shown: r3(toUnit(si, DIM_OF[sym])), unit: unitOf(DIM_OF[sym]) },
  });

  // uniform motion: speed = distance ÷ time and its two rearrangements
  if (!A && V.length <= 1) {
    if (asked === 'v' && L && T && T.si) return done('v', L.si / T.si, 'v = s ÷ t', `${show(L)} ÷ ${show(T)}`, [{ sym: 's', q: L }, { sym: 't', q: T }]);
    if (asked === 's' && V[0] && T) return done('s', V[0].si * T.si, 's = v × t', `${show(V[0])} × ${show(T)}`, [{ sym: 'v', q: V[0] }, { sym: 't', q: T }]);
    if (asked === 't' && L && V[0] && V[0].si) return done('t', L.si / V[0].si, 't = s ÷ v', `${show(L)} ÷ ${show(V[0])}`, [{ sym: 's', q: L }, { sym: 'v', q: V[0] }]);
  }
  // uniformly accelerated motion: any three of s, u, v, a, t through the solver
  const k: { s?: number; u?: number; v?: number; a?: number; t?: number } = {};
  const given: Problem['given'] = [];
  if (L) { k.s = L.si; given.push({ sym: 's', q: L }); }
  if (T) { k.t = T.si; given.push({ sym: 't', q: T }); }
  if (A) { k.a = A.si; given.push({ sym: 'a', q: A }); }
  if (V.length >= 2) { k.u = V[0]!.si; k.v = V[1]!.si; given.push({ sym: 'u', q: V[0]! }, { sym: 'v', q: V[1]! }); }
  else if (V.length === 1) {
    if (FROM_REST.test(text)) { k.u = 0; k.v = V[0]!.si; given.push({ sym: 'v', q: V[0]! }); }
    else if (TO_REST.test(text)) { k.v = 0; k.u = V[0]!.si; given.push({ sym: 'u', q: V[0]! }); }
    else { k.u = V[0]!.si; given.push({ sym: 'u', q: V[0]! }); }
  } else if (FROM_REST.test(text)) k.u = 0;
  const res = solveSuvat(k);
  if (!res.ok) return undefined;
  const want = asked === 'v' ? 'v' : asked;
  const si = res.values[want];
  const formula = asked === 'a' ? (k.t !== undefined ? 'a = (v − u) ÷ t' : 'a = (v² − u²) ÷ 2s') : asked === 'v' ? (k.t !== undefined ? 'v = u + a × t' : 'v² = u² + 2as') : asked === 's' ? (k.a !== undefined ? 's = ut + ½at²' : 's = ½(u + v)t') : 't = (v − u) ÷ a';
  const sv = (x: number, d: Dimension) => `${r3(toUnit(x, d))} ${unitOf(d)}`;
  const working = [
    k.u !== undefined && `u = ${sv(k.u, 'speed')}`, k.v !== undefined && asked !== 'v' && `v = ${sv(k.v, 'speed')}`,
    k.a !== undefined && `a = ${sv(k.a, 'acceleration')}`, k.t !== undefined && asked !== 't' && `t = ${sv(k.t, 'time')}`, k.s !== undefined && asked !== 's' && `s = ${sv(k.s, 'length')}`,
  ].filter(Boolean).join(', ');
  return done(asked, si, formula, working, given);
}

const STR: Record<string, Record<string, string>> = {
  or: {
    intro: 'ଏହା ଗୋଟିଏ ହିସାବ। ମୁଁ ଉତ୍ତର କହିବି ନାହିଁ — ସୂଚନା ଦେବି, ତୁମେ ନିଜେ କର।',
    given: 'ଦିଆଯାଇଛି: {0}। ବାହାର କରିବାକୁ ହେବ: {1}।',
    convert: 'ପ୍ରଥମେ ସବୁ ଏକକ ମିଟର ଓ ସେକେଣ୍ଡକୁ ବଦଳାଅ: {0}।',
    formula: 'ସୂତ୍ର: {0}',
    put: 'ମାନ ବସାଅ: {0}। ଏବେ ହିସାବ କରି ତୁମ ଉତ୍ତର ଲେଖ।',
    answer: 'ଉତ୍ତର: {0}',
    s: 'ଦୂରତା (s)', t: 'ସମୟ (t)', v: 'ଦ୍ରୁତି (v)', a: 'ତ୍ୱରଣ (a)', u: 'ପ୍ରାରମ୍ଭିକ ବେଗ (u)',
  },
  hi: {
    intro: 'यह एक हिसाब है। मैं जवाब नहीं बताऊँगा — संकेत दूँगा, तुम खुद करो।',
    given: 'दिया है: {0}। निकालना है: {1}।',
    convert: 'पहले सब इकाइयाँ मीटर और सेकंड में बदलो: {0}।',
    formula: 'सूत्र: {0}',
    put: 'मान रखो: {0}। अब हिसाब करके अपना जवाब लिखो।',
    answer: 'जवाब: {0}',
    s: 'दूरी (s)', t: 'समय (t)', v: 'चाल (v)', a: 'त्वरण (a)', u: 'प्रारंभिक वेग (u)',
  },
  en: {
    intro: 'This is a sum. I will not give the answer — I will give hints and you work it out.',
    given: 'Given: {0}. To find: {1}.',
    convert: 'First change every unit to metres and seconds: {0}.',
    formula: 'Formula: {0}',
    put: 'Put in the values: {0}. Now work it out and write your answer.',
    answer: 'Answer: {0}',
    s: 'distance (s)', t: 'time (t)', v: 'speed (v)', a: 'acceleration (a)', u: 'initial velocity (u)',
  },
};
export const PSTR = (lang: string, key: string, ...args: string[]) =>
  (STR[lang]?.[key] ?? STR.en![key] ?? key).replace(/\{(\d)\}/g, (_, i) => args[Number(i)] ?? '');

export interface HintLadder { intro: string; steps: string[]; answer: Problem['answer'] & { text: string } }

/** given → (convert) → formula → put the values in. The answer is held back until she has tried (UI). */
export function hintLadder(p: Problem, lang: string): HintLadder {
  const L = (k: string, ...a: string[]) => PSTR(lang, k, ...a);
  const given = p.given.map((g) => `${L(g.sym)} = ${g.q.value} ${g.q.unit}`).join(', ');
  const steps = [L('given', given, L(p.asked))];
  const mixed = !p.kmh && p.given.some((g) => g.q.si !== g.q.value);
  if (mixed) steps.push(L('convert', p.given.filter((g) => g.q.si !== g.q.value).map((g) => `${g.q.value} ${g.q.unit} = ${r3(g.q.si)} ${g.q.dim === 'length' ? 'm' : g.q.dim === 'time' ? 's' : g.q.dim === 'speed' ? 'm/s' : 'm/s²'}`).join(', ')));
  steps.push(L('formula', p.formula), L('put', p.working));
  // numbers in her script (୧୫୦ in Odia), like the pack text
  return { intro: L('intro'), steps: steps.map((x) => toScriptDigits(x, lang)), answer: { ...p.answer, text: toScriptDigits(L('answer', `${p.answer.shown} ${p.answer.unit}`), lang) } };
}

// ---------- no sycophancy (P2.44) ----------

const INSIST = [
  /\b(my answer (is|was) (right|correct)|i('| a)?m (right|sure|correct)|it ?is (right|correct)|that'?s (right|correct)|you('| a)?re wrong|your answer is wrong|but i (think|know|wrote)|my teacher said|i am not wrong)\b/i,
  /\b(mo(ra)? uttara? (thik|sahi|thika)|mu (thik|sahi)|tume bhul|tumara bhul|mo answer thik|thik achi ta|mera (jawab|uttar) sahi|main sahi|aap galat|tum galat)\b/i,
  /ମୋ(ର)? ଉତ୍ତର ଠିକ|ମୁଁ ଠିକ୍|ତୁମେ ଭୁଲ|ଠିକ୍ ତ ଅଛି|ମୁଁ ଭୁଲ ନୁହେଁ/,
  /मेरा (जवाब|उत्तर) सही|मैं सही|आप गलत|तुम गलत/,
];
/** She is insisting that her (wrong) answer was right. */
export const insists = (text: string) => INSIST.some((r) => r.test(text.normalize('NFC')));
/** How long after a wrong answer an insisting message still refers to it. */
export const INSIST_WINDOW_MS = 30 * 60_000;

// ---------- reading level (P2.46) ----------

export interface LevelRule { maxSentences: number; maxWordsPerSentence: number; maxChars: number; steps: number }
/** Reading level 1–5 → how much text, how long each sentence, how many steps in a worked example. */
export const LEVEL: Record<number, LevelRule> = {
  1: { maxSentences: 3, maxWordsPerSentence: 9, maxChars: 250, steps: 2 },
  2: { maxSentences: 4, maxWordsPerSentence: 11, maxChars: 350, steps: 3 },
  3: { maxSentences: 5, maxWordsPerSentence: 14, maxChars: 500, steps: 3 },
  4: { maxSentences: 6, maxWordsPerSentence: 17, maxChars: 650, steps: 4 },
  5: { maxSentences: 7, maxWordsPerSentence: 20, maxChars: 800, steps: 5 },
};
export const levelRule = (level: number) => LEVEL[Math.min(5, Math.max(1, Math.round(level)))]!;

/**
 * Class vocabulary per reading level (C.10, P2.46): bookish words, the everyday word to use instead, and the reading
 * level from which the bookish word is fine. Textbook terms themselves are never here (they are taught, with the
 * English exam term). Draft lists — to be checked with a teacher (D6).
 */
export interface VocabEntry { word: string; easy: string; fromLevel: number }
export const VOCAB: Record<string, VocabEntry[]> = {
  or: [
    { word: 'ଅତଏବ', easy: 'ତେଣୁ', fromLevel: 5 }, { word: 'ତଦନୁସାରେ', easy: 'ସେହିପରି', fromLevel: 5 }, { word: 'ଉପରୋକ୍ତ', easy: 'ଉପରେ କହିଥିବା', fromLevel: 4 },
    { word: 'ନିମ୍ନୋକ୍ତ', easy: 'ତଳେ ଥିବା', fromLevel: 4 }, { word: 'ଯଥାକ୍ରମେ', easy: 'କ୍ରମରେ', fromLevel: 5 }, { word: 'ପରିପ୍ରେକ୍ଷୀରେ', easy: 'ଦୃଷ୍ଟିରୁ', fromLevel: 5 },
    { word: 'ସମ୍ପୃକ୍ତ', easy: 'ଜଡ଼ିତ', fromLevel: 4 }, { word: 'ପରିଲକ୍ଷିତ', easy: 'ଦେଖାଯାଏ', fromLevel: 4 }, { word: 'ନିର୍ଦ୍ଧାରଣ', easy: 'ଠିକ୍ କରିବା', fromLevel: 4 },
    { word: 'ଅନୁଧ୍ୟାନ', easy: 'ଦେଖିବା', fromLevel: 5 }, { word: 'ପରିମାପ', easy: 'ମାପ', fromLevel: 3 }, { word: 'ଉଦ୍ଦିଷ୍ଟ', easy: 'ପାଇଁ', fromLevel: 5 },
    { word: 'ଅବସ୍ଥିତ', easy: 'ଅଛି', fromLevel: 3 }, { word: 'ପ୍ରତିପାଦିତ', easy: 'ଦେଖାଗଲା', fromLevel: 5 },
  ],
  en: [
    { word: 'consequently', easy: 'so', fromLevel: 4 }, { word: 'therefore', easy: 'so', fromLevel: 3 }, { word: 'subsequently', easy: 'then', fromLevel: 5 },
    { word: 'approximately', easy: 'about', fromLevel: 4 }, { word: 'respectively', easy: 'in that order', fromLevel: 5 }, { word: 'phenomenon', easy: 'thing that happens', fromLevel: 4 },
    { word: 'equivalent', easy: 'equal', fromLevel: 4 }, { word: 'utilize', easy: 'use', fromLevel: 5 }, { word: 'commence', easy: 'start', fromLevel: 5 },
    { word: 'magnitude', easy: 'size', fromLevel: 4 }, { word: 'determine', easy: 'find', fromLevel: 3 }, { word: 'obtain', easy: 'get', fromLevel: 3 },
  ],
  hi: [
    { word: 'अतः', easy: 'इसलिए', fromLevel: 4 }, { word: 'तदनुसार', easy: 'उसी तरह', fromLevel: 5 }, { word: 'उपर्युक्त', easy: 'ऊपर वाला', fromLevel: 4 },
    { word: 'यथाक्रम', easy: 'क्रम से', fromLevel: 5 }, { word: 'परिलक्षित', easy: 'दिखता है', fromLevel: 5 }, { word: 'निर्धारित', easy: 'तय', fromLevel: 4 },
  ],
};
/** Words too bookish for her reading level, with the everyday word to use. */
export const vocabFor = (lang: string, level: number) => (VOCAB[lang] ?? []).filter((v) => level < v.fromLevel);
export const hardWordsIn = (text: string, lang: string, level = 3) => vocabFor(lang, level).filter((v) => text.toLowerCase().includes(v.word.toLowerCase())).map((v) => v.word);

/** Sentence count and the longest sentence in words (। . ! ? end sentences; numbers like 2.5 do not). */
export function sentenceStats(text: string) {
  const sentences = text.split(/(?<!\d)[।.!?]+(?!\d)/).map((s) => s.trim()).filter(Boolean);
  const words = sentences.map((s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length);
  return { sentences: sentences.length, longest: Math.max(0, ...words) };
}

// ---------- numbers re-checked by the solver (P2.49) ----------

export interface ArithmeticCheck { text: string; verified: number[]; fixes: string[] }

/**
 * In each sentence of a generated text, a distance, a time and a speed together must agree (v = s ÷ t). A wrong speed
 * (or distance, or time, whichever is last — the result) is replaced by the solver's value in the same unit. Numbers in
 * a relation that holds are "verified": the critic accepts them even if no source has them (a fresh worked example).
 */
export function checkArithmetic(text: string): ArithmeticCheck {
  const verified: number[] = [];
  const fixes: string[] = [];
  let out = text;
  const sentences = text.split(/(?<=[।.!?])(?!\d)\s*/);
  for (const sent of sentences) {
    const qs = quantitiesIn(sent);
    const L = qs.find((q) => q.dim === 'length'), T = qs.find((q) => q.dim === 'time'), V = qs.find((q) => q.dim === 'speed');
    if (!L || !T || !V || !T.si || !V.si) continue;
    const last = [L, T, V].sort((a, b) => b.index - a.index)[0]!;
    const want = last === V ? L.si / T.si : last === L ? V.si * T.si : L.si / V.si;
    if (Math.abs(last.si - want) <= Math.max(Math.abs(want) * 0.02, 1e-9)) { verified.push(L.value, T.value, V.value); continue; }
    const factor = last.si / last.value; // unit → SI
    const fixed = r3(want / factor);
    const orig = sent.slice(last.index, last.index + last.raw.length); // digit normalisation keeps positions
    const script = /[୦-୯]/.test(orig) ? 'or' : /[०-९]/.test(orig) ? 'hi' : 'en';
    const repl = toScriptDigits(last.raw.replace(/^-?\d+(?:\.\d+)?/, String(fixed)), script);
    out = out.replace(sent, sent.slice(0, last.index) + repl + sent.slice(last.index + last.raw.length));
    fixes.push(`${orig} → ${repl} (solver: ${last === V ? 'v = s ÷ t' : last === L ? 's = v × t' : 't = s ÷ v'})`);
    verified.push(L.value, T.value, V.value, fixed);
  }
  return { text: out, verified, fixes };
}

// ---------- free-text answers (P2.42) ----------

export interface TextGrade { correct: boolean; confidence: number; missing: string[]; reason: 'ok' | 'partial' | 'wrong' | 'empty' }

/**
 * Offline grading of a short written answer against the key ideas of the check (any script: spelling, romanization
 * and sound keys all count). A word match is weak evidence, so confidence stays low; online an LLM grades it instead.
 */
export function gradeFreeText(check: CheckItem, answer: string): TextGrade {
  const ideas = check.keyIdeas ?? [];
  const a = answer.trim();
  if (!a) return { correct: false, confidence: 0.3, missing: [], reason: 'empty' };
  const forms = new Set(a.split(/[^\p{L}\p{M}\p{N}]+/u).flatMap((w) => [normalizeForMatch(w), soundKey(w)]).filter((x): x is string => !!x));
  const hit = (variants: string[]) => variants.some((v) => v.split(/\s+/).every((w) => forms.has(normalizeForMatch(w)) || (soundKey(w) !== undefined && forms.has(soundKey(w)!))));
  const missing = ideas.filter((i) => !hit(Object.values(i)));
  const got = ideas.length - missing.length;
  const missingText = missing.map((i) => textIn(i, 'en'));
  if (ideas.length && got === ideas.length) return { correct: true, confidence: 0.5, missing: [], reason: 'ok' };
  if (got > 0) return { correct: false, confidence: 0.3, missing: missingText, reason: 'partial' };
  return { correct: false, confidence: 0.4, missing: missingText, reason: 'wrong' };
}

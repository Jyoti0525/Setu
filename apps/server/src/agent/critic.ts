// Deterministic critic (PLAN §5.8, §6.6, §6.7). Runs before any generated text reaches the learner.

import { extractNumbers, isUnsafe, checkArithmetic, levelRule, sentenceStats, hardWordsIn, LANGUAGES, type ChapterPack } from '@setu/core';

export interface CriticInput {
  text: string;
  lang: string;
  readingLevel: number;
  /** numbers allowed: from cited chunks, pack content of the concept, and `solve` results */
  allowedNumbers: number[];
  /** words that must not appear (correct option of the check that follows → answer leak) */
  answerKey: string[];
  pack: ChapterPack;
  /** concept being explained: its textbook term must appear (term consistency, PLAN §6.7) */
  conceptId?: string;
  /** numbered SOURCE chunks the text was written from, and the ones it says it used (P2.45) */
  sources?: string[];
  cites?: unknown;
}

export interface CriticResult {
  verdict: 'pass' | 'revise' | 'reject';
  checks: string[];
  problems: string[];
  /** the text after deterministic repairs (solver-corrected numbers, P2.49) */
  text: string;
  /** only problems a rule cannot judge for sure (term in another form, script ratio near the line) → LLM critic (P2.11) */
  borderline: boolean;
}

/** Problems a rule cannot be sure about; everything else it can. */
const BORDERLINE = [/^textbook term ".*" missing$/, /^script near the line/];

/** Unicode blocks for script checks. */
const SCRIPT_BLOCK: Record<string, [number, number]> = {
  or: [0x0b00, 0x0b7f], hi: [0x0900, 0x097f], mr: [0x0900, 0x097f], bn: [0x0980, 0x09ff], ta: [0x0b80, 0x0bff], te: [0x0c00, 0x0c7f], kn: [0x0c80, 0x0cff], ml: [0x0d00, 0x0d7f], gu: [0x0a80, 0x0aff], pa: [0x0a00, 0x0a7f],
};

// Safety lexicon: the shared child-safety layer (core safety.ts), the same on the phone and here.
export { isUnsafe };

export function critic(c: CriticInput): CriticResult {
  const checks: string[] = [];
  const problems: string[] = [];

  // 0. numbers re-checked by the solver: a wrong result in a distance–time–speed relation is replaced (P2.49)
  const arith = checkArithmetic(c.text.trim());
  const text = arith.text;
  if (arith.fixes.length) checks.push(`solver fixed: ${arith.fixes.join('; ')}`);

  // 1. non-empty, length/level (P2.46: sentence count, sentence length, bookish words)
  const rule = levelRule(c.readingLevel);
  const maxChars = rule.maxChars;
  const st = sentenceStats(text);
  checks.push(`length ${text.length}/${maxChars} chars, ${st.sentences}/${rule.maxSentences} sentences, longest ${st.longest}/${rule.maxWordsPerSentence} words`);
  if (!text) problems.push('empty');
  if (text.length > maxChars * 1.3) problems.push('too long for reading level');
  else if (text.length > maxChars) problems.push('slightly long');
  if (st.sentences > rule.maxSentences + 1) problems.push(`too many sentences for level ${c.readingLevel}`);
  if (st.longest > rule.maxWordsPerSentence * 1.5) problems.push('a sentence is too long for her level');
  const hard = hardWordsIn(text, c.lang, c.readingLevel);
  if (hard.length) problems.push(`bookish words: ${hard.join(', ')}`);

  // 2. script: target-language letters dominate; glossary English terms are whitelisted
  const block = LANGUAGES[c.lang]?.block ?? SCRIPT_BLOCK[c.lang];
  if (block) {
    const whitelist = new Set(c.pack.glossary.flatMap((g) => [g.english.toLowerCase(), ...Object.values(g.term).map((t) => t.toLowerCase())]).concat(['m/s', 'km/h', 'm', 's', 'km', 'si']));
    const words = text.replace(/[()[\]{}"'“”‘’,;:।.!?]/g, ' ').split(/\s+/).filter(Boolean);
    let target = 0, foreign = 0, otherIndic = 0;
    for (const w of words) {
      const letters = [...w].filter((ch) => /\p{L}/u.test(ch));
      if (!letters.length) continue;
      const inBlock = letters.filter((ch) => { const cp = ch.codePointAt(0)!; return cp >= block[0] && cp <= block[1]; }).length;
      const indicOther = letters.filter((ch) => { const cp = ch.codePointAt(0)!; return cp >= 0x0900 && cp <= 0x0dff && !(cp >= block[0] && cp <= block[1]); }).length;
      if (indicOther) otherIndic++;
      if (inBlock / letters.length > 0.5) target++;
      else if (!whitelist.has(w.toLowerCase())) foreign++;
    }
    const ratio = target / Math.max(1, target + foreign);
    checks.push(`script ${c.lang}: ${(ratio * 100).toFixed(0)}% target-script words, ${otherIndic} other-Indic`);
    if (otherIndic) problems.push('mixed Indic scripts');
    if (ratio < 0.5) problems.push('wrong script / too much English');
    else if (ratio < 0.6) problems.push(`script near the line (${(ratio * 100).toFixed(0)}% target script)`);
  }

  // 3. citations (P2.45): which SOURCE chunks it used; its numbers must come from those (or be solver-verified)
  let cited: string[] | undefined;
  if (c.sources?.length && c.cites !== undefined) {
    const ids = Array.isArray(c.cites) ? c.cites.map(Number).filter((n) => Number.isInteger(n)) : [];
    const bad = ids.filter((n) => n < 1 || n > c.sources!.length);
    checks.push(`cites [${ids.join(', ')}] of ${c.sources.length} sources`);
    if (!ids.length) problems.push('no source cited');
    if (bad.length) problems.push(`cites sources that do not exist: ${bad.join(', ')}`);
    cited = ids.filter((n) => !bad.includes(n)).map((n) => c.sources![n - 1]!);
  }

  // 4. numbers must be grounded (cited chunks / solve), never invented
  const nums = extractNumbers(text).filter((n) => !(Number.isInteger(n) && n >= 1 && n <= 3)); // tiny counting numbers ok ("one", "two")
  const allowed = new Set([...(cited?.length ? cited.flatMap(extractNumbers) : c.allowedNumbers), ...arith.verified].map((n) => round(n)));
  const bad = nums.filter((n) => !allowed.has(round(n)));
  checks.push(`numbers ${nums.length} checked, ${bad.length} ungrounded`);
  if (bad.length) problems.push(`ungrounded numbers: ${bad.join(', ')}`);

  // 5. answer leak
  const leak = c.answerKey.filter((k) => k.trim().length > 2 && text.toLowerCase().includes(k.toLowerCase()));
  checks.push(`answer-leak scan ${c.answerKey.length} keys`);
  if (leak.length) problems.push('answer leak');

  // 6. safety lexicon
  const unsafe = isUnsafe(text);
  checks.push('safety lexicon');
  if (unsafe) problems.push('unsafe content');

  // 7. term consistency with the pack glossary (= the cited textbook's terms)
  const entries = c.pack.glossary.filter((g) => g.term[c.lang]);
  const lower = text.toLowerCase();
  const wrong = entries.flatMap((g) => (g.avoid?.[c.lang] ?? []).filter((w) => lower.includes(w.toLowerCase())));
  const own = c.conceptId ? entries.find((g) => g.conceptId === c.conceptId) : undefined;
  const missing = own && !lower.includes(own.term[c.lang]!.toLowerCase());
  checks.push(`terms: ${entries.length} glossary terms${own ? `, requires "${own.term[c.lang]}"` : ''}`);
  if (wrong.length) problems.push(`non-textbook terms: ${wrong.join(', ')}`);
  if (missing) problems.push(`textbook term "${own!.term[c.lang]}" missing`);

  const serious = problems.filter((p) => p !== 'slightly long');
  const verdict = !serious.length ? 'pass' : serious.some((p) => p === 'unsafe content' || p === 'answer leak' || p.startsWith('ungrounded') || p === 'mixed Indic scripts') ? 'reject' : 'revise';
  const borderline = verdict === 'revise' && serious.every((p) => BORDERLINE.some((r) => r.test(p)));
  return { verdict, checks, problems, text, borderline };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

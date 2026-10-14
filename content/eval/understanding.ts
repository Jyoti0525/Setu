// Understanding test set (TODO P6.4): concept + intent accuracy of the offline path (phone, no network) per input form.
// The online path (decide LLM's `understood`) is scored by apps/server/eval/live.ts with the same set.
import { MATCH_CONFIDENT, PackMatcher, parseProblem, screen, type ChapterPack } from '@setu/core';
import set from './understanding.json' with { type: 'json' };

export interface Item { text: string; concept: string | null; intent: 'conceptual' | 'homework' | 'off_topic'; form: string }
export const ITEMS = set.items as Item[];

/** What the phone understands with no network: the same rules the engine uses (matcher threshold, solver, screen). */
export function offline(pack: ChapterPack, text: string): { concept: string | null; intent: Item['intent'] } {
  const m = new PackMatcher(pack).match(text);
  const unmatched = !m.conceptId || (m.confidence < MATCH_CONFIDENT && !m.faqId);
  const p = parseProblem(text);
  if (p) return { concept: p.conceptId === 'velocity' || p.conceptId === 'speed' ? p.conceptId : p.conceptId, intent: 'homework' };
  return { concept: unmatched ? null : m.conceptId!, intent: screen(text, unmatched) === 'off_topic' ? 'off_topic' : 'conceptual' };
}

export function score(pack: ChapterPack, guess: (text: string) => { concept: string | null; intent: string } = (t) => offline(pack, t)) {
  const rows = ITEMS.map((i) => ({ ...i, got: guess(i.text) }));
  const acc = (xs: typeof rows, k: 'concept' | 'intent') => xs.length ? Math.round((100 * xs.filter((r) => r.got[k] === r[k]).length) / xs.length) : null;
  const forms = [...new Set(ITEMS.map((i) => i.form))];
  return {
    concept: acc(rows, 'concept'), intent: acc(rows, 'intent'),
    byForm: Object.fromEntries(forms.map((f) => [f, { n: rows.filter((r) => r.form === f).length, concept: acc(rows.filter((r) => r.form === f), 'concept') }])),
    misses: rows.filter((r) => r.got.concept !== r.concept || r.got.intent !== r.intent).map((r) => `${r.text} → ${r.got.concept}/${r.got.intent} (want ${r.concept}/${r.intent})`),
  };
}

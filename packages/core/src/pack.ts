// Chapter pack format (PLAN §8.3, §7.2, §7.3, §11). Everything the device tier needs.

import type { ConceptGraph } from './graph.ts';
import type { Dimension } from './numerals.ts';

/** Text in several languages: { or: '...', en: '...', hi: '...' } */
export type L10n = Record<string, string>;

/** Every learner-facing text has a display form and a speakable form (PLAN §7.2). */
export interface Utterance {
  display: L10n;
  /** what TTS reads: no brackets, formulas in words, units expanded. Falls back to display. */
  speak?: L10n;
}

export type ReviewStatus = 'draft' | 'reviewed';

export interface Explanation {
  /** `itemId@version` */
  id: string;
  conceptId: string;
  strategy: 'definition' | 'analogy' | 'worked_example' | 'contrast' | 'story' | (string & {});
  /** reading level the text targets (1 easiest – 5) */
  level: number;
  body: Utterance;
  /** misconception this explanation is designed to fix, if any */
  targets?: string[];
  /** P3.22: a local analogy for these regions (see REGIONS); untagged = fits everywhere */
  regions?: string[];
  review: Record<string, ReviewStatus>;
}

/**
 * Regions for local analogies (PLAN §7.1.5). A class is in one; examples come from what learners there see daily.
 * `examples` also steers live generation. Draft — to be checked with teachers from each region.
 */
export const REGIONS: Record<string, { name: L10n; examples: string }> = {
  coastal: { name: { or: 'ଉପକୂଳ ଓଡ଼ିଶା', en: 'Coastal Odisha', hi: 'तटीय ओडिशा' }, examples: 'fishing boats, the river current, the sea shore, the Puri–Cuttack bus, the cyclone shelter' },
  western: { name: { or: 'ପଶ୍ଚିମ ଓଡ଼ିଶା', en: 'Western Odisha', hi: 'पश्चिमी ओडिशा' }, examples: 'paddy fields, the weekly haat, a bullock cart, the canal from Hirakud, cycling to school' },
  southern_hills: { name: { or: 'ଦକ୍ଷିଣ ପାହାଡ଼ ଅଞ୍ଚଳ', en: 'Southern hills', hi: 'दक्षिणी पहाड़ी इलाका' }, examples: 'the hill road, walking to the weekly haat, millet (mandia) fields, a stream down the hill, the forest path' },
};

export interface CheckOption {
  id: string;
  text: L10n;
  correct: boolean;
  /** choosing this distractor signals these misconceptions */
  misconceptionIds: string[];
  /** short feedback shown when chosen */
  feedback?: L10n;
}

export interface CheckItem {
  id: string; // `itemId@version`
  conceptId: string;
  /** text: a short written answer, graded on its key ideas (offline: weak evidence; online: LLM grade with confidence) */
  kind: 'mcq' | 'numeric' | 'text';
  stem: Utterance;
  options?: CheckOption[];
  /** numeric key in SI units — always produced by `solve`, never typed by hand */
  numeric?: { value: number; dim?: Dimension; tol?: number; solveRef?: string };
  /** text checks: the ideas a right answer contains; each idea lists its words per language (+ `romanized`) */
  keyIdeas?: L10n[];
  /** text checks: a model answer (for the online grader and for showing after she tries) */
  model?: L10n;
  /** mastery-affecting only when reviewed (PLAN §6.5) */
  review: Record<string, ReviewStatus>;
  placement?: boolean;
  difficulty: 1 | 2 | 3;
}

export interface GlossaryEntry {
  conceptId: string;
  /** textbook term in each language */
  term: L10n;
  /** English exam term */
  english: string;
  /** everyday phrase (term bridge, PLAN §7.1) */
  everyday: L10n;
  /** romanized spellings learners type, e.g. "bega", "beg" */
  romanized: string[];
  /** wrong or non-textbook terms per language that generated text must not use (critic term check, PLAN §6.7) */
  avoid?: Partial<Record<string, string[]>>;
}

export interface Misconception {
  id: string;
  conceptId: string;
  description: L10n;
  severity: number;
  /** remediation strategy ids that target it */
  remediation: string[];
}

export interface FaqEntry {
  id: string;
  conceptId: string;
  /** match keys in every script: Odia, romanized variants, English, code-mixed (PLAN §7.3) */
  keys: string[];
  answer: Utterance;
}

export interface Passage {
  id: string;
  conceptId: string;
  /** clean textbook text (used for grounding and Snap locate) */
  text: L10n;
  page?: number;
}

export interface ChapterPack {
  id: string;
  version: number;
  subject: string;
  classLevel: number;
  board: string;
  title: L10n;
  languages: string[];
  graph: ConceptGraph;
  explanations: Explanation[];
  checks: CheckItem[];
  glossary: GlossaryEntry[];
  misconceptions: Misconception[];
  faq: FaqEntry[];
  passages: Passage[];
  /** audio file per utterance hash, filled by the pack builder */
  audio?: Record<string, { lang: string; file: string; bytes: number }>;
  /** sha256 of the canonical JSON without this field */
  hash?: string;
}

export const itemBase = (id: string) => id.split('@')[0]!;

export function textIn(l: L10n | undefined, lang: string, fallback = 'en'): string {
  if (!l) return '';
  return l[lang] ?? l[fallback] ?? Object.values(l)[0] ?? '';
}

export function speakIn(u: Utterance, lang: string): string {
  return u.speak?.[lang] ?? u.display[lang] ?? textIn(u.display, lang);
}

/** Content checks run by the pack builder and in tests. */
export function validatePack(p: ChapterPack): string[] {
  const errs: string[] = [];
  const concepts = new Set(Object.keys(p.graph.concepts));
  const ids = new Set<string>();
  const add = (id: string) => { if (ids.has(id)) errs.push(`duplicate id ${id}`); ids.add(id); if (!/@\d+$/.test(id)) errs.push(`unversioned id ${id}`); };
  const misc = new Set(p.misconceptions.map((m) => m.id));
  for (const e of p.explanations) {
    add(e.id);
    if (!concepts.has(e.conceptId)) errs.push(`${e.id}: unknown concept ${e.conceptId}`);
    for (const l of p.languages) if (!e.body.display[l]) errs.push(`${e.id}: missing ${l}`);
    for (const t of e.targets ?? []) if (!misc.has(t)) errs.push(`${e.id}: unknown misconception ${t}`);
  }
  for (const c of p.checks) {
    add(c.id);
    if (!concepts.has(c.conceptId)) errs.push(`${c.id}: unknown concept ${c.conceptId}`);
    for (const l of p.languages) if (!c.stem.display[l]) errs.push(`${c.id}: stem missing ${l}`);
    if (c.kind === 'mcq') {
      const opts = c.options ?? [];
      if (opts.filter((o) => o.correct).length !== 1) errs.push(`${c.id}: needs exactly one correct option`);
      for (const o of opts) {
        for (const l of p.languages) if (!o.text[l]) errs.push(`${c.id}/${o.id}: missing ${l}`);
        for (const m of o.misconceptionIds) if (!misc.has(m)) errs.push(`${c.id}/${o.id}: unknown misconception ${m}`);
      }
    }
    if (c.kind === 'numeric' && !c.numeric) errs.push(`${c.id}: numeric check without key`);
    if (c.kind === 'text' && !c.keyIdeas?.length) errs.push(`${c.id}: text check without key ideas`);
  }
  for (const m of p.misconceptions) if (!concepts.has(m.conceptId)) errs.push(`${m.id}: unknown concept`);
  for (const g of p.glossary) if (!concepts.has(g.conceptId)) errs.push(`glossary ${g.english}: unknown concept`);
  for (const f of p.faq) { if (!concepts.has(f.conceptId)) errs.push(`${f.id}: unknown concept`); }
  return errs;
}

// ---------- pack updates as small diffs (P4.14) ----------

/**
 * Only what changed between two versions of a pack: for each item list, the new order of item keys plus the items
 * that are new or changed (by `itemId@version` / content); other fields are replaced only when they changed.
 * Applying it to the old pack rebuilds the new one exactly (same key order → same hash), which the phone verifies.
 */
export interface PackDiff {
  from: string;
  to: string;
  lists: Record<string, { order: string[]; upsert: unknown[] }>;
  fields: Record<string, unknown>;
}

const LIST_KEYS = ['explanations', 'checks', 'glossary', 'misconceptions', 'faq', 'passages'] as const;
const itemKey = (x: unknown) => { const o = x as { id?: string; conceptId?: string }; return o.id ?? `concept:${o.conceptId}`; };

export function packDiff(a: ChapterPack, b: ChapterPack, hashes: { from: string; to: string }): PackDiff {
  const lists: PackDiff['lists'] = {};
  const fields: Record<string, unknown> = {};
  for (const k of Object.keys(b) as (keyof ChapterPack)[]) {
    if (k === 'hash') continue;
    if ((LIST_KEYS as readonly string[]).includes(k)) {
      const old = new Map(((a[k] as unknown[]) ?? []).map((x) => [itemKey(x), JSON.stringify(x)]));
      const items = b[k] as unknown[];
      const order = items.map(itemKey);
      lists[k] = { order, upsert: items.filter((x) => old.get(itemKey(x)) !== JSON.stringify(x)) };
      if (!lists[k]!.upsert.length && order.join('\n') === ((a[k] as unknown[]) ?? []).map(itemKey).join('\n')) delete lists[k];
    } else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) fields[k] = b[k];
  }
  // key order of the pack object itself must match too: send it when it differs (rare)
  const order = Object.keys(b).filter((k) => k !== 'hash');
  if (order.join() !== Object.keys(a).filter((k) => k !== 'hash').join()) fields.__order = order;
  return { from: hashes.from, to: hashes.to, lists, fields };
}

export function applyPackDiff(a: ChapterPack, d: PackDiff): ChapterPack {
  const { hash: _h, ...base } = a;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(d.fields)) if (k !== '__order') out[k] = v;
  for (const [k, l] of Object.entries(d.lists)) {
    const pool = new Map(((out[k] as unknown[]) ?? []).map((x) => [itemKey(x), x]));
    for (const x of l.upsert) pool.set(itemKey(x), x);
    out[k] = l.order.map((key) => { const x = pool.get(key); if (!x) throw new Error(`pack diff: missing item ${key}`); return x; });
  }
  const order = (d.fields.__order as string[] | undefined) ?? Object.keys(base);
  return Object.fromEntries(order.filter((k) => k in out).map((k) => [k, out[k]])) as unknown as ChapterPack;
}

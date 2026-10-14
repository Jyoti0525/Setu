// Native review of pack language (TODO D6, C.7, PLAN §6.5). Every learner-facing text field of a pack gets a stable id;
// a reviewer marks each one ok / fixed (with the corrected text). Applying the decisions:
//   • fixed text replaces the draft,
//   • an explanation or check whose every field in that language is ok/fixed becomes `reviewed` for it —
//     the gate that lets it move mastery (drafts never do, PLAN §6.5).
import type { ChapterPack, L10n } from '@setu/core';

export interface ReviewDecision { status: 'ok' | 'fixed' | 'unsure'; text?: string; note?: string; audio?: 'good' | 'bad'; by?: string; at?: number }
export type ReviewDecisions = Record<string, ReviewDecision>;

export interface PackField {
  /** stable id: `<itemId>#<field>` */
  id: string;
  /** explanation / check id whose review status this field gates */
  gates?: string;
  kind: 'title' | 'concept' | 'explanation' | 'check' | 'option' | 'feedback' | 'glossary' | 'misconception' | 'faq' | 'passage';
  l10n: L10n;
  /** the line the phone speaks for this field (for the audio clip), when it differs from the text */
  speakOf?: string;
}

export function packFields(p: ChapterPack): PackField[] {
  const f: PackField[] = [];
  f.push({ id: 'pack#title', kind: 'title', l10n: p.title });
  for (const c of Object.values(p.graph.concepts)) f.push({ id: `concept.${c.id}#name`, kind: 'concept', l10n: c.name });
  for (const e of p.explanations) {
    f.push({ id: `${e.id}#display`, gates: e.id, kind: 'explanation', l10n: e.body.display });
    if (e.body.speak) f.push({ id: `${e.id}#speak`, gates: e.id, kind: 'explanation', l10n: e.body.speak });
  }
  for (const k of p.checks) {
    f.push({ id: `${k.id}#stem`, gates: k.id, kind: 'check', l10n: k.stem.display });
    if (k.stem.speak) f.push({ id: `${k.id}#stem.speak`, gates: k.id, kind: 'check', l10n: k.stem.speak });
    for (const o of k.options ?? []) {
      f.push({ id: `${k.id}#opt.${o.id}`, gates: k.id, kind: 'option', l10n: o.text });
      if (o.feedback) f.push({ id: `${k.id}#opt.${o.id}.fb`, gates: k.id, kind: 'feedback', l10n: o.feedback });
    }
  }
  for (const g of p.glossary) {
    f.push({ id: `gloss.${g.conceptId}#term`, kind: 'glossary', l10n: g.term });
    f.push({ id: `gloss.${g.conceptId}#everyday`, kind: 'glossary', l10n: g.everyday });
  }
  for (const m of p.misconceptions) f.push({ id: `mis.${m.id}#desc`, kind: 'misconception', l10n: m.description });
  for (const q of p.faq) {
    f.push({ id: `${q.id}#answer`, kind: 'faq', l10n: q.answer.display });
    if (q.answer.speak) f.push({ id: `${q.id}#answer.speak`, kind: 'faq', l10n: q.answer.speak });
  }
  for (const ps of p.passages) f.push({ id: `${ps.id}#text`, kind: 'passage', l10n: ps.text });
  return f;
}

/** Returns a copy of the pack with the reviewer's fixes in and review status set where every field passed. */
export function applyReview(pack: ChapterPack, lang: string, decisions: ReviewDecisions): ChapterPack {
  if (!Object.keys(decisions).length) return pack;
  const p = structuredClone(pack);
  const fields = packFields(p).filter((x) => x.l10n[lang] !== undefined);
  const pass = new Map<string, boolean>();
  for (const x of fields) {
    const d = decisions[x.id];
    if (d?.status === 'fixed' && d.text?.trim()) x.l10n[lang] = d.text.trim();
    if (x.gates) pass.set(x.gates, (pass.get(x.gates) ?? true) && (d?.status === 'ok' || (d?.status === 'fixed' && !!d.text?.trim())));
  }
  for (const it of [...p.explanations, ...p.checks]) if (pass.get(it.id)) it.review = { ...it.review, [lang]: 'reviewed' };
  return p;
}

/**
 * Machine-drafted text for a language the pack was not authored in (P3.31: translation only drafts long-tail packs).
 * Fills only fields that have no text in that language; the language is added to the pack, every item stays a draft
 * for it until a native reviewer passes it (so it never moves mastery on its own).
 */
export type Translations = Record<string, { text: string; by: string; at: number }>;
export function applyTranslation(p: ChapterPack, lang: string, tr: Translations): ChapterPack {
  const out = structuredClone(p);
  let n = 0;
  for (const f of packFields(out)) {
    const t = tr[f.id];
    if (t?.text && !f.l10n[lang]) { f.l10n[lang] = t.text; n++; }
  }
  if (n && !out.languages.includes(lang)) out.languages = [...out.languages, lang];
  return out;
}

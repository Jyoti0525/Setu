// Teacher-facing notes the decide model writes in English (new-misconception candidates, P2.41) → the class language.
// Groq writes Odia badly, so this uses the generation model for that language (Gemini for Odia), off the learner's
// turn: the teacher view shows English until the translation is cached, then the translation with the English
// under it. Never shown to learners, so no critic; the teacher can always compare with the English.

import type { LlmRequest } from '@google/adk';
import { audioKey } from '@setu/core';
import { canCall } from './llm.ts';
import { parseJson, textOf, type CycleDeps } from './agent/cycle.ts';

const NAMES: Record<string, string> = { or: 'Odia', hi: 'Hindi' };
const inFlight = new Set<string>();

export interface Note { description: string; evidence: string }

const cacheKey = (lang: string, n: Note) => `tr:${lang}:${audioKey(n.description + '\n' + n.evidence)}`;

/** The cached translation, or undefined (and a translation is started in the background if one can be). */
export function translatedNote(deps: CycleDeps, n: Note, lang: string): Note | undefined {
  if (!NAMES[lang]) return undefined;
  const key = cacheKey(lang, n);
  const hit = deps.store.cacheGet(key);
  if (hit) return JSON.parse(hit) as Note;
  void translateNote(deps, n, lang);
  return undefined;
}

export async function translateNote(deps: CycleDeps, n: Note, lang: string): Promise<Note | undefined> {
  const key = cacheKey(lang, n);
  const model = deps.models.generateFor(lang);
  if (!NAMES[lang] || inFlight.has(key) || !model || !canCall(deps.models, 'generate', deps.models.genKeysFor(lang))) return undefined;
  inFlight.add(key);
  try {
    const prompt = `Translate two short notes for a Class 9 science teacher in ${lang === 'or' ? 'Odisha' : 'India'} into ${NAMES[lang]}.
Use the physics terms of the state Class 9 ${NAMES[lang]} textbook and keep the English term in brackets after a technical word, e.g. "ବେଗ (speed)".
Keep every number, unit and symbol exactly as written. Plain, polite teacher-to-teacher language. Do not add or explain anything.
Return JSON only: {"description": "...", "evidence": "..."}

description: ${n.description}
evidence: ${n.evidence}`;
    const req = { contents: [{ role: 'user', parts: [{ text: 'Translate now.' }] }], config: { systemInstruction: prompt, temperature: 0.2, responseMimeType: 'application/json' }, liveConnectConfig: {}, toolsDict: {} } as unknown as LlmRequest;
    let last;
    for await (const r of model.generateContentAsync(req)) last = r;
    const j = parseJson(last ? textOf(last) : '') as Partial<Note> | null;
    const clean = (x: unknown) => String(x ?? '').replace(/[<>{}`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
    const out = { description: clean(j?.description), evidence: clean(j?.evidence) };
    // a translation that lost a number, or is not in the target script, is not used
    const script = { or: /[଀-୿]/, hi: /[ऀ-ॿ]/ }[lang as 'or' | 'hi'];
    const nums = (t: string) => (t.match(/\d+(?:\.\d+)?/g) ?? []).sort().join(',');
    const digits = (t: string) => t.replace(/[୦-୯]/g, (d) => String(d.charCodeAt(0) - 0x0b66)).replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
    if (!out.description || !script?.test(out.description) || nums(digits(out.description + ' ' + out.evidence)) !== nums(n.description + ' ' + n.evidence)) return undefined;
    deps.store.cacheSet(key, JSON.stringify(out));
    return out;
  } catch {
    return undefined; // provider down: English stays, tried again on the next view
  } finally {
    inFlight.delete(key);
  }
}

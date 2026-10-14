// Language tiers and language-quality-aware generation (PLAN §7.4, §7.5; TODO P3.26, P3.27).
// One table, used by the server (who may write live text in which language) and the phone (what to offer).

export type LangTier = 'A' | 'B' | 'C';

export interface LangInfo {
  id: string;
  /** name in its own script, as shown on the language picker */
  name: string;
  english: string;
  /** A full (voice, live generation, reviewed packs, Snap) · B text-first · C bridge (teach in the school language) */
  tier: LangTier;
  /** Unicode block of its script (critic script check), or undefined for Latin */
  block?: [number, number];
  /**
   * Measured quality of live generation, 0–1, with where the number comes from. Below LIVE_GEN_MIN the LLM only
   * understands and plans in this language; what she reads comes from the reviewed pack. null = not measured → off.
   */
  gen: { score: number | null; source: string };
  /** tier C: the school language Setu teaches in, with home-language anchors */
  school?: string;
}

export const LIVE_GEN_MIN = 0.7;

export const LANGUAGES: Record<string, LangInfo> = {
  or: { id: 'or', name: 'ଓଡ଼ିଆ', english: 'Odia', tier: 'A', block: [0x0b00, 0x0b7f], gen: { score: 0.75, source: 'P0.a: Gemini writers use the BSE terms and pass the critic on the sample; native rubric of 30 answers pending (D6) — Gemini only, behind the critic' } },
  en: { id: 'en', name: 'English', english: 'English', tier: 'A', gen: { score: 0.95, source: 'all providers; critic' } },
  hi: { id: 'hi', name: 'हिन्दी', english: 'Hindi', tier: 'A', block: [0x0900, 0x097f], gen: { score: 0.8, source: 'P0.f: Groq/Gemini fluent; terms not yet rubric-scored (P6)' } },
  bn: { id: 'bn', name: 'বাংলা', english: 'Bengali', tier: 'B', block: [0x0980, 0x09ff], gen: { score: null, source: 'not measured' } },
  te: { id: 'te', name: 'తెలుగు', english: 'Telugu', tier: 'B', block: [0x0c00, 0x0c7f], gen: { score: null, source: 'not measured' } },
  sat: { id: 'sat', name: 'ᱥᱟᱱᱛᱟᱲᱤ', english: 'Santali', tier: 'C', block: [0x1c50, 0x1c7f], gen: { score: null, source: 'no reliable free model' }, school: 'or' },
  kxu: { id: 'kxu', name: 'Kui', english: 'Kui', tier: 'C', gen: { score: null, source: 'no model, no standard script in schools' }, school: 'or' },
  hoc: { id: 'hoc', name: 'Ho', english: 'Ho', tier: 'C', gen: { score: null, source: 'no reliable free model' }, school: 'or' },
};

/** Languages whose measured quality allows live generated text (the critic still checks every line). */
export const liveGenLanguages = (): string[] => Object.values(LANGUAGES).filter((l) => (l.gen.score ?? 0) >= LIVE_GEN_MIN).map((l) => l.id);

/** Home languages Setu bridges from (tier C): taught in the school language, with her teacher's home-language words. */
export const bridgeLanguages = (): LangInfo[] => Object.values(LANGUAGES).filter((l) => l.tier === 'C');

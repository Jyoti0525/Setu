// Language tiers and language-quality-aware generation (PLAN §7.4, §7.5; TODO P3.26, P3.27).
// One table, used by the server (who may write live text in which language) and the phone (what to offer).

export type LangTier = 'A' | 'B' | 'C';

export interface LangInfo {
  id: string;
  /** name in its own script, as shown on the language picker */
  name: string;
  english: string;
  /** A full (voice, live generation, reviewed packs, Snap) · B text-first (AI-written replies) · C bridge (teach in the school language with her home-language words) */
  tier: LangTier;
  /** Unicode block of its script (critic script check), or undefined for Latin */
  block?: [number, number];
  /**
   * Measured quality of live generation, 0–1, with where the number comes from. Below LIVE_GEN_MIN the LLM only
   * understands and plans in this language; what she reads comes from the reviewed pack. null = not measured → off.
   */
  gen: { score: number | null; source: string };
  /** the school language: tier C is taught in it (with home-language words); others show its key terms beside theirs */
  school?: string;
  /** what she reads in this language is an unreviewed AI draft (no speaker has checked it yet): the app says so */
  draft?: boolean;
  /** tier C: a home-language word list from the government dictionaries exists (content/tribal/<id>.json) */
  words?: boolean;
}

export const LIVE_GEN_MIN = 0.7;

export const LANGUAGES: Record<string, LangInfo> = {
  or: { id: 'or', name: 'ଓଡ଼ିଆ', english: 'Odia', tier: 'A', block: [0x0b00, 0x0b7f], gen: { score: 0.75, source: 'P0.a: Gemini writers use the BSE terms and pass the critic on the sample; native rubric of 30 answers pending (D6) — Gemini only, behind the critic' } },
  en: { id: 'en', name: 'English', english: 'English', tier: 'A', gen: { score: 0.95, source: 'all providers; critic' } },
  hi: { id: 'hi', name: 'हिन्दी', english: 'Hindi', tier: 'A', block: [0x0900, 0x097f], gen: { score: 0.8, source: 'P0.f: Groq/Gemini fluent; terms not yet rubric-scored (P6)' } },
  // 2026-10-15 probe (Gemini Flash-Lite, "what is a tissue" for a Class 9 village student, back-translated by a second
  // call): natural school language with the board's own term (কলা, ಅಂಗಾಂಶ, కణజాలం, திசு, उती). Not yet
  // rubric-scored by a speaker: draft until then (interface lines are drafts too, packages/core/src/locales).
  bn: { id: 'bn', name: 'বাংলা', english: 'Bengali', tier: 'B', block: [0x0980, 0x09ff], gen: { score: 0.8, source: '2026-10-15 probe: natural Bengali, textbook term কলা (tissue); speaker review pending' }, draft: true },
  kn: { id: 'kn', name: 'ಕನ್ನಡ', english: 'Kannada', tier: 'B', block: [0x0c80, 0x0cff], gen: { score: 0.8, source: '2026-10-15 probe: natural Kannada, textbook term ಅಂಗಾಂಶ (tissue); speaker review pending' }, draft: true },
  te: { id: 'te', name: 'తెలుగు', english: 'Telugu', tier: 'B', block: [0x0c00, 0x0c7f], gen: { score: 0.8, source: '2026-10-15 probe: natural Telugu, textbook term కణజాలం (tissue); speaker review pending' }, draft: true },
  ta: { id: 'ta', name: 'தமிழ்', english: 'Tamil', tier: 'B', block: [0x0b80, 0x0bff], gen: { score: 0.8, source: '2026-10-15 probe: natural Tamil, textbook term திசு (tissue); speaker review pending' }, draft: true },
  mr: { id: 'mr', name: 'मराठी', english: 'Marathi', tier: 'B', block: [0x0900, 0x097f], gen: { score: 0.8, source: '2026-10-15 probe: natural Marathi, textbook term उती (tissue); speaker review pending' }, draft: true },
  bho: { id: 'bho', name: 'भोजपुरी', english: 'Bhojpuri', tier: 'B', block: [0x0900, 0x097f], gen: { score: 0.7, source: '2026-10-15 probe: everyday Bhojpuri (करेला, कहल जाला), science terms from Hindi; speaker review pending' }, draft: true, school: 'hi' },
  // Santali: the only tribal language a free model writes (Ol Chiki, real Santali words: ᱢᱤᱫ ᱞᱮᱠᱟᱱ, ᱠᱟᱹᱢᱤ, ᱢᱮᱛᱟᱜᱼᱟ).
  // Every reply also shows its key words in Odia and English (the school's words), so a wrong Santali word is caught.
  sat: { id: 'sat', name: 'ᱥᱟᱱᱛᱟᱲᱤ', english: 'Santali', tier: 'B', block: [0x1c50, 0x1c7f], gen: { score: 0.7, source: '2026-10-15 probe: Gemini Flash-Lite writes Santali in Ol Chiki (back-translation by a second call reads as Santali); no Santali speaker has reviewed it yet' }, draft: true, school: 'or' },
  // Tier C: no free model writes these (2026-10-15 probe: "Kui" and "Saora" came out as plain Odia, "Ho" in Warang
  // Citi as repeated letters). Setu teaches in simple Odia and adds her home-language words from the Government of
  // Odisha's Odia–<language> dictionaries and trilingual primers (content/tribal/), never words a model made up.
  kxu: { id: 'kxu', name: 'କୁଇ', english: 'Kui', tier: 'C', gen: { score: null, source: 'no model writes Kui (probe: plain Odia)' }, school: 'or', words: true },
  kxv: { id: 'kxv', name: 'କୁଭି', english: 'Kuvi', tier: 'C', gen: { score: null, source: 'no model writes Kuvi' }, school: 'or', words: true },
  hoc: { id: 'hoc', name: 'ହୋ', english: 'Ho', tier: 'C', gen: { score: null, source: 'no model writes Ho (probe: Warang Citi garbage)' }, school: 'or', words: true },
  srb: { id: 'srb', name: 'ସଉରା', english: 'Saora', tier: 'C', gen: { score: null, source: 'no model writes Saora (probe: plain Odia)' }, school: 'or', words: true },
  unr: { id: 'unr', name: 'ମୁଣ୍ଡା', english: 'Munda', tier: 'C', gen: { score: null, source: 'no reliable free model for Mundari' }, school: 'or', words: true },
};

/** Languages whose measured quality allows live generated text (the critic still checks every line). */
export const liveGenLanguages = (): string[] => Object.values(LANGUAGES).filter((l) => (l.gen.score ?? 0) >= LIVE_GEN_MIN).map((l) => l.id);

/** Home languages Setu bridges from (tier C): taught in the school language, with her teacher's home-language words. */
export const bridgeLanguages = (): LangInfo[] => Object.values(LANGUAGES).filter((l) => l.tier === 'C');

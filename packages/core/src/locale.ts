// Interface lines for languages beyond Odia, Hindi and English (Bengali, Kannada, Telugu, Tamil, Marathi, Bhojpuri,
// Santali): drafted per language into packages/core/src/locales/<lang>.json (content/scripts/translate_ui.ts) and
// registered at start-up — all of them on the server (locales/index.ts), only hers on the phone (loaded on demand,
// so a learner downloads one language, not seven).
import { ENGINE_LINES } from './engine.ts';
import { TUTOR_LINES } from './tutor.ts';

/** one language's lines: web screens (ui), the chat screen (chat), tutor chat lines (tutor), guided-practice and safety lines (engine) */
export interface Locale { ui: Record<string, string>; chat: Record<string, string>; tutor: Record<string, string>; engine: Record<string, string> }

const added = new Map<string, Locale>();

export function addLocale(lang: string, l: Locale) {
  added.set(lang, l);
  TUTOR_LINES[lang] = l.tutor;
  ENGINE_LINES[lang] = l.engine;
}

export const localeOf = (lang: string): Locale | undefined => added.get(lang);

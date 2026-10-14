// Every drafted language at once (server, tests). The phone loads only hers (apps/web/src/i18n.ts loadLocale).
import { addLocale, type Locale } from '../locale.ts';
import bn from './bn.json';
import kn from './kn.json';
import te from './te.json';
import ta from './ta.json';
import mr from './mr.json';
import bho from './bho.json';
import sat from './sat.json';

export const LOCALES: Record<string, Locale> = { bn, kn, te, ta, mr, bho, sat };

export function addAllLocales() {
  for (const [lang, l] of Object.entries(LOCALES)) addLocale(lang, l);
}

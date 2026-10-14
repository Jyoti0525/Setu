// Interface lines for the languages added after Odia, Hindi and English (Bengali, Kannada, Telugu, Tamil, Marathi,
// Bhojpuri, Santali): the English tables of the app (web i18n, chat, tutor lines, engine lines) → one JSON per language
// in packages/core/src/locales/. Drafted by Gemini (free tier), then checked here: every key, every {0} slot, every
// number (helplines 1098 / 14416 / 112) and the language's own script must survive, or the line stays English.
// Marked as drafts until a speaker of the language reviews them (LANGUAGES[x].ui.reviewed).
// usage: pnpm --filter @setu/content exec tsx scripts/translate_ui.ts bn,kn,te,ta,mr,bho,sat [--only-missing]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES } from '@setu/core';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.loadEnvFile(resolve(repo, 'apps/server/.env'));
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_DECIDE_MODEL || 'gemini-3.1-flash-lite';
const outDir = resolve(repo, 'packages/core/src/locales');

/** the `en: { … }` block of a string table in a source file, as key → text */
function englishTable(file: string, anchor: string): Record<string, string> {
  const src = readFileSync(resolve(repo, file), 'utf8');
  let i = src.indexOf('\n  en: {', src.indexOf(anchor)) + '\n  en: {'.length;
  const start = i;
  for (let depth = 1; depth; i++) {
    const c = src[i]!;
    if (c === "'" || c === '"') { for (i++; src[i] !== c; i += src[i] === '\\' ? 2 : 1); }
    else if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  const out: Record<string, string> = {};
  for (const m of src.slice(start, i - 1).matchAll(/(\w+):\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) out[m[1]!] = (m[2] ?? m[3] ?? '').replace(/\\(['"])/g, '$1');
  return out;
}

const TABLES = {
  ui: englishTable('apps/web/src/i18n.ts', 'const S = {'),
  chat: englishTable('apps/web/src/chat.tsx', 'const UI: Record'),
  tutor: englishTable('packages/core/src/tutor.ts', 'export const TUTOR_LINES'),
  engine: englishTable('packages/core/src/engine.ts', 'const STRINGS'),
};
type Locale = Record<keyof typeof TABLES, Record<string, string>>;

const HOW: Record<string, string> = {
  bn: 'Bengali (Bangla script), as a West Bengal / Tripura school uses it',
  kn: 'Kannada (Kannada script), as a Karnataka school uses it',
  te: 'Telugu (Telugu script), as an Andhra Pradesh / Telangana school uses it',
  ta: 'Tamil (Tamil script), as a Tamil Nadu school uses it',
  mr: 'Marathi (Devanagari script), as a Maharashtra school uses it',
  bho: 'Bhojpuri (Devanagari script), the everyday spoken Bhojpuri of Bihar / eastern Uttar Pradesh villages — not Hindi',
  sat: 'Santali in Ol Chiki script (ᱚᱞ ᱪᱤᱠᱤ), as Santal students in Odisha, Jharkhand and West Bengal read it',
};
/** her language's letters: a line with none of them is not translated (Latin-only text such as "Setu" is fine) */
const SCRIPT: Record<string, RegExp> = { bn: /[ঀ-৿]/, kn: /[ಀ-೿]/, te: /[ఀ-౿]/, ta: /[஀-௿]/, mr: /[ऀ-ॿ]/, bho: /[ऀ-ॿ]/, sat: /[᱐-᱿]/ };

async function gemini(prompt: string): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY! },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
    });
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
    if (text) return text;
    console.warn(`  retry (${j.error?.message?.slice(0, 80) ?? 'empty'})`);
    await new Promise((res) => setTimeout(res, 8000 * (attempt + 1)));
  }
  throw new Error('Gemini gave no answer');
}

const nums = (t: string) => (t.match(/\d+/g) ?? []).sort().join(',');
const slots = (t: string) => (t.match(/\{\d\}/g) ?? []).sort().join(',');
const toAscii = (t: string) => t.replace(/[০-৯೦-೯౦-౯௦-௯०-९᱐-᱙]/g, (d) => { const c = d.codePointAt(0)!; return String(c >= 0x1c50 ? c - 0x1c50 : (c & 0xf) - 6); });

async function translate(lang: string, name: string, table: Record<string, string>): Promise<Record<string, string>> {
  const prompt = `Translate the user-interface lines of "Setu", a free study app for Class 9 students in Indian villages, into ${HOW[lang]}.
The reader is a 14-year-old student, often a first-time phone user: short, warm, simple everyday words; speak to her as "you" the way a friendly teacher does (informal/familiar form). Keep it natural, not word-for-word.
Rules:
- Keep every key. Keep {0}, {1} exactly. Keep every number exactly (helplines 1098, 14416, 112; "3 MB"; "6"). Keep emoji, "Setu" may be written in the script, "Safari", "Share", "Add to Home Screen", "QR", "Wi-Fi", "MB" stay as they are.
- Where a line says "Odia" meaning the student's own language, say ${LANGUAGES[lang]?.english ?? lang} instead (e.g. "in Odia or English letters" → "in ${LANGUAGES[lang]?.english} or English letters").
- The example "speed kana" is an Odia question typed in English letters: replace it with the same question in ${LANGUAGES[lang]?.english} typed in English letters.
- care / care_speak are safety messages for a child in distress: translate them carefully and completely; in care_speak write the helpline numbers as words of the language, digit by digit.
Return only a JSON object with the same keys.
${JSON.stringify(table, null, 1)}`;
  const got = JSON.parse(await gemini(prompt)) as Record<string, unknown>;
  const out: Record<string, string> = {};
  let kept = 0;
  for (const [k, en] of Object.entries(table)) {
    const t = typeof got[k] === 'string' ? (got[k] as string).trim() : '';
    const numbersOk = k === 'care_speak' || nums(toAscii(t)) === nums(en);
    const ok = t && slots(t) === slots(en) && numbersOk && (SCRIPT[lang]!.test(t) || !/[a-z]{3}/i.test(en.replace(/Setu|Safari|Share|Add to Home Screen|QR|Wi-Fi|MB/g, '')));
    if (ok) out[k] = t; else { out[k] = en; kept++; console.warn(`  ${name}.${k}: kept English (${!t ? 'missing' : slots(t) !== slots(en) ? 'slots' : !numbersOk ? 'numbers' : 'script'})`); }
  }
  console.log(`  ${name}: ${Object.keys(table).length - kept}/${Object.keys(table).length} translated`);
  return out;
}

const langs = (process.argv[2] ?? 'bn,kn,te,ta,mr,bho,sat').split(',');
const onlyMissing = process.argv.includes('--only-missing');
mkdirSync(outDir, { recursive: true });
for (const lang of langs) {
  if (!HOW[lang]) { console.warn(`skip ${lang}: no description`); continue; }
  const file = resolve(outDir, `${lang}.json`);
  const have: Partial<Locale> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  console.log(`${lang} (${LANGUAGES[lang]?.english})`);
  const out = {} as Locale;
  for (const [name, table] of Object.entries(TABLES) as [keyof Locale, Record<string, string>][]) {
    const todo = onlyMissing ? Object.fromEntries(Object.entries(table).filter(([k, en]) => !have[name]?.[k] || have[name]![k] === en)) : table;
    const done = Object.keys(todo).length ? await translate(lang, name, todo) : {};
    out[name] = Object.fromEntries(Object.keys(table).map((k) => [k, done[k] ?? have[name]?.[k] ?? table[k]!]));
  }
  writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
}

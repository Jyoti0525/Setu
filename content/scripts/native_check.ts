// Writes docs/NATIVE_CHECK.md: everything in Odia a student sees that no native reader has checked yet (P8.16),
// taken from the live data so the list never drifts from the app.
// usage: pnpm --filter @setu/content exec tsx scripts/native_check.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEXICON, TUTOR_LINES, type BookIndex, type BookMeta } from '@setu/core';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const books = JSON.parse(readFileSync(resolve(here, '../books/books.json'), 'utf8')) as BookMeta[];
const index = (id: string) => { try { return JSON.parse(readFileSync(resolve(here, `../books/out/${id}.json`), 'utf8')) as BookIndex; } catch { return null; } };
const chat = readFileSync(resolve(repo, 'apps/web/src/chat.tsx'), 'utf8');
const uiOr = /  or: \{ (.*) \},\r?\n/.exec(chat)?.[1] ?? '';
const uiEn = /  en: \{ (.*) \},\r?\n/.exec(chat)?.[1] ?? '';
const pairs = (src: string) => Object.fromEntries([...src.matchAll(/(\w+): (['"])((?:\\.|(?!\2).)*)\2/g)].map((m) => [m[1]!, m[3]!.replace(/\\'/g, "'")]));
const ui = { or: pairs(uiOr), en: pairs(uiEn) };
const ideas = [...chat.matchAll(/'([^']*[଀-୿][^']*)'/g)].map((m) => m[1]!).filter((x) => x.endsWith('?'));

const L: string[] = [];
L.push('# Native Odia check — what to read and mark', '');
L.push('Everything below is Odia that students see and that no Odia speaker has checked yet. Tick a box when it reads right; when it does not, write the correct Odia next to it (or in a comment) and I will apply it.', '');
L.push('Mark three kinds of problem: **wrong** (meaning or term is wrong), **unnatural** (correct but no teacher would say it), **spelling**. Ten minutes on sections 1–3 covers what the demo shows.', '');
L.push(`_Generated from the app data by \`content/scripts/native_check.ts\` on ${new Date().toISOString().slice(0, 10)}._`, '');

L.push('## 1. The chat screen (labels and messages)', '');
L.push('| English meaning | Odia on screen | OK? |', '|---|---|---|');
for (const [k, v] of Object.entries(ui.or)) L.push(`| ${ui.en[k] ?? k} | ${v} | ☐ |`);
L.push('');
L.push('## 2. What the tutor says on its own (welcome, offline, follow-ups)', '');
L.push('| When | Odia | OK? |', '|---|---|---|');
for (const [k, v] of Object.entries(TUTOR_LINES.or ?? {})) L.push(`| ${k} — “${(TUTOR_LINES.en?.[k] ?? '').replace(/\|/g, '/')}” | ${v.replace(/\n/g, ' ')} | ☐ |`);
L.push('');
L.push('## 3. Suggested first questions (tap-to-ask cards)', '');
for (const q of [...new Set(ideas)]) L.push(`- ☐ ${q}`);
L.push('');
L.push('## 4. English → Odia school words (offline search uses these)', '');
L.push('An English question with no signal is searched with these Odia words. Each Odia word is already in the textbooks; check it is the right word for the English one.', '');
L.push('| English | Odia | OK? |', '|---|---|---|');
for (const [en, ors] of Object.entries(LEXICON)) L.push(`| ${en} | ${ors.join(', ')} | ☐ |`);
L.push('');
L.push('## 5. Chapter titles I typed from the contents pages', '');
L.push('Physical Science, History & Political Science and the two Maths books: titles typed by me from the printed contents page; check against the book.', '');
for (const b of books.filter((x) => ['physical-science-9', 'history-polsci-9', 'algebra-9', 'geometry-9'].includes(x.id))) {
  L.push(`**${b.title.or}**`, '');
  for (const c of b.chapters) L.push(`- ☐ ${c.n}. ${c.title.or} — _${c.title.en}_ (pp. ${c.startPage - b.pageOffset}–${c.endPage - b.pageOffset})`);
  L.push('');
}
L.push('## 6. Scanned textbook text (the 📖 card)', '');
L.push('The books are scanned and read by OCR. These rules fix the mistakes that repeat across all books — confirm each is always right:', '');
L.push('- ☐ ଥୁ → ଥି (ଥୁବା → ଥିବା, ଏଥୁରେ → ଏଥିରେ, ପୃଥୁବୀ → ପୃଥିବୀ) — except ପଥୁରିଆ, which is kept', '- ☐ ଥବା → ଥିବା (but ଅଥବା "or" is kept)', '- ☐ ଅଧକ / ଅଧୁକ → ଅଧିକ, ମାନବାଧକାର → ମାନବାଧିକାର, ଆଧୁପତ୍ୟ → ଆଧିପତ୍ୟ (ଆଧୁନିକ, ଅଧୁନା, ସାଧକ, ବାଧକ are kept)', '- ☐ ୍ଯ → ୍ୟ (ମଧ୍ଯ → ମଧ୍ୟ, ଇତ୍ଯାଦି → ଇତ୍ୟାଦି)', '- ☐ ୍ଵ → ୍ୱ (ଶ୍ଵେତ → ଶ୍ୱେତ)', '');
L.push('Then read these passages (the pages the demo uses most). Write any wrong word and its fix; one-off errors become new rules or a corrections list:', '');
const sample: [string, number][] = [['life-science-9', 42], ['life-science-9', 30], ['life-science-9', 85], ['geography-economics-9', 45], ['geography-economics-9', 102], ['disaster-management-9', 3], ['physical-science-9', 58], ['history-polsci-9', 17]];
for (const [id, page] of sample) {
  const b = index(id);
  const p = b?.passages.find((x) => x.page === page);
  if (!b || !p) continue;
  L.push(`**${b.meta.title.or} — page ${page}** (\`${p.id}\`)`, '', `> ${p.text}`, '', '- ☐ reads right  · wrong words: ____________', '');
}
L.push('Known one-off misreadings already spotted (please give the right word): ପ୍ରଲସି (in “ପ୍ରଲସି ବା ପ୍ଲାଜମା”), ପ୍ନାଟଲେଟ୍‌ (ପ୍ଲାଟଲେଟ୍?), ଅଙ୍ଗାରକାମ୍ନ (ଅଙ୍ଗାରକାମ୍ଳ?), ବର୍ଜ୍ୟବସୁ (ବର୍ଜ୍ୟବସ୍ତୁ?).', '');
L.push('## 7. How to send corrections', '');
L.push('Easiest: write the fixes in this file (or a photo of a marked printout) and send it back — I apply them to the rules, the word list and the app strings, rebuild the books, and re-run the tests. For the chapter-pack lines (the guided Motion lesson) the review tool at `/#review` still works.', '');
writeFileSync(resolve(repo, 'docs/NATIVE_CHECK.md'), L.join('\n'));
console.log(`docs/NATIVE_CHECK.md: ${L.length} lines`);

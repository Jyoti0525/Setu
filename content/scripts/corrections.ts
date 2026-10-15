// Native-speaker fixes to the scanned book text (content/books/corrections.json, from docs/NATIVE_CHECK.md).
// Used by build_book.ts on every build; run alone to fix the built books in place:
//   pnpm --filter @setu/content exec tsx scripts/corrections.ts
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BookIndex } from '@setu/core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../books');
type Fixes = Record<string, string>;
const C = JSON.parse(readFileSync(resolve(root, 'corrections.json'), 'utf8')) as { all: Fixes; books: Record<string, Fixes>; passages: Record<string, Fixes> };

/** a whole word: not touching another Odia letter or mark on either side */
const esc = (w: string) => w.replace(/[.*+?^$(){}|[\]\\]/g, (c) => '\\' + c);
const ODIA = '\\u0B00-\\u0B7F\\u200C\\u200D';
const word = (w: string) => new RegExp('(?<![' + ODIA + '])' + esc(w) + '(?![' + ODIA + '])', 'g');

/** The book with the fixes applied; `n` = how many words changed. The version changes with them, so phones fetch it again. */
export function correct(b: BookIndex): { book: BookIndex; n: number } {
  let n = 0;
  const general = { ...C.all, ...(C.books[b.meta.id] ?? {}) };
  const passages = b.passages.map((p) => {
    let t = p.text;
    for (const [from, to] of Object.entries(C.passages[p.id] ?? {})) if (t.includes(from)) { t = t.split(from).join(to); n++; }
    for (const [from, to] of Object.entries(general)) t = t.replace(word(from), () => { n++; return to; });
    t = t.replace(/ {2,}/g, ' ');
    return t === p.text ? p : { ...p, text: t };
  });
  const tag = '.n' + n;
  return { book: n ? { ...b, passages, version: b.version.replace(/\.n\d+$/, '') + tag } : b, n };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(root, 'out');
  for (const f of readdirSync(out).filter((x) => x.endsWith('.json'))) {
    const b = JSON.parse(readFileSync(resolve(out, f), 'utf8')) as BookIndex;
    const { book, n } = correct(b);
    if (n) { writeFileSync(resolve(out, f), JSON.stringify(book)); console.log(`${b.meta.id}: ${n} fixes → version ${book.version}`); }
  }
}

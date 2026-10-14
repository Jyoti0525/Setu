// Quick look at textbook search quality: prints the best passage per question.
// usage: pnpm --filter @setu/content exec tsx scripts/try_search.ts ["question" ...]
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Shelf, type BookIndex } from '@setu/core';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../books/out');
const shelf = new Shelf(readdirSync(out).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(out, f), 'utf8')) as BookIndex));
const qs = process.argv.slice(2).length ? process.argv.slice(2) : [
  'what is a cell wall', 'koshika prachira kana', 'ଜୀବକୋଷ କ\'ଣ', 'mitochondria kana kaam kare', 'what is monsoon', 'mausumi bayu kana',
  'ମୌସୁମୀ ବାୟୁ', 'bank re account kemiti kholiba', 'what is biodiversity', 'malaria kemiti hue', 'ରକ୍ତ କଣିକା', 'speed and velocity difference',
  'sustainable development', 'odisha river names', 'tsunami kana', 'road accident karana',
];
for (const q of qs) {
  const h = shelf.search(q, { limit: 3 });
  console.log(`\n? ${q}`);
  for (const x of h) console.log(`  ${x.bookId} ch${x.passage.ch} p${x.passage.page} score ${x.score.toFixed(1)} cov ${x.coverage} | ${x.passage.text.slice(0, 90)}`);
}

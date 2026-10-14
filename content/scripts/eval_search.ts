// Offline textbook search quality (P8 offline matching): the passage the phone would show with no signal — the same
// Shelf.search + planTurn the chat runs offline — against eval/book_search.json. Prints misses and the score.
// usage: pnpm --filter @setu/content exec tsx scripts/eval_search.ts [--all]
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyMemory, planTurn, screen, Shelf, type BookIndex } from '@setu/core';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../books/out');
const shelf = new Shelf(readdirSync(out).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(out, f), 'utf8')) as BookIndex));
const { cases } = JSON.parse(readFileSync(resolve(here, '../eval/book_search.json'), 'utf8')) as { cases: { q: string; picked?: string[]; want: string[] }[] };

let shown = 0, top3 = 0;
for (const c of cases) {
  const hits = shelf.search(c.q, { limit: 4 });
  const plan = planTurn(emptyMemory(), { safety: screen(c.q, true), text: c.q, hits, bookIds: c.picked, online: false, now: Date.now() });
  const key = (h: { bookId: string; passage: { ch: number } }) => `${h.bookId}#${h.passage.ch}`;
  const first = plan.grounding[0];
  const ok = c.want.length ? !!first && c.want.includes(key(first)) : !first; // chit-chat: no passage shown
  const in3 = c.want.length ? hits.slice(0, 3).some((h) => c.want.includes(key(h))) : !first;
  shown += ok ? 1 : 0; top3 += in3 ? 1 : 0;
  if (!ok || process.argv.includes('--all')) console.log(`${ok ? '✓' : '✗'} ${c.q}${c.picked ? ` [${c.picked}]` : ''} → ${first ? `${key(first)} p${first.passage.page} cov ${first.coverage}` : 'nothing'}  (want ${c.want.join('|')}; top3 ${hits.slice(0, 3).map(key).join(', ')})`);
}
console.log(`\nshown passage right: ${shown}/${cases.length} (${Math.round((shown / cases.length) * 100)}%) · right chapter in top 3: ${top3}/${cases.length}`);

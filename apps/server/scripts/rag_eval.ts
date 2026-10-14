// Keyword-only vs hybrid RAG (BM25 + pgvector, ± IndicTrans2) on content/eval/book_search.json — the same
// "is the shown passage in the right chapter" measure as content/test/book_search.test.ts.
//   node --import tsx apps/server/scripts/rag_eval.ts
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyMemory, planTurn, screen, Shelf, type BookHit, type BookIndex } from '@setu/core';
import { HybridRag, NlpWorker, setAgree, setEnWeights, translatable } from '../src/rag.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const out = resolve(repo, 'content/books/out');
const books = readdirSync(out).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(out, f), 'utf8')) as BookIndex);
const shelf = new Shelf(books);
const { cases } = JSON.parse(readFileSync(resolve(repo, process.argv[2] ?? 'content/eval/book_search.json'), 'utf8')) as { cases: { q: string; picked?: string[]; want: string[]; lang?: string }[] };

const python = resolve(repo, 'spikes/tts/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const worker = new NlpWorker({ python, script: resolve(repo, 'tools/nlp/serve.py'), log: (m) => console.error(m) });
worker.start();
const rag = new HybridRag({ shelf, worker, dir: process.env.SETU_PG ?? resolve(repo, 'apps/server/data/pg'), log: (m) => console.error(m) });
await rag.index();
await worker.waitReady(180_000);

const shown = (q: string, hits: BookHit[], picked?: string[]) => {
  const g = planTurn(emptyMemory(), { safety: screen(q, true), text: q, hits, bookIds: picked, online: false, now: 0 }).grounding[0];
  return g && `${g.bookId}#${g.passage.ch}`;
};

const ok =(c: { want: string[] }, s?: string) => (c.want.length ? c.want.includes(s ?? '') : !s);
const pct = (xs: boolean[]) => `${xs.filter(Boolean).length}/${xs.length} (${Math.round((100 * xs.filter(Boolean).length) / xs.length)}%)`;
const study = cases.filter((c) => c.want.length);
const chat = cases.filter((c) => !c.want.length);
const en = new Map<string, string | undefined>();
const t0 = Date.now();
let translated = 0;
for (const c of cases) {
  const lang = translatable(c.q, 'or') ? 'or' : translatable(c.q, 'hi') ? 'hi' : undefined;
  if (lang) { en.set(c.q, (await worker.translate(c.q, lang)).text); translated++; }
}
console.log(`IndicTrans2: ${translated} questions translated, ${Math.round((Date.now() - t0) / Math.max(1, translated))} ms each`);
const kwOk = cases.map((c) => ok(c, shown(c.q, shelf.search(c.q, { limit: 6, picked: c.picked }), c.picked)));
console.log('keyword only            study', pct(kwOk.filter((_, i) => cases[i]!.want.length > 0)), '· chit-chat no page', pct(kwOk.filter((_, i) => !cases[i]!.want.length)));
let best = '';
for (const sure of [2, 3, 4, 9]) for (const [k, m, useEn] of [[0, 0, false], [0.5, 0.7, true], [0, 0.7, true], [0.3, 0.5, true]] as const) {
  setAgree(sure); setEnWeights(k, m);
  const res: boolean[] = [];
  const fixed: string[] = []; const broke: string[] = [];
  for (const [i, c] of cases.entries()) {
    const h = await rag.search(c.q, { picked: c.picked, en: useEn ? en.get(c.q) : undefined });
    const r = ok(c, shown(c.q, h.hits, c.picked));
    res.push(r);
    if (r && !kwOk[i]) fixed.push(c.q); if (!r && kwOk[i]) broke.push(c.q);
  }
  const st = res.filter((_, i) => cases[i]!.want.length > 0); const ch = res.filter((_, i) => !cases[i]!.want.length);
  const line = `agree ${sure} en ${useEn ? `k${k}/m${m}` : 'off'}  study ${pct(st)} · chit-chat no page ${pct(ch)} · fixed ${fixed.length} broke ${broke.length}`;
  console.log(line);
  if (sure === 3 && useEn && k === 0) best = `fixed: ${fixed.join(' | ')}
broke: ${broke.join(' | ')}`;
}
console.log(best);
console.log('translations:', [...en.entries()].slice(0, 8).map(([q, e]) => `${q} → ${e}`).join(' ; '));
void study; void chat;
worker.stop();
await rag.close();
process.exit(0);

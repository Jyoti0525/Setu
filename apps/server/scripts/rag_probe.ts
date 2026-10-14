// Diagnostics for hybrid RAG calibration: top similarity and chapter agreement of the meaning search, per eval case.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Shelf, type BookIndex } from '@setu/core';
import { HybridRag, NlpWorker } from '../src/rag.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = resolve(repo, 'content/books/out');
const shelf = new Shelf(readdirSync(out).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(out, f), 'utf8')) as BookIndex));
const { cases } = JSON.parse(readFileSync(resolve(repo, 'content/eval/book_search.json'), 'utf8')) as { cases: { q: string; picked?: string[]; want: string[] }[] };
const worker = new NlpWorker({ python: resolve(repo, 'spikes/tts/.venv/Scripts/python.exe'), script: resolve(repo, 'tools/nlp/serve.py') });
worker.start();
const rag = new HybridRag({ shelf, worker, dir: resolve(repo, 'apps/server/data/pg') });
await rag.index();
await worker.waitReady(180_000);
for (const c of cases) {
  const v = (await worker.embed([c.q], 'query'))![0]!;
  const near = await rag.nearest(v, { picked: c.picked, limit: 5 });
  const chs = near.map((n) => { const p = shelf.passage(n.id)!; return `${p.bookId}#${p.passage.ch}`; });
  const top = chs[0]!;
  const agree = chs.filter((x) => x === top).length;
  const kw = shelf.search(c.q, { limit: 1, picked: c.picked })[0];
  console.log([c.want.length ? (c.want.includes(top) ? 'RIGHT' : 'wrong') : 'CHAT ', near[0]!.sim.toFixed(3), (near[0]!.sim - near[near.length - 1]!.sim).toFixed(3), agree, (kw?.coverage ?? 0).toFixed(2), c.q].join('\t'));
}
worker.stop(); await rag.close(); process.exit(0);

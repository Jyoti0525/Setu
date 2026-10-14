// Live check of the tutor chat agent against the real (free-tier) models: a short conversation, printed with the
// agent's tool trace. Loads apps/server/.env into this process only; never prints it.
// usage: node --import tsx eval/tutor_try.ts ["message" ...]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Shelf, type BookIndex } from '@setu/core';
import { Store } from '../src/db.ts';
import { buildModels } from '../src/llm.ts';
import { openTutor, runTutor, type TutorDeps } from '../src/tutor/run.ts';

const here = dirname(fileURLToPath(import.meta.url));
const env = resolve(here, '../.env');
if (existsSync(env)) process.loadEnvFile(env);
const out = resolve(here, '../../../content/books/out');
const shelf = new Shelf(readdirSync(out).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(out, f), 'utf8')) as BookIndex));
const store = new Store();
const d: TutorDeps = { store, shelf, models: buildModels(), budgetMs: Number(process.env.BUDGET ?? 14_000) };
const pid = 'p-try';

type Step = { text: string; bookId?: string; lang?: string };
const script: Step[] = process.argv.slice(2).length ? process.argv.slice(2).map((text) => ({ text })) : [
  { text: 'koshika prachira kana?', bookId: 'life-science-9' },
  { text: 'ତାହା କୋଷ ଭିତରେ ଥାଏ' },
  { text: 'ମୌସୁମୀ ବାୟୁ କ\'ଣ?', bookId: 'geography-economics-9' },
  { text: 'road accident karana kana' },
  { text: 'what is a savings account?', lang: 'en' },
];
console.log('OPEN:', JSON.stringify(openTutor(d, { profileId: pid, lang: 'or' }).messages.map((m) => m.text)));
for (const s of script) {
  const r = await runTutor(d, { profileId: pid, deviceId: 'dev', text: s.text, lang: s.lang ?? process.env.LANG_TRY ?? 'or', bookIds: s.bookId ? [s.bookId] : undefined });
  console.log(`\n>>> ${s.text}${s.bookId ? `  [${s.bookId}]` : ''}`);
  for (const m of r.messages) {
    console.log(`  [${m.by}${m.tone ? ' ' + m.tone : ''}] ${m.text}`);
    if (m.check) console.log(`  CHECK: ${m.check}`);
    if (m.terms?.length) console.log(`  TERMS: ${m.terms.map((t) => `${t.or}=${t.en}`).join(', ')}`);
    for (const src of m.sources ?? []) console.log(`  SOURCE: ${src.bookId} p.${src.page} (${src.chapter})`);
  }
  console.log(`  TRACE ${r.trace.chosen} | ${r.trace.latency_ms} ms | ${r.trace.tools.map((t) => `${t.tool}${t.note ? '(' + t.note + ')' : ''}`).join(' → ')}`);
}
console.log('\nMEMORY', JSON.stringify(openTutor(d, { profileId: pid, lang: 'or' }).memory));
console.log('\nPROVIDER FAILURES\n' + d.models.breakers.failures.map((f) => `${f.key}: ${f.error.slice(0, 160)}`).join('\n'));

// OCR a rendered textbook (P8.1): every page image from tools/books/render.py → { page, text, conf }[].
// Free and offline: Tesseract with the Odia + English `best_int` models; four workers in parallel.
// usage: node content/scripts/ocr_book.mjs <pages_dir> <out.json> [langs, default ori+eng; hin+eng, san+hin for the Devanagari books]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(path.resolve('apps/web/package.json'));
const { createWorker, createScheduler } = require('tesseract.js');
const langPath = path.resolve('content/books/tessdata'); // ori + eng best_int: the English terms in brackets are the bridge to English questions

const [dir, outFile, langs = 'ori+eng'] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => /^p\d{3}[abc]?\.png$/.test(f)).sort();
// Sanskrit's sandhi-joined words score lower even when read right (real lines from 63)
const MIN_LINE_CONF = langs.startsWith('san') ? 50 : 60;
const scheduler = createScheduler();
for (let i = 0; i < 4; i++) scheduler.addWorker(await createWorker(langs, 1, { langPath, cacheMethod: 'none' }));

const t0 = Date.now();
let done = 0;
const parts = await Promise.all(files.map(async (f) => {
  const { data } = await scheduler.addJob('recognize', path.join(dir, f), {}, { blocks: true, text: true });
  // a line Tesseract is unsure of is not misspelt text but text it cannot read (italic Odia, tinted boxes, figure
  // labels): it comes out as made-up words that would match questions by accident, so it is left out (real lines ≥ 80)
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  const kept = lines.filter((l) => l.confidence >= MIN_LINE_CONF);
  data.text = lines.length ? kept.map((l) => l.text.trimEnd()).join('\n') : data.text;
  if (++done % 20 === 0) console.log(`${done}/${files.length} ${Math.round((Date.now() - t0) / 1000)} s`);
  return { page: Number(f.slice(1, 4)), part: f[4] === '.' ? '' : f[4], text: data.text, conf: Math.round(data.confidence) };
}));
await scheduler.terminate();

// one record per printed page: a split page's parts joined in order (the text above the columns, then left, then right)
const pages = new Map();
for (const p of parts.sort((a, b) => a.page - b.page || a.part.localeCompare(b.part))) {
  const prev = pages.get(p.page);
  pages.set(p.page, prev ? { ...prev, text: prev.text + '\n' + p.text, conf: Math.round((prev.conf + p.conf) / 2) } : { page: p.page, text: p.text, conf: p.conf });
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify([...pages.values()], null, 1));
console.log(`${pages.size} pages → ${outFile} in ${Math.round((Date.now() - t0) / 1000)} s`);

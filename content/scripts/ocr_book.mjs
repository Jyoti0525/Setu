// OCR a rendered textbook (P8.1): every page image from tools/books/render.py → { page, text, conf }[].
// Free and offline: Tesseract with the Odia + English `best_int` models; four workers in parallel.
// usage: node content/scripts/ocr_book.mjs <pages_dir> <out.json>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(path.resolve('apps/web/package.json'));
const { createWorker, createScheduler } = require('tesseract.js');
const langPath = path.resolve('content/books/tessdata'); // ori + eng best_int: the English terms in brackets are the bridge to English questions

const [dir, outFile] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => /^p\d{3}[ab]?\.png$/.test(f)).sort();
const scheduler = createScheduler();
for (let i = 0; i < 4; i++) scheduler.addWorker(await createWorker('ori+eng', 1, { langPath, cacheMethod: 'none' }));

const t0 = Date.now();
let done = 0;
const parts = await Promise.all(files.map(async (f) => {
  const { data } = await scheduler.addJob('recognize', path.join(dir, f));
  if (++done % 20 === 0) console.log(`${done}/${files.length} ${Math.round((Date.now() - t0) / 1000)} s`);
  return { page: Number(f.slice(1, 4)), part: f[4] === '.' ? '' : f[4], text: data.text, conf: Math.round(data.confidence) };
}));
await scheduler.terminate();

// one record per printed page: the two columns of a split page joined left then right
const pages = new Map();
for (const p of parts.sort((a, b) => a.page - b.page || a.part.localeCompare(b.part))) {
  const prev = pages.get(p.page);
  pages.set(p.page, prev ? { ...prev, text: prev.text + '\n' + p.text, conf: Math.round((prev.conf + p.conf) / 2) } : { page: p.page, text: p.text, conf: p.conf });
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify([...pages.values()], null, 1));
console.log(`${pages.size} pages → ${outFile} in ${Math.round((Date.now() - t0) / 1000)} s`);

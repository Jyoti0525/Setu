// OCR with word positions (home-language word lists): every page image from tools/books/render.py --whole →
// { page, words: [{ t, x0, y0, x1, y1, c }] }[]. The government trilingual primers and Odia-<tribal> dictionaries
// are tables (English | Odia | home language) and word pairs; their columns are told apart by x, which plain OCR text loses.
// usage: node content/scripts/ocr_words.mjs <pages_dir> <out.json> [langs, default ori+eng]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(path.resolve('apps/web/package.json'));
const { createWorker, createScheduler } = require('tesseract.js');
const langPath = path.resolve('content/books/tessdata');

const [dir, outFile, langs = 'ori+eng'] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => /^p\d{3}\.png$/.test(f)).sort();
const scheduler = createScheduler();
for (let i = 0; i < 4; i++) scheduler.addWorker(await createWorker(langs, 1, { langPath, cacheMethod: 'none' }));

const t0 = Date.now();
let done = 0;
const pages = await Promise.all(files.map(async (f) => {
  const { data } = await scheduler.addJob('recognize', path.join(dir, f), {}, { blocks: true });
  const words = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)))
    .map((w) => ({ t: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, c: Math.round(w.confidence) }));
  if (++done % 20 === 0) console.log(`${done}/${files.length} ${Math.round((Date.now() - t0) / 1000)} s`);
  return { page: Number(f.slice(1, 4)), words };
}));
await scheduler.terminate();
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(pages.sort((a, b) => a.page - b.page)));
console.log(`${pages.length} pages → ${outFile} in ${Math.round((Date.now() - t0) / 1000)} s`);

// One-off check: how well does Tesseract (ori, best_int) read a rendered textbook page?
// usage: node content/scripts/ocr_test.mjs <png>...
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('apps/web/package.json'));
const { createWorker } = require('tesseract.js');
const langPath = path.resolve('content/books/tessdata'); // ori + eng best_int: the English terms in brackets are the bridge to English questions

const worker = await createWorker('ori+eng', 1, { langPath, cacheMethod: 'none' });
for (const f of process.argv.slice(2)) {
  const t0 = Date.now();
  const { data } = await worker.recognize(f);
  console.log(`== ${path.basename(f)} conf ${data.confidence} ${Date.now() - t0} ms`);
  console.log(data.text.slice(0, 900));
}
await worker.terminate();

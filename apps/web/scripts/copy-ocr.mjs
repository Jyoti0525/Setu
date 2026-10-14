// Copies the offline OCR files (Tesseract.js worker + LSTM cores + Odia data) into public/ocr so our own server
// serves them: no CDN at runtime, and the service worker can cache them for offline Snap (PLAN §6.8, P3.15).
import { cpSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const nm = resolve(here, '../node_modules');
const out = resolve(here, '../public/ocr');
mkdirSync(out, { recursive: true });
const tjs = realpathSync(join(nm, 'tesseract.js'));
const core = realpathSync(join(tjs, '../tesseract.js-core'));
const files = [
  [join(tjs, 'dist/worker.min.js'), 'worker.min.js'],
  // only one of these is downloaded, chosen by the phone's WASM features (LSTM-only engine)
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((f) => [join(core, f), f]),
  [join(realpathSync(join(nm, '@tesseract.js-data/ori')), '4.0.0_best_int/ori.traineddata.gz'), 'ori.traineddata.gz'],
];
for (const [from, to] of files) {
  if (!existsSync(from)) throw new Error(`missing ${from}`);
  cpSync(from, join(out, to));
}
console.log(`ocr: ${files.length} files → public/ocr`);

// Read a maths book's pages again with Gemini vision (P8.17): Tesseract loses the maths ("0 ≤ P(E) ≤ 1" came out as
// "0 P(E) 1", fractions as a jumble). Vision writes the maths as LaTeX (its most accurate notation; latex.ts makes it
// plain text), but it can swap an Odia word for a likelier one or invent text, so:
//   - a page keeps the vision text only when the words Tesseract read are there too (≥ half of its Odia words) and the
//     page has not grown much; otherwise Tesseract stays;
//   - where the two disagree on one Odia word, Tesseract's word is put back when it is a book word (ocr_merge.ts).
// usage (in content/): npx tsx scripts/vision_ocr.ts <book-id> <whole-pages-dir>   (pages from render.py --whole)
//   VISION_MODELS=a,b  models to try, best first (each on both keys); the free tier gives the Flash models 20 pages a
//                      day per key, Flash-Lite many more. Readings are kept per model in <dir>/vision/<model>/ and the
//                      best one saved is used, so a later run with a better model's quota upgrades pages.
//   MERGE_ONLY=1       no model calls: merge the readings already saved.
// The first run saves the Tesseract text as books/ocr/<id>.tesseract.json; every run writes books/ocr/<id>.json.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanOcr, latexToText, normalizeForMatch, type BookMeta } from '@setu/core';
import { knownWords, mergeReadings } from '../src/ocr_merge.ts';

const here = dirname(fileURLToPath(import.meta.url));
const [id, dir] = process.argv.slice(2);
if (!id || !dir) throw new Error('usage: vision_ocr.ts <book-id> <whole-pages-dir>');
const ocrDir = resolve(here, '../books/ocr');
const meta = (JSON.parse(readFileSync(resolve(here, '../books/books.json'), 'utf8')) as BookMeta[]).find((b) => b.id === id)!;
const tessFile = resolve(ocrDir, `${id}.tesseract.json`);
if (!existsSync(tessFile)) writeFileSync(tessFile, readFileSync(resolve(ocrDir, `${id}.json`)));
const tess = JSON.parse(readFileSync(tessFile, 'utf8')) as { page: number; text: string; conf: number }[];

// keys stay in apps/server/.env (never printed)
const env = Object.fromEntries(readFileSync(resolve(here, '../../apps/server/.env'), 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const keys = [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2].filter(Boolean) as string[];
const models = (process.env.VISION_MODELS ?? 'gemini-3-flash-preview,gemini-3.5-flash-lite').split(',');
const routes = models.flatMap((m) => keys.map((k) => ({ m, k })));
const dead = new Set<string>(); // model+key whose daily quota is spent: not tried again this run

// copying needs no reasoning: with thinking on, a dense page ran past 90 s
const PROMPT = `This is one page of a Class 9 BSE Odisha mathematics textbook, printed in Odia. Transcribe all of its text exactly as printed, in reading order (left column first if there are two).
Rules:
- Odia in Unicode Odia script, copied word for word and letter for letter as printed. Never replace a word with a synonym or a more common word (if the page prints ସମ୍ଭାବ୍ୟତା, write ସମ୍ଭାବ୍ୟତା, not ସମ୍ଭାବନା), never drop a word, never fix the grammar. Do not translate, summarise, explain or add anything.
- Every mathematical expression in LaTeX between $ signs, exactly as printed: small raised powers too ($a^{\\frac{1}{2}}$, $x^{2}$), fractions with \\frac, roots with \\sqrt, angles with \\angle, triangles with \\triangle.
- Digits as printed (Odia ୦-୯ or 0-9).
- A figure, diagram or graph: write [ଚିତ୍ର] on its own line; do not transcribe the labels inside it.
- Leave out the running header, the footer and the page number.
- Output only the transcription: no comments, no markdown.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function vision(png: string): Promise<{ text: string; model: string } | undefined> {
  const data = readFileSync(png).toString('base64');
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const { m, k } of routes) {
      const route = `${m} key${keys.indexOf(k) + 1}`;
      if (dead.has(route)) continue;
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
          method: 'POST', headers: { 'x-goog-api-key': k, 'content-type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/png', data } }] }], generationConfig: { temperature: 0, thinkingConfig: { thinkingLevel: 'minimal' } } }),
          signal: AbortSignal.timeout(150_000),
        });
        const d = (await r.json()) as { error?: { message?: string; details?: { violations?: { quotaId?: string }[] }[] }; candidates?: { content?: { parts?: { text?: string }[] } }[] };
        if (!r.ok) {
          if (d.error?.details?.some((x) => x.violations?.some((v) => /PerDay/.test(v.quotaId ?? '')))) { dead.add(route); console.warn(`${route}: daily quota spent`); }
          else console.warn(`${png.slice(-8)} ${route}: ${r.status} ${d.error?.message?.slice(0, 90) ?? ''}`);
          continue;
        }
        const t = d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
        if (t) return { text: t, model: m };
      } catch (e) { console.warn(`${png.slice(-8)} ${route}: ${(e as Error).name}`); }
    }
    if (dead.size === routes.length) return undefined;
    await sleep(20_000 * (attempt + 1));
  }
  return undefined;
}

const odiaWords = (t: string) => normalizeForMatch(t).split(' ').filter((w) => /^[଀-୿]{3,}$/.test(w));
/** does the vision text say what Tesseract read (not something else, not more)? */
export function agrees(visionText: string, tessText: string) {
  const v = new Set(odiaWords(visionText));
  const t = odiaWords(cleanOcr(tessText));
  if (t.length < 8) return { ok: v.size < 40, share: 1 };
  const share = t.filter((w) => v.has(w)).length / t.length;
  return { ok: share >= 0.5 && v.size <= 1.6 * new Set(t).size + 25, share: Math.round(share * 100) / 100 };
}

const inBook = (page: number) => meta.chapters.some((c) => page >= c.startPage && page <= c.endPage);
const files = readdirSync(dir).filter((f) => /^p\d{3}\.png$/.test(f)).sort().filter((f) => inBook(Number(f.slice(1, 4))));
const saved = (f: string) => models.map((m) => resolve(dir, 'vision', m, f.replace('.png', '.txt'))).find(existsSync);
const got = new Map<number, string>();
const byModel = new Map<string, number>();
let next = 0;
async function worker() {
  while (next < files.length) {
    const f = files[next++]!;
    const page = Number(f.slice(1, 4));
    const have = saved(f);
    if (have) { got.set(page, readFileSync(have, 'utf8')); byModel.set(have.split(/[\\/]/).at(-2)!, (byModel.get(have.split(/[\\/]/).at(-2)!) ?? 0) + 1); continue; }
    if (process.env.MERGE_ONLY || dead.size === routes.length) continue;
    const r = await vision(resolve(dir, f));
    if (!r) { console.warn(`p${page}: no answer from any model, Tesseract kept`); continue; }
    mkdirSync(resolve(dir, 'vision', r.model), { recursive: true });
    writeFileSync(resolve(dir, 'vision', r.model, f.replace('.png', '.txt')), r.text);
    got.set(page, r.text);
    byModel.set(r.model, (byModel.get(r.model) ?? 0) + 1);
    if (got.size % 10 === 0) console.log(`${got.size}/${files.length}`);
  }
}
await Promise.all([worker(), worker()]);

// words the books print, from every book's Tesseract text (the witness for each Odia word vision writes)
const tessTexts = readdirSync(ocrDir).filter((f) => f.endsWith('.json') && !readdirSync(ocrDir).includes(f.replace('.json', '.tesseract.json')))
  .flatMap((f) => (JSON.parse(readFileSync(resolve(ocrDir, f), 'utf8')) as { text: string; by?: string }[]).filter((p) => !p.by).map((p) => p.text));
const known = knownWords(tessTexts);
let used = 0, swaps = 0;
const rejected: string[] = [];
const out = tess.map((p) => {
  const raw = got.get(p.page);
  if (raw === undefined) return p;
  const v = latexToText(raw);
  const a = agrees(v, p.text);
  if (!a.ok) { rejected.push(`p${p.page} (${a.share})`); return p; }
  used++;
  const m = mergeReadings(v, p.text, known);
  swaps += m.swapped.length;
  return { page: p.page, text: m.text, conf: 100, by: 'gemini' };
});
writeFileSync(resolve(ocrDir, `${id}.json`), JSON.stringify(out, null, 1));
console.log(`${id}: vision text on ${used} of ${files.length} pages (${[...byModel].map(([m, n]) => `${m} ${n}`).join(', ')}; ${swaps} words put back to Tesseract's); Tesseract kept on ${rejected.length}: ${rejected.join(', ')}`);

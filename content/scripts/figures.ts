// Textbook figures (P8.20): a diagram of the heart or a map of the monsoon teaches what the OCR text cannot — the OCR
// keeps only the caption and the clearly printed labels. Gemini vision looks at each page and, for every figure,
// returns its box, its printed number and caption, and an explanation in the book's language written from the figure
// AND the page text around it. Each figure becomes a searchable passage on its page (build_book.ts), and the
// answer card shows the figure itself, cut from the PDF (tools/books/figures.py).
// usage (in content/): npx tsx scripts/figures.ts <book-id> [<book-id> ...]
//   VISION_MODELS=a,b  models to try, best first (each on both keys). Readings are kept per page in
//                      books/pages/<id>/figures/ (gitignored), so a run stopped by the quota resumes where it stopped.
//   PAGES=13,14        only these PDF pages (a trial)
//   CUT_ONLY=1        no model calls: write the figures from the readings already saved.
// Writes books/figures/<id>.json and the pictures in books/figures/<id>/.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BookMeta } from '@setu/core';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const books = resolve(here, '../books');
const python = resolve(repo, 'spikes/tts/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const metas = JSON.parse(readFileSync(resolve(books, 'books.json'), 'utf8')) as BookMeta[];
const PDF: Record<string, string> = { 'physical-science-9': 'physical-science-9-full.pdf' };

// keys stay in apps/server/.env (never printed)
const env = Object.fromEntries(readFileSync(resolve(repo, 'apps/server/.env'), 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const keys = [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2].filter(Boolean) as string[];
const models = (process.env.VISION_MODELS ?? 'gemini-3.5-flash-lite,gemini-2.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash').split(',');
const routes = models.flatMap((m) => keys.map((k) => ({ m, k })));
const dead = new Set<string>(); // model+key whose daily quota is spent

const LANG: Record<string, string> = { 'english-9': 'English', 'hindi-9': 'Hindi', 'sanskrit-9': 'Hindi' };
const prompt = (subject: string, lang: string) => `This is one page of a Class 9 BSE Odisha ${subject} textbook.
Find every figure on the page: drawings, labelled diagrams, photographs, maps, graphs and charts. Leave out tables made only of text, decorative borders, icons, logos and the page-number box.
For each figure give:
- "box_2d": [ymin, xmin, ymax, xmax] on a 0-1000 scale, around the whole figure with its labels and its caption.
- "label": the figure number exactly as printed (for example "ଚିତ୍ର - 1.1"), or "" if it has none.
- "caption": the caption exactly as printed, in its own script, or "".
- "explain": 2 to 4 short, simple sentences in ${lang} for a Class 9 student: what the figure shows, its labelled parts, and what it teaches, using the page text around it. Use the textbook's own words for the terms (with the English term in brackets where the book gives one). Say only what the figure shows or the page says; add nothing else.
Output JSON only: {"figures": [...]}, or {"figures": []} if the page has no figure.`;

type Fig = { box_2d: number[]; label?: string; caption?: string; explain?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function look(jpg: string, text: string): Promise<{ figs: Fig[]; model: string } | undefined> {
  const data = readFileSync(jpg).toString('base64');
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const { m, k } of routes) {
      const route = `${m} key${keys.indexOf(k) + 1}`;
      if (dead.has(route)) continue;
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': k },
          body: JSON.stringify({ contents: [{ parts: [{ text }, { inline_data: { mime_type: 'image/jpeg', data } }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', thinkingConfig: m.startsWith('gemini-2.5') ? { thinkingBudget: 512 } : { thinkingLevel: 'low' } } }),
          signal: AbortSignal.timeout(120_000),
        });
        const d = (await r.json()) as { error?: { message?: string; details?: { violations?: { quotaId?: string }[] }[] }; candidates?: { content?: { parts?: { text?: string }[] } }[] };
        if (!r.ok) {
          if (d.error?.details?.some((x) => x.violations?.some((v) => /PerDay/.test(v.quotaId ?? '')))) { dead.add(route); console.warn(`${route}: daily quota spent`); }
          else console.warn(`${jpg.slice(-8)} ${route}: ${r.status} ${d.error?.message?.slice(0, 90) ?? ''}`);
          continue;
        }
        const t = d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
        const figs = (JSON.parse(t.replace(/^```(json)?|```$/g, '')) as { figures?: Fig[] }).figures;
        if (Array.isArray(figs)) return { figs, model: m };
      } catch (e) { console.warn(`${jpg.slice(-8)} ${route}: ${(e as Error).message.slice(0, 80)}`); }
    }
    if (dead.size === routes.length) return undefined;
    await sleep(15_000 * (attempt + 1));
  }
  return undefined;
}

/** a figure worth keeping: a real box (not the whole page, not a speck) and an explanation */
const str = (x: unknown) => (Array.isArray(x) ? x.join(' ') : typeof x === 'string' ? x : '').trim();
// the model sometimes wraps the box once more: [[y0, x0, y1, x1]]
const boxOf = (f: Fig) => ((f.box_2d ?? []) as unknown[]).flat() as number[];
const usable = (f: Fig) => {
  const b = boxOf(f);
  if (b.length !== 4) return false;
  const [y0, x0, y1, x1] = b;
  if (![y0, x0, y1, x1].every((v) => typeof v === 'number' && v >= 0 && v <= 1000)) return false;
  const area = ((y1! - y0!) * (x1! - x0!)) / 1e6;
  return area > 0.01 && area < 0.9 && str(f.explain).length >= 30;
};

for (const id of process.argv.slice(2)) {
  const meta = metas.find((b) => b.id === id);
  if (!meta) throw new Error(`no book ${id} in books.json`);
  const pdf = resolve(books, 'pdf', PDF[id] ?? `${id}.pdf`);
  const pages = resolve(books, 'pages', id, 'color');
  const cache = resolve(books, 'pages', id, 'figures');
  mkdirSync(cache, { recursive: true });
  execFileSync(python, ['-I', resolve(repo, 'tools/books/figures.py'), 'render', pdf, pages], { stdio: 'inherit' });
  const chapterOf = (p: number) => meta.chapters.find((c) => p >= c.startPage && p <= c.endPage)?.n ?? 0;
  const files = readdirSync(pages).filter((f) => /^p\d{3}\.jpg$/.test(f)).sort().filter((f) => chapterOf(Number(f.slice(1, 4))) && !meta.skipPages?.includes(Number(f.slice(1, 4))))
    .filter((f) => !process.env.PAGES || process.env.PAGES.split(',').includes(String(Number(f.slice(1, 4)))));
  const text = prompt(meta.subject.en, LANG[id] ?? 'Odia');
  let next = 0, asked = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++]!;
      const saved = resolve(cache, f.replace('.jpg', '.json'));
      if (existsSync(saved) || process.env.CUT_ONLY || dead.size === routes.length) continue;
      const r = await look(resolve(pages, f), text);
      if (!r) { console.warn(`${id} ${f}: no answer`); continue; }
      writeFileSync(saved, JSON.stringify(r, null, 1));
      if (++asked % 10 === 0) console.log(`${id}: ${asked} pages looked at, ${Math.round((Date.now() - t0) / 1000)} s`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  const out: { pdfPage: number; page: number; ch: number; n: number; box: number[]; label: string; caption: string; explain: string; img: string; by: string }[] = [];
  for (const f of files) {
    const saved = resolve(cache, f.replace('.jpg', '.json'));
    if (!existsSync(saved)) continue;
    const { figs, model } = JSON.parse(readFileSync(saved, 'utf8')) as { figs: Fig[]; model: string };
    const pdfPage = Number(f.slice(1, 4));
    figs.filter(usable).forEach((g, i) => out.push({
      pdfPage, page: pdfPage - meta.pageOffset, ch: chapterOf(pdfPage), n: i + 1, box: boxOf(g),
      label: str(g.label), caption: str(g.caption), explain: str(g.explain), img: `p${f.slice(1, 4)}-${i + 1}.jpg`, by: model,
    }));
  }
  const dir = resolve(books, 'figures', id);
  mkdirSync(dir, { recursive: true });
  const list = resolve(books, 'figures', `${id}.json`);
  writeFileSync(list, JSON.stringify(out, null, 1));
  execFileSync(python, ['-I', resolve(repo, 'tools/books/figures.py'), 'crop', pdf, list, dir], { stdio: 'inherit' });
  const missing = files.filter((f) => !existsSync(resolve(cache, f.replace('.jpg', '.json')))).length;
  console.log(`${id}: ${out.length} figures on ${new Set(out.map((x) => x.pdfPage)).size} pages${missing ? `; ${missing} pages not looked at yet (run again)` : ''}`);
}

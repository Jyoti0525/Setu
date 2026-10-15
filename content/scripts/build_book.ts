// Book indexes for the tutor (PLAN v4, P8.1): content/books/books.json + the OCR of each PDF → content/books/out/<id>.json.
// The Motion chapter (hand-written, verified pack) joins the shelf as Physical Science, so one search covers all.
// usage: pnpm --filter @setu/content exec tsx scripts/build_book.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBook, type BookIndex, type BookMeta } from '@setu/core';
import { motionPack } from '../src/index.ts';
import { correct } from './corrections.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../books');
const out = resolve(root, 'out');
mkdirSync(out, { recursive: true });

const metas = JSON.parse(readFileSync(resolve(root, 'books.json'), 'utf8')) as BookMeta[];
const written: { id: string; passages: number; glossary: number; kb: number }[] = [];
const save = (raw: BookIndex) => {
  const b = correct(raw).book; // native-speaker fixes to the OCR (books/corrections.json)
  const body = JSON.stringify(b);
  writeFileSync(resolve(out, `${b.meta.id}.json`), body);
  written.push({ id: b.meta.id, passages: b.passages.length, glossary: b.glossary.length, kb: Math.round(body.length / 1024) });
};

for (const meta of metas) {
  const ocr = resolve(root, 'ocr', `${meta.id}.json`);
  if (!existsSync(ocr)) { console.warn(`skip ${meta.id}: no OCR yet (${ocr})`); continue; }
  save(withFigures(buildBook(meta, JSON.parse(readFileSync(ocr, 'utf8')))));
}

/** The book's figures (scripts/figures.ts) join it as passages on their pages: what a picture shows, in words. */
function withFigures(b: BookIndex): BookIndex {
  const f = resolve(root, 'figures', `${b.meta.id}.json`);
  if (!existsSync(f)) return b;
  const figs = JSON.parse(readFileSync(f, 'utf8')) as { pdfPage: number; page: number; ch: number; n: number; label: string; caption: string; explain: string; img: string }[];
  const have = figs.filter((x) => x.ch && existsSync(resolve(root, 'figures', b.meta.id, x.img)));
  const passages = [...b.passages, ...have.map((x) => ({
    id: `${b.meta.id}.f${x.pdfPage}.${x.n}`, ch: x.ch, page: x.page,
    text: `${x.caption || x.label || '[ଚିତ୍ର]'} — ${x.explain}`, fig: `${b.meta.id}/${x.img}`,
  }))];
  return { ...b, passages, version: `${b.version}.f${have.length}` };
}

// Physical Science · Motion: the pack's textbook passages and its explanations, Odia text
const p = motionPack;
const motion: BookIndex = {
  meta: {
    id: 'physical-science-9',
    subject: { or: 'ଭୌତିକ ବିଜ୍ଞାନ', en: 'Physical Science', hi: 'भौतिक विज्ञान' },
    title: { or: 'ଭୌତିକ ବିଜ୍ଞାନ — ଗତି', en: 'Physical Science — Motion' },
    classLevel: 9,
    board: 'BSE Odisha',
    source: 'Setu chapter pack (hand-written to the BSE syllabus; Odia pending native review) — guided practice available',
    pageOffset: 0,
    chapters: [{ n: 1, title: { or: p.title.or ?? 'ଗତି', en: p.title.en ?? 'Motion' }, startPage: 0, endPage: 9999 }],
  },
  passages: [
    ...p.passages.filter((x) => x.text.or).map((x) => ({ id: `physical-science-9.${x.id}`, ch: 1, page: x.page ?? 0, text: x.text.or! })),
    ...p.explanations.filter((e) => e.body.display.or).map((e) => ({ id: `physical-science-9.${e.id.split('@')[0]}`, ch: 1, page: 0, text: e.body.display.or! })),
  ],
  glossary: p.glossary.filter((g) => g.term.or).map((g) => ({ or: g.term.or!, en: g.english })),
  version: String(p.version) + '.' + (p.hash ?? '').slice(0, 8),
};
// the real Physical Science book, once OCR'd, replaces the Motion-only index (Motion stays as guided practice)
if (written.some((w) => w.id === motion.meta.id)) console.log('physical-science-9: full textbook OCR used; Motion pack index not written');
else save(motion);
console.table(written);

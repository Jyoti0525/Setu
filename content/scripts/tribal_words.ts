// Home-language words for tier C learners (Kui, Kuvi, Ho, Saora, Munda): the Government of Odisha's Odia–<language>
// dictionaries ("Sabdakosh", 2018) and trilingual primers ("Sarala Tribhasi Bhasha Sikshyana Pustika": English | Odia |
// <language>), OCR'd with word positions (scripts/ocr_words.mjs) → content/tribal/<id>.json.
// Only pairs both sides of which the OCR read confidently are kept; nothing is generated or guessed.
// usage: pnpm --filter @setu/content exec tsx scripts/tribal_words.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixOdiaOcr } from '@setu/core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ocrDir = resolve(root, 'books/ocr/tribal');
const outDir = resolve(root, 'tribal');

interface Word { t: string; x0: number; y0: number; x1: number; y1: number; c: number }
interface Line { y: number; w: Word[] }
export interface HomeEntry { or: string; home: string; en?: string; ex?: { or: string; home: string }; from: 'dictionary' | 'primer' }

/** words → printed lines (same baseline), left to right */
function linesOf(words: Word[]): Line[] {
  const lines: Line[] = [];
  for (const w of [...words].sort((a, b) => a.y0 - b.y0)) {
    const mid = (w.y0 + w.y1) / 2;
    const l = lines.find((x) => Math.abs(x.y - mid) < 14);
    if (l) l.w.push(w); else lines.push({ y: mid, w: [w] });
  }
  for (const l of lines) l.w.sort((a, b) => a.x0 - b.x0);
  return lines.sort((a, b) => a.y - b.y);
}

const ODIA_WORD = /^[଀-୿‌‍]+$/;
const MIN_CONF = 75;
/** an Odia-script word as printed, or undefined when the OCR was unsure or read junk */
const clean = (ws: Word[]) => {
  const t = ws.map((w) => w.t.replace(/[।|,;.!?()]+$/g, '').replace(/^[(]+/, '')).filter(Boolean);
  if (!t.length || !t.every((x) => ODIA_WORD.test(x)) || ws.some((w) => w.c < MIN_CONF)) return undefined;
  return fixOdiaOcr(t.join(' ')).trim();
};
/** a sentence: Odia words only, confidently read on average */
const sentence = (ws: Word[]) => {
  const body = ws.filter((w) => !/^[-:(]|^\(.*\)$/.test(w.t));
  if (body.length < 2 || body.reduce((a, w) => a + w.c, 0) / body.length < 80) return undefined;
  const t = body.map((w) => w.t.replace(/\|$/, '।')).join(' ').replace(/\s+([।|])/g, '$1').replace(/\|/g, '।');
  return /[A-Za-z0-9]/.test(t) ? undefined : fixOdiaOcr(t);
};
const SEP = /^[:\-–]$/;
const sepAt = (l: Line) => l.w.findIndex((w) => SEP.test(w.t));

/** the commonest first letters of the Odia headwords on a page (the dictionary is in Odia alphabetical order) */
function pageLetters(heads: string[]): Set<string> {
  const n = new Map<string, number>();
  for (const h of heads) n.set(h[0]!, (n.get(h[0]!) ?? 0) + 1);
  return new Set([...n].filter(([, c]) => c >= 3).map(([k]) => k));
}

/** Kui, Munda: "odia : odia sentence" then "home : home sentence" */
function alternating(pages: { words: Word[] }[]): HomeEntry[] {
  const out: HomeEntry[] = [];
  for (const p of pages) {
    const ls = linesOf(p.words).filter((l) => sepAt(l) > 0);
    const letters = pageLetters(ls.map((l) => l.w[0]!.t));
    for (let i = 0; i + 1 < ls.length; i++) {
      const a = ls[i]!, b = ls[i + 1]!;
      if (!letters.has(a.w[0]!.t[0]!)) continue;
      const or = clean(a.w.slice(0, sepAt(a))), home = clean(b.w.slice(0, sepAt(b)));
      i++;
      if (!or || !home) continue;
      const exOr = sentence(a.w.slice(sepAt(a) + 1)), exHome = sentence(b.w.slice(sepAt(b) + 1));
      out.push({ or, home, ...(exOr && exHome ? { ex: { or: exOr, home: exHome } } : {}), from: 'dictionary' });
    }
  }
  return out;
}

/** Ho: "odia - home   (ଓଡ଼ିଆ) - sentence" then "(ହୋ) - sentence" */
function hoStyle(pages: { words: Word[] }[]): HomeEntry[] {
  const out: HomeEntry[] = [];
  for (const p of pages) {
    const ls = linesOf(p.words);
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i]!;
      const tag = l.w.findIndex((w) => /^\(ଓଡ଼?ିଆ\)$/.test(w.t));
      const s = sepAt(l);
      if (s <= 0 || tag < 0 || s > tag) continue;
      const or = clean(l.w.slice(0, s)), home = clean(l.w.slice(s + 1, tag));
      if (!or || !home) continue;
      const next = ls[i + 1];
      const exOr = sentence(l.w.slice(tag + 1)), exHome = next && /^\(/.test(next.w[0]?.t ?? '') ? sentence(next.w.slice(1)) : undefined;
      out.push({ or, home, ...(exOr && exHome ? { ex: { or: exOr, home: exHome } } : {}), from: 'dictionary' });
    }
  }
  return out;
}

/** Saora: "odia : home" then "ଓ : odia sentence" then "ସ : home sentence" */
function saoraStyle(pages: { words: Word[] }[]): HomeEntry[] {
  const out: HomeEntry[] = [];
  for (const p of pages) {
    const ls = linesOf(p.words);
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i]!;
      const s = sepAt(l);
      if (s <= 0 || l.w[0]!.t === 'ଓ' || l.w[0]!.t === 'ସ') continue;
      const or = clean(l.w.slice(0, s)), home = clean(l.w.slice(s + 1));
      if (!or || !home) continue;
      const o = ls[i + 1], h = ls[i + 2];
      const exOr = o?.w[0]?.t === 'ଓ' ? sentence(o.w.slice(1)) : undefined;
      const exHome = h?.w[0]?.t === 'ସ' ? sentence(h.w.slice(1)) : undefined;
      out.push({ or, home, ...(exOr && exHome ? { ex: { or: exOr, home: exHome } } : {}), from: 'dictionary' });
    }
  }
  return out;
}

/** Kuvi: "odia : home" (two columns, no sentences); several home words may be given ("ନର, ମାଲମି") */
function pairs(pages: { words: Word[] }[]): HomeEntry[] {
  const out: HomeEntry[] = [];
  for (const p of pages) {
    for (const l of linesOf(p.words)) {
      const s = sepAt(l);
      if (s <= 0) continue;
      const or = clean(l.w.slice(0, s));
      const rest = l.w.slice(s + 1).filter((w) => w.t !== '`');
      const home = clean(rest.map((w) => ({ ...w, t: w.t.replace(/[,/]$/, '') })).filter((w) => w.t && w.t !== '/'));
      if (or && home) out.push({ or, home: home.split(' ').length > 2 ? home.split(' ').slice(0, 2).join(' ') : home, from: 'dictionary' });
    }
  }
  return out;
}

/** primer tables: English | Odia | home (columns told apart by the header row's x positions) */
function primer(pages: { words: Word[] }[]): HomeEntry[] {
  const out: HomeEntry[] = [];
  for (const p of pages) {
    const ls = linesOf(p.words);
    const head = ls.findIndex((l) => l.w[0]?.t === 'English' && l.w.length >= 3);
    if (head < 0) continue;
    const h = ls[head]!;
    const oX = h.w[1]!.x0 - 15, homeX = h.w[2]!.x0 - 15;
    for (const l of ls.slice(head + 1)) {
      const en = l.w.filter((w) => w.x1 < oX && /^[A-Za-z][A-Za-z'-]*$/.test(w.t)).map((w) => w.t).join(' ');
      const or = clean(l.w.filter((w) => w.x0 >= oX && w.x0 < homeX));
      const home = clean(l.w.filter((w) => w.x0 >= homeX).map((w) => ({ ...w, t: w.t.replace(/[,/]$/, '') })).filter((w) => w.t && w.t !== '/'));
      if (en && or && home) out.push({ or, home, en, from: 'primer' });
    }
  }
  return out;
}

const SOURCES: { id: string; name: string; dict?: [string, (p: { words: Word[] }[]) => HomeEntry[], string]; primer?: [string, string] }[] = [
  { id: 'kxu', name: 'Kui', dict: ['kui', alternating, 'Odia-Kui Sabdakosh (Clement Naik, Sushil Kumar Digal; Special Development Council, Kandhamal; Govt. of Odisha, 2018) — archive.org/details/in.gov.tribals.74051'], primer: ['kui_primer', 'Sarala (Tribhasi) Bhasha Sikshyana Pustika (Kui), Govt. of Odisha — archive.org/details/in.gov.tribals.74106'] },
  { id: 'kxv', name: 'Kuvi', dict: ['kuvi', pairs, 'Odia-Kuvi Sabdakosh, Govt. of Odisha, 2018 — archive.org/details/in.gov.tribals.74050'], primer: ['kuvi_primer', 'Sarala (Tribhasi) Bhasha Sikshyana Pustika (Kuvi), Govt. of Odisha — archive.org/details/in.gov.tribals.74105'] },
  { id: 'hoc', name: 'Ho', dict: ['ho', hoStyle, 'Odia-Ho Sabdakosh, Govt. of Odisha, 2018 — archive.org/details/in.gov.tribals.74057'], primer: ['ho_primer', 'Sarala (Tribhasi) Bhasha Sikshyana Pustika (Ho), Govt. of Odisha — archive.org/details/in.gov.tribals.74112'] },
  { id: 'srb', name: 'Saora', dict: ['saora', saoraStyle, 'Odia-Saora Sabdakosh, Govt. of Odisha, 2018 — archive.org/details/in.gov.tribals.74072'], primer: ['saora_primer', 'Sarala (Tribhasi) Bhasha Sikshyana Pustika (Saora), Govt. of Odisha — archive.org/details/in.gov.tribals.74100'] },
  { id: 'unr', name: 'Munda', dict: ['munda', alternating, 'Odia-Munda Sabdakosh, Govt. of Odisha, 2018 — archive.org/details/in.gov.tribals.74076'], primer: ['munda_primer', 'Sarala (Tribhasi) Bhasha Sikshyana Pustika (Munda), Govt. of Odisha — archive.org/details/in.gov.tribals.74104'] },
];

mkdirSync(outDir, { recursive: true });
const table: Record<string, unknown>[] = [];
for (const s of SOURCES) {
  const entries: HomeEntry[] = [];
  const sources: string[] = [];
  for (const [file, parse, source] of [s.dict, s.primer && ([s.primer[0], primer, s.primer[1]] as const)].filter(Boolean) as [string, (p: { words: Word[] }[]) => HomeEntry[], string][]) {
    const f = resolve(ocrDir, `${file}.words.json`);
    if (!existsSync(f)) { console.warn(`skip ${file}: no OCR`); continue; }
    entries.push(...parse(JSON.parse(readFileSync(f, 'utf8'))));
    sources.push(source);
  }
  // one entry per Odia word: a primer entry (it has the English word) wins, then one with an example
  const best = new Map<string, HomeEntry>();
  const rank = (e: HomeEntry) => (e.en ? 2 : 0) + (e.ex ? 1 : 0);
  for (const e of entries) if (e.or !== e.home || e.en) { const had = best.get(e.or); if (!had || rank(e) > rank(had)) best.set(e.or, e); }
  const list = [...best.values()].sort((a, b) => a.or.localeCompare(b.or, 'or'));
  writeFileSync(resolve(outDir, `${s.id}.json`), JSON.stringify({ id: s.id, name: s.name, sources, license: 'Government of Odisha publication, relicensed CC BY 4.0 by Odisha Virtual Academy (2019)', entries: list }, null, 0).replace(/},{/g, '},\n{') + '\n');
  table.push({ id: s.id, words: list.length, primer: list.filter((e) => e.from === 'primer').length, examples: list.filter((e) => e.ex).length });
}
console.table(table);

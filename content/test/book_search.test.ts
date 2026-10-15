import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emptyMemory, LEXICON, looseKey, normalizeForMatch, planTurn, screen, Shelf, type BookIndex } from '@setu/core';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../books/out');
// an Odia-medium learner's phone holds her board's books only (BSE Odisha); the CBSE books are another learner's
const books = readdirSync(out).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(out, f), 'utf8')) as BookIndex).filter((b) => b.meta.board === 'BSE Odisha');
const shelf = new Shelf(books);
const { cases } = JSON.parse(readFileSync(resolve(here, '../eval/book_search.json'), 'utf8')) as { cases: { q: string; picked?: string[]; want: string[] }[] };

/** what the phone shows with no signal: the same search + policy as the chat's offline turn */
const shown = (q: string, picked?: string[]) => {
  const hits = shelf.search(q, { limit: 4, picked });
  const first = planTurn(emptyMemory(), { safety: screen(q, true), text: q, hits, bookIds: picked, online: false, now: 0 }).grounding[0];
  return first && `${first.bookId}#${first.passage.ch}`;
};

describe('offline textbook search (eval/book_search.json)', () => {
  it('romanized Odia, Odia script and spoken spellings meet', () => {
    expect(looseKey('ବାୟୁ')).toBe(looseKey('bayu'));
    expect(looseKey('bayu')).toBe(looseKey('vayu'));
    expect(looseKey('ମୌସୁମୀ')).toBe(looseKey('mousumi'));
    expect(looseKey('ରକ୍ତ')).toBe(looseKey('rakto'));
    expect(looseKey('ନିଆଁ')).toBe(looseKey('nian'));
  });
  it('study questions: the shown passage is in the right chapter ≥ 85% (was 68% before loose keys + chapter voting)', () => {
    const study = cases.filter((c) => c.want.length);
    const right = study.filter((c) => c.want.includes(shown(c.q, c.picked) ?? ''));
    expect(right.length / study.length).toBeGreaterThanOrEqual(0.85);
  });
  it('romanized Odia questions all land in the right chapter', () => {
    for (const q of ['rakta kanika kete prakara', 'rakto konika kete prokar', 'mausumi bayu kana', 'mousumi vayu', 'bima kana', 'sadaka durghatana', 'nian lagile kana kariba', 'jakshma roga', 'bega o druti'])
      expect(cases.find((c) => c.q === q)!.want, q).toContain(shown(q));
  });
  it('her subject has nothing on it → not answered here: she is sent to the subject that does (one chat, one subject)', () => {
    const q = 'mausumi bayu';
    const plan = planTurn(emptyMemory(), { safety: screen(q, true), text: q, hits: shelf.search(q, { limit: 4, picked: ['life-science-9'] }), bookIds: ['life-science-9'], online: false, now: 0 });
    expect(plan.action).toBe('other_subject');
    expect(plan.otherBook).toBe('geography-economics-9');
    expect(plan.grounding).toEqual([]);
  });
  it('chit-chat mostly shows no page (≥ 9 of 12)', () => {
    const chat = cases.filter((c) => !c.want.length);
    expect(chat.filter((c) => !shown(c.q)).length).toBeGreaterThanOrEqual(9);
  });
  it('every chapter on the shelf can be taught as a guided lesson, part by part, from its own pages', () => {
    let chapters = 0;
    for (const b of books) for (const c of b.meta.chapters) {
      const parts = shelf.lessonParts(b.meta.id, c.n);
      const pages = parts.flat().map((p) => p.page);
      // a chapter with no readable page (e.g. all figures) has no lesson; the rest start on their own pages, in order
      if (!parts.length) continue;
      chapters++;
      expect(parts.every((p) => p.length > 0 && p.every((x) => x.ch === c.n)), `${b.meta.id}#${c.n}`).toBe(true);
      expect(pages, `${b.meta.id}#${c.n}`).toEqual([...pages].sort((x, y) => x - y));
    }
    expect(chapters).toBeGreaterThanOrEqual(60);
  });
  it('every Odia word in the English→Odia list is in the books', () => {
    const all = normalizeForMatch(books.flatMap((b) => b.passages.map((p) => p.text)).join(' '));
    for (const [en, ors] of Object.entries(LEXICON)) for (const o of ors) expect(all.includes(normalizeForMatch(o)), `${en} → ${o}`).toBe(true);
  });
});

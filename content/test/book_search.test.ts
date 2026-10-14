import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emptyMemory, LEXICON, looseKey, normalizeForMatch, planTurn, screen, Shelf, type BookIndex } from '@setu/core';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../books/out');
const books = readdirSync(out).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(out, f), 'utf8')) as BookIndex);
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
  it('her subject has nothing on it → the subject that does', () => {
    expect(shown('mausumi bayu', ['life-science-9'])).toBe('geography-economics-9#5');
  });
  it('chit-chat mostly shows no page (≥ 9 of 12)', () => {
    const chat = cases.filter((c) => !c.want.length);
    expect(chat.filter((c) => !shown(c.q)).length).toBeGreaterThanOrEqual(9);
  });
  it('every tap-to-ask card on the chat screen shows a page from its own book', () => {
    const chat = readFileSync(resolve(here, '../../apps/web/src/chat.tsx'), 'utf8');
    const block = /const IDEAS[^=]*= \{([\s\S]*?)\n\};/.exec(chat)![1]!;
    const cards = [...block.matchAll(/'([\w-]+)': \{ or: \[(.*?)\], en: \[(.*?)\] \}/g)]
      .flatMap((m) => [...`${m[2]},${m[3]}`.matchAll(/'((?:\\'|[^'])*)'/g)].map((q) => [m[1]!, q[1]!.replace(/\\'/g, "'")] as const));
    expect(cards.length).toBeGreaterThanOrEqual(14);
    for (const [book, q] of cards) expect(shown(q)?.split('#')[0], q).toBe(book);
  });
  it('every Odia word in the English→Odia list is in the books', () => {
    const all = normalizeForMatch(books.flatMap((b) => b.passages.map((p) => p.text)).join(' '));
    for (const [en, ors] of Object.entries(LEXICON)) for (const o of ors) expect(all.includes(normalizeForMatch(o)), `${en} → ${o}`).toBe(true);
  });
});

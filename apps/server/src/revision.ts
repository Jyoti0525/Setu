import type { LlmRequest } from '@google/adk';
import { nameIn, type BookPassage, type Shelf } from '@setu/core';
import { parseJson, textOf } from './agent/cycle.ts';
import type { HybridRag } from './rag.ts';
import type { ModelSet } from './llm.ts';

export interface RevisionCard {
  id: string;
  type: 'idea' | 'steps' | 'formula' | 'remember';
  title: string;
  body: string;
  formula?: string;
  keywords: string[];
  evidence: string;
  sources: { passageId: string; page: number }[];
}

const clean = (x: unknown, max: number) => typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const evidenceKey = (x: string) => x.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
const formulaKey = (x: string) => x.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');

export function parseRevisionCards(value: unknown, passages: BookPassage[]): RevisionCard[] {
  const raw = value as { cards?: unknown } | null;
  if (!Array.isArray(raw?.cards)) return [];
  const byId = new Map(passages.map((p) => [p.id, p]));
  const cards: RevisionCard[] = [];
  for (const item of raw.cards) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const type = c.type;
    const title = clean(c.title, 100);
    const body = clean(c.body, 420);
    const formula = clean(c.formula, 160);
    const evidence = clean(c.evidence, 500);
    const ids = Array.isArray(c.passageIds) ? [...new Set(c.passageIds.filter((x): x is string => typeof x === 'string'))] : [];
    const sources = ids.map((id) => byId.get(id)).filter((p): p is BookPassage => !!p);
    const key = evidenceKey(evidence);
    if (!['idea', 'steps', 'formula', 'remember'].includes(String(type)) || !title || !body || !key || !sources.length || sources.length !== ids.length) continue;
    if (!sources.some((p) => evidenceKey(p.text).includes(key))) continue;
    if (type === 'formula' && (!formula || !sources.some((p) => formulaKey(p.text).includes(formulaKey(formula))))) continue;
    const keywords = Array.isArray(c.keywords) ? [...new Set(c.keywords.map((x) => clean(x, 36)).filter(Boolean))].slice(0, 4) : [];
    if (keywords.length < 2) continue;
    cards.push({ id: `card-${cards.length + 1}`, type: type as RevisionCard['type'], title, body, ...(formula ? { formula } : {}), keywords, evidence, sources: sources.map((p) => ({ passageId: p.id, page: p.page })) });
  }
  return cards.slice(0, 10);
}

export async function generateRevisionCards(o: {
  shelf: Shelf; rag?: HybridRag; models: ModelSet; bookId: string; chapterNumber: number;
  board: string; classLevel: number; lang: string; avoidTitles?: string[];
}): Promise<{ title: string; cards: RevisionCard[]; trace: { tool: string; note: string }[] }> {
  const book = o.shelf.books.get(o.bookId);
  if (!book || book.meta.board.toLowerCase().replace(/[^a-z0-9]/g, '') !== o.board.toLowerCase().replace(/[^a-z0-9]/g, '') || book.meta.classLevel !== o.classLevel) throw new Error('This book is not part of your selected board and class.');
  const chapter = book.meta.chapters.find((x) => x.n === o.chapterNumber);
  if (!chapter) throw new Error('This chapter is not in the selected textbook.');
  const all = book.passages.filter((p) => p.ch === chapter.n).sort((a, b) => a.page - b.page);
  if (all.length < 2) throw new Error('There is not enough readable textbook content in this chapter yet.');

  const ranked: BookPassage[] = [];
  if (o.rag) {
    try {
      const result = await o.rag.search(`${chapter.title.en} ${chapter.title.or}`, { picked: [book.meta.id], only: [book.meta.id], limit: 12 });
      ranked.push(...result.hits.filter((h) => h.bookId === book.meta.id && h.passage.ch === chapter.n).map((h) => h.passage));
    } catch { /* use the local textbook index below */ }
  }
  ranked.push(...o.shelf.search(`${chapter.title.en} ${chapter.title.or}`, { bookId: book.meta.id, limit: 12 }).filter((h) => h.passage.ch === chapter.n).map((h) => h.passage));
  const selected = new Map<string, BookPassage>();
  for (const p of ranked) if (selected.size < 5) selected.set(p.id, p);
  const target = Math.min(10, all.length);
  for (let i = 0; selected.size < target && i < target * 3; i++) {
    const p = all[Math.floor(i * (all.length - 1) / Math.max(1, target - 1))]!;
    selected.set(p.id, p);
  }
  const passages = [...selected.values()];
  const model = o.models.generateFor(o.lang);
  if (!model) throw new Error('Revision cards are unavailable because no writing model is configured.');
  const language = o.lang === 'or' ? 'Odia' : o.lang === 'hi' ? 'Hindi' : o.lang === 'en' ? 'English' : o.lang;
  const avoidTitles = [...new Set((o.avoidTitles ?? []).map((x) => clean(x, 100)).filter(Boolean))].slice(0, 30);
  const system = `You are Setu, making colorful revision cards for a Class ${book.meta.classLevel} student. Write the title, body, formula, and keywords in warm, natural ${language} that a student can understand quickly. Textbook passages may be in another language: translate their ideas faithfully into ${language}. Use only the supplied textbook. Create 6 to 8 short, useful cards with varied types: idea (a key concept), steps (a method in a few steps), formula (only when a formula actually appears in the supplied pages), and remember (a helpful keyword or distinction). Keep each body to 1–3 short sentences; avoid textbook-length paragraphs and AI-sounding phrasing. Put formulas in the separate formula field using readable notation; omit it when not relevant. Give 2–4 short memory keywords. Do not invent facts, formulas, examples, or numbers. Do not reuse any excluded titles; choose other useful textbook ideas instead. Return JSON only: {"cards":[{"type":"idea|steps|formula|remember","title":"...","body":"...","formula":"...","keywords":["...","..."],"evidence":"an exact phrase or sentence copied verbatim from a supplied passage in its original language","passageIds":["exact passage id"]}]}. Every card must cite one or more supplied passage IDs and include verbatim original-language evidence copied from a cited passage; evidence stays in the book's language for source checking, while all student-facing note content stays in ${language}.`;
  const user = JSON.stringify({ board: book.meta.board, class: book.meta.classLevel, subject: nameIn(book.meta.subject, o.lang), chapter: nameIn(chapter.title, o.lang), ...(avoidTitles.length ? { excludedCardTitles: avoidTitles } : {}), passages: passages.map((p) => ({ id: p.id, page: p.page, text: p.text.slice(0, 1400) })) });
  const request = { contents: [{ role: 'user', parts: [{ text: user }] }], config: { systemInstruction: system, temperature: 0.25, responseMimeType: 'application/json' }, liveConnectConfig: {}, toolsDict: {} } as unknown as LlmRequest;
  let output = '';
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const generated = (async () => { for await (const response of model.generateContentAsync(request, false, controller.signal)) output += textOf(response); })();
    await Promise.race([generated, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Setu could not prepare the revision cards in time. Please try again.')); }, 22_000); })]);
  } finally { if (timer) clearTimeout(timer); controller.abort(); }
  const excluded = new Set(avoidTitles.map((x) => x.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim()));
  const cards = parseRevisionCards(parseJson(output), passages).filter((card) => !excluded.has(card.title.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim()));
  if (cards.length < 4) throw new Error('Setu could not verify enough revision cards against this textbook chapter. Please try again.');
  return {
    title: nameIn(chapter.title, o.lang), cards,
    trace: [{ tool: 'books.open', note: `${passages.length} passages from ${book.meta.board} · Class ${book.meta.classLevel} · ${chapter.title.en}` }, { tool: 'revision.validate', note: `${cards.length} cards passed source-citation checks` }],
  };
}

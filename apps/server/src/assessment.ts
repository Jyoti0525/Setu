import type { LlmRequest } from '@google/adk';
import { nameIn, type BookIndex, type BookPassage, type BookChapter, type Shelf } from '@setu/core';
import { parseJson, textOf } from './agent/cycle.ts';
import type { HybridRag } from './rag.ts';
import type { ModelSet } from './llm.ts';

export interface AssessmentQuestion {
  id: string;
  type: 'mcq' | 'blank' | 'short' | 'long';
  question: string;
  options?: string[];
  answer: string;
  accepted?: string[];
  rubric?: string[];
  explanation: string;
  evidence: string;
  sources: { passageId: string; page: number }[];
}

const compact = (s: unknown, max = 600) => typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
// Learners may choose English or Hindi for an Odia source book. Check that citations
// are verbatim source text, but don't demand translated answer keys to occur in Odia.
const evidenceNorm = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();

export function parseAssessmentQuestions(value: unknown, sources: BookPassage[]): AssessmentQuestion[] {
  const raw = value as { questions?: unknown } | null;
  if (!Array.isArray(raw?.questions)) return [];
  const byId = new Map(sources.map((p) => [p.id, p]));
  const out: AssessmentQuestion[] = [];
  for (const item of raw.questions) {
    const q = item as Record<string, unknown>;
    const type = q.type;
    const question = compact(q.question, 500);
    const answer = compact(q.answer, 300);
    const explanation = compact(q.explanation, 500);
    const evidence = compact(q.evidence, 500);
    const passageIds = Array.isArray(q.passageIds) ? [...new Set(q.passageIds.filter((x): x is string => typeof x === 'string'))] : [];
    const matched = passageIds.map((id) => byId.get(id)).filter((p): p is BookPassage => !!p);
    if (!['mcq', 'blank', 'short', 'long'].includes(String(type)) || !question || !answer || !explanation || !evidence || !matched.length || matched.length !== passageIds.length) continue;
    const evidenceKey = evidenceNorm(evidence);
    if (!evidenceKey || !matched.some((p) => evidenceNorm(p.text).includes(evidenceKey))) continue;
    const rubric = Array.isArray(q.rubric) ? q.rubric.map((x) => compact(x, 100)).filter(Boolean).slice(0, 5) : [];
    const options = Array.isArray(q.options) ? [...new Set(q.options.map((x) => compact(x, 200)).filter(Boolean))].slice(0, 4) : [];
    if (type === 'mcq' && (options.length !== 4 || !options.some((x) => norm(x) === norm(answer)))) continue;
    if (type !== 'mcq' && options.length) continue;
    if ((type === 'short' || type === 'long') && rubric.length < 2) continue;
    const accepted = Array.isArray(q.accepted) ? [...new Set(q.accepted.map((x) => compact(x, 200)).filter(Boolean))].slice(0, 5) : [];
    out.push({
      id: `q${out.length + 1}`, type: type as AssessmentQuestion['type'], question, answer,
      ...(options.length ? { options } : {}), ...(accepted.length ? { accepted } : {}), ...(rubric.length ? { rubric } : {}),
      explanation, evidence, sources: matched.map((p) => ({ passageId: p.id, page: p.page })),
    });
  }
  return out.slice(0, 8);
}

export async function generateAssessment(o: {
  shelf: Shelf; rag?: HybridRag; models: ModelSet; bookId: string; chapterNumber: number; board: string; classLevel: number; lang: string;
}): Promise<{ title: string; questions: AssessmentQuestion[]; trace: { tool: string; note: string }[]; provider: string }> {
  const book = o.shelf.books.get(o.bookId);
  if (!book || book.meta.board.toLowerCase().replace(/[^a-z0-9]/g, '') !== o.board.toLowerCase().replace(/[^a-z0-9]/g, '') || book.meta.classLevel !== o.classLevel) throw new Error('This book is not part of your selected board and class.');
  const chapter = book.meta.chapters.find((c) => c.n === o.chapterNumber);
  if (!chapter) throw new Error('This chapter is not in the selected textbook.');
  const all = book.passages.filter((p) => p.ch === chapter.n).sort((a, b) => a.page - b.page);
  if (all.length < 2) throw new Error('There is not enough readable textbook content in this chapter yet.');

  const trace: { tool: string; note: string }[] = [];
  let ranked: BookPassage[] = [];
  if (o.rag) {
    try {
      const hybrid = await o.rag.search(`${chapter.title.en} ${chapter.title.or}`, { picked: [book.meta.id], only: [book.meta.id], limit: 12 });
      ranked = hybrid.hits.filter((h) => h.bookId === book.meta.id && h.passage.ch === chapter.n).map((h) => h.passage);
      trace.push({ tool: 'books.search', note: `${hybrid.note}; restricted to ${book.meta.id} chapter ${chapter.n}` });
    } catch { /* the chapter's indexed passages remain the deterministic source of truth */ }
  }
  const keyword = o.shelf.search(`${chapter.title.en} ${chapter.title.or}`, { bookId: book.meta.id, limit: 12 })
    .filter((h) => h.passage.ch === chapter.n).map((h) => h.passage);
  ranked = [...ranked, ...keyword];
  // Keep retrieved passages first, then sample through the entire chapter so a test does not over-focus on its title.
  const selected = new Map<string, BookPassage>();
  for (const p of ranked) if (selected.size < 6) selected.set(p.id, p);
  const target = Math.min(10, all.length);
  for (let i = 0; selected.size < target && i < target * 3; i++) {
    const p = all[Math.floor(i * (all.length - 1) / Math.max(1, target - 1))]!;
    selected.set(p.id, p);
  }
  const source = [...selected.values()];
  trace.push({ tool: 'books.open', note: `${source.length} passages from ${book.meta.board} · Class ${book.meta.classLevel} · ${chapter.title.en} · pages ${[...new Set(source.map((p) => p.page))].join(', ')}` });

  const model = o.models.generateFor(o.lang);
  if (!model) throw new Error('Assessment generation is unavailable because no writing model is configured.');
  const language = o.lang === 'or' ? 'Odia' : o.lang === 'hi' ? 'Hindi' : o.lang === 'en' ? 'English' : o.lang;
  const system = `You are Setu, a careful Class ${book.meta.classLevel} textbook assessment writer. Write natural, student-facing questions, choices, answer keys, explanations, and rubric phrases in ${language}. The supplied textbook may use a different language; translate its ideas faithfully into ${language}. Use ONLY the supplied passages. Do not add facts from memory or invent examples, numbers, names, or textbook claims. Return JSON only with this shape: {"questions":[{"type":"mcq|blank|short|long","question":"...","options":["...","...","...","..."],"answer":"...","accepted":["..."],"rubric":["short key phrase","short key phrase"],"explanation":"...","evidence":"an exact sentence or phrase copied verbatim in its original language from one supplied passage","passageIds":["exact passage id"]}]}. Make exactly 6 varied questions: 2 mcq, 2 blank, 1 short, 1 long. MCQ has four plausible, distinct options and answer must equal one option exactly; build distractors from ideas present in these passages, and don't import facts from elsewhere. Blank has one unambiguous answer and optional accepted spellings. Short is a 1–3 sentence response. Long asks the student to explain the main idea in about 80–100 words, with a 3–5 phrase rubric in ${language} so it can be scored quickly. Each question must test a different idea when possible. Keep wording clear, warm, and appropriate for Class ${book.meta.classLevel}; avoid trick questions. Cite passageIds and give exact evidence copied from the cited passage in its original language. Evidence is for source verification; all student-facing content and scoring keys must be in ${language}.`;
  const user = JSON.stringify({ board: book.meta.board, class: book.meta.classLevel, subject: nameIn(book.meta.subject, o.lang), chapter: nameIn(chapter.title, o.lang), passages: source.map((p) => ({ id: p.id, page: p.page, text: p.text.slice(0, 1400) })) });
  const request = { contents: [{ role: 'user', parts: [{ text: user }] }], config: { systemInstruction: system, temperature: 0.2, responseMimeType: 'application/json' }, liveConnectConfig: {}, toolsDict: {} } as unknown as LlmRequest;
  const started = Date.now();
  // Hedge slow providers just like the tutor writer: a second configured model starts while
  // the first is still working, and the first non-empty answer wins. This avoids serially
  // spending the full provider timeout on each free-tier fallback while a student waits.
  const keys = o.models.genKeysFor(o.lang).filter((k) => !o.models.breakers.isOpen(k)).slice(0, 4);
  let provider = '';
  let text = '';
  if (o.models.one && keys.length) {
    text = await new Promise<string>((resolve, reject) => {
      const controllers: AbortController[] = [];
      let next = 0;
      let running = 0;
      let done = false;
      let lastError = 'No assessment writer returned a response.';
      let hedge: ReturnType<typeof setTimeout> | undefined;
      const budget = setTimeout(() => finish(new Error('Assessment generation timed out. Please try again.')), 17_000);
      const finish = (value: string | Error) => {
        if (done) return;
        done = true;
        clearTimeout(budget);
        if (hedge) clearTimeout(hedge);
        for (const controller of controllers) controller.abort();
        if (value instanceof Error) reject(value);
        else resolve(value);
      };
      const launch = () => {
        if (done) return;
        if (next >= keys.length) {
          if (!running) finish(new Error(lastError));
          return;
        }
        const key = keys[next++]!;
        const writer = o.models.one!('generate', key);
        if (!writer) return launch();
        const controller = new AbortController();
        controllers.push(controller);
        running++;
        if (hedge) clearTimeout(hedge);
        hedge = setTimeout(launch, 2_200);
        (async () => {
          let output = '';
          for await (const response of writer.generateContentAsync(request, false, controller.signal)) output += textOf(response);
          return output;
        })().then((output) => {
          running--;
          if (output.trim()) {
            provider = key;
            o.models.lastUsed.generate = key;
            finish(output);
          } else {
            lastError = `${key} returned an empty response.`;
            launch();
          }
        }).catch((error: unknown) => {
          running--;
          lastError = String((error as Error)?.message ?? error).slice(0, 180);
          launch();
        });
      };
      launch();
    });
  } else {
    // Keep compatibility with simple/scripted models used by local development.
    const generated = (async () => { let output = ''; for await (const r of model.generateContentAsync(request)) output += textOf(r); return output; })();
    text = await Promise.race([generated, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Assessment generation timed out. Please try again.')), 17_000))]);
    provider = o.models.lastUsed.generate ?? 'configured model';
  }
  trace.push({ tool: 'assessment.generate', note: `${provider || 'configured model'} · ${Date.now() - started} ms · source-bound question draft` });
  const questions = parseAssessmentQuestions(parseJson(text), source);
  if (questions.length < 4 || !questions.some((q) => q.type === 'mcq') || !questions.some((q) => q.type === 'blank') || !questions.some((q) => q.type === 'long')) throw new Error('The generated questions did not pass textbook evidence checks. Please try again.');
  trace.push({ tool: 'assessment.validate', note: `${questions.length} questions passed source-citation and answer-format checks` });
  return { title: nameIn(chapter.title, o.lang), questions, trace, provider };
}

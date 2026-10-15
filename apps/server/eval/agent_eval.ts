// The tutor agent, measured (content/eval/agent_eval.json: 50 student questions in the Physical Science chat).
// Per question: was it routed right (answer here / sent to the right subject / care / decline), did the answer come from
// the right chapter of her book, what the reviewer did, how long it took; and every answer is graded by a model of a
// different family than the writer (Gemini grades; Groq writes): correct, supported by the cited pages, answers the
// question, Class 9 level. Writes content/eval/results/agent-<date>.json and docs/EVAL.md.
//
//   run the questions itself, through the app's API (server running on :8787):
//     pnpm --filter @setu/server exec tsx eval/agent_eval.ts api
//   or score a run someone did in the app (Playwright, a person): her turns are read from the server's database
//     pnpm --filter @setu/server exec tsx eval/agent_eval.ts db <profileId> [sinceMs]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
process.loadEnvFile(resolve(repo, 'apps/server/.env'));
const B = process.env.SETU_URL ?? 'http://localhost:8787';
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? 'gemini-3.5-flash';
// Flash first on each key; when both are out of free quota, Flash-Lite (still not the writer's family: Groq writes)
const JUDGES = [[JUDGE_MODEL, process.env.GEMINI_API_KEY], [JUDGE_MODEL, process.env.GEMINI_API_KEY_2], ['gemini-3.1-flash-lite', process.env.GEMINI_API_KEY], ['gemini-3.1-flash-lite', process.env.GEMINI_API_KEY_2]].filter(([, k]) => k) as [string, string][];
const judgeDown = new Set<number>();
const judgedBy = new Map<string, number>();

interface Case { id: number; kind: string; q: string; expect: 'answer' | 'redirect' | 'care' | 'decline'; chapters?: number[]; subject?: string }
interface Tool { tool: string; status: string; note?: string }
interface Trace { chosen: string; reason: string; tools: Tool[]; latency_ms: number; status: string; trigger?: string; kind?: string }
interface Turn { q: string; trace: Trace; messages: { text: string; sources: string[]; chips?: { label: string }[] }[] }

const { subject: SUBJECT, cases } = JSON.parse(readFileSync(resolve(repo, 'content/eval/agent_eval.json'), 'utf8')) as { subject: string; cases: Case[] };
const books = new Map<string, { meta: { id: string; subject: { en: string }; chapters: { n: number; title: { en: string } }[] }; passages: { id: string; ch: number; page: number; text: string }[] }>();
for (const f of readdirSync(resolve(repo, 'content/books/out')).filter((x) => x.endsWith('.json'))) {
  const b = JSON.parse(readFileSync(resolve(repo, 'content/books/out', f), 'utf8'));
  books.set(b.meta.id, b);
}
const passage = (id: string) => { const b = books.get(id.split('.')[0]!); return b?.passages.find((p) => p.id === id); };
const subjectOfBook = (id: string) => books.get(id)?.meta.subject.en;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. the turns: asked now through the API, or read from a run in the app ----------
async function viaApi(): Promise<Turn[]> {
  const { token } = await (await fetch(`${B}/api/device`, { method: 'POST' })).json() as { token: string };
  const pid = 'p-eval-' + Date.now().toString(36);
  const out: Turn[] = [];
  for (const c of cases) {
    const body = { profileId: pid, text: c.q, lang: 'en', bookIds: [SUBJECT], memoryScope: `subject:${SUBJECT}`, board: 'BSE Odisha', mode: 'text' };
    const r = await (await fetch(`${B}/api/tutor/turn`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': token }, body: JSON.stringify(body) })).json() as { trace: Trace; messages: { text: string; sources?: { passageId: string }[]; chips?: { label: string }[]; check?: string }[] };
    out.push({ q: c.q, trace: r.trace, messages: r.messages.map((m) => ({ text: m.text + (m.check ? `\n${m.check}` : ''), sources: (m.sources ?? []).map((s) => s.passageId), ...(m.chips ? { chips: m.chips } : {}) })) });
    console.log(`${c.id}. ${r.trace.chosen} (${r.trace.latency_ms} ms)`);
    await sleep(6_000); // the free model tiers: a steady pace, like a student typing
  }
  return out;
}

function viaDb(profileId: string, since = 0): Turn[] {
  const db = new Database(resolve(repo, 'apps/server/data/setu.sqlite'), { readonly: true });
  const log = db.prepare('SELECT at, role, text, meta FROM tutor_log WHERE profile_id = ? AND at >= ? ORDER BY id').all(profileId, since) as { at: number; role: string; text: string; meta: string | null }[];
  const traces = (db.prepare('SELECT at, step FROM traces WHERE profile_id = ? AND at >= ? ORDER BY id').all(profileId, since) as { at: number; step: string }[])
    .map((t) => ({ at: t.at, step: JSON.parse(t.step) as Trace })).filter((t) => t.step.kind === 'tutor' && t.step.trigger === 'STUDENT_MESSAGE');
  const out: Turn[] = [];
  for (const c of cases) {
    const i = log.findIndex((l) => l.role === 'student' && l.text.trim() === c.q.trim());
    // a care reply never logs her words: that turn is found by its trace
    const tr = i >= 0 ? traces.find((t) => t.at === log[i]!.at) : traces.find((t) => t.step.chosen.startsWith('care') && !out.some((o) => o.trace === t.step));
    if (!tr) { console.warn(`not found in the run: ${c.id}. ${c.q}`); continue; }
    const msgs = log.filter((l) => l.role === 'tutor' && l.at === tr.at).map((l) => ({ text: l.text, sources: ((l.meta ? JSON.parse(l.meta) : {}).sources ?? []) as string[] }));
    out.push({ q: c.q, trace: tr.step, messages: msgs });
  }
  return out;
}

// ---------- 2. what the agent did, read from its own trace ----------
function routed(t: Turn): { as: Case['expect'] | 'not_in_book' | 'fallback'; to?: string } {
  const ch = t.trace.chosen;
  if (ch.startsWith('care')) return { as: 'care' };
  if (ch.startsWith('other_subject')) {
    const chip = t.messages.flatMap((m) => m.chips ?? []).find((c) => c.label.startsWith('Open '));
    const fromReason = [...t.trace.reason.matchAll(/([a-z-]+-9)\b/g)].map((m) => m[1]!).find((id) => id !== SUBJECT && books.has(id));
    return { as: 'redirect', to: chip ? chip.label.replace(/^Open /, '') : fromReason ? subjectOfBook(fromReason) : undefined };
  }
  if (ch.startsWith('decline') || ch.startsWith('redirect')) return { as: 'decline' };
  if (ch.startsWith('not_in_book')) return { as: 'not_in_book' };
  if (t.trace.status === 'fallback') return { as: 'fallback' };
  return { as: 'answer' };
}
function review(t: Turn): 'passed' | 'fixed' | 'blocked' | 'redirected' | 'unavailable' | 'none' {
  const r = t.trace.tools.filter((x) => x.tool === 'critic.review');
  if (!r.length) return 'none';
  const last = r.at(-1)!;
  if (r.some((x) => x.note?.includes('chat'))) return 'redirected';
  if (last.note?.includes('book page')) return 'blocked';
  if (r[0]!.status === 'ok') return 'passed';
  if (r[0]!.status === 'failed' && last.status === 'ok') return 'fixed';
  return r.some((x) => x.status === 'fallback') ? 'unavailable' : 'none';
}

// ---------- 3. the grader: a different model family reads the answer next to the cited pages ----------
async function judge(c: Case, t: Turn): Promise<{ correct: number; supported: number; answers: number; level: number; answered_off_topic?: number; note: string } | null> {
  const reply = t.messages.map((m) => m.text).join('\n').slice(0, 2500);
  const pages = [...new Set(t.messages.flatMap((m) => m.sources))].map(passage).filter(Boolean).slice(0, 3).map((p, i) => `[page ${i + 1}, book p.${p!.page}] ${p!.text.slice(0, 1200)}`).join('\n') || '(no page cited)';
  const prompt = `You grade a tutor's reply to a Class 9 student (BSE Odisha, India) in the Physical Science chat. Pages may be OCR-scanned Odia with small errors.
STUDENT QUESTION: ${c.q}
CITED BOOK PAGES:
${pages}
REPLY:
${reply}

Grade strictly but fairly: work out any calculation yourself before calling it wrong, and judge the physics, not the wording. A correct standard Class 9 fact is fine even if the pages do not print it. Return JSON only:
{"correct": 1 if every fact in the reply is scientifically correct else 0,
 "supported": 1 if the reply's facts are on the cited pages or plain common knowledge that agrees with them (0 if no page is cited and the reply teaches facts),
 "answers": 1 if it actually answers what was asked (a numerical: the right final value with unit) else 0,
 "level": 1 if the language and depth suit a Class 9 student else 0,
 "answered_off_topic": 1 if the question is not about school studies and the reply answers it anyway, else 0,
 "note": "<max 20 words: the main problem, or 'fine'>"}`;
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < JUDGES.length; i++) {
      if (judgeDown.has(i)) continue;
      const [model, key] = JUDGES[i]!;
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(45_000),
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
        });
        if (r.status === 429) { judgeDown.add(i); continue; }
        if (!r.ok) continue;
        const j = await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const txt = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
        const out = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
        judgedBy.set(model, (judgedBy.get(model) ?? 0) + 1);
        return out;
      } catch { /* the next grader */ }
    }
    judgeDown.clear(); await sleep(20_000);
  }
  return null;
}

// ---------- 4. the numbers ----------
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0; };

const [mode, arg, since] = process.argv.slice(2);
const turns = mode === 'db' ? viaDb(arg!, Number(since ?? 0)) : await viaApi();
const rows: Record<string, unknown>[] = [];
for (const c of cases) {
  const t = turns.find((x) => x.q === c.q);
  if (!t) { rows.push({ id: c.id, kind: c.kind, q: c.q, expect: c.expect, missing: true }); continue; }
  const r = routed(t);
  const cited = [...new Set(t.messages.flatMap((m) => m.sources))].map(passage).filter(Boolean);
  const chapterOk = c.expect === 'answer' ? cited.some((p) => p!.id.startsWith(SUBJECT + '.') && c.chapters!.includes(p!.ch)) : undefined;
  const routeOk = c.expect === 'answer' ? r.as === 'answer' || r.as === 'not_in_book'
    : c.expect === 'redirect' ? r.as === 'redirect' && r.to === c.subject
    : c.expect === 'care' ? r.as === 'care'
    : r.as === 'decline' || r.as === 'not_in_book' || r.as === 'redirect';
  const g = c.expect === 'answer' || c.expect === 'decline' ? await judge(c, t) : null;
  const declineOk = c.expect === 'decline' ? routeOk && g?.answered_off_topic !== 1 : undefined;
  rows.push({ id: c.id, kind: c.kind, q: c.q, expect: c.expect, chosen: t.trace.chosen, routed: r.as, to: r.to, routeOk: c.expect === 'decline' ? declineOk : routeOk, chapterOk, cited: cited.map((p) => `${p!.id} (ch ${p!.ch})`), review: review(t), latency: t.trace.latency_ms, status: t.trace.status, judge: g, reply: t.messages.map((m) => m.text).join('\n').slice(0, 600), reviewNotes: t.trace.tools.filter((x) => x.tool === 'critic.review').map((x) => x.note) });
  console.log(`${c.id}. ${c.expect} → ${r.as}${r.to ? ' ' + r.to : ''} ${routeOk ? '✓' : '✗'}${chapterOk === undefined ? '' : chapterOk ? ' chapter ✓' : ' chapter ✗'}${g ? ` judge c${g.correct} s${g.supported} a${g.answers} l${g.level}` : ''}`);
}

const got = rows.filter((r) => !r.missing);
const answers = got.filter((r) => r.expect === 'answer');
const judged = answers.filter((r) => r.judge);
const J = (k: string) => judged.filter((r) => (r.judge as Record<string, number>)[k] === 1).length;
const rv = (k: string) => got.filter((r) => r.review === k).length;
const lat = got.map((r) => r.latency as number);
const byKind = [...new Set(cases.map((c) => c.kind))].map((k) => { const rs = got.filter((r) => r.kind === k); return `| ${k} | ${rs.length} | ${pct(rs.filter((r) => r.routeOk).length, rs.length)} |`; });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const summary = {
  when: new Date().toISOString(), mode, questions: cases.length, ran: got.length, judge: Object.fromEntries(judgedBy),
  routing: got.filter((r) => r.routeOk).length / got.length,
  answered_here: answers.filter((r) => r.routed === 'answer').length / answers.length,
  right_chapter: answers.filter((r) => r.chapterOk).length / answers.length,
  correct: J('correct') / judged.length, supported: J('supported') / judged.length, answers_question: J('answers') / judged.length, class9_level: J('level') / judged.length,
  redirect_right: got.filter((r) => r.expect === 'redirect' && r.routeOk).length / got.filter((r) => r.expect === 'redirect').length,
  review: { passed: rv('passed'), fixed: rv('fixed'), blocked: rv('blocked'), redirected: rv('redirected'), unavailable: rv('unavailable'), none: rv('none') },
  latency_ms: { p50: q(lat, 0.5), p90: q(lat, 0.9), max: Math.max(...lat) },
};
mkdirSync(resolve(repo, 'content/eval/results'), { recursive: true });
writeFileSync(resolve(repo, `content/eval/results/agent-${stamp}.json`), JSON.stringify({ summary, rows }, null, 1));

const P = (x: number) => `${Math.round(x * 100)}%`;
const md = `# Agent evaluation — ${cases.length} student questions

_Run ${summary.when.slice(0, 16).replace('T', ' ')} UTC · ${mode === 'db' ? 'asked in the app (Playwright, real sign-in)' : 'asked through the app API'} · writer: Groq gpt-oss-120b (Gemini fallback) · reviewer: the decide model · grader: ${[...judgedBy].map(([m, n]) => `${m} (${n})`).join(', ')} — Gemini grades, Groq writes most answers · questions: \`content/eval/agent_eval.json\` · raw results: \`content/eval/results/agent-${stamp}.json\`_

Every question was asked in the **Physical Science** chat of a BSE Odisha Class 9 student: 40 about Physical Science (core ideas, numericals, common misconceptions, Odia script and romanized Odia), 7 from other subjects, 3 not about studies.

## Headline numbers

| What | Result |
|---|---|
| Routed right (answered here / sent to the right subject / care / declined) | **${P(summary.routing)}** (${got.filter((r) => r.routeOk).length} of ${got.length}) |
| Physical Science questions answered from her own book | ${P(summary.answered_here)} |
| …citing a page from the right chapter | **${P(summary.right_chapter)}** |
| Answers graded factually correct | **${P(summary.correct)}** |
| Answers supported by the cited book pages | **${P(summary.supported)}** |
| Answers that actually answer the question | ${P(summary.answers_question)} |
| At Class 9 level | ${P(summary.class9_level)} |
| Other-subject questions sent to the right subject's chat | **${P(summary.redirect_right)}** |
| Time to answer | median ${(summary.latency_ms.p50 / 1000).toFixed(1)} s · 90th percentile ${(summary.latency_ms.p90 / 1000).toFixed(1)} s |

## What the reviewer did (before the student saw anything)

| Outcome | Turns |
|---|---|
| Passed on the first read | ${summary.review.passed} |
| Failed → rewritten → passed on the second read | ${summary.review.fixed} |
| Failed twice → the student got the book page instead | ${summary.review.blocked} |
| Saw the question belongs to another subject → sent there | ${summary.review.redirected} |
| Reviewer unavailable → local book-overlap check only | ${summary.review.unavailable} |
| Not reviewed (redirected or answered by policy before any model) | ${summary.review.none} |

## By kind of question

| Kind | Questions | Routed right |
|---|---|---|
${byKind.join('\n')}

## Every question

| # | Question | Expected | Agent did | Route | Chapter | Correct | Supported | Review | Time |
|---|---|---|---|---|---|---|---|---|---|
${rows.map((r) => r.missing ? `| ${r.id} | ${r.q} | ${r.expect} | (not run) | | | | | | |` : `| ${r.id} | ${String(r.q).replace(/\|/g, '/')} | ${r.expect}${r.expect === 'redirect' ? ' → ' + cases.find((c) => c.id === r.id)!.subject : ''} | ${r.routed}${r.to ? ' → ' + r.to : ''} | ${r.routeOk ? '✓' : '✗'} | ${r.chapterOk === undefined ? '' : r.chapterOk ? '✓' : '✗'} | ${r.judge && r.expect === 'answer' ? ((r.judge as Record<string, number>).correct ? '✓' : '✗') : ''} | ${r.judge && r.expect === 'answer' ? ((r.judge as Record<string, number>).supported ? '✓' : '✗') : ''} | ${r.review} | ${((r.latency as number) / 1000).toFixed(1)} s |`).join('\n')}

## Problems the grader noted

${got.filter((r) => r.judge && (r.judge as { note: string }).note && !/^fine/i.test((r.judge as { note: string }).note)).map((r) => `- **#${r.id}** ${r.q} — ${(r.judge as { note: string }).note}`).join('\n') || '- none'}

## How to read this

- **Routing** and **chapter** come from the agent's own trace and the book index: no model is involved in scoring them.
- **Correct / supported / answers / level** are graded by Gemini, a different model family from Groq, which wrote most answers, reading the reply next to the book pages it cites. Model grading is not a teacher's grading: treat these as estimates and read the notes.
- 50 questions are a small sample: one question is 2–2.5 points. The question set is fixed in \`content/eval/agent_eval.json\`, so later runs are comparable.
`;
writeFileSync(resolve(repo, 'docs/EVAL.md'), md);
console.log('\n', JSON.stringify(summary, null, 1));
if (!existsSync(resolve(repo, 'docs/EVAL.md'))) process.exit(1);

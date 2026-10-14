// Live evaluation with the real free-tier models (TODO P6.1, P6.4 online, P6.6 recording, P6.13). Not in CI: it spends
// quota. Keys are read from apps/server/.env into this process only and never printed. Results → docs/eval/live.json.
//   tsx eval/live.ts [understand] [baseline] [golden] [cost]      (no argument = all)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseLlm, type LlmRequest, type LlmResponse } from '@google/adk';
import { PackMatcher, fold, pickCheck, textIn, extractNumbers, type AnyEvent, type OutMsg, type TurnInput } from '@setu/core';
import { motionPack } from '@setu/content';
import { ITEMS } from '../../../content/eval/understanding.ts';
import { PERSONAS } from '../../../content/eval/simulator.ts';
import { Store } from '../src/db.ts';
import { buildModels, tokenMeter, type ModelSet } from '../src/llm.ts';
import { runCycle, sourcesFor, parseJson, textOf, type CycleDeps, type TurnRequest } from '../src/agent/cycle.ts';
import { critic } from '../src/agent/critic.ts';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '../.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
}
const want = new Set(process.argv.slice(2));
const run = (k: string) => !want.size || want.has(k);
const outDir = resolve(here, '../../../docs/eval');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, 'live.json');
const results: Record<string, unknown> = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};
const save = () => writeFileSync(outFile, JSON.stringify(results, null, 1) + '\n');

/** Passes every reply through and keeps its final text, per job, in order (for golden replay and for reading `understood`). */
class Rec extends BaseLlm {
  constructor(private readonly inner: BaseLlm, readonly job: string, readonly log: { job: string; text: string }[]) { super({ model: inner.model }); }
  async *generateContentAsync(req: LlmRequest, stream?: boolean, signal?: AbortSignal): AsyncGenerator<LlmResponse, void> {
    let last: LlmResponse | undefined;
    // the agent stops reading once it has a complete reply, so the record is written however the stream ends
    try { for await (const r of this.inner.generateContentAsync(req, stream, signal)) { last = r; yield r; } }
    finally { this.log.push({ job: this.job, text: last ? textOf(last) : '' }); }
  }
  connect(req: LlmRequest) { return this.inner.connect(req); }
}
function recorded(models: ModelSet, log: { job: string; text: string }[]): ModelSet {
  return { ...models, decide: models.decide && new Rec(models.decide, 'decide', log), generateFor: (l: string) => { const g = models.generateFor(l); return g && new Rec(g, 'generate', log); } } as ModelSet;
}

const matcher = new PackMatcher(motionPack);
let n = 0;
const ev = (type: string, payload: unknown): AnyEvent => ({ id: `live-${++n}`, profileId: 'p1', deviceId: 'phone1', seq: n, ts: 1_750_000_000_000 + n, type, payload } as AnyEvent);
const seed = (known: string[], lang = 'or') => [
  ev('PROFILE_CREATED', { avatar: 'a', classLevel: 9, board: 'BSE-Odisha', language: { ui: lang, response: lang, inputMode: 'text', readingLevel: 3 }, dataTier: 'low', sharedDevice: true }),
  ev('PLACEMENT_COMPLETED', { conceptIds: [], known, gaps: [] }),
  ...known.flatMap((c) => [1, 2, 3].map(() => ev('ANSWER_GRADED', { checkId: `x.${c}`, conceptId: c, correct: true, confidence: 1, source: 'bank', misconceptionIds: [] }))),
];
const deps = (models: ModelSet, events: AnyEvent[], liveGen: string[] = ['or']): CycleDeps => { const store = new Store(); store.append(events); return { store, pack: motionPack, matcher, models, liveGenLangs: new Set(liveGen), trustDraft: true, recentGen: new Map() }; };
const req = (input: TurnInput, lastSeq = 1000): TurnRequest => ({ profileId: 'p1', deviceId: 'phone1', clientNow: Date.now(), lastSeq, cursor: 0, outbox: [], input });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function understand(models: ModelSet) {
  // online: the decide model's own reading of each doubt (`understood`), with the policy's evidence in front of it
  const rows: { text: string; form: string; concept: string | null; intent: string; got: { concept: string | null; intent: string } | null }[] = [];
  let retries = 0;
  for (const it of ITEMS) {
    let u: { concept_id?: string | null; intent?: string } | undefined;
    // this measures understanding, not availability: a free-tier timeout/503/429 is retried (up to 3 tries, 20 s apart)
    // with the breakers closed again; failures still show in `provider failures`
    for (let attempt = 0; attempt < 3 && !u; attempt++) {
      if (attempt) { retries++; await sleep(20_000); }
      for (const k of models.providers) models.breakers.force(k, false);
      const log: { job: string; text: string }[] = [];
      const d = deps(recorded(models, log), seed(['reference_point']), []);
      try { await runCycle({ ...d, budgetMs: 30_000 }, req({ type: 'doubt', doubtId: `u${rows.length}`, text: it.text, mode: 'text' })); } catch { /* counted as no answer */ }
      const raw = parseJson(log.find((l) => l.job === 'decide')?.text ?? '') as { understood?: { concept_id?: string | null; intent?: string } } | null;
      u = raw?.understood;
    }
    const intent = u?.intent === 'homework' ? 'homework' : u?.intent === 'off_topic' ? 'off_topic' : u?.intent ? 'conceptual' : '';
    rows.push({ ...it, got: u ? { concept: u.concept_id && motionPack.graph.concepts[u.concept_id] ? u.concept_id : null, intent } : null });
    process.stdout.write(u ? '.' : 'x');
    await sleep(4500); // free tier: ~15 requests a minute per model
  }
  const answered = rows.filter((r) => r.got);
  const acc = (k: 'concept' | 'intent') => Math.round((100 * answered.filter((r) => r.got![k] === r[k]).length) / Math.max(1, answered.length));
  results.understanding_online = { n: rows.length, answered: answered.length, retries, concept: acc('concept'), intent: acc('intent'), misses: answered.filter((r) => r.got!.concept !== r.concept).map((r) => `${r.text} → ${r.got!.concept} (want ${r.concept})`) };
  console.log('\nunderstanding online', results.understanding_online);
  save();
}

/** P6.1 LLM half: a plain chatbot with the chapter in context vs Setu, on the same doubts and the same next check. */
async function baseline(models: ModelSet) {
  const doubts = ITEMS.filter((i) => i.intent === 'conceptual' && i.concept && i.concept !== 'acceleration' && (i.form === 'odia' || i.form === 'romanized' || i.form === 'mixed')).slice(0, 10);
  const chapter = [...motionPack.passages.map((p) => textIn(p.text, 'or')), ...motionPack.explanations.filter((e) => !e.regions).map((e) => textIn(e.body.display, 'or'))].join('\n');
  type Judged = { leak: boolean; grounded: boolean; script: boolean; chars: number; problems: string[] } | null;
  const rows: { doubt: string; concept: string; chatbot: Judged; setu: (Judged & { source: string }) | null }[] = [];
  for (const it of doubts) {
    const cid = it.concept!;
    const s = fold(seed(['reference_point', 'distance', 'speed', 'displacement']), motionPack.graph, 'p1');
    const check = pickCheck(motionPack, s, cid, { lang: 'or', trustDraft: true });
    const answerKey = check?.options?.filter((o) => o.correct).map((o) => textIn(o.text, 'or')) ?? [];
    const sources = sourcesFor({ pack: motionPack, matcher }, cid, 'or', it.text);
    // (a) chatbot: same writer model, the whole chapter in context, a normal tutor prompt — no planning, no critic
    const g = models.generateFor('or')!;
    const prompt = `You are a helpful tutor for a Class 9 student in Odisha. Answer the student's question in Odia, simply.\n\nTEXTBOOK CHAPTER (Motion):\n${chapter}\n\nSTUDENT: ${it.text}`;
    let chat = '';
    try { let last; for await (const r of g.generateContentAsync({ contents: [{ role: 'user', parts: [{ text: prompt }] }], config: { temperature: 0.4 }, liveConnectConfig: {}, toolsDict: {} } as unknown as LlmRequest)) last = r; chat = last ? textOf(last) : ''; } catch (e) { chat = ''; }
    // (b) Setu: the full cycle (decide → generate → critic, else reviewed pack text)
    const r = await runCycle({ ...deps(models, seed(['reference_point', 'distance', 'speed', 'displacement'])), budgetMs: 30_000 }, req({ type: 'doubt', doubtId: 'b', text: it.text, mode: 'text' })).catch(() => null);
    const ex = r?.messages.find((m): m is Extract<OutMsg, { kind: 'explanation' }> => m.kind === 'explanation');
    const judge = (text: string, fromPack = false): Judged => {
      if (!text) return null;
      const v = critic({ text, lang: 'or', readingLevel: 3, allowedNumbers: sources.flatMap(extractNumbers), answerKey, pack: motionPack, conceptId: cid });
      // reviewed pack text teaching the idea the next check asks is the lesson, not a leak: only model-written text can leak
      return { leak: !fromPack && v.problems.includes('answer leak'), grounded: !v.problems.some((p) => p.startsWith('ungrounded') || p.startsWith('non-textbook') || p.startsWith('textbook term')), script: !v.problems.some((p) => /script/.test(p)), chars: text.length, problems: v.problems };
    };
    const sj = ex ? judge(ex.text, !ex.generated) : null;
    rows.push({ doubt: it.text, concept: cid, chatbot: judge(chat), setu: sj ? { ...sj, source: ex!.generated ? 'generated (critic-approved)' : 'reviewed pack' } : null });
    process.stdout.write('.');
    await sleep(9000);
  }
  const rate = (arm: 'chatbot' | 'setu', k: 'leak' | 'grounded' | 'script') => { const xs = rows.map((r) => r[arm]).filter(Boolean) as { leak: boolean; grounded: boolean; script: boolean }[]; return xs.length ? Math.round((100 * xs.filter((x) => x[k]).length) / xs.length) : null; };
  results.baseline_llm = {
    n: rows.length,
    chatbot: { answered: rows.filter((r) => r.chatbot).length, answerLeak: rate('chatbot', 'leak'), grounded: rate('chatbot', 'grounded'), rightScript: rate('chatbot', 'script') },
    setu: { answered: rows.filter((r) => r.setu).length, answerLeak: rate('setu', 'leak'), grounded: rate('setu', 'grounded'), rightScript: rate('setu', 'script') },
    rows,
  };
  console.log('\nbaseline', JSON.stringify({ chatbot: (results.baseline_llm as any).chatbot, setu: (results.baseline_llm as any).setu }));
  save();
}

/** P6.6: the hero flow with real models, every model reply recorded → test/golden/hero.json (replayed in CI). */
async function golden(models: ModelSet) {
  const log: { job: string; text: string }[] = [];
  const store = new Store();
  store.append(seed(['reference_point', 'distance', 'speed', 'displacement']));
  // a long budget: the recording should capture what the agent does with the replies, not free-tier latency
  const d: CycleDeps = { store, pack: motionPack, matcher, models: recorded(models, log), liveGenLangs: new Set(['or']), trustDraft: true, recentGen: new Map(), budgetMs: 120_000 };
  const steps: { input: TurnInput; chosen: string; kinds: string[]; jobs: string[]; outcomes: string[] }[] = [];
  let lastSeq = 1000, cursor = 0;
  const turn = async (input: TurnInput) => {
    const before = log.length;
    const r = await runCycle(d, { profileId: 'p1', deviceId: 'phone1', clientNow: 1_760_000_000_000 + steps.length * 60_000, lastSeq, cursor, outbox: [], input });
    lastSeq = r.lastSeq; cursor = r.cursor;
    steps.push({ input, chosen: r.trace.chosen, kinds: r.messages.map((m) => m.kind), jobs: r.trace.llm_calls.map((c) => c.job), outcomes: r.trace.llm_calls.map((c) => c.outcome) });
    if (r.trace.llm_calls.some((c) => /slow/.test(c.outcome))) console.log('  warning: a reply came after the budget; re-record');
    void before;
    return r;
  };
  let r = await turn({ type: 'doubt', doubtId: 'g1', text: 'speed aau velocity re farak kana?', mode: 'text' });
  for (let i = 0; i < 3; i++) {
    const chk = r.messages.find((m): m is Extract<OutMsg, { kind: 'check' }> => m.kind === 'check');
    if (!chk) break;
    const k = motionPack.checks.find((c) => c.id === chk.checkId)!;
    const trap = k.options?.find((o) => !o.correct && o.misconceptionIds.includes('speed_equals_velocity'));
    const pick = i === 0 && trap ? trap.id : k.kind === 'mcq' ? k.options!.find((o) => o.correct)!.id : String(k.numeric?.value ?? '');
    r = await turn({ type: 'answer', checkId: chk.checkId, answer: pick });
  }
  const file = resolve(here, '../test/golden/hero.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ recordedAt: new Date().toISOString(), note: 'real model replies from eval/live.ts golden; replayed by test/golden.test.ts', replies: log, steps }, null, 1) + '\n');
  console.log('golden: recorded', log.length, 'replies over', steps.length, 'turns →', steps.map((s) => s.chosen).join(' | '));
}

/**
 * P6.13: one learner-day — a 20-minute session of a simulated learner (Sunita persona answers) through the full cycle
 * with the real models; tokens from the providers' own usage reports × list prices; data from the bytes on the wire.
 */
async function cost(models: ModelSet) {
  tokenMeter.clear();
  const d = deps(models, seed(['reference_point', 'distance']));
  let lastSeq = 1000, cursor = 0, bytes = 0, turns = 0;
  const persona = PERSONAS[0]!;
  let r = await runCycle({ ...d, budgetMs: 30_000 }, { ...req({ type: 'open', sessionId: 'c1', minutes: 20 }, lastSeq) });
  const wire = (x: unknown) => Buffer.byteLength(JSON.stringify(x));
  for (; turns < 15; turns++) {
    lastSeq = r.lastSeq; cursor = r.cursor;
    bytes += wire(r);
    const chk = r.messages.find((m): m is Extract<OutMsg, { kind: 'check' }> => m.kind === 'check');
    let input: TurnInput = { type: 'next' };
    if (chk) {
      const k = motionPack.checks.find((c) => c.id === chk.checkId)!;
      const trap = k.options?.find((o) => !o.correct && o.misconceptionIds.some((m) => persona.misconceptions.includes(m)));
      input = { type: 'answer', checkId: k.id, answer: trap?.id ?? (k.kind === 'mcq' ? k.options!.find((o) => o.correct)!.id : String(k.numeric?.value ?? 'x')) };
    } else if (turns === 3) input = { type: 'doubt', doubtId: 'c-d', text: 'speed aau velocity re farak kana?', mode: 'text' };
    const body = { profileId: 'p1', deviceId: 'phone1', clientNow: Date.now(), lastSeq, cursor, outbox: [], input };
    bytes += wire(body);
    r = await runCycle({ ...d, budgetMs: 30_000 }, body);
    if (r.trace.chosen.startsWith('close')) break;
    await sleep(800);
  }
  // list prices, USD per 1M tokens (input, output) — free tier costs ₹0; these show what a paid deployment would cost
  const PRICE: Record<string, [number, number]> = { 'gemini-flash': [0.3, 2.5], 'gemini-lite': [0.1, 0.4], 'gemini-lite-gen': [0.1, 0.4], groq: [0.15, 0.6], gemma: [0, 0] };
  const usage = Object.fromEntries(tokenMeter);
  const usd = Object.entries(usage).reduce((sum, [k, u]) => { const p = PRICE[k] ?? [0.3, 2.5]; return sum + (u.in * p[0] + u.out * p[1]) / 1e6; }, 0);
  results.cost = { turns: turns + 1, usage, usdPerLearnerDay: Number(usd.toFixed(5)), inrPerLearnerDay: Number((usd * 84).toFixed(3)), inrPerLearnerMonth: Number((usd * 84 * 22).toFixed(2)), kbPerSession: Math.round(bytes / 1024), prices: PRICE, note: 'list prices (USD/1M tokens, in/out) as of 2026-10; 84 INR/USD; 22 school days a month' };
  console.log('cost', JSON.stringify(results.cost));
  save();
}

const models = buildModels();
if (!models.decide) throw new Error('no models configured (apps/server/.env)');
console.log('providers:', models.providers.join(', '));
if (run('golden')) await golden(models);
if (run('understand')) await understand(models);
if (run('baseline')) await baseline(models);
if (run('cost')) await cost(models);
console.log('provider failures:', JSON.stringify(models.breakers.failures.slice(-6)));

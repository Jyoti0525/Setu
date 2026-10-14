// Model layer (PLAN §5.8, §10.3): Gemini → Gemma → Groq, routed with circuit breakers.
// Keys live only here (server), never in the PWA (PLAN §10.7).

import { BaseLlm, Gemini, RoutedLlm, type LlmRequest, type LlmResponse } from '@google/adk';
import { scrubPii } from '@setu/core';
import { OpenAICompatLlm } from './openai_compat_llm.ts';

export type Job = 'decide' | 'generate' | 'vision' | 'listen';

/** Circuit breaker per provider: after a failure the provider is skipped for `openMs`. */
export class Breakers {
  private openUntil = new Map<string, number>();
  failures: { key: string; at: number; error: string }[] = [];
  constructor(private readonly openMs = 60_000, private readonly now = () => Date.now()) {}
  isOpen(key: string) { return (this.openUntil.get(key) ?? 0) > this.now(); }
  trip(key: string, error: unknown) {
    const msg = String((error as Error)?.message ?? error);
    // quota errors stay open longer
    const ms = /429|RESOURCE_EXHAUSTED|quota/i.test(msg) ? this.openMs * 5 : this.openMs;
    this.openUntil.set(key, this.now() + ms);
    this.failures.push({ key, at: this.now(), error: msg.slice(0, 200) });
  }
  status() { return Object.fromEntries([...this.openUntil.entries()].map(([k, t]) => [k, t > this.now() ? `open ${Math.round((t - this.now()) / 1000)}s` : 'closed'])); }
  /** Failure drill (P7.9): take a provider down (or bring it back) by hand — the router skips it exactly as after a real failure. */
  force(key: string, down: boolean, ms = 10 * 60_000) {
    if (down) { this.openUntil.set(key, this.now() + ms); this.failures.push({ key, at: this.now(), error: 'drill: taken down by the operator' }); }
    else this.openUntil.delete(key);
  }
}

/** Tokens used per provider since start (P6.13 cost per learner): from each provider's own usage report. */
export const tokenMeter = new Map<string, { calls: number; in: number; out: number }>();

/** Wraps a model so failures and timeouts trip its breaker; the router then skips it. */
class Guarded extends BaseLlm {
  constructor(readonly key: string, private readonly inner: BaseLlm, private readonly breakers: Breakers, private readonly timeoutMs = 20_000) { super({ model: inner.model }); }
  async *generateContentAsync(req: LlmRequest, stream?: boolean, signal?: AbortSignal): AsyncGenerator<LlmResponse, void> {
    const abort = new AbortController();
    signal?.addEventListener('abort', () => abort.abort());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => { abort.abort(); rej(new Error(`timeout ${this.timeoutMs}ms`)); }, this.timeoutMs); });
    try {
      // the agent stamps the router's name on the request; each provider must send its own model id
      const it = this.inner.generateContentAsync({ ...scrubRequest(req), model: this.inner.model }, stream, abort.signal)[Symbol.asyncIterator]();
      for (;;) {
        const r = await Promise.race([it.next(), timeout]);
        if (r.done) break;
        if (r.value.errorCode) throw new Error(`${r.value.errorCode} ${r.value.errorMessage ?? ''}`);
        const u = r.value.usageMetadata;
        if (u && (r.value.turnComplete !== false)) {
          const m = tokenMeter.get(this.key) ?? { calls: 0, in: 0, out: 0 };
          tokenMeter.set(this.key, { calls: m.calls + 1, in: m.in + (u.promptTokenCount ?? 0), out: m.out + (u.candidatesTokenCount ?? 0) + ((u as { thoughtsTokenCount?: number }).thoughtsTokenCount ?? 0) });
        }
        yield r.value;
      }
    } catch (e) {
      this.breakers.trip(this.key, e);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  connect(req: LlmRequest) { return this.inner.connect(req); }
}

/**
 * PII scrub callback (P5.22): every request to every provider passes here — phone numbers, e-mails and ID numbers in
 * any text part or instruction are replaced before they leave the server. (Her name never reaches the server.)
 */
export function scrubRequest(req: LlmRequest): LlmRequest {
  const parts = (ps?: { text?: string }[]) => ps?.map((p) => (typeof p.text === 'string' ? { ...p, text: scrubPii(p.text) } : p));
  const cfg = req.config as { systemInstruction?: unknown } | undefined;
  const si = cfg?.systemInstruction;
  return {
    ...req,
    contents: req.contents?.map((c) => ({ ...c, parts: parts(c.parts as { text?: string }[]) })) as LlmRequest['contents'],
    ...(cfg ? { config: { ...cfg, systemInstruction: typeof si === 'string' ? scrubPii(si) : si && typeof si === 'object' && 'parts' in si ? { ...si, parts: parts((si as { parts?: { text?: string }[] }).parts) } : si } as LlmRequest['config'] } : {}),
  };
}

export interface ModelSet {
  /** null when no provider is configured — the agent then runs on policy + pack content */
  decide: BaseLlm | null;
  generate: BaseLlm | null;
  /** reads a textbook photo (Snap online, PLAN §6.8) — multimodal Gemini/Gemma only */
  vision: BaseLlm | null;
  /** transcribes her spoken question (ASR chain step 1, PLAN §10.1) — Gemini audio */
  listen: BaseLlm | null;
  breakers: Breakers;
  providers: string[];
  /** which provider answered last, per job */
  lastUsed: Partial<Record<Job, string>>;
  /** generation router restricted to providers allowed to write `lang` (P0.a: Groq models misuse Odia textbook terms) */
  generateFor(lang: string): BaseLlm | null;
  /** provider keys allowed to write `lang` */
  genKeysFor(lang: string): string[];
}

// Defaults checked live on 2026-10-13, Flash moved to 3.5 on 2026-10-14 (2.5 Flash is closed to new keys) (spikes/RESULTS.md P0.a): older names (gemini-2.5-flash-lite for new keys,
// llama-3.3-70b on Groq) are gone. Every name is overridable from .env.
const DEFAULTS = {
  GEMINI_DECIDE_MODEL: 'gemini-3.1-flash-lite',
  GEMINI_GENERATE_MODEL: 'gemini-3.5-flash',
  GEMMA_MODEL: 'gemma-4-26b-a4b-it',
  GROQ_MODEL: 'openai/gpt-oss-120b',
  /** languages each provider may WRITE for learners; decisions (JSON) are language-neutral */
  GEMINI_GEN_LANGS: '*',
  GEMMA_GEN_LANGS: '*',
  GROQ_GEN_LANGS: 'en,hi',
};

export function buildModels(env: NodeJS.ProcessEnv = process.env, extra: Partial<Record<Job, Record<string, BaseLlm>>> = {}): ModelSet {
  const breakers = new Breakers();
  const conf = (k: keyof typeof DEFAULTS) => env[k] || DEFAULTS[k];
  // a decision must be quick (the learner is waiting; the policy is a fine answer), a generation may take longer
  const timeoutMs: Record<Job, number> = { decide: Number(env.SETU_DECIDE_TIMEOUT_MS ?? 4_000), generate: Number(env.SETU_GENERATE_TIMEOUT_MS ?? 20_000), vision: Number(env.SETU_VISION_TIMEOUT_MS ?? 20_000), listen: Number(env.SETU_LISTEN_TIMEOUT_MS ?? 10_000) };
  const chains: Record<Job, [string, BaseLlm][]> = { decide: [], generate: [], vision: [], listen: [] };
  const genLangs = new Map<string, string[]>();

  // a second free key (another Google project) has its own quota: each model is tried on key 1, then key 2
  const geminiKeys = ([['', env.GEMINI_API_KEY], ['-2', env.GEMINI_API_KEY_2]] as const).filter(([, k]) => k);
  const gemKeys = (base: string) => geminiKeys.map(([sfx]) => base + sfx);
  if (geminiKeys.length) {
    const g = (model: string, apiKey: string) => new Gemini({ model, apiKey });
    const add = (job: Job, base: string, model: string, langs?: string) => {
      for (const [sfx, key] of geminiKeys) {
        chains[job].push([base + sfx, g(model, key!)]);
        if (langs) genLangs.set(base + sfx, langs.split(','));
      }
    };
    add('decide', 'gemini-lite', conf('GEMINI_DECIDE_MODEL'));
    // Flash-Lite writes first (2026-10-14): it used the textbook terms in P0.a, answers in 1–3 s, and is up when
    // Flash is overloaded — Flash's 503s took ~7 s each, so trying it first spent the whole turn budget on failures
    add('generate', 'gemini-lite-gen', conf('GEMINI_DECIDE_MODEL'), conf('GEMINI_GEN_LANGS'));
    add('generate', 'gemini-flash', conf('GEMINI_GENERATE_MODEL'), conf('GEMINI_GEN_LANGS'));
    // Gemma on the same key (PLAN §10.3 step 2) — slow on the free tier, so it is last for decisions
    add('generate', 'gemma', conf('GEMMA_MODEL'), conf('GEMMA_GEN_LANGS'));
  }
  if (env.GROQ_API_KEY) {
    const groq = new OpenAICompatLlm({ model: conf('GROQ_MODEL'), baseUrl: 'https://api.groq.com/openai/v1', apiKey: env.GROQ_API_KEY, timeoutMs: 15_000 });
    chains.decide.push(['groq', groq]);
    chains.generate.push(['groq', groq]);
    genLangs.set('groq', conf('GROQ_GEN_LANGS').split(','));
  }
  if (geminiKeys.length) {
    const gen = (k: string) => chains.generate.find(([x]) => x === k)![1];
    for (const k of gemKeys('gemma')) chains.decide.push([k, gen(k)]);
    // the same multimodal models read photos; breakers are shared with generation (one provider, one state)
    for (const k of [...gemKeys('gemini-flash'), ...gemKeys('gemini-lite-gen'), ...gemKeys('gemma')]) chains.vision.push([k, gen(k)]);
    // audio in: Gemini only (Flash-Lite first: quick, and a transcript needs no reasoning)
    for (const k of [...gemKeys('gemini-lite-gen'), ...gemKeys('gemini-flash')]) chains.listen.push([k, gen(k)]);
  }
  for (const job of ['decide', 'generate', 'vision', 'listen'] as Job[]) for (const [k, m] of Object.entries(extra[job] ?? {})) chains[job].push([k, m]);

  const lastUsed: ModelSet['lastUsed'] = {};
  const guarded = new Map<string, Map<BaseLlm, BaseLlm>>();
  const guard = (job: Job, k: string, m: BaseLlm) => {
    const byJob = guarded.get(job) ?? guarded.set(job, new Map()).get(job)!;
    if (!byJob.has(m)) byJob.set(m, new Guarded(k, m, breakers, timeoutMs[job]));
    return byJob.get(m)!;
  };
  const router = (job: Job, keys: string[]): BaseLlm | null => {
    const chain = chains[job].filter(([k]) => keys.includes(k));
    if (!chain.length) return null;
    const order = chain.map(([k]) => k);
    return new RoutedLlm({
      models: Object.fromEntries(chain.map(([k, m]) => [k, guard(job, k, m)])),
      modelName: `${job}-router`,
      router: (_m, _req, err) => {
        const pick = order.find((k) => !breakers.isOpen(k) && !err?.failedKeys.has(k));
        if (pick) lastUsed[job] = pick;
        return pick;
      },
    });
  };
  const allKeys = (job: Job) => chains[job].map(([k]) => k);
  const genKeysFor = (lang: string) => allKeys('generate').filter((k) => { const l = genLangs.get(k) ?? ['*']; return l.includes('*') || l.includes(lang); });
  const perLang = new Map<string, BaseLlm | null>();
  return {
    decide: router('decide', allKeys('decide')),
    generate: router('generate', allKeys('generate')),
    vision: router('vision', allKeys('vision')),
    listen: router('listen', allKeys('listen')),
    breakers,
    providers: [...new Set([...allKeys('decide'), ...allKeys('generate'), ...allKeys('vision'), ...allKeys('listen')])],
    lastUsed,
    genKeysFor,
    generateFor: (lang) => { if (!perLang.has(lang)) perLang.set(lang, router('generate', genKeysFor(lang))); return perLang.get(lang)!; },
  };
}

/** True when at least one provider for the job has a closed breaker. */
export function canCall(set: ModelSet, job: Job, keys = set.providers): boolean {
  return !!set[job] && keys.some((k) => !set.breakers.isOpen(k));
}

/** Test/dev model that answers from a function (no network). */
export class ScriptedLlm extends BaseLlm {
  calls: LlmRequest[] = [];
  constructor(private readonly fn: (req: LlmRequest) => string | Error, model = 'scripted') { super({ model }); }
  async *generateContentAsync(req: LlmRequest): AsyncGenerator<LlmResponse, void> {
    this.calls.push(req);
    const out = this.fn(req);
    if (out instanceof Error) throw out;
    yield { content: { role: 'model', parts: [{ text: out }] }, turnComplete: true };
  }
  async connect(): Promise<never> { throw new Error('no live'); }
}

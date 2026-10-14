// Calls each provider through the same ADK model classes the server uses, with a system instruction only (includeContents: 'none').
// Dev check: `npx tsx scripts/probe-models.ts` (needs apps/server/.env). Never run in CI.
process.loadEnvFile(new URL('../.env', import.meta.url));
import { Gemini, type LlmRequest } from '@google/adk';
import { OpenAICompatLlm } from '../src/openai_compat_llm.ts';

const req = (): LlmRequest => ({
  contents: [],
  config: { systemInstruction: 'Return JSON {"text": "..."} with one short Odia sentence about speed (ଦ୍ରୁତି).', responseMimeType: 'application/json' },
  liveConnectConfig: {},
  toolsDict: {},
} as unknown as LlmRequest);

const models = {
  'gemini-3.1-flash-lite': new Gemini({ model: 'gemini-3.1-flash-lite', apiKey: process.env.GEMINI_API_KEY }),
  'gemini-2.5-flash': new Gemini({ model: 'gemini-2.5-flash', apiKey: process.env.GEMINI_API_KEY }),
  'gemma-4-26b-a4b-it': new Gemini({ model: 'gemma-4-26b-a4b-it', apiKey: process.env.GEMINI_API_KEY }),
  groq: new OpenAICompatLlm({ model: 'openai/gpt-oss-120b', baseUrl: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY!, timeoutMs: 15000 }),
};
for (const [k, m] of Object.entries(models)) {
  const t = Date.now();
  try {
    for await (const r of m.generateContentAsync(req())) console.log(k, Date.now() - t, 'ms', r.errorCode ?? '', r.errorMessage ?? '', JSON.stringify(r.content?.parts).slice(0, 200));
  } catch (e) { console.log(k, 'THROW', String((e as Error).message).slice(0, 300)); }
}

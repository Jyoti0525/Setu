// P0 spike (i): does ADK TS 2.x give us everything §5.3 needs?
// Runs with no API key: a scripted model stands in for Gemini, a fake
// OpenAI-compatible server stands in for Groq. Set GEMINI_API_KEY to also
// try the real Gemini path.
import http from 'node:http';
import {
  BaseLlm, FunctionTool, Gemini, InMemoryRunner, LlmAgent, RequestInput, RoutedLlm,
  Workflow, node, type LlmRequest, type LlmResponse, type NodeContext,
} from '@google/adk';
import { z } from 'zod';
import { OpenAICompatLlm } from './openai_compat_llm.ts';

const results: Record<string, 'PASS' | 'FAIL' | 'SKIP'> = {};
const check = (name: string, ok: boolean, info = '') => {
  results[name] = ok ? 'PASS' : 'FAIL';
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`);
};

// ---------- models ----------
class ScriptedLlm extends BaseLlm {
  calls = 0;
  constructor(private readonly script: (req: LlmRequest) => LlmResponse) { super({ model: 'scripted' }); }
  async *generateContentAsync(req: LlmRequest): AsyncGenerator<LlmResponse, void> { this.calls++; yield this.script(req); }
  async connect(): Promise<never> { throw new Error('no live'); }
}
class FailingLlm extends BaseLlm {
  calls = 0;
  constructor() { super({ model: 'failing' }); }
  async *generateContentAsync(): AsyncGenerator<LlmResponse, void> { this.calls++; throw new Error('429 RESOURCE_EXHAUSTED'); }
  async connect(): Promise<never> { throw new Error('no live'); }
}

const hasToolResult = (req: LlmRequest) => req.contents.some((c) => c.parts?.some((p) => p.functionResponse));

// Decide step: first proposes an INVALID concept, then (after the rejection) a valid one.
let proposals = 0;
const decideScript = (req: LlmRequest): LlmResponse => {
  const last = req.contents.at(-1);
  const lastWasResult = last?.parts?.some((p) => p.functionResponse);
  const rejected = last?.parts?.some((p) => (p.functionResponse?.response as any)?.rejected);
  if (lastWasResult && !rejected) return { content: { role: 'model', parts: [{ text: 'DECISION: teach displacement' }] }, turnComplete: true };
  proposals++;
  const concept = proposals === 1 ? 'quantum_gravity' : 'displacement';
  return { content: { role: 'model', parts: [{ functionCall: { id: `c${proposals}`, name: 'search_curriculum', args: { conceptId: concept } } }] }, turnComplete: true };
};

// ---------- tools + callbacks ----------
const GRAPH = new Set(['distance', 'displacement', 'speed', 'velocity']);
const toolRuns: string[] = [];
const searchCurriculum = new FunctionTool({
  name: 'search_curriculum',
  description: 'Find textbook chunks for a concept',
  parameters: z.object({ conceptId: z.string() }),
  execute: ({ conceptId }, ctx) => {
    toolRuns.push(conceptId);
    ctx?.state.set('lastConcept', conceptId);
    return { chunks: [`${conceptId}: chunk 1`] };
  },
});
const trace: any[] = [];
const validateDecision = ({ tool, args }: { tool: { name: string }; args: Record<string, unknown> }) => {
  const ok = GRAPH.has(String(args.conceptId));
  trace.push({ tool: tool.name, args, validation: ok ? 'ok' : 'rejected' });
  return ok ? undefined : { rejected: true, reason: `concept ${String(args.conceptId)} not in graph` };
};

// ---------- workflow ----------
async function runWorkflow(model: BaseLlm, label: string) {
  toolRuns.length = 0; trace.length = 0; proposals = 0;
  const decide = new LlmAgent({
    name: 'decide',
    model,
    instruction: 'Pick the next teaching action by calling tools.',
    tools: [searchCurriculum],
    beforeToolCallback: validateDecision,
    outputKey: 'decision',
  });
  const perceive = node((ctx: NodeContext, input: unknown) => {
    ctx.state.set('perceived', true);
    return input;
  }, { name: 'perceive' });
  const askAnswer = node(() => new RequestInput({ message: 'answer the check', interruptId: 'check-1' }), { name: 'ask_answer' });
  const evaluate = node((ctx: NodeContext, answer: unknown) => {
    ctx.state.set('answer', answer);
    return `graded:${String(answer)}`;
  }, { name: 'evaluate' });

  const wf = new Workflow({ name: 'cycle', edges: [['START', perceive, decide, askAnswer, evaluate]] });
  const runner = new InMemoryRunner({ agent: wf, appName: 'setu' });
  const session = await runner.sessionService.createSession({ appName: 'setu', userId: 'u1', state: { profile: 'p1' } });

  const events: any[] = [];
  for await (const e of runner.runAsync({ userId: 'u1', sessionId: session.id, newMessage: { role: 'user', parts: [{ text: 'ବେଗ କଣ?' }] } })) events.push(e);
  const reqCall = events.flatMap((e) => e.content?.parts ?? []).find((p: any) => p.functionCall?.name?.includes('input'))?.functionCall;

  check(`${label}: graph ran perceive → decide (LLM node)`, events.some((e) => e.author === 'decide'));
  check(`${label}: tool executed with valid args`, toolRuns.includes('displacement'));
  check(`${label}: callback blocked invalid decision`, trace.some((t) => t.validation === 'rejected') && !toolRuns.includes('quantum_gravity'));
  check(`${label}: workflow paused for human input`, !!reqCall, reqCall?.name);

  if (reqCall) {
    for await (const e of runner.runAsync({
      userId: 'u1', sessionId: session.id,
      newMessage: { role: 'user', parts: [{ functionResponse: { id: reqCall.id, name: reqCall.name, response: { result: 'B' } } }] },
    })) events.push(e);
  }
  const s = await runner.sessionService.getSession({ appName: 'setu', userId: 'u1', sessionId: session.id });
  const st = s?.state ?? {};
  check(`${label}: resumed with answer`, JSON.stringify(st.answer ?? '').includes('B'), JSON.stringify(st.answer));
  check(`${label}: state written by node + tool + outputKey`, st.perceived === true && st.lastConcept === 'displacement' && typeof st.decision === 'string');
  return events;
}

// ---------- fake OpenAI-compatible server (stands in for Groq) ----------
function fakeOpenAI(): Promise<{ url: string; close: () => void; requests: any[] }> {
  const requests: any[] = [];
  let n = 0;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const j = JSON.parse(body); requests.push(j);
      const last = j.messages.at(-1);
      let message: any;
      if (last.role === 'tool' && !last.content.includes('rejected')) message = { role: 'assistant', content: 'DECISION: teach displacement' };
      else { n++; message = { role: 'assistant', content: null, tool_calls: [{ id: `t${n}`, type: 'function', function: { name: 'search_curriculum', arguments: JSON.stringify({ conceptId: n === 1 ? 'quantum_gravity' : 'displacement' }) } }] }; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    });
  });
  return new Promise((r) => srv.listen(0, () => r({ url: `http://127.0.0.1:${(srv.address() as any).port}/v1`, close: () => srv.close(), requests })));
}

async function main() {
  // 1. Primary path with a scripted model
  const scripted = new ScriptedLlm(decideScript);
  await runWorkflow(scripted, 'scripted');

  // 2. Failover: Gemini (failing) → fallback, via RoutedLlm router
  const failing = new FailingLlm();
  const backup = new ScriptedLlm(decideScript);
  const order = ['gemini', 'groq'];
  const routed = new RoutedLlm({
    models: { gemini: failing, groq: backup },
    router: (_m, _r, err) => order.find((k) => !err?.failedKeys.has(k)),
  });
  await runWorkflow(routed, 'failover');
  check('failover: failing primary was tried, backup answered', failing.calls > 0 && backup.calls > 0, `primary=${failing.calls} backup=${backup.calls}`);

  // 3. Non-Gemini provider through our OpenAI-compatible connector
  const fake = await fakeOpenAI();
  try {
    await runWorkflow(new OpenAICompatLlm({ model: 'llama-test', baseUrl: fake.url }), 'openai-compat');
    const sentTools = fake.requests[0]?.tools?.[0]?.function;
    check('openai-compat: tool schema sent in JSON-Schema form', sentTools?.name === 'search_curriculum' && sentTools.parameters?.type === 'object', JSON.stringify(sentTools?.parameters));
    check('openai-compat: tool result round-tripped', fake.requests.some((r) => r.messages.some((m: any) => m.role === 'tool')));
  } finally { fake.close(); }

  // 4. Real Gemini (only with a key)
  if (process.env.GEMINI_API_KEY) {
    const g = new Gemini({ model: 'gemini-2.5-flash-lite', apiKey: process.env.GEMINI_API_KEY });
    const agent = new LlmAgent({ name: 'g', model: g, instruction: 'Reply in Odia script, one short sentence.' });
    const runner = new InMemoryRunner({ agent, appName: 'setu' });
    const s = await runner.sessionService.createSession({ appName: 'setu', userId: 'u' });
    let text = '';
    const t0 = Date.now();
    for await (const e of runner.runAsync({ userId: 'u', sessionId: s.id, newMessage: { role: 'user', parts: [{ text: 'What is velocity?' }] } })) text += e.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    check('gemini: real call', text.length > 0, `${Date.now() - t0} ms: ${text.slice(0, 80)}`);
  } else results['gemini: real call'] = 'SKIP';

  console.log('\nSUMMARY', JSON.stringify(results, null, 1));
  process.exit(Object.values(results).includes('FAIL') ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

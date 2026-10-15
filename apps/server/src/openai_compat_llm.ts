// OpenAI-compatible chat-completions connector for ADK (Groq, OpenRouter,
// Ollama, vLLM all speak this format). Spike version; moves to apps/server.
import { BaseLlm, type LlmRequest, type LlmResponse } from '@google/adk';
import type { Content, Part } from '@google/genai';

type OaMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OaToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
type OaToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export class OpenAICompatLlm extends BaseLlm {
  constructor(
    private readonly opts: { model: string; baseUrl: string; apiKey?: string; timeoutMs?: number },
  ) {
    super({ model: opts.model });
  }

  async *generateContentAsync(req: LlmRequest, _stream?: boolean, abortSignal?: AbortSignal): AsyncGenerator<LlmResponse, void> {
    const messages: OaMessage[] = [];
    const sys = systemText(req);
    if (sys) messages.push({ role: 'system', content: sys });
    for (const c of req.contents) messages.push(...toOa(c));

    const tools = Object.values(req.toolsDict ?? {}).map((t) => {
      const decl = (t as unknown as { _getDeclaration(): any })._getDeclaration?.();
      return decl && {
        type: 'function',
        function: { name: decl.name, description: decl.description ?? '', parameters: lowerSchema(decl.parameters ?? decl.parametersJsonSchema ?? { type: 'object', properties: {} }) },
      };
    }).filter(Boolean);

    const body: Record<string, unknown> = { model: this.opts.model, messages, temperature: req.config?.temperature ?? 0.2 };
    if (tools.length) body.tools = tools;
    if (req.config?.responseMimeType === 'application/json') body.response_format = { type: 'json_object' };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 20_000);
    abortSignal?.addEventListener('abort', () => ctrl.abort());
    try {
      const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      // a rate limit says when it resets (Groq: per-minute token limits reset in seconds): the breaker opens just that long
      if (!res.ok) throw new Error(`${this.opts.model} HTTP ${res.status}${res.headers.get('retry-after') ? ` retry-after ${res.headers.get('retry-after')}s` : ''} ${(await res.text().catch(() => '')).slice(0, 200)}`);
      const json: any = await res.json();
      const msg = json.choices?.[0]?.message ?? {};
      const parts: Part[] = [];
      if (msg.content) parts.push({ text: msg.content });
      for (const tc of msg.tool_calls ?? []) {
        parts.push({ functionCall: { id: tc.id, name: tc.function.name, args: safeJson(tc.function.arguments) } });
      }
      yield {
        content: { role: 'model', parts },
        turnComplete: true,
        usageMetadata: json.usage && { promptTokenCount: json.usage.prompt_tokens, candidatesTokenCount: json.usage.completion_tokens, totalTokenCount: json.usage.total_tokens },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async connect(): Promise<never> {
    throw new Error('live connection not supported');
  }
}

function systemText(req: LlmRequest): string {
  const si = req.config?.systemInstruction as string | Content | undefined;
  if (!si) return '';
  if (typeof si === 'string') return si;
  return (si.parts ?? []).map((p) => p.text ?? '').join('\n');
}

function toOa(c: Content): OaMessage[] {
  const parts = c.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('');
  const calls = parts.filter((p) => p.functionCall);
  const responses = parts.filter((p) => p.functionResponse);
  if (responses.length) {
    return responses.map((p) => ({
      role: 'tool' as const,
      tool_call_id: p.functionResponse!.id ?? p.functionResponse!.name!,
      content: JSON.stringify(p.functionResponse!.response ?? {}),
    }));
  }
  if (c.role === 'model') {
    return [{
      role: 'assistant',
      content: text || null,
      ...(calls.length ? { tool_calls: calls.map((p) => ({ id: p.functionCall!.id ?? p.functionCall!.name!, type: 'function' as const, function: { name: p.functionCall!.name!, arguments: JSON.stringify(p.functionCall!.args ?? {}) } })) } : {}),
    }];
  }
  return [{ role: 'user', content: text }];
}

// genai Schema uses upper-case type names ("OBJECT"); JSON Schema wants lower case.
function lowerSchema(s: any): any {
  if (Array.isArray(s)) return s.map(lowerSchema);
  if (!s || typeof s !== 'object') return s;
  const out: any = {};
  for (const [k, v] of Object.entries(s)) out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : lowerSchema(v);
  return out;
}

function safeJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}

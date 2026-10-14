// Speech in (TODO P3.1–P3.7): the server ASR chain behind POST /api/listen.
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fold, type AnyEvent } from '@setu/core';
import { motionPack } from '@setu/content';
import { Store } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { buildModels, ScriptedLlm } from '../src/llm.ts';
import { LocalAsr } from '../src/asr.ts';

// stands in for tools/asr/serve.py: same line protocol; remembers the audio paths it was given
const FAKE_ASR = (log: string) => `
const fs = require('node:fs'), rl = require('node:readline');
console.log(JSON.stringify({ ready: true, langs: ['or', 'hi'] }));
rl.createInterface({ input: process.stdin }).on('line', (l) => {
  const j = JSON.parse(l);
  fs.appendFileSync(${JSON.stringify(log)}, j.path + '\\n');
  const audio = fs.readFileSync(j.path, 'utf8');
  if (audio.includes('silence')) console.log(JSON.stringify({ id: j.id, ok: true, text: '' }));
  else console.log(JSON.stringify({ id: j.id, ok: true, text: 'ବେଗ ଓ ବେଗ ମଧ୍ୟରେ ପାର୍ଥକ୍ୟ କଣ', ms: 5 }));
});`;

function localAsr() {
  const dir = mkdtempSync(join(tmpdir(), 'setu-asr-test-'));
  const log = join(dir, 'paths.log');
  const script = join(dir, 'asr.cjs');
  writeFileSync(script, FAKE_ASR(log.replace(/\\/g, '/')));
  return { asr: new LocalAsr({ python: process.execPath, script }), log };
}

const audio = (s = 'fake opus speech') => Buffer.from(s).toString('base64');

async function setup(o: { gemini?: (req: unknown) => string | Error; local?: boolean } = {}) {
  const extra = o.gemini ? { listen: { 'gemini-lite-gen': new ScriptedLlm(o.gemini as never) } } : {};
  const l = o.local ? localAsr() : undefined;
  const { app } = createApp({ store: new Store(), packs: [motionPack], models: buildModels({}, extra), liveGenLangs: [], asr: { local: l?.asr } });
  const dev = await (await app.request('/api/device', { method: 'POST' })).json() as { token: string };
  const post = (body: unknown) => app.request('/api/listen', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': dev.token }, body: JSON.stringify(body) });
  return { app, post, local: l };
}

describe('POST /api/listen — speech-to-text chain', () => {
  it('Gemini audio first: code-mixed speech comes back as text', async () => {
    const { post } = await setup({ gemini: () => 'speed aau velocity re farak kana?' });
    const r = await post({ audio: audio(), mime: 'audio/webm;codecs=opus', lang: 'or' });
    expect(r.status).toBe(200);
    const j = await r.json() as { text: string; provider: string };
    expect(j.text).toBe('speed aau velocity re farak kana?');
    expect(j.provider).toBe('gemini');
  });

  it('Gemini fails → self-hosted IndicConformer; the audio file is deleted afterwards', async () => {
    const { post, local } = await setup({ gemini: () => new Error('429 RESOURCE_EXHAUSTED'), local: true });
    try {
      const r = await post({ audio: audio(), mime: 'audio/webm', lang: 'or' });
      const j = await r.json() as { text: string; provider: string; tried: string[] };
      expect(r.status).toBe(200);
      expect(j.provider).toBe('indicconformer');
      expect(j.text).toContain('ବେଗ');
      expect(j.tried[0]).toMatch(/^gemini \(/);
      const path = readFileSync(local!.log, 'utf8').trim();
      expect(existsSync(path)).toBe(false); // audio never kept (P5.21)
    } finally { local!.asr.stop(); }
  });

  it('nothing understood → 503 with every step tried (the phone moves down its own chain)', async () => {
    const { post, local } = await setup({ gemini: () => '', local: true });
    try {
      const r = await post({ audio: audio('silence'), mime: 'audio/ogg', lang: 'or' });
      expect(r.status).toBe(503);
      const j = await r.json() as { error: string; tried: string[] };
      expect(j.tried).toEqual(['gemini (empty)', 'indicconformer (empty)']);
    } finally { local!.asr.stop(); }
  });

  it('no speech-to-text configured → 503; health tells the phone so it uses Web Speech instead', async () => {
    const { app, post } = await setup();
    expect((await post({ audio: audio(), lang: 'or' })).status).toBe(503);
    const h = await (await app.request('/api/health?lite=1')).json() as { listen: Record<string, boolean>; providers?: unknown };
    expect(h.listen.or).toBe(false);
    expect(h.providers).toBeUndefined(); // the phone's probe stays tiny
  });

  it('rejects missing or oversized audio', async () => {
    const { post } = await setup({ gemini: () => 'x' });
    expect((await post({ lang: 'or' })).status).toBe(400);
    expect((await post({ audio: 'A'.repeat(900_000), lang: 'or' })).status).toBe(400);
  });
});

describe('store-and-forward voice (P3.7)', () => {
  it('a question recorded offline is queued as voice: the between-session run does not try to answer "🎤"', () => {
    const e = (seq: number, type: string, payload: object) => ({ id: `v${seq}`, profileId: 'p', deviceId: 'd', seq, ts: seq, type, payload }) as AnyEvent;
    const s = fold([e(1, 'DOUBT_QUEUED', { doubtId: 'q1', text: '🎤', reason: 'voice' })], motionPack.graph, 'p');
    expect(s.queuedDoubts[0]).toMatchObject({ doubtId: 'q1', voice: true, answered: false });
  });
});

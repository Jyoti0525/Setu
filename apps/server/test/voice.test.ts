// Live voice for AI-written replies (TODO P3.9) and Odia translation of new-misconception candidates for the teacher.
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { audioKey, type AnyEvent } from '@setu/core';
import { motionPack } from '@setu/content';
import { Store } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { buildModels, ScriptedLlm } from '../src/llm.ts';
import { LiveVoice } from '../src/voice.ts';
import { translateNote, translatedNote } from '../src/translate.ts';

// stands in for tools/tts/serve.py: same line protocol, writes a fake .ogg
const FAKE_WORKER = `
const fs = require('node:fs'), path = require('node:path'), rl = require('node:readline');
console.log(JSON.stringify({ ready: true }));
rl.createInterface({ input: process.stdin }).on('line', (l) => {
  const j = JSON.parse(l);
  if (j.text.includes('ଭୁଲ')) { console.log(JSON.stringify({ key: j.key, ok: false, error: 'nothing speakable' })); return; }
  fs.mkdirSync(path.dirname(j.out), { recursive: true });
  fs.writeFileSync(j.out, 'OggS' + j.text);
  console.log(JSON.stringify({ key: j.key, ok: true, spoken: j.text }));
});`;

function voice(shipped: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'setu-voice-'));
  const script = join(dir, 'worker.cjs');
  writeFileSync(script, FAKE_WORKER);
  return new LiveVoice({ python: process.execPath, script, dir: join(dir, 'out'), shipped: { or: new Set(shipped) } });
}

describe('live voice', () => {
  it('records only Odia lines the server wrote, skips shipped clips, serves the file once recorded', async () => {
    const v = voice([audioKey('ଆଜି ପାଇଁ ଶେଷ')]);
    try {
      expect(v.say('Speed is distance divided by time.')).toBeUndefined(); // English: phones have a voice
      expect(v.say('')).toBeUndefined();
      const shipped = v.say('ଆଜି ପାଇଁ ଶେଷ')!;
      expect(await v.file('or', shipped, 300)).toBeUndefined(); // shipped as a clip: nothing recorded here
      const k = v.say('ବେଗ ହେଉଛି ଦୂରତା ଭାଗ ସମୟ।')!;
      expect(k).toBe(audioKey('ବେଗ ହେଉଛି ଦୂରତା ଭାଗ ସମୟ।'));
      const f = await v.file('or', k, 10_000);
      expect(f && existsSync(f)).toBe(true);
      // a line the voice could not read → 404, and the queue carries on
      const bad = v.say('ଭୁଲ')!;
      expect(await v.file('or', bad, 10_000)).toBeUndefined();
      expect(await v.file('or', v.say('ପରବର୍ତ୍ତୀ ପାଠ।')!, 10_000)).toBeTruthy();
      // not an open TTS: unknown keys and bad paths are refused
      expect(await v.file('or', 'deadbeef', 100)).toBeUndefined();
      expect(await v.file('or', '../../x', 100)).toBeUndefined();
      expect(await v.file('hi', k, 100)).toBeUndefined();
    } finally { v.stop(); }
  });

  it('no python → disabled, the phone uses its own voice', () => {
    const v = new LiveVoice({ python: join(tmpdir(), 'no-such-python.exe'), script: 'x.py', dir: tmpdir() });
    expect(v.enabled).toBe(false);
    expect(v.say('ବେଗ')).toBeUndefined();
  });

  it('GET /voice/<lang>/<key>.ogg serves recorded replies as audio/ogg, 404 otherwise', async () => {
    const v = voice();
    try {
      const { app } = createApp({ store: new Store(), packs: [motionPack], models: buildModels({}), liveGenLangs: [], voice: v });
      const k = v.say('ଦୂରତା ଓ ବିସ୍ଥାପନ ଭିନ୍ନ।')!;
      const r = await app.request(`/voice/or/${k}.ogg`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('audio/ogg');
      expect((await r.text()).startsWith('OggS')).toBe(true);
      expect((await app.request('/voice/or/0badc0de.ogg')).status).toBe(404);
    } finally { v.stop(); }
  });
});

describe('candidate translation for the teacher', () => {
  const note = { description: 'thinks speed is calculated as time divided by distance', evidence: 'answered 0.25 for 1200 m in 300 s' };
  const setup = (reply: string) => {
    const llm = new ScriptedLlm(() => reply);
    const store = new Store();
    const { app, deps } = createApp({ store, packs: [motionPack], models: buildModels({}, { generate: { scripted: llm } }), liveGenLangs: [] });
    return { app, deps, store, llm };
  };

  it('translates once, caches, and keeps numbers', async () => {
    const { deps, llm } = setup(JSON.stringify({ description: 'ଭାବେ ଯେ ବେଗ (speed) = ସମୟ ÷ ଦୂରତା', evidence: '1200 m କୁ 300 s ରେ 0.25 ଉତ୍ତର ଦେଲା' }));
    expect(translatedNote(deps, note, 'en')).toBeUndefined();
    const t = await translateNote(deps, note, 'or');
    expect(t?.description).toContain('ବେଗ');
    expect(translatedNote(deps, note, 'or')).toEqual(t);
    expect(llm.calls.length).toBe(1);
  });

  it('a translation that lost a number or is not Odia is not used', async () => {
    expect(await translateNote(setup(JSON.stringify({ description: 'ଭାବେ ଯେ ବେଗ = ସମୟ ÷ ଦୂରତା', evidence: '1200 m କୁ 30 s ରେ 0.25' })).deps, note, 'or')).toBeUndefined();
    expect(await translateNote(setup(JSON.stringify({ description: 'thinks speed = time / distance', evidence: '1200 m, 300 s, 0.25' })).deps, note, 'or')).toBeUndefined();
    // Odia digits count as the same numbers
    expect(await translateNote(setup(JSON.stringify({ description: 'ଭାବେ ଯେ ବେଗ = ସମୟ ÷ ଦୂରତା', evidence: '୧୨୦୦ ମି. କୁ ୩୦୦ ସେ. ରେ ୦.୨୫' })).deps, note, 'or')).toBeTruthy();
  });

  it('the Odia teacher view shows the translation with the English kept alongside', async () => {
    const { app, store } = setup(JSON.stringify({ description: "ଭାବେ ଯେ ବେଗ = ସମୟ ÷ ଦୂରତା", evidence: "1200 m କୁ 300 s ରେ 0.25 ଉତ୍ତର" }));
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      (await app.request(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })).json() as Promise<any>;
    const dev = await call('POST', '/api/device');
    const cls = await call('POST', '/api/class', { name: '9A', lang: 'or' }, { 'x-device-token': dev.token });
    const evs = [
      ['PROFILE_CREATED', { avatar: '👧', classLevel: 9, board: 'BSE-Odisha', language: { ui: 'or', response: 'or', inputMode: 'text', readingLevel: 3 }, dataTier: 'low', sharedDevice: true }],
      ['CLASS_JOINED', { classCode: cls.code, displayName: 'Sunita' }],
      ['MISCONCEPTION_CANDIDATE', { conceptId: 'speed', ...note }],
    ].map(([type, payload], i) => ({ id: `s-${i}`, profileId: 'sunita', deviceId: 'x', seq: i + 1, ts: Date.now() - 1000 + i, type, payload } as AnyEvent));
    store.append(evs);
    const H = { 'x-device-token': dev.token, 'x-teacher-token': cls.token };
    const first = (await call('GET', '/api/teacher', undefined, H)).candidates[0];
    expect(first.description).toBe(note.description); // not cached yet: English, translation started
    await new Promise((r) => setTimeout(r, 50));
    const c = (await call('GET', '/api/teacher', undefined, H)).candidates[0];
    expect(c.description).toContain('ବେଗ');
    expect(c.english).toEqual(note);
  });
});

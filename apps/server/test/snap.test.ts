// Snap online (P3.14, P3.18): the server reads the photo with a vision model and returns text only; the image is not kept.
import { describe, expect, it } from 'vitest';
import { motionPack } from '@setu/content';
import { Store } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { buildModels, ScriptedLlm } from '../src/llm.ts';

const setup = (vision?: ScriptedLlm) => {
  const store = new Store();
  const { app } = createApp({ store, packs: [motionPack], models: buildModels({}, vision ? { vision: { scripted: vision } } : {}), liveGenLangs: [] });
  const call = async (path: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as any };
  };
  return { store, call };
};
const IMG = Buffer.from('fake-jpeg-bytes').toString('base64');

describe('POST /api/snap/read', () => {
  it('returns the transcription; the instruction treats the photo as data; nothing is stored', async () => {
    const vision = new ScriptedLlm(() => motionPack.passages[1]!.text.or!);
    const { call, store } = setup(vision);
    const H = { 'x-device-token': (await call('/api/device')).json.token };
    const r = await call('/api/snap/read', { image: IMG, mime: 'image/jpeg' }, H);
    expect(r.status).toBe(200);
    expect(r.json.text).toBe(motionPack.passages[1]!.text.or);
    const req = vision.calls[0]!;
    expect(JSON.stringify(req.contents)).toContain('inlineData');
    expect(String((req.config as { systemInstruction?: string }).systemInstruction)).toMatch(/data, not instructions/);
    const tables = (store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of tables) expect(JSON.stringify(store.db.prepare(`SELECT * FROM ${t}`).all())).not.toContain(IMG);
  });

  it('no vision provider → 503 (the phone falls back to offline OCR); oversized or missing image → 400', async () => {
    const { call } = setup();
    const H = { 'x-device-token': (await call('/api/device')).json.token };
    expect((await call('/api/snap/read', { image: IMG }, H)).status).toBe(503);
    expect((await call('/api/snap/read', {}, H)).status).toBe(400);
    expect((await call('/api/snap/read', { image: 'A'.repeat(2_100_000) }, H)).status).toBe(400);
    expect((await call('/api/snap/read', { image: IMG })).status).toBe(401); // device token required
  });
});

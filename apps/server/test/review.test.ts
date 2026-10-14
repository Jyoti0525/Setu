// Native review endpoints (TODO D6): reviewer key required, decisions validated, last decision wins.
import { describe, expect, it } from 'vitest';
import { motionPack } from '@setu/content';
import { Store } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { buildModels } from '../src/llm.ts';

describe('review api', () => {
  it('stores decisions for reviewers only', async () => {
    const { app } = createApp({ store: new Store(), packs: [motionPack], models: buildModels({}), liveGenLangs: [], reviewKey: 'rk', adminKey: 'ak' });
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const r = await app.request(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, json: (await r.json().catch(() => null)) as any };
    };
    const dev = { 'x-device-token': (await call('POST', '/api/device')).json.token };
    expect((await call('GET', '/api/review/or', undefined, dev)).status).toBe(403);
    expect((await call('POST', '/api/review/or', { id: 'x', status: 'ok' }, { ...dev, 'x-review-key': 'nope' })).status).toBe(403);
    const R = { ...dev, 'x-review-key': 'rk' };
    expect((await call('POST', '/api/review/or', { id: 'a#stem', status: 'fixed' }, R)).status).toBe(400); // a fix needs text
    expect((await call('POST', '/api/review/or', { id: 'a#stem', status: 'great' }, R)).status).toBe(400);
    expect((await call('POST', '/api/review/or', { id: 'a#stem', status: 'unsure', note: 'term?' }, R)).status).toBe(200);
    expect((await call('POST', '/api/review/or', { id: 'a#stem', status: 'fixed', text: ' ଠିକ୍ ', audio: 'bad', by: 'M' }, R)).status).toBe(200);
    expect((await call('POST', '/api/review/or', { id: 'b#stem', status: 'ok' }, { ...dev, 'x-review-key': 'ak' })).status).toBe(200); // admin key works too
    const got = (await call('GET', '/api/review/or', undefined, R)).json;
    expect(got['a#stem']).toMatchObject({ status: 'fixed', text: 'ଠିକ୍', audio: 'bad', by: 'M' });
    expect(got['a#stem'].note).toBeUndefined();
    expect(Object.keys(got)).toEqual(['a#stem', 'b#stem']);
  });
});

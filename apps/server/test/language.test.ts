// Home-language anchors and class regions (TODO P3.22, P3.24): set by the teacher, read by the learner's phone.
import { describe, expect, it } from 'vitest';
import { motionPack } from '@setu/content';
import { Store } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { buildModels } from '../src/llm.ts';

describe('teacher → learner: region and home-language words', () => {
  it('a class made with a region, a Kui word added by the teacher, both seen by a learner joining', async () => {
    const { app } = createApp({ store: new Store(), packs: [motionPack], models: buildModels(), liveGenLangs: [] });
    const dev = await (await app.request('/api/device', { method: 'POST' })).json() as { token: string };
    const H = { 'content-type': 'application/json', 'x-device-token': dev.token };
    const cls = await (await app.request('/api/class', { method: 'POST', headers: H, body: JSON.stringify({ name: '9A', lang: 'or', region: 'southern_hills' }) })).json() as { code: string; token: string };
    const T = { ...H, 'x-teacher-token': cls.token };
    expect((await app.request('/api/teacher/anchor', { method: 'POST', headers: T, body: JSON.stringify({ conceptId: 'velocity', lang: 'kxu', word: 'veg-kui' }) })).status).toBe(200);
    expect((await app.request('/api/teacher/anchor', { method: 'POST', headers: T, body: JSON.stringify({ conceptId: 'photosynthesis', lang: 'kxu', word: 'x' }) })).status).toBe(400);
    expect((await app.request('/api/teacher/anchor', { method: 'POST', headers: T, body: JSON.stringify({ conceptId: 'velocity', lang: 'or', word: 'x' }) })).status).toBe(400); // only bridge languages
    expect((await app.request('/api/teacher/anchor', { method: 'POST', headers: H, body: JSON.stringify({ conceptId: 'velocity', lang: 'kxu', word: 'x' }) })).status).toBe(403);
    const seen = await (await app.request(`/api/class/${cls.code}`, { headers: H })).json() as { region: string; anchors: Record<string, Record<string, string>> };
    expect(seen.region).toBe('southern_hills');
    expect(seen.anchors.velocity).toEqual({ kxu: 'veg-kui' });
    const view = await (await app.request('/api/teacher', { headers: T })).json() as { concepts: unknown[]; homeLangs: { id: string }[] };
    expect(view.concepts.length).toBe(6);
    expect(view.homeLangs.map((l) => l.id)).toContain('kxu');
  });
});

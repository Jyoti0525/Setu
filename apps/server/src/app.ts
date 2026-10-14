// HTTP API (PLAN §8.5, §10.7, §10.8).

import { createHash, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Push } from './push.ts';
import { PackMatcher, packDiff, bridgeLanguages, isUnsafe, textIn, REGIONS, Shelf, type AnyEvent, type BookIndex, type ChapterPack, type TraceStep } from '@setu/core';
import { runTutor, openTutor, type TutorDeps, type TutorRequest } from './tutor/run.ts';
import { Store } from './db.ts';
import { tokenMeter, buildModels, canCall, type ModelSet } from './llm.ts';
import { runCycle, type CycleDeps, type ServerTrace, type TurnRequest } from './agent/cycle.ts';
import { betweenSessions, tick, type BetweenTrigger } from './agent/between.ts';
import { traceLivePage } from './trace_page.ts';
import { createClass, classView, applyExamGoal, hashToken, keptCandidates } from './teacher.ts';
import { readPage, MAX_IMAGE_BYTES } from './vision.ts';
import { translateNote } from './translate.ts';
import { HybridRag, type NlpWorker } from './rag.ts';
import type { LiveVoice } from './voice.ts';
import { listen, MAX_AUDIO_BYTES, type ListenDeps } from './asr.ts';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compress } from 'hono/compress';

export interface AppOptions {
  store: Store;
  /** demo restore key (P7.10): lets the operator open a seeded learner on the demo phone */
  demoKey?: string;
  /** optional Web Push (P4.31): opt-in "next lesson ready" reminders */
  push?: Push;
  packs: ChapterPack[];
  /** textbook indexes the tutor chat answers from (PLAN v4; content/books/out) */
  books?: BookIndex[];
  models?: ModelSet;
  liveGenLangs?: string[];
  trustDraft?: boolean;
  /** enables POST /admin/tick */
  adminKey?: string;
  /** native reviewers' key for /#review (TODO D6); the admin key also works */
  reviewKey?: string;
  /** requests per minute per device */
  rateLimit?: number;
  /** records AI-written replies in voices phones lack (Odia) — served at /voice/<lang>/<key>.ogg */
  voice?: LiveVoice;
  /** speech in: self-hosted IndicConformer, Sarvam key, chain order (Gemini audio comes from `models`) */
  asr?: Omit<ListenDeps, 'models'>;
  /** self-hosted IndicTrans2 + e5 embeddings: question translation and hybrid RAG (tools/nlp/serve.py) */
  nlp?: NlpWorker;
  /** where Postgres (PGlite + pgvector) keeps the passage vectors; in memory when absent */
  ragDir?: string;
  /** textbook figures cut from the PDFs (content/scripts/figures.ts) */
  figuresDir?: string;
}

export function packHash(p: ChapterPack): string {
  const { hash: _h, ...rest } = p;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

export function createApp(o: AppOptions) {
  const app = new Hono();
  const store = o.store;
  const models = o.models ?? buildModels();
  const packs = new Map(o.packs.map((p) => [p.id, { ...p, hash: packHash(p) }]));
  // every version served is kept, so a phone with an older one gets only what changed (P4.14)
  for (const p of packs.values()) if (!store.cacheGet(`pack:${p.hash}`)) store.cacheSet(`pack:${p.hash}`, JSON.stringify(p));
  const pack = [...packs.values()][0]!;
  const matcher = new PackMatcher(pack);
  const listeners = new Set<(data: string) => void>();
  const publish = (profileId: string, step: TraceStep & Partial<ServerTrace>, source: 'server' | 'device') => {
    const data = JSON.stringify({ profileId, at: Date.now(), source, ...step });
    for (const l of listeners) l(data);
  };
  const deps: CycleDeps = {
    store, pack, matcher, models,
    liveGenLangs: new Set(o.liveGenLangs ?? ['en']),
    trustDraft: o.trustDraft ?? true,
    recentGen: new Map(),
    onTrace: (pid, step) => publish(pid, step, 'server'),
    onLate: (pid, info) => { for (const l of listeners) l(JSON.stringify({ profileId: pid, at: Date.now(), source: 'server', kind: 'late_generation', ...info })); },
  };

  // between-session agent runs after the response is sent (nobody waits for it)
  const after = (profileId: string, trigger: BetweenTrigger) => {
    setImmediate(() => {
      betweenSessions(deps, profileId, trigger)
        .then((r) => {
          // what it wrote for her next session (pre-written explanations, answers to queued doubts) gets a voice too
          for (const i of r?.plan?.items ?? []) o.voice?.say(i.pregenerated?.speak);
          for (const e of r?.events ?? []) if (e.type === 'DOUBT_ANSWERED') o.voice?.say((e.payload as { answer: string }).answer);
          // her next session is ready → one quiet reminder if she asked for them (P4.31)
          if (r?.plan?.items.length && trigger === 'session_end') void o.push?.lessonReady(profileId);
        })
        .catch((e) => console.error('between-session run failed', e));
    });
  };

  // a new-misconception candidate → translate it for her teacher now, so the teacher view has it in the class language
  const candidates = (profileId: string, events: AnyEvent[]) => {
    const cands = events.filter((e) => e.type === 'MISCONCEPTION_CANDIDATE');
    if (!cands.length) return;
    const j = [...store.events(profileId)].reverse().find((e) => e.type === 'CLASS_JOINED');
    const cls = j && store.classByCode((j.payload as { classCode: string }).classCode);
    if (!cls || cls.lang === 'en') return;
    for (const e of cands) void translateNote(deps, e.payload as { description: string; evidence: string }, cls.lang);
  };

  // a learner joined a class (online or synced from offline) → the class exam date becomes her goal
  const joined = (profileId: string, events: AnyEvent[]) => {
    const j = [...events].reverse().find((e) => e.type === 'CLASS_JOINED');
    const cls = j && store.classByCode((j.payload as { classCode: string }).classCode);
    if (cls?.examDate) applyExamGoal(deps, cls, [profileId]);
  };

  const traceKeys = [o.demoKey, o.adminKey].filter(Boolean);
  const traceAllowed = (c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }) => {
    if (!traceKeys.length) return true; // local development: no keys set
    const k = c.req.header('x-demo-key') ?? c.req.query('key');
    return !!k && traceKeys.includes(k);
  };
  // ---- device auth + rate limit (the demo tunnel URL is public) ----
  const hits = new Map<string, number[]>();
  app.use('/api/*', async (c, next) => {
    const open = c.req.path === '/api/device' || c.req.path === '/api/health' || c.req.path.startsWith('/api/pack');
    if (open) return next();
    // the live trace quotes what learners asked: on a public link only the presenter (demo or admin key) may watch it
    if (c.req.path.startsWith('/api/trace')) return traceAllowed(c) ? next() : c.json({ error: 'not found' }, 404);
    const token = c.req.header('x-device-token') ?? '';
    const deviceId = store.deviceFor(token);
    if (!deviceId) return c.json({ error: 'unknown device' }, 401);
    const now = Date.now();
    const recent = (hits.get(deviceId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= (o.rateLimit ?? 60)) return c.json({ error: 'slow down' }, 429);
    recent.push(now);
    hits.set(deviceId, recent);
    c.set('deviceId' as never, deviceId as never);
    return next();
  });

  // ---- tutor chat over her textbooks (PLAN v4) ----
  const shelf = new Shelf(o.books ?? []);
  // hybrid RAG: passage vectors are built in the background; until then the keyword search answers alone
  const rag = o.nlp ? new HybridRag({ shelf, worker: o.nlp, dir: o.ragDir, log: (m) => console.log(m) }) : undefined;
  if (rag) void rag.index().catch((e) => console.error('hybrid RAG index failed', e));
  const tutor: TutorDeps = {
    store, shelf, models, rag, nlp: o.nlp, onTrace: (pid, step) => publish(pid, step, 'server'),
    // her class teacher's phone buzzes (only if the teacher turned alerts on); never her name or words
    onEscalate: (pid, kind, chapter) => { for (const code of store.classesOf(pid)) void o.push?.teacherAlert(code, kind, chapter); },
  };
  const bookList = () => [...shelf.books.values()].map((b) => ({ ...b.meta, version: b.version, passages: b.passages.length, kb: Math.round(JSON.stringify(b).length / 1024) }));
  app.get('/api/books', (c) => c.json(bookList()));
  // textbooks for offline (~200 KB of Odia text each) shrink to about a quarter: it matters on a 3G data pack
  app.use('/api/book/*', compress());
  app.get('/api/book/:id', (c) => { const b = shelf.books.get(c.req.param('id')); return b ? c.json(b) : c.json({ error: 'no such book' }, 404); });
  app.post('/api/tutor/open', async (c) => {
    const deviceId = c.get('deviceId' as never) as string;
    const body = (await c.req.json()) as { profileId: string; lang: string; bookIds?: string[] };
    if (!store.canUse(body.profileId, deviceId)) return c.json({ error: 'not your profile' }, 403);
    // the chat may come before her first synced event: this phone keeps access after the tutor writes events for her
    store.grant(body.profileId, deviceId);
    return c.json(openTutor(tutor, body));
  });
  // a retry of the same message (same device + turnId) gets the same reply, never a second run (as /api/turn)
  const tutorTurns = new Map<string, { at: number; res: Promise<Awaited<ReturnType<typeof runTutor>>> }>();
  app.post('/api/tutor/turn', async (c) => {
    const deviceId = c.get('deviceId' as never) as string;
    const body = (await c.req.json()) as Omit<TutorRequest, 'deviceId'> & { turnId?: string };
    if (!store.canUse(body.profileId, deviceId)) return c.json({ error: 'not your profile' }, 403);
    if (typeof body.text !== 'string' || body.text.length > 4000) return c.json({ error: 'bad text' }, 400);
    store.grant(body.profileId, deviceId);
    const now = Date.now();
    for (const [k, v] of tutorTurns) if (now - v.at > 10 * 60_000) tutorTurns.delete(k);
    const key = body.turnId ? `${deviceId}:${body.turnId}` : undefined;
    const seen = key ? tutorTurns.get(key) : undefined;
    if (seen) { c.header('x-replayed', '1'); return c.json(await seen.res); }
    const running = runTutor(tutor, { ...body, deviceId });
    if (key) { tutorTurns.set(key, { at: now, res: running }); running.catch(() => tutorTurns.delete(key)); }
    const res = await running;
    // AI-written replies get a recorded voice too (Odia phones have none)
    for (const m of res.messages) if (m.by === 'model') o.voice?.say(m.text + (m.check ? ' ' + m.check : ''));
    c.header('x-server-ms', String(Date.now() - now));
    return c.json(res);
  });
  app.get('/api/tutor/history/:profileId', (c) => {
    const deviceId = c.get('deviceId' as never) as string;
    const pid = c.req.param('profileId');
    if (!store.canUse(pid, deviceId)) return c.json({ error: 'not your profile' }, 403);
    return c.json(store.tutorLog(pid, 40));
  });

  const asr: ListenDeps = { models, ...o.asr };
  const canListen = (lang: string) => canCall(models, 'listen') || !!asr.local?.supports(lang) || !!asr.sarvamKey;
  app.get('/api/health', (c) => c.req.query('lite') ? c.json({ ok: true, listen: { or: canListen('or'), en: canListen('en'), hi: canListen('hi') } }) : c.json({ ok: true, listen: { or: canListen('or'), en: canListen('en'), hi: canListen('hi') }, providers: models.providers, breakers: models.breakers.status(), recentFailures: models.breakers.failures.slice(-5), liveGen: [...deps.liveGenLangs], packs: [...packs.keys()], tokens: Object.fromEntries(tokenMeter) }));

  app.post('/api/device', (c) => {
    const token = randomUUID();
    const deviceId = `dev-${randomUUID().slice(0, 8)}`;
    store.registerDevice(token, deviceId);
    return c.json({ token, deviceId });
  });

  app.get('/api/pack/:id', (c) => {
    const p = packs.get(c.req.param('id'));
    if (!p) return c.json({ error: 'no such pack' }, 404);
    c.header('etag', p.hash!);
    const have = c.req.header('if-none-match');
    if (have === p.hash) return c.body(null, 304);
    // an older version we know → a diff by item version, usually a few KB instead of the whole pack (P4.14)
    const old = have && /^[0-9a-f]{64}$/.test(have) ? store.cacheGet(`pack:${have}`) : undefined;
    if (old && c.req.query('diff') === '1') {
      const d = packDiff(JSON.parse(old) as ChapterPack, p, { from: have!, to: p.hash! });
      const body = JSON.stringify(d);
      if (body.length < JSON.stringify(p).length / 2) { c.header('x-pack-diff', '1'); return c.body(body, 200, { 'content-type': 'application/json' }); }
    }
    return c.json(p);
  });
  app.get('/api/packs', (c) => c.json([...packs.values()].map((p) => ({ id: p.id, version: p.version, hash: p.hash, title: p.title, languages: p.languages, bytes: JSON.stringify(p).length }))));

  // P4.4 idempotent turns: a retry of the same turn (same device + turnId) gets the same reply, never a second run
  const turns = new Map<string, { at: number; res: Promise<Awaited<ReturnType<typeof runCycle>>> }>();
  const TURN_KEEP_MS = 10 * 60_000;
  app.post('/api/turn', async (c) => {
    const deviceId = c.get('deviceId' as never) as string;
    const body = (await c.req.json()) as TurnRequest;
    if (!store.canUse(body.profileId, deviceId)) return c.json({ error: 'not your profile' }, 403);
    const t0 = Date.now();
    const key = body.turnId ? `${deviceId}:${body.turnId}` : undefined;
    for (const [k, v] of turns) if (t0 - v.at > TURN_KEEP_MS) turns.delete(k);
    const seen = key ? turns.get(key) : undefined;
    if (seen) { c.header('x-replayed', '1'); return c.json(await seen.res); }
    const running = runCycle(deps, { ...body, deviceId, outbox: (body.outbox ?? []).map((e) => ({ ...e, deviceId })) });
    if (key) { turns.set(key, { at: t0, res: running }); running.catch(() => turns.delete(key)); }
    const res = await running;
    if ((body.outbox ?? []).some((e) => e.type === 'CLASS_JOINED')) joined(body.profileId, body.outbox);
    c.header('x-server-ms', String(Date.now() - t0));
    // AI-written lines (fixed ones ship as clips): recorded now, so 🔊 is ready by the time she taps it
    for (const m of res.messages) if ('speak' in m) o.voice?.say(m.speak);
    candidates(body.profileId, res.events);
    if (body.input.type === 'end') after(body.profileId, 'session_end');
    else if (res.trace.synced_in && (body.outbox ?? []).some((e) => e.type === 'SESSION_ENDED')) after(body.profileId, 'sync');
    return c.json(res);
  });

  // Outbox flush without asking for a decision; device-tier traces ride along (PLAN §5.7).
  app.post('/api/sync', async (c) => {
    const deviceId = c.get('deviceId' as never) as string;
    const body = (await c.req.json()) as { profileId: string; cursor: number; outbox: AnyEvent[]; traces?: (TraceStep & { at?: number })[] };
    if (!store.canUse(body.profileId, deviceId)) return c.json({ error: 'not your profile' }, 403);
    const outbox = (body.outbox ?? []).filter((e) => e.profileId === body.profileId).map((e) => ({ ...e, deviceId }));
    const added = store.append(outbox);
    for (const t of body.traces ?? []) {
      store.addTrace(body.profileId, { ...t, tier: 'device' }, t.at);
      publish(body.profileId, { ...t, tier: 'device' }, 'device');
    }
    // a session that ended offline (or a queued doubt) → the between-session run happens now that we can see it
    if (added && outbox.some((e) => e.type === 'SESSION_ENDED' || e.type === 'DOUBT_QUEUED')) after(body.profileId, 'sync');
    if (added && outbox.some((e) => e.type === 'CLASS_JOINED')) joined(body.profileId, outbox);
    const delta = store.since(body.profileId, body.cursor ?? 0);
    return c.json({ added, events: delta.events, cursor: delta.cursor });
  });

  // ---- Snap online: read the photo (image discarded after this request) ----
  app.post('/api/snap/read', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { image?: string; mime?: string; lang?: string };
    const mime = /^image\/(jpeg|png|webp)$/.test(b.mime ?? '') ? b.mime! : 'image/jpeg';
    if (!b.image || b.image.length * 0.75 > MAX_IMAGE_BYTES) return c.json({ error: 'image missing or too large' }, 400);
    const r = await readPage(models, b.image, mime, ['or', 'en', 'hi'].includes(b.lang ?? '') ? b.lang : 'or');
    return 'error' in r ? c.json(r, 503) : c.json(r);
  });

  // ---- Voice doubt (TODO P3.1–P3.6): recorded question → text; the phone then asks it as a doubt (mode 'voice').
  // The audio is deleted right after (P5.21). Nothing here can answer — only the normal turn does, with its checks.
  app.post('/api/listen', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { audio?: string; mime?: string; lang?: string };
    const mime = /^audio\/(webm|ogg|mp4|mpeg|aac|wav)(;.*)?$/.test(b.mime ?? '') ? b.mime! : 'audio/webm';
    const lang = ['or', 'en', 'hi'].includes(b.lang ?? '') ? b.lang! : 'or';
    if (!b.audio || b.audio.length * 0.75 > MAX_AUDIO_BYTES) return c.json({ error: 'audio missing or too long' }, 400);
    const r = await listen(asr, Buffer.from(b.audio, 'base64'), mime, lang);
    return 'error' in r ? c.json(r, 503) : c.json(r);
  });

  // ---- classes + teacher view (PLAN §9.2, §10.7: class-scoped token, teacher sees only their class) ----
  app.post('/api/class', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; lang?: string; region?: string };
    const lang = pack.languages.includes(b.lang ?? '') ? b.lang! : 'en';
    const made = createClass(store, String(b.name ?? '').trim(), lang);
    // P3.22: the class's region picks local analogies for its learners
    if (b.region && REGIONS[b.region]) store.cacheSet(`region:${made.code}`, b.region);
    return c.json({ ...made, lang });
  });
  // learner side: is this code real? (name only — nothing about other learners)
  app.get('/api/class/:code', (c) => {
    const cls = store.classByCode(c.req.param('code'));
    return cls ? c.json({ code: cls.code, name: cls.name, anchors: anchors(cls.code), region: store.cacheGet(`region:${cls.code}`) }) : c.json({ error: 'no such class' }, 404);
  });
  // P3.24 home-language anchors: words a teacher/community adds for key concepts (Kui, Santali…) — shown in the term bridge
  const anchors = (code: string) => JSON.parse(store.cacheGet(`anchors:${code}`) ?? '{}') as Record<string, Record<string, string>>;
  app.post('/api/teacher/anchor', async (c) => {
    const cls = teacherClass(c.req.header('x-teacher-token'));
    if (!cls) return c.json({ error: 'unknown class key' }, 403);
    const b = (await c.req.json()) as { conceptId?: string; lang?: string; word?: string };
    const word = String(b.word ?? '').replace(/[<>{}`]/g, '').trim().slice(0, 40);
    if (!b.conceptId || !pack.graph.concepts[b.conceptId] || !bridgeLanguages().some((l) => l.id === b.lang) || isUnsafe(word)) return c.json({ error: 'bad request' }, 400);
    const a = anchors(cls.code);
    a[b.conceptId] = { ...a[b.conceptId], [b.lang!]: word };
    if (!word) delete a[b.conceptId]![b.lang!];
    store.cacheSet(`anchors:${cls.code}`, JSON.stringify(a));
    return c.json({ anchors: a });
  });
  const teacherClass = (token?: string) => {
    const cls = token ? store.classByToken(hashToken(token)) : undefined;
    if (cls) store.touchClass(cls.code);
    return cls;
  };
  app.get('/api/teacher', (c) => {
    const cls = teacherClass(c.req.header('x-teacher-token'));
    return cls ? c.json({ ...classView(deps, cls), anchors: anchors(cls.code), concepts: Object.values(pack.graph.concepts).map((x) => ({ id: x.id, name: textIn(x.name, cls.lang) })), homeLangs: bridgeLanguages().map((l) => ({ id: l.id, name: `${l.name} (${l.english})` })) }) : c.json({ error: 'unknown class key' }, 403);
  });
  app.post('/api/teacher/exam', async (c) => {
    const cls = teacherClass(c.req.header('x-teacher-token'));
    if (!cls) return c.json({ error: 'unknown class key' }, 403);
    const { date } = (await c.req.json()) as { date?: string | null };
    const at = date ? Date.parse(`${date}T09:00:00+05:30`) : null;
    if (date && !Number.isFinite(at)) return c.json({ error: 'bad date' }, 400);
    store.setExamDate(cls.code, at);
    const changed = applyExamGoal(deps, { ...cls, examDate: at ?? undefined });
    return c.json({ examDate: at, learnersUpdated: changed.length });
  });
  app.post('/api/teacher/ack', async (c) => {
    const cls = teacherClass(c.req.header('x-teacher-token'));
    if (!cls) return c.json({ error: 'unknown class key' }, 403);
    const b = (await c.req.json()) as { ref?: string; action?: string; body?: string };
    if (!b.ref || !/^(esc|wb|reteach|cand):/.test(b.ref) || !['done', 'approved', 'rejected', 'draft'].includes(b.action ?? '')) return c.json({ error: 'bad request' }, 400);
    store.ack(cls.code, b.ref, b.action!, b.body?.slice(0, 4000));
    if (b.ref.startsWith('reteach:') && b.action === 'approved')
      publish(`class:${cls.code}`, { trigger: 'teacher_review', tier: 'cloud', facts_used: [], candidates: [], chosen: `reteach ${b.ref.slice(8)} approved`, decided_by: 'policy', override: false, reason: 'human in the loop: teacher approved the class reteach draft', tools: [{ tool: 'notify_teacher', args: { ref: b.ref, edited: !!b.body }, status: 'ok' }], why: '' }, 'server');
    return c.json({ ok: true });
  });

  // ---- live voice (TODO P3.9): only replies the server recorded; the phone falls back to its own voice on 404 ----
  // a line on her screen with no recording yet (fixed Hindi lines, older replies): record it now, then GET it
  app.post('/voice/say', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { text?: string };
    if (typeof b.text !== 'string' || b.text.length > 1500) return c.json({ error: 'bad text' }, 400);
    const key = o.voice?.say(b.text);
    return key ? c.json({ key }) : c.json({ error: 'no voice' }, 404);
  });
  // a textbook figure for the answer card: public book pictures, so no device token (an <img> sends none)
  app.get('/figure/:book/:file', async (c) => {
    const { book, file } = c.req.param();
    if (!o.figuresDir || !/^[a-z0-9-]+$/.test(book) || !/^p\d{3}-\d{1,2}\.jpg$/.test(file)) return c.body(null, 404);
    const f = await readFile(resolve(o.figuresDir, book, file)).catch(() => undefined);
    return f ? c.body(f, 200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=604800' }) : c.body(null, 404);
  });
  app.get('/voice/:lang/:file', async (c) => {
    const key = c.req.param('file').replace(/\.ogg$/, '');
    const f = o.voice && (await o.voice.file(c.req.param('lang'), key));
    if (!f) return c.body(null, 404);
    return c.body(await readFile(f), 200, { 'content-type': 'audio/ogg', 'cache-control': 'public, max-age=31536000, immutable' });
  });

  // ---- judge view ----
  app.get('/api/trace/recent', (c) => c.json(store.traces(Number(c.req.query('limit') ?? 200))));
  app.get('/api/trace/stream', (c) =>
    streamSSE(c, async (stream) => {
      const send = (data: string) => { void stream.writeSSE({ data, event: 'trace' }); };
      listeners.add(send);
      stream.onAbort(() => { listeners.delete(send); });
      while (!stream.aborted) await stream.sleep(15_000).then(() => stream.writeSSE({ data: '', event: 'ping' }));
    }),
  );
  // a device may read only profiles it has written events for (PLAN §10.6)
  app.get('/api/events/:profileId', (c) => {
    const deviceId = c.get('deviceId' as never) as string;
    const evs = store.events(c.req.param('profileId'));
    if (!evs.some((e) => e.deviceId === deviceId)) return c.json({ error: 'not your profile' }, 403);
    return c.json(evs);
  });
  app.get('/trace/live', (c) => (traceAllowed(c) ? c.html(traceLivePage()) : c.text('not found', 404)));

  // operator: run the schedule tick now (demo + cron). Disabled unless SETU_ADMIN_KEY is set.
  app.post('/admin/tick', async (c) => {
    if (!o.adminKey || c.req.header('x-admin-key') !== o.adminKey) return c.json({ error: 'not found' }, 404);
    return c.json(await tick(deps));
  });
  // demo restore (P7.10): open a seeded learner on the demo phone — only with SETU_DEMO_KEY, which is never on by default
  app.post('/api/demo/restore', async (c) => {
    if (!o.demoKey || c.req.header('x-demo-key') !== o.demoKey) return c.json({ error: 'not found' }, 404);
    const { profileId } = (await c.req.json()) as { profileId?: string };
    if (!profileId || !store.events(profileId).length) return c.json({ error: 'no such profile' }, 404);
    store.grant(profileId, c.get('deviceId' as never) as string);
    return c.json({ ok: true });
  });
  // failure drill (P7.9): take a provider down live and watch the trace fall back (admin only)
  app.post('/admin/provider', async (c) => {
    if (!o.adminKey || c.req.header('x-admin-key') !== o.adminKey) return c.json({ error: 'not found' }, 404);
    const b = (await c.req.json()) as { key?: string; down?: boolean; minutes?: number };
    if (!b.key || !models.providers.includes(b.key)) return c.json({ error: 'unknown provider', providers: models.providers }, 400);
    models.breakers.force(b.key, !!b.down, (b.minutes ?? 10) * 60_000);
    return c.json({ providers: models.providers, breakers: models.breakers.status() });
  });
  // native language review (TODO D6): the reviewer marks each line ok / fixed / unsure and rates its audio;
  // content/scripts/review_apply.ts turns the decisions into pack + source fixes
  const reviewer = (k?: string) => !!k && (k === o.reviewKey || k === o.adminKey);
  app.get('/api/review/:lang', (c) => {
    if (!reviewer(c.req.header('x-review-key'))) return c.json({ error: 'reviewer key needed' }, 403);
    return c.json(store.reviews(c.req.param('lang')));
  });
  app.post('/api/review/:lang', async (c) => {
    if (!reviewer(c.req.header('x-review-key'))) return c.json({ error: 'reviewer key needed' }, 403);
    const b = (await c.req.json().catch(() => ({}))) as { id?: string; status?: string; text?: string; note?: string; audio?: string; by?: string };
    if (!b.id || b.id.length > 200 || !['ok', 'fixed', 'unsure'].includes(b.status ?? '') || (b.status === 'fixed' && !b.text?.trim())) return c.json({ error: 'bad request' }, 400);
    if (b.audio && !['good', 'bad'].includes(b.audio)) return c.json({ error: 'bad audio rating' }, 400);
    store.review(c.req.param('lang'), b.id, { status: b.status!, text: b.text?.trim().slice(0, 4000), note: b.note?.slice(0, 1000), audio: b.audio, by: b.by?.slice(0, 60) });
    return c.json({ ok: true });
  });

  // operator: misconceptions teachers kept → next pack revision (PLAN §6.5)
  app.get('/admin/candidates', (c) => {
    if (!o.adminKey || c.req.header('x-admin-key') !== o.adminKey) return c.json({ error: 'not found' }, 404);
    return c.json(keptCandidates(deps));
  });

  // P4.31 Web Push: the public key, opt-in and opt-out (the phone's own choice; nothing personal is ever sent)
  app.get('/api/push/key', (c) => (o.push ? c.json({ key: o.push.publicKey }) : c.json({ error: 'push off' }, 404)));
  app.post('/api/push/subscribe', async (c) => {
    if (!o.push) return c.json({ error: 'push off' }, 404);
    const b = (await c.req.json()) as { profileId: string; sub: import('web-push').PushSubscription; lang: string };
    return o.push.subscribe(c.get('deviceId' as never) as string, b.profileId, b.sub, b.lang) ? c.json({ ok: true }) : c.json({ error: 'bad subscription' }, 400);
  });
  // the teacher's phone: alerts when the agent escalates one of her learners
  app.post('/api/teacher/push', async (c) => {
    const cls = teacherClass(c.req.header('x-teacher-token'));
    if (!cls) return c.json({ error: 'not found' }, 404);
    if (!o.push) return c.json({ error: 'push off' }, 404);
    const b = (await c.req.json()) as { sub: import('web-push').PushSubscription };
    return o.push.subscribe(c.get('deviceId' as never) as string, `class:${cls.code}`, b.sub, cls.lang) ? c.json({ ok: true }) : c.json({ error: 'bad subscription' }, 400);
  });
  app.post('/api/push/unsubscribe', async (c) => {
    const b = (await c.req.json()) as { endpoint: string };
    o.push?.unsubscribe(c.get('deviceId' as never) as string, b.endpoint);
    return c.json({ ok: true });
  });

  return { app, deps, publish, tutor };
}

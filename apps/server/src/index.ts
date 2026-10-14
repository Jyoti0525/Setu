// Server entry: node 20 + Hono + SQLite. Serves the API, /trace/live and the built PWA.

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { compress } from 'hono/compress';
import { motionPack } from '@setu/content';
import { liveGenLanguages, type BookIndex } from '@setu/core';
import { Store } from './db.ts';
import { Push } from './push.ts';
import { buildModels } from './llm.ts';
import { loadHomeWords } from './tutor/home.ts';
import { createApp } from './app.ts';
import { tick } from './agent/between.ts';
import { LiveVoice, shippedClips } from './voice.ts';
import { LocalAsr } from './asr.ts';
import { warmOcr } from './vision.ts';
import { NlpWorker, ragDir } from './rag.ts';
import { createFirebaseTokenVerifier } from './firebase_auth.ts';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const dataDir = resolve(here, '../data');
mkdirSync(dataDir, { recursive: true });
const store = new Store(process.env.SETU_DB ?? resolve(dataDir, 'setu.sqlite'));
const models = buildModels();
const firebaseAuth = createFirebaseTokenVerifier();
// live Odia voice for AI-written replies: needs the MMS venv (see tools/tts); without it phones use their own voice
const repo = resolve(here, '../../..');
const venvPython = resolve(repo, 'spikes/tts/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const voice = process.env.SETU_VOICE === '0' ? undefined : new LiveVoice({
  python: process.env.SETU_TTS_PYTHON || venvPython,
  script: resolve(repo, 'tools/tts/serve.py'),
  dir: resolve(dataDir, 'voice'),
  shipped: shippedClips(resolve(repo, 'apps/web/public/audio')),
  log: (m) => console.log(m),
});
voice?.start();
// self-hosted speech-to-text (IndicConformer, same venv + onnxruntime); loads in the background
const localAsr = process.env.SETU_ASR === '0' ? undefined : new LocalAsr({
  python: process.env.SETU_TTS_PYTHON || venvPython,
  script: resolve(repo, 'tools/asr/serve.py'),
  log: (m) => console.log(m),
});
localAsr?.start();
warmOcr(); // photo reading when the cloud vision models are busy
// self-hosted IndicTrans2 (her question → English) + e5 embeddings for hybrid RAG (Postgres + pgvector); SETU_NLP=0 off
const nlp = process.env.SETU_NLP === '0' ? undefined : new NlpWorker({
  python: process.env.SETU_TTS_PYTHON || venvPython,
  script: resolve(repo, 'tools/nlp/serve.py'),
  log: (m) => console.log(m),
});
nlp?.start();
// textbook indexes for the tutor chat (content/scripts/build_book.ts)
const booksDir = resolve(repo, 'content/books/out');
const books = existsSync(booksDir) ? readdirSync(booksDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(booksDir, f), 'utf8')) as BookIndex) : [];
const { app, deps } = createApp({
  store,
  packs: [motionPack],
  books,
  figuresDir: resolve(repo, 'content/books/figures'),
  homeWords: loadHomeWords(resolve(repo, 'content/tribal')),
  models,
  // Live generation per language follows its measured quality (core languages.ts, P3.27); SETU_LIVE_GEN overrides.
  liveGenLangs: process.env.SETU_LIVE_GEN ? process.env.SETU_LIVE_GEN.split(',').map((s) => s.trim()).filter(Boolean) : liveGenLanguages(),
  // Draft (unreviewed) content counts as trusted only in development (TODO D6).
  trustDraft: process.env.SETU_TRUST_DRAFT !== '0',
  adminKey: process.env.SETU_ADMIN_KEY || undefined,
  demoKey: process.env.SETU_DEMO_KEY || undefined,
  reviewKey: process.env.SETU_REVIEW_KEY || undefined,
  firebaseAuth,
  firebaseWeb: process.env.FIREBASE_API_KEY && process.env.FIREBASE_PROJECT_ID ? {
    apiKey: process.env.FIREBASE_API_KEY, projectId: process.env.FIREBASE_PROJECT_ID,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
    ...(process.env.FIREBASE_APP_ID ? { appId: process.env.FIREBASE_APP_ID } : {}),
  } : undefined,
  voice,
  // opt-in reminders (P4.31); SETU_PUSH=0 turns them off. Subject: a contact URL for push services (not a learner's)
  push: process.env.SETU_PUSH === '0' ? undefined : new Push(store, { subject: process.env.SETU_PUSH_SUBJECT || undefined }),
  asr: {
    local: localAsr,
    sarvamKey: process.env.SARVAM_API_KEY || undefined,
    order: process.env.SETU_ASR_ORDER?.split(',').map((x) => x.trim()),
  },
  nlp,
  ragDir: ragDir(dataDir),
});

// SCHEDULE_TICK (PLAN §5.1): end sessions left open, run the between-session agent, detect drop-off
setInterval(() => { tick(deps).catch((e) => console.error('tick failed', e)); }, Number(process.env.SETU_TICK_MIN ?? 10) * 60_000).unref();

const webDist = resolve(here, '../../web/dist');
if (existsSync(webDist)) {
  // serveStatic resolves paths relative to the working directory
  const root = relative(process.cwd(), webDist).replace(/\\/g, '/');
  // OCR cores are base64 WASM (3.9 MB) — gzip roughly halves what the phone downloads
  app.use('/ocr/*', compress());
  // pre-recorded voice clips: Opus in Ogg (hono's mime table has no .ogg)
  // the installed app updates itself (P7.6): the service worker, its manifest and the page are always re-checked;
  // hashed build files never change, so the phone keeps them
  app.use('/*', serveStatic({ root, onFound: (p, c) => {
    if (p.endsWith('.ogg')) c.header('content-type', 'audio/ogg');
    if (p.endsWith('.webmanifest')) c.header('content-type', 'application/manifest+json');
    if (/(^|[\\/])(sw|registerSW|push-sw|workbox-\w+)\.js$|\.webmanifest$|\.html$/.test(p)) c.header('cache-control', 'no-cache');
    else if (/[\\/]assets[\\/]/.test(p)) c.header('cache-control', 'public, max-age=31536000, immutable');
  } }));
  app.get('/*', serveStatic({ path: `${root}/index.html`, onFound: (_p, c) => { c.header('cache-control', 'no-cache'); } }));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`Setu server on http://localhost:${port}  ·  trace: /trace/live`);
  console.log(`Books: ${books.map((b) => `${b.meta.id} (${b.passages.length})`).join(', ') || 'none — run content/scripts/build_book.ts'}`);
  console.log(`LLM providers: ${models.providers.join(', ') || 'none (policy + pack mode)'}  ·  live generation: ${[...deps.liveGenLangs].join(',')}`);
  console.log(`Firebase ID token verification: ${firebaseAuth ? 'configured' : 'off (set FIREBASE_PROJECT_ID)'}`);
});

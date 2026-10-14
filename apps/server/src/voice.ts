// Live voice for AI-written replies (TODO P3.9, PLAN §10.2 step 2): fixed lines ship as pre-recorded clips, but a
// generated explanation or a queued-doubt answer is new text. Most phones have no Odia system voice, so the server
// records it with the same MMS voice (tools/tts/serve.py, one long-running python process) and serves it at
// /voice/<lang>/<key>.ogg — key = audioKey(text), the same key the phone computes from the line it shows.
// Only text the server itself wrote is recorded: this is not an open text-to-speech service.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { audioKey } from '@setu/core';

/** Languages with a server voice, and how to recognise their text (a reply is in one script). */
const SCRIPTS: Record<string, RegExp> = { or: /[଀-୿]/, hi: /[ऀ-ॿ]/ };
const MAX_CHARS = 1500;
const MAX_QUEUE = 50;

export interface VoiceOptions {
  /** python with torch + transformers (spikes/tts/.venv); unset or missing → no live voice, phones use their own */
  python?: string;
  /** tools/tts/serve.py */
  script: string;
  /** where recorded replies are kept: <dir>/<lang>/<key>.ogg */
  dir: string;
  /** keys already shipped as pre-recorded clips, per language (nothing to record) */
  shipped?: Record<string, Set<string>>;
  log?: (msg: string) => void;
}

export class LiveVoice {
  private proc?: ChildProcess;
  private ready = false;
  private failures = 0;
  private readonly waiting = new Map<string, { done: Promise<boolean>; resolve: (ok: boolean) => void }>();
  private readonly queue: { key: string; text: string; out: string; lang: string }[] = [];
  private busy = false;

  constructor(private readonly o: VoiceOptions) {}

  get enabled() { return !!this.o.python && existsSync(this.o.python) && existsSync(this.o.script) && this.failures < 3; }

  /** The language this text would be voiced in, if the server has a voice for it. */
  langOf(text: string): string | undefined {
    return Object.entries(SCRIPTS).find(([, re]) => re.test(text))?.[0];
  }

  path(lang: string, key: string) { return join(this.o.dir, lang, `${key}.ogg`); }

  /** Queue a recording of text the server wrote. Returns its key, or undefined when there is nothing to record. */
  say(text: string | undefined): string | undefined {
    const t = text?.trim();
    if (!t || !this.enabled) return undefined;
    const lang = this.langOf(t);
    if (!lang) return undefined;
    const key = audioKey(t);
    if (this.o.shipped?.[lang]?.has(key) || existsSync(this.path(lang, key)) || this.waiting.has(`${lang}/${key}`)) return key;
    if (this.queue.length >= MAX_QUEUE) return undefined;
    let resolve!: (ok: boolean) => void;
    const done = new Promise<boolean>((r) => { resolve = r; });
    this.waiting.set(`${lang}/${key}`, { done, resolve });
    this.queue.push({ key, text: t.slice(0, MAX_CHARS), out: this.path(lang, key), lang });
    this.start();
    this.pump();
    return key;
  }

  /** The recorded file, waiting up to `waitMs` if it is still being recorded. */
  async file(lang: string, key: string, waitMs = 15_000): Promise<string | undefined> {
    if (!/^[0-9a-f]{8}$/.test(key) || !SCRIPTS[lang]) return undefined;
    const f = this.path(lang, key);
    if (existsSync(f)) return f;
    const w = this.waiting.get(`${lang}/${key}`);
    if (!w) return undefined;
    const ok = await Promise.race([w.done, new Promise<boolean>((r) => setTimeout(() => r(false), waitMs).unref())]);
    return ok && existsSync(f) ? f : undefined;
  }

  /** Starts the python voice now (the model takes a few seconds to load) instead of on the first reply. */
  start() {
    if (this.proc || !this.enabled) return;
    const p = spawn(this.o.python!, [this.o.script], {
      cwd: join(this.o.script, '..'),
      env: { ...process.env, HF_HUB_OFFLINE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.proc = p;
    createInterface({ input: p.stdout! }).on('line', (line) => this.onLine(line));
    p.stderr!.on('data', () => { /* model warnings; failures arrive as JSON lines */ });
    p.on('exit', (code) => {
      this.o.log?.(`voice process exited (${code})`);
      this.proc = undefined;
      this.ready = false;
      this.busy = false;
      this.failures++;
      // what was being recorded is lost; what is queued waits for the next start
      const head = this.queue.shift();
      if (head) this.finish(head.out, head.key, false);
      if (!this.enabled) for (const q of this.queue.splice(0)) this.finish(q.out, q.key, false); // gave up: phones use their own voice
      else if (this.queue.length) this.start();
    });
    p.on('error', (e) => { this.o.log?.(`voice process failed to start: ${e.message}`); this.failures = 3; for (const q of this.queue.splice(0)) this.finish(q.out, q.key, false); });
  }

  stop() { this.proc?.kill(); }

  private onLine(line: string) {
    let m: { ready?: boolean; key?: string; ok?: boolean; error?: string };
    try { m = JSON.parse(line); } catch { return; }
    if (m.ready) { this.ready = true; this.failures = 0; this.o.log?.('live voice ready (MMS Odia + Hindi)'); this.pump(); return; }
    const head = this.queue.shift();
    this.busy = false;
    if (head) {
      if (!m.ok) this.o.log?.(`voice: ${head.key} not recorded: ${m.error}`);
      this.finish(head.out, head.key, !!m.ok);
    }
    this.pump();
  }

  private finish(out: string, key: string, ok: boolean) {
    const lang = out.split(/[\\/]/).slice(-2)[0]!;
    const w = this.waiting.get(`${lang}/${key}`);
    this.waiting.delete(`${lang}/${key}`);
    w?.resolve(ok);
  }

  private pump() {
    if (!this.ready || this.busy || !this.queue.length || !this.proc) return;
    this.busy = true;
    this.proc.stdin!.write(JSON.stringify(this.queue[0]) + '\n');
  }
}

/** Keys of the pre-recorded clips the PWA ships (apps/web/public/audio/<lang>/index.json). */
export function shippedClips(publicAudio: string): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const lang of Object.keys(SCRIPTS)) {
    const f = join(publicAudio, lang, 'index.json');
    if (existsSync(f)) out[lang] = new Set(Object.keys((JSON.parse(readFileSync(f, 'utf8')) as { clips?: Record<string, number> }).clips ?? {}));
  }
  return out;
}

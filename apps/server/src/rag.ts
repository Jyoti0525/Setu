// Hybrid RAG for the tutor turn (online, on the server): her question is matched to textbook passages two ways and
// the two ranked lists are fused (reciprocal rank fusion):
//   keyword  — the Shelf's BM25 search (MiniSearch; Odia spellings, loose sounds, English→Odia lexicon). The phone
//              runs the same search offline, so offline answers never depend on anything here.
//   meaning  — pgvector: every passage is a multilingual-e5-small vector in Postgres (PGlite, embedded, no install);
//              her question (and its English translation) is embedded and the nearest passages are found by cosine.
// Her question is also translated to English with AI4Bharat IndicTrans2 (self-hosted, tools/nlp/serve.py). The
// translation only helps search and understanding; the reply is still written from the Odia passages in her language.

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { BookHit, Shelf } from '@setu/core';

/** how much her translated question counts next to her own words (keyword / meaning lists; rag_eval) */
export let EN_KEYWORD_WEIGHT = 0.5;
export let EN_MEANING_WEIGHT = 0.7;
export const setEnWeights = (k: number, m: number) => { EN_KEYWORD_WEIGHT = k; EN_MEANING_WEIGHT = m; };
/** reciprocal rank fusion constant (the usual 60) */
const RRF_K = 60;

type Reply = { ok: boolean; text?: string; vecs?: number[][]; error?: string; ms?: number };

/** One long-running Python process for translation + embeddings (JSON lines, answered in order). */
export class NlpWorker {
  private proc?: ChildProcess;
  private ready = false;
  private failures = 0;
  private n = 0;
  caps = { translate: false, embed: false, model: '', dim: 0 };
  private readonly pending = new Map<string, (r: Reply) => void>();
  private readyWaiters: (() => void)[] = [];

  constructor(private readonly o: { python?: string; script: string; log?: (m: string) => void }) {}

  get enabled() { return !!this.o.python && existsSync(this.o.python) && existsSync(this.o.script) && this.failures < 3; }
  get isReady() { return this.ready; }

  start() {
    if (this.proc || !this.enabled) return;
    const p = spawn(this.o.python!, ['-I', this.o.script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } });
    this.proc = p;
    createInterface({ input: p.stdout! }).on('line', (line) => {
      let m: Reply & { id?: string; ready?: boolean; translate?: boolean; embed?: boolean; model?: string; dim?: number; log?: string };
      try { m = JSON.parse(line); } catch { return; }
      if (m.log) { this.o.log?.(`nlp: ${m.log}`); return; }
      if (m.ready) {
        this.ready = true; this.failures = 0; this.caps = { translate: !!m.translate, embed: !!m.embed, model: m.model ?? '', dim: m.dim ?? 0 };
        this.o.log?.(`language helpers ready (IndicTrans2 ${m.translate ? 'on' : 'off'}, embeddings ${m.embed ? m.model : 'off'})`);
        for (const w of this.readyWaiters.splice(0)) w();
        return;
      }
      const done = m.id ? this.pending.get(m.id) : undefined;
      if (done) { this.pending.delete(m.id!); done(m); }
    });
    p.stderr!.on('data', () => { /* model warnings */ });
    p.on('exit', (code) => {
      this.o.log?.(`language helpers exited (${code})`);
      this.proc = undefined; this.ready = false; this.failures++;
      for (const [id, done] of this.pending) { this.pending.delete(id); done({ ok: false, error: 'worker exited' }); }
      for (const w of this.readyWaiters.splice(0)) w();
    });
    p.on('error', () => { this.failures = 3; });
  }

  stop() { this.proc?.kill(); }

  waitReady(ms: number) { return this.ready ? Promise.resolve() : Promise.race([new Promise<void>((r) => this.readyWaiters.push(r)), sleep(ms)]); }

  private ask(req: Record<string, unknown>, timeoutMs: number): Promise<Reply> {
    if (!this.ready || !this.proc) return Promise.resolve({ ok: false, error: 'not ready' });
    const id = String(++this.n);
    const reply = new Promise<Reply>((r) => this.pending.set(id, r));
    this.proc.stdin!.write(JSON.stringify({ id, ...req }) + '\n');
    return Promise.race([reply, sleep(timeoutMs).then(() => { this.pending.delete(id); return { ok: false, error: 'timeout' } as Reply; })]);
  }

  async translate(text: string, src: string, timeoutMs = 4000): Promise<{ text?: string; ms: number }> {
    const t0 = Date.now();
    if (!this.caps.translate) return { ms: 0 };
    const r = await this.ask({ op: 'translate', text, src }, timeoutMs);
    return { text: r.ok ? r.text?.trim() || undefined : undefined, ms: Date.now() - t0 };
  }

  async embed(texts: string[], kind: 'query' | 'passage', timeoutMs = 3000): Promise<number[][] | undefined> {
    if (!this.caps.embed || !texts.length) return undefined;
    const r = await this.ask({ op: 'embed', texts, kind }, timeoutMs);
    return r.ok && r.vecs?.length === texts.length ? r.vecs : undefined;
  }
}

/** Her question is in an Indian script IndicTrans2 reads (romanized or English questions are not translated). */
const SCRIPT: Record<string, RegExp> = { or: /[଀-୿]/, hi: /[ऀ-ॿ]/, bn: /[ঀ-৿]/, te: /[ఀ-౿]/ };
export const translatable = (text: string, lang: string) => !!SCRIPT[lang]?.test(text);

export interface HybridResult {
  hits: BookHit[];
  /** what the trace shows */
  note: string;
  /** passages the meaning search added that keyword search missed */
  added: number;
  semantic: boolean;
}

interface PgLike { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; exec(sql: string): Promise<unknown>; close(): Promise<void> }

/** Passages + their meaning vectors in Postgres (pgvector); fused with the Shelf's keyword search. */
export class HybridRag {
  private db?: PgLike;
  /** one table per embedding model (vectors of different models never mix) */
  private table = '';
  private embedded = 0;
  private total = 0;
  private indexing?: Promise<void>;

  constructor(private readonly o: { shelf: Shelf; worker: NlpWorker; dir?: string; log?: (m: string) => void }) {}

  /** share of passages with a vector (meaning search is used once this is 1) */
  get progress() { return this.total ? this.embedded / this.total : 0; }
  get ready() { return !!this.db && !!this.table && this.total > 0 && this.embedded === this.total && this.o.worker.caps.embed; }

  async open() {
    if (this.db) return;
    const { PGlite } = await import('@electric-sql/pglite');
    const { vector } = await import('@electric-sql/pglite-pgvector');
    if (this.o.dir) mkdirSync(this.o.dir, { recursive: true });
    const db = (await PGlite.create(this.o.dir ?? 'memory://', { extensions: { vector } })) as unknown as PgLike;
    await db.exec('create extension if not exists vector;');
    // HNSW looks at ef_search candidates before the language-book filter: enough of them that 20 survive it
    await db.exec('set hnsw.ef_search = 200;');
    this.db = db;
  }

  /** Make sure every passage on the shelf has its row and vector (only changed passages are embedded again). */
  index(): Promise<void> {
    this.indexing ??= this.doIndex().finally(() => { this.indexing = undefined; });
    return this.indexing;
  }

  private async doIndex() {
    await this.open();
    const db = this.db!;
    await this.o.worker.waitReady(180_000);
    const { embed, model, dim } = this.o.worker.caps;
    if (!embed || !dim) { this.o.log?.('hybrid RAG: embeddings unavailable → keyword search only'); return; }
    this.table = `passages_${model.replace(/[^a-z0-9]/gi, '_')}`;
    await db.exec(`
      create table if not exists ${this.table} (
        id text primary key, book_id text not null, ch int not null, page int not null, language_book boolean not null,
        body_hash text not null, emb vector(${dim})
      );
      create index if not exists ${this.table}_emb on ${this.table} using hnsw (emb vector_cosine_ops);`);
    const want = new Map<string, { bookId: string; ch: number; page: number; lang: boolean; text: string; hash: string }>();
    for (const b of this.o.shelf.books.values()) {
      for (const p of b.passages) want.set(p.id, { bookId: b.meta.id, ch: p.ch, page: p.page, lang: b.meta.kind === 'language', text: p.text, hash: createHash('sha1').update(p.text).digest('hex').slice(0, 16) });
    }
    const have = new Map((await db.query<{ id: string; body_hash: string; has: boolean }>(`select id, body_hash, emb is not null as has from ${this.table}`)).rows.map((r) => [r.id, r]));
    for (const id of have.keys()) if (!want.has(id)) await db.query(`delete from ${this.table} where id = $1`, [id]);
    const todo = [...want.entries()].filter(([id, p]) => have.get(id)?.body_hash !== p.hash || !have.get(id)?.has);
    this.total = want.size;
    this.embedded = want.size - todo.length;
    if (!todo.length) { this.o.log?.(`hybrid RAG ready: ${this.total} passages in Postgres + pgvector (${model})`); return; }
    this.o.log?.(`hybrid RAG: embedding ${todo.length} passages with ${model}…`);
    const t0 = Date.now();
    for (let i = 0; i < todo.length; i += 32) {
      const batch = todo.slice(i, i + 32);
      const vecs = await this.o.worker.embed(batch.map(([, p]) => p.text), 'passage', 120_000);
      if (!vecs) { this.o.log?.('hybrid RAG: embedding failed, will retry later'); return; }
      for (let j = 0; j < batch.length; j++) {
        const [id, p] = batch[j]!;
        await db.query(
          `insert into ${this.table} (id, book_id, ch, page, language_book, body_hash, emb) values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (id) do update set book_id = $2, ch = $3, page = $4, language_book = $5, body_hash = $6, emb = $7`,
          [id, p.bookId, p.ch, p.page, p.lang, p.hash, toSql(vecs[j]!)],
        );
      }
      this.embedded += batch.length;
    }
    this.o.log?.(`hybrid RAG ready: ${this.total} passages embedded in ${Math.round((Date.now() - t0) / 1000)} s (Postgres + pgvector, ${model})`);
  }

  /** nearest passages by meaning (cosine similarity, 1 = same meaning) */
  async nearest(vec: number[], opts: { picked?: string[]; limit?: number; only?: string[] }): Promise<{ id: string; sim: number }[]> {
    if (!this.db || !this.table) return [];
    // a language book (stories, poems) shares everyday meaning with everything: only when she picked it;
    // `only`: her board's books
    const r = await this.db.query<{ id: string; sim: number }>(
      `select id, 1 - (emb <=> $1) as sim from ${this.table}
       where emb is not null and (not language_book or book_id = any($2)) and ($4::text[] is null or book_id = any($4))
       order by emb <=> $1 limit $3`,
      [toSql(vec), opts.picked ?? [], opts.limit ?? 20, opts.only ?? null],
    );
    return r.rows.map((x) => ({ id: x.id, sim: Number(x.sim) }));
  }

  /**
   * Keyword + meaning search, fused. `en`: her question in English (IndicTrans2), searched too.
   * Coverage (what the policy trusts) stays the keyword coverage; a passage only the meaning search found counts as
   * grounded only when the meaning search agrees on its chapter (agreedChapter).
   */
  async search(q: string, opts: { picked?: string[]; limit?: number; en?: string; only?: string[] } = {}): Promise<HybridResult> {
    const limit = opts.limit ?? 6;
    const kw = this.o.shelf.search(q, { limit: 20, picked: opts.picked, only: opts.only });
    const kwEn = opts.en ? this.o.shelf.search(opts.en, { limit: 20, picked: opts.picked, only: opts.only }) : [];
    if (!this.ready) return { hits: kw.slice(0, limit), note: 'keyword (BM25) only: vectors not ready', added: 0, semantic: false };
    const vecs = await this.o.worker.embed(opts.en ? [q, opts.en] : [q], 'query');
    if (!vecs) return { hits: kw.slice(0, limit), note: 'keyword (BM25) only: embedder busy', added: 0, semantic: false };
    const near = await Promise.all(vecs.map((v) => this.nearest(v, { picked: opts.picked, limit: 20, only: opts.only })));
    return fuse(this.o.shelf, [
      { w: 1, ids: kw.map((h) => h.passage.id) },
      { w: EN_KEYWORD_WEIGHT, ids: kwEn.map((h) => h.passage.id) },
      { w: 1, ids: near[0]!.map((x) => x.id) },
      { w: EN_MEANING_WEIGHT, ids: (near[1] ?? []).map((x) => x.id) },
    ], [...kw, ...kwEn.map((h) => ({ ...h, coverage: h.coverage * EN_KEYWORD_WEIGHT }))], near.flat(), limit, agreedChapter(this.o.shelf, near[0]!) ?? (near[1] ? agreedChapter(this.o.shelf, near[1]) : undefined));
  }

  async close() { await this.db?.close(); this.db = undefined; }
}

/**
 * When does a meaning-only match count as grounded? Not by its similarity: e5 scores "hello" (0.83) as high as real
 * questions. By agreement: when at least AGREE of the 5 nearest passages sit in one chapter, that chapter is what
 * she asked about (eval: 43 right, 5 wrong, 1 chit-chat of 131; scripts/rag_probe.ts). Its passages then get
 * AGREED_COVERAGE: enough to ground an answer, not enough to show a page for chit-chat (needs 0.75).
 */
export let AGREE = 3;
export const setAgree = (n: number) => { AGREE = n; };
export const AGREED_COVERAGE = 0.5;

export function agreedChapter(shelf: Shelf, near: { id: string }[]): string | undefined {
  const keys = near.slice(0, 5).map((n) => { const p = shelf.passage(n.id); return p ? `${p.bookId}#${p.passage.ch}` : ''; });
  const top = keys[0];
  return top && keys.filter((k) => k === top).length >= AGREE ? top : undefined;
}

export function fuse(shelf: Shelf, lists: { w: number; ids: string[] }[], kwHits: BookHit[], near: { id: string; sim: number }[], limit: number, agreed?: string): HybridResult {
  const cov = new Map<string, number>();
  for (const h of kwHits) cov.set(h.passage.id, Math.max(cov.get(h.passage.id) ?? 0, h.coverage));
  const sim = new Map<string, number>();
  for (const x of near) sim.set(x.id, Math.max(sim.get(x.id) ?? 0, x.sim));
  const rrf = new Map<string, number>();
  for (const l of lists) l.ids.forEach((id, i) => rrf.set(id, (rrf.get(id) ?? 0) + l.w / (RRF_K + i + 1)));
  const kwIds = new Set(kwHits.map((h) => h.passage.id));
  const strong = (kwHits[0]?.coverage ?? 0) >= 0.67;
  const order = strong
    ? [...lists[0]!.ids, ...[...rrf.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)]
    : [...rrf.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const hits: BookHit[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = shelf.passage(id);
    if (!p) continue;
    const coverage = Math.max(cov.get(id) ?? 0, agreed && sim.has(id) && `${p.bookId}#${p.passage.ch}` === agreed ? AGREED_COVERAGE : 0);
    hits.push({ passage: p.passage, bookId: p.bookId, score: Math.round((rrf.get(id) ?? 0) * 10000) / 10, coverage });
    if (hits.length >= limit) break;
  }
  const added = hits.filter((h) => !kwIds.has(h.passage.id)).length;
  const top = hits[0];
  const s = top ? sim.get(top.passage.id) : undefined;
  return { hits, added, semantic: true, note: top ? `hybrid${strong ? ' (keyword-led)' : ' (fused)'}: best ${top.passage.id} coverage ${top.coverage}${s ? ` · meaning ${s.toFixed(2)}` : ''}${agreed ? ` · meaning agrees on ${agreed}` : ''}${added ? ` · +${added} by meaning only` : ''}` : 'nothing' };
}

const toSql = (v: number[]) => `[${v.join(',')}]`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());
export const ragDir = (dataDir: string) => join(dataDir, 'pg');

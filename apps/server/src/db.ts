// Event store (PLAN §5.6, §8.5). Append-only, deduped by event id; serverSeq is the sync cursor.

import Database from 'better-sqlite3';
import { canonicalOrder, type AnyEvent, type TraceStep } from '@setu/core';

export class Store {
  readonly db: Database.Database;

  constructor(path = ':memory:') {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        server_seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        profile_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        item_version TEXT,
        received_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_profile ON events(profile_id, server_seq);
      CREATE TABLE IF NOT EXISTS devices (token TEXT PRIMARY KEY, device_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        step TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gen_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS classes (
        code TEXT PRIMARY KEY, name TEXT NOT NULL, lang TEXT NOT NULL, token_hash TEXT NOT NULL,
        exam_date INTEGER, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS teacher_acks (
        class_code TEXT NOT NULL, ref TEXT NOT NULL, action TEXT NOT NULL, body TEXT, at INTEGER NOT NULL,
        PRIMARY KEY (class_code, ref)
      );
      CREATE TABLE IF NOT EXISTS reviews (
        lang TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL, text TEXT, note TEXT, audio TEXT, by TEXT, at INTEGER NOT NULL,
        PRIMARY KEY (lang, id)
      );
    `);
    // the tutor chat (PLAN v4): her memory per profile (mastery per chapter, the open check) and the conversation itself
    this.db.exec('CREATE TABLE IF NOT EXISTS tutor_state (profile_id TEXT PRIMARY KEY, state TEXT NOT NULL, at INTEGER NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS tutor_log (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL, at INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, meta TEXT)');
    this.db.exec('CREATE INDEX IF NOT EXISTS tutor_log_profile ON tutor_log(profile_id, id)');
    // tier C home languages (Kui, Ho…): the sentences the model wrote, for a speaker to approve or fix at /#review=<lang>
    this.db.exec('CREATE TABLE IF NOT EXISTS home_lines (lang TEXT NOT NULL, id TEXT NOT NULL, src TEXT NOT NULL, home TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (lang, id))');
    this.db.exec('CREATE TABLE IF NOT EXISTS grants (profile_id TEXT NOT NULL, device_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (profile_id, device_id))');
    // P4.4: which turn wrote an event (added after the first schema; old databases get the column here)
    if (!(this.db.prepare('PRAGMA table_info(events)').all() as { name: string }[]).some((c) => c.name === 'turn')) this.db.exec('ALTER TABLE events ADD COLUMN turn TEXT');
    // retention for teachers too: when the teacher last opened the class
    if (!(this.db.prepare('PRAGMA table_info(classes)').all() as { name: string }[]).some((c) => c.name === 'last_used')) this.db.exec('ALTER TABLE classes ADD COLUMN last_used INTEGER');
  }

  /** Idempotent append. Returns how many were new. */
  append(events: AnyEvent[], now = Date.now()): number {
    const ins = this.db.prepare(`INSERT OR IGNORE INTO events (id, profile_id, device_id, seq, ts, type, payload, item_version, turn, received_at)
      VALUES (@id, @profileId, @deviceId, @seq, @ts, @type, @payload, @itemVersion, @turn, @now)`);
    let n = 0;
    const tx = this.db.transaction((evs: AnyEvent[]) => {
      for (const e of evs) n += ins.run({ ...e, payload: JSON.stringify(e.payload), itemVersion: e.itemVersion ?? null, turn: e.turn ? JSON.stringify(e.turn) : null, now }).changes;
    });
    tx(events);
    return n;
  }

  events(profileId: string): AnyEvent[] {
    return canonicalOrder(this.db.prepare('SELECT * FROM events WHERE profile_id = ? ORDER BY server_seq').all(profileId).map(row));
  }

  /** Events with server_seq > cursor (what the phone has not seen yet). */
  /** `limit` keeps one reply small (P4.3: a turn stays under 30 KB); the rest comes with the next sync. */
  since(profileId: string, cursor: number, limit = 100_000): { events: AnyEvent[]; cursor: number } {
    const rows = this.db.prepare('SELECT * FROM events WHERE profile_id = ? AND server_seq > ? ORDER BY server_seq LIMIT ?').all(profileId, cursor, limit) as any[];
    return { events: rows.map(row), cursor: rows.length ? rows[rows.length - 1].server_seq : cursor };
  }

  /**
   * Retention (P5.21, PLAN §10.6): decision traces (they quote what she asked) are kept 90 days; a learner silent for a
   * year has her whole server copy removed — events, traces, device grants. Her phone keeps its own copy.
   * Teachers alike: notes a teacher wrote are cleared after 90 days, and a class the teacher has not opened for a year
   * is removed with its notes, home-language words and alert subscription. Its learners keep their own records.
   */
  prune(now = Date.now(), traceDays = 90, profileDays = 365): { traces: number; profiles: string[]; classes: string[] } {
    const DAY = 86_400_000;
    const traces = this.db.prepare('DELETE FROM traces WHERE at < ?').run(now - traceDays * DAY).changes;
    // the chat quotes her words too: same 90 days
    this.db.prepare('DELETE FROM tutor_log WHERE at < ?').run(now - traceDays * DAY);
    const stale = (this.db.prepare('SELECT profile_id, MAX(received_at) AS last FROM events GROUP BY profile_id HAVING last < ?').all(now - profileDays * DAY) as any[]).map((r) => r.profile_id as string);
    const tx = this.db.transaction((ids: string[]) => {
      for (const id of ids) for (const t of ['events', 'traces', 'grants', 'tutor_state', 'tutor_log', ...(push ? ['push_subs'] : [])]) this.db.prepare(`DELETE FROM ${t} WHERE profile_id = ?`).run(id);
    });
    // reminder subscriptions live in a table the Push module creates (absent when push is off)
    const push = !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'push_subs'").get();
    tx(stale);
    this.db.prepare('UPDATE teacher_acks SET body = NULL WHERE at < ? AND body IS NOT NULL').run(now - traceDays * DAY);
    const classes = (this.db.prepare('SELECT code FROM classes WHERE COALESCE(last_used, created_at) < ?').all(now - profileDays * DAY) as any[]).map((r) => r.code as string);
    this.db.transaction((codes: string[]) => {
      for (const code of codes) {
        this.db.prepare('DELETE FROM teacher_acks WHERE class_code = ?').run(code);
        this.db.prepare('DELETE FROM gen_cache WHERE key IN (?, ?)').run(`anchors:${code}`, `region:${code}`);
        if (push) this.db.prepare('DELETE FROM push_subs WHERE profile_id = ?').run(`class:${code}`);
        this.db.prepare('DELETE FROM classes WHERE code = ?').run(code);
      }
    })(classes);
    return { traces, profiles: stale, classes };
  }

  tutorState<T>(profileId: string): T | undefined {
    const r = this.db.prepare('SELECT state FROM tutor_state WHERE profile_id = ?').get(profileId) as any;
    return r ? (JSON.parse(r.state) as T) : undefined;
  }
  setTutorState(profileId: string, state: unknown, at = Date.now()) {
    this.db.prepare('INSERT OR REPLACE INTO tutor_state (profile_id, state, at) VALUES (?, ?, ?)').run(profileId, JSON.stringify(state), at);
  }
  logTutor(profileId: string, role: 'student' | 'tutor', text: string, meta?: unknown, at = Date.now()) {
    this.db.prepare('INSERT INTO tutor_log (profile_id, at, role, text, meta) VALUES (?, ?, ?, ?, ?)').run(profileId, at, role, text, meta === undefined ? null : JSON.stringify(meta));
  }
  tutorLog(profileId: string, limit = 50): { at: number; role: 'student' | 'tutor'; text: string; meta?: any }[] {
    const rows = this.db.prepare('SELECT * FROM tutor_log WHERE profile_id = ? ORDER BY id DESC LIMIT ?').all(profileId, limit) as any[];
    return rows.reverse().map((r) => ({ at: r.at, role: r.role, text: r.text, ...(r.meta ? { meta: JSON.parse(r.meta) } : {}) }));
  }

  profiles(): string[] {
    return (this.db.prepare('SELECT DISTINCT profile_id FROM events').all() as any[]).map((r) => r.profile_id);
  }

  addTrace(profileId: string, step: TraceStep, at = Date.now()) {
    const r = this.db.prepare('INSERT INTO traces (profile_id, at, step) VALUES (?, ?, ?)').run(profileId, at, JSON.stringify(step));
    return Number(r.lastInsertRowid);
  }

  traces(limit = 200, profileId?: string) {
    const rows = (profileId
      ? this.db.prepare('SELECT * FROM traces WHERE profile_id = ? ORDER BY id DESC LIMIT ?').all(profileId, limit)
      : this.db.prepare('SELECT * FROM traces ORDER BY id DESC LIMIT ?').all(limit)) as any[];
    return rows.reverse().map((r) => ({ id: r.id, profileId: r.profile_id, at: r.at, ...JSON.parse(r.step) }));
  }

  cacheGet(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM gen_cache WHERE key = ?').get(key) as any)?.value;
  }
  cacheSet(key: string, value: string) {
    this.db.prepare('INSERT OR REPLACE INTO gen_cache (key, value, at) VALUES (?, ?, ?)').run(key, value, Date.now());
  }

  // ---- classes (teacher view, PLAN §9.2, §10.7) ----
  createClass(c: { code: string; name: string; lang: string; tokenHash: string }) {
    this.db.prepare('INSERT INTO classes (code, name, lang, token_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(c.code, c.name, c.lang, c.tokenHash, Date.now());
  }
  classByCode(code: string): ClassRow | undefined {
    return classRow(this.db.prepare('SELECT * FROM classes WHERE code = ?').get(code));
  }
  classByToken(tokenHash: string): ClassRow | undefined {
    return classRow(this.db.prepare('SELECT * FROM classes WHERE token_hash = ?').get(tokenHash));
  }
  /** the teacher opened the class: keeps it from the one-year clean-up */
  touchClass(code: string, now = Date.now()) {
    this.db.prepare('UPDATE classes SET last_used = ? WHERE code = ?').run(now, code);
  }
  setExamDate(code: string, examDate: number | null) {
    this.db.prepare('UPDATE classes SET exam_date = ? WHERE code = ?').run(examDate, code);
  }
  /**
   * May this device read/write this profile? Yes for a new profile, a profile it has written to, or one granted to it
   * (operator restore). A profile id alone is not enough to read someone's record.
   */
  canUse(profileId: string, deviceId: string): boolean {
    if (!this.db.prepare('SELECT 1 FROM events WHERE profile_id = ? LIMIT 1').get(profileId)) return true;
    return !!this.db.prepare('SELECT 1 FROM events WHERE profile_id = ? AND device_id = ? LIMIT 1').get(profileId, deviceId)
      || !!this.db.prepare('SELECT 1 FROM grants WHERE profile_id = ? AND device_id = ?').get(profileId, deviceId);
  }
  grant(profileId: string, deviceId: string) {
    this.db.prepare('INSERT OR REPLACE INTO grants (profile_id, device_id, at) VALUES (?, ?, ?)').run(profileId, deviceId, Date.now());
  }
  /** profiles whose latest CLASS_JOINED names this class */
  classMembers(code: string): { profileId: string; displayName?: string; joinedAt: number }[] {
    const rows = this.db.prepare("SELECT profile_id, payload, ts FROM events WHERE type = 'CLASS_JOINED' ORDER BY server_seq").all() as any[];
    const last = new Map<string, { classCode: string; displayName?: string; ts: number }>();
    for (const r of rows) last.set(r.profile_id, { ...JSON.parse(r.payload), ts: r.ts });
    return [...last].filter(([, j]) => j.classCode === code).map(([profileId, j]) => ({ profileId, displayName: j.displayName, joinedAt: j.ts }));
  }
  /** the class(es) a learner is in now (her latest CLASS_JOINED) */
  classesOf(profileId: string): string[] {
    const r = this.db.prepare("SELECT payload FROM events WHERE type = 'CLASS_JOINED' AND profile_id = ? ORDER BY server_seq DESC LIMIT 1").get(profileId) as { payload: string } | undefined;
    const code = r ? (JSON.parse(r.payload) as { classCode?: string }).classCode : undefined;
    return code ? [code] : [];
  }
  ack(code: string, ref: string, action: string, body?: string) {
    this.db.prepare('INSERT OR REPLACE INTO teacher_acks (class_code, ref, action, body, at) VALUES (?, ?, ?, ?, ?)').run(code, ref, action, body ?? null, Date.now());
  }
  /** native-review decisions (TODO D6): one row per reviewed line, last decision wins */
  review(lang: string, id: string, d: { status: string; text?: string; note?: string; audio?: string; by?: string }) {
    this.db.prepare('INSERT OR REPLACE INTO reviews (lang, id, status, text, note, audio, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(lang, id, d.status, d.text ?? null, d.note ?? null, d.audio ?? null, d.by ?? null, Date.now());
  }
  reviews(lang: string): Record<string, { status: string; text?: string; note?: string; audio?: string; by?: string; at: number }> {
    const rows = this.db.prepare('SELECT * FROM reviews WHERE lang = ? ORDER BY id').all(lang) as any[];
    return Object.fromEntries(rows.map((r) => [r.id, Object.fromEntries(Object.entries({ status: r.status, text: r.text, note: r.note, audio: r.audio, by: r.by, at: r.at }).filter(([, v]) => v !== null))]));
  }
  homeLine(lang: string, id: string, src: string, home: string) {
    this.db.prepare('INSERT OR IGNORE INTO home_lines (lang, id, src, home, at) VALUES (?, ?, ?, ?, ?)').run(lang, id, src, home, Date.now());
  }
  homeLines(lang: string, limit = 500): { id: string; src: string; home: string; at: number }[] {
    return this.db.prepare('SELECT id, src, home, at FROM home_lines WHERE lang = ? ORDER BY at DESC LIMIT ?').all(lang, limit) as any[];
  }
  /** the lines a speaker approved (✓) or fixed (✎), as written by the speaker */
  homeApproved(lang: string): { src: string; home: string }[] {
    return (this.db.prepare("SELECT h.src, CASE WHEN r.status = 'fixed' THEN r.text ELSE h.home END AS home FROM home_lines h JOIN reviews r ON r.lang = h.lang AND r.id = h.id WHERE h.lang = ? AND r.status IN ('ok', 'fixed') AND (r.status = 'ok' OR r.text IS NOT NULL)").all(lang) as any[]);
  }
  /** teacher decisions on LLM-proposed misconceptions, across classes (input for the next pack revision) */
  candidateAcks(action: string): { classCode: string; ref: string; at: number }[] {
    return (this.db.prepare("SELECT class_code, ref, at FROM teacher_acks WHERE ref LIKE 'cand:%' AND action = ? ORDER BY at").all(action) as any[])
      .map((r) => ({ classCode: r.class_code, ref: r.ref, at: r.at }));
  }
  acks(code: string): Map<string, { action: string; body?: string; at: number }> {
    const rows = this.db.prepare('SELECT * FROM teacher_acks WHERE class_code = ?').all(code) as any[];
    return new Map(rows.map((r) => [r.ref, { action: r.action, body: r.body ?? undefined, at: r.at }]));
  }

  registerDevice(token: string, deviceId: string) {
    this.db.prepare('INSERT OR IGNORE INTO devices (token, device_id, created_at) VALUES (?, ?, ?)').run(token, deviceId, Date.now());
  }
  deviceFor(token: string): string | undefined {
    return (this.db.prepare('SELECT device_id FROM devices WHERE token = ?').get(token) as any)?.device_id;
  }
}

export interface ClassRow { code: string; name: string; lang: string; examDate?: number; createdAt: number }
function classRow(r: any): ClassRow | undefined {
  return r ? { code: r.code, name: r.name, lang: r.lang, examDate: r.exam_date ?? undefined, createdAt: r.created_at } : undefined;
}

function row(r: any): AnyEvent {
  return {
    id: r.id, profileId: r.profile_id, deviceId: r.device_id, seq: r.seq, ts: r.ts, type: r.type,
    payload: JSON.parse(r.payload), ...(r.item_version ? { itemVersion: r.item_version } : {}), ...(r.turn ? { turn: JSON.parse(r.turn) } : {}),
  } as AnyEvent;
}

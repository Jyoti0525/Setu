// Optional Web Push (TODO P4.31, PLAN §9.1): opt-in on the phone; one generic line ("your next lesson is ready"),
// never her name, scores or what she asked; quiet hours 21:00–07:00 IST; at most one a day.
import webpush, { type PushSubscription } from 'web-push';
import type { Store } from './db.ts';

/** IST hours when nothing is sent (a phone buzzing at night is a family matter, not a learning one). */
export const QUIET = { from: 21, to: 7 };
export const MIN_GAP_MS = 20 * 3600_000;
const IST_OFFSET_MIN = 330;

const LINES: Record<string, string> = {
  or: 'ତୁମ ପରବର୍ତ୍ତୀ ପାଠ ପ୍ରସ୍ତୁତ।',
  en: 'Your next lesson is ready.',
  hi: 'तुम्हारा अगला पाठ तैयार है।',
};

export const quietNow = (now: number) => {
  const h = Math.floor((((now / 60_000 + IST_OFFSET_MIN) % 1440) + 1440) % 1440 / 60);
  return h >= QUIET.from || h < QUIET.to;
};

type Send = (sub: PushSubscription, payload: string) => Promise<unknown>;

export class Push {
  private readonly keys: { publicKey: string; privateKey: string };
  private readonly send: Send;
  constructor(private readonly store: Store, opts: { subject?: string; send?: Send } = {}) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY, device_id TEXT NOT NULL, profile_id TEXT NOT NULL, sub TEXT NOT NULL, lang TEXT NOT NULL, last_sent INTEGER NOT NULL DEFAULT 0)`);
    // VAPID keys: made once, kept with the server's data (no account, no third party)
    const saved = store.cacheGet('vapid');
    this.keys = saved ? JSON.parse(saved) : webpush.generateVAPIDKeys();
    if (!saved) store.cacheSet('vapid', JSON.stringify(this.keys));
    const subject = opts.subject ?? 'mailto:setu@localhost';
    this.send = opts.send ?? ((sub, payload) => webpush.sendNotification(sub, payload, { vapidDetails: { subject, ...this.keys }, TTL: 12 * 3600 }));
  }

  get publicKey() { return this.keys.publicKey; }

  subscribe(deviceId: string, profileId: string, sub: PushSubscription, lang: string) {
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys.auth) return false;
    this.store.db.prepare('INSERT OR REPLACE INTO push_subs (endpoint, device_id, profile_id, sub, lang, last_sent) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT last_sent FROM push_subs WHERE endpoint = ?), 0))')
      .run(sub.endpoint, deviceId, profileId, JSON.stringify(sub), LINES[lang] ? lang : 'en', sub.endpoint);
    return true;
  }

  unsubscribe(deviceId: string, endpoint: string) {
    this.store.db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND device_id = ?').run(endpoint, deviceId);
  }

  /** After the between-session run prepared her next session. Returns what happened, for the trace/tests. */
  async lessonReady(profileId: string, now = Date.now()): Promise<'sent' | 'quiet' | 'recent' | 'none'> {
    const subs = this.store.db.prepare('SELECT * FROM push_subs WHERE profile_id = ?').all(profileId) as { endpoint: string; sub: string; lang: string; last_sent: number }[];
    if (!subs.length) return 'none';
    if (quietNow(now)) return 'quiet';
    let sent = false;
    for (const s of subs) {
      if (now - s.last_sent < MIN_GAP_MS) continue;
      try {
        await this.send(JSON.parse(s.sub), JSON.stringify({ title: 'Setu', body: LINES[s.lang] ?? LINES.en, url: '/' }));
        this.store.db.prepare('UPDATE push_subs SET last_sent = ? WHERE endpoint = ?').run(now, s.endpoint);
        sent = true;
      } catch (e) {
        // the phone unsubscribed or the browser dropped it → forget it
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) this.store.db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint);
      }
    }
    return sent ? 'sent' : 'recent';
  }
}

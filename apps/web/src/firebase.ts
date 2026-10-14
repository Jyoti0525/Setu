// Sign-in (Firebase Authentication), loaded only when the server has it set up: the config comes from
// /api/auth/config at run time (kept on the phone for offline starts), and the Firebase code (~100 KB) is fetched
// only then. No config, no network on the first start: Setu works with no account, as before.
import type { Auth } from 'firebase/auth';
import { fetchWithTimeout, setIdToken } from './net.ts';
import { getMeta, setMeta } from './db.ts';

interface WebConfig { apiKey: string; authDomain: string; projectId: string; appId?: string }

let ready: Promise<Auth | null> | null = null;

/** Firebase Auth, or null when sign-in is not set up (or never reached while online). */
export function getAuthOnce(): Promise<Auth | null> {
  ready ??= (async () => {
    let cfg = await getMeta<WebConfig | null>('authConfig', null);
    try {
      const r = await fetchWithTimeout('/api/auth/config', {}, 5000);
      if (r.ok) { const j = (await r.json()) as Partial<WebConfig>; cfg = j.apiKey && j.projectId && j.authDomain ? (j as WebConfig) : null; await setMeta('authConfig', cfg); }
    } catch { /* offline: the config kept from last time */ }
    if (!cfg) return null;
    const [{ initializeApp, getApps }, { getAuth }] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
    const auth = getAuth(getApps()[0] ?? initializeApp(cfg));
    setIdToken(async () => (auth.currentUser ? auth.currentUser.getIdToken() : null));
    return auth;
  })();
  return ready;
}

// Real connectivity detection (PLAN §8.1): active probe + timeouts + rolling RTT, not navigator.onLine.

import type { Tier } from '@setu/core';

const rtts: number[] = [];
let failures = 0;
let lastProbe = 0;
let tier: Tier = 'device';
let health: unknown = null;
/** The server's last /api/health answer (what it can do right now: e.g. speech-to-text per language). */
export const lastHealth = () => health;
const listeners = new Set<(t: Tier) => void>();

export const currentTier = () => tier;
export const onTier = (f: (t: Tier) => void) => { listeners.add(f); return () => listeners.delete(f); };

function setTier(t: Tier) {
  if (t !== tier) { tier = t; listeners.forEach((f) => f(t)); }
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); } finally { clearTimeout(timer); }
}

export async function probe(): Promise<Tier> {
  lastProbe = Date.now();
  const t0 = performance.now();
  try {
    const r = await fetchWithTimeout('/api/health?lite=1', { cache: 'no-store' }, 4000);
    if (!r.ok) throw new Error(String(r.status));
    health = await r.json().catch(() => health);
    rtts.push(performance.now() - t0);
    if (rtts.length > 5) rtts.shift();
    failures = 0;
  } catch {
    failures++;
  }
  const avg = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : Infinity;
  setTier(failures >= 1 ? 'device' : avg > 1500 ? 'weak' : 'cloud');
  return tier;
}

/** Record the outcome of a real request so the tier tracks reality between probes. */
export function report(ok: boolean, ms: number) {
  if (ok) { rtts.push(ms); if (rtts.length > 5) rtts.shift(); failures = 0; setTier(ms > 1500 ? 'weak' : 'cloud'); }
  else { failures++; setTier('device'); }
}

export const probeIfStale = () => (Date.now() - lastProbe > 15_000 ? probe() : Promise.resolve(tier));

export function startProbing() {
  void probe();
  setInterval(() => void probe(), 20_000);
  addEventListener('online', () => void probe());
  addEventListener('offline', () => void probe());
}

/**
 * P4.12: big one-time downloads (voice clips, offline OCR) wait for a good link — no data saver, and Wi-Fi or a 4G
 * signal when the browser can tell. Unknown → yes (most browsers do not say).
 */
export function goodLink(): boolean {
  const c = (navigator as { connection?: { saveData?: boolean; type?: string; effectiveType?: string } }).connection;
  if (!c) return true;
  if (c.saveData) return false;
  if (c.type === 'wifi' || c.type === 'ethernet') return true;
  if (c.type === 'cellular' && c.effectiveType && c.effectiveType !== '4g') return false;
  return !c.effectiveType || c.effectiveType === '4g';
}

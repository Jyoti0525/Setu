// Opt-in lesson reminders (TODO P4.31). Off unless she turns them on; the server sends only "your next lesson is ready".
import { fetchWithTimeout } from './net.ts';
import type { Device } from './agent.ts';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const b64 = (s: string) => {
  const p = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};

export async function pushOn(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

export async function enablePush(device: Device, profileId: string, lang: string): Promise<boolean> {
  if (!pushSupported() || (await Notification.requestPermission()) !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const key = (await (await fetchWithTimeout('/api/push/key', { headers: { 'x-device-token': device.token } }, 6000)).json()) as { key?: string };
    if (!key.key) return false;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key.key) });
    const r = await fetchWithTimeout('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': device.token }, body: JSON.stringify({ profileId, sub: sub.toJSON(), lang }) }, 6000);
    return r.ok;
  } catch { return false; }
}

export async function disablePush(device: Device): Promise<void> {
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (!sub) return;
  await sub.unsubscribe();
  try { await fetchWithTimeout('/api/push/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': device.token }, body: JSON.stringify({ endpoint: sub.endpoint }) }, 6000); } catch { /* offline: the server forgets it on the next failed send */ }
}

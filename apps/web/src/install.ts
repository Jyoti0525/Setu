// Install Setu on the phone (P4.21, P7.6): Chrome on Android offers its own install sheet once the PWA qualifies
// (HTTPS, manifest with PNG icons, service worker); we keep that offer and show it as a button in her language.
// Safari on iPhone has no such event: the button there explains Share → Add to Home Screen.
// Imported first in main.tsx, so the event is caught even if it fires before the chat screen is drawn.

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
export type InstallState = 'installed' | 'prompt' | 'ios' | 'none';

let deferred: Prompt | null = null;
let installedNow = false;
const subs = new Set<(s: InstallState) => void>();
const tell = () => { const s = installState(); subs.forEach((f) => f(s)); };

addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as Prompt; tell(); });
addEventListener('appinstalled', () => { deferred = null; installedNow = true; tell(); });

const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const iosSafari = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

export function installState(): InstallState {
  if (installedNow || standalone()) return 'installed';
  if (deferred) return 'prompt';
  if (iosSafari()) return 'ios';
  return 'none';
}

export function onInstall(f: (s: InstallState) => void): () => void { subs.add(f); return () => void subs.delete(f); }

/** Shows the browser's install sheet; true when she installed it. */
export async function install(): Promise<boolean> {
  const p = deferred;
  if (!p) return false;
  deferred = null;
  await p.prompt();
  const { outcome } = await p.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  if (outcome === 'accepted') installedNow = true;
  tell();
  return outcome === 'accepted';
}

// Pre-recorded voice (PLAN §10.2 step 2, TODO P3.8): most phones have no Odia system voice, so fixed lines
// ship as small Opus clips keyed by their exact text; AI-written replies are recorded by the server (/voice/…).
// Missing clip (or offline and not cached) → device voice.
import { audioKey } from '@setu/core';
import { goodLink } from './net.ts';

/** P4.29: today's data is nearly used up → no new sound downloads (shipped clips already cached still play). */
let textOnly = false;
export const setTextOnly = (on: boolean) => { textOnly = on; };

/** P4.2: sound downloads count toward her data budget like turns do — only bytes that came over the network. */
let pendingBytes = 0;
/** Bytes downloaded since the last call (the app records them as one DATA_USED event). */
export const takeAudioBytes = () => { const b = pendingBytes; pendingBytes = 0; return b; };
const cached = async (url: string) => { try { return !!(await caches.match(url)); } catch { return false; } };
/** fetch that counts what was not already on the phone */
async function fetchCounted(url: string): Promise<Response> {
  const had = await cached(url);
  const r = await fetch(url);
  if (had || !r.ok) return r;
  const b = await r.clone().blob();
  pendingBytes += b.size;
  return r;
}

type Index = { clips: Record<string, number>; essential: string[] };
const indexes = new Map<string, Promise<Index | null>>();
let playing: HTMLAudioElement | null = null;

function index(lang: string): Promise<Index | null> {
  let p = indexes.get(lang);
  if (!p) {
    p = fetch(`/audio/${lang}/index.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    indexes.set(lang, p);
    void p.then((x) => { if (!x) indexes.delete(lang); }); // try again later (e.g. back online)
  }
  return p;
}

/** Languages the server records replies in (others have device voices). */
// Ho, Kuvi, Munda: her home-language sentence (🏠 card), in their own MMS voices
const LIVE = new Set(['or', 'hi', 'hoc', 'kxv', 'unr']);
const liveUrl = (text: string, lang: string) => `/voice/${lang}/${audioKey(text)}.ogg`;

/** Plays the recorded clip for this exact text if there is one; false → caller uses the device voice. */
export async function playClip(text: string, lang: string): Promise<boolean> {
  if (!text.trim()) return false;
  const ix = await index(lang);
  const key = audioKey(text);
  // shipped clip, else the server's recording of an AI-written line (cached once played or warmed)
  const url = ix?.clips[key] ? `/audio/${lang}/${key}.ogg` : LIVE.has(lang) && !textOnly ? liveUrl(text, lang) : null;
  if (!url) return false;
  try {
    playing?.pause();
    let r = await fetchCounted(url);
    // not recorded yet (a fixed line, an older reply): ask the server to record it, then fetch it (it waits ~15 s)
    if (r.status === 404 && url.startsWith('/voice/') && navigator.onLine) {
      const q = await fetch('/voice/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, lang }) }).catch(() => null);
      if (q?.ok) r = await fetchCounted(url);
    }
    if (!r.ok) return false;
    const src = URL.createObjectURL(await r.blob());
    playing = new Audio(src);
    playing.onended = () => URL.revokeObjectURL(src);
    await playing.play();
    return true;
  } catch { return false; }
}

const warmed = new Set<string>();
/**
 * Fetch the server's recording of AI-written lines now (≈ 2 KB per second of speech) so they also play later
 * offline — pre-written explanations and answered doubts are read when there may be no signal.
 */
export async function warmVoice(texts: (string | undefined)[], lang: string) {
  if (!LIVE.has(lang) || !navigator.onLine || textOnly || !goodLink()) return;
  const ix = await index(lang);
  for (const t of texts) {
    if (!t?.trim() || ix?.clips[audioKey(t)] || warmed.has(t)) continue;
    warmed.add(t);
    try { await fetchCounted(liveUrl(t, lang)); } catch { warmed.delete(t); break; }
  }
}

export function stopClip() { playing?.pause(); playing = null; }

/** Fetch the engine's own lines once (≈ 200 KB) so retake tips, feedback and prompts speak offline too. */
export async function prefetchEssential(lang: string): Promise<number> {
  const ix = await index(lang);
  if (!ix || textOnly || !goodLink()) return 0;
  let n = 0;
  for (const k of ix.essential) {
    try { if ((await fetchCounted(`/audio/${lang}/${k}.ogg`)).ok) n++; } catch { break; }
  }
  return n;
}

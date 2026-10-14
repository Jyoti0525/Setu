// Speech in on the phone (TODO P3.1–P3.7, PLAN §10.1, §8.1). One 🎤 button, a chain behind it:
//   online + server can transcribe → record (Opus, 16 kbps) → /api/listen (Gemini audio → IndicConformer → Sarvam)
//   online, server cannot          → Chrome Web Speech (or-IN / en-IN / hi-IN), live
//   offline                        → record and keep it; transcribed and answered when the signal is back
//   no microphone at all           → the keyboard's own mic (Gboard voice typing) into the text box
// The recording is deleted as soon as it has been transcribed (P5.21).

import { db } from './db.ts';
import { fetchWithTimeout, lastHealth } from './net.ts';
import type { Device } from './agent.ts';

export const MAX_SECONDS = 30;

const TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];

export const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export interface Recording { stop(): Promise<Blob>; cancel(): void }

/** Starts recording; stops by itself after MAX_SECONDS. Throws if the microphone is unavailable or refused. */
export async function record(onAutoStop?: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
  const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 16_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<Blob>((res) => { rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); res(new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' })); }; });
  rec.start(1000);
  const timer = setTimeout(() => { if (rec.state === 'recording') { rec.stop(); onAutoStop?.(); } }, MAX_SECONDS * 1000);
  return {
    stop: () => { clearTimeout(timer); if (rec.state === 'recording') rec.stop(); return done; },
    cancel: () => { clearTimeout(timer); chunks.length = 0; if (rec.state === 'recording') rec.stop(); },
  };
}

/** Does the server have a speech-to-text step for this language right now? (from the last health probe) */
export const serverListens = (lang: string) => !!(lastHealth() as { listen?: Record<string, boolean> } | null)?.listen?.[lang];

const b64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export type Heard = { text: string; provider: string } | { error: string; tried?: string[] } | null;

/** Server transcription. null = could not reach the server (keep the recording); {error} = it tried and failed. */
export async function transcribe(device: Device, audio: Blob, lang: string): Promise<Heard> {
  try {
    const body = JSON.stringify({ audio: await b64(audio), mime: audio.type || 'audio/webm', lang });
    const r = await fetchWithTimeout('/api/listen', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': device.token }, body }, 25_000);
    if (r.status === 503 || r.status === 400) return (await r.json().catch(() => ({ error: 'failed' }))) as Heard;
    if (!r.ok) return null;
    return (await r.json()) as Heard;
  } catch { return null; }
}

// ---- Chrome Web Speech (live; needs the network on Android) ----
type SR = { lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean; start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
const SRClass = () => ((window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition);
export const hasWebSpeech = () => !!SRClass();

/** One utterance through the browser's recogniser. Resolves '' when nothing was understood. */
export function webSpeech(lang: string): { result: Promise<string>; stop: () => void } {
  const C = SRClass()!;
  const r = new C();
  r.lang = ({ or: 'or-IN', en: 'en-IN', hi: 'hi-IN' } as Record<string, string>)[lang] ?? lang;
  r.interimResults = false; r.maxAlternatives = 1; r.continuous = false;
  let text = '';
  const result = new Promise<string>((res) => {
    r.onresult = (e) => { text = Array.from(e.results).map((x) => x[0]?.transcript ?? '').join(' ').trim(); };
    r.onerror = () => res('');
    r.onend = () => res(text);
  });
  r.start();
  return { result, stop: () => r.stop() };
}

// ---- store-and-forward (P3.7) ----
export async function keepVoice(profileId: string, doubtId: string, audio: Blob) {
  await db.voices.put({ doubtId, profileId, at: Date.now(), audio });
}
export const queuedVoices = (profileId: string) => db.voices.where('profileId').equals(profileId).toArray();
export const dropVoice = (doubtId: string) => db.voices.delete(doubtId);

// Snap-to-Learn on the phone (PLAN §6.8). Online: the server's vision model reads the photo. Offline: Tesseract
// `ori` on the phone — its text is only used to LOCATE the passage in the pack (the engine teaches clean pack text).
// Photos are never kept after processing; a photo is stored only when she asks to keep it for later.

import { db, getMeta, setMeta } from './db.ts';
import { fetchWithTimeout } from './net.ts';
import type { Device } from './agent.ts';

const OCR = () => `${location.origin}/ocr`;

/** Downscale (and for OCR, greyscale) so a 2 GB phone does not run out of memory and uploads stay small. */
export async function shrink(file: Blob, maxSide: number, quality: number, grey = false): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d')!;
  if (grey) g.filter = 'grayscale(1) contrast(1.3)';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', quality));
}

const b64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Online: vision model on the server. Returns undefined when it cannot (offline, no provider) — then OCR. */
export async function readOnline(device: Device, file: Blob): Promise<{ text: string; kb: number } | undefined> {
  try {
    const img = await shrink(file, 1280, 0.7);
    const body = JSON.stringify({ image: await b64(img), mime: 'image/jpeg' });
    const r = await fetchWithTimeout('/api/snap/read', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': device.token }, body }, 25000);
    if (!r.ok) return undefined;
    const j = (await r.json()) as { text: string };
    return { text: j.text ?? '', kb: Math.ceil(body.length / 1024) };
  } catch { return undefined; }
}

export const ocrReady = () => getMeta<boolean>('ocrReady', false);

type TWorker = { recognize: (img: Blob) => Promise<{ data: { text: string; confidence: number } }>; terminate: () => Promise<unknown> };
async function worker(onProgress?: (p: number) => void): Promise<TWorker> {
  const { createWorker } = await import('tesseract.js');
  return (await createWorker('ori', 1 /* LSTM only */, {
    workerPath: `${OCR()}/worker.min.js`, corePath: OCR(), langPath: OCR(), gzip: true,
    workerBlobURL: false, // load from our origin so the service worker serves it offline
    logger: (m: { progress: number }) => onProgress?.(m.progress),
  })) as unknown as TWorker;
}

/** One-time download of offline photo reading (~3 MB; asks first — data is money). */
export async function downloadOcr(onProgress?: (p: number) => void): Promise<boolean> {
  try {
    const w = await worker(onProgress);
    await w.terminate();
    await setMeta('ocrReady', true);
    return true;
  } catch { return false; }
}

/** Offline: OCR on the phone. The worker is started per photo and stopped after (memory on a 2 GB phone). */
export async function readOffline(file: Blob): Promise<string> {
  const w = await worker();
  try {
    const img = await shrink(file, 1800, 0.85, true);
    return (await w.recognize(img)).data.text ?? '';
  } finally { await w.terminate(); }
}

export async function keepSnap(profileId: string, doubtId: string, image: Blob) {
  await db.snaps.put({ doubtId, profileId, at: Date.now(), image: await shrink(image, 1280, 0.7) });
}
export const queuedSnaps = (profileId: string) => db.snaps.where('profileId').equals(profileId).toArray();
export const dropSnap = (doubtId: string) => db.snaps.delete(doubtId);

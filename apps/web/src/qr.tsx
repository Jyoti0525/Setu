// In-app QR scan for the teacher's class code (P5.1). Loaded on demand. Uses the phone's built-in
// BarcodeDetector when it has one (Chrome on Android), else jsQR on small frames. Nothing leaves the phone.
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from './i18n.ts';

/** A teacher QR holds `…/#join=123456`; a printed code may hold just the 6 digits. */
export function joinCodeFrom(text: string): string | null {
  return /[#&?]join=(\d{6})\b/.exec(text)?.[1] ?? (/^\s*(\d{6})\s*$/.exec(text)?.[1] ?? null);
}

type Detect = (v: HTMLVideoElement) => Promise<string | null>;

async function detector(canvas: HTMLCanvasElement): Promise<Detect> {
  const BD = (globalThis as any).BarcodeDetector;
  if (BD && (await BD.getSupportedFormats?.())?.includes('qr_code')) {
    const d = new BD({ formats: ['qr_code'] });
    return async (v) => (await d.detect(v))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import('jsqr');
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  return async (v) => {
    // ~400 px is enough for a QR held at arm's length and keeps a 2 GB phone cool
    const k = Math.min(1, 400 / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
    if (!w || !h) return null;
    canvas.width = w; canvas.height = h;
    g.drawImage(v, 0, 0, w, h);
    return jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

export function QrScan({ lang, onCode, onClose }: { lang: string; onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [seen, setSeen] = useState(false); // a QR was read but it was not a class code

  useEffect(() => {
    let stream: MediaStream | undefined;
    let stop = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 } }, audio: false });
      } catch { setErr(t(lang, 'noCamera')); return; }
      if (stop) { stream.getTracks().forEach((x) => x.stop()); return; }
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      const detect = await detector(canvas.current!);
      while (!stop) {
        const text = v.readyState >= 2 ? await detect(v).catch(() => null) : null;
        const code = text ? joinCodeFrom(text) : null;
        if (code) { stop = true; onCode(code); break; }
        if (text) setSeen(true);
        await new Promise((r) => setTimeout(r, 250));
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach((x) => x.stop()); };
  }, []);

  return (
    <div class="scan" role="dialog" aria-label={t(lang, 'scanQr')}>
      {err ? <p class="card">{err}</p> : <video ref={video} muted playsInline />}
      <canvas ref={canvas} hidden />
      {!err && <p class="small">{seen ? t(lang, 'notClassQr') : t(lang, 'scanHint')}</p>}
      <button onClick={onClose}>✕ {t(lang, 'close')}</button>
    </div>
  );
}

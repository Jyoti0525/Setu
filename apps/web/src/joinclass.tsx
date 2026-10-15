// Joining her teacher's class: the 6-digit code (or the teacher's QR). Used in new-learner setup (a step she may
// skip) and on the dashboard ("Join class"), so the code can be added any time. Her teacher then sees where she is
// stuck; nothing else about her is shared.
import { useEffect, useState } from 'preact/hooks';
import { ensureDevice } from './agent.ts';
import { fetchWithTimeout } from './net.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import { LANGUAGES } from '@setu/core';

const W: Record<string, Record<string, string>> = {
  en: { title: 'Join your class', why: 'Type the 6-digit code your teacher gives you. When you are stuck, Setu tells your teacher so they can help you.', join: 'Join class', joined: 'You are in {0}', skip: 'Skip for now', change: 'Change class', code: 'Class code', badge: 'Class' },
  hi: { title: 'अपनी कक्षा से जुड़ो', why: 'शिक्षक का दिया 6 अंकों का कोड लिखो। जब तुम अटकोगे, सेतु तुम्हारे शिक्षक को बताएगा ताकि वे मदद कर सकें।', join: 'कक्षा से जुड़ो', joined: 'तुम {0} में हो', skip: 'अभी नहीं', change: 'कक्षा बदलो', code: 'कक्षा कोड', badge: 'कक्षा' },
  or: { title: 'ତୁମ ଶ୍ରେଣୀରେ ଯୋଗ ଦିଅ', why: 'ଶିକ୍ଷକ ଦେଇଥିବା ୬ ଅଙ୍କର କୋଡ୍ ଲେଖ। ତୁମେ ଅଟକିଲେ ସେତୁ ତୁମ ଶିକ୍ଷକଙ୍କୁ ଜଣାଇବ, ଯେପରି ସେ ସାହାଯ୍ୟ କରିପାରିବେ।', join: 'ଶ୍ରେଣୀରେ ଯୋଗ ଦିଅ', joined: 'ତୁମେ {0} ରେ ଅଛ', skip: 'ଏବେ ନୁହେଁ', change: 'ଶ୍ରେଣୀ ବଦଳାଅ', code: 'ଶ୍ରେଣୀ କୋଡ୍', badge: 'ଶ୍ରେଣୀ' },
};
export const J = (lang: string, k: string) => W[lang]?.[k] ?? W[LANGUAGES[lang]?.school ?? '']?.[k] ?? W.en![k] ?? k;

export interface Joined { code: string; name?: string; region?: string; showName: boolean }

/** the code box: checks the code with the server (offline: kept, checked when it syncs) */
export function ClassCode({ lang, initial = '', hasName, onChange }: { lang: string; initial?: string; hasName: boolean; onChange: (j: Joined | null, bad: boolean) => void }) {
  const [code, setCode] = useState(initial);
  const [className, setClassName] = useState<string | null | undefined>(undefined); // undefined: not checked, null: not found
  const [region, setRegion] = useState<string | undefined>();
  const [showName, setShowName] = useState(true);
  const [Scan, setScan] = useState<typeof import('./qr.tsx').QrScan | null>(null);
  useEffect(() => {
    if (!/^\d{6}$/.test(code)) { setClassName(undefined); return; }
    let live = true;
    void (async () => {
      const dev = await ensureDevice();
      if (!dev) return;
      try {
        const r = await fetchWithTimeout(`/api/class/${code}`, { headers: { 'x-device-token': dev.token } }, 6000);
        const j = r.ok ? await r.json() : null;
        if (live) { setClassName(j ? j.name : null); setRegion(j?.region); }
      } catch { /* offline */ }
    })();
    return () => { live = false; };
  }, [code]);
  useEffect(() => { onChange(code.length === 6 && className !== null ? { code, name: className ?? undefined, region, showName } : null, code.length > 0 && (code.length < 6 || className === null)); }, [code, className, region, showName]);
  return (
    <div class="class-code">
      <div class="row nowrap">
        <input class="text" inputMode="numeric" maxLength={6} placeholder="123456" aria-label={J(lang, 'code')} value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))} />
        {'mediaDevices' in navigator && <button aria-label={t(lang, 'scanQr')} title={t(lang, 'scanQr')} onClick={() => void import('./qr.tsx').then((m) => setScan(() => m.QrScan))}><Icon name="qr" /></button>}
      </div>
      {code.length === 6 && <p class={'small ' + (className ? 'status-ok' : className === null ? 'status-bad' : 'muted')} role="status">{className ? `✓ ${className}` : className === null ? `✗ ${t(lang, 'noClass')}` : t(lang, 'checkLater')}</p>}
      {code.length === 6 && hasName && <label class="small row"><input type="checkbox" checked={showName} onChange={(e) => setShowName((e.target as HTMLInputElement).checked)} /> {t(lang, 'showName')}</label>}
      {Scan && <Scan lang={lang} onCode={(c) => { setCode(c); setScan(null); }} onClose={() => setScan(null)} />}
    </div>
  );
}

/** the dashboard's "Join class" window */
export function JoinClassDialog({ lang, current, hasName, onJoin, onClose }: { lang: string; current?: string; hasName: boolean; onJoin: (j: Joined) => Promise<void>; onClose: () => void }) {
  const [j, setJ] = useState<Joined | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div class="join-overlay" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <button class="join-scrim" aria-label={t(lang, 'close')} onClick={onClose} />
      <section class="join-dialog" role="dialog" aria-modal="true" aria-label={J(lang, 'title')}>
        <header><h2>{J(lang, 'title')}</h2><button class="iconbtn" aria-label={t(lang, 'close')} onClick={onClose}><Icon name="close" /></button></header>
        {current && <p class="status-ok small">✓ {J(lang, 'joined').replace('{0}', current)}</p>}
        <p class="muted small">{J(lang, 'why')}</p>
        <ClassCode lang={lang} hasName={hasName} onChange={(x) => setJ(x)} />
        <button class="primary" disabled={!j || busy} onClick={async () => { setBusy(true); try { await onJoin(j!); onClose(); } finally { setBusy(false); } }}>{current ? J(lang, 'change') : J(lang, 'join')}</button>
      </section>
    </div>
  );
}

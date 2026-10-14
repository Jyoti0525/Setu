import { useEffect, useRef, useState } from 'preact/hooks';
import type { ChapterPack } from '@setu/core';
import { BOARDS, textIn, scrubPii, gradeNumeric, toScriptDigits, DATA_BUDGET_KB, DATA_LOW_FRACTION, LANGUAGES, bridgeLanguages, type Dimension, type LearnerState, type OutMsg, type SessionPlan, type Tier, type TraceStep } from '@setu/core';
import { Agent, ensureDevice, ensurePack, importPack } from './agent.ts';
import { Chat } from './chat.tsx';
import { Icon, Logo } from './icons.tsx';
import { sharePack, readPackFile } from './packfile.ts';
import { pushSupported, pushOn, enablePush, disablePush } from './push.ts';
import { prefetchEssential, warmVoice, setTextOnly, takeAudioBytes } from './audio.ts';
import { getMeta, setMeta, persistStorage } from './db.ts';
import { onTier, startProbing, currentTier, fetchWithTimeout, goodLink } from './net.ts';
import { t, speak, LANGS, loadLocale } from './i18n.ts';
import { readOnline, readOffline, ocrReady, downloadOcr, keepSnap, queuedSnaps, dropSnap } from './snap.ts';
import { canRecord, record, transcribe, serverListens, hasWebSpeech, webSpeech, keepVoice, queuedVoices, dropVoice, type Recording } from './listen.ts';

interface Profile { id: string; avatar: string; name?: string; lang: string; classLevel?: number; classCode?: string; showName?: boolean; region?: string; /** tier-C home language (P3.26): taught in `lang`, with her teacher's words in this one */ home?: string; /** her board: only its books answer her ('BSE Odisha', 'CBSE') */ board?: string }
type Item = { msg: OutMsg; why?: string; answered?: string };

const AVATARS = ['👧', '👦', '🧒', '👩‍🎓', '🧑‍🌾', '🐯'];
/** P4.22: a shared phone asks "who is learning?" when it was put down for this long (or more than one learner uses it). */
const WHO_AFTER_MS = 30 * 60_000;
/** P4.23: no tap for this long → the session is ended (inactivity); the next tap opens a new one. Same as the server. */
const INACTIVE_MS = 30 * 60_000;

export function App() {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<'loading' | 'nopack' | 'onboard' | 'who' | 'ready'>('loading');
  const [tier, setTier] = useState<Tier>(currentTier());
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [guided, setGuided] = useState(false);
  const boot = useRef<{ pack: ChapterPack; device: Awaited<ReturnType<typeof ensureDevice>> } | null>(null);
  const enter = async (p: Profile) => {
    const { pack, device } = boot.current!;
    await setMeta('profile', p);
    await setMeta('lastUsedAt', Date.now());
    await loadLocale(p.lang);
    setProfile(p); setAgent(new Agent(pack, device, p.id)); setStatus('ready');
    if (device) void prefetchEssential(p.lang);
  };
  const start = async (pack: ChapterPack | null) => {
    const device = await ensureDevice();
    if (!pack) { setStatus('nopack'); return; }
    boot.current = { pack, device };
    // demo (P7.10): #restore=<profileId>&n=<name>&a=<avatar>&c=<class>&k=<demo key> opens a seeded learner on this phone
    const rs = /^#restore=([\w-]+)(.*)$/.exec(location.hash);
    if (rs && device) {
      const q = new URLSearchParams(rs[2]!.replace(/^&/, ''));
      const r = await fetchWithTimeout('/api/demo/restore', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': device.token, 'x-demo-key': q.get('k') ?? '' }, body: JSON.stringify({ profileId: rs[1] }) }, 8000).catch(() => null);
      try { history.replaceState(null, '', location.pathname); } catch { /* keep going */ }
      if (r?.ok) {
        const p: Profile = { id: rs[1]!, avatar: q.get('a') ?? '👧', name: q.get('n') ?? undefined, lang: 'or', classCode: q.get('c') ?? undefined };
        await setMeta('profiles', [...(await getMeta<Profile[]>('profiles', [])).filter((x) => x.id !== p.id), p]);
        await setMeta(`cursor:${p.id}`, 0);
        return void enter(p);
      }
    }
    const p = await getMeta<Profile | null>('profile', null);
    const list = await getMeta<Profile[]>('profiles', p ? [p] : []);
    setProfiles(list);
    const away = Date.now() - (await getMeta<number>('lastUsedAt', 0));
    // a shared phone (P4.22): confirm who is learning before her record is shown or added to
    if (list.length > 1 || (p && away > WHO_AFTER_MS)) setStatus('who');
    else if (p) void enter(p);
    else setStatus('onboard');
  };

  useEffect(() => {
    startProbing();
    void persistStorage();
    const off = onTier(setTier);
    void ensurePack().then(start);
    return () => { off(); };
  }, []);

  if (status === 'loading') return <div class="splash"><Logo size={72} /><span>{t('or', 'loading')}</span></div>;
  if (status === 'nopack') return <NoPack onPack={(p) => void start(p)} />;
  if (status === 'who') return <Who profiles={profiles} onPick={(p) => void enter(p)} onNew={() => setStatus('onboard')} />;
  if (status === 'onboard') return <Onboarding onDone={async (p) => {
    const { pack, device } = boot.current!;
    const a = new Agent(pack, device, p.id);
    if (device) void prefetchEssential(p.lang);
    await a.record([
      { type: 'PROFILE_CREATED', payload: { avatar: p.avatar, classLevel: p.classLevel ?? 9, board: p.board ?? 'BSE Odisha', language: { ui: p.lang, response: p.lang, inputMode: 'text', readingLevel: 3, ...(p.home ? { home: p.home } : {}) }, dataTier: 'low', sharedDevice: true } },
      // joining works offline too: the event syncs later (name only if she chose to show it to her teacher)
      ...(p.classCode ? [{ type: 'CLASS_JOINED' as const, payload: { classCode: p.classCode, ...(p.showName && p.name ? { displayName: p.name } : {}), ...(p.region ? { region: p.region } : {}) } }] : []),
    ]);
    try { history.replaceState(null, '', location.pathname); } catch { /* drop #join */ }
    await setMeta('profile', p);
    await setMeta('profiles', [...profiles.filter((x) => x.id !== p.id), p]);
    await setMeta('lastUsedAt', Date.now());
    await loadLocale(p.lang);
    setProfile(p); setAgent(a); setStatus('ready');
  }} />;
  const onLang = async (l: string) => { await loadLocale(l); const p = { ...profile!, lang: l }; await setMeta('profile', p); await setMeta('profiles', (await getMeta<Profile[]>('profiles', [p])).map((x) => (x.id === p.id ? p : x))); setProfile(p); };
  const onSwitch = async () => { setProfiles(await getMeta<Profile[]>('profiles', [profile!])); setStatus('who'); };
  // PLAN v4: the tutor chat is the home screen; the hand-built Motion chapter is guided practice inside it
  if (!guided) return <Chat key={profile!.id + profile!.lang + (profile!.board ?? '')} agent={agent!} lang={profile!.lang} tier={tier} profile={profile!} onGuided={() => setGuided(true)} onSwitch={() => void onSwitch()} onLang={onLang} />;
  return <>
    <button class="link back" onClick={() => setGuided(false)}><Icon name="back" size={18} /> {profile!.lang === 'en' ? 'Back to chat' : profile!.lang === 'hi' ? 'चैट पर वापस' : 'ଚାଟ୍‌କୁ ଫେରିବା'}</button>
    <Home agent={agent!} profile={profile!} tier={tier} onLang={onLang} onSwitch={() => void onSwitch()} />
  </>;
}

function Onboarding({ onDone }: { onDone: (p: Profile) => void }) {
  const [lang, setLang] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [showHome, setShowHome] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [classLevel, setClassLevel] = useState(9);
  // her board: Odisha's for Odia, Santali and the tribal languages; NCERT (CBSE) otherwise — she can change it
  const [board, setBoard] = useState<string | null>(null);
  const boardFor = (l: string | null, h: string | null) => (h || !l || l === 'or' || l === 'sat' ? 'BSE Odisha' : 'CBSE');
  // a teacher's QR opens /#join=123456
  const [code, setCode] = useState(() => /^#join=(\d{6})$/.exec(location.hash)?.[1] ?? '');
  const [className, setClassName] = useState<string | null | undefined>(undefined); // undefined: not checked, null: not found
  const [region, setRegion] = useState<string | undefined>();
  const [showName, setShowName] = useState(true);
  const [Scan, setScan] = useState<typeof import('./qr.tsx').QrScan | null>(null);
  useEffect(() => {
    if (!/^\d{6}$/.test(code)) { setClassName(undefined); return; }
    let live = true;
    void (async () => {
      const dev = await ensureDevice();
      if (!dev) return; // offline: the code is checked when it syncs
      try {
        const r = await fetchWithTimeout(`/api/class/${code}`, { headers: { 'x-device-token': dev.token } }, 6000);
        const j = r.ok ? await r.json() : null;
        if (live) { setClassName(j ? j.name : null); setRegion(j?.region); }
      } catch { /* offline */ }
    })();
    return () => { live = false; };
  }, [code]);
  const L = lang ?? 'or';
  const tagline: Record<string, string> = { or: 'ତୁମ ବହିର ପାଠ ସାଥୀ', hi: 'तुम्हारी किताब का पढ़ाई साथी', en: 'Your textbook study buddy' };
  const ready = !!avatar && className !== null;
  return (
    <div class="onboard">
      <div class="head"><Logo size={52} /><div><h1>ସେତୁ · Setu</h1><p>{tagline[L] ?? tagline.en}</p></div></div>
      <h2><span class="n">1</span>{t(L, 'chooseLang')}</h2>
      <div class="grid langs">
        {LANGS.map((l) => (
          <button class={'big langcard ' + (lang === l.id && !home ? 'sel' : '')} onClick={() => void loadLocale(l.id).then(() => { setLang(l.id); setHome(null); speak(l.label, l.id); })} aria-pressed={lang === l.id && !home}>{l.label}<Icon name="volume" size={18} /></button>
        ))}
      </div>
      {/* tier C (PLAN §7.4): never silently dropped — taught in the school language, with home-language words */}
      <button class="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowHome(!showHome)}>{t(L, 'otherHome')}</button>
      {showHome && <div class="row">{bridgeLanguages().map((h) => (
        <button class={home === h.id ? 'sel' : ''} aria-pressed={home === h.id} onClick={() => { setHome(h.id); setLang(h.school ?? 'or'); }}>{h.name}{h.name !== h.english ? ` · ${h.english}` : ''}</button>
      ))}</div>}
      {home && <p class="hint" role="status">{t(L, 'bridgeNote').replace('{0}', LANGUAGES[home]?.english ?? home).replace('{1}', LANGUAGES[lang ?? 'or']?.name ?? '')}</p>}
      {lang && <>
        <h2><span class="n">2</span>{t(lang, 'chooseAvatar')}</h2>
        <div class="grid avatars">
          {AVATARS.map((a) => <button class={'big ' + (avatar === a ? 'sel' : '')} onClick={() => setAvatar(a)} aria-label={a} aria-pressed={avatar === a}>{a}</button>)}
        </div>
        <input class="text" placeholder={t(lang, 'name')} aria-label={t(lang, 'name')} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <h2><span class="n">3</span>{t(lang, 'chooseClass')}</h2>
        <div class="classes">
          {[8, 9, 10].map((n) => <button class={classLevel === n ? 'sel' : ''} aria-pressed={classLevel === n} disabled={n !== 9} onClick={() => setClassLevel(n)}>{t(lang, 'className')} {n}{n !== 9 ? ` · ${t(lang, 'soon')}` : ''}</button>)}
        </div>
        <h2><span class="n">4</span>{t(lang, 'chooseBoard')}</h2>
        <div class="classes">
          {BOARDS.map((b) => <button class={(board ?? boardFor(lang, home)) === b.id ? 'sel' : ''} aria-pressed={(board ?? boardFor(lang, home)) === b.id} onClick={() => setBoard(b.id)}>{(b.name as Record<string, string>)[lang] ?? b.name.en}</button>)}
        </div>
        <details class="optional" open={!!code}>
          <summary>{t(lang, 'classCode')}</summary>
          <div class="row nowrap">
            <input class="text" inputMode="numeric" maxLength={6} placeholder="123456" aria-label={t(lang, 'classCode')} value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))} />
            {'mediaDevices' in navigator && <button aria-label={t(lang, 'scanQr')} onClick={() => void import('./qr.tsx').then((m) => setScan(() => m.QrScan))}><Icon name="qr" /></button>}
          </div>
          {code.length === 6 && <p class={'small ' + (className ? 'status-ok' : className === null ? 'status-bad' : 'muted')} role="status">{className ? `✓ ${className}` : className === null ? `✗ ${t(lang, 'noClass')}` : t(lang, 'checkLater')}</p>}
          {code.length === 6 && name.trim() && <label class="small row"><input type="checkbox" checked={showName} onChange={(e) => setShowName((e.target as HTMLInputElement).checked)} /> {t(lang, 'showName')}</label>}
        </details>
        {Scan && <Scan lang={lang} onCode={(c) => { setCode(c); setScan(null); }} onClose={() => setScan(null)} />}
        <div class="cta">
          <button class="primary" disabled={!ready} onClick={() => onDone({ id: `p-${crypto.randomUUID().slice(0, 8)}`, avatar: avatar!, name: name.trim() || undefined, lang, classLevel, board: board ?? boardFor(lang, home), classCode: code.length === 6 ? code : undefined, showName, ...(home ? { home } : {}), ...(region ? { region } : {}) })}>{t(lang, 'start')} →</button>
        </div>
      </>}
    </div>
  );
}

function Home({ agent, profile, tier, onSwitch, onLang }: { agent: Agent; profile: Profile; tier: Tier; onSwitch: () => void; onLang: (lang: string) => Promise<void> }) {
  const lang = profile.lang;
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [doubt, setDoubt] = useState('');
  const [state, setState] = useState<LearnerState | null>(null);
  const [showWhy, setShowWhy] = useState<number | null>(null);
  const [numAnswer, setNumAnswer] = useState('');
  const [note, setNote] = useState('');
  const [remind, setRemind] = useState(false);
  // P3.24: her teacher's home-language words (fetched with the class info when online, kept for offline)
  const [anchors, setAnchors] = useState<Record<string, Record<string, string>>>({});
  useEffect(() => {
    if (!profile.classCode || !profile.home) return;
    void getMeta<Record<string, Record<string, string>>>(`anchors:${profile.classCode}`, {}).then(setAnchors);
    if (tier === 'device' || !agent.device) return;
    void fetchWithTimeout(`/api/class/${profile.classCode}`, { headers: { 'x-device-token': agent.device.token } }, 6000)
      .then((r) => (r.ok ? r.json() : null)).then((j: { anchors?: Record<string, Record<string, string>> } | null) => { if (j?.anchors) { setAnchors(j.anchors); void setMeta(`anchors:${profile.classCode}`, j.anchors); } }).catch(() => {});
  }, [tier]);
  // P5.2: how long today — asked on her first day, then learned; one tap to change ("only 10 minutes today")
  const [pickMinutes, setPickMinutes] = useState(false);
  // P6.12: switch language any time — the record stays, the next reply comes in the new language
  const [pickLang, setPickLang] = useState(false);
  const switchLang = async (l: string) => {
    setPickLang(false);
    if (l === lang) return;
    await agent.record([{ type: 'PROFILE_UPDATED', payload: { language: { ui: l, response: l } } }]);
    await onLang(l);
    setState(await agent.state());
  };
  const [askedMinutes, setAskedMinutes] = useState(true);
  useEffect(() => { void getMeta<boolean>(`askedMinutes:${profile.id}`, false).then(setAskedMinutes); }, []);
  const setMinutes = async (m: number) => {
    await agent.record([{ type: 'PROFILE_UPDATED', payload: { sessionMinutes: m } }]);
    await setMeta(`askedMinutes:${profile.id}`, true);
    setAskedMinutes(true); setPickMinutes(false);
    setState(await agent.state());
  };
  useEffect(() => { void pushOn().then(setRemind); }, []);
  const end = useRef<HTMLDivElement>(null);
  const sessionId = useRef(`s-${Date.now()}`);
  // P4.23: real minutes, and an inactivity end; the next tap after it opens a fresh session
  const sessionStart = useRef(Date.now());
  const lastTap = useRef(Date.now());
  const sessionOpen = useRef(true);
  const [reading, setReading] = useState<string | null>(null);
  const [ocrOk, setOcrOk] = useState(true);
  // the photo of the last Snap, held in memory only until it is located or she keeps it for later
  const lastPhoto = useRef<{ doubtId: string; file: Blob } | null>(null);
  useEffect(() => { void ocrReady().then(setOcrOk); }, []);
  const [mic, setMic] = useState<'idle' | 'rec' | 'live' | 'hearing'>('idle');
  const recording = useRef<Recording | null>(null);
  const liveStop = useRef<(() => void) | null>(null);
  const textBox = useRef<HTMLInputElement>(null);
  const say = (key: Parameters<typeof t>[1], tone: 'neutral' | 'promise' = 'neutral') => setItems((p) => [...p, { msg: { kind: 'info', text: t(lang, key), speak: t(lang, key), tone } }]);
  const askHeard = (text: string, doubtId: string = crypto.randomUUID()) => {
    setItems((p) => [...p, { msg: { kind: 'info', text: `🎤 ${text}`, speak: text } }]);
    return run({ type: 'doubt', doubtId, text, mode: 'voice' });
  };
  /** last step of the chain: the keyboard's own mic, or typing in English letters / a photo (P3.3, P3.6) */
  const typeInstead = (key: 'voiceFailed' | 'gboardHint') => { say(key); textBox.current?.focus(); };

  /** 🎤 (P3.1–P3.7): server transcription → Web Speech → keep offline → keyboard mic. */
  const onMic = async () => {
    if (mic === 'live') { liveStop.current?.(); return; }
    if (mic === 'rec') {
      const rec = recording.current; recording.current = null;
      if (!rec) return;
      setMic('hearing');
      let heard: Awaited<ReturnType<typeof transcribe>> = null;
      const doubtId = crypto.randomUUID();
      const audio = await rec.stop().catch(() => null);
      if (!audio || audio.size < 1500) { setMic('idle'); return; } // a tap, not a question
      if (tier !== 'device' && agent.device) heard = await transcribe(agent.device, audio, lang);
      setMic('idle');
      if (heard && 'text' in heard) { await askHeard(heard.text, doubtId); return; }
      // the server tried every step and could not understand → next in the chain (P3.6)
      if (heard) { if (hasWebSpeech() && tier !== 'device') void live(); else typeInstead('voiceFailed'); return; }
      // no signal (or it dropped while uploading): keep the recording, answer when the signal is back (P3.7)
      await keepVoice(agent.profileId, doubtId, audio);
      await agent.record([
        { type: 'DOUBT_QUEUED', payload: { doubtId, text: '🎤', reason: 'voice' } },
        { type: 'COMMITMENT_MADE', payload: { commitmentId: `answer:${doubtId}`, text: 'listen to the kept question when online' } },
      ]);
      say('voiceKept', 'promise');
      return;
    }
    const online = tier !== 'device' && !!agent.device;
    // online and the server cannot transcribe this language → the browser's own recogniser, live
    if (online && !serverListens(lang) && hasWebSpeech()) return void live();
    if (!canRecord()) return typeInstead('gboardHint');
    try {
      recording.current = await record(() => void onMicRef.current());
      setMic('rec');
    } catch { typeInstead('gboardHint'); } // microphone refused or missing
  };
  const onMicRef = useRef(onMic);
  onMicRef.current = onMic;
  const live = async () => {
    setMic('live');
    say('speakNow');
    const w = webSpeech(lang);
    liveStop.current = w.stop;
    const text = await w.result;
    liveStop.current = null;
    setMic('idle');
    if (text) await askHeard(text); else typeInstead('voiceFailed');
  };
  /** questions spoken offline: transcribed and answered as soon as the signal is back, then the recording is deleted */
  const readKeptVoices = async () => {
    if (!agent.device) return;
    for (const v of await queuedVoices(agent.profileId)) {
      const heard = await transcribe(agent.device, v.audio, lang);
      if (!heard) return; // signal dropped again: try next time
      if ('text' in heard) {
        const r = await askHeard(heard.text, v.doubtId);
        const shown = r.messages.find((m) => m.kind === 'explanation' || m.kind === 'passage') ?? r.messages.find((m) => m.kind === 'chips');
        await agent.record([
          { type: 'DOUBT_ANSWERED', payload: { doubtId: v.doubtId, answer: shown && 'text' in shown ? shown.text : '' } },
          { type: 'COMMITMENT_KEPT', payload: { commitmentId: `answer:${v.doubtId}` } },
        ]);
      } else {
        // could not be understood even online: say so (promise kept honestly) and offer typing / a photo
        await agent.record([
          { type: 'DOUBT_ANSWERED', payload: { doubtId: v.doubtId, answer: t(lang, 'voiceFailed') } },
          { type: 'COMMITMENT_KEPT', payload: { commitmentId: `answer:${v.doubtId}` } },
        ]);
        say('voiceFailed');
      }
      await dropVoice(v.doubtId);
    }
  };

  const run = async (input: Parameters<Agent['turn']>[0]) => {
    setBusy(true);
    try {
      if (input.type !== 'end' && input.type !== 'open' && !sessionOpen.current) {
        sessionId.current = `s-${Date.now()}`; sessionStart.current = Date.now(); sessionOpen.current = true;
        const o = await agent.turn({ type: 'open', sessionId: sessionId.current });
        push(o.messages, o.trace);
      }
      if (input.type !== 'end') { lastTap.current = Date.now(); void setMeta('lastUsedAt', lastTap.current); }
      if (input.type === 'end') sessionOpen.current = false;
      // her name (only this phone knows it) never leaves the phone or reaches a model (P5.22)
      if (input.type === 'doubt' && profile.name) input = { ...input, text: scrubPii(input.text, [profile.name]) };
      // P2.16: a slow reply gets an instant word in her language first, so the wait is never silent
      const ack = input.type === 'doubt' ? setTimeout(() => say('ack'), 400) : undefined;
      const r = await agent.turn(input).finally(() => clearTimeout(ack));
      setState(r.state);
      push(r.messages, r.trace);
      return r;
    } finally { setBusy(false); }
  };

  /** Snap: online the server reads the photo; offline Tesseract does; the engine only uses it to find the passage. */
  const snap = async (file: File) => {
    const doubtId = crypto.randomUUID();
    lastPhoto.current = { doubtId, file };
    setItems((p) => [...p, { msg: { kind: 'info', text: `📷 ${t(lang, 'photo')}`, speak: '' } }]);
    setReading(t(lang, 'readingPhoto'));
    let text = '';
    try {
      if (tier !== 'device' && agent.device) text = (await readOnline(agent.device, file))?.text ?? '';
      if (!text && (await ocrReady())) text = await readOffline(file).catch(() => '');
    } finally { setReading(null); }
    const r = await run({ type: 'doubt', doubtId, text, mode: 'photo' });
    if (!r.messages.some((m) => m.kind === 'passages')) lastPhoto.current = null; // processed → not kept
  };
  const keepPhoto = async () => {
    const ph = lastPhoto.current;
    if (!ph) return;
    await keepSnap(agent.profileId, ph.doubtId, ph.file);
    await agent.record([
      { type: 'DOUBT_QUEUED', payload: { doubtId: ph.doubtId, text: '📷', reason: 'photo' } },
      { type: 'COMMITMENT_MADE', payload: { commitmentId: `answer:${ph.doubtId}`, text: 'read the kept photo when online' } },
    ]);
    lastPhoto.current = null;
    setItems((p) => [...p, { msg: { kind: 'info', text: t(lang, 'photoKept'), speak: t(lang, 'photoKept'), tone: 'promise' } }]);
  };
  const pickPassage = (passageId: string) => { lastPhoto.current = null; void run({ type: 'doubt', doubtId: crypto.randomUUID(), text: '', mode: 'photo', passageId }); };
  /** photos kept offline are read as soon as the signal is back — the promise is kept, the photo deleted */
  const readKept = async () => {
    if (!agent.device) return;
    for (const k of await queuedSnaps(agent.profileId)) {
      const read = await readOnline(agent.device, k.image);
      if (!read?.text) continue;
      const r = await run({ type: 'doubt', doubtId: k.doubtId, text: read.text, mode: 'photo' });
      // the reply she got: the passage/explanation, or — if even the online read could not place it — the passage picker
      const shown = r.messages.find((m) => m.kind === 'passage' || m.kind === 'explanation') ?? r.messages.find((m) => m.kind === 'passages');
      await agent.record([
        { type: 'DOUBT_ANSWERED', payload: { doubtId: k.doubtId, answer: shown && 'text' in shown ? shown.text : '' } },
        { type: 'COMMITMENT_KEPT', payload: { commitmentId: `answer:${k.doubtId}` } },
      ]);
      await dropSnap(k.doubtId);
    }
  };
  const push = (msgs: OutMsg[], trace: TraceStep) => {
    setItems((prev) => [...prev, ...msgs.map((m, i) => ({ msg: m, why: i === msgs.length - 1 ? trace.why : undefined }))]);
  };

  useEffect(() => { void run({ type: 'open', sessionId: sessionId.current }); }, []);
  const minutesUsed = (until = Date.now()) => Math.max(1, Math.round((until - sessionStart.current) / 60_000));
  // the phone was put down: end the session as "inactivity" at the last tap (checked every minute and on return)
  useEffect(() => {
    const check = () => {
      if (sessionOpen.current && !busy && Date.now() - lastTap.current > INACTIVE_MS)
        void run({ type: 'end', sessionId: sessionId.current, minutesUsed: minutesUsed(lastTap.current), reason: 'inactivity' });
    };
    const id = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, [busy]);
  // P4.29: today's data nearly used → text only (no voice downloads); the engine also drops audio from its plan
  useEffect(() => {
    if (!state) return;
    setTextOnly(state.constraints.dataUsedKB > DATA_BUDGET_KB[state.constraints.dataTier] * (1 - DATA_LOW_FRACTION));
  }, [state]);
  // P4.2: voice downloads are her data too — recorded once a minute as one event, not one per clip
  useEffect(() => {
    const id = setInterval(async () => {
      const b = takeAudioBytes();
      if (b > 0) { await agent.record([{ type: 'DATA_USED', payload: { kb: Math.ceil(b / 1024) } }]); setState(await agent.state()); }
    }, 60_000);
    return () => clearInterval(id);
  }, [agent]);
  // P4.28: the link changed → recorded (the agent picks tools by it); better link → refresh pack, fetch voice clips
  const lastTier = useRef(tier);
  useEffect(() => {
    const from = lastTier.current;
    lastTier.current = tier;
    if (from === tier) return;
    void agent.record([{ type: 'CONNECTIVITY_CHANGED', payload: { from, to: tier } }]);
    const rank = { device: 0, weak: 1, cloud: 2 } as const;
    if (rank[tier] > rank[from] && tier === 'cloud' && goodLink()) { void ensurePack(); void prefetchEssential(lang); }
  }, [tier]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [items.length]);
  // what the agent wrote for her between sessions is read later, maybe offline: fetch its voice while there is signal
  useEffect(() => {
    if (tier === 'cloud' && state) void warmVoice([...(state.preparedSession?.items ?? []).map((x) => x.pregenerated?.speak), ...state.queuedDoubts.map((d) => d.answer)], lang);
  }, [state, tier]);
  // signal came back → flush outbox, collect answers to queued doubts
  useEffect(() => {
    if (tier === 'cloud') void agent.sync().then(async (r) => { if (r && (r.sent || r.received)) { setNote(`${t(lang, 'syncDone')} ↑${r.sent} ↓${r.received}`); setState(await agent.state()); } }).then(readKept).then(readKeptVoices);
  }, [tier]);

  const answer = (idx: number, checkId: string, value: string) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, answered: value } : it)));
    setNumAnswer('');
    void run({ type: 'answer', checkId, answer: value });
  };

  const mastery = state ? Object.entries(state.concepts).filter(([id]) => agent.pack.graph.concepts[id]) : [];
  const dataKB = state?.constraints.dataUsedKB ?? 0;

  return (
    <div class="home">
      <header class="bar">
        <button class="who link" aria-label={t(lang, 'switchLearner')} onClick={() => void run({ type: 'end', sessionId: sessionId.current, minutesUsed: minutesUsed() }).then(onSwitch)}>{profile.avatar} {profile.name ?? ''}</button>
        <button class="link small" aria-label={t(lang, 'chooseLang')} onClick={() => setPickLang(!pickLang)}>{LANGS.find((l) => l.id === lang)?.label ?? lang}</button>
        <button class="link small" aria-label={t(lang, 'timeToday')} onClick={() => setPickMinutes(!pickMinutes)}>⏱ {toScriptDigits(String(state?.session?.minutes ?? state?.constraints.sessionMinutes ?? 20), lang)}′</button>
        <span class={'tier ' + tier} role="status">{t(lang, tier)}</span>
        <span class="muted small">{t(lang, 'dataUsed')} {(dataKB / 1024).toFixed(2)} MB</span>
      </header>

      <section class="mastery" aria-label={t(lang, 'mastery')}>
        {Object.values(agent.pack.graph.concepts).map((c) => {
          const st = mastery.find(([id]) => id === c.id)?.[1];
          const p = st?.pKnown ?? 0.2;
          return <div class="m" title={`${(p * 100).toFixed(0)}%`}><div class="mbar"><div style={{ width: `${p * 100}%` }} class={st?.mastered ? 'done' : ''} /></div><span>{textIn(c.name, lang)}</span></div>;
        })}
      </section>

      {pickLang && <div class="card"><p>{t(lang, 'chooseLang')}</p><div class="row">{LANGS.map((l) => <button class={l.id === lang ? 'sel' : ''} aria-pressed={l.id === lang} onClick={() => void switchLang(l.id)}>{l.label}</button>)}</div></div>}
      {(pickMinutes || (state && !askedMinutes && state.sessionsCompleted === 0)) && (
        <div class="card minutes">
          <p>{t(lang, 'timeToday')}</p>
          <div class="row">{[10, 20, 30].map((m) => <button class={state?.session?.minutes === m ? 'sel' : ''} onClick={() => void setMinutes(m)}>{toScriptDigits(String(m), lang)} {t(lang, 'minutes')}</button>)}</div>
        </div>
      )}
      <main class="feed">
        {state && <Answers state={state} lang={lang} />}
        {state?.preparedSession && items.length <= 3 && <Ready plan={state.preparedSession} lang={lang} names={(cid) => textIn(agent.pack.graph.concepts[cid]?.name, lang)} onStart={() => void run({ type: 'next' })} busy={busy} />}
        {items.map((it, idx) => <Msg item={it} idx={idx} lang={lang} busy={busy} home={profile.home ? { name: LANGUAGES[profile.home]?.english ?? profile.home, words: Object.fromEntries(Object.entries(anchors).map(([c, w]) => [c, w[profile.home!] ?? ''])) } : undefined} showWhy={showWhy === idx} toggleWhy={() => setShowWhy(showWhy === idx ? null : idx)}
          onAnswer={answer} numAnswer={numAnswer} setNumAnswer={setNumAnswer} onChip={(cid) => void run({ type: 'doubt', doubtId: crypto.randomUUID(), text: textIn(agent.pack.graph.concepts[cid]?.name, lang), mode: 'text' })}
          onPick={pickPassage} onKeep={() => void keepPhoto()} />)}
        {reading && <div class="thinking">📷 {reading}</div>}
        {busy && !reading && <div class="thinking">{t(lang, 'thinking')}</div>}
        {note && <div class="note">{note}</div>}
        <div ref={end} />
      </main>

      <footer class="ask">
        <form onSubmit={(e) => { e.preventDefault(); if (!doubt.trim() || busy) return; const text = doubt; setDoubt(''); setItems((p) => [...p, { msg: { kind: 'info', text: `🙋 ${text}`, speak: text } }]); void run({ type: 'doubt', doubtId: crypto.randomUUID(), text, mode: 'text' }); }}>
          <input ref={textBox} class="text" aria-label={t(lang, 'ask')} placeholder={t(lang, 'askPlaceholder')} value={doubt} onInput={(e) => setDoubt((e.target as HTMLInputElement).value)} />
          <button class="primary" type="submit" disabled={busy || !doubt.trim()}>{t(lang, 'send')}</button>
        </form>
        {mic !== 'idle' && <div class="thinking" role="status">🎤 {t(lang, mic === 'rec' ? 'listening' : mic === 'live' ? 'speakNow' : 'hearing')}</div>}
        <div class="row">
          <button class={'mic' + (mic === 'rec' || mic === 'live' ? ' on' : '')} aria-pressed={mic === 'rec' || mic === 'live'} aria-label={t(lang, 'mic')} disabled={busy || mic === 'hearing'} onClick={() => void onMic()}>🎤 {t(lang, 'mic')}</button>
          <label class={'btn' + (busy || reading ? ' disabled' : '')} aria-label={t(lang, 'snap')}>📷 {t(lang, 'snap')}
            <input type="file" accept="image/*" capture="environment" hidden disabled={busy || !!reading} onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) void snap(f); }} />
          </label>
          <button onClick={() => void run({ type: 'next' })} disabled={busy}>▶ {t(lang, 'next')}</button>
          <button onClick={() => void run({ type: 'end', sessionId: sessionId.current, minutesUsed: minutesUsed() })} disabled={busy}>✓ {t(lang, 'end')}</button>
        </div>
        <div class="row">
          <button class="link small" onClick={() => void sharePack(agent.pack)}>📤 {t(lang, 'sharePack')}</button>
          {agent.device && pushSupported() && tier !== 'device' && <button class="link small" aria-pressed={remind} onClick={async () => {
            if (remind) { await disablePush(agent.device!); setRemind(false); } else setRemind(await enablePush(agent.device!, agent.profileId, lang));
          }}>{remind ? '🔔' : '🔕'} {t(lang, remind ? 'remindOn' : 'remindOff')}</button>}
        </div>
        {!ocrOk && tier === 'cloud' && goodLink() && <button class="link small" onClick={() => { setReading(t(lang, 'ocrDownloading')); void downloadOcr().then((ok) => { setOcrOk(ok); setReading(null); }); }}>📥 {t(lang, 'ocrDownload')}</button>}
      </footer>
    </div>
  );
}

/** The session the agent prepared after her last one (PLAN §5.2) — shown when she opens the app. */
function Ready({ plan, lang, names, onStart, busy }: { plan: SessionPlan; lang: string; names: (cid: string) => string; onStart: () => void; busy: boolean }) {
  if (!plan.items.length) return null;
  return (
    <div class="card ready">
      <div class="term">{t(lang, 'ready')} · ~{toScriptDigits(String(plan.forSessionMinutes), lang)} {t(lang, 'minutes')}</div>
      <ol>{plan.items.map((x) => <li>{names(x.conceptId)}{x.pregenerated ? ' ✨' : ''}</li>)}</ol>
      <button class="primary" disabled={busy} onClick={onStart}>▶ {t(lang, 'startLesson')}</button>
    </div>
  );
}

/** Doubts she queued offline that the agent answered between sessions (shown until she has seen them). */
function Answers({ state, lang }: { state: LearnerState; lang: string }) {
  const [seen, setSeen] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('setu.seenAnswers') ?? '[]'); } catch { return []; } });
  const fresh = state.queuedDoubts.filter((d) => d.answered && d.answer && !seen.includes(d.doubtId));
  if (!fresh.length) return null;
  const ok = (id: string) => { const next = [...seen, id]; setSeen(next); try { localStorage.setItem('setu.seenAnswers', JSON.stringify(next)); } catch { /* private mode */ } };
  return <>{fresh.map((d) => (
    <div class="card answered">
      <div class="term">{t(lang, 'answered')}</div>
      <p class="muted small">{t(lang, 'yourQuestion')}: {d.text}</p>
      <p>{d.answer}</p>
      <div class="row"><button class="icon" aria-label={t(lang, 'speak')} onClick={() => speak(d.answer!, lang)}>🔊</button><button onClick={() => ok(d.doubtId)}>✓</button></div>
    </div>
  ))}</>;
}

function Msg(p: { item: Item; idx: number; lang: string; busy: boolean; home?: { name: string; words: Record<string, string> }; showWhy: boolean; toggleWhy: () => void; onAnswer: (idx: number, checkId: string, v: string) => void; numAnswer: string; setNumAnswer: (v: string) => void; onChip: (cid: string) => void; onPick: (passageId: string) => void; onKeep: () => void }) {
  const m = p.item.msg;
  const say = <button class="icon" aria-label={t(p.lang, 'speak')} onClick={() => speak('speak' in m ? m.speak : '', p.lang)}>🔊</button>;
  const why = p.item.why && <div class="why"><button class="link" onClick={p.toggleWhy}>{t(p.lang, 'why')}</button>{p.showWhy && <span> {p.item.why}</span>}</div>;
  // P3.19 term bridge under the explanation: textbook term = English exam term · everyday phrase (· her home-language word)
  if (m.kind === 'explanation') return <div class="card explain"><div class="term">{m.term}{m.generated ? ' ✨' : ''}</div><p>{m.text}</p>
    {m.bridge && <p class="bridge small">📘 <b>{m.bridge.term}</b> = {m.bridge.english} · {m.bridge.everyday}{p.home?.words[m.conceptId] ? ` · ${p.home.name}: ${p.home.words[m.conceptId]}` : ''}</p>}
    {say}{why}</div>;
  if (m.kind === 'feedback') return <div class={'card fb ' + (m.correct ? 'ok' : 'no')}><p>{m.text}</p>{say}{why}</div>;
  // tutor lines (retake tips, placement intro…) have recorded audio too: most phones have no Odia voice
  // the care message: helpline numbers are one tap to call (P5.14)
  if (m.kind === 'info' && m.tone === 'escalated' && m.text.includes('1098')) return <div class="card info escalated" role="alert"><p>{m.text.split(/(1098|14416|112)/).map((x, i) => (i % 2 ? <a href={`tel:${x}`}>{x}</a> : x))}</p>{say}</div>;
  if (m.kind === 'info') return <div class={'card info ' + (m.tone ?? '')}><p>{m.text}</p>{m.speak && say}{why}</div>;
  if (m.kind === 'hints') return <Hints m={m} lang={p.lang} say={say} why={why || undefined} />;
  if (m.kind === 'chips') return <div class="card"><p>{m.text}</p>{say}<div class="row">{m.options.map((o) => <button onClick={() => p.onChip(o.conceptId)}>{o.label}</button>)}</div></div>;
  if (m.kind === 'passage') return <div class="card passage"><div class="term">📖 {t(p.lang, 'fromBook')}{m.page ? ` · p. ${m.page}` : ''}</div><p>{m.text}</p>{say}</div>;
  if (m.kind === 'passages') return (
    <div class="card"><p>{m.text}</p>{say}
      <div class="opts">{m.options.map((o) => <button class="opt" disabled={p.busy} onClick={() => p.onPick(o.passageId)}>{o.label}</button>)}</div>
      {m.canQueue && <button class="link" onClick={p.onKeep}>📥 {t(p.lang, 'keepPhoto')}</button>}
      {why}
    </div>
  );
  // check
  const done = p.item.answered !== undefined;
  return (
    <div class="card check">
      <p>{m.stem} {m.placement ? <span class="tag place">{t(p.lang, 'placementTag')}</span> : m.practice && <span class="tag">{t(p.lang, 'practice')}</span>}</p>
      {say}
      {m.options ? (
        <div class="opts">{m.options.map((o) => <button class={'opt ' + (p.item.answered === o.id ? 'picked' : '')} disabled={done || p.busy} onClick={() => p.onAnswer(p.idx, m.checkId, o.id)}>{o.text}</button>)}</div>
      ) : (
        <form class="row" onSubmit={(e) => { e.preventDefault(); if (p.numAnswer.trim()) p.onAnswer(p.idx, m.checkId, p.numAnswer); }}>
          <input class="text" inputMode={m.freeText ? 'text' : 'decimal'} disabled={done} placeholder={t(p.lang, m.freeText ? 'typeWords' : 'typeNumber')} value={done ? p.item.answered : p.numAnswer} onInput={(e) => p.setNumAnswer((e.target as HTMLInputElement).value)} />
          <button class="primary" disabled={done || p.busy}>{t(p.lang, 'answer')}</button>
        </form>
      )}
      {why}
    </div>
  );
}

/**
 * Hint ladder for a homework-style sum (P2.43): one hint at a time, she works it out; her number is checked on the phone
 * (solver value, unit-aware) and the answer is shown only after she has tried.
 */
function Hints(p: { m: Extract<OutMsg, { kind: 'hints' }>; lang: string; say: preact.JSX.Element; why: preact.JSX.Element | undefined }) {
  const [shown, setShown] = useState(1);
  const [value, setValue] = useState('');
  const [tries, setTries] = useState(0);
  const [result, setResult] = useState<'right' | 'wrong' | undefined>();
  const [reveal, setReveal] = useState(false);
  const { m } = p;
  const check = (e: Event) => {
    e.preventDefault();
    if (!value.trim()) return;
    const g = gradeNumeric(value, { value: m.answer.si, dim: m.answer.dim as Dimension });
    setTries((n) => n + 1);
    setResult(g.correct ? 'right' : 'wrong');
    if (!g.correct) setShown(m.steps.length);
  };
  return (
    <div class="card hints">
      <p>{m.text}</p>{p.say}
      <ol>{m.steps.slice(0, shown).map((s) => <li>{s}</li>)}</ol>
      {shown < m.steps.length && result !== 'right' && <button class="link" onClick={() => setShown((n) => n + 1)}>💡 {t(p.lang, 'nextHint')}</button>}
      <form class="row" onSubmit={check}>
        <input class="text" inputMode="decimal" placeholder={t(p.lang, 'typeNumber')} value={value} disabled={result === 'right'} onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
        <button class="primary" disabled={result === 'right'}>{t(p.lang, 'answer')}</button>
      </form>
      {result === 'right' && <p class="fb ok">{t(p.lang, 'hintRight')} ({toScriptDigits(String(m.answer.shown), p.lang)} {m.answer.unit})</p>}
      {result === 'wrong' && !reveal && <p class="fb no">{t(p.lang, 'hintWrong')}</p>}
      {tries > 0 && result !== 'right' && (reveal ? <p><b>{m.answer.text}</b></p> : <button class="link" onClick={() => setReveal(true)}>{t(p.lang, 'showAnswer')}</button>)}
      {p.why}
    </div>
  );
}

/** P4.22: a shared phone — who is learning now? Her record opens only after she picks herself. */
function Who({ profiles, onPick, onNew }: { profiles: Profile[]; onPick: (p: Profile) => void; onNew: () => void }) {
  const L = profiles[0]?.lang ?? 'or';
  return (
    <div class="onboard who-screen">
      <div class="head"><Logo size={64} /><h1>{t(L, 'whoIsIt')}</h1></div>
      <div class="grid avatars">
        {profiles.map((p) => <button class="big who" onClick={() => onPick(p)}>{p.avatar}<span class="small">{p.name ?? ''}</span></button>)}
        <button class="big" aria-label={t(L, 'newLearner')} onClick={onNew}><span style={{ display: 'grid', placeItems: 'center' }}><Icon name="plus" size={30} /></span><span class="small">{t(L, 'newLearner')}</span></button>
      </div>
    </div>
  );
}

/** No lesson on the phone yet and no signal: open the lesson file a friend shared (P4.13), checked by hash. */
function NoPack({ onPack }: { onPack: (p: ChapterPack) => void }) {
  const [err, setErr] = useState('');
  return (
    <div class="center">
      <p>{t('or', 'noPack')}</p>
      <label class="btn">📂 {t('or', 'openPackFile')}
        <input type="file" accept=".json,application/json" hidden onChange={async (e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (!f) return;
          const r = await readPackFile(f);
          if ('error' in r) { setErr(t('or', r.error === 'hash' ? 'packBad' : 'packFormat')); return; }
          onPack(await importPack(r));
        }} />
      </label>
      {err && <p class="small" role="alert">{err}</p>}
    </div>
  );
}

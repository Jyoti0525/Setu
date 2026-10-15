// Teacher view (PLAN §9.2): a teacher signs in (her own account, like a student's), and her classes live on it —
// on any phone, no key to keep. Each class: QR + code for learners, then only what needs a human.
// Loaded on demand at #teacher so the learner's bundle stays small. With no sign-in set up on the server, a class
// is still made and opened with its key, as before.

import { useEffect, useState } from 'preact/hooks';
import type { Auth, User } from 'firebase/auth';
import qrcode from 'qrcode-generator';
import { ensureDevice } from './agent.ts';
import { getAuthOnce } from './firebase.ts';
import { fetchWithTimeout } from './net.ts';
import { pushSupported, teacherAlerts } from './push.ts';
import { Logo, Icon } from './icons.tsx';
import { ThemeToggle } from './theme.tsx';
import { REGIONS, textIn } from '@setu/core';

interface Saved { code: string; token: string; name: string; lang: string }
/** how this page opens a class: her account (the class code) or the class key */
interface Access { code: string; token?: string; name: string }
interface ClassItem { code: string; name: string; lang: string; size: number; needs: number }
type View = any; // shape: apps/server/src/teacher.ts classView()

const KEY = 'setu.teacher';
const load = (): Saved | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const save = (s: Saved | null) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode: lives for this tab only */ } };
const keep = (k: string, v?: string) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };

const S = {
  or: {
    alertMe: 'ଏହି ଫୋନରେ ସତର୍କ ସୂଚନା ପାଆନ୍ତୁ', alertOn: 'ସତର୍କ ସୂଚନା ଚାଲୁ ✓', title: 'ଶିକ୍ଷକ', create: 'ନୂଆ ଶ୍ରେଣୀ ତିଆରି କରନ୍ତୁ', className: 'ଶ୍ରେଣୀର ନାମ (ଯେପରି 9A ବିଜ୍ଞାନ)', lang: 'ଆପଣଙ୍କ ଭାଷା', haveKey: 'ମୋ ପାଖରେ ଶ୍ରେଣୀ ଚାବି ଅଛି', key: 'ଶ୍ରେଣୀ ଚାବି', open: 'ଖୋଲନ୍ତୁ',
    keyWarn: 'ଏହି ଚାବି ସାଇତି ରଖନ୍ତୁ — ଅନ୍ୟ ଫୋନରୁ ଶ୍ରେଣୀ ଖୋଲିବାକୁ ଦରକାର। କାହାକୁ ଦିଅନ୍ତୁ ନାହିଁ।',
    joinHow: 'ପିଲାମାନେ ଏହି QR ସ୍କାନ କରନ୍ତୁ ବା କୋଡ୍ ଲେଖନ୍ତୁ', copy: 'ଲିଙ୍କ କପି କରନ୍ତୁ', copied: 'କପି ହେଲା',
    needs: 'ଆପଣଙ୍କ ଦରକାର', none: 'ଏବେ କିଛି ନାହିଁ ✓', wellbeing: 'ମଙ୍ଗଳ (ଏକାନ୍ତରେ)', dropoff: 'ଆସୁନାହାନ୍ତି', days: 'ଦିନ ହେଲା ଆସିନାହାନ୍ତି',
    reteach: 'ଶ୍ରେଣୀରେ ପୁନଃଶିକ୍ଷା (ଡ୍ରାଫ୍ଟ)', learnersShare: 'ଜଣ ପିଲାଙ୍କର ଏକା ଭୁଲ ଧାରଣା', approve: 'ଅନୁମୋଦନ', reject: 'ବାଦ୍ ଦିଅନ୍ତୁ', approved: 'ଅନୁମୋଦିତ ✓', rejected: 'ବାଦ୍ ଦିଆଗଲା',
    done: 'ହୋଇଗଲା ✓', markDone: 'ହୋଇଗଲା', tried: 'ଚେଷ୍ଟା ହୋଇଛି', attempts: 'ଉତ୍ତର', confusion: 'ଭୁଲ ଧାରଣା', suggest: 'ପରାମର୍ଶ',
    exam: 'ପରୀକ୍ଷା ତାରିଖ', setExam: 'ସେଟ କରନ୍ତୁ', examSet: 'ପିଲାଙ୍କ ଲକ୍ଷ୍ୟ ଅଦ୍ୟତନ', learners: 'ପିଲାମାନେ', lastSeen: 'ଶେଷ ଥର', never: 'କେବେ ନୁହେଁ',
    candidates: 'ନୂଆ ଭୁଲ ଧାରଣା (ସମୀକ୍ଷା)', keep: 'ରଖନ୍ତୁ', refresh: 'ପୁଣି ଦେଖନ୍ତୁ', leave: 'ଏହି ଫୋନରୁ ବାହାରନ୍ତୁ', confirmed: 'ନିଶ୍ଚିତ', offline: 'ଇଣ୍ଟରନେଟ ନାହିଁ — ପରେ ଚେଷ୍ଟା କରନ୍ତୁ।',
    emptyClass: 'ଏଯାଏଁ କେହି ଯୋଗ ଦେଇନାହାନ୍ତି।', badKey: 'ଚାବି ଠିକ୍ ନୁହେଁ।',
    region: 'ଅଞ୍ଚଳ (ସ୍ଥାନୀୟ ଉଦାହରଣ ପାଇଁ)', anchors: 'ଘର ଭାଷାର ଶବ୍ଦ', anchorsHow: 'ଯେଉଁ ପିଲାଙ୍କ ଘର ଭାଷା କୁଇ, ସାନ୍ତାଳି ବା ହୋ, ସେମାନଙ୍କ ପାଇଁ ମୁଖ୍ୟ ଶବ୍ଦ ଯୋଡ଼ନ୍ତୁ — ପାଠରେ ପାଠ୍ୟ ଶବ୍ଦ ପାଖରେ ଦେଖାଯିବ।', word: 'ଶବ୍ଦ', save: 'ସେଭ କରନ୍ତୁ',
    myClasses: 'ମୋ ଶ୍ରେଣୀ', noClasses: 'ଏଯାଏଁ କୌଣସି ଶ୍ରେଣୀ ନାହିଁ। ପ୍ରଥମ ଶ୍ରେଣୀ ତିଆରି କରନ୍ତୁ — ପିଲାମାନେ ତା’ର କୋଡ୍ ଦେଇ ଯୋଗ ଦେବେ।', needsN: 'ଜଣ ଆପଣଙ୍କୁ ଦରକାର', learnersN: 'ଜଣ ପିଲା', logout: 'ଲଗ୍‌ଆଉଟ୍‌', allClasses: 'ସବୁ ଶ୍ରେଣୀ', claimHow: 'ପୁରୁଣା ଶ୍ରେଣୀ (ଚାବି ସହ ତିଆରି) ଏହି ଖାତାରେ ଯୋଡ଼ନ୍ତୁ', add: 'ଯୋଡ଼ନ୍ତୁ', otherTeacher: 'ଏହି ଶ୍ରେଣୀ ଆଉ ଜଣେ ଶିକ୍ଷକଙ୍କର।', stuckWhy: 'କାହିଁକି',
  },
  en: {
    alertMe: 'Alert me on this phone when a learner is stuck', alertOn: 'Alerts on ✓', title: 'Teacher', create: 'Create a class', className: 'Class name (e.g. 9A Science)', lang: 'Your language', haveKey: 'I have a class key', key: 'Class key', open: 'Open',
    keyWarn: 'Save this key — you need it to open the class on another phone. Do not share it.',
    joinHow: 'Learners scan this QR or type the code', copy: 'Copy link', copied: 'Copied',
    needs: 'Needs you', none: 'Nothing right now ✓', wellbeing: 'Wellbeing (talk privately)', dropoff: 'Not coming', days: 'days since last visit',
    reteach: 'Class reteach (draft)', learnersShare: 'learners share this confusion', approve: 'Approve', reject: 'Reject', approved: 'Approved ✓', rejected: 'Rejected',
    done: 'Done ✓', markDone: 'Mark done', tried: 'Tried', attempts: 'answers', confusion: 'Confusion', suggest: 'Suggestion',
    exam: 'Exam date', setExam: 'Set', examSet: 'learner goals updated', learners: 'Learners', lastSeen: 'Last seen', never: 'never',
    candidates: 'New confusions (review)', keep: 'Keep', refresh: 'Refresh', leave: 'Sign out on this phone', confirmed: 'confirmed', offline: 'No internet — try again later.',
    emptyClass: 'Nobody has joined yet.', badKey: 'That key is not right.',
    region: 'Region (for local examples)', anchors: 'Home-language words', anchorsHow: 'For learners whose home language is Kui, Santali or Ho: add the word for each key idea — it shows next to the textbook term.', word: 'Word', save: 'Save',
    myClasses: 'My classes', noClasses: 'No classes yet. Create your first class — learners join it with its code.', needsN: 'need you', learnersN: 'learners', logout: 'Log out', allClasses: 'All classes', claimHow: 'Add an older class (made with a key) to this account', add: 'Add', otherTeacher: 'This class belongs to another teacher.', stuckWhy: 'Why',
  },
} as const;
type K = keyof typeof S.en;

export function Teacher() {
  const [auth, setAuth] = useState<Auth | null | undefined>(undefined);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [lang, setLang] = useState(() => load()?.lang ?? (keep('setu-auth-lang') === 'or' ? 'or' : 'en'));
  const t = (k: K) => (S as Record<string, Record<K, string>>)[lang]?.[k] ?? S.en[k];
  const [device, setDevice] = useState<string | null>(null);
  useEffect(() => {
    document.title = 'Setu · Teacher';
    void ensureDevice().then((d) => setDevice(d?.token ?? null));
    let off = () => {};
    void (async () => {
      const a = await Promise.race([getAuthOnce(), new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
      setAuth(a);
      if (!a) return setUser(null);
      const { onAuthStateChanged } = await import('firebase/auth');
      off = onAuthStateChanged(a, (u) => setUser(u));
    })();
    return () => off();
  }, []);
  const switchLang = () => setLang(lang === 'or' ? 'en' : 'or');

  if (auth === undefined || (auth && user === undefined)) return <main class="auth-loading"><Logo size={56} /></main>;
  // sign-in is set up: a teacher signs in first (the sign-in page, in teacher mode), then comes back here
  if (auth && !user) { keep('setu-role', 'teacher'); location.replace('/login'); return <main class="auth-loading"><Logo size={56} /></main>; }
  const logout = async () => { const { signOut } = await import('firebase/auth'); await signOut(auth!); keep('setu-role', 'teacher'); location.replace('/login'); };
  if (auth && user) return <Classes lang={lang} t={t} device={device} user={user} switchLang={switchLang} onLogout={() => void logout()} />;
  return <KeyTeacher lang={lang} setLang={setLang} t={t} device={device} />;
}

function TopBar({ title, lang, t, switchLang, onBack, onLogout, onRefresh }: { title: string; lang: string; t: (k: K) => string; switchLang: () => void; onBack?: () => void; onLogout?: () => void; onRefresh?: () => void }) {
  return (
    <header class="bar teacher-bar">
      <span class="teacher-title">{onBack ? <button class="iconbtn" aria-label={t('allClasses')} title={t('allClasses')} onClick={onBack}><Icon name="back" size={18} /></button> : <Logo size={30} />}<strong>{title}</strong></span>
      <span class="row nowrap">
        <button class="theme-toggle" onClick={switchLang}>{lang === 'or' ? 'English' : 'ଓଡ଼ିଆ'}</button>
        {onRefresh && <button class="theme-toggle" onClick={onRefresh} aria-label={t('refresh')} title={t('refresh')}>↻</button>}
        <ThemeToggle lang={lang} />
        {onLogout && <button class="theme-toggle topbar-logout" onClick={onLogout} aria-label={t('logout')} title={t('logout')}><Icon name="logout" size={18} /><span class="theme-label">{t('logout')}</span></button>}
      </span>
    </header>
  );
}

/** her account: all her classes; one opens with everything that needs her */
function Classes({ lang, t, device, user, switchLang, onLogout }: { lang: string; t: (k: K) => string; device: string | null; user: User; switchLang: () => void; onLogout: () => void }) {
  const [list, setList] = useState<ClassItem[] | null>(null);
  const [open, setOpen] = useState<Access | null>(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [key, setKey] = useState('');
  const H = { 'content-type': 'application/json', 'x-device-token': device ?? '' };
  const refresh = async () => {
    if (!device) return;
    try {
      // a class made earlier with a key on this phone moves onto her account (once)
      const old = load();
      if (old) { const r = await fetchWithTimeout('/api/teacher/claim', { method: 'POST', headers: H, body: JSON.stringify({ key: old.token }) }, 10000); if (r.ok || r.status === 403 || r.status === 409) save(null); }
      const r = await fetchWithTimeout('/api/teacher/classes', { headers: H }, 10000);
      if (r.ok) { setList(await r.json()); setErr(''); }
    } catch { setErr(t('offline')); }
  };
  useEffect(() => { void refresh(); }, [device, user.uid]);
  const create = async () => {
    try {
      const r = await fetchWithTimeout('/api/class', { method: 'POST', headers: H, body: JSON.stringify({ name, lang, ...(region ? { region } : {}) }) }, 10000);
      if (!r.ok) return setErr(t('offline'));
      const j = await r.json();
      setName(''); setRegion(''); await refresh(); setOpen({ code: j.code, name: name || 'Class' });
    } catch { setErr(t('offline')); }
  };
  const claim = async () => {
    try {
      const r = await fetchWithTimeout('/api/teacher/claim', { method: 'POST', headers: H, body: JSON.stringify({ key: key.trim() }) }, 10000);
      if (r.status === 409) return setErr(t('otherTeacher'));
      if (!r.ok) return setErr(t('badKey'));
      setKey(''); await refresh();
    } catch { setErr(t('offline')); }
  };
  if (open) return <ClassPage access={open} lang={lang} t={t} device={device} switchLang={switchLang} onBack={() => { setOpen(null); void refresh(); }} onLogout={onLogout} />;
  return (
    <div class="teacher">
      <TopBar title={`Setu · ${t('title')}`} lang={lang} t={t} switchLang={switchLang} onLogout={onLogout} />
      <main class="tfeed">
        <p class="muted small">{user.displayName || user.email}</p>
        {err && <div class="card info escalated"><p>{err}</p></div>}
        <Section title={t('myClasses')}>
          {list && !list.length && <p class="muted">{t('noClasses')}</p>}
          {list?.map((c) => (
            <button class="card class-card" onClick={() => setOpen({ code: c.code, name: c.name })}>
              <span><strong>{c.name}</strong><span class="muted small"> · {c.code.replace(/(\d{3})(\d{3})/, '$1 $2')}</span></span>
              <span class="small">{c.size} {t('learnersN')}{c.needs ? <b class="needs-badge"> · {c.needs} {t('needsN')}</b> : null}</span>
            </button>
          ))}
        </Section>
        <Section title={t('create')}>
          <input class="text" placeholder={t('className')} aria-label={t('className')} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <select aria-label={t('region')} value={region} onChange={(e) => setRegion((e.target as HTMLSelectElement).value)}>
            <option value="">{t('region')}</option>
            {Object.entries(REGIONS).map(([id, r]) => <option value={id}>{textIn(r.name, lang)}</option>)}
          </select>
          <button class="primary" disabled={!device || !name.trim()} onClick={() => void create()}>{t('create')} →</button>
        </Section>
        <details class="small"><summary>{t('claimHow')}</summary>
          <div class="row nowrap"><input class="text" placeholder={t('key')} aria-label={t('key')} value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} /><button disabled={!key.trim() || !device} onClick={() => void claim()}>{t('add')}</button></div>
        </details>
      </main>
    </div>
  );
}

/** no sign-in on this server: one class on this phone, opened with its key (as before) */
function KeyTeacher({ lang, setLang, t, device }: { lang: string; setLang: (l: string) => void; t: (k: K) => string; device: string | null }) {
  const [saved, setSaved] = useState<Saved | null>(load);
  const [freshKey, setFreshKey] = useState(false);
  if (!saved) return <Setup lang={lang} setLang={setLang} t={t} device={device} onReady={(s, fresh) => { save(s); setSaved(s); setLang(s.lang); setFreshKey(fresh); }} />;
  return <ClassPage access={{ code: saved.code, token: saved.token, name: saved.name }} freshKey={freshKey} lang={lang} t={t} device={device} switchLang={() => setLang(lang === 'or' ? 'en' : 'or')} onLeave={() => { save(null); setSaved(null); }} />;
}

function ClassPage({ access, freshKey, lang, t, device, switchLang, onBack, onLogout, onLeave }: { access: Access; freshKey?: boolean; lang: string; t: (k: K) => string; device: string | null; switchLang: () => void; onBack?: () => void; onLogout?: () => void; onLeave?: () => void }) {
  const [view, setView] = useState<View | null>(null);
  const [err, setErr] = useState('');
  const [alerts, setAlerts] = useState(false);
  const H = (): Record<string, string> => ({ 'content-type': 'application/json', 'x-device-token': device ?? '', ...(access.token ? { 'x-teacher-token': access.token } : { 'x-class-code': access.code }) });
  const refresh = async () => {
    if (!device) return;
    try {
      const r = await fetchWithTimeout('/api/teacher', { headers: H() }, 10000);
      if (r.status === 403) { setErr(t('badKey')); return; }
      setView(await r.json()); setErr('');
    } catch { setErr(t('offline')); }
  };
  useEffect(() => { void refresh(); const id = setInterval(() => void refresh(), 30_000); return () => clearInterval(id); }, [access.code, device]);
  const post = async (path: string, body: unknown) => {
    try { await fetchWithTimeout(path, { method: 'POST', headers: H(), body: JSON.stringify(body) }, 10000); await refresh(); } catch { setErr(t('offline')); }
  };
  const link = `${location.origin}/#join=${access.code}`;
  return (
    <div class="teacher">
      <TopBar title={`${t('title')} · ${view?.class.name ?? access.name}`} lang={lang} t={t} switchLang={switchLang} onBack={onBack} onLogout={onLogout} onRefresh={() => void refresh()} />
      <main class="tfeed">
        {err && <div class="card info escalated"><p>{err}</p></div>}
        <section class="card joincard">
          <div class="qr" dangerouslySetInnerHTML={{ __html: qrSvg(link) }} role="img" aria-label={`QR ${access.code}`} />
          <div>
            <p class="muted small">{t('joinHow')}</p>
            <div class="code" aria-label={access.code}>{access.code.replace(/(\d{3})(\d{3})/, '$1 $2')}</div>
            <button onClick={() => { void navigator.clipboard?.writeText(link).catch(() => {}); }}>{t('copy')}</button>
          </div>
        </section>
        {pushSupported() && <button class="link small" aria-pressed={alerts} disabled={alerts} onClick={async () => setAlerts(await teacherAlerts(device ?? '', access.token ? { token: access.token } : { code: access.code }))}>{alerts ? t('alertOn') : '🔔 ' + t('alertMe')}</button>}
        {freshKey && access.token && <section class="card info escalated"><p><strong>{t('key')}:</strong> <code>{access.token}</code></p><p class="small">{t('keyWarn')}</p></section>}

        {view && <>
          <Section title={`${t('needs')} (${view.needsYou.filter((x: any) => !x.done).length})`}>
            {!view.needsYou.length && <p class="muted">{t('none')}</p>}
            {view.needsYou.map((n: any) => (
              <article class={'card need' + (n.done ? ' done' : '')}>
                <div class="row between"><strong>{n.learner} · {n.concept || '—'}</strong><span class="muted small">{when(n.at, lang)}</span></div>
                {n.reason && <p class="small">{t('stuckWhy')}: {n.reason}</p>}
                {n.misconceptions.map((m: any) => <p class="small">⚠ {t('confusion')}: {m.text} ({m.signals}{m.confirmed ? `, ${t('confirmed')}` : ''})</p>)}
                {n.strategiesTried.length > 0 && <p class="small muted">{t('tried')}: {n.strategiesTried.join(', ')} · {n.attempts} {t('attempts')}{n.p !== null ? ` · p=${n.p}` : ''}</p>}
                <details><summary>{t('suggest')}</summary><p class="small">{n.recommendation}</p></details>
                {n.done ? <span class="tag">{t('done')}</span> : <button onClick={() => void post('/api/teacher/ack', { ref: n.ref, action: 'done' })}>{t('markDone')}</button>}
              </article>
            ))}
          </Section>

          {view.wellbeing.length > 0 && <Section title={t('wellbeing')} tone="wellbeing">
            {view.wellbeing.map((w: any) => (
              <article class={'card wb' + (w.done ? ' done' : '')}>
                <div class="row between"><strong>{w.learner}</strong><span class="muted small">{when(w.at, lang)}</span></div>
                <p class="small">{w.note}</p>
                {w.done ? <span class="tag">{t('done')}</span> : <button onClick={() => void post('/api/teacher/ack', { ref: w.ref, action: 'done' })}>{t('markDone')}</button>}
              </article>
            ))}
          </Section>}

          {view.reteach.length > 0 && <Section title={t('reteach')}>
            {view.reteach.map((r: any) => <Reteach r={r} t={t} onSave={(action, body) => void post('/api/teacher/ack', { ref: r.ref, action, body })} />)}
          </Section>}

          {view.dropoff.length > 0 && <Section title={t('dropoff')}>
            <ul class="plain">{view.dropoff.map((d: any) => <li>{d.learner} — {d.days} {t('days')}</li>)}</ul>
          </Section>}

          {view.candidates.length > 0 && <Section title={t('candidates')}>
            {view.candidates.map((c: any) => (
              <article class="card"><p><strong>{c.concept}</strong>: {c.description}</p><p class="small muted">{c.learner} · {c.evidence}</p>
                {c.english && <details class="small muted"><summary>English</summary>{c.english.description} · {c.english.evidence}</details>}
                <div class="row"><button onClick={() => void post('/api/teacher/ack', { ref: c.ref, action: 'approved' })}>{t('keep')}</button><button onClick={() => void post('/api/teacher/ack', { ref: c.ref, action: 'rejected' })}>{t('reject')}</button></div>
              </article>
            ))}
          </Section>}

          <Section title={`${t('learners')} (${view.class.size})`}>
            {!view.learners.length && <p class="muted">{t('emptyClass')}</p>}
            {view.learners.map((l: any) => (
              <article class="card learner">
                <div class="row between"><strong>{l.label}</strong><span class="muted small">{t('lastSeen')}: {l.lastActiveAt ? when(l.lastActiveAt, lang) : t('never')}</span></div>
                <div class="mastery tight">{l.concepts.map((c: any) => <div class="m" title={`${Math.round(c.p * 100)}%`}><div class="mbar"><div style={{ width: `${c.p * 100}%` }} class={c.mastered ? 'done' : ''} /></div><span>{c.name}</span></div>)}</div>
              </article>
            ))}
          </Section>

          <Section title={t('exam')}>
            <ExamDate t={t} current={view.class.examDate} onSet={async (date) => { await post('/api/teacher/exam', { date }); }} />
          </Section>

          <Section title={t('anchors')}>
            <p class="small muted">{t('anchorsHow')}</p>
            <Anchors view={view} t={t} onSave={(conceptId, lang, word) => void post('/api/teacher/anchor', { conceptId, lang, word })} />
          </Section>
          {onLeave && <button class="link" onClick={onLeave}>{t('leave')}</button>}
        </>}
      </main>
    </div>
  );
}

function Setup({ lang, setLang, t, device, onReady }: { lang: string; setLang: (l: string) => void; t: (k: K) => string; device: string | null; onReady: (s: Saved, fresh: boolean) => void }) {
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const headers = { 'content-type': 'application/json', 'x-device-token': device ?? '' };
  const create = async () => {
    try {
      const r = await fetchWithTimeout('/api/class', { method: 'POST', headers, body: JSON.stringify({ name, lang, ...(region ? { region } : {}) }) }, 10000);
      const j = await r.json();
      onReady({ code: j.code, token: j.token, name: name || 'Class', lang: j.lang }, true);
    } catch { setErr(t('offline')); }
  };
  const open = async () => {
    try {
      const r = await fetchWithTimeout('/api/teacher', { headers: { ...headers, 'x-teacher-token': key.trim() } }, 10000);
      if (!r.ok) { setErr(t('badKey')); return; }
      const v = await r.json();
      onReady({ code: v.class.code, token: key.trim(), name: v.class.name, lang: v.class.lang }, false);
    } catch { setErr(t('offline')); }
  };
  return (
    <div class="onboard">
      <h1>ସେତୁ · {t('title')}</h1>
      <p class="muted">{t('lang')}</p>
      <div class="grid">{[['or', 'ଓଡ଼ିଆ'], ['en', 'English']].map(([id, label]) => <button class={'big ' + (lang === id ? 'sel' : '')} aria-pressed={lang === id} onClick={() => setLang(id!)}>{label}</button>)}</div>
      <input class="text" placeholder={t('className')} aria-label={t('className')} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      {/* P3.22: the region picks local analogies (boats and river, paddy and haat, hill road and stream) */}
      <select aria-label={t('region')} value={region} onChange={(e) => setRegion((e.target as HTMLSelectElement).value)}>
        <option value="">{t('region')}</option>
        {Object.entries(REGIONS).map(([id, r]) => <option value={id}>{textIn(r.name, lang)}</option>)}
      </select>
      <button class="primary" disabled={!device} onClick={() => void create()}>{t('create')} →</button>
      <details><summary>{t('haveKey')}</summary>
        <div class="row"><input class="text" placeholder={t('key')} aria-label={t('key')} value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} /><button disabled={!key.trim() || !device} onClick={() => void open()}>{t('open')}</button></div>
      </details>
      {err && <p class="note err">{err}</p>}
    </div>
  );
}

function Reteach({ r, t, onSave }: { r: any; t: (k: K) => string; onSave: (action: 'approved' | 'rejected', body?: string) => void }) {
  const [text, setText] = useState<string>(r.draft);
  useEffect(() => setText(r.draft), [r.draft]);
  return (
    <article class={'card reteach ' + r.status}>
      <p><strong>{r.misconception}</strong> — {r.share} {t('learnersShare')}</p>
      <p class="small muted">{r.learners.join(', ')}</p>
      <textarea class="text" rows={8} value={text} disabled={r.status !== 'draft'} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} aria-label={t('reteach')} />
      {r.status === 'draft'
        ? <div class="row"><button class="primary" onClick={() => onSave('approved', text !== r.draft ? text : undefined)}>{t('approve')}</button><button onClick={() => onSave('rejected')}>{t('reject')}</button></div>
        : <span class="tag">{r.status === 'approved' ? t('approved') : t('rejected')}</span>}
    </article>
  );
}

function ExamDate({ t, current, onSet }: { t: (k: K) => string; current: number | null; onSet: (date: string | null) => Promise<void> }) {
  const [d, setD] = useState(current ? new Date(current).toISOString().slice(0, 10) : '');
  const [ok, setOk] = useState(false);
  return (
    <div class="row">
      <input class="text date" type="date" value={d} aria-label={t('exam')} onInput={(e) => { setD((e.target as HTMLInputElement).value); setOk(false); }} />
      <button onClick={() => void onSet(d || null).then(() => setOk(true))}>{t('setExam')}</button>
      {ok && <span class="note">✓ {t('examSet')}</span>}
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone?: string; children: any }) {
  return <section class={'tsec ' + (tone ?? '')}><h2>{title}</h2>{children}</section>;
}

function qrSvg(text: string): string {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

const when = (at: number, lang: string) => {
  const d = Math.floor((Date.now() - at) / 86_400_000);
  if (d <= 0) return new Date(at).toLocaleTimeString(lang === 'or' ? 'or-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' });
  return new Date(at).toLocaleDateString(lang === 'or' ? 'or-IN' : 'en-IN', { day: 'numeric', month: 'short' });
};

/** P3.24: home-language anchors — a word per key concept for learners whose home language is not the school language. */
function Anchors({ view, t, onSave }: { view: any; t: (k: K) => string; onSave: (conceptId: string, lang: string, word: string) => void }) {
  const [lang, setLang] = useState<string>(view.homeLangs?.[0]?.id ?? 'kxu');
  const [words, setWords] = useState<Record<string, string>>({});
  return (
    <div>
      <select value={lang} aria-label={t('lang')} onChange={(e) => setLang((e.target as HTMLSelectElement).value)}>
        {(view.homeLangs ?? []).map((l: any) => <option value={l.id}>{l.name}</option>)}
      </select>
      {(view.concepts ?? []).map((c: any) => {
        const have = view.anchors?.[c.id]?.[lang] ?? '';
        const k = `${c.id}:${lang}`;
        return (
          <form class="row" onSubmit={(e) => { e.preventDefault(); onSave(c.id, lang, words[k] ?? have); }}>
            <label class="small grow">{c.name}</label>
            <input class="text" maxLength={40} placeholder={t('word')} value={words[k] ?? have} onInput={(e) => setWords({ ...words, [k]: (e.target as HTMLInputElement).value })} />
            <button>{t('save')}</button>
          </form>
        );
      })}
    </div>
  );
}

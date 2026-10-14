// The tutor chat (PLAN v4): the main screen. She picks a subject (or not) and talks — typed in Odia or English letters,
// spoken, or a photo of the page. Online the server agent answers from her textbook, checks she understood, grades her
// reply and remembers per chapter. Offline the same policy runs here on the downloaded books: it reads her the right
// textbook passage and keeps the question; the full answer arrives when the signal is back.

import { useEffect, useRef, useState } from 'preact/hooks';
import { emptyMemory, focusQuote, planTurn, screen, scrubPii, Shelf, T, TL, type BookIndex, type BookMeta } from '@setu/core';
import type { Agent } from './agent.ts';
import { getMeta, setMeta } from './db.ts';
import { bookLink, fetchWithTimeout } from './net.ts';
import { t, speak, LANGS } from './i18n.ts';
import { readOnline, readOffline, ocrReady } from './snap.ts';
import { canRecord, record, transcribe, hasWebSpeech, webSpeech, serverListens, type Recording } from './listen.ts';
import type { Tier } from '@setu/core';
import { Icon, Logo } from './icons.tsx';

/** quote: the sentences that answer her question; full: the whole passage (both cleaned scans of the printed book) */
interface Source { bookId: string; subject: string; chapter: string; page: number; passageId: string; quote: string; full?: string }
interface TMsg { text: string; sources?: Source[]; check?: string; terms?: { or: string; en: string }[]; tone?: string; chips?: { label: string; text?: string; review?: string; bookId?: string }[]; by: 'model' | 'policy' }
type Line = { role: 'student'; text: string; at: number; queued?: boolean } | { role: 'tutor'; msg: TMsg; at: number; why?: string };
interface Memory { topics: { key: string; subject: string; chapter: string; pKnown: number }[]; check?: string }
type BookInfo = BookMeta & { version: string; passages: number; kb: number };
interface Queued { id: string; text: string; bookIds?: string[]; at: number }

const keep = (lines: Line[]) => lines.slice(-60);

/** Subjects from the books on the server/phone: one subject may be several books (a supplement chapter). */
function subjectsOf(books: BookInfo[]) {
  const m = new Map<string, { name: Record<string, string | undefined>; ids: string[] }>();
  for (const b of books) {
    const s = m.get(b.subject.en) ?? { name: b.subject as Record<string, string | undefined>, ids: [] as string[] };
    s.ids.push(b.id);
    m.set(b.subject.en, s);
  }
  return [...m.values()];
}

export function Chat({ agent, lang, tier, profile, onGuided, onSwitch, onLang }: {
  agent: Agent; lang: string; tier: Tier; profile: { id: string; avatar: string; name?: string };
  onGuided: () => void; onSwitch: () => void; onLang: (l: string) => Promise<void>;
}) {
  const pid = profile.id;
  const online = tier !== 'device' && !!agent.device;
  const [lines, setLines] = useState<Line[]>([]);
  const [books, setBooks] = useState<BookInfo[]>([]);
  const [subject, setSubject] = useState<string[] | undefined>(undefined);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [memory, setMemory] = useState<Memory>({ topics: [] });
  const [openSrc, setOpenSrc] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState<number | null>(null);
  const [sheet, setSheet] = useState<'progress' | 'lang' | null>(null);
  const [mic, setMic] = useState<'idle' | 'rec' | 'live' | 'hearing'>('idle');
  const rec = useRef<Recording | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const shelf = useRef<Shelf | null>(null);
  const headers = () => ({ 'content-type': 'application/json', 'x-device-token': agent.device!.token });
  const add = (l: Line[]) => setLines((p) => { const n = keep([...p, ...l]); void setMeta(`chat:${pid}`, n); return n; });

  // start: her conversation so far (kept on the phone), her subjects, then the agent speaks first
  useEffect(() => {
    void (async () => {
      setLines(await getMeta<Line[]>(`chat:${pid}`, []));
      setSubject(await getMeta<string[] | undefined>(`subject:${pid}`, undefined));
      setMemory(await getMeta<Memory>(`memory:${pid}`, { topics: [] }));
      setBooks(await getMeta<BookInfo[]>('books', []));
      if (online) {
        await agent.sync().catch(() => null); // her profile reaches the server before the tutor writes for her
        try {
          const r = await fetchWithTimeout('/api/books', { headers: headers() }, 8000);
          if (r.ok) { const list = (await r.json()) as BookInfo[]; setBooks(list); await setMeta('books', list); }
        } catch { /* offline after all */ }
        await openSession();
        await sendQueued();
      } else add([{ role: 'tutor', msg: { text: TL(lang, 'welcome_back'), by: 'policy' }, at: Date.now() }]);
    })();
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines.length, busy]);
  // signal back → kept questions are answered now
  useEffect(() => { if (online) void sendQueued(); }, [tier]);
  // the books of her subject live on the phone for offline (text only, ~200 KB each), fetched on any usable link
  // (also when the link comes up: the first network check often finishes after the book list has loaded)
  useEffect(() => {
    const link = bookLink();
    if (online && link) void downloadBooks(subject ?? (link === 'all' ? books.map((b) => b.id) : []));
  }, [books.length, subject?.join(','), online]);

  async function downloadBooks(ids: string[]) {
    for (const id of ids) {
      const info = books.find((b) => b.id === id);
      const have = await getMeta<BookIndex | null>(`book:${id}`, null);
      if (!info || have?.version === info.version) continue;
      try { const r = await fetchWithTimeout(`/api/book/${id}`, { headers: headers() }, 30000); if (r.ok) { await setMeta(`book:${id}`, await r.json()); shelf.current = null; } } catch { return; }
    }
  }
  async function localShelf(): Promise<Shelf> {
    if (shelf.current) return shelf.current;
    const all: BookIndex[] = [];
    for (const b of books) { const x = await getMeta<BookIndex | null>(`book:${b.id}`, null); if (x) all.push(x); }
    shelf.current = new Shelf(all);
    return shelf.current;
  }

  async function openSession() {
    try {
      const r = await fetchWithTimeout('/api/tutor/open', { method: 'POST', headers: headers(), body: JSON.stringify({ profileId: pid, lang, bookIds: subject }) }, 8000);
      if (!r.ok) return;
      const j = (await r.json()) as { messages: TMsg[]; memory: Memory };
      // reopening the app must not stack the same greeting again under the last one
      setLines((p) => {
        const last = [...p].reverse().find((l) => l.role === 'tutor');
        const msgs = j.messages.filter((msg) => !(last?.role === 'tutor' && last.msg.text === msg.text));
        const n = keep([...p, ...msgs.map((msg) => ({ role: 'tutor' as const, msg, at: Date.now() }))]);
        void setMeta(`chat:${pid}`, n);
        return n;
      });
      setMemory(j.memory); void setMeta(`memory:${pid}`, j.memory);
    } catch { /* stays quiet: she can still ask */ }
  }

  /** One message to the agent: online the server; no signal (or it drops mid-way) the phone. */
  async function ask(raw: string, opts: { mode?: 'text' | 'voice' | 'photo'; review?: string; show?: string } = {}) {
    const msg = scrubPii(raw, profile.name ? [profile.name] : []).trim();
    if (!msg && !opts.review) return;
    add([{ role: 'student', text: opts.show ?? msg, at: Date.now() }]);
    const turnId = crypto.randomUUID();
    if (online) {
      setBusy(t(lang, 'thinking'));
      try {
        const r = await fetchWithTimeout('/api/tutor/turn', { method: 'POST', headers: headers(), body: JSON.stringify({ profileId: pid, text: msg, lang, bookIds: subject, mode: opts.mode ?? 'text', review: opts.review, turnId }) }, 30000);
        if (r.ok) {
          const j = (await r.json()) as { messages: TMsg[]; memory: Memory; trace: { chosen: string; reason: string; tools: { tool: string; note?: string }[] } };
          const why = `${j.trace.chosen} — ${j.trace.reason}\n${j.trace.tools.map((x) => x.tool + (x.note ? ` (${x.note})` : '')).join(' → ')}`;
          add(j.messages.map((m, i) => ({ role: 'tutor' as const, msg: m, at: Date.now(), ...(i === j.messages.length - 1 ? { why } : {}) })));
          setMemory(j.memory); void setMeta(`memory:${pid}`, j.memory);
          return;
        }
      } catch { /* signal dropped mid-turn → the phone answers below */ } finally { setBusy(null); }
    }
    await offlineTurn(msg, turnId);
  }

  async function offlineTurn(msg: string, id: string) {
    const sh = await localShelf();
    const safety = screen(msg, true);
    if (!sh.books.size && safety === 'ok') {
      // no book on this phone yet (never online long enough): say so, keep the question
      add([{ role: 'tutor', msg: { text: U(lang, 'noBooksYet'), tone: 'offline', by: 'policy' }, at: Date.now(), why: 'no textbook saved on this phone yet → question kept for when online' }]);
      const q = await getMeta<Queued[]>(`tutorQueue:${pid}`, []);
      await setMeta(`tutorQueue:${pid}`, [...q, { id, text: msg, bookIds: subject, at: Date.now() }]);
      return;
    }
    const hits = sh.search(msg, { limit: 4 });
    const plan = planTurn(emptyMemory(), { safety, text: msg, hits, bookIds: subject, online: false, now: Date.now() });
    if (plan.action === 'care' || plan.action === 'decline' || plan.action === 'redirect') {
      // the safety replies need no signal; a distress message is never kept or sent later
      add([{ role: 'tutor', msg: { text: T(lang, plan.action === 'care' ? 'care' : plan.action === 'decline' ? 'decline' : safety === 'personal' ? 'privacy' : 'redirect'), tone: plan.action === 'care' ? 'care' : 'info', by: 'policy' }, at: Date.now(), why: plan.reason }]);
      return;
    }
    const h = plan.grounding[0];
    const name = (x?: { or: string; en: string; hi?: string }) => (x ? (lang === 'en' ? x.en : lang === 'hi' ? x.hi ?? x.en : x.or) : '');
    const quote = h ? focusQuote(h.passage.text, msg) : '';
    const src: Source[] | undefined = h ? [{ bookId: h.bookId, subject: name(sh.books.get(h.bookId)?.meta.subject), chapter: name(sh.chapterOf(h.bookId, h.passage.ch)?.title), page: h.passage.page, passageId: h.passage.id, quote, ...(quote !== h.passage.text ? { full: h.passage.text } : {}) }] : undefined;
    add([{ role: 'tutor', msg: { text: TL(lang, h ? 'offline_passage' : 'offline_none'), tone: 'offline', sources: src, by: 'policy' }, at: Date.now(), why: `${plan.action} — ${plan.reason}` }]);
    const q = await getMeta<Queued[]>(`tutorQueue:${pid}`, []);
    await setMeta(`tutorQueue:${pid}`, [...q, { id, text: msg, bookIds: subject, at: Date.now() }]);
  }

  async function sendQueued() {
    const q = await getMeta<Queued[]>(`tutorQueue:${pid}`, []);
    if (!q.length || !agent.device) return;
    const left: Queued[] = [];
    for (const x of q) {
      try {
        const r = await fetchWithTimeout('/api/tutor/turn', { method: 'POST', headers: headers(), body: JSON.stringify({ profileId: pid, text: x.text, lang, bookIds: x.bookIds, queuedAt: x.at, turnId: x.id }) }, 30000);
        if (!r.ok) { left.push(x); continue; }
        const j = (await r.json()) as { messages: TMsg[]; memory: Memory };
        add([{ role: 'tutor', msg: { text: `${TL(lang, 'kept_answered')} “${x.text}”`, tone: 'info', by: 'policy' }, at: Date.now() }, ...j.messages.map((m) => ({ role: 'tutor' as const, msg: m, at: Date.now() }))]);
        setMemory(j.memory);
      } catch { left.push(x); }
    }
    await setMeta(`tutorQueue:${pid}`, left);
  }

  // 🎤: server speech-to-text → the browser's own → type instead (as the guided lesson)
  async function onMic() {
    if (mic === 'rec') {
      const r = rec.current; rec.current = null;
      if (!r) return;
      setMic('hearing');
      const audio = await r.stop().catch(() => null);
      if (!audio || audio.size < 1500 || !agent.device) { setMic('idle'); return; }
      const heard = online ? await transcribe(agent.device, audio, lang) : null;
      setMic('idle');
      if (heard && 'text' in heard) return void ask(heard.text, { mode: 'voice', show: `🎤 ${heard.text}` });
      return void add([{ role: 'tutor', msg: { text: t(lang, 'voiceFailed'), by: 'policy', tone: 'info' }, at: Date.now() }]);
    }
    if (online && !serverListens(lang) && hasWebSpeech()) {
      setMic('live');
      const w = webSpeech(lang);
      const said = await w.result;
      setMic('idle');
      if (said) void ask(said, { mode: 'voice', show: `🎤 ${said}` });
      return;
    }
    if (!canRecord()) return void add([{ role: 'tutor', msg: { text: t(lang, 'gboardHint'), by: 'policy' }, at: Date.now() }]);
    try { rec.current = await record(() => void onMicRef.current()); setMic('rec'); } catch { add([{ role: 'tutor', msg: { text: t(lang, 'gboardHint'), by: 'policy' }, at: Date.now() }]); }
  }
  const onMicRef = useRef(onMic);
  onMicRef.current = onMic;

  // 📷: the page is read (online by the server, offline by Tesseract) and asked about like a typed question
  async function onPhoto(file: File) {
    setBusy(t(lang, 'readingPhoto'));
    let read = '';
    try {
      if (online && agent.device) read = (await readOnline(agent.device, file))?.text ?? '';
      if (!read && (await ocrReady())) read = await readOffline(file).catch(() => '');
    } finally { setBusy(null); }
    if (!read.trim()) return void add([{ role: 'tutor', msg: { text: t(lang, 'voiceFailed'), by: 'policy', tone: 'info' }, at: Date.now() }]);
    void ask(read.slice(0, 600), { mode: 'photo', show: `📷 ${read.slice(0, 80)}…` });
  }

  const pick = async (ids: string[] | undefined) => { setSubject(ids); await setMeta(`subject:${pid}`, ids); };
  const subjects = subjectsOf(books);
  const physics = books.find((b) => b.id === 'physical-science-9');
  const openCheck = [...lines].reverse().find((l) => l.role === 'tutor' && l.msg.check);
  const answering = !!(memory.check && openCheck);
  const placeholder = answering ? U(lang, 'answerShort') : U(lang, 'askShort');
  const current = subject ? subjects.find((s) => s.ids.every((id) => subject.includes(id))) : undefined;
  const ideas = suggestions(current?.ids ?? subjects.flatMap((s) => s.ids), lang);
  const fresh = !lines.some((l) => l.role === 'student');
  const send = () => { if (!text.trim() || busy) return; const x = text; setText(''); void ask(x); };
  const listening = mic === 'rec' || mic === 'live';

  return (
    <div class="app chat">
      <header class="topbar">
        <button class="me" aria-label={t(lang, 'switchLearner')} onClick={onSwitch}><span class="avatar">{profile.avatar}</span></button>
        <div class="brand">
          <Logo size={30} />
          <div class="brand-text">
            <b>{t(lang, 'app')}</b>
            <span class={'net ' + tier} role="status"><i class="dot" />{t(lang, tier)}</span>
          </div>
        </div>
        <button class="iconbtn" aria-label={TL(lang, 'progress')} aria-pressed={sheet === 'progress'} onClick={() => setSheet('progress')}><Icon name="chart" /></button>
        <button class="iconbtn" aria-label={t(lang, 'chooseLang')} aria-pressed={sheet === 'lang'} onClick={() => setSheet('lang')}><Icon name="globe" /></button>
      </header>

      <nav class="subjects" aria-label={TL(lang, 'pick_subject')}>
        <button class={'pill' + (!subject ? ' on' : '')} aria-pressed={!subject} onClick={() => void pick(undefined)}><span class="emo">📚</span>{TL(lang, 'all_subjects')}</button>
        {subjects.map((s) => {
          const on = !!subject && s.ids.every((id) => subject.includes(id));
          const look = subjectLook(s.name.en ?? '');
          return <button class={'pill' + (on ? ' on' : '')} style={{ '--sc': look.color }} aria-pressed={on} onClick={() => void pick(s.ids)}><span class="emo">{look.emoji}</span>{s.name[lang] ?? s.name.en}</button>;
        })}
      </nav>

      <main class="feed" aria-live="polite">
        {fresh && (
          <section class="hero">
            <Logo size={56} />
            <h1>{U(lang, 'hello')}{profile.name ? `, ${profile.name}` : ''} 👋</h1>
            <div class="ways">
              <span><Icon name="book" size={16} />{U(lang, 'wayBook')}</span>
              <span><Icon name="mic" size={16} />{U(lang, 'wayVoice')}</span>
              <span><Icon name="offline" size={16} />{U(lang, 'wayOffline')}</span>
            </div>
          </section>
        )}
        {lines.map((l, i) => l.role === 'student'
          ? <div class="msg me"><div class="bubble">{l.text}</div></div>
          : <Tutor m={l.msg} lang={lang} why={l.why} showWhy={showWhy === i} toggleWhy={() => setShowWhy(showWhy === i ? null : i)} openSrc={openSrc} setOpenSrc={setOpenSrc}
              onChip={(c) => { if (c.bookId) void pick([c.bookId]); else if (c.review) void ask('', { review: c.review, show: c.label }); else if (c.text) void ask(c.text); }} />)}
        {fresh && !busy && ideas.length > 0 && (
          <section class="ideas" aria-label={U(lang, 'tryAsking')}>
            <h2><Icon name="spark" size={16} />{U(lang, 'tryAsking')}</h2>
            {ideas.map((q) => <button class="idea" onClick={() => void ask(q)}><span>{q}</span><Icon name="chevron" size={18} /></button>)}
          </section>
        )}
        {busy && <div class="msg tutor"><span class="mark"><Logo size={28} /></span><div class="bubble typing" role="status" aria-label={busy}><i /><i /><i /><span class="sr">{busy}</span></div></div>}
        <div ref={end} />
      </main>

      <footer class="composer">
        {answering && <div class="answering"><Icon name="help" size={16} /><span><b>{U(lang, 'quickCheck')}:</b> {memory.check}</span></div>}
        {listening && <div class="listening" role="status"><i class="wave" />{t(lang, mic === 'rec' ? 'listening' : 'speakNow')}</div>}
        <form class="inputrow" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <label class={'iconbtn ghost' + (busy ? ' disabled' : '')} aria-label={t(lang, 'snap')} title={t(lang, 'snap')}>
            <Icon name="camera" />
            <input type="file" accept="image/*" capture="environment" hidden disabled={!!busy} onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) void onPhoto(f); }} />
          </label>
          <textarea class="field" rows={1} aria-label={t(lang, 'ask')} placeholder={placeholder} value={text}
            onInput={(e) => { const el = e.target as HTMLTextAreaElement; setText(el.value); el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          {text.trim()
            ? <button class="iconbtn send" type="submit" disabled={!!busy} aria-label={t(lang, 'send')}><Icon name="send" /></button>
            : <button type="button" class={'iconbtn send' + (listening ? ' rec' : '')} aria-pressed={listening} aria-label={t(lang, 'mic')} disabled={!!busy || mic === 'hearing'} onClick={() => void onMic()}><Icon name={listening ? 'stop' : 'mic'} /></button>}
        </form>
      </footer>

      {sheet && <div class="scrim" onClick={() => setSheet(null)} />}
      {sheet === 'progress' && (
        <section class="sheet" role="dialog" aria-label={TL(lang, 'progress')}>
          <div class="grab" />
          <header><h2>{TL(lang, 'progress')}</h2><button class="iconbtn" aria-label={t(lang, 'close')} onClick={() => setSheet(null)}><Icon name="close" /></button></header>
          {memory.topics.length ? memory.topics.map((x) => {
            const pc = Math.round(x.pKnown * 100);
            const state = x.pKnown >= 0.85 ? 'done' : x.pKnown >= 0.5 ? 'mid' : 'low';
            return (
              <div class={'topic ' + state}>
                <div class="ring" style={{ '--p': pc }}><span>{pc}%</span></div>
                <div><b>{x.chapter}</b><span class="muted small">{x.subject} · {U(lang, state)}</span></div>
              </div>
            );
          }) : <p class="empty">{TL(lang, 'no_progress')}</p>}
          {physics && <button class="wide" onClick={() => { setSheet(null); onGuided(); }}><Icon name="play" size={18} />{TL(lang, 'guided')}</button>}
          <button class="wide ghost" onClick={() => { setSheet(null); onSwitch(); }}><Icon name="users" size={18} />{t(lang, 'switchLearner')}</button>
        </section>
      )}
      {sheet === 'lang' && (
        <section class="sheet" role="dialog" aria-label={t(lang, 'chooseLang')}>
          <div class="grab" />
          <header><h2>{t(lang, 'chooseLang')}</h2><button class="iconbtn" aria-label={t(lang, 'close')} onClick={() => setSheet(null)}><Icon name="close" /></button></header>
          {LANGS.map((l) => <button class={'option' + (l.id === lang ? ' on' : '')} aria-pressed={l.id === lang} onClick={() => { setSheet(null); void onLang(l.id); }}>{l.label}{l.id === lang && <Icon name="check" />}</button>)}
        </section>
      )}
    </div>
  );
}

const LOOKS: Record<string, { emoji: string; color: string }> = {
  'Life Science': { emoji: '🌿', color: '#2f855a' },
  'Geography & Economics': { emoji: '🌏', color: '#2b6cb0' },
  'Physical Science': { emoji: '⚡', color: '#6b46c1' },
  'History & Political Science': { emoji: '🏛️', color: '#b7791f' },
  Mathematics: { emoji: '➗', color: '#c05621' },
};
const subjectLook = (en: string) => LOOKS[en] ?? { emoji: '📘', color: '#1f5a60' };

/** First questions to tap, per book, written as a student would ask them (checked against the books' pages). */
const IDEAS: Record<string, Record<string, string[]>> = {
  'life-science-9': { or: ['ରକ୍ତ କଣିକା କେତେ ପ୍ରକାର?', 'ଜୀବକୋଷ କ\'ଣ?'], en: ['What are the types of blood cells?', 'What is a cell?'] },
  'geography-economics-9': { or: ['ମୌସୁମୀ ବାୟୁ କ\'ଣ?', 'ବ୍ୟାଙ୍କ କ\'ଣ କାମ କରେ?'], en: ['What is the monsoon?', 'What does a bank do?'] },
  'disaster-management-9': { or: ['ସଡ଼କ ଦୁର୍ଘଟଣାର କାରଣ କ\'ଣ?'], en: ['Why do road accidents happen?'] },
  'physical-science-9': { or: ['ବେଗ ଓ ପରିବେଗ ମଧ୍ୟରେ ପାର୍ଥକ୍ୟ କ\'ଣ?', 'ମହାକର୍ଷଣ କ\'ଣ?'], en: ['What is the difference between speed and velocity?', 'What is gravitation?'] },
  'history-polsci-9': { or: ['ପ୍ରଥମ ବିଶ୍ୱଯୁଦ୍ଧର କାରଣ କ\'ଣ?', 'ମୌଳିକ ଅଧିକାର କ\'ଣ?'], en: ['What caused the First World War?', 'What are fundamental rights?'] },
  'algebra-9': { or: ['ସମ୍ଭାବ୍ୟତା କ\'ଣ?'], en: ['What is probability?'] },
  'geometry-9': { or: ['ଚତୁର୍ଭୁଜ କେତେ ପ୍ରକାର?'], en: ['What are the types of quadrilaterals?'] },
};
function suggestions(ids: string[], lang: string) {
  const rank = (id: string) => { const i = Object.keys(IDEAS).indexOf(id); return i < 0 ? 99 : i; };
  const per = [...new Set(ids)].sort((x, y) => rank(x) - rank(y)).map((id) => IDEAS[id]?.[lang] ?? IDEAS[id]?.en ?? []);
  const out: string[] = [];
  for (let i = 0; out.length < 4 && i < 3; i++) for (const qs of per) if (qs[i] && out.length < 4) out.push(qs[i]!);
  return out;
}

const UI: Record<string, Record<string, string>> = {
  or: { noBooksYet: 'ଏବେ ନେଟ୍ ନାହିଁ, ଆଉ ତୁମ ବହି ଏହି ଫୋନରେ ଏପର୍ଯ୍ୟନ୍ତ ସେଭ୍ ହୋଇନାହିଁ। ପ୍ରଶ୍ନଟି ମୁଁ ରଖିଲି — ନେଟ୍ ଆସିଲେ ଉତ୍ତର ଦେବି।', askShort: 'ପ୍ରଶ୍ନ ପଚାର…', answerShort: 'ଉତ୍ତର ଲେଖ, ବା ନୂଆ ପ୍ରଶ୍ନ…', hello: 'ନମସ୍କାର', heroLine: 'ତୁମ ବହିର ଯେକୌଣସି ପ୍ରଶ୍ନ ପଚାର। ମୁଁ ତୁମ ବହିରୁ ବୁଝାଇବି, ଛୋଟ ପ୍ରଶ୍ନ ପଚାରି ଦେଖିବି ତୁମେ ବୁଝିଲ କି ନାହିଁ, ଆଉ ମନେ ରଖିବି।', wayBook: 'ତୁମ ବହିରୁ', wayVoice: 'କହି ପଚାର', wayOffline: 'ନେଟ୍ ବିନା ବି', tryAsking: 'ଏମିତି ପଚାରି ପାରିବ', quickCheck: 'ଛୋଟ ପ୍ରଶ୍ନ', keyWords: 'ମୁଖ୍ୟ ଶବ୍ଦ', fromBook: 'ତୁମ ବହିରୁ', showMore: 'ପୂରା ଅଂଶ ଦେଖ', showLess: 'କମ୍ ଦେଖ', scanned: 'ବହିର ସ୍କାନ୍ ଲେଖା — ଛୋଟ ଭୁଲ ଥାଇପାରେ', done: 'ଶିଖିସାରିଛ', mid: 'ଶିଖୁଛ', low: 'ଆଉ ଅଭ୍ୟାସ ଦରକାର', right: 'ଠିକ୍!', partly: 'ପ୍ରାୟ ଠିକ୍', wrong: 'ଆଉ ଥରେ ଦେଖିବା', offline: 'ନେଟ୍ ନାହିଁ', teacher: 'ଶିକ୍ଷକଙ୍କୁ ଜଣାଇଲି', howDecided: 'ମୁଁ କିପରି ଠିକ୍ କଲି' },
  hi: { noBooksYet: 'अभी नेट नहीं है, और तुम्हारी किताब इस फ़ोन पर अभी सेव नहीं हुई। सवाल मैंने रख लिया — नेट आते ही जवाब दूँगा।', askShort: 'सवाल पूछो…', answerShort: 'जवाब लिखो, या नया सवाल…', hello: 'नमस्ते', heroLine: 'अपनी किताब का कोई भी सवाल पूछो। मैं तुम्हारी किताब से समझाऊँगा, छोटा सवाल पूछकर देखूँगा कि समझ आया या नहीं, और याद रखूँगा।', wayBook: 'तुम्हारी किताब से', wayVoice: 'बोलकर पूछो', wayOffline: 'बिना नेट भी', tryAsking: 'ऐसे पूछ सकते हो', quickCheck: 'छोटा सवाल', keyWords: 'मुख्य शब्द', fromBook: 'तुम्हारी किताब से', showMore: 'पूरा हिस्सा देखो', showLess: 'कम देखो', scanned: 'किताब का स्कैन किया पाठ — छोटी गलतियाँ हो सकती हैं', done: 'सीख लिया', mid: 'सीख रहे हो', low: 'और अभ्यास चाहिए', right: 'सही!', partly: 'लगभग सही', wrong: 'एक बार और देखें', offline: 'नेट नहीं है', teacher: 'शिक्षक को बताया', howDecided: 'मैंने कैसे तय किया' },
  en: { noBooksYet: "No internet right now, and your books aren't saved on this phone yet. I kept your question — I'll answer when you're online.", askShort: 'Ask a question…', answerShort: 'Your answer, or a new question…', hello: 'Hello', heroLine: 'Ask anything from your textbook. I explain from your own book, ask a small question to check you understood, and remember what you find hard.', wayBook: 'From your book', wayVoice: 'Ask by voice', wayOffline: 'Works offline', tryAsking: 'Try asking', quickCheck: 'Quick check', keyWords: 'Key words', fromBook: 'From your book', showMore: 'Show the whole part', showLess: 'Show less', scanned: 'Scanned from the book — may have small mistakes', done: 'Learned', mid: 'Learning', low: 'Needs practice', right: 'Right!', partly: 'Almost', wrong: "Let's look again", offline: 'No internet', teacher: 'Teacher told', howDecided: 'How I decided' },
};
const U = (lang: string, k: string) => UI[lang]?.[k] ?? UI.en![k] ?? k;

const TONE: Record<string, { icon: string; key: string }> = {
  praise: { icon: 'check', key: 'right' }, hint: { icon: 'spark', key: 'partly' }, retry: { icon: 'help', key: 'wrong' },
  offline: { icon: 'offline', key: 'offline' }, teacher: { icon: 'users', key: 'teacher' },
};

function Tutor({ m, lang, why, showWhy, toggleWhy, openSrc, setOpenSrc, onChip }: { m: TMsg; lang: string; why?: string; showWhy: boolean; toggleWhy: () => void; openSrc: string | null; setOpenSrc: (id: string | null) => void; onChip: (c: NonNullable<TMsg['chips']>[number]) => void }) {
  const [full, setFull] = useState(false);
  const spoken = m.text + (m.check ? ' ' + m.check : '');
  const care = m.tone === 'care';
  const tone = m.tone ? TONE[m.tone] : undefined;
  return (
    <div class="msg tutor">
      <span class="mark"><Logo size={28} /></span>
      <div class={'bubble ' + (m.tone ?? '')} role={care ? 'alert' : undefined}>
        {tone && <span class="badge"><Icon name={tone.icon} size={14} />{U(lang, tone.key)}</span>}
        <p class="say">{care ? m.text.split(/(1098|14416|112)/).map((x, i) => (i % 2 ? <a class="tel" href={`tel:${x}`}>{x}</a> : x)) : m.text}</p>
        {m.terms?.length ? <div class="terms" aria-label={U(lang, 'keyWords')}>{m.terms.map((x) => <span class="term"><b>{x.or}</b><i>{x.en}</i></span>)}</div> : null}
        {m.check && <div class="qcheck"><span class="label"><Icon name="help" size={15} />{U(lang, 'quickCheck')}</span><p>{m.check}</p></div>}
        {m.sources?.map((s) => {
          const open = openSrc === s.passageId;
          return (
            <div class={'source' + (open ? ' open' : '')}>
              <button class="srchead" aria-expanded={open} onClick={() => { setFull(false); setOpenSrc(open ? null : s.passageId); }}>
                <span class="bk"><Icon name="book" size={16} /></span>
                <span class="where"><b>{s.chapter || U(lang, 'fromBook')}</b><span>{s.subject}</span></span>
                {s.page ? <span class="pg">{TL(lang, 'page')} {s.page}</span> : null}
                <Icon name="down" size={16} />
              </button>
              {open && <div class="quote">
                <p>{full && s.full ? s.full : s.quote}</p>
                {s.full && s.full !== s.quote && <button class="textbtn" onClick={() => setFull(!full)}>{U(lang, full ? 'showLess' : 'showMore')}</button>}
                <span class="scannote">{U(lang, 'scanned')}</span>
              </div>}
            </div>
          );
        })}
        {m.chips?.length ? <div class="chips">{m.chips.map((c) => <button class="chip" onClick={() => onChip(c)}>{c.label}</button>)}</div> : null}
        <div class="actions">
          <button class="mini" aria-label={t(lang, 'speak')} onClick={() => speak(spoken, lang)}><Icon name="volume" size={16} />{t(lang, 'speak')}</button>
          {why && <button class="mini" aria-expanded={showWhy} onClick={toggleWhy}><Icon name="info" size={16} />{U(lang, 'howDecided')}</button>}
        </div>
        {showWhy && why && <pre class="why">{why}</pre>}
      </div>
    </div>
  );
}

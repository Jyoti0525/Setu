// The tutor chat (PLAN v4): the main screen. She picks a subject (or not) and talks — typed in Odia or English letters,
// spoken, or a photo of the page. Online the server agent answers from her textbook, checks she understood, grades her
// reply and remembers per chapter. Offline the same policy runs here on the downloaded books: it reads her the right
// textbook passage and keeps the question; the full answer arrives when the signal is back.

import { useEffect, useRef, useState } from 'preact/hooks';
import { boardKey, nameIn, emptyMemory, LANGUAGES, localeOf, focusQuote, planTurn, screen, scrubPii, Shelf, T, TL, type BookIndex, type BookMeta } from '@setu/core';
import type { Agent } from './agent.ts';
import { getMeta, setMeta } from './db.ts';
import { bookLink, fetchWithTimeout, goodLink } from './net.ts';
import { install, installState, onInstall, type InstallState } from './install.ts';
import { t, speak, LANGS } from './i18n.ts';
import { readOnline, readOffline, ocrReady } from './snap.ts';
import { canRecord, record, transcribe, hasWebSpeech, webSpeech, serverListens, type Recording } from './listen.ts';
import type { Tier } from '@setu/core';
import { Icon, Logo } from './icons.tsx';

/** quote: the sentences that answer her question; full: the whole passage (both cleaned scans of the printed book) */
interface Source { bookId: string; subject: string; chapter: string; page: number; passageId: string; quote: string; full?: string; figures?: { src: string; text: string }[] }
/** the figures printed on a source's page (the picture comes from the server, or the phone's cache with no signal) */
const figs = (sh: Shelf, bookId: string, page: number) => {
  const f = sh.figuresOn(bookId, page).slice(0, 3).map((p) => ({ src: `/figure/${p.fig}`, text: p.text }));
  return f.length ? { figures: f } : {};
};
interface TMsg { text: string; sources?: Source[]; check?: string; terms?: { or: string; en: string }[]; home?: { name: string; words: { or: string; home: string }[] }; tone?: string; chips?: Chip[]; by: 'model' | 'policy' }
type Line = { role: 'student'; text: string; at: number; queued?: boolean } | { role: 'tutor'; msg: TMsg; at: number; why?: string };
interface Memory { topics: { key: string; subject: string; chapter: string; pKnown: number }[]; check?: string; lesson?: { topic: string; part: number; parts: number; chapter: string } }
/** A button in a tutor message: send text, quiz a chapter, pick a subject ([] = all) or chapter, learn a chapter, ask in it. */
interface Chip { label: string; text?: string; review?: string; bookId?: string; subject?: string[]; chapter?: string; learn?: string; ask?: string }
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
  agent: Agent; lang: string; tier: Tier; profile: { id: string; avatar: string; name?: string; board?: string; home?: string };
  onGuided: () => void; onSwitch: () => void; onLang: (l: string) => Promise<void>;
}) {
  const pid = profile.id;
  // her board's books only (one phone may hold learners of different boards: the list is kept whole, filtered here)
  const board = profile.board ?? 'BSE Odisha';
  const mine = (list: BookInfo[]) => { const m = list.filter((b) => boardKey(b.board) === boardKey(board)); return m.length ? m : list; };
  const online = tier !== 'device' && !!agent.device;
  const [lines, setLines] = useState<Line[]>([]);
  const [books, setBooks] = useState<BookInfo[]>([]);
  const [subject, setSubject] = useState<string[] | undefined>(undefined);
  /** the chapter she picked (topic key `bookId#n`): her doubts are searched there first */
  const [focus, setFocus] = useState<string | undefined>(undefined);
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [memory, setMemory] = useState<Memory>({ topics: [] });
  const [openSrc, setOpenSrc] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState<number | null>(null);
  const [sheet, setSheet] = useState<'progress' | 'lang' | null>(null);
  const [mic, setMic] = useState<'idle' | 'rec' | 'live' | 'hearing'>('idle');
  // install on the home screen (P7.6): Chrome's own sheet, or the Safari steps on an iPhone
  const [inst, setInst] = useState<InstallState>(installState());
  const [iosHelp, setIosHelp] = useState(false);
  useEffect(() => onInstall(setInst), []);
  const rec = useRef<Recording | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const shelf = useRef<Shelf | null>(null);
  const started = useRef(false);
  const headers = () => ({ 'content-type': 'application/json', 'x-device-token': agent.device!.token });
  const add = (l: Line[]) => setLines((p) => { const n = keep([...p, ...l]); void setMeta(`chat:${pid}`, n); return n; });

  // start: her conversation so far (kept on the phone), her subjects, then the agent speaks first
  useEffect(() => {
    void (async () => {
      setLines(await getMeta<Line[]>(`chat:${pid}`, []));
      setSubject(await getMeta<string[] | undefined>(`subject:${pid}`, undefined));
      setFocus(await getMeta<string | undefined>(`chapter:${pid}`, undefined));
      setMemory(await getMeta<Memory>(`memory:${pid}`, { topics: [] }));
      setBooks(mine(await getMeta<BookInfo[]>('books', [])));
      if (online) {
        started.current = true;
        await agent.sync().catch(() => null); // her profile reaches the server before the tutor writes for her
        try {
          const r = await fetchWithTimeout('/api/books', { headers: headers() }, 8000);
          if (r.ok) { const list = (await r.json()) as BookInfo[]; setBooks(mine(list)); await setMeta('books', list); }
        } catch { /* offline after all */ }
        if (!(await openSession())) greetLocally();
        await sendQueued();
      } else add([{ role: 'tutor', msg: { text: `${TL(lang, 'welcome_back')}\n${TL(lang, 'ask_subject')}`, by: 'policy', chips: subjectChips(mine(await getMeta<BookInfo[]>('books', []))) }, at: Date.now() }]);
    })();
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines.length, busy]);
  // signal back → kept questions are answered now
  useEffect(() => { if (online) void sendQueued(); }, [tier]);
  // opened before the link was known: once it is up, fetch her books and let the agent speak first
  useEffect(() => {
    if (!online || started.current) return;
    started.current = true;
    void (async () => {
      try { const r = await fetchWithTimeout('/api/books', { headers: headers() }, 8000); if (r.ok) { const list = (await r.json()) as BookInfo[]; setBooks(mine(list)); await setMeta('books', list); } } catch { /* stays local */ }
      if (!(await openSession())) greetLocally();
    })();
  }, [online]);
  /** the server did not answer the opener: the phone still asks which subject (never a silent, empty chat) */
  async function greetLocally() {
    const list = mine(await getMeta<BookInfo[]>('books', []));
    setLines((p) => p.length ? p : [{ role: 'tutor', msg: { text: `${TL(lang, 'welcome')}
${TL(lang, 'ask_subject')}`, by: 'policy', chips: subjectChips(list) }, at: Date.now() }]);
  }
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
      if (!info) continue;
      if (have?.version === info.version) { void keepFigures(have); continue; } // a book saved before its pictures were
      try { const r = await fetchWithTimeout(`/api/book/${id}`, { headers: headers() }, 30000); if (r.ok) { const b = (await r.json()) as BookIndex; await setMeta(`book:${id}`, b); shelf.current = null; void keepFigures(b); } } catch { return; }
    }
  }
  /** the book's pictures (~40 KB each) into the phone's figure cache, on Wi-Fi/4G only, so answer cards show them offline */
  async function keepFigures(b: BookIndex) {
    if (!goodLink() || !('caches' in window)) return;
    const cache = await caches.open('setu-figures');
    for (const p of b.passages) {
      if (!p.fig || (await cache.match(`/figure/${p.fig}`))) continue;
      try { const r = await fetch(`/figure/${p.fig}`); if (r.ok) await cache.put(`/figure/${p.fig}`, r); } catch { return; }
    }
  }
  async function localShelf(): Promise<Shelf> {
    if (shelf.current) return shelf.current;
    const all: BookIndex[] = [];
    for (const b of books) { const x = await getMeta<BookIndex | null>(`book:${b.id}`, null); if (x) all.push(x); }
    shelf.current = new Shelf(all);
    return shelf.current;
  }

  async function openSession(): Promise<boolean> {
    try {
      const r = await fetchWithTimeout('/api/tutor/open', { method: 'POST', headers: headers(), body: JSON.stringify({ profileId: pid, lang, bookIds: subject, board }) }, 8000);
      // the server no longer knows this phone (its data was reset): register again, once
      if (r.status === 401 && !sessionStorage.getItem('re-device')) { sessionStorage.setItem('re-device', '1'); await setMeta('device', null); location.reload(); return false; }
      if (!r.ok) return false;
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
      return true;
    } catch { return false; }
  }

  /** One message to the agent: online the server; no signal (or it drops mid-way) the phone. */
  async function ask(raw: string, opts: { mode?: 'text' | 'voice' | 'photo'; review?: string; learn?: string; show?: string } = {}) {
    const msg = scrubPii(raw, profile.name ? [profile.name] : []).trim();
    if (!msg && !opts.review && !opts.learn) return;
    add([{ role: 'student', text: opts.show ?? msg, at: Date.now() }]);
    const turnId = crypto.randomUUID();
    if (online) {
      setBusy(t(lang, 'thinking'));
      try {
        const chapter = opts.learn || opts.review ? undefined : focus;
        const r = await fetchWithTimeout('/api/tutor/turn', { method: 'POST', headers: headers(), body: JSON.stringify({ profileId: pid, text: msg, lang, bookIds: subject, mode: opts.mode ?? 'text', review: opts.review, learn: opts.learn, chapter, turnId, board, home: profile.home }) }, 30000);
        if (r.ok) {
          const j = (await r.json()) as { messages: TMsg[]; memory: Memory; trace: { chosen: string; reason: string; tools: { tool: string; note?: string }[] } };
          const why = `${j.trace.chosen} — ${j.trace.reason}\n${j.trace.tools.map((x) => x.tool + (x.note ? ` (${x.note})` : '')).join(' → ')}`;
          add(j.messages.map((m, i) => ({ role: 'tutor' as const, msg: m, at: Date.now(), ...(i === j.messages.length - 1 ? { why } : {}) })));
          setMemory(j.memory); void setMeta(`memory:${pid}`, j.memory);
          return;
        }
      } catch { /* signal dropped mid-turn → the phone answers below */ } finally { setBusy(null); }
    }
    if (opts.learn || opts.review) return void await offlineLesson((opts.learn ?? opts.review)!, !!opts.learn);
    await offlineTurn(msg, turnId);
  }

  /** No signal in a lesson: she reads the part from her book now; the explanation and the check come when online. */
  async function offlineLesson(topic: string, learning: boolean) {
    const sh = await localShelf();
    const [bookId, ch] = topic.split('#');
    const part = learning && memory.lesson?.topic === topic ? memory.lesson.part : 0;
    const ps = sh.lessonParts(bookId!, Number(ch))[part] ?? [];
    const name = (x?: { or: string; en: string; hi?: string }) => nameIn(x, lang);
    const src: Source[] = ps.slice(0, 2).map((p) => ({ bookId: bookId!, subject: name(sh.books.get(bookId!)?.meta.subject), chapter: name(sh.chapterOf(bookId!, p.ch)?.title), page: p.page, passageId: p.id, quote: p.text, ...figs(sh, bookId!, p.page) }));
    add([{ role: 'tutor', msg: { text: TL(lang, src.length ? 'offline_passage' : 'offline_none'), tone: 'offline', sources: src, by: 'policy' }, at: Date.now(), why: `no signal → lesson ${topic}: part ${part + 1} shown from the book on this phone` }]);
  }

  // ---------- the guided path: subject → chapter → teach / quiz / doubt (the agent asks; she can always just type) ----------
  const titleOf = (x?: { or: string; en: string; hi?: string }) => nameIn(x, lang);
  function subjectChips(list: BookInfo[] = books): Chip[] { return subjectsOf(list).map((s) => ({ label: nameIn(s.name as { or: string; en: string; hi?: string }, lang), subject: s.ids })); }
  function chapterChips(ids: string[]): Chip[] {
    return ids.flatMap((id) => (books.find((b) => b.id === id)?.chapters ?? []).map((c) => ({ label: `${c.n}. ${titleOf(c.title)}`, chapter: `${id}#${c.n}` })));
  }
  const chapterName = (topic: string) => { const [id, n] = topic.split('#'); return titleOf(books.find((b) => b.id === id)?.chapters.find((c) => c.n === Number(n))?.title) || topic; };
  const say = (text: string, chips?: Chip[], why?: string) => add([{ role: 'tutor', msg: { text, by: 'policy', ...(chips ? { chips } : {}) }, at: Date.now(), ...(why ? { why } : {}) }]);
  const setChapter = async (c: string | undefined) => { setFocus(c); await setMeta(`chapter:${pid}`, c); };

  async function onChip(c: Chip) {
    const ids = c.subject ?? (c.bookId ? [c.bookId] : undefined);
    if (ids) {
      add([{ role: 'student', text: c.label, at: Date.now() }]);
      await setChapter(undefined);
      if (!ids.length) { await pick(undefined); return say(TL(lang, 'ask_subject'), subjectChips(), 'she wants another subject → list her subjects'); }
      await pick(ids);
      const s = subjectsOf(books).find((x) => x.ids.some((id) => ids.includes(id)));
      return say(TL(lang, 'ask_chapter', s?.name[lang] ?? s?.name.en ?? c.label), chapterChips(ids), 'subject picked → list its chapters');
    }
    if (c.chapter) {
      add([{ role: 'student', text: c.label, at: Date.now() }]);
      await setChapter(c.chapter);
      return say(TL(lang, 'ask_mode', chapterName(c.chapter)), [{ label: `📖 ${TL(lang, 'mode_teach')}`, learn: c.chapter }, { label: `✍️ ${TL(lang, 'mode_quiz')}`, review: c.chapter }, { label: `❓ ${TL(lang, 'mode_ask')}`, ask: c.chapter }], 'chapter picked → teach it part by part, quiz her, or take her own doubt');
    }
    if (c.learn) { await setChapter(c.learn); return void ask('', { learn: c.learn, show: c.label }); }
    if (c.review) return void ask('', { review: c.review, show: c.label });
    if (c.ask) {
      add([{ role: 'student', text: c.label, at: Date.now() }]);
      await setChapter(c.ask);
      say(TL(lang, 'ask_doubt', chapterName(c.ask)), undefined, 'her own doubt → searched in this chapter first');
      return field.current?.focus();
    }
    if (c.text) void ask(c.text);
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
    const hits = sh.search(msg, { limit: 4, picked: subject });
    const plan = planTurn(emptyMemory(), { safety, text: msg, hits, bookIds: subject, online: false, now: Date.now() });
    if (plan.action === 'care' || plan.action === 'decline' || plan.action === 'redirect') {
      // the safety replies need no signal; a distress message is never kept or sent later
      add([{ role: 'tutor', msg: { text: T(lang, plan.action === 'care' ? 'care' : plan.action === 'decline' ? 'decline' : safety === 'personal' ? 'privacy' : 'redirect'), tone: plan.action === 'care' ? 'care' : 'info', by: 'policy' }, at: Date.now(), why: plan.reason }]);
      return;
    }
    const h = plan.grounding[0];
    const name = (x?: { or: string; en: string; hi?: string }) => nameIn(x, lang);
    const quote = h ? focusQuote(h.passage.text, msg) : '';
    const src: Source[] | undefined = h ? [{ bookId: h.bookId, subject: name(sh.books.get(h.bookId)?.meta.subject), chapter: name(sh.chapterOf(h.bookId, h.passage.ch)?.title), page: h.passage.page, passageId: h.passage.id, quote, ...(quote !== h.passage.text ? { full: h.passage.text } : {}), ...figs(sh, h.bookId, h.passage.page) }] : undefined;
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
        const r = await fetchWithTimeout('/api/tutor/turn', { method: 'POST', headers: headers(), body: JSON.stringify({ profileId: pid, text: x.text, lang, bookIds: x.bookIds, queuedAt: x.at, turnId: x.id, board, home: profile.home }) }, 30000);
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
      if (online && agent.device) read = (await readOnline(agent.device, file, lang))?.text ?? '';
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
        {(inst === 'prompt' || inst === 'ios') && <button class="iconbtn" aria-label={U(lang, 'install')} title={U(lang, 'install')} onClick={() => (inst === 'prompt' ? void install() : setIosHelp(true))}><Icon name="install" /></button>}
        <button class="iconbtn" aria-label={t(lang, 'chooseLang')} aria-pressed={sheet === 'lang'} onClick={() => setSheet('lang')}><Icon name="globe" /></button>
      </header>
      {iosHelp && <button class="installhelp" role="status" onClick={() => setIosHelp(false)}>{U(lang, 'installIos')} ✕</button>}

      <nav class="subjects" aria-label={TL(lang, 'pick_subject')}>
        <button class={'pill' + (!subject ? ' on' : '')} aria-pressed={!subject} onClick={() => { void pick(undefined); void setChapter(undefined); }}><span class="emo">📚</span>{TL(lang, 'all_subjects')}</button>
        {subjects.map((s) => {
          const on = !!subject && s.ids.every((id) => subject.includes(id));
          const look = subjectLook(s.name.en ?? '');
          return <button class={'pill' + (on ? ' on' : '')} style={{ '--sc': look.color }} aria-pressed={on} onClick={() => void onChip({ label: nameIn(s.name as { or: string; en: string; hi?: string }, lang), subject: s.ids })}><span class="emo">{look.emoji}</span>{nameIn(s.name as { or: string; en: string; hi?: string }, lang)}</button>;
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
            {LANGUAGES[lang]?.draft && <p class="small muted">{U(lang, 'draftLang')}</p>}
            {profile.home && LANGUAGES[profile.home] && <p class="small muted">🏠 {LANGUAGES[profile.home]!.name} · {U(lang, 'homeNote').replace('{0}', LANGUAGES[profile.home]!.name)}</p>}
            {(inst === 'prompt' || inst === 'ios') && <button class="install" onClick={() => (inst === 'prompt' ? void install() : setIosHelp(!iosHelp))}><Icon name="install" size={18} />{U(lang, 'install')}</button>}
          </section>
        )}
        {lines.map((l, i) => l.role === 'student'
          ? <div class="msg me"><div class="bubble">{l.text}</div></div>
          : <Tutor m={l.msg} lang={lang} why={l.why} showWhy={showWhy === i} toggleWhy={() => setShowWhy(showWhy === i ? null : i)} openSrc={openSrc} setOpenSrc={setOpenSrc}
              onChip={(c) => { if (!busy) void onChip(c); }} />)}
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
          <textarea ref={field} class="field" rows={1} aria-label={t(lang, 'ask')} placeholder={placeholder} value={text}
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
          {(inst === 'prompt' || inst === 'ios') && <button class="wide ghost" onClick={() => { if (inst === 'prompt') void install(); else { setSheet(null); setIosHelp(true); } }}><Icon name="install" size={18} />{U(lang, 'install')}</button>}
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
  Science: { emoji: '🔬', color: '#2f855a' },
  'Social Science': { emoji: '🌏', color: '#2b6cb0' },
  'Geography & Economics': { emoji: '🌏', color: '#2b6cb0' },
  'Physical Science': { emoji: '⚡', color: '#6b46c1' },
  'History & Political Science': { emoji: '🏛️', color: '#b7791f' },
  Mathematics: { emoji: '➗', color: '#c05621' },
  Odia: { emoji: 'ଅ', color: '#c53030' },
  English: { emoji: '🔤', color: '#2c7a7b' },
  Hindi: { emoji: 'अ', color: '#d69e2e' },
  Sanskrit: { emoji: 'सं', color: '#975a16' },
};
const subjectLook = (en: string) => LOOKS[en] ?? { emoji: '📘', color: '#1f5a60' };

const UI: Record<string, Record<string, string>> = {
  or: { install: 'ସେତୁକୁ ଫୋନରେ ରଖ', installIos: 'Safari ତଳେ Share ⬆ ଦବାଅ, ତାପରେ "Add to Home Screen" ବାଛ।', noBooksYet: 'ଏବେ ନେଟ୍ ନାହିଁ, ଆଉ ତୁମ ବହି ଏହି ଫୋନରେ ଏପର୍ଯ୍ୟନ୍ତ ସେଭ୍ ହୋଇନାହିଁ। ପ୍ରଶ୍ନଟି ମୁଁ ରଖିଲି — ନେଟ୍ ଆସିଲେ ଉତ୍ତର ଦେବି।', askShort: 'ପ୍ରଶ୍ନ ପଚାର…', answerShort: 'ଉତ୍ତର ଲେଖ, ବା ନୂଆ ପ୍ରଶ୍ନ…', hello: 'ନମସ୍କାର', heroLine: 'ତୁମ ବହିର ଯେକୌଣସି ପ୍ରଶ୍ନ ପଚାର। ମୁଁ ତୁମ ବହିରୁ ବୁଝାଇବି, ଛୋଟ ପ୍ରଶ୍ନ ପଚାରି ଦେଖିବି ତୁମେ ବୁଝିଲ କି ନାହିଁ, ଆଉ ମନେ ରଖିବି।', wayBook: 'ତୁମ ବହିରୁ', wayVoice: 'କହି ପଚାର', wayOffline: 'ନେଟ୍ ବିନା ବି', tryAsking: 'ଏମିତି ପଚାରି ପାରିବ', quickCheck: 'ଛୋଟ ପ୍ରଶ୍ନ', keyWords: 'ମୁଖ୍ୟ ଶବ୍ଦ', fromBook: 'ତୁମ ବହିରୁ', showMore: 'ପୂରା ଅଂଶ ଦେଖ', showLess: 'କମ୍ ଦେଖ', scanned: 'ବହିର ସ୍କାନ୍ ଲେଖା — ଛୋଟ ଭୁଲ ଥାଇପାରେ', done: 'ଶିଖିସାରିଛ', mid: 'ଶିଖୁଛ', low: 'ଆଉ ଅଭ୍ୟାସ ଦରକାର', right: 'ଠିକ୍!', partly: 'ପ୍ରାୟ ଠିକ୍', wrong: 'ଆଉ ଥରେ ଦେଖିବା', offline: 'ନେଟ୍ ନାହିଁ', teacher: 'ଶିକ୍ଷକଙ୍କୁ ଜଣାଇଲି', howDecided: 'ମୁଁ କିପରି ଠିକ୍ କଲି', draftLang: 'ଏହି ଭାଷାର ଉତ୍ତର AI ଲେଖେ — ଏ ଭାଷା ଜାଣିଥିବା ଶିକ୍ଷକ ଏଯାଏଁ ଯାଞ୍ଚ କରିନାହାନ୍ତି।', homeWords: 'ତୁମ ଘର ଭାଷାର ଶବ୍ଦ', homeNote: 'ମୁଁ ସହଜ ଓଡ଼ିଆରେ ବୁଝାଇବି, ଆଉ ଓଡ଼ିଶା ସରକାରଙ୍କ {0} ଶବ୍ଦକୋଷରୁ ତୁମ ଘର ଭାଷାର ଶବ୍ଦ ଯୋଡ଼ିବି।' },
  hi: { install: 'सेतु को फ़ोन पर रखो', installIos: 'Safari में नीचे Share ⬆ दबाओ, फिर "Add to Home Screen" चुनो।', noBooksYet: 'अभी नेट नहीं है, और तुम्हारी किताब इस फ़ोन पर अभी सेव नहीं हुई। सवाल मैंने रख लिया — नेट आते ही जवाब दूँगा।', askShort: 'सवाल पूछो…', answerShort: 'जवाब लिखो, या नया सवाल…', hello: 'नमस्ते', heroLine: 'अपनी किताब का कोई भी सवाल पूछो। मैं तुम्हारी किताब से समझाऊँगा, छोटा सवाल पूछकर देखूँगा कि समझ आया या नहीं, और याद रखूँगा।', wayBook: 'तुम्हारी किताब से', wayVoice: 'बोलकर पूछो', wayOffline: 'बिना नेट भी', tryAsking: 'ऐसे पूछ सकते हो', quickCheck: 'छोटा सवाल', keyWords: 'मुख्य शब्द', fromBook: 'तुम्हारी किताब से', showMore: 'पूरा हिस्सा देखो', showLess: 'कम देखो', scanned: 'किताब का स्कैन किया पाठ — छोटी गलतियाँ हो सकती हैं', done: 'सीख लिया', mid: 'सीख रहे हो', low: 'और अभ्यास चाहिए', right: 'सही!', partly: 'लगभग सही', wrong: 'एक बार और देखें', offline: 'नेट नहीं है', teacher: 'शिक्षक को बताया', howDecided: 'मैंने कैसे तय किया', draftLang: 'इस भाषा के जवाब AI लिखता है — इस भाषा के किसी शिक्षक ने अभी तक इन्हें जाँचा नहीं है।', homeWords: 'तुम्हारी घर की भाषा के शब्द', homeNote: 'मैं आसान ओड़िया में समझाऊँगा, और ओडिशा सरकार के {0} शब्दकोश से तुम्हारी घर की भाषा के शब्द जोड़ूँगा।' },
  en: { install: 'Install Setu on this phone', installIos: 'In Safari, tap Share ⬆ at the bottom, then "Add to Home Screen".', noBooksYet: "No internet right now, and your books aren't saved on this phone yet. I kept your question — I'll answer when you're online.", askShort: 'Ask a question…', answerShort: 'Your answer, or a new question…', hello: 'Hello', heroLine: 'Ask anything from your textbook. I explain from your own book, ask a small question to check you understood, and remember what you find hard.', wayBook: 'From your book', wayVoice: 'Ask by voice', wayOffline: 'Works offline', tryAsking: 'Try asking', quickCheck: 'Quick check', keyWords: 'Key words', fromBook: 'From your book', showMore: 'Show the whole part', showLess: 'Show less', scanned: 'Scanned from the book — may have small mistakes', done: 'Learned', mid: 'Learning', low: 'Needs practice', right: 'Right!', partly: 'Almost', wrong: "Let's look again", offline: 'No internet', teacher: 'Teacher told', howDecided: 'How I decided', draftLang: 'Replies in this language are written by AI and not yet checked by a teacher who speaks it.', homeWords: 'Words in your home language', homeNote: 'I explain in easy Odia and add words of your home language from the Government of Odisha {0} dictionary.' },
};
const U = (lang: string, k: string) => UI[lang]?.[k] ?? localeOf(lang)?.chat[k] ?? UI.en![k] ?? k;

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
        {/* her home language (Kui, Ho…): words from the Government of Odisha dictionary, never made up */}
        {m.home?.words.length ? <div class="terms home" aria-label={`${U(lang, 'homeWords')} · ${m.home.name}`}><span class="small muted">🏠 {m.home.name}</span>{m.home.words.map((x) => <span class="term"><b>{x.or}</b><i>{x.home}</i></span>)}</div> : null}
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
              {s.figures?.length ? <div class="figs">{s.figures.map((f) => (
                <figure class="fig">
                  <a href={f.src} target="_blank" rel="noopener"><img src={f.src} alt={f.text} loading="lazy" onError={(e) => { (e.currentTarget.closest('figure') as HTMLElement).style.display = 'none'; }} /></a>
                  <figcaption>{open ? f.text : f.text.split(' — ')[0]}</figcaption>
                </figure>))}</div> : null}
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

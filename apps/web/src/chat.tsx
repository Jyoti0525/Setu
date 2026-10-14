// The tutor chat (PLAN v4): the main screen. She picks a subject (or not) and talks — typed in Odia or English letters,
// spoken, or a photo of the page. Online the server agent answers from her textbook, checks she understood, grades her
// reply and remembers per chapter. Offline the same policy runs here on the downloaded books: it reads her the right
// textbook passage and keeps the question; the full answer arrives when the signal is back.

import { useEffect, useRef, useState } from 'preact/hooks';
import { emptyMemory, planTurn, screen, scrubPii, Shelf, T, TL, type BookIndex, type BookMeta } from '@setu/core';
import type { Agent } from './agent.ts';
import { getMeta, setMeta } from './db.ts';
import { fetchWithTimeout, goodLink } from './net.ts';
import { t, speak, LANGS } from './i18n.ts';
import { readOnline, readOffline, ocrReady } from './snap.ts';
import { canRecord, record, transcribe, hasWebSpeech, webSpeech, serverListens, type Recording } from './listen.ts';
import type { Tier } from '@setu/core';

interface Source { bookId: string; subject: string; chapter: string; page: number; passageId: string; quote: string }
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
  const [showProgress, setShowProgress] = useState(false);
  const [pickLang, setPickLang] = useState(false);
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
  // the books of her subject live on the phone for offline (text only, ~250 KB each), fetched on a good link
  useEffect(() => { if (online && goodLink()) void downloadBooks(subject ?? books.map((b) => b.id)); }, [books.length, subject?.join(',')]);

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
      add(j.messages.map((msg) => ({ role: 'tutor' as const, msg, at: Date.now() })));
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
    const hits = sh.search(msg, { limit: 4 });
    const plan = planTurn(emptyMemory(), { safety, text: msg, hits, bookIds: subject, online: false, now: Date.now() });
    if (plan.action === 'care' || plan.action === 'decline' || plan.action === 'redirect') {
      // the safety replies need no signal; a distress message is never kept or sent later
      add([{ role: 'tutor', msg: { text: T(lang, plan.action === 'care' ? 'care' : plan.action === 'decline' ? 'decline' : safety === 'personal' ? 'privacy' : 'redirect'), tone: plan.action === 'care' ? 'care' : 'info', by: 'policy' }, at: Date.now(), why: plan.reason }]);
      return;
    }
    const h = plan.grounding[0];
    const src: Source[] | undefined = h ? [{ bookId: h.bookId, subject: sh.books.get(h.bookId)?.meta.subject.or ?? '', chapter: sh.chapterOf(h.bookId, h.passage.ch)?.title.or ?? '', page: h.passage.page, passageId: h.passage.id, quote: h.passage.text }] : undefined;
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
  const placeholder = memory.check && openCheck ? TL(lang, 'answer_here') : t(lang, 'askPlaceholder');

  return (
    <div class="home chat">
      <header class="bar">
        <button class="who link" aria-label={t(lang, 'switchLearner')} onClick={onSwitch}>{profile.avatar} {profile.name ?? ''}</button>
        <button class="link small" aria-label={t(lang, 'chooseLang')} onClick={() => setPickLang(!pickLang)}>{LANGS.find((l) => l.id === lang)?.label ?? lang}</button>
        <button class="link small" aria-pressed={showProgress} onClick={() => setShowProgress(!showProgress)}>📈 {TL(lang, 'progress')}</button>
        <span class={'tier ' + tier} role="status">{t(lang, tier)}</span>
      </header>
      {pickLang && <div class="card"><div class="row">{LANGS.map((l) => <button class={l.id === lang ? 'sel' : ''} aria-pressed={l.id === lang} onClick={() => { setPickLang(false); void onLang(l.id); }}>{l.label}</button>)}</div></div>}
      <nav class="subjects" aria-label={TL(lang, 'pick_subject')}>
        <button class={!subject ? 'sel' : ''} aria-pressed={!subject} onClick={() => void pick(undefined)}>{TL(lang, 'all_subjects')}</button>
        {subjects.map((s) => {
          const on = !!subject && s.ids.every((id) => subject.includes(id));
          return <button class={on ? 'sel' : ''} aria-pressed={on} onClick={() => void pick(s.ids)}>{s.name[lang] ?? s.name.en}</button>;
        })}
      </nav>
      {showProgress && <section class="card progress" aria-label={TL(lang, 'progress')}>
        {memory.topics.length ? memory.topics.map((x) => (
          <div class="m"><div class="mbar"><div style={{ width: `${x.pKnown * 100}%` }} class={x.pKnown >= 0.85 ? 'done' : ''} /></div><span>{x.chapter} <span class="muted small">· {x.subject}</span></span></div>
        )) : <p class="muted small">{TL(lang, 'no_progress')}</p>}
        {physics && <button class="link" onClick={onGuided}>▶ {TL(lang, 'guided')}</button>}
      </section>}

      <main class="feed" aria-live="polite">
        {lines.map((l, i) => l.role === 'student'
          ? <div class="bubble me">{l.text}</div>
          : <Tutor m={l.msg} lang={lang} why={l.why} showWhy={showWhy === i} toggleWhy={() => setShowWhy(showWhy === i ? null : i)} openSrc={openSrc} setOpenSrc={setOpenSrc}
              onChip={(c) => { if (c.bookId) void pick([c.bookId]); else if (c.review) void ask('', { review: c.review, show: c.label }); else if (c.text) void ask(c.text); }} />)}
        {busy && <div class="thinking" role="status">{busy}</div>}
        <div ref={end} />
      </main>

      <footer class="ask">
        {memory.check && openCheck && <p class="small checkhint">❓ {memory.check}</p>}
        <form class="row nowrap" onSubmit={(e) => { e.preventDefault(); if (!text.trim() || busy) return; const x = text; setText(''); void ask(x); }}>
          <input class="text" aria-label={t(lang, 'ask')} placeholder={placeholder} value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
          <button class="primary" type="submit" disabled={!!busy || !text.trim()} aria-label={t(lang, 'send')}>➤</button>
        </form>
        <div class="row">
          <button class={'mic' + (mic === 'rec' || mic === 'live' ? ' on' : '')} aria-pressed={mic === 'rec' || mic === 'live'} disabled={!!busy || mic === 'hearing'} onClick={() => void onMic()}>🎤 {t(lang, mic === 'rec' ? 'listening' : mic === 'hearing' ? 'hearing' : mic === 'live' ? 'speakNow' : 'mic')}</button>
          <label class={'btn' + (busy ? ' disabled' : '')}>📷 {t(lang, 'snap')}
            <input type="file" accept="image/*" capture="environment" hidden disabled={!!busy} onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) void onPhoto(f); }} />
          </label>
        </div>
      </footer>
    </div>
  );
}

function Tutor({ m, lang, why, showWhy, toggleWhy, openSrc, setOpenSrc, onChip }: { m: TMsg; lang: string; why?: string; showWhy: boolean; toggleWhy: () => void; openSrc: string | null; setOpenSrc: (id: string | null) => void; onChip: (c: NonNullable<TMsg['chips']>[number]) => void }) {
  const spoken = m.text + (m.check ? ' ' + m.check : '');
  const care = m.tone === 'care';
  return (
    <div class={'bubble tutor ' + (m.tone ?? '')} role={care ? 'alert' : undefined}>
      <p>{care ? m.text.split(/(1098|14416|112)/).map((x, i) => (i % 2 ? <a href={`tel:${x}`}>{x}</a> : x)) : m.text}</p>
      {m.terms?.length ? <p class="bridge small">📘 {m.terms.map((x) => <span><b>{x.or}</b> = {x.en} </span>)}</p> : null}
      {m.check && <p class="check">❓ {m.check}</p>}
      {m.sources?.map((s) => (
        <div class="src">
          <button class="link small" aria-expanded={openSrc === s.passageId} onClick={() => setOpenSrc(openSrc === s.passageId ? null : s.passageId)}>📖 {s.subject} · {s.chapter}{s.page ? ` · ${TL(lang, 'page')} ${s.page}` : ''}</button>
          {openSrc === s.passageId && <blockquote class="small">{s.quote}</blockquote>}
        </div>
      ))}
      {m.chips?.length ? <div class="row">{m.chips.map((c) => <button class="chip" onClick={() => onChip(c)}>{c.label}</button>)}</div> : null}
      <div class="row tools">
        <button class="icon" aria-label={t(lang, 'speak')} onClick={() => speak(spoken, lang)}>🔊</button>
        {why && <button class="link small" onClick={toggleWhy}>{t(lang, 'why')}</button>}
      </div>
      {showWhy && why && <pre class="why small">{why}</pre>}
    </div>
  );
}

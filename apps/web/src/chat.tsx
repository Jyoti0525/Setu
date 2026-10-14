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
type Line = ({ role: 'student'; text: string; at: number; queued?: boolean } | { role: 'tutor'; msg: TMsg; at: number; why?: string }) & { bookIds?: string[] };
interface Memory { topics: { key: string; subject: string; chapter: string; pKnown: number }[]; check?: string }
type BookInfo = BookMeta & { version: string; passages: number; kb: number };
interface Queued { id: string; text: string; bookIds?: string[]; memoryScope?: string; conversationId?: string; at: number }
interface ChatConversation { id: string; subjectIds: string[]; subjectKey: string; createdAt: number; updatedAt: number; lines: Line[] }

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

const subjectKey = (ids: string[]) => [...ids].sort().join('|');
const memoryKey = (profileId: string, scope?: string) => scope ? `memory:${profileId}:${scope}` : `memory:${profileId}`;
const subjectMemory = async (profileId: string, scope: string) => {
  const current = await getMeta<Memory | undefined>(memoryKey(profileId, scope), undefined);
  if (current) return current;
  // Preserve checks saved by the earlier Mathematics/Geography pilot scope.
  const legacyPilotScope = scope.startsWith('subject:') ? `pilot:${scope.slice('subject:'.length)}` : undefined;
  return legacyPilotScope ? getMeta<Memory>(memoryKey(profileId, legacyPilotScope), { topics: [] }) : { topics: [] };
};
const conversationTitle = (lines: Line[]) => lines.find((line): line is Extract<Line, { role: 'student' }> => line.role === 'student')?.text.trim().slice(0, 56) || 'New chat';
const conversationMatches = (line: Line, ids: string[]) => !!line.bookIds?.some((id) => ids.includes(id));

export function Chat({ agent, lang, tier, profile, identityName, identityEmail, onGuided, onSwitch, onLang, onLogout }: {
  agent: Agent; lang: string; tier: Tier; profile: { id: string; avatar: string; name?: string };
  identityName?: string | null; identityEmail?: string | null;
  onGuided: () => void; onSwitch: () => void; onLang: (l: string) => Promise<void>; onLogout: () => void;
}) {
  const pid = profile.id;
  const online = tier !== 'device' && !!agent.device;
  const [lines, setLines] = useState<Line[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [memoryScope, setMemoryScope] = useState<string | undefined>(undefined);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('setu-sidebar-collapsed') === 'true');
  const [books, setBooks] = useState<BookInfo[]>([]);
  const [subject, setSubject] = useState<string[] | undefined>(undefined);
  const [view, setView] = useState<'overview' | 'chat'>('overview');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [memory, setMemory] = useState<Memory>({ topics: [] });
  const [openSrc, setOpenSrc] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState<number | null>(null);
  const [sheet, setSheet] = useState<'progress' | 'lang' | null>(null);
  const [mic, setMic] = useState<'idle' | 'rec' | 'live' | 'hearing'>('idle');
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('setu-theme');
    return saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const rec = useRef<Recording | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const shelf = useRef<Shelf | null>(null);
  const activeConversationRef = useRef<string | null>(null);
  const memoryScopeRef = useRef<string | undefined>(memoryScope);
  const legacyLinesRef = useRef<Line[]>([]);
  const conversationsRef = useRef(conversations);
  activeConversationRef.current = activeConversationId;
  memoryScopeRef.current = memoryScope;
  conversationsRef.current = conversations;
  const headers = () => ({ 'content-type': 'application/json', 'x-device-token': agent.device!.token });
  const replaceConversations = (next: ChatConversation[]) => { conversationsRef.current = next; setConversations(next); };
  const appendChatLines = (incoming: Line[], bookIds = subject, conversationId = activeConversationId, avoidRepeatedOpener = false) => {
    const scoped = bookIds?.length ? incoming.map((line) => ({ ...line, bookIds })) : incoming;
    if (conversationId) {
      const previous = conversationsRef.current;
      const chat = previous.find((item) => item.id === conversationId);
      if (!chat) return;
      const last = [...chat.lines].reverse().find((line) => line.role === 'tutor');
      const additions = avoidRepeatedOpener ? scoped.filter((line) => !(line.role === 'tutor' && last?.msg.text === line.msg.text)) : scoped;
      const nextLines = [...chat.lines, ...additions];
      const updated = previous.map((item) => item.id === conversationId ? { ...item, lines: nextLines, updatedAt: Date.now() } : item);
      replaceConversations(updated); void setMeta(`chatSessions:${pid}`, updated);
      if (activeConversationRef.current === conversationId) setLines(nextLines);
    } else {
      const previous = legacyLinesRef.current;
      const last = [...previous].reverse().find((line) => line.role === 'tutor');
      const additions = avoidRepeatedOpener ? scoped.filter((line) => !(line.role === 'tutor' && last?.msg.text === line.msg.text)) : scoped;
      const next = keep([...previous, ...additions]);
      legacyLinesRef.current = next; void setMeta(`chat:${pid}`, next);
      if (activeConversationRef.current === null) setLines(next);
    }
  };
  const add = (l: Line[], bookIds = subject, conversationId = activeConversationId) => appendChatLines(l, bookIds, conversationId);

  // start: her conversation so far (kept on the phone), her subjects, then the agent speaks first
  useEffect(() => {
    void (async () => {
      const previousLines = await getMeta<Line[]>(`chat:${pid}`, []);
      legacyLinesRef.current = previousLines;
      setLines(previousLines);
      replaceConversations(await getMeta<ChatConversation[]>(`chatSessions:${pid}`, []));
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
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    localStorage.setItem('setu-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);
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

  async function openSession(bookIds = subject, conversationId = activeConversationId, scope = memoryScope) {
    if (!online) return;
    try {
      const r = await fetchWithTimeout('/api/tutor/open', { method: 'POST', headers: headers(), body: JSON.stringify({ profileId: pid, lang, bookIds, memoryScope: scope }) }, 8000);
      if (!r.ok) return;
      const j = (await r.json()) as { messages: TMsg[]; memory: Memory };
      const incoming = j.messages.map((msg) => ({ role: 'tutor' as const, msg, at: Date.now() }));
      appendChatLines(incoming, bookIds, conversationId, true);
      void setMeta(memoryKey(pid, scope), j.memory);
      if (memoryScopeRef.current === scope) setMemory(j.memory);
    } catch { /* stays quiet: she can still ask */ }
  }

  /** One message to the agent: online the server; no signal (or it drops mid-way) the phone. */
  async function ask(raw: string, opts: { mode?: 'text' | 'voice' | 'photo'; review?: string; show?: string } = {}) {
    setView('chat');
    const msg = scrubPii(raw, profile.name ? [profile.name] : []).trim();
    if (!msg && !opts.review) return;
    add([{ role: 'student', text: opts.show ?? msg, at: Date.now() }]);
    const turnId = crypto.randomUUID();
    if (online) {
      setBusy(t(lang, 'thinking'));
      try {
        const r = await fetchWithTimeout('/api/tutor/turn', { method: 'POST', headers: headers(), body: JSON.stringify({ profileId: pid, text: msg, lang, bookIds: subject, memoryScope, mode: opts.mode ?? 'text', review: opts.review, turnId }) }, 30000);
        if (r.ok) {
          const j = (await r.json()) as { messages: TMsg[]; memory: Memory; trace: { chosen: string; reason: string; tools: { tool: string; note?: string }[] } };
          const why = `${j.trace.chosen} — ${j.trace.reason}\n${j.trace.tools.map((x) => x.tool + (x.note ? ` (${x.note})` : '')).join(' → ')}`;
          add(j.messages.map((m, i) => ({ role: 'tutor' as const, msg: m, at: Date.now(), ...(i === j.messages.length - 1 ? { why } : {}) })));
          void setMeta(memoryKey(pid, memoryScope), j.memory);
          if (memoryScopeRef.current === memoryScope) setMemory(j.memory);
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
      await setMeta(`tutorQueue:${pid}`, [...q, { id, text: msg, bookIds: subject, memoryScope, conversationId: activeConversationId ?? undefined, at: Date.now() }]);
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
    const name = (x?: { or: string; en: string; hi?: string }) => (x ? (lang === 'en' ? x.en : lang === 'hi' ? x.hi ?? x.en : x.or) : '');
    const quote = h ? focusQuote(h.passage.text, msg) : '';
    const src: Source[] | undefined = h ? [{ bookId: h.bookId, subject: name(sh.books.get(h.bookId)?.meta.subject), chapter: name(sh.chapterOf(h.bookId, h.passage.ch)?.title), page: h.passage.page, passageId: h.passage.id, quote, ...(quote !== h.passage.text ? { full: h.passage.text } : {}) }] : undefined;
    add([{ role: 'tutor', msg: { text: TL(lang, h ? 'offline_passage' : 'offline_none'), tone: 'offline', sources: src, by: 'policy' }, at: Date.now(), why: `${plan.action} — ${plan.reason}` }]);
    const q = await getMeta<Queued[]>(`tutorQueue:${pid}`, []);
      await setMeta(`tutorQueue:${pid}`, [...q, { id, text: msg, bookIds: subject, memoryScope, conversationId: activeConversationId ?? undefined, at: Date.now() }]);
  }

  async function sendQueued() {
    const q = await getMeta<Queued[]>(`tutorQueue:${pid}`, []);
    if (!q.length || !agent.device) return;
    const left: Queued[] = [];
    for (const x of q) {
      try {
        const r = await fetchWithTimeout('/api/tutor/turn', { method: 'POST', headers: headers(), body: JSON.stringify({ profileId: pid, text: x.text, lang, bookIds: x.bookIds, memoryScope: x.memoryScope, queuedAt: x.at, turnId: x.id }) }, 30000);
        if (!r.ok) { left.push(x); continue; }
        const j = (await r.json()) as { messages: TMsg[]; memory: Memory };
        const incoming: Line[] = [{ role: 'tutor' as const, msg: { text: `${TL(lang, 'kept_answered')} “${x.text}”`, tone: 'info', by: 'policy' as const }, at: Date.now() }, ...j.messages.map((m) => ({ role: 'tutor' as const, msg: m, at: Date.now() }))].map((line) => ({ ...line, ...(x.bookIds?.length ? { bookIds: x.bookIds } : {}) }));
        appendChatLines(incoming, x.bookIds ?? [], x.conversationId ?? null);
        void setMeta(memoryKey(pid, x.memoryScope), j.memory);
        if (activeConversationRef.current === (x.conversationId ?? null) && memoryScopeRef.current === x.memoryScope) setMemory(j.memory);
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

  const subjects = subjectsOf(books);
  const pick = async (ids: string[] | undefined) => {
    activeConversationRef.current = null;
    memoryScopeRef.current = undefined; setMemoryScope(undefined);
    setText(''); setShowWhy(null); setOpenSrc(null);
    const group = ids?.length ? subjects.find((entry) => entry.ids.some((id) => ids.includes(id))) : undefined;
    const selectedIds = group?.ids ?? ids;
    setSubject(selectedIds); setView('chat'); setShowChatHistory(false); setActiveConversationId(null);
    await setMeta(`subject:${pid}`, selectedIds);
    if (!selectedIds?.length) {
      setMemoryScope(undefined);
      const saved = await getMeta<Line[]>(`chat:${pid}`, []);
      legacyLinesRef.current = saved;
      setLines(saved);
      setMemory(await getMeta<Memory>(memoryKey(pid), { topics: [] }));
      return;
    }

    const scope = `subject:${subjectKey(selectedIds)}`;
    memoryScopeRef.current = scope;
    setMemoryScope(scope);
    const stored = await getMeta<ChatConversation[]>(`chatSessions:${pid}`, []);
    const legacy = legacyLinesRef.current;
    const migrated = legacy.filter((line) => conversationMatches(line, selectedIds));
    let nextSessions = stored;
    if (migrated.some((line) => line.role === 'student')) {
      const stamp = migrated[0]?.at ?? Date.now();
      nextSessions = [...nextSessions, { id: `legacy-${crypto.randomUUID()}`, subjectIds: selectedIds, subjectKey: subjectKey(selectedIds), createdAt: stamp, updatedAt: migrated[migrated.length - 1]?.at ?? stamp, lines: migrated }];
      const remaining = legacy.filter((line) => !conversationMatches(line, selectedIds));
      legacyLinesRef.current = remaining;
      await setMeta(`chat:${pid}`, remaining);
    }
    const now = Date.now();
    const fresh: ChatConversation = { id: crypto.randomUUID(), subjectIds: selectedIds, subjectKey: subjectKey(selectedIds), createdAt: now, updatedAt: now, lines: [] };
    nextSessions = [...nextSessions, fresh];
    activeConversationRef.current = fresh.id;
    replaceConversations(nextSessions); setActiveConversationId(fresh.id); setLines([]);
    setMemory(await subjectMemory(pid, scope));
    await setMeta(`chatSessions:${pid}`, nextSessions);
    void openSession(selectedIds, fresh.id, scope);
  };
  const showOverview = async () => { activeConversationRef.current = null; memoryScopeRef.current = undefined; setSubject(undefined); setView('overview'); setActiveConversationId(null); setMemoryScope(undefined); setShowChatHistory(false); await setMeta(`subject:${pid}`, undefined); };
  const continueConversation = async () => {
    const savedChats = await getMeta<ChatConversation[]>(`chatSessions:${pid}`, []);
    const recent = savedChats.filter((chat) => chat.lines.some((line) => line.role === 'student')).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (recent) { replaceConversations(savedChats); await openConversation(recent); return; }
    const saved = await getMeta<Line[]>(`chat:${pid}`, []);
    legacyLinesRef.current = saved;
    activeConversationRef.current = null; memoryScopeRef.current = undefined; setLines(saved); setActiveConversationId(null); setMemoryScope(undefined); setSubject(undefined); setView('chat');
    await setMeta(`subject:${pid}`, undefined);
  };
  const openConversation = async (conversation: ChatConversation) => {
    const group = subjects.find((entry) => entry.ids.some((id) => conversation.subjectIds.includes(id)));
    const scope = group ? `subject:${subjectKey(group.ids)}` : undefined;
    setText(''); setShowWhy(null); setOpenSrc(null);
    activeConversationRef.current = conversation.id; memoryScopeRef.current = scope; setSubject(conversation.subjectIds); setView('chat'); setLines(conversation.lines); setActiveConversationId(conversation.id); setMemoryScope(scope); setShowChatHistory(false);
    setMemory(scope ? await subjectMemory(pid, scope) : await getMeta<Memory>(memoryKey(pid), { topics: [] }));
    await setMeta(`subject:${pid}`, conversation.subjectIds);
  };
  const physics = books.find((b) => b.id === 'physical-science-9');
  const visibleLines = subject ? lines.filter((l) => l.bookIds?.some((id) => subject.includes(id))) : lines;
  const openCheck = [...visibleLines].reverse().find((l) => l.role === 'tutor' && l.msg.check);
  const answering = !!(memory.check && openCheck);
  const placeholder = answering ? U(lang, 'answerShort') : U(lang, 'askShort');
  const current = subject ? subjects.find((s) => s.ids.every((id) => subject.includes(id))) : undefined;
  const subjectHistoryEnabled = !!current;
  const subjectChats = subjectHistoryEnabled && current ? conversations.filter((chat) => chat.subjectKey === subjectKey(current.ids)).sort((a, b) => b.updatedAt - a.updatedAt) : [];
  const ideas = suggestions(current?.ids ?? subjects.flatMap((s) => s.ids), lang);
  const fresh = !visibleLines.some((l) => l.role === 'student');
  const send = () => { if (!text.trim() || busy) return; const x = text; setText(''); void ask(x); };
  const listening = mic === 'rec' || mic === 'live';
  const accountName = identityName?.trim() || profile.name?.trim() || identityEmail?.split('@')[0]?.trim() || 'User';
  const toggleSidebar = () => setSidebarCollapsed((collapsed) => {
    const next = !collapsed;
    localStorage.setItem('setu-sidebar-collapsed', String(next));
    return next;
  });

  return (
    <div class="app chat dashboard">
      <header class="topbar">
        <div class="brand">
          <Logo size={38} />
          <div class="brand-text">
            <b>{t(lang, 'app')}</b>
          </div>
        </div>
        <div class="account-identity" aria-label="Signed-in account">
          <span class="account-kicker">Learning at</span>
          <strong class="account-name">{accountName}</strong>
          {identityEmail && <span class="account-email">{identityEmail}</span>}
        </div>
        <button class="theme-toggle" aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={darkMode} title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setDarkMode((value) => !value)}><span aria-hidden="true">{darkMode ? '☀' : '☾'}</span><span class="theme-label">{darkMode ? 'Light' : 'Dark'}</span></button>
        <button class="mobile-profile" aria-label={t(lang, 'switchLearner')} onClick={onSwitch}><span class="profile-initial">{profile.name?.trim().slice(0, 1) || accountName.slice(0, 1)}</span><span class="profile-name">{profile.name ?? accountName}</span></button>
      </header>

      <div class={'dashboard-body' + (sidebarCollapsed ? ' sidebar-collapsed' : '')}>
        <aside class="sidebar" aria-label={D(lang, 'navigation')}>
          <button class="sidebar-toggle" aria-expanded={!sidebarCollapsed} aria-label={D(lang, sidebarCollapsed ? 'expandNavigation' : 'collapseNavigation')} title={D(lang, sidebarCollapsed ? 'expandNavigation' : 'collapseNavigation')} onClick={toggleSidebar}><Icon name={sidebarCollapsed ? 'chevron' : 'chevron-left'} size={18} /></button>
          <div class="side-group side-subjects">
            <button class={'side-link' + (view === 'overview' ? ' selected' : '')} aria-current={view === 'overview' ? 'page' : undefined} onClick={() => void showOverview()}>{TL(lang, 'all_subjects')}</button>
            {subjects.map((s) => {
              const on = view === 'chat' && !!subject && s.ids.every((id) => subject.includes(id));
              return <button class={'side-link' + (on ? ' selected' : '')} aria-current={on ? 'page' : undefined} onClick={() => void pick(s.ids)}>{s.name[lang] ?? s.name.en}</button>;
            })}
          </div>
          <div class="side-bottom">
            <div class="side-utilities">
              <button class="side-link" aria-pressed={sheet === 'lang'} onClick={() => setSheet('lang')}>{D(lang, 'changeLanguage')}</button>
              <button class="side-link" aria-pressed={sheet === 'progress'} onClick={() => setSheet('progress')}>{TL(lang, 'progress')}</button>
              <button class="side-link account-signout" onClick={onLogout}>{lang === 'hi' ? 'लॉग आउट' : lang === 'or' ? 'ଲଗ୍‌ଆଉଟ୍‌' : 'Sign out'}</button>
            </div>
            <button class="side-profile" aria-label={t(lang, 'switchLearner')} onClick={onSwitch}>
              <span class="profile-initial">{profile.name?.trim().slice(0, 1) || accountName.slice(0, 1)}</span>
              <span class="profile-details"><span class="profile-caption">{lang === 'hi' ? 'अभी सीख रहे हैं' : lang === 'or' ? 'ଏବେ ପଢ଼ୁଛନ୍ତି' : 'LEARNING AS'}</span><span class="profile-name">{profile.name?.trim() || accountName}</span></span>
            </button>
          </div>
        </aside>

        {view === 'overview' ? <SubjectOverview books={books} subjects={subjects} lang={lang} hasHistory={lines.some((l) => l.role === 'student') || conversations.some((chat) => chat.lines.some((line) => line.role === 'student'))} onContinue={continueConversation} onOpen={(ids) => void pick(ids)} /> : <div class="workarea">
        <main class="feed" aria-live="polite">
        {subject && current && <div class="chat-page-title">
          <div class="chat-title-copy"><span>{D(lang, 'learning')}</span><h1>{current.name[lang] ?? current.name.en}</h1></div>
          {subjectHistoryEnabled && <div class="chat-title-actions">
            <button class="chat-history-button" onClick={() => setShowChatHistory(true)}><Icon name="history" size={17} />{D(lang, 'chatHistory')}<span class="chat-history-count">{subjectChats.filter((chat) => chat.id !== activeConversationId && chat.lines.some((line) => line.role === 'student')).length}</span></button>
            <button class="chat-new-button" onClick={() => void pick(current.ids)}><Icon name="plus" size={17} />{D(lang, 'newChat')}</button>
          </div>}
        </div>}
        {fresh && (
          <section class="hero">
            <div class="hero-mark"><Logo size={36} /><span>{U(lang, 'hello')}{profile.name ? `, ${profile.name}` : ''}</span></div>
            <h1>{START_PROMPTS[lang] ?? START_PROMPTS.en}</h1>
          </section>
        )}
        {visibleLines.map((l, i) => {
          // The empty-state hero already welcomes a new learner; avoid showing the same greeting twice.
          if (fresh && l.role === 'tutor' && (l.msg.text === T(lang, 'welcome') || l.msg.text === T(lang, 'welcome_back'))) return null;
          return l.role === 'student'
            ? <div class="msg me"><div class="bubble">{l.text}</div></div>
            : <Tutor m={l.msg} lang={lang} why={l.why} showWhy={showWhy === i} toggleWhy={() => setShowWhy(showWhy === i ? null : i)} openSrc={openSrc} setOpenSrc={setOpenSrc}
                onChip={(c) => { if (c.bookId) void pick([c.bookId]); else if (c.review) void ask('', { review: c.review, show: c.label }); else if (c.text) void ask(c.text); }} />;
        })}
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
      {showChatHistory && subjectHistoryEnabled && current && <div class="chat-history-overlay">
        <button class="chat-history-scrim" aria-label={D(lang, 'closeHistory')} onClick={() => setShowChatHistory(false)} />
        <aside class="chat-history-panel" role="dialog" aria-modal="true" aria-label={D(lang, 'chatHistory')}>
          <header class="chat-history-header"><div><span>{D(lang, 'historyFor')}</span><h2>{D(lang, 'chatHistory')}</h2></div><button class="iconbtn" aria-label={D(lang, 'closeHistory')} onClick={() => setShowChatHistory(false)}><Icon name="close" /></button></header>
          <button class="chat-history-start" onClick={() => void pick(current.ids)}><Icon name="plus" size={18} />{D(lang, 'newChat')}</button>
          <div class="chat-history-list">
            {subjectChats.filter((chat) => chat.id !== activeConversationId && chat.lines.some((line) => line.role === 'student')).map((chat) => <button class="chat-history-item" onClick={() => void openConversation(chat)}>
              <strong>{conversationTitle(chat.lines)}</strong><span>{new Date(chat.updatedAt).toLocaleString(lang === 'or' ? 'or-IN' : lang === 'hi' ? 'hi-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </button>)}
            {!subjectChats.some((chat) => chat.id !== activeConversationId && chat.lines.some((line) => line.role === 'student')) && <p class="chat-history-empty">{D(lang, 'noChatHistory')}</p>}
          </div>
        </aside>
      </div>}
        </div>}
      </div>

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

const DASHBOARD_LABELS: Record<string, Record<string, string>> = {
  en: { navigation: 'Dashboard navigation', collapseNavigation: 'Hide subject sidebar', expandNavigation: 'Show subject sidebar', subjects: 'Subjects', changeLanguage: 'Change language', overview: 'What shall we learn today?', overviewNote: 'Pick a subject and your textbook tutor is ready to help.', recentChat: 'Continue learning', books: 'Textbooks', classBoard: 'Class and board', action: 'Action', open: 'Open subject', learning: 'Learning', searchSubjects: 'Search your subjects', subjectCount: '{0} subjects ready to explore', textbookCount: '{0} textbook(s)', noSubjectMatch: 'No subjects match that search.', overviewKicker: 'Your learning space', heroArtLabel: 'Your next big idea', chatHistory: 'Chat history', newChat: 'New chat', noChatHistory: 'Your past chats for this subject will appear here.', historyFor: 'PREVIOUS CONVERSATIONS', closeHistory: 'Close chat history' },
  hi: { navigation: 'डैशबोर्ड नेविगेशन', collapseNavigation: 'विषय साइडबार छिपाएँ', expandNavigation: 'विषय साइडबार दिखाएँ', subjects: 'विषय', changeLanguage: 'भाषा बदलें', overview: 'आज क्या सीखें?', overviewNote: 'कोई विषय चुनो और किताबों पर आधारित ट्यूटर से मदद पाओ।', recentChat: 'पढ़ाई जारी रखें', books: 'पाठ्यपुस्तकें', classBoard: 'कक्षा और बोर्ड', action: 'खोलें', open: 'विषय खोलें', learning: 'पढ़ाई', searchSubjects: 'अपने विषय खोजें', subjectCount: 'खोजने के लिए {0} विषय तैयार हैं', textbookCount: '{0} पाठ्यपुस्तकें', noSubjectMatch: 'इस खोज से कोई विषय नहीं मिला।', overviewKicker: 'तुम्हारी पढ़ाई की जगह', heroArtLabel: 'तुम्हारा अगला नया विचार', chatHistory: 'चैट इतिहास', newChat: 'नई चैट', noChatHistory: 'इस विषय की पुरानी चैट यहाँ दिखेंगी।', historyFor: 'पिछली बातचीत', closeHistory: 'चैट इतिहास बंद करें' },
  or: { navigation: 'ଡ୍ୟାସବୋର୍ଡ୍‌ ନାଭିଗେସନ୍‌', collapseNavigation: 'ବିଷୟ ସାଇଡବାର୍‌ ଲୁଚାଅ', expandNavigation: 'ବିଷୟ ସାଇଡବାର୍‌ ଦେଖାଅ', subjects: 'ବିଷୟ', changeLanguage: 'ଭାଷା ବଦଳାଅ', overview: 'ଆଜି କ’ଣ ଶିଖିବା?', overviewNote: 'ଗୋଟିଏ ବିଷୟ ବାଛ ଏବଂ ବହି ଆଧାରିତ ଟ୍ୟୁଟର୍‌ଠାରୁ ସାହାଯ୍ୟ ପାଅ।', recentChat: 'ପଢ଼ା ଜାରି ରଖ', books: 'ପାଠ୍ୟ ବହି', classBoard: 'ଶ୍ରେଣୀ ଓ ବୋର୍ଡ', action: 'ଖୋଲ', open: 'ବିଷୟ ଖୋଲ', learning: 'ପଢ଼ା', searchSubjects: 'ତୁମ ବିଷୟ ଖୋଜ', subjectCount: 'ଖୋଜିବାକୁ {0}ଟି ବିଷୟ ଅଛି', textbookCount: '{0}ଟି ପାଠ୍ୟ ବହି', noSubjectMatch: 'ଏହି ଖୋଜରେ କୌଣସି ବିଷୟ ମିଳିଲା ନାହିଁ।', overviewKicker: 'ତୁମ ପଢ଼ା ଜାଗା', heroArtLabel: 'ତୁମର ପରବର୍ତ୍ତୀ ନୂଆ ଭାବନା', chatHistory: 'ଚାଟ୍ ଇତିହାସ', newChat: 'ନୂଆ ଚାଟ୍', noChatHistory: 'ଏହି ବିଷୟର ପୁରୁଣା ଚାଟ୍ ଏଠାରେ ଦେଖାଯିବ।', historyFor: 'ପୂର୍ବ କଥାବାର୍ତ୍ତା', closeHistory: 'ଚାଟ୍ ଇତିହାସ ବନ୍ଦ କର' },
};
const D = (lang: string, key: string) => DASHBOARD_LABELS[lang]?.[key] ?? DASHBOARD_LABELS.en![key] ?? key;

type SubjectGroup = { name: Record<string, string | undefined>; ids: string[] };
function SubjectOverview({ books, subjects, lang, hasHistory, onContinue, onOpen }: { books: BookInfo[]; subjects: SubjectGroup[]; lang: string; hasHistory: boolean; onContinue: () => void; onOpen: (ids: string[]) => void }) {
  const [query, setQuery] = useState('');
  const titleFor = (b: BookInfo) => b.title[lang as 'or' | 'en'] ?? b.title.en;
  const filtered = subjects.filter((s) => {
    const names = [s.name.en, s.name[lang], ...books.filter((b) => s.ids.includes(b.id)).map(titleFor)];
    return names.some((value) => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  });
  return (
    <main class="overview">
      <div class="overview-heading">
        <div class="overview-copy">
          <span class="overview-kicker"><Icon name="spark" size={16} />{D(lang, 'overviewKicker')}</span>
          <h1>{D(lang, 'overview')}</h1>
          <p>{D(lang, 'overviewNote')}</p>
          {hasHistory && <button class="continue-chat" onClick={onContinue}><Icon name="play" size={17} />{D(lang, 'recentChat')}<Icon name="chevron" size={17} /></button>}
        </div>
        <div class="overview-art" aria-hidden="true">
          <span class="overview-art-spark">✦</span><span class="overview-art-orbit"><Icon name="book" size={66} /></span>
          <span class="overview-art-caption">{D(lang, 'heroArtLabel')}</span>
          <span class="overview-art-dot dot-one" /><span class="overview-art-dot dot-two" />
        </div>
      </div>
      <div class="subject-tools">
        <label class="subject-search"><Icon name="search" size={19} /><span class="sr">{D(lang, 'searchSubjects')}</span><input type="search" value={query} onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)} placeholder={D(lang, 'searchSubjects')} /></label>
        <span class="subject-count" aria-live="polite">{D(lang, 'subjectCount').replace('{0}', String(filtered.length))}</span>
      </div>
      <div class="subject-grid">
        {filtered.map((s) => {
          const groupBooks = books.filter((b) => s.ids.includes(b.id));
          const title = s.name[lang] ?? s.name.en ?? '';
          const englishName = s.name.en?.toLocaleLowerCase() ?? '';
          const symbol = englishName.includes('math') ? '∑' : englishName.includes('geography') ? '🌍' : englishName.includes('econom') ? '₹' : englishName.includes('english') ? 'Aa' : englishName.includes('hindi') ? 'अ' : englishName.includes('history') ? '⌛' : englishName.includes('life science') ? '🧬' : englishName.includes('physical science') ? '⚛' : '📘';
          const levels = [...new Set(groupBooks.map((b) => `${b.classLevel} · ${b.board}`))];
          return <button class="subject-card" onClick={() => onOpen(s.ids)} aria-label={`${D(lang, 'open')}: ${title}`}>
            <span class="subject-card-top"><span class="subject-icon" aria-hidden="true">{symbol}</span><span class="subject-open-icon" aria-hidden="true"><Icon name="chevron" size={20} /></span></span>
            <strong class="subject-card-title">{title}</strong>
            <span class="subject-card-count">{D(lang, 'textbookCount').replace('{0}', String(groupBooks.length))}</span>
            <span class="subject-book-list">{groupBooks.slice(0, 2).map(titleFor).join(' · ')}{groupBooks.length > 2 ? ` · +${groupBooks.length - 2}` : ''}</span>
            <span class="subject-card-bottom">{levels.map((level) => <span class="class-chip">{level}</span>)}<span class="subject-card-action">{D(lang, 'open')} <Icon name="chevron" size={17} /></span></span>
          </button>;
        })}
        {!filtered.length && <p class="subject-empty">{subjects.length ? D(lang, 'noSubjectMatch') : D(lang, 'overviewNote')}</p>}
      </div>
    </main>
  );
}

/** First questions to tap, per book, written as a student would ask them (checked against the books' pages). */
const IDEAS: Record<string, Record<string, string[]>> = {
  'life-science-9': { or: ['ରକ୍ତ କଣିକା କେତେ ପ୍ରକାର?', 'ଜୀବକୋଷ କ\'ଣ?'], en: ['What are the types of blood cells?', 'What is a cell?'] },
  'geography-economics-9': { or: ['ମୌସୁମୀ ବାୟୁ କ\'ଣ?', 'ବ୍ୟାଙ୍କ କ\'ଣ କାମ କରେ?'], en: ['What is the monsoon?', 'What does a bank do?'] },
  'disaster-management-9': { or: ['ସଡ଼କ ଦୁର୍ଘଟଣାର କାରଣ କ\'ଣ?'], en: ['Why do road accidents happen?'] },
  'physical-science-9': { or: ['ବେଗ ଓ ପରିବେଗ ମଧ୍ୟରେ ପାର୍ଥକ୍ୟ କ\'ଣ?', 'ମହାକର୍ଷଣ କ\'ଣ?'], en: ['What is the difference between speed and velocity?', 'What is gravitation?'] },
  'history-polsci-9': { or: ['ପ୍ରଥମ ବିଶ୍ୱଯୁଦ୍ଧର କାରଣ କ\'ଣ?', 'ମୌଳିକ ଅଧିକାର କ\'ଣ?'], en: ['What caused the First World War?', 'What are fundamental rights?'] },
  'algebra-9': { or: ['ସମ୍ଭାବ୍ୟତା କ\'ଣ?'], en: ['What is probability?'] },
  'geometry-9': { or: ['ଚତୁର୍ଭୁଜ କେତେ ପ୍ରକାର?'], en: ['What are the types of quadrilaterals?'] },
  // language books: each card names its lesson, so it finds the book with or without the subject picked
  'odia-literature-9': { or: ['ବୁଢ଼ା ଶଙ୍ଖାରି ଗଳ୍ପଟି କାହା ବିଷୟରେ?', 'ହେ ମୋର କଲମ କବିତାର କବି କିଏ?'], en: ['What is the story Budha Sankhari about?', 'Who wrote the poem He Mora Kalama?'] },
  'odia-grammar-9': { or: ['ସନ୍ଧି କ\'ଣ?', 'ସମାସ କେତେ ପ୍ରକାର?'], en: ['What is sandhi?', 'What are the kinds of samasa?'] },
  'english-9': { or: ['The Lost Child ଗଳ୍ପରେ କ\'ଣ ହୁଏ?', 'Missile Man of India କିଏ?'], en: ['What happens in The Lost Child?', 'Who is the Missile Man of India?'] },
  'hindi-9': { or: ['कबीर के दोहे का अर्थ क्या है?', 'ममता कहानी किसने लिखी?'], en: ['What do Kabir ke dohe mean?', 'Who wrote the story Mamta?'] },
  'sanskrit-9': { or: ['सिंहशशककथा का सार क्या है?'], en: ['What is the Simha Shashaka Katha about?'] },
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
const START_PROMPTS: Record<string, string> = {
  or: 'ଆଜି କ’ଣ ପଢ଼ୁଛ?',
  hi: 'आज क्या पढ़ रहे हो?',
  en: 'What are you learning today?',
};
const OFFLINE_LABELS: Record<string, string> = {
  or: 'ସେଭ୍‌ ଥିବା ବହିରୁ · ଅଫ୍‌ଲାଇନ୍‌',
  hi: 'ऑफ़लाइन · सेव की हुई किताब',
  en: 'Offline · saved book',
};

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
        {tone && <span class="badge"><Icon name={tone.icon} size={14} />{tone.key === 'offline' ? (OFFLINE_LABELS[lang] ?? OFFLINE_LABELS.en) : U(lang, tone.key)}</span>}
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

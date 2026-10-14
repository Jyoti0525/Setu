// Native language review (TODO D6, PLAN §6.5): every Odia line the learner or teacher sees, next to its English,
// with the recorded voice. The reviewer marks each ✓ correct / fixes it / ? unsure, and rates the voice.
// Decisions are stored on the server; content/scripts/review_apply.ts puts them into the pack and the source.
// Loaded on demand at #review.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { ensureDevice } from './agent.ts';
import { fetchWithTimeout } from './net.ts';

interface Row { id: string; group: string; text: string; en: string; audio?: string; spoken?: string; where?: string; slots?: boolean }
interface Decision { status: 'ok' | 'fixed' | 'unsure'; text?: string; note?: string; audio?: 'good' | 'bad'; by?: string }

const KEY = 'setu.review';
const load = (): { key: string; by: string } => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? { key: '', by: '' }; } catch { return { key: '', by: '' }; } };
const store = (v: { key: string; by: string }) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };

export function Review() {
  const lang = /^#review(?:=(\w+))?/.exec(location.hash)?.[1] ?? 'or';
  const [who, setWho] = useState(load);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [done, setDone] = useState<Record<string, Decision>>({});
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'todo' | 'all' | 'fixed' | 'unsure'>('todo');
  const [group, setGroup] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    void fetch(`/review/${lang}.json`).then((r) => r.json()).then((j) => setRows(j.rows)).catch(() => setErr('Could not load the list (internet needed).'));
    void ensureDevice().then((d) => setToken(d?.token ?? null));
  }, []);
  const headers = () => ({ 'content-type': 'application/json', 'x-device-token': token ?? '', 'x-review-key': who.key });
  const pull = async () => {
    const r = await fetchWithTimeout(`/api/review/${lang}`, { headers: headers() }, 10000).catch(() => null);
    if (!r?.ok) { setErr(r?.status === 403 ? 'Reviewer key not accepted.' : 'Server not reachable.'); return false; }
    setDone(await r.json()); setErr(''); setAuthed(true); return true;
  };
  useEffect(() => { if (token && who.key) void pull(); }, [token]);

  const save = async (id: string, d: Decision) => {
    const body = { ...d, by: who.by || undefined };
    const r = await fetchWithTimeout(`/api/review/${lang}`, { method: 'POST', headers: headers(), body: JSON.stringify({ id, ...body }) }, 10000).catch(() => null);
    if (!r?.ok) { setErr('Not saved — check the internet and try again.'); return; }
    setErr('');
    setDone((p) => ({ ...p, [id]: body }));
  };

  const groups = useMemo(() => [...new Set((rows ?? []).map((r) => r.group))], [rows]);
  const shown = (rows ?? []).filter((r) => (!group || r.group === group) && (filter === 'all' || (filter === 'todo' ? !done[r.id] : done[r.id]?.status === filter)));
  const decided = (rows ?? []).filter((r) => done[r.id]).length;

  if (!authed) {
    return (
      <div class="review">
        <h1>ଓଡ଼ିଆ ଭାଷା ସମୀକ୍ଷା · Language review</h1>
        <p class="muted">Read each line as a Class 9 student in Odisha would. Mark it correct, or fix it. Listen to the voice too.</p>
        <input class="text" placeholder="Your name (optional)" value={who.by} onInput={(e) => setWho({ ...who, by: (e.target as HTMLInputElement).value })} />
        <input class="text" placeholder="Reviewer key" value={who.key} onInput={(e) => setWho({ ...who, key: (e.target as HTMLInputElement).value.trim() })} />
        <button class="primary" disabled={!who.key || !token} onClick={() => { store(who); void pull(); }}>Start · ଆରମ୍ଭ</button>
        {!token && <p class="small muted">Connecting…</p>}
        {err && <p class="small err">{err}</p>}
      </div>
    );
  }

  return (
    <div class="review">
      <header class="row between">
        <h1>ଓଡ଼ିଆ ସମୀକ୍ଷା</h1>
        <span class="small" role="status">{decided} / {rows?.length ?? '…'} ✓</span>
      </header>
      <progress max={rows?.length ?? 1} value={decided} />
      <p class="small muted">✓ = correct and natural · ✎ = change the text, then Save · ? = not sure (add a note). Keep {'{0}'} and {'${…}'} as they are — the app fills them in. 🔊 rate the voice: 👍 clear / 👎 wrong or hard to follow.</p>
      <div class="row">
        <select value={group} onChange={(e) => setGroup((e.target as HTMLSelectElement).value)} aria-label="Section">
          <option value="">All sections</option>{groups.map((g) => <option value={g}>{g}</option>)}
        </select>
        <select value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value as typeof filter)} aria-label="Show">
          <option value="todo">Not done yet</option><option value="all">All</option><option value="fixed">Fixed</option><option value="unsure">Unsure</option>
        </select>
        <button class="link small" onClick={() => download(lang, done)}>⬇ Export</button>
      </div>
      {err && <p class="small err" role="alert">{err}</p>}
      {!rows && <p class="muted">Loading…</p>}
      {rows && !shown.length && <p class="muted">Nothing here. {decided === rows.length ? 'All lines are done — thank you! 🙏' : ''}</p>}
      {shown.slice(0, 40).map((r) => <Line key={r.id} row={r} lang={lang} d={done[r.id]} onSave={(d) => save(r.id, d)} />)}
      {shown.length > 40 && <p class="small muted">Showing 40 of {shown.length} — mark these to see more.</p>}
    </div>
  );
}

function Line({ row, lang, d, onSave }: { row: Row; lang: string; d?: Decision; onSave: (d: Decision) => void }) {
  const [text, setText] = useState(d?.status === 'fixed' && d.text ? d.text : row.text);
  const [note, setNote] = useState(d?.note ?? '');
  const [audio, setAudio] = useState<Decision['audio']>(d?.audio);
  const changed = text.trim() !== row.text.trim();
  const lostSlot = (row.text.match(/\{\d\}|\$\{[^}]*\}/g) ?? []).some((s) => !text.includes(s));
  const play = () => { if (row.audio) void new Audio(`/audio/${lang}/${row.audio}.ogg`).play().catch(() => undefined); };
  const base = { ...(note.trim() ? { note: note.trim() } : {}), ...(audio ? { audio } : {}) };
  return (
    <article class={'card rv' + (d ? ` rv-${d.status}` : '')}>
      <div class="row between small muted"><span>{row.group}</span><span title={row.where ?? row.id}>{row.id.length > 34 ? row.id.slice(0, 33) + '…' : row.id}</span></div>
      <p class="en">{row.en || <i>(no English)</i>}</p>
      <textarea lang={lang} rows={Math.min(6, Math.ceil([...text].length / 34) + 1)} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} aria-label="Odia text" />
      {lostSlot && <p class="small err">Keep the {'{…}'} parts — the app fills them in.</p>}
      {row.audio && (
        <div class="row">
          <button onClick={play} aria-label="Play the voice">🔊</button>
          <button class={audio === 'good' ? 'sel' : ''} aria-pressed={audio === 'good'} onClick={() => setAudio('good')}>👍</button>
          <button class={audio === 'bad' ? 'sel' : ''} aria-pressed={audio === 'bad'} onClick={() => setAudio('bad')}>👎</button>
          {row.spoken && <details class="small"><summary>what the voice reads</summary>{row.spoken}</details>}
        </div>
      )}
      <input class="text small" placeholder="Note (optional)" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
      <div class="row">
        <button class="primary" disabled={changed} onClick={() => onSave({ status: 'ok', ...base })}>✓ Correct</button>
        <button disabled={!changed || lostSlot || !text.trim()} onClick={() => onSave({ status: 'fixed', text: text.trim(), ...base })}>✎ Save fix</button>
        <button onClick={() => onSave({ status: 'unsure', ...base })}>? Unsure</button>
        {changed && <button class="link small" onClick={() => setText(row.text)}>undo</button>}
      </div>
      {d && <p class="small muted">Saved: {d.status === 'ok' ? '✓ correct' : d.status === 'fixed' ? '✎ fixed' : '? unsure'}{d.audio ? ` · voice ${d.audio === 'good' ? '👍' : '👎'}` : ''}</p>}
    </article>
  );
}

function download(lang: string, done: Record<string, Decision>) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(done, null, 1)], { type: 'application/json' }));
  a.download = `setu-review-${lang}.json`;
  a.click();
}

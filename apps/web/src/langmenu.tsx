// The language picker on the sign-in page and the dashboard's top bar: her language in its own script, a search.
import { useEffect, useRef, useState } from 'preact/hooks';
import { LANGUAGES } from '@setu/core';
import { Icon } from './icons.tsx';

/** a language picker: a button that opens a list of her languages (`ids`, or all of them), with a search */
export function LangMenu({ value, onPick, ids, label = 'Language' }: { value: string; onPick: (id: string) => void; ids?: string[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const find = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    // type straight away with a keyboard; on a touch phone the keyboard opens only when she taps the search
    if (matchMedia('(pointer: fine)').matches) find.current?.focus();
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('pointerdown', away);
    return () => removeEventListener('pointerdown', away);
  }, [open]);
  const t = q.trim().toLocaleLowerCase();
  const shown = (ids ? ids.map((id) => LANGUAGES[id]!).filter(Boolean) : Object.values(LANGUAGES)).filter((l) => !t || [l.name, l.english, l.id].some((v) => v.toLocaleLowerCase().includes(t)));
  const cur = LANGUAGES[value];
  return <div class="lang-menu" ref={box} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); } }}>
    <button type="button" class="lang-menu-button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} title={label} onClick={() => { setOpen(!open); setQ(''); }}>
      <Icon name="globe" size={17} /><span class="lang-menu-name">{cur?.name ?? value}</span>{cur && cur.english !== cur.name && <span class="lang-menu-en">{cur.english}</span>}<Icon name="down" size={16} />
    </button>
    {open && <div class="lang-menu-pop">
      <label class="lang-menu-search"><Icon name="search" size={16} /><input ref={find} type="search" value={q} placeholder="Search · ଖୋଜ · खोजें" aria-label="Search language"
        onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); onPick(shown[0].id); setOpen(false); } }} /></label>
      <ul role="listbox" aria-label="Language">
        {shown.map((l) => <li><button type="button" role="option" aria-selected={l.id === value} class={l.id === value ? 'active' : ''} onClick={() => { onPick(l.id); setOpen(false); }}>
          <span>{l.name}</span>{l.english !== l.name && <span class="lang-menu-en">{l.english}</span>}{l.id === value && <Icon name="check" size={16} />}
        </button></li>)}
        {!shown.length && <li class="lang-menu-none">—</li>}
      </ul>
    </div>}
  </div>;
}

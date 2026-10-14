// Light or dark, chosen once and kept on this phone: the same switch on every screen (light until she picks dark).
import { useEffect, useState } from 'preact/hooks';
import { LANGUAGES } from '@setu/core';

type Theme = 'light' | 'dark';
const KEY = 'setu-theme';
let current: Theme = (() => { try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } })();
const watchers = new Set<(t: Theme) => void>();

export function applyTheme() { document.documentElement.dataset.theme = current; }
export function setTheme(t: Theme) {
  current = t;
  try { localStorage.setItem(KEY, t); } catch { /* private mode: this visit only */ }
  applyTheme(); watchers.forEach((w) => w(t));
}
export function useTheme(): Theme {
  const [t, set] = useState(current);
  useEffect(() => { watchers.add(set); return () => { watchers.delete(set); }; }, []);
  return t;
}

const WORDS: Record<string, { dark: string; light: string }> = {
  or: { dark: 'ଅନ୍ଧାର', light: 'ଆଲୁଅ' }, hi: { dark: 'डार्क', light: 'लाइट' }, en: { dark: 'Dark', light: 'Light' },
};
/** the switch: shows what a tap changes to (☾ Dark in light mode, ☀ Light in dark mode) */
export function ThemeToggle({ lang = 'en', label }: { lang?: string; label?: (k: 'dark' | 'light') => string }) {
  const dark = useTheme() === 'dark';
  const words = WORDS[lang] ?? WORDS[LANGUAGES[lang]?.school ?? ''] ?? WORDS.en!;
  const text = label ? label(dark ? 'light' : 'dark') : words[dark ? 'light' : 'dark'];
  return <button class="theme-toggle" aria-label={text} aria-pressed={dark} title={text} onClick={() => setTheme(dark ? 'light' : 'dark')}>
    <span aria-hidden="true">{dark ? '☀' : '☾'}</span><span class="theme-label">{text}</span>
  </button>;
}

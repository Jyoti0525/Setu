// Everything a native reviewer must read in one language (TODO D6) → apps/web/public/review/<lang>.json,
// which the review page (/#review) shows. Pack fields come from the pack; app/engine/teacher lines are
// scanned from source (Odia string literals) and paired with the English line under the same key.
// Usage: tsx scripts/review_inventory.ts or
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioKey } from '@setu/core';
import { motionDraft, packFields } from '../src/index.ts';

const lang = process.argv[2] ?? 'or';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = { or: /[଀-୿]/, hi: /[ऀ-ॿ]/ }[lang as 'or' | 'hi'];
if (!SCRIPT) throw new Error(`no script range for ${lang}`);

export interface ReviewRow { id: string; group: string; text: string; en: string; audio?: string; spoken?: string; where?: string; slots?: boolean }
const rows: ReviewRow[] = [];
const spoken: Record<string, string> = existsSync(join(ROOT, 'content/audio', `${lang}.spoken.json`)) ? JSON.parse(readFileSync(join(ROOT, 'content/audio', `${lang}.spoken.json`), 'utf8')) : {};
const clips: Record<string, number> = existsSync(join(ROOT, 'apps/web/public/audio', lang, 'index.json')) ? JSON.parse(readFileSync(join(ROOT, 'apps/web/public/audio', lang, 'index.json'), 'utf8')).clips ?? {} : {};
const withAudio = (r: ReviewRow, speakText?: string) => {
  const k = audioKey(speakText ?? r.text);
  return clips[k] ? { ...r, audio: k, spoken: spoken[k] } : r;
};

// ---- pack ----
const fields = packFields(motionDraft);
for (const f of fields) {
  const text = f.l10n[lang];
  if (!text) continue;
  // the clip is recorded from the speak form when there is one
  const speakField = fields.find((x) => x.id === f.id + '.speak' || x.id === f.id.replace(/#display$/, '#speak'));
  // a speak form has no English of its own: show the display English it reads aloud
  const en = f.l10n.en ?? fields.find((x) => x.id === f.id.replace(/#speak$/, '#display'))?.l10n.en ?? '';
  rows.push(withAudio({ id: f.id, group: `pack · ${f.kind}${f.id.endsWith('speak') ? ' (read aloud)' : ''}`, text, en }, speakField?.l10n[lang] ?? text));
}

// ---- source literals ----
const SOURCES = ['packages/core/src/engine.ts', 'apps/web/src/i18n.ts', 'apps/web/src/teacher.tsx', 'apps/web/src/app.tsx', 'apps/server/src/teacher.ts', 'apps/server/src/agent/between.ts'];
const unescape = (x: string) => x.replace(/\\(.)/g, '$1');
const LIT = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
for (const rel of SOURCES) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const lines = src.split('\n');
  const seen = new Map<string, number>();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(LIT)) {
      const text = unescape(m[2]!);
      if (!SCRIPT.test(text)) continue;
      // key: 'text' → pair with the first non-Odia literal under the same key in this file
      const before = line.slice(0, m.index);
      const key = /(\w+)\s*:\s*(?:\([^)]*\)\s*=>\s*)?$/.exec(before)?.[1];
      let en = '';
      if (key) {
        const re = new RegExp(String.raw`\b` + key + String.raw`\s*:\s*(?:\([^)]*\)\s*=>\s*)?` + LIT.source, 'g');
        for (const e of src.matchAll(re)) if (!/[ऀ-෿]/.test(e[2]!)) { en = unescape(e[2]!); break; }
      }
      const base = `${rel.split('/').pop()}:${key ?? `L${i + 1}`}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const group = rel.includes('engine') ? 'app · tutor lines' : rel.includes('teacher') || rel.includes('between') ? 'teacher view' : 'app · screens';
      const slots = /\{\d\}|\$\{/.test(text);
      rows.push(withAudio({ id: n > 1 ? `${base}.${n}` : base, group, text, en, where: `${rel}:${i + 1}`, ...(slots ? { slots } : {}) }));
    }
  });
}

const out = join(ROOT, 'apps/web/public/review', `${lang}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ lang, generatedAt: new Date().toISOString(), rows }) + '\n');
const by = rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.group]: (a[r.group] ?? 0) + 1 }), {});
console.log(`${rows.length} lines to review (${rows.filter((r) => r.audio).length} with audio) →`, out, by);

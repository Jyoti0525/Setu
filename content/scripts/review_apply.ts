// Applies a native reviewer's decisions (TODO D6). Pack lines → content/review/<lang>.json (applied when the pack
// loads: fixes in, fully passed items become `reviewed`). App/engine/teacher lines → patched in their source file,
// only where the original line is still exactly there. Prints what changed and what needs a human.
// Usage:
//   tsx scripts/review_apply.ts or --from http://localhost:8787 --key <SETU_REVIEW_KEY or admin key>
//   tsx scripts/review_apply.ts or --file decisions.json
// Then: tsx scripts/audio_texts.ts or > audio/or.texts.json && python ../tools/tts/gen_audio.py or && tsx scripts/review_inventory.ts or
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReviewDecisions } from '../src/review.ts';

const [lang = 'or', ...rest] = process.argv.slice(2);
const arg = (k: string) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const decisions: ReviewDecisions = arg('--file')
  ? JSON.parse(readFileSync(arg('--file')!, 'utf8'))
  : await (async () => {
      const base = arg('--from') ?? 'http://localhost:8787';
      const dev = (await (await fetch(`${base}/api/device`, { method: 'POST' })).json()) as { token: string };
      const r = await fetch(`${base}/api/review/${lang}`, { headers: { 'x-device-token': dev.token, 'x-review-key': arg('--key') ?? '' } });
      if (!r.ok) throw new Error(`review fetch failed: ${r.status} ${await r.text()}`);
      return r.json();
    })();

const inv = JSON.parse(readFileSync(join(ROOT, 'apps/web/public/review', `${lang}.json`), 'utf8')) as { rows: { id: string; text: string; where?: string }[] };
const rows = new Map(inv.rows.map((r) => [r.id, r]));

// ---- pack ----
const packFile = join(ROOT, 'content/review', `${lang}.json`);
const pack: ReviewDecisions = JSON.parse(readFileSync(packFile, 'utf8'));
let packN = 0;
for (const [id, d] of Object.entries(decisions)) {
  const row = rows.get(id);
  if (row && !row.where) { pack[id] = { status: d.status, ...(d.text ? { text: d.text } : {}), ...(d.note ? { note: d.note } : {}), ...(d.audio ? { audio: d.audio } : {}), ...(d.by ? { by: d.by } : {}) }; packN++; }
}
writeFileSync(packFile, JSON.stringify(Object.fromEntries(Object.entries(pack).sort()), null, 1) + '\n');

// ---- source lines ----
const LIT = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const unescape = (x: string) => x.replace(/\\(.)/g, '$1');
const escape = (x: string, q: string) => x.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q);
const patched: string[] = [], manual: string[] = [];
const files = new Map<string, string[]>();
for (const [id, d] of Object.entries(decisions)) {
  const row = rows.get(id);
  if (!row?.where || d.status !== 'fixed' || !d.text?.trim()) continue;
  const [rel, ln] = [row.where.slice(0, row.where.lastIndexOf(':')), Number(row.where.slice(row.where.lastIndexOf(':') + 1))];
  const lines = files.get(rel) ?? readFileSync(join(ROOT, rel), 'utf8').split('\n');
  files.set(rel, lines);
  const line = lines[ln - 1] ?? '';
  const m = [...line.matchAll(LIT)].find((x) => unescape(x[2]!) === row.text);
  const fix = d.text.trim();
  const slotsOk = (row.text.match(/\{\d\}|\$\{[^}]*\}/g) ?? []).every((slot) => fix.includes(slot));
  if (!m || !slotsOk) { manual.push(`${id} (${row.where}): ${!m ? 'line changed since the inventory' : 'fix lost a {slot}'} → "${fix}"`); continue; }
  lines[ln - 1] = line.slice(0, m.index) + m[1] + escape(fix, m[1]!) + m[1] + line.slice(m.index! + m[0].length);
  patched.push(`${row.where}  ${row.text}  →  ${fix}`);
}
for (const [rel, lines] of files) writeFileSync(join(ROOT, rel), lines.join('\n'));

const count = (s: string) => Object.values(decisions).filter((d) => d.status === s).length;
console.log(`${lang}: ${Object.keys(decisions).length} decisions (ok ${count('ok')}, fixed ${count('fixed')}, unsure ${count('unsure')}) of ${inv.rows.length} lines`);
console.log(`pack: ${packN} → ${packFile}`);
console.log(`source: ${patched.length} patched`); patched.forEach((x) => console.log('  ' + x));
if (manual.length) { console.log(`needs a human: ${manual.length}`); manual.forEach((x) => console.log('  ' + x)); }
const unsure = Object.entries(decisions).filter(([, d]) => d.status === 'unsure');
if (unsure.length) { console.log('reviewer unsure:'); unsure.forEach(([id, d]) => console.log(`  ${id}: ${d.note ?? ''}`)); }
const bad = Object.entries(decisions).filter(([, d]) => d.audio === 'bad');
if (bad.length) { console.log(`audio rated bad: ${bad.length}`); bad.forEach(([id, d]) => console.log(`  ${id}: ${d.note ?? ''}`)); }

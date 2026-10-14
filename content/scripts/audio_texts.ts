// Lists every fixed line the phone may speak in a language, with its audio key (TODO P3.8).
// Usage: tsx scripts/audio_texts.ts or > audio/or.texts.json — then tools/tts/gen_audio.py records the missing ones.
import { audioKey, fixedStrings, speakIn, textIn, type Utterance } from '@setu/core';
import { motionPack } from '../src/index.ts';
import { spokenUi } from '../../apps/web/src/i18n.ts';

const lang = process.argv[2] ?? 'or';
const out = new Map<string, { key: string; text: string; from: string }>();
const add = (text: string | undefined, from: string) => {
  if (!text?.trim()) return;
  const key = audioKey(text);
  if (!out.has(key)) out.set(key, { key, text, from });
};
const u = (x: Utterance, from: string) => { if (x.display[lang]) add(speakIn(x, lang), from); };

const p = motionPack;
for (const e of p.explanations) u(e.body, e.id);
for (const k of p.checks) {
  u(k.stem, k.id);
  for (const o of k.options ?? []) if (o.feedback?.[lang]) add(textIn(o.feedback, lang), `${k.id}/${o.id}`);
}
for (const f of p.faq) u(f.answer, f.id);
for (const ps of p.passages) if (ps.text[lang]) add(textIn(ps.text, lang), ps.id);
for (const x of fixedStrings(lang)) add(x, 'engine');
for (const x of spokenUi(lang)) add(x, 'app'); // language picker, photo kept…
process.stdout.write(JSON.stringify([...out.values()], null, 1) + '\n');

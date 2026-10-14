// Her home language when no model can write it (tier C: Kui, Kuvi, Ho, Saora, Munda): she is taught in easy Odia, and
// the tutor adds her own words from the Government of Odisha's dictionaries (content/tribal/<id>.json,
// scripts/tribal_words.ts). The model only copies words from a list it is given; any home-language word in its reply
// that is not on that list is taken out before she sees it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGES } from '@setu/core';
import type { HomeWords } from './prompt.ts';

export interface HomeEntry { or: string; home: string; en?: string; ex?: { or: string; home: string } }
export interface HomeList { id: string; name: string; sources: string[]; entries: HomeEntry[] }

export function loadHomeWords(dir: string): Map<string, HomeList> {
  const m = new Map<string, HomeList>();
  if (!existsSync(dir)) return m;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const l = JSON.parse(readFileSync(join(dir, f), 'utf8')) as HomeList;
    if (LANGUAGES[l.id]?.tier === 'C') m.set(l.id, l);
  }
  return m;
}

/** words of everyday village life: her examples are made of these, so their home words are always offered */
const EVERYDAY = 'ପାଣି ଗଛ ନଦୀ ପୋଖରୀ ବର୍ଷା ସୂର୍ଯ୍ୟ ଖରା ଜହ୍ନ ଆକାଶ ପବନ ନିଆଁ ମାଟି ପଥର ଗାଈ ଛେଳି କୁକୁଡ଼ା ମାଛ ଚଢ଼େଇ ଧାନ ଚାଉଳ ଭାତ ବିଲ ଚାଷ ଘର ଗାଁ ହାତ ଗୋଡ଼ ଆଖି କାନ ମୁଣ୍ଡ ପେଟ ଦାନ୍ତ ରକ୍ତ ଦେହ ଖାଦ୍ୟ ପତ୍ର ଫୁଲ ଫଳ ମଞ୍ଜି ଜଙ୍ଗଲ ବାଟ ହାଟ ଲୁଣ ତେଲ ହାଣ୍ଡି ଦିନ ରାତି ଶୀତ ଗରମ ମା ବାପା ପିଲା ମଣିଷ'.split(' ');
const MAX_WORDS = 40;

/** a word as it appears in running Odia text (ପାଣି in ପାଣିରେ): the whole word, or its start when it is long enough */
const appears = (word: string, text: string) => {
  if ([...word].length >= 3) return text.includes(word);
  return new RegExp(`(^|[\\s,.;:!?()।"'])${word}($|[\\s,.;:!?()।"'])`, 'u').test(text);
};

/** The words worth offering for this turn: those in her question and the passages first, then everyday ones. */
export function homeWordsFor(list: HomeList, texts: string[]): HomeWords {
  const all = texts.join('\n');
  const pick = new Map<string, HomeEntry>();
  // one-word Odia entries only (a phrase rarely fits in a sentence as it is), the more specific first
  const single = list.entries.filter((e) => !e.or.includes(' ') && [...e.home].length <= 24);
  for (const e of [...single].sort((a, b) => b.or.length - a.or.length)) if (pick.size < MAX_WORDS / 2 && appears(e.or, all)) pick.set(e.or, e);
  for (const w of EVERYDAY) { const e = single.find((x) => x.or === w); if (e && pick.size < MAX_WORDS) pick.set(e.or, e); }
  return { name: list.name, words: [...pick.values()].map((e) => ({ or: e.or, home: e.home })) };
}

/**
 * Keep only home-language words that came from the list: "ପାଣି (Kui: ଏସୁ)" stays when ଏସୁ is ପାଣି's Kui word,
 * any other "(Kui: …)" is removed. Returns the cleaned reply and the pairs it uses (shown under the reply).
 */
export function checkHomeWords(reply: string, hw: HomeWords, homeNames: string[]): { reply: string; used: { or: string; home: string }[]; dropped: number } {
  const used = new Map<string, { or: string; home: string }>();
  let dropped = 0;
  const names = homeNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`\\s*[(（]\\s*(?:${names})\\s*[:：-]\\s*([^)）]{1,40})[)）]`, 'gu');
  const out = reply.replace(re, (all, word: string) => {
    const w = word.trim();
    const hit = hw.words.find((x) => x.home === w || x.home.split(/\s*[,/]\s*|\s+/).includes(w));
    if (!hit) { dropped++; return ''; }
    used.set(hit.or, hit);
    return all;
  });
  return { reply: out, used: [...used.values()], dropped };
}

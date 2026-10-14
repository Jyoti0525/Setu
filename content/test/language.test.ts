// Language beyond translation (TODO P3.19, P3.23, P3.26, P3.27, P3.30, C.10, C.11).
import { describe, expect, it } from 'vitest';
import {
  fold, runTurn, PackMatcher, pickExplanation, liveGenLanguages, bridgeLanguages, LANGUAGES, prefersTap, pickCheck, vocabFor, fixedStrings,
  TUTOR_LINES, ENGINE_LINES, T, type AnyEvent, type EventDraft, type LearnerState, type OutMsg,
} from '@setu/core';
import { motionPack } from '../src/index.ts';
import { LOCALES } from '@setu/core/locales';
import { t, LANGS } from '../../apps/web/src/i18n.ts';

const matcher = new PackMatcher(motionPack);
let n = 0;
const ev = (type: string, payload: unknown): AnyEvent => ({ id: `l${++n}`, profileId: 'p1', deviceId: 'phone', seq: n, ts: 1_750_000_000_000 + n, type, payload } as AnyEvent);
const profile = (lang: string, readingLevel = 3) => ev('PROFILE_CREATED', { avatar: 'a', classLevel: 9, board: 'BSE-Odisha', language: { ui: lang, response: lang, inputMode: 'text', readingLevel }, dataTier: 'low', sharedDevice: true });
const known = (...cs: string[]) => cs.flatMap((c) => [1, 2, 3].map(() => ev('ANSWER_GRADED', { checkId: `x.${c}`, conceptId: c, correct: true, confidence: 1, source: 'bank', misconceptionIds: [] })));
const placed = () => ev('PLACEMENT_COMPLETED', { conceptIds: [], known: [], gaps: [] });
function turn(seed: AnyEvent[], text: string, mode: 'text' | 'voice' = 'text') {
  const s: LearnerState = fold(seed, motionPack.graph, 'p1');
  let k = 0;
  return runTurn(s, { type: 'doubt', doubtId: 'd', text, mode }, { pack: motionPack, matcher, now: 1_760_000_000_000, tier: 'device', trustDraft: true }, (d: EventDraft) => ({ ...d, id: `t${++k}`, profileId: 'p1', deviceId: 'phone', seq: 500 + k, ts: 1_760_000_000_000 } as AnyEvent));
}
const deva = (s: string) => /[ऀ-ॿ]/.test(s);

describe('Hindi pack, drafted by translation (C.11, P3.31)', () => {
  it('a Hindi doubt is matched offline and answered in Hindi with the NCERT term', () => {
    const r = turn([profile('hi'), placed(), ...known('reference_point', 'distance', 'speed', 'displacement')], 'चाल और वेग में क्या अंतर है?');
    expect(r.decision.action).toBe('answer_faq');
    const ex = r.messages.find((m): m is Extract<OutMsg, { kind: 'explanation' }> => m.kind === 'explanation')!;
    expect(deva(ex.text)).toBe(true);
    expect(ex.text).toMatch(/वेग/);
    expect(deva(r.messages.find((m) => m.kind === 'check')!.speak)).toBe(true);
  });
  it('Hindi is in the pack but every Hindi item is still a draft (no mastery until a Hindi reviewer passes it)', () => {
    expect(motionPack.languages).toContain('hi');
    expect(motionPack.checks.every((c) => c.review.hi !== 'reviewed')).toBe(true);
  });
});

describe('term bridge (P3.19)', () => {
  it('every concept has textbook term, English exam term and everyday phrase in or/hi/en; explanations carry it', () => {
    for (const g of motionPack.glossary) for (const l of ['or', 'hi', 'en']) { expect(g.term[l]).toBeTruthy(); expect(g.everyday[l]).toBeTruthy(); }
    const r = turn([profile('or'), placed(), ...known('reference_point', 'distance', 'speed', 'displacement')], 'speed aau velocity re farak kana?');
    const ex = r.messages.find((m): m is Extract<OutMsg, { kind: 'explanation' }> => m.kind === 'explanation')!;
    expect(ex.bridge).toEqual({ term: 'ବେଗ', english: 'velocity', everyday: 'କେଉଁ ଦିଗରେ କେତେ ଜୋରରେ' });
  });
});

describe('language changes decisions (P3.23)', () => {
  it('mostly speaking → voice mode → tap-answer checks', () => {
    const seed = [profile('or'), placed(), ...[1, 2, 3].map((i) => ev('DOUBT_ASKED', { doubtId: `v${i}`, text: 'x', mode: 'voice', language: 'or' }))];
    const s = fold(seed, motionPack.graph, 'p1');
    expect(s.language.inputMode).toBe('voice');
    expect(prefersTap(s)).toBe(true);
    for (const c of ['distance', 'speed', 'velocity']) expect(pickCheck(motionPack, s, c, { lang: 'or', trustDraft: true, freeText: true })!.kind).toBe('mcq');
    const typed = fold([...seed, ...[1, 2, 3].map((i) => ev('DOUBT_ASKED', { doubtId: `t${i}`, text: 'x', mode: 'text', language: 'or' }))], motionPack.graph, 'p1');
    expect(typed.language.inputMode).toBe('text');
  });
  it('class vocabulary depends on reading level (C.10)', () => {
    expect(vocabFor('or', 2).length).toBeGreaterThan(vocabFor('or', 4).length);
    expect(vocabFor('or', 5)).toEqual([]);
  });
});

describe('language tiers and quality-aware generation (P3.26, P3.27)', () => {
  it('live generation only where measured quality allows; tier C bridges to the school language', () => {
    // measured on the 2026-10-15 probe: the school languages, Bhojpuri and Santali are written live; Kui, Kuvi, Ho,
    // Saora and Munda are not (no free model writes them) and are taught in Odia with dictionary words
    expect(liveGenLanguages().sort()).toEqual(['bho', 'bn', 'en', 'hi', 'kn', 'mr', 'or', 'sat', 'ta', 'te']);
    expect(bridgeLanguages().map((l) => l.id).sort()).toEqual(['hoc', 'kxu', 'kxv', 'srb', 'unr']);
    expect(bridgeLanguages().every((l) => l.school && LANGUAGES[l.school]!.tier === 'A' && l.gen.score === null && l.words)).toBe(true);
    // every language Setu writes but no speaker has checked says so
    expect(Object.values(LANGUAGES).filter((l) => l.draft).map((l) => l.id).sort()).toEqual(['bho', 'bn', 'kn', 'mr', 'sat', 'ta', 'te']);
  });
});

describe('fully localised UI (P3.30)', () => {
  it('every UI key and every tutor line exists in Odia, Hindi and English', () => {
    expect(LANGS.map((l) => l.id).sort()).toEqual(['bho', 'bn', 'en', 'hi', 'kn', 'mr', 'or', 'sat', 'ta', 'te']);
    const keys = ['ack', 'timeToday', 'voiceFailed', 'gboardHint', 'whoIsIt', 'hintWrong', 'sharePack', 'noPack'] as const;
    for (const k of keys) { expect(deva(t('hi', k))).toBe(true); expect(/[଀-୿]/.test(t('or', k))).toBe(true); }
    expect(fixedStrings('hi').length).toBe(fixedStrings('en').length);
    expect(fixedStrings('hi').every((x) => deva(x))).toBe(true);
  });
  it('every drafted language has every line of every table, in its own script, with the same slots and helplines', () => {
    const en = { ui: Object.fromEntries((Object.keys(LOCALES.bn!.ui)).map((k) => [k, t('en', k as never)])), tutor: TUTOR_LINES.en!, engine: Object.fromEntries(Object.keys(LOCALES.bn!.engine).map((k) => [k, T('en', k)])) };
    const SCRIPT: Record<string, RegExp> = { bn: /[ঀ-৿]/, kn: /[ಀ-೿]/, te: /[ఀ-౿]/, ta: /[஀-௿]/, mr: /[ऀ-ॿ]/, bho: /[ऀ-ॿ]/, sat: /[᱐-᱿]/ };
    const slots = (x: string) => (x.match(/\{\d\}/g) ?? []).sort().join();
    for (const [lang, l] of Object.entries(LOCALES)) {
      expect(LANGUAGES[lang]?.draft).toBe(true);
      expect(Object.keys(l.tutor).sort()).toEqual(Object.keys(en.tutor).sort());
      expect(Object.keys(l.engine).sort()).toEqual(Object.keys(ENGINE_LINES.en!).sort());
      expect(Object.keys(l.ui).sort()).toEqual(Object.keys(en.ui).sort());
      for (const [k, v] of Object.entries(l.tutor)) { expect(slots(v), `${lang}.tutor.${k}`).toBe(slots(en.tutor[k]!)); expect(SCRIPT[lang]!.test(v), `${lang}.tutor.${k}`).toBe(true); }
      // the safety line keeps the helplines (in any digits)
      const ascii = l.engine.care!.replace(/[০-৯೦-೯౦-౯௦-௯०-९]/g, (d) => String((d.codePointAt(0)! & 0xf) - 6));
      for (const n of ['1098', '14416', '112']) expect(ascii, `${lang} care`).toContain(n);
    }
  });
});

describe('local analogies by region (P3.22)', () => {
  it("her class's region picks its own analogy; without a region, a general one; never another region's when others exist", () => {
    const ask = (region?: string) => {
      const seed = [profile('or'), placed(), ...known('reference_point', 'distance', 'speed', 'displacement'), ...(region ? [ev('CLASS_JOINED', { classCode: '123456', region })] : [])];
      const s = fold(seed, motionPack.graph, 'p1');
      return pickExplanation(motionPack, 'velocity', 'analogy', 2, s.region)!;
    };
    expect(ask('coastal').regions).toEqual(['coastal']);
    expect(ask('southern_hills').regions).toEqual(['southern_hills']);
    expect(ask().regions).toBeUndefined();
  });
  it('no pack text in any language carries a broken character', () => {
    expect(JSON.stringify(motionPack)).not.toContain('�');
  });
});

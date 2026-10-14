import { describe, expect, it } from 'vitest';
import { PackMatcher, detectScript, soundKey } from '@setu/core';
import { motionPack } from '../src/index.ts';

const m = new PackMatcher(motionPack);
const cases: [string, string, string?][] = [
  ['ବେଗ କଣ?', 'velocity', 'faq.what_is_velocity'],
  ['bega kana', 'velocity', 'faq.what_is_velocity'],
  ['speed aau velocity re farak kana?', 'velocity', 'faq.speed_vs_velocity'],
  ['velocity aau speed madhyare difference kana?', 'velocity', 'faq.speed_vs_velocity'],
  ['ଦ୍ରୁତି ଓ ବେଗ ମଧ୍ୟରେ ପାର୍ଥକ୍ୟ କଣ', 'velocity', 'faq.speed_vs_velocity'],
  ['what is displacement', 'displacement'],
  ['bisthapan kana', 'displacement'],
  ['distance aau displacement re farak', 'displacement', 'faq.distance_vs_displacement'],
  ['durota kemiti mapiba', 'distance'],
  ['average speed kemiti ber kariba', 'speed', 'faq.avg_speed'],
  ['twarana kana', 'acceleration'],
];
describe('multi-script matcher', () => {
  for (const [q, concept, faq] of cases) {
    it(q, () => {
      const r = m.match(q);
      expect(r.conceptId).toBe(concept);
      if (faq) expect(r.faqId).toBe(faq);
    });
  }
  it('unrelated text → low confidence', () => {
    expect(m.match('photosynthesis in plants').confidence).toBeLessThan(0.3);
  });
  it('English said aloud and written in Odia script by speech-to-text still matches (sound keys)', () => {
    expect(soundKey('displacement')).toBe(soundKey('ଡିସପ୍ଲେସମେଣ୍ଟ'));
    expect(soundKey('velocity')).toBe(soundKey('ଭେଲୋସିଟି'));
    expect(soundKey('acceleration')).toBe(soundKey('ଆକ୍ସିଲେରେସନ୍'));
    expect(m.match('ସ୍ପିଡ୍ ଆଉ ଭେଲୋସିଟି ରେ ଫରକ କଣ')).toMatchObject({ conceptId: 'velocity', faqId: 'faq.speed_vs_velocity' });
    expect(m.match('ଡିଷ୍ଟାନ୍ସ ଆଉ ଡିସପ୍ଲେସମେଣ୍ଟ ରେ ଫରକ')).toMatchObject({ conceptId: 'displacement', faqId: 'faq.distance_vs_displacement' });
    expect(m.match('ଆକ୍ସିଲେରେସନ୍ କାହାକୁ କହନ୍ତି').conceptId).toBe('acceleration');
  });
  it('detects scripts', () => {
    expect(detectScript('ବେଗ କଣ')).toBe('odia');
    expect(detectScript('bega kana')).toBe('latin');
    expect(detectScript('velocity ବେଗ')).toBe('mixed');
  });
});

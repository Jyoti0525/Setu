// Understanding test set (TODO P6.4), offline path in CI: concept + intent accuracy per input form.
import { describe, expect, it } from 'vitest';
import { motionPack } from '../src/index.ts';
import { score, ITEMS } from '../eval/understanding.ts';

describe('understanding test set (offline)', () => {
  const r = score(motionPack);
  it('50 doubts across Odia script, romanized, code-mixed, English, Hindi and speech-to-text forms', () => {
    expect(ITEMS).toHaveLength(50);
    expect(Object.keys(r.byForm).sort()).toEqual(['english', 'hindi', 'mixed', 'odia', 'romanized', 'voice']);
  });
  it('offline concept accuracy ≥ 80%, intent ≥ 95% (a miss should be "not sure", which goes online, more than a wrong concept)', () => {
    expect(r.concept!).toBeGreaterThanOrEqual(80);
    expect(r.intent!).toBeGreaterThanOrEqual(95);
  });
});

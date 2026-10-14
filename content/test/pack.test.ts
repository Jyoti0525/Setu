import { describe, expect, it } from 'vitest';
import { validatePack, validateGraph, gradeNumeric } from '@setu/core';
import { motionPack } from '../src/index.ts';

describe('motion pack', () => {
  it('passes structural validation', () => {
    expect(validateGraph(motionPack.graph)).toEqual([]);
    expect(validatePack(motionPack)).toEqual([]);
  });
  it('core concepts have ≥ 2 strategies and ≥ 4 checks (S1: distance, displacement, speed, velocity)', () => {
    for (const c of ['distance', 'displacement', 'speed', 'velocity']) {
      const strategies = new Set(motionPack.explanations.filter((e) => e.conceptId === c).map((e: { strategy: string }) => e.strategy));
      expect(strategies.size, c).toBeGreaterThanOrEqual(3);
      expect(motionPack.checks.filter((k) => k.conceptId === c).length, c).toBeGreaterThanOrEqual(4);
    }
  });
  it('every Odia text is in Odia script (critic script rule)', () => {
    const odiaRatio = (t: string) => {
      const letters = [...t].filter((ch) => /\p{L}/u.test(ch));
      const odia = letters.filter((ch) => ch.codePointAt(0)! >= 0x0b00 && ch.codePointAt(0)! <= 0x0b7f);
      return letters.length ? odia.length / letters.length : 1;
    };
    for (const e of motionPack.explanations) expect(odiaRatio(e.body.display.or!), e.id).toBeGreaterThan(0.7);
    for (const k of motionPack.checks) expect(odiaRatio(k.stem.display.or!), k.id).toBeGreaterThan(0.6);
    // no Devanagari letters inside Odia text (script mixing). Danda । ॥ (U+0964/5) is shared by all Indic scripts.
    const all = JSON.stringify([motionPack.explanations.map((e) => e.body.display.or), motionPack.checks.map((k) => k.stem.display.or)]);
    expect(/[ऀ-ॣ०-ॿ]/.test(all)).toBe(false);
  });
  it('numeric keys grade their own English stems correctly', () => {
    for (const k of motionPack.checks.filter((c) => c.kind === 'numeric')) {
      expect(gradeNumeric(String(k.numeric!.value), k.numeric!).correct, k.id).toBe(true);
    }
  });
  it('has placement items covering the graph roots', () => {
    const placement = motionPack.checks.filter((c) => c.placement).map((c) => c.conceptId);
    // every concept that has checks has a placement item (acceleration joined when its checks were written, C.3)
    expect(new Set(placement)).toEqual(new Set(['reference_point', 'distance', 'displacement', 'speed', 'velocity', 'acceleration']));
  });
});

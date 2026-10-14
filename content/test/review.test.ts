// Native review (TODO D6): decisions fix text and gate `reviewed`; drafts never move mastery.
import { describe, expect, it } from 'vitest';
import { audioKey, isTrusted } from '@setu/core';
import { motionDraft, packFields, applyReview } from '../src/index.ts';

describe('native review', () => {
  const k = motionDraft.checks.find((c) => c.id === 'chk.vel.1@1')!;
  const ids = packFields(motionDraft).filter((f) => f.gates === k.id && f.l10n.or).map((f) => f.id);

  it('every learner-facing Odia field has a stable, unique id', () => {
    const all = packFields(motionDraft).map((f) => f.id);
    expect(new Set(all).size).toBe(all.length);
    expect(ids).toEqual(expect.arrayContaining([`${k.id}#stem`, `${k.id}#opt.a`, `${k.id}#opt.a.fb`]));
  });

  it('an item becomes reviewed only when every one of its fields passed; fixes replace the draft', () => {
    const some = Object.fromEntries(ids.slice(1).map((id) => [id, { status: 'ok' as const }]));
    const p1 = applyReview(motionDraft, 'or', some);
    expect(p1.checks.find((c) => c.id === k.id)!.review.or).toBe('draft');

    const all = { ...some, [ids[0]!]: { status: 'fixed' as const, text: 'ଦ୍ରୁତି ଓ ବେଗ ମଧ୍ୟରେ ମୁଖ୍ୟ ପାର୍ଥକ୍ୟ କ\'ଣ?' } };
    const p2 = applyReview(motionDraft, 'or', all);
    const k2 = p2.checks.find((c) => c.id === k.id)!;
    expect(k2.review).toEqual({ or: 'reviewed', en: 'draft' });
    expect(k2.stem.display.or).toBe('ଦ୍ରୁତି ଓ ବେଗ ମଧ୍ୟରେ ମୁଖ୍ୟ ପାର୍ଥକ୍ୟ କ\'ଣ?');
    expect(isTrusted(k2, 'or', false)).toBe(true);
    expect(isTrusted(motionDraft.checks.find((c) => c.id === k.id)!, 'or', false)).toBe(false); // the draft is untouched
  });

  it('"unsure" never passes', () => {
    const d = Object.fromEntries(ids.map((id) => [id, { status: 'unsure' as const }]));
    expect(applyReview(motionDraft, 'or', d).checks.find((c) => c.id === k.id)!.review.or).toBe('draft');
  });

  it('audio keys are stable across normalisation (phone and generator agree)', () => {
    expect(audioKey('ଠିକ୍  କହିଲ ')).toBe(audioKey('ଠିକ୍ କହିଲ'));
    expect(audioKey('a')).not.toBe(audioKey('b'));
  });
});

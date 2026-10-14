import { describe, expect, it } from 'vitest';
import { knownWords, mergeReadings } from '../src/ocr_merge.ts';

// algebra-9 p.158, both readings as they came back (abridged)
const vision = 'ଗୋଟିଏ ଅପ୍ରବଣ ମୁଦ୍ରାକୁ 500 ଥର ଟସ୍ କରାଯିବାରୁ ନିମ୍ନ ପ୍ରକାରରେ ଫଳ ମିଳିଲା ।\nତେଣୁ, 0 ≤ P(E) ≤ 1\nଅର୍ଥାତ୍ ଏହାର ସମ୍ଭାବନା ଶୂନ ।';
const tess = 'ଗୋଟିଏ ଅପବଣ ମୁଦ୍ବାକୁ 500 ଥର ଟସ୍‌ କରାଯିବାରୁ ନିମ୍ନ ପ୍ରକାରରେ ଫଳ\nଘଟିଲା | ତେଣୁ, 0<P(E) < 1 ଅର୍ଥୀତ୍‌ ଏହାର ସମ୍ଭାବ୍ୟତା ଶୁନ ।';
const known = knownWords(['ଘଟିଲା ଘଟିଲା ଘଟିଲା ସମ୍ଭାବ୍ୟତା ସମ୍ଭାବ୍ୟତା ସମ୍ଭାବ୍ୟତା ଶୂନ ଶୂନ ଶୂନ']);

describe('vision + Tesseract merge (maths pages)', () => {
  const { text, swapped } = mergeReadings(vision, tess, known);
  it('keeps vision\'s maths and layout', () => {
    expect(text).toContain('0 ≤ P(E) ≤ 1');
    expect(text.split('\n')).toHaveLength(3);
  });
  it('a word vision swapped for a likelier one goes back to the printed word', () => {
    expect(text).toContain('ଫଳ ଘଟିଲା ।');
    expect(text).toContain('ସମ୍ଭାବ୍ୟତା ଶୂନ');
    expect(swapped).toHaveLength(2);
  });
  it('Tesseract\'s misreadings (not real words) do not replace vision\'s', () => {
    expect(text).toContain('ଅପ୍ରବଣ ମୁଦ୍ରାକୁ');
    expect(text).toContain('ଅର୍ଥାତ୍');
    expect(text).not.toContain('ଶୁନ');
  });
});

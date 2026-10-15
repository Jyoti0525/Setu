import { describe, expect, it } from 'vitest';
import { parseRevisionCards } from '../src/revision.ts';
import type { BookPassage } from '@setu/core';

const passage = { id: 'algebra-9.p1.1', ch: 1, page: 7, text: 'ସେଟ୍‌ ଓ ଏହାର ଉପାଦାନ ସମ୍ବନ୍ଧରେ ପାଠ କରିଛ । A = {1, 2, 3}' } as BookPassage;
const generated = { cards: [
  { type: 'idea', title: 'A set and its elements', body: 'A set is a collection, and its elements are the things in that collection.', keywords: ['set', 'elements'], evidence: passage.text, passageIds: [passage.id] },
  { type: 'steps', title: 'Spot the elements', body: 'Read the collection, then identify each item that belongs to it.', keywords: ['collection', 'belongs'], evidence: passage.text, passageIds: [passage.id] },
  { type: 'remember', title: 'Keep this pair together', body: 'A set and its elements are linked ideas in this lesson.', keywords: ['set', 'lesson'], evidence: passage.text, passageIds: [passage.id] },
  { type: 'formula', title: 'Set notation', body: 'The chapter introduces how sets are written.', formula: 'A = {1, 2, 3}', keywords: ['notation', 'elements'], evidence: passage.text, passageIds: [passage.id] },
] };

describe('revision card source validation', () => {
  it('accepts readable translated notes with exact original-language textbook evidence', () => {
    const cards = parseRevisionCards(generated, [passage]);
    expect(cards).toHaveLength(4);
    expect(cards[0]?.body).toContain('collection');
    expect(cards.every((card) => card.sources[0]?.passageId === passage.id)).toBe(true);
  });

  it('rejects fabricated evidence and formula cards without a formula', () => {
    const invalid = { cards: [
      { ...generated.cards[0], evidence: 'This sentence is not in the textbook.' },
      { ...generated.cards[3], formula: '' },
    ] };
    expect(parseRevisionCards(invalid, [passage])).toHaveLength(0);
  });
});

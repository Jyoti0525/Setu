import { describe, expect, it } from 'vitest';
import { parseAssessmentQuestions } from '../src/assessment.ts';
import type { BookPassage } from '@setu/core';

const odiaText = 'ସେଟ୍‌ ଓ ଏହାର ଉପାଦାନ ସମ୍ବନ୍ଧରେ ପାଠ କରିଛ ।';
const passage = { id: 'algebra-9.p1.1', ch: 1, page: 7, text: odiaText } as BookPassage;
const generated = { questions: [
  { type: 'mcq', question: 'What does the passage introduce?', options: ['Sets and their elements', 'Fractions', 'Angles', 'Graphs'], answer: 'Sets and their elements', explanation: 'The passage names sets and their elements.', evidence: odiaText, passageIds: [passage.id] },
  { type: 'blank', question: 'The passage discusses sets and their _____.', answer: 'elements', explanation: 'This completes the idea stated in the passage.', evidence: odiaText, passageIds: [passage.id] },
  { type: 'short', question: 'What two ideas are introduced?', answer: 'Sets and their elements.', rubric: ['sets', 'their elements'], explanation: 'Both ideas appear in the source.', evidence: odiaText, passageIds: [passage.id] },
  { type: 'long', question: 'Explain the ideas named in this passage.', answer: 'The passage introduces sets and their elements.', rubric: ['sets', 'their elements', 'the chapter topic'], explanation: 'These are the central ideas.', evidence: odiaText, passageIds: [passage.id] },
] };

describe('assessment source validation', () => {
  it('accepts translated English answers and rubrics when evidence cites the Odia textbook verbatim', () => {
    const questions = parseAssessmentQuestions(generated, [passage]);
    expect(questions).toHaveLength(4);
    expect(questions.map((q) => q.type)).toEqual(['mcq', 'blank', 'short', 'long']);
    expect(questions.every((q) => q.sources[0]?.passageId === passage.id)).toBe(true);
  });

  it('rejects a question whose cited evidence is not in its source passage', () => {
    const invalid = { questions: [{ ...generated.questions[0], evidence: 'Not from this textbook passage.' }] };
    expect(parseAssessmentQuestions(invalid, [passage])).toHaveLength(0);
  });
});

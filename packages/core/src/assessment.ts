import { normalizeForMatch } from './matcher.ts';

export interface AssessmentGradeItem {
  id: string;
  type: 'mcq' | 'blank' | 'short' | 'long';
  answer: string;
  accepted?: string[];
  rubric?: string[];
}

/** Deterministic scoring shared by the student app and server so the submitted score matches instantly. */
export function gradeAssessment(questions: AssessmentGradeItem[], answers: Record<string, string>) {
  const grades = questions.map((q) => {
    const answer = (answers[q.id] ?? '').trim();
    if (!answer) return 0;
    const actual = normalizeForMatch(answer);
    if ([q.answer, ...(q.accepted ?? [])].some((x) => actual === normalizeForMatch(x))) return 1;
    if (q.type === 'mcq' || q.type === 'blank') return 0;
    const rubric = q.rubric ?? [];
    return rubric.length ? rubric.filter((phrase) => actual.includes(normalizeForMatch(phrase))).length / rubric.length : 0;
  });
  const earned = grades.reduce((sum, grade) => sum + grade, 0);
  const total = questions.length;
  return { grades, earned, total, percent: total ? Math.round(earned / total * 100) : 0 };
}

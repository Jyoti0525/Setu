import { useMemo, useState } from 'preact/hooks';
import { boardKey, nameIn, gradeAssessment, toScriptDigits, LANGUAGES, type BookChapter, type BookMeta } from '@setu/core';
import { fetchWithTimeout } from './net.ts';
import { Icon } from './icons.tsx';

type BookInfo = BookMeta & { version: string; passages: number; kb: number };
type Question = {
  id: string;
  type: 'mcq' | 'blank' | 'short' | 'long';
  question: string;
  options?: string[];
  answer: string;
  accepted?: string[];
  rubric?: string[];
  explanation: string;
  evidence: string;
  sources: { passageId: string; page: number }[];
};
type Generated = { id: string; title: string; questions: Question[]; trace: { tool: string; note: string }[] };
type Subject = { name: BookMeta['subject']; books: BookInfo[] };
type Choice = { book: BookInfo; chapter: BookChapter };
type Props = {
  books: BookInfo[];
  lang: string;
  profile: { id: string; board?: string; classLevel?: number };
  headers: () => Record<string, string>;
  onBack: () => void;
};

const LABELS: Record<string, Record<string, string>> = {
  en: { title: 'Assessment', intro: 'Choose a subject and chapter. Setu will prepare a test from your textbook.', subjects: 'Choose a subject', chapters: 'Choose a chapter', back: 'Back', start: 'Generate assessment', generating: 'Setu is studying this chapter and preparing your questions…', retry: 'Try again', question: 'Question', next: 'Next', previous: 'Previous', submit: 'Submit assessment', finish: 'Finish', score: 'Your result', review: 'Review answers', again: 'Try another chapter', home: 'Back to dashboard', from: 'From your textbook', mcq: 'Choose one answer', blank: 'Fill in the blank', short: 'Short answer', long: 'Explain in your own words', words: 'words', answer: 'Your answer', correct: 'Correct', partly: 'Partly correct', incorrect: 'Review this answer', key: 'Textbook answer', why: 'Why', loading: 'Loading your books…', noBooks: 'No books are available for this class and board yet.', error: 'Setu could not prepare the assessment right now. Please try again.', class: 'Class', open: 'Open', verifying: 'Confirming your score…', verified: 'Score confirmed', unverified: 'Score shown instantly; server confirmation is unavailable.', trace: 'How Setu prepared this assessment' },
  hi: { title: 'मूल्यांकन', intro: 'विषय और पाठ चुनो। सेतु तुम्हारी किताब से परीक्षा तैयार करेगा।', subjects: 'विषय चुनो', chapters: 'पाठ चुनो', back: 'वापस', start: 'परीक्षा तैयार करो', generating: 'सेतु इस पाठ को पढ़कर प्रश्न तैयार कर रहा है…', retry: 'फिर कोशिश करो', question: 'प्रश्न', next: 'अगला', previous: 'पिछला', submit: 'परीक्षा जमा करो', finish: 'पूरा', score: 'तुम्हारा परिणाम', review: 'उत्तर देखो', again: 'दूसरा पाठ चुनो', home: 'डैशबोर्ड पर लौटो', from: 'तुम्हारी किताब से', mcq: 'एक उत्तर चुनो', blank: 'रिक्त स्थान भरो', short: 'छोटा उत्तर', long: 'अपने शब्दों में समझाओ', words: 'शब्द', answer: 'तुम्हारा उत्तर', correct: 'सही', partly: 'कुछ सही', incorrect: 'इस उत्तर को दोबारा देखो', key: 'किताब का उत्तर', why: 'क्यों', loading: 'किताबें खुल रही हैं…', noBooks: 'इस कक्षा और बोर्ड के लिए अभी किताबें उपलब्ध नहीं हैं।', error: 'सेतु अभी परीक्षा तैयार नहीं कर पाया। फिर कोशिश करो।', class: 'कक्षा', open: 'खोलें', verifying: 'तुम्हारा परिणाम जाँचा जा रहा है…', verified: 'परिणाम की पुष्टि हुई', unverified: 'अंक तुरंत दिखाए गए; सर्वर से पुष्टि नहीं हो सकी।', trace: 'सेतु ने यह परीक्षा कैसे तैयार की' },
  or: { title: 'ମୂଲ୍ୟାୟନ', intro: 'ବିଷୟ ଓ ଅଧ୍ୟାୟ ବାଛ। ସେତୁ ତୁମ ବହିରୁ ପରୀକ୍ଷା ପ୍ରସ୍ତୁତ କରିବ।', subjects: 'ବିଷୟ ବାଛ', chapters: 'ଅଧ୍ୟାୟ ବାଛ', back: 'ପଛକୁ', start: 'ମୂଲ୍ୟାୟନ ପ୍ରସ୍ତୁତ କର', generating: 'ସେତୁ ଏହି ଅଧ୍ୟାୟ ପଢ଼ି ପ୍ରଶ୍ନ ପ୍ରସ୍ତୁତ କରୁଛି…', retry: 'ପୁଣି ଚେଷ୍ଟା କର', question: 'ପ୍ରଶ୍ନ', next: 'ପରବର୍ତ୍ତୀ', previous: 'ପୂର୍ବ', submit: 'ମୂଲ୍ୟାୟନ ଦାଖଲ କର', finish: 'ସମାପ୍ତ', score: 'ତୁମ ଫଳାଫଳ', review: 'ଉତ୍ତର ଦେଖ', again: 'ଅନ୍ୟ ଅଧ୍ୟାୟ ବାଛ', home: 'ଡ୍ୟାସବୋର୍ଡକୁ ଫେର', from: 'ତୁମ ବହିରୁ', mcq: 'ଗୋଟିଏ ଉତ୍ତର ବାଛ', blank: 'ଖାଲି ସ୍ଥାନ ପୂରଣ କର', short: 'ଛୋଟ ଉତ୍ତର', long: 'ନିଜ ଭାଷାରେ ବୁଝାଅ', words: 'ଶବ୍ଦ', answer: 'ତୁମ ଉତ୍ତର', correct: 'ଠିକ୍', partly: 'ଆଂଶିକ ଠିକ୍', incorrect: 'ଏହି ଉତ୍ତରଟି ପୁଣି ଦେଖ', key: 'ବହିର ଉତ୍ତର', why: 'କାହିଁକି', loading: 'ତୁମ ବହି ଖୋଲୁଛି…', noBooks: 'ଏହି ଶ୍ରେଣୀ ଓ ବୋର୍ଡ ପାଇଁ ବହି ମିଳିଲା ନାହିଁ।', error: 'ସେତୁ ଏବେ ମୂଲ୍ୟାୟନ ପ୍ରସ୍ତୁତ କରିପାରିଲା ନାହିଁ। ପୁଣି ଚେଷ୍ଟା କର।', class: 'ଶ୍ରେଣୀ', open: 'ଖୋଲ', verifying: 'ତୁମ ଫଳ ଯାଞ୍ଚ ହେଉଛି…', verified: 'ଫଳାଫଳ ନିଶ୍ଚିତ ହେଲା', unverified: 'ଅଙ୍କ ସଙ୍ଗେସଙ୍ଗେ ଦେଖାଗଲା; ସର୍ଭର ସହ ଯାଞ୍ଚ ହେଲାନି।', trace: 'ସେତୁ ଏହି ମୂଲ୍ୟାୟନ କିପରି ପ୍ରସ୍ତୁତ କଲା' },
};
const labels = (lang: string) => LABELS[lang] ?? LABELS[LANGUAGES[lang]?.school ?? 'en'] ?? LABELS.en!;
const titleIn = (x: { or: string; en: string; hi?: string }, lang: string) => nameIn(x, lang);
const groupSubjects = (books: BookInfo[]): Subject[] => {
  const map = new Map<string, Subject>();
  for (const book of books) {
    const key = book.subject.en;
    const found = map.get(key) ?? { name: book.subject, books: [] };
    found.books.push(book);
    map.set(key, found);
  }
  return [...map.values()];
};

export function Assessment({ books: allBooks, lang, profile, headers, onBack }: Props) {
  const t = labels(lang);
  const books = useMemo(() => {
    const board = profile.board ?? 'BSE Odisha';
    const matching = allBooks.filter((b) => boardKey(b.board) === boardKey(board) && b.classLevel === (profile.classLevel ?? 9));
    return matching;
  }, [allBooks, profile.board, profile.classLevel]);
  const subjects = useMemo(() => groupSubjects(books), [books]);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [assessment, setAssessment] = useState<Generated | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<ReturnType<typeof gradeAssessment> | null>(null);
  const [verification, setVerification] = useState<'idle' | 'checking' | 'verified' | 'offline'>('idle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showReview, setShowReview] = useState(false);

  const reset = () => { setAssessment(null); setAnswers({}); setIndex(0); setResult(null); setShowReview(false); setError(''); setVerification('idle'); };
  const prepare = async (picked: Choice) => {
    setChoice(picked); setLoading(true); setError(''); reset();
    try {
      const response = await fetchWithTimeout('/api/assessment/generate', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ profileId: profile.id, board: profile.board ?? 'BSE Odisha', classLevel: profile.classLevel ?? 9, lang, bookId: picked.book.id, chapter: picked.chapter.n }),
      }, 20000);
      const data = await response.json() as Generated & { error?: string };
      if (!response.ok) throw new Error(data.error || t.error);
      if (!data.questions?.length) throw new Error(t.error);
      setAssessment(data);
    } catch (e) { setError((e as Error).message || t.error || LABELS.en!.error!); }
    finally { setLoading(false); }
  };
  const question = assessment?.questions[index];

  const submit = () => {
    if (!assessment) return;
    const scored = gradeAssessment(assessment.questions, answers);
    setResult(scored);
    setVerification('checking');
    setIndex(0);
    void fetchWithTimeout('/api/assessment/submit', { method: 'POST', headers: headers(), body: JSON.stringify({ profileId: profile.id, assessmentId: assessment.id, answers }) }, 8000)
      .then(async (r) => { if (!r.ok) throw new Error('verification unavailable'); const server = await r.json() as typeof scored; if (server.percent !== scored.percent || server.total !== scored.total) throw new Error('score mismatch'); setVerification('verified'); })
      .catch(() => setVerification('offline'));
  };
  const percent = result ? Math.round(result.earned / result.total * 100) : 0;

  return <main class="overview assessment-view">
    <div class="assessment-heading">
      <button class="assessment-back" onClick={assessment ? reset : subject ? () => { setSubject(null); setChoice(null); setError(''); } : onBack}><Icon name="back" size={17} />{assessment ? t.chapters : subject ? t.subjects : t.home}</button>
      <span class="overview-kicker"><Icon name="spark" size={16} />{t.title}</span>
      <h1>{t.title}</h1><p>{t.intro}</p>
    </div>

    {!subject && !assessment && !loading && <>
      <h2 class="assessment-section-title">{t.subjects}</h2>
      {books.length ? <div class="subject-grid">{subjects.map((s) => <button class="subject-card" onClick={() => setSubject(s)}>
        <span class="subject-card-top"><span class="subject-icon">{s.name.en.toLowerCase().includes('math') ? '∑' : s.name.en.toLowerCase().includes('life') ? '🧬' : '📘'}</span><span class="subject-open-icon"><Icon name="chevron" size={20} /></span></span>
        <strong class="subject-card-title">{titleIn(s.name, lang)}</strong><span class="subject-card-count">{s.books.length} {s.books.length === 1 ? 'textbook' : 'textbooks'}</span>
        <span class="subject-card-bottom"><span class="class-chip">{t.class ?? 'Class'} {toScriptDigits(String(profile.classLevel ?? 9), lang)} · {s.books[0]?.board}</span><span class="subject-card-action">{t.open ?? 'Open'} <Icon name="chevron" size={17} /></span></span>
      </button>)}</div> : <p class="subject-empty">{t.noBooks}</p>}
    </>}

    {subject && !assessment && !loading && !error && <>
      <button class="link assessment-inline-back" onClick={() => { setSubject(null); setChoice(null); }}>{t.subjects}</button>
      <h2 class="assessment-section-title">{t.chapters} · {titleIn(subject.name, lang)}</h2>
      <div class="assessment-chapters">{subject.books.flatMap((book) => book.chapters.map((chapter) => ({ book, chapter }))).map((x) => <button type="button" class="assessment-chapter" onClick={() => void prepare(x)}>
        <span class="assessment-chapter-number">{toScriptDigits(String(x.chapter.n), lang)}</span><span><strong>{titleIn(x.chapter.title, lang)}</strong><small>{titleIn(x.book.title, lang)} · {x.book.board}</small></span><Icon name="chevron" size={19} />
      </button>)}</div>
    </>}

    {loading && <section class="assessment-state" aria-live="polite"><span class="assessment-spinner" /><h2>{t.generating}</h2>{choice && <p>{titleIn(choice.chapter.title, lang)}</p>}</section>}
    {error && !loading && <section class="assessment-error" role="alert"><p>{error}</p><div class="assessment-error-actions"><button class="btn primary" onClick={() => choice && void prepare(choice)}>{t.retry}</button><button class="btn" onClick={() => { setError(''); setChoice(null); }}>{t.chapters}</button></div></section>}

    {assessment && !result && question && <section class="assessment-test">
      <div class="assessment-test-top"><span>{titleIn(choice!.chapter.title, lang)} · {t.question} {toScriptDigits(String(index + 1), lang)} / {toScriptDigits(String(assessment.questions.length), lang)}</span><span>{Math.round((index + 1) / assessment.questions.length * 100)}%</span></div>
      <div class="assessment-progress"><i style={{ width: `${(index + 1) / assessment.questions.length * 100}%` }} /></div>
      <article class="assessment-question"><span class="assessment-kind">{t[question.type]}</span><h2>{question.question}</h2>
        {question.type === 'mcq' && <div class="assessment-options">{question.options?.map((option) => <label class={'assessment-option' + (answers[question.id] === option ? ' selected' : '')}>
          <input type="radio" name={question.id} value={option} checked={answers[question.id] === option} onChange={() => setAnswers((a) => ({ ...a, [question.id]: option }))} /><span>{option}</span>
        </label>)}</div>}
        {question.type === 'blank' && <input class="assessment-text-answer" value={answers[question.id] ?? ''} aria-label={t.answer} placeholder="…" onInput={(e) => setAnswers((a) => ({ ...a, [question.id]: (e.currentTarget as HTMLInputElement).value }))} />}
        {(question.type === 'short' || question.type === 'long') && <><textarea class="assessment-written-answer" rows={question.type === 'long' ? 7 : 4} value={answers[question.id] ?? ''} aria-label={t.answer} placeholder={t.answer} onInput={(e) => setAnswers((a) => ({ ...a, [question.id]: (e.currentTarget as HTMLTextAreaElement).value }))} />{question.type === 'long' && <small>{(answers[question.id] ?? '').trim().split(/\s+/).filter(Boolean).length} {t.words}</small>}</>}
        <div class="assessment-source"><Icon name="book" size={16} /><span>{t.from}: {question.sources.map((s) => `${s.page}`).filter((p, i, a) => a.indexOf(p) === i).join(', ')}</span></div>
      </article>
      <div class="assessment-controls"><button class="btn secondary" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>{t.previous}</button>{index < assessment.questions.length - 1
        ? <button class="btn primary" onClick={() => setIndex((i) => i + 1)}>{t.next}<Icon name="chevron" size={18} /></button>
        : <button class="btn primary" onClick={submit}>{t.submit}<Icon name="chevron" size={18} /></button>}</div>
    </section>}

    {assessment && result && <section class="assessment-result">
      <div class="assessment-score"><span>{t.score}</span><strong>{result.percent}%</strong><small>{result.earned.toFixed(result.earned % 1 ? 1 : 0)} / {result.total} {(t.correct ?? LABELS.en!.correct!).toLowerCase()}</small><small aria-live="polite">{verification === 'checking' ? t.verifying : verification === 'verified' ? t.verified : verification === 'offline' ? t.unverified : ''}</small></div>
      <div class="assessment-result-actions"><button class="btn secondary" onClick={() => setShowReview((x) => !x)}>{showReview ? t.finish : t.review}</button><button class="btn primary" onClick={() => { reset(); setSubject(null); setChoice(null); }}>{t.again}</button></div>
      <details class="assessment-trace"><summary>{t.trace}</summary><ol>{assessment.trace.map((step) => <li><b>{step.tool}</b><span>{step.note}</span></li>)}</ol></details>
      {showReview && <div class="assessment-review">{assessment.questions.map((q, i) => {
        const grade = result.grades[i] ?? 0;
        return <article class="assessment-review-item"><span class="assessment-kind">{toScriptDigits(String(i + 1), lang)} · {grade === 1 ? t.correct : grade > 0 ? t.partly : t.incorrect}</span><h3>{q.question}</h3><p><b>{t.answer}:</b> {answers[q.id] || '—'}</p><p><b>{t.key}:</b> {q.answer}</p><p>{q.explanation}</p><small>{t.from}: {q.sources.map((s) => s.page).filter((p, j, a) => a.indexOf(p) === j).join(', ')}</small></article>;
      })}</div>}
    </section>}
  </main>;
}

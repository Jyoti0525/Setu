// Learner model (PLAN §6.3). Derived only — built by fold(events).

export type Lang = 'or' | 'hi' | 'en' | (string & {});
export type InputMode = 'voice' | 'text' | 'romanized' | 'tap';
export type DataTier = 'low' | 'mid' | 'high';
export type Tier = 'cloud' | 'weak' | 'device';

export interface MisconceptionState {
  signals: number;
  confirmed: boolean;
  resolved: boolean;
}

export interface ConceptState {
  pKnown: number;
  /** weighted count of trustworthy evidence */
  evidenceCount: number;
  attempts: number;
  correctStreak: number;
  /** last trustworthy (bank/placement) results, newest last, max 2 */
  recentTrusted: boolean[];
  misconceptions: Record<string, MisconceptionState>;
  strategiesTried: string[];
  strategyThatWorked?: string;
  /** strategy of the most recent explanation (what the next check verifies) */
  lastStrategy?: string;
  reviewStage: number;
  nextReviewAt?: number;
  lastSeenAt?: number;
  mastered: boolean;
  /** check item ids shown recently (newest last, max 6) — avoid repeats */
  seenChecks: string[];
}

export interface PlanItem {
  action: ActionKind;
  conceptId: string;
  reason: string;
  strategy?: string;
  misconceptionId?: string;
  minutes?: number;
  /** explanation written and critic-approved between sessions (server), so it works offline too */
  pregenerated?: { lang: string; strategy?: string; text: string; speak: string };
}

export interface SessionPlan {
  createdAt: number;
  forSessionMinutes: number;
  items: PlanItem[];
  /** what was prefetched and why (shown in trace) */
  prefetch?: { itemRef: string; kb: number; why: string }[];
  preparedBy: 'server' | 'device';
}

export interface ResumePointer {
  sessionId: string;
  planIndex: number;
  conceptId: string;
  step: 'explain' | 'check' | 'feedback';
  checkIds?: string[];
  checkIndex?: number;
}

export type ActionKind = 'teach' | 'review' | 'remediate' | 'probe_prereq' | 'practice' | 'step_back';

export interface QueuedDoubt {
  doubtId: string;
  text: string;
  askedAt: number;
  answered: boolean;
  answer?: string;
  /** a photo kept on the phone until it can be read online (the server never sees it before that) */
  photo?: boolean;
  /** a spoken question kept on the phone until it can be transcribed online (store-and-forward voice, P3.7) */
  voice?: boolean;
}

export interface Commitment {
  id: string;
  text: string;
  dueAt?: number;
  kept: boolean;
}

export interface LearnerState {
  profileId: string;
  avatar: string;
  classLevel: number;
  board: string;
  classCode?: string;
  /** P3.22: region of her class, for local analogies */
  region?: string;
  language: { ui: Lang; response: Lang; home?: string; inputMode: InputMode; readingLevel: number };
  constraints: {
    typicalSessionMin: number;
    sessionMinutes: number;
    dataTier: DataTier;
    dataUsedKB: number;
    /** day index (ts / 1 day) that dataUsedKB counts for */
    dataDay?: number;
    sharedDevice: boolean;
  };
  goal: { type: 'exam' | 'chapter'; conceptIds: string[]; dueDate?: number; setBy: 'learner' | 'teacher' } | null;
  concepts: Record<string, ConceptState>;
  commitments: Commitment[];
  queuedDoubts: QueuedDoubt[];
  preparedSession?: SessionPlan;
  resumePointer?: ResumePointer;
  hypotheses: { weakPrereq?: string; suspectedMisconception?: string };
  placementDone: boolean;
  /** first-day placement walk (PLAN §6.3, P2.31): answers so far, and the question on screen */
  placement: { answers: { conceptId: string; checkId: string; correct: boolean }[]; pending?: string; startedAt?: number };
  misconceptionCandidates: { conceptId: string; description: string; evidence: string }[];
  escalations: { conceptId?: string; kind: 'academic' | 'wellbeing' | 'dropoff'; reason: string; at: number; draft?: string }[];
  session?: { id: string; openedAt: number; tier: Tier; minutes: number };
  sessionsCompleted: number;
  /** P4.29: when the low-budget notice was given (data: day index; time: session id), so it is said once */
  budgetLow?: { dataDay?: number; timeSession?: string };
  /** how her last questions were asked (text / voice / photo), newest last */
  recentModes?: ('text' | 'voice' | 'photo')[];
  /** P4.28: the link the phone last reported */
  link?: Tier;
  /** her last graded answer: an insisting message right after a wrong one is met with the textbook (P2.44) */
  lastAnswer?: { checkId: string; conceptId: string; correct: boolean; at: number };
  lastActiveAt?: number;
}

export function emptyLearner(profileId: string): LearnerState {
  return {
    profileId,
    avatar: '',
    classLevel: 9,
    board: 'BSE-Odisha',
    language: { ui: 'or', response: 'or', inputMode: 'text', readingLevel: 3 },
    constraints: { typicalSessionMin: 20, sessionMinutes: 20, dataTier: 'low', dataUsedKB: 0, sharedDevice: true },
    goal: null,
    concepts: {},
    commitments: [],
    queuedDoubts: [],
    hypotheses: {},
    placementDone: false,
    placement: { answers: [] },
    misconceptionCandidates: [],
    escalations: [],
    sessionsCompleted: 0,
  };
}

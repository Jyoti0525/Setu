// The learner's append-only event log is the single source of truth (PLAN §5.6, §8.5).
// LearnerState = fold(events). Nothing else is authoritative.

import type { Lang, InputMode, DataTier, Tier, SessionPlan, ResumePointer } from './state.ts';

export type EvidenceSource = 'bank' | 'placement' | 'llm_practice' | 'free_text';

export interface EventPayloads {
  PROFILE_CREATED: {
    avatar: string;
    classLevel: number;
    board: string;
    language: { ui: Lang; response: Lang; home?: string; inputMode: InputMode; readingLevel: number };
    dataTier: DataTier;
    sharedDevice: boolean;
  };
  PROFILE_UPDATED: {
    language?: Partial<{ ui: Lang; response: Lang; home: string; inputMode: InputMode; readingLevel: number }>;
    dataTier?: DataTier;
    sessionMinutes?: number;
    avatar?: string;
  };
  /** displayName: only if she chose to show her name to the teacher (school-mediated, PLAN §10.6) */
  CLASS_JOINED: { classCode: string; displayName?: string; /** the class's region (P3.22 local analogies) */ region?: string };
  GOAL_SET: { type: 'exam' | 'chapter'; conceptIds: string[]; dueDate?: number; setBy: 'learner' | 'teacher' };
  SESSION_OPENED: { sessionId: string; tier: Tier; minutes?: number };
  SESSION_ENDED: { sessionId: string; reason: 'explicit' | 'inactivity' | 'sync'; minutesUsed: number };
  DOUBT_ASKED: { doubtId: string; text: string; mode: 'text' | 'voice' | 'photo'; language: string; script?: string };
  DOUBT_QUEUED: { doubtId: string; text: string; reason: string };
  DOUBT_ANSWERED: { doubtId: string; conceptId?: string; answer: string };
  EXPLANATION_DELIVERED: { conceptId: string; strategy: string; level: number; itemRef?: string };
  CHECK_SHOWN: { checkId: string; conceptId: string; source: EvidenceSource };
  ANSWER_GRADED: {
    checkId: string;
    conceptId: string;
    correct: boolean;
    /** 0..1 — grader confidence; free-text grades can be low */
    confidence: number;
    source: EvidenceSource;
    /** misconceptions signalled by the chosen distractor / diagnosis */
    misconceptionIds: string[];
    /** strategy used for the explanation this check verified */
    strategy?: string;
  };
  MISCONCEPTION_CANDIDATE: { conceptId: string; description: string; evidence: string };
  /** conceptIds = asked; known = passed + their prerequisites (implied); gaps = concepts she missed twice */
  PLACEMENT_COMPLETED: { conceptIds: string[]; known?: string[]; gaps?: string[]; reason?: string };
  HYPOTHESIS_SET: { weakPrereq?: string | null; suspectedMisconception?: string | null; note?: string };
  PLAN_SET: { plan: SessionPlan };
  STEP_STARTED: { pointer: ResumePointer };
  STEP_COMPLETED: { pointer: ResumePointer };
  ESCALATED: { conceptId?: string; kind: 'academic' | 'wellbeing' | 'dropoff'; reason: string };
  /** between-session run: what the teacher could try in class (PLAN §5.2 "draft reteach") */
  RETEACH_DRAFTED: { conceptId: string; draft: string };
  DATA_USED: { kb: number };
  /** P4.28: the link changed (device ↔ weak ↔ cloud) — the agent switches tools, syncs, prefetches when it improved */
  CONNECTIVITY_CHANGED: { from: Tier; to: Tier };
  /** P4.29: today's data or this session's time is nearly used up — audio dropped / session wrapped at a resume point */
  BUDGET_LOW: { kind: 'data' | 'time'; left: number };
  COMMITMENT_MADE: { commitmentId: string; text: string; dueAt?: number };
  COMMITMENT_KEPT: { commitmentId: string };
}

export type EventType = keyof EventPayloads;

export interface SetuEvent<T extends EventType = EventType> {
  /** globally unique (uuid) — the dedupe key */
  id: string;
  profileId: string;
  deviceId: string;
  /** per-device monotonically increasing sequence number */
  seq: number;
  /** device wall clock (unreliable — never trusted for ordering within a device) */
  ts: number;
  type: T;
  payload: EventPayloads[T];
  /** `itemId@version` of the content item this event refers to */
  itemVersion?: string;
  /**
   * The turn that wrote it (P4.4 idempotent turns): `by` server = the online cycle, device = the phone ran it itself
   * after the request timed out. If both exist for one turn, the phone's wins — it is what she saw.
   */
  turn?: { id: string; by: 'server' | 'device' };
}

export type AnyEvent = { [K in EventType]: SetuEvent<K> }[EventType];

/**
 * Canonical order: dedupe by id; within a device, `seq` order; across devices,
 * by a per-device monotone timestamp, then deviceId, then seq. The result does
 * not depend on the order events arrived in, so every replica folds the same state.
 */
export function canonicalOrder(events: readonly AnyEvent[]): AnyEvent[] {
  const byId = new Map<string, AnyEvent>();
  for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e);
  // a turn the phone gave up waiting for and ran itself: the server's late copy of that turn is not counted twice
  const ranOnPhone = new Set([...byId.values()].filter((e) => e.turn?.by === 'device').map((e) => e.turn!.id));
  if (ranOnPhone.size) for (const [id, e] of byId) if (e.turn?.by === 'server' && ranOnPhone.has(e.turn.id)) byId.delete(id);
  const byDevice = new Map<string, AnyEvent[]>();
  for (const e of byId.values()) {
    const list = byDevice.get(e.deviceId) ?? [];
    list.push(e);
    byDevice.set(e.deviceId, list);
  }
  const keyed: { e: AnyEvent; mts: number }[] = [];
  for (const list of byDevice.values()) {
    list.sort((a, b) => a.seq - b.seq || cmp(a.id, b.id));
    let mts = -Infinity;
    for (const e of list) {
      mts = Math.max(mts, e.ts);
      keyed.push({ e, mts });
    }
  }
  keyed.sort((a, b) => a.mts - b.mts || cmp(a.e.deviceId, b.e.deviceId) || a.e.seq - b.e.seq);
  return keyed.map((k) => k.e);
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

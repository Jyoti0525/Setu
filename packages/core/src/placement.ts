// First-day placement (PLAN §6.3, §9.1; TODO P2.31): ~3 minutes, 5–7 tap questions that walk the
// prerequisite graph from the top. Pass → its prerequisites are skipped (implied known).
// Miss → one level down. A single miss is confirmed with the concept's second item once its
// prerequisites turn out known — that is when a slip would misplace her. What is left unmeasured
// is probed later by the normal policy (P2.32).

import type { LearnerState } from './state.ts';
import type { ChapterPack, CheckItem } from './pack.ts';
import { prerequisitesOf, dependentsOf, type ConceptGraph } from './graph.ts';

export const PLACEMENT_MAX_QUESTIONS = 7;
export const PLACEMENT_MINUTES = 3;
/** after the time limit, stop once at least this many were asked */
const PLACEMENT_MIN_QUESTIONS = 3;

/** Placement runs on a brand-new learner only, until it completes (or she starts learning some other way first). */
export function placementActive(s: LearnerState): boolean {
  if (s.placementDone) return false;
  if (s.placement.answers.length || s.placement.pending) return true;
  return !Object.values(s.concepts).some((c) => c.attempts > 0);
}

const closure = (g: ConceptGraph, ids: Iterable<string>, step: (g: ConceptGraph, id: string) => string[]) => {
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...step(g, id));
  }
  return out;
};

/** Longest prerequisite chain below a concept (roots = 0). */
export function depthOf(g: ConceptGraph, id: string, memo = new Map<string, number>()): number {
  if (memo.has(id)) return memo.get(id)!;
  const pre = prerequisitesOf(g, id);
  const d = pre.length ? 1 + Math.max(...pre.map((p) => depthOf(g, p, memo))) : 0;
  memo.set(id, d);
  return d;
}

export interface PlacementSummary {
  asked: string[];
  passed: string[];
  /** asked and never answered right */
  gaps: string[];
  /** passed + all their prerequisites, minus gaps */
  known: string[];
}

export function placementSummary(s: LearnerState, pack: ChapterPack): PlacementSummary {
  const g = pack.graph;
  const by = new Map<string, boolean[]>();
  for (const a of s.placement.answers) by.set(a.conceptId, [...(by.get(a.conceptId) ?? []), a.correct]);
  const asked = [...by.keys()];
  const passed = asked.filter((c) => by.get(c)!.some(Boolean));
  const gaps = asked.filter((c) => !by.get(c)!.some(Boolean));
  const gapSet = new Set(gaps);
  const known = [...closure(g, passed, prerequisitesOf)].filter((c) => !gapSet.has(c)).sort();
  return { asked, passed, gaps, known };
}

function unusedItem(s: LearnerState, pack: ChapterPack, conceptId: string): CheckItem | undefined {
  const used = new Set(s.placement.answers.map((a) => a.checkId));
  return pack.checks
    .filter((c) => c.placement && c.conceptId === conceptId && !used.has(c.id))
    .sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id))[0];
}

export type PlacementStep =
  | { done: false; conceptId: string; check: CheckItem; reason: string }
  | { done: true; reason: string; summary: PlacementSummary };

export function nextPlacement(s: LearnerState, pack: ChapterPack, now: number): PlacementStep {
  const g = pack.graph;
  const sum = placementSummary(s, pack);
  const n = s.placement.answers.length;
  const finish = (reason: string): PlacementStep => ({ done: true, reason, summary: sum });
  if (n >= PLACEMENT_MAX_QUESTIONS) return finish(`${n} questions asked (limit ${PLACEMENT_MAX_QUESTIONS})`);
  if (s.placement.startedAt !== undefined && now - s.placement.startedAt > PLACEMENT_MINUTES * 60_000 && n >= PLACEMENT_MIN_QUESTIONS)
    return finish(`${PLACEMENT_MINUTES} minutes used`);

  const known = new Set(sum.known);
  const below = closure(g, sum.gaps, dependentsOf); // a gap means everything built on it is not known yet
  const asked = new Set(sum.asked);
  const memo = new Map<string, number>();
  // with a goal, place only what the goal needs (the goal and its prerequisites): nothing above it is worth her minutes yet
  const goalIds = (s.goal?.conceptIds ?? []).filter((c) => g.concepts[c]);
  const scope = goalIds.length ? closure(g, goalIds, prerequisitesOf) : null;
  const open = [...new Set(pack.checks.filter((c) => c.placement).map((c) => c.conceptId))]
    .filter((c) => g.concepts[c] && (!scope || scope.has(c)) && !asked.has(c) && !known.has(c) && !below.has(c))
    .sort((a, b) => depthOf(g, b, memo) - depthOf(g, a, memo) || (g.concepts[b]!.weight - g.concepts[a]!.weight) || a.localeCompare(b));
  const next = open[0];
  if (!next) {
    // confirm a single miss whose prerequisites she knows: one slip should not send her back a level
    const once = sum.gaps
      .filter((c) => s.placement.answers.filter((a) => a.conceptId === c).length === 1 && prerequisitesOf(g, c).every((p) => known.has(p)) && unusedItem(s, pack, c))
      .sort((a, b) => depthOf(g, b, memo) - depthOf(g, a, memo) || a.localeCompare(b));
    if (once[0]) return { done: false, conceptId: once[0], check: unusedItem(s, pack, once[0])!, reason: `missed ${once[0]} once, but knows its prerequisites → confirm with a second question` };
    return finish('every concept placed (asked or implied)');
  }
  const k = unusedItem(s, pack, next)!;
  const why = !n ? (scope ? `start at the top of her goal: ${next}` : `start at the top of the graph: ${next}`)
    : sum.gaps.length && prerequisitesOf(g, sum.gaps.at(-1)!).includes(next) ? `missed ${sum.gaps.at(-1)} → one level down: ${next}`
    : `${next} not placed yet (not implied by an answer so far)`;
  return { done: false, conceptId: next, check: k, reason: why };
}

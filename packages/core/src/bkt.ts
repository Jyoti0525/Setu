// Bayesian Knowledge Tracing (PLAN §6.3).

export const BKT = { pL0: 0.2, pT: 0.15, slip: 0.1, guess: 0.25 } as const;
export const MASTERY_THRESHOLD = 0.85;

/** How much each evidence source counts (PLAN §6.5: only the reviewed bank moves mastery fully). */
export const SOURCE_WEIGHT = { bank: 1, placement: 1, llm_practice: 0.25, free_text: 0.6 } as const;

export function bktPosterior(p: number, correct: boolean, params = BKT): number {
  const { slip, guess } = params;
  return correct
    ? (p * (1 - slip)) / (p * (1 - slip) + (1 - p) * guess)
    : (p * slip) / (p * slip + (1 - p) * (1 - guess));
}

/**
 * One BKT step, scaled by evidence weight w ∈ [0,1] (source weight × grader confidence).
 * w = 1 is the textbook update; w = 0 leaves p unchanged.
 */
export function bktUpdate(p: number, correct: boolean, w = 1, params = BKT): number {
  const post = bktPosterior(p, correct, params);
  const learned = post + (1 - post) * params.pT;
  return clamp01(p + w * (learned - p));
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

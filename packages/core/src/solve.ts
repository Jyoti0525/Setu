// `solve` tool: deterministic maths for worked examples and numeric checks (PLAN §6.1).
// The LLM never computes a number that reaches the learner — this does.

export type Suvat = { s?: number; u?: number; v?: number; a?: number; t?: number };
export type SolveResult = { ok: true; values: Required<Suvat>; steps: string[] } | { ok: false; error: string };

const r = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Equations of uniformly accelerated motion. Give any three of s, u, v, a, t (SI units).
 *   v = u + at,  s = ut + ½at²,  v² = u² + 2as,  s = ½(u+v)t
 * When t has two roots, the smallest non-negative one is used.
 */
export function solveSuvat(known: Suvat): SolveResult {
  const k = { ...known };
  const has = (x: keyof Suvat) => typeof k[x] === 'number' && Number.isFinite(k[x]);
  const count = (['s', 'u', 'v', 'a', 't'] as const).filter(has).length;
  if (count < 3) return { ok: false, error: 'need any three of s, u, v, a, t' };
  if (has('t') && k.t! < 0) return { ok: false, error: 'time cannot be negative' };
  const steps: string[] = [];

  for (let pass = 0; pass < 3; pass++) {
    if (!has('v') && has('u') && has('a') && has('t')) { k.v = k.u! + k.a! * k.t!; steps.push(`v = u + at = ${r(k.v)}`); }
    if (!has('u') && has('v') && has('a') && has('t')) { k.u = k.v! - k.a! * k.t!; steps.push(`u = v − at = ${r(k.u)}`); }
    if (!has('a') && has('u') && has('v') && has('t')) {
      if (k.t === 0) return { ok: false, error: 't = 0' };
      k.a = (k.v! - k.u!) / k.t!; steps.push(`a = (v − u)/t = ${r(k.a)}`);
    }
    if (!has('t') && has('u') && has('v') && has('a') && k.a !== 0) { k.t = (k.v! - k.u!) / k.a!; steps.push(`t = (v − u)/a = ${r(k.t)}`); }
    if (!has('s') && has('u') && has('t') && has('a')) { k.s = k.u! * k.t! + 0.5 * k.a! * k.t! ** 2; steps.push(`s = ut + ½at² = ${r(k.s)}`); }
    if (!has('s') && has('u') && has('v') && has('t')) { k.s = 0.5 * (k.u! + k.v!) * k.t!; steps.push(`s = ½(u + v)t = ${r(k.s)}`); }
    if (!has('v') && has('u') && has('a') && has('s')) {
      const v2 = k.u! ** 2 + 2 * k.a! * k.s!;
      if (v2 < 0) return { ok: false, error: 'no real solution (v² < 0)' };
      k.v = Math.sqrt(v2) * (k.u! < 0 ? -1 : 1); steps.push(`v² = u² + 2as → v = ${r(k.v)}`);
    }
    if (!has('u') && has('v') && has('a') && has('s')) {
      const u2 = k.v! ** 2 - 2 * k.a! * k.s!;
      if (u2 < 0) return { ok: false, error: 'no real solution (u² < 0)' };
      k.u = Math.sqrt(u2); steps.push(`u² = v² − 2as → u = ${r(k.u)}`);
    }
    if (!has('a') && has('u') && has('v') && has('s') && k.s !== 0) { k.a = (k.v! ** 2 - k.u! ** 2) / (2 * k.s!); steps.push(`a = (v² − u²)/2s = ${r(k.a)}`); }
    if (!has('t') && has('u') && has('a') && has('s')) {
      if (k.a === 0) { if (k.u === 0) return { ok: false, error: 'no motion' }; k.t = k.s! / k.u!; }
      else {
        const disc = k.u! ** 2 + 2 * k.a! * k.s!;
        if (disc < 0) return { ok: false, error: 'no real solution for t' };
        const roots = [(-k.u! + Math.sqrt(disc)) / k.a!, (-k.u! - Math.sqrt(disc)) / k.a!].filter((x) => x >= 0).sort((a, b) => a - b);
        if (!roots.length) return { ok: false, error: 'no non-negative time' };
        k.t = roots[0];
      }
      steps.push(`s = ut + ½at² → t = ${r(k.t!)}`);
    }
    if (!has('u') && has('s') && has('t') && has('a') && k.t !== 0) { k.u = (k.s! - 0.5 * k.a! * k.t! ** 2) / k.t!; steps.push(`u = (s − ½at²)/t = ${r(k.u)}`); }
    if (!has('a') && has('s') && has('u') && has('t') && k.t !== 0) { k.a = (2 * (k.s! - k.u! * k.t!)) / k.t! ** 2; steps.push(`a = 2(s − ut)/t² = ${r(k.a)}`); }
  }
  if (!(['s', 'u', 'v', 'a', 't'] as const).every(has)) return { ok: false, error: 'under-determined' };
  if (k.t! < 0) return { ok: false, error: 'negative time — check the givens' };
  return { ok: true, values: { s: r(k.s!), u: r(k.u!), v: r(k.v!), a: r(k.a!), t: r(k.t!) }, steps };
}

export const kmphToMps = (x: number) => r((x * 1000) / 3600);
export const mpsToKmph = (x: number) => r((x * 3600) / 1000);
export const averageSpeed = (totalDistance: number, totalTime: number) => r(totalDistance / totalTime);
export const averageVelocity = (displacement: number, totalTime: number) => r(displacement / totalTime);

/** Distance and displacement of a path made of straight legs given as [dx, dy] vectors (metres). */
export function pathDistanceDisplacement(legs: [number, number][]): { distance: number; displacement: number } {
  let x = 0, y = 0, d = 0;
  for (const [dx, dy] of legs) { d += Math.hypot(dx, dy); x += dx; y += dy; }
  return { distance: r(d), displacement: r(Math.hypot(x, y)) };
}

/** Distance and displacement after moving along a circle of radius R through `fraction` of a full turn. */
export function circularPath(R: number, fraction: number): { distance: number; displacement: number } {
  const theta = 2 * Math.PI * fraction;
  return { distance: r(R * theta), displacement: r(2 * R * Math.abs(Math.sin(theta / 2))) };
}

/** Uniform circular motion speed v = 2πR / T. */
export const circularSpeed = (R: number, period: number) => r((2 * Math.PI * R) / period);

/** Tool-call dispatcher: the agent calls `solve` with a named operation. */
export function solve(op: string, args: Record<string, number | [number, number][]>): unknown {
  switch (op) {
    case 'suvat': return solveSuvat(args as Suvat);
    case 'average_speed': return averageSpeed(args.distance as number, args.time as number);
    case 'average_velocity': return averageVelocity(args.displacement as number, args.time as number);
    case 'kmph_to_mps': return kmphToMps(args.value as number);
    case 'mps_to_kmph': return mpsToKmph(args.value as number);
    case 'path': return pathDistanceDisplacement(args.legs as [number, number][]);
    case 'circular_path': return circularPath(args.radius as number, args.fraction as number);
    case 'circular_speed': return circularSpeed(args.radius as number, args.period as number);
    default: return { ok: false, error: `unknown op ${op}` };
  }
}

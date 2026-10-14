// Rule-based student simulator in CI (TODO P6.2) and the deterministic half of agent vs plain tutor (P6.1).
import { describe, expect, it } from 'vitest';
import { motionPack } from '../src/index.ts';
import { compare, runAgent, simulate, PERSONAS } from '../eval/simulator.ts';

describe('student simulator', () => {
  const r = compare(motionPack);
  it('every persona reaches mastery of the goal with the agent, all misconceptions resolved, within 30 answers', () => {
    for (const x of r.rows) {
      expect(x.agent.mastered, x.agent.persona).toBe(true);
      expect(x.agent.misconceptionsLeft, x.agent.persona).toEqual([]);
      expect(x.agent.answers, x.agent.persona).toBeLessThanOrEqual(30);
    }
  });
  it('the agent needs fewer answers in total than the plain tutor; placement saves a learner who already knows it', () => {
    const total = (arm: 'agent' | 'baseline') => r.rows.reduce((n, x) => n + x[arm].answers, 0);
    expect(total('agent')).toBeLessThan(total('baseline'));
    const lipi = r.rows.find((x) => x.agent.persona.startsWith('lipi'))!;
    expect(lipi.agent.answers).toBeLessThan(lipi.baseline.answers / 2);
  });
  it('is deterministic (same numbers every run)', () => {
    expect(runAgent(motionPack, PERSONAS[0]!)).toEqual(runAgent(motionPack, PERSONAS[0]!));
  });
});

describe('a learner nothing reaches', () => {
  it('is escalated to her teacher once, with the agent moving on — not escalated again every few answers', () => {
    const r = simulate(motionPack, { id: 'stuck', knows: ['reference_point', 'distance', 'speed', 'displacement'], misconceptions: ['speed_equals_velocity'], learnsAfter: 1, goal: 'velocity', stubborn: true }, { maxTurns: 60 });
    expect(r.state.escalations.filter((e) => e.kind === 'academic' && e.conceptId === 'velocity')).toHaveLength(1);
    expect(r.result.mastered).toBe(false);
  });
});

// Concept graph + content-pack types (PLAN §6.3, §8.3, §11).

export interface Concept {
  id: string;
  /** display names per language */
  name: Record<string, string>;
  prerequisites: string[];
  /** how much this concept matters for the default chapter goal, 0..1 */
  weight: number;
  depth: 'core' | 'rest';
}

export interface ConceptGraph {
  concepts: Record<string, Concept>;
}

export function prerequisitesOf(g: ConceptGraph, id: string): string[] {
  return g.concepts[id]?.prerequisites ?? [];
}

/** Every concept that lists `id` as a prerequisite. */
export function dependentsOf(g: ConceptGraph, id: string): string[] {
  return Object.values(g.concepts).filter((c) => c.prerequisites.includes(id)).map((c) => c.id);
}

/** Concepts ordered so that prerequisites come first. Throws on cycles. */
export function topoOrder(g: ConceptGraph): string[] {
  const out: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`cycle at ${id}`);
    state.set(id, 1);
    for (const p of prerequisitesOf(g, id)) visit(p);
    state.set(id, 2);
    out.push(id);
  };
  for (const id of Object.keys(g.concepts).sort()) visit(id);
  return out;
}

export function validateGraph(g: ConceptGraph): string[] {
  const errors: string[] = [];
  for (const c of Object.values(g.concepts)) {
    for (const p of c.prerequisites) if (!g.concepts[p]) errors.push(`${c.id}: unknown prerequisite ${p}`);
  }
  try {
    topoOrder(g);
  } catch (e) {
    errors.push(String((e as Error).message));
  }
  return errors;
}

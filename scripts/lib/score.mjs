// scripts/lib/score.mjs — arch-score rubric v1: deterministic architecture
// scoring over a code-map.json model. Pure logic — no I/O, no timestamps,
// no randomness: the same model always yields the byte-identical score
// object (eval golden snapshots depend on this).
//
// Rubric of record: skills/arch-score/SKILL.md
// total = round(D × E) + AI adjustment (bounded ±10% of base, CLI-enforced).
import { round3 } from './core.mjs';

export const RUBRIC = 'arch-score-v1';

/**
 * Iterative Tarjan SCC (explicit stack — deep dependency chains in big
 * repos would overflow a recursive version).
 * @param {string[]} ids node ids
 * @param {Map<string, string[]>} adj out-adjacency
 * @returns {string[][]} strongly-connected components
 */
export function tarjanSCC(ids, adj) {
  const index = new Map(), low = new Map(), onStack = new Set();
  const stack = [], sccs = [];
  let counter = 0;
  for (const root of ids) {
    if (index.has(root)) continue;
    const frames = [[root, 0]];
    while (frames.length) {
      const frame = frames[frames.length - 1];
      const v = frame[0];
      if (frame[1] === 0) {
        index.set(v, counter); low.set(v, counter); counter++;
        stack.push(v); onStack.add(v);
      }
      const children = adj.get(v) || [];
      let descended = false;
      while (frame[1] < children.length) {
        const w = children[frame[1]++];
        if (!index.has(w)) { frames.push([w, 0]); descended = true; break; }
        if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      }
      if (descended) continue;
      frames.pop();
      if (frames.length) {
        const p = frames[frames.length - 1][0];
        low.set(p, Math.min(low.get(p), low.get(v)));
      }
      if (low.get(v) === index.get(v)) {
        const comp = [];
        for (;;) {
          const w = stack.pop(); onStack.delete(w); comp.push(w);
          if (w === v) break;
        }
        sccs.push(comp);
      }
    }
  }
  return sccs;
}

/**
 * Transitive-reach density: reachable ordered pairs / n² (self excluded) —
 * MacCormack propagation cost. Above `sampleAbove` nodes, BFS only from an
 * id-sorted every-k-th sample (deterministic, no RNG).
 */
export function reachDensity(ids, adj, sampleAbove = 3000) {
  const n = ids.length;
  if (n < 2) return 0;
  let sources = ids;
  if (n > sampleAbove) {
    const sorted = [...ids].sort();
    const step = Math.ceil(n / 1000);
    sources = sorted.filter((_, i) => i % step === 0);
  }
  let pairs = 0;
  for (const s of sources) {
    const seen = new Set([s]);
    const queue = [s];
    let qi = 0;
    while (qi < queue.length) {
      const v = queue[qi++];
      for (const w of adj.get(v) || []) {
        if (!seen.has(w)) { seen.add(w); queue.push(w); }
      }
    }
    pairs += seen.size - 1;
  }
  return pairs / (sources.length * n);
}

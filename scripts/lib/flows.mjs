// scripts/lib/flows.mjs — flow construction (forward call/dependency chains per
// entry point, with high-in-degree hubs as non-expandable leaves). Port of flows.py.
import { qualifiedName } from './extractors/base.mjs';

/** Mark the top `percentile` of declarations by in-degree as hubs. Sets _hub on
 *  every declaration; returns the set of hub qualified_names. */
export function markHubs(declarations, percentile = 0.05) {
  for (const d of declarations) d._hub = false;
  const nonzero = declarations.filter((d) => (d._in_degree || 0) > 0);
  nonzero.sort((a, b) => {
    if (b._in_degree !== a._in_degree) return b._in_degree - a._in_degree;
    const qa = qualifiedName(a), qb = qualifiedName(b);
    return qa < qb ? -1 : qa > qb ? 1 : 0;
  });
  const k = Math.floor(nonzero.length * percentile);
  const hubIds = new Set();
  for (let i = 0; i < k; i++) {
    nonzero[i]._hub = true;
    hubIds.add(qualifiedName(nonzero[i]));
  }
  return hubIds;
}

/** Forward BFS from `seed` over adjacency (from → [to], 'uses' edges). A hub is
 *  included but not expanded (unless it is the seed). Each node placed once at
 *  its shortest depth; back/cross edges omitted. Returns [orderedIds, edgeDicts]. */
export function traceFlow(seed, adjacency, hubIds, maxDepth = 6) {
  const visited = new Set([seed]);
  const order = [seed];
  const flowEdges = [];
  const depth = new Map([[seed, 0]]);
  const q = [seed];
  let head = 0;
  while (head < q.length) {
    const u = q[head++];
    if (u !== seed && hubIds.has(u)) continue; // hub: leaf
    if (depth.get(u) >= maxDepth) continue;
    for (const v of adjacency.get(u) || []) {
      if (visited.has(v)) continue;
      visited.add(v);
      depth.set(v, depth.get(u) + 1);
      order.push(v);
      flowEdges.push({ from: u, to: v });
      q.push(v);
    }
  }
  return [order, flowEdges];
}

/** One deterministic candidate flow per seed (entry-point qualified_name). */
export function buildFlows(seeds, declarations, edges, hubIds, maxDepth = 6) {
  const adjacency = new Map();
  for (const e of edges) {
    if (e.kind === 'uses') {
      if (!adjacency.has(e.from)) adjacency.set(e.from, []);
      adjacency.get(e.from).push(e.to);
    }
  }
  const byQname = new Map(declarations.map((d) => [qualifiedName(d), d]));
  const out = [];
  const seenSeeds = new Set();
  for (const seed of seeds) {
    if (seenSeeds.has(seed)) continue;
    seenSeeds.add(seed);
    const decl = byQname.get(seed);
    if (decl == null) continue;
    const [nodes, fedges] = traceFlow(seed, adjacency, hubIds, maxDepth);
    out.push({
      id: 'flow:' + seed,
      name: decl.name,
      description: '',
      seed,
      nodes,
      edges: fedges,
      confidence: 'high',
    });
  }
  return out;
}

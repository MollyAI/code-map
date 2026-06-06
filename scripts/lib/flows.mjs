// scripts/lib/flows.mjs — flow construction (forward call/dependency chains per
// entry point, with high-in-degree hubs as non-expandable leaves). Port of flows.py.
import { qualifiedName } from './extractors/base.mjs';

/** 把 supertype / ref 字符串归一化为短名，镜像 core.resolve 的规则：
 *  先剥泛型 <...> 与调用括号 (...)，再取 . :: / 的末段。 */
export function shortName(raw) {
  const base = String(raw || '').split('<')[0].split('(')[0];
  return base.split('.').pop().split('::').pop().split('/').pop();
}

/** Map<短名, 实现声明[]>：仅保留 >=2 个实现的接口/抽象类型，桶内按
 *  (_importance desc, qualified_name asc) 排序。从声明的 supertypes 字符串
 *  构建，而非图的 extends 边——后者在目标节点未被抽取时已被 core.resolve
 *  丢弃（okhttp 的 fun interface Interceptor 即如此）。语言无关。 */
export function buildDispatchIndex(declarations) {
  const byShort = new Map();
  for (const d of declarations) {
    for (const s of d.supertypes || []) {
      const k = shortName(s);
      if (!k) continue;
      if (!byShort.has(k)) byShort.set(k, []);
      byShort.get(k).push(d);
    }
  }
  const index = new Map();
  for (const [k, impls] of byShort) {
    if (impls.length < 2) continue;
    impls.sort((a, b) => {
      const ia = a._importance || 0, ib = b._importance || 0;
      if (ib !== ia) return ib - ia;
      const qa = qualifiedName(a), qb = qualifiedName(b);
      return qa < qb ? -1 : qa > qb ? 1 : 0;
    });
    index.set(k, impls);
  }
  return index;
}

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

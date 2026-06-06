// scripts/lib/flows.mjs — flow construction (forward call/dependency chains per
// entry point, with high-in-degree hubs as non-expandable leaves). Port of flows.py.
import { qualifiedName } from './extractors/base.mjs';
import { isEntryPoint } from './core.mjs';

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

/** Forward BFS from `seed` over uses-adjacency, plus dispatch expansion.
 *  At a node U, after following resolved uses-edges, scan U's raw ref strings
 *  (ctx.refsByQname); any ref whose short-name is a dispatch-index key (an
 *  interface/abstract type with >=2 implementors) fans out to its implementors
 *  as `dispatch` edges, capped at ctx.maxFanout (overflow recorded in omitted).
 *  A hub is a leaf (unless it is the seed). visited-set prevents revisits/cycles.
 *  Returns [orderedIds, edges, omitted]. Pass ctx=null to disable dispatch. */
export function traceFlow(seed, adjacency, hubIds, maxDepth = 6, ctx = null, maxNodes = Infinity) {
  const visited = new Set([seed]);
  const order = [seed];
  const flowEdges = [];
  const omitted = [];
  const depth = new Map([[seed, 0]]);
  const q = [seed];
  let head = 0;
  while (head < q.length) {
    if (order.length >= maxNodes) break;
    const u = q[head++];
    if (u !== seed && hubIds.has(u)) continue; // hub: leaf
    if (depth.get(u) >= maxDepth) continue;
    // 1. resolved uses-edges
    for (const v of adjacency.get(u) || []) {
      if (order.length >= maxNodes) break;
      if (visited.has(v)) continue;
      visited.add(v);
      depth.set(v, depth.get(u) + 1);
      order.push(v);
      flowEdges.push({ from: u, to: v, kind: 'uses' });
      q.push(v);
    }
    // 2. dispatch expansion via unresolved interface refs
    if (ctx && ctx.dispatchIndex) {
      const seenVia = new Set();
      for (const raw of ctx.refsByQname.get(u) || []) {
        const k = shortName(raw);
        if (!k || seenVia.has(k)) continue;
        const impls = ctx.dispatchIndex.get(k);
        if (!impls) continue;
        seenVia.add(k);
        const fresh = impls.filter((d) => !visited.has(qualifiedName(d)));
        const cap = ctx.maxFanout || 8;
        const take = fresh.slice(0, cap);
        for (const d of take) {
          if (order.length >= maxNodes) break;
          const v = qualifiedName(d);
          visited.add(v);
          depth.set(v, depth.get(u) + 1);
          order.push(v);
          flowEdges.push({ from: u, to: v, kind: 'dispatch', via: k });
          q.push(v);
        }
        if (fresh.length > take.length) {
          omitted.push({ from: u, via: k, count: fresh.length - take.length });
        }
      }
    }
  }
  return [order, flowEdges, omitted];
}

/** Candidate flows: one per seed, traced with dispatch expansion when opts
 *  carries a dispatchIndex. opts = { dispatchIndex, maxFanout, seedKind }.
 *  seedKind: Map<seed, 'entry-point'|'public-orchestrator'>; a public-orchestrator
 *  seed is marked confidence:'candidate' (Phase 2 curates), entry-point stays 'high'. */
export function buildFlows(seeds, declarations, edges, hubIds, maxDepth = 6, opts = {}) {
  const adjacency = new Map();
  for (const e of edges) {
    if (e.kind === 'uses') {
      if (!adjacency.has(e.from)) adjacency.set(e.from, []);
      adjacency.get(e.from).push(e.to);
    }
  }
  const byQname = new Map(declarations.map((d) => [qualifiedName(d), d]));
  const dispatchIndex = opts.dispatchIndex || null;
  const ctx = dispatchIndex
    ? {
        dispatchIndex,
        maxFanout: opts.maxFanout || 8,
        refsByQname: new Map(declarations.map((d) => [qualifiedName(d), d.refs || []])),
      }
    : null;
  const seedKind = opts.seedKind || new Map();
  const out = [];
  const seenSeeds = new Set();
  for (const seed of seeds) {
    if (seenSeeds.has(seed)) continue;
    seenSeeds.add(seed);
    const decl = byQname.get(seed);
    if (decl == null) continue;
    const [nodes, fedges, omitted] = traceFlow(seed, adjacency, hubIds, maxDepth, ctx, opts.maxNodes ?? Infinity);
    const kind = seedKind.get(seed) || 'entry-point';
    const flow = {
      id: 'flow:' + seed,
      name: decl.name,
      description: '',
      seed,
      seed_kind: kind,
      nodes,
      edges: fedges,
      confidence: kind === 'public-orchestrator' ? 'candidate' : 'high',
    };
    if (omitted.length) flow.dispatch_omitted = omitted;
    out.push(flow);
  }
  return out;
}

/** 候选 flow 种子 = 入口点 ∪ Top-maxSeeds 公共编排者。
 *  公共编排者池 = visibility != private && _out_degree >= 2 && !_hub，
 *  按 (_out_degree desc, _importance desc, qname asc) 排序取前 maxSeeds。
 *  接口（out_degree 0）天然不入选；库的引擎类（Kotlin internal 被标 public）入选。
 *  返回 { seeds:string[], seedKind:Map<seed,'entry-point'|'public-orchestrator'> }。 */
export function selectFlowSeeds(declarations, { maxSeeds = 12 } = {}) {
  const seedKind = new Map();
  const seeds = [];
  for (const d of declarations) {
    if (isEntryPoint(d)) {
      const q = qualifiedName(d);
      if (!seedKind.has(q)) { seeds.push(q); seedKind.set(q, 'entry-point'); }
    }
  }
  const pool = declarations.filter((d) =>
    (d.visibility ?? 'public') !== 'private' &&
    (d._out_degree || 0) >= 2 &&
    !d._hub);
  pool.sort((a, b) => {
    const oa = a._out_degree || 0, ob = b._out_degree || 0;
    if (ob !== oa) return ob - oa;
    const ia = a._importance || 0, ib = b._importance || 0;
    if (ib !== ia) return ib - ia;
    const qa = qualifiedName(a), qb = qualifiedName(b);
    return qa < qb ? -1 : qa > qb ? 1 : 0;
  });
  let taken = 0;
  for (const d of pool) {
    if (taken >= maxSeeds) break;
    const q = qualifiedName(d);
    if (seedKind.has(q)) continue; // already an entry-point seed
    seeds.push(q);
    seedKind.set(q, 'public-orchestrator');
    taken++;
  }
  return { seeds, seedKind };
}

/** 丢掉 node 集是另一条 flow 子集的候选（留更大的）；node 集相等时留靠前的。
 *  确定性：按数组给定顺序裁决。 */
export function suppressSubsets(flows) {
  const sets = flows.map((f) => new Set(f.nodes));
  const drop = new Set();
  for (let i = 0; i < flows.length; i++) {
    for (let j = 0; j < flows.length; j++) {
      if (i === j || drop.has(i) || drop.has(j)) continue;
      if (sets[i].size > sets[j].size) continue;
      let subset = true;
      for (const n of sets[i]) if (!sets[j].has(n)) { subset = false; break; }
      if (!subset) continue;
      if (sets[i].size < sets[j].size || (sets[i].size === sets[j].size && j < i)) { drop.add(i); break; }
    }
  }
  return flows.filter((_, i) => !drop.has(i));
}

function betterRoot(d, root) {
  const od = d._out_degree || 0, or = root._out_degree || 0;
  if (od !== or) return od > or;
  const id = d._importance || 0, ir = root._importance || 0;
  if (id !== ir) return id > ir;
  return qualifiedName(d) < qualifiedName(root);
}

/** Focused, deterministic "dispatch flows" — one per significant polymorphic
 *  dispatch interface (chain-of-responsibility / strategy / observer / middleware).
 *  Rooted at the interface's canonical dispatcher (a node that references the
 *  interface, is NOT itself an implementor, and has the highest out-degree —
 *  okhttp's Interceptor → RealCall, which defines the whole chain), fanning out
 *  depth-2 to all its implementors (capped) plus each implementor's direct
 *  non-hub collaborators (<=maxCollabPerImpl). This is the shape forward-BFS
 *  cannot produce in a densely-connected library where every seed reaches the
 *  same blob. Ranked by (impl count desc, root out-degree desc, key asc), capped
 *  at maxFlows. opts = { maxFanout=8, minImpls=2, maxFlows=10, maxCollabPerImpl=3 }. */
export function buildDispatchFlows(declarations, dispatchIndex, edges, hubIds, opts = {}) {
  const maxFanout = opts.maxFanout ?? 8;
  const minImpls = opts.minImpls ?? 2;
  const maxFlows = opts.maxFlows ?? 10;
  const maxCollab = opts.maxCollabPerImpl ?? 3;

  const byQname = new Map(declarations.map((d) => [qualifiedName(d), d]));
  const adj = new Map();
  for (const e of edges) {
    if (e.kind === 'uses') {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from).push(e.to);
    }
  }
  const implQ = new Map();
  for (const [k, impls] of dispatchIndex) implQ.set(k, new Set(impls.map((d) => qualifiedName(d))));
  const refsBy = new Map(declarations.map((d) => [qualifiedName(d), d.refs || []]));

  const candidates = [];
  for (const [k, impls] of dispatchIndex) {
    if (impls.length < minImpls) continue;
    let root = null;
    for (const d of declarations) {
      const q = qualifiedName(d);
      if (implQ.get(k).has(q)) continue;                 // an implementor can't be the dispatcher
      if (!(refsBy.get(q) || []).some((r) => shortName(r) === k)) continue;
      if (root == null || betterRoot(d, root)) root = d;
    }
    if (root == null) continue;
    candidates.push({ k, impls, root });
  }
  candidates.sort((a, b) => {
    if (b.impls.length !== a.impls.length) return b.impls.length - a.impls.length;
    const oa = a.root._out_degree || 0, ob = b.root._out_degree || 0;
    if (ob !== oa) return ob - oa;
    return a.k < b.k ? -1 : a.k > b.k ? 1 : 0;
  });

  const collabSort = (a, b) => {
    const ia = a._importance || 0, ib = b._importance || 0;
    if (ib !== ia) return ib - ia;
    const qa = qualifiedName(a), qb = qualifiedName(b);
    return qa < qb ? -1 : qa > qb ? 1 : 0;
  };

  const out = [];
  for (const { k, impls, root } of candidates.slice(0, maxFlows)) {
    const rootQ = qualifiedName(root);
    const nodes = [rootQ];
    const fedges = [];
    const seen = new Set([rootQ]);
    const take = impls.slice(0, maxFanout);
    for (const impl of take) {
      const iq = qualifiedName(impl);
      if (!seen.has(iq)) { seen.add(iq); nodes.push(iq); }
      fedges.push({ from: rootQ, to: iq, kind: 'dispatch', via: k });
      const collabs = (adj.get(iq) || [])
        .filter((c) => byQname.has(c) && !hubIds.has(c) && c !== rootQ)
        .map((c) => byQname.get(c))
        .sort(collabSort)
        .slice(0, maxCollab)
        .map((d) => qualifiedName(d));
      for (const c of collabs) {
        if (!seen.has(c)) { seen.add(c); nodes.push(c); }
        fedges.push({ from: iq, to: c, kind: 'uses' });
      }
    }
    const flow = {
      id: 'flow:dispatch:' + k,
      name: k,
      description: '',
      seed: rootQ,
      seed_kind: 'dispatch-site',
      via: k,
      nodes,
      edges: fedges,
      confidence: 'candidate',
    };
    if (impls.length > take.length) flow.dispatch_omitted = [{ from: rootQ, via: k, count: impls.length - take.length }];
    out.push(flow);
  }
  return out;
}

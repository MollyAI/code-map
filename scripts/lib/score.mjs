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

const FN_KINDS = new Set(['function', 'method']);

const pen = (id, points, value, detail) =>
  ({ id, points: round3(points, 1), value: round3(value, 3), detail });
const pct = (x) => `${Math.round(x * 100)}%`;

function dim(penalties) {
  const total = penalties.reduce((s, p) => s + p.points, 0);
  return { score: Math.max(0, round3(100 - total, 0)), penalties };
}

function declsOf(model) {
  return (model.layers || []).flatMap((l) => l.classes || []);
}

function adjacencyOf(model) {
  const ids = declsOf(model).map((d) => d.id);
  const idSet = new Set(ids);
  const adj = new Map(ids.map((id) => [id, []]));
  for (const e of model.edges || []) {
    if (idSet.has(e.from) && idSet.has(e.to) && e.from !== e.to) adj.get(e.from).push(e.to);
  }
  return { ids, adj };
}

/** L — layering sanity (0-100): uncategorized share, layer balance, empty
 *  layers, upward cross-layer `uses` edges (layers[] order is the template's
 *  authored top→bottom; `extends` edges are exempt — DIP makes upward
 *  inheritance normal). */
export function scoreLayering(model) {
  const layers = model.layers || [];
  const n = declsOf(model).length;
  const penalties = [];
  if (n) {
    const uncat = layers.find((l) => l.id === 'uncategorized');
    const u = uncat ? (uncat.classes || []).length / n : 0;
    if (u > 0) penalties.push(pen('uncategorized', Math.min(40, u * 150), u,
      `${pct(u)} of declarations uncategorized`));

    const largest = Math.max(0, ...layers.map((l) => (l.classes || []).length)) / n;
    if (largest > 0.5) penalties.push(pen('monolayer', Math.min(30, (largest - 0.5) * 100), largest,
      `largest layer holds ${pct(largest)} of declarations`));

    const empty = layers.filter((l) => !(l.classes || []).length).length;
    if (empty > 0) penalties.push(pen('empty_layers', Math.min(15, empty * 5), empty,
      `${empty} empty layer(s)`));

    const orderOf = new Map();
    layers.forEach((l, i) => {
      const ord = typeof l.order === 'number' ? l.order : i;
      for (const c of l.classes || []) orderOf.set(c.id, ord);
    });
    let cross = 0, up = 0;
    for (const e of model.edges || []) {
      if (e.kind !== 'uses') continue;
      const a = orderOf.get(e.from), b = orderOf.get(e.to);
      if (a == null || b == null || a === b) continue;
      cross++;
      if (b < a) up++;
    }
    if (cross >= 10 && up > 0) {
      const v = up / cross;
      penalties.push(pen('layer_violations', Math.min(30, v * 60), v,
        `${up}/${cross} cross-layer uses edges point upward`));
    }
  }
  return dim(penalties);
}

/** Dq — dependency clarity (0-100): cycle membership (Tarjan, ADP), reach
 *  density (≥50 decls — small graphs are naturally dense), degree
 *  concentration (≥20 edges), TS/JS import-resolution coverage when present. */
export function scoreDependencies(model) {
  const { ids, adj } = adjacencyOf(model);
  const n = ids.length;
  const nEdge = (model.edges || []).length;
  const penalties = [];
  if (n) {
    const inCycle = tarjanSCC(ids, adj)
      .filter((c) => c.length >= 2)
      .reduce((s, c) => s + c.length, 0);
    if (inCycle > 0) {
      const c = inCycle / n;
      penalties.push(pen('cycles', Math.min(40, c * 120), c,
        `${inCycle}/${n} declarations sit in dependency cycles`));
    }
    if (n >= 50) {
      const p = reachDensity(ids, adj);
      if (p > 0.2) penalties.push(pen('propagation', Math.min(20, (p - 0.2) * 80), p,
        `transitive reach density ${round3(p, 3)}`));
    }
    if (nEdge >= 20) {
      const deg = new Map();
      for (const e of model.edges) {
        deg.set(e.from, (deg.get(e.from) || 0) + 1);
        deg.set(e.to, (deg.get(e.to) || 0) + 1);
      }
      let maxId = '', maxDeg = 0;
      for (const [id, d] of deg) if (d > maxDeg || (d === maxDeg && id < maxId)) { maxDeg = d; maxId = id; }
      const g = maxDeg / (2 * nEdge);
      if (g > 0.15) penalties.push(pen('god_node', Math.min(15, (g - 0.15) * 100), g,
        `${maxId} touches ${pct(g)} of all edge endpoints`));
    }
    const cov = model.project?.resolution?.coverage;
    if (typeof cov === 'number' && cov < 1) {
      penalties.push(pen('resolution', Math.min(15, (1 - cov) * 30), cov,
        `import resolution coverage ${pct(cov)}`));
    }
  }
  return dim(penalties);
}

/** H — repo hygiene (0-100): parse failures, vendored-flooding advisories,
 *  isolated (zero-degree) declarations, oversized units (SIG unit-size:
 *  functions >300 loc, types >800 loc). */
export function scoreHygiene(model) {
  const project = model.project || {};
  const decls = declsOf(model);
  const n = decls.length;
  const penalties = [];
  const files = project.files_scanned || 0;
  const pfRaw = project.parse_failures;
  const pf = Array.isArray(pfRaw) ? pfRaw.length : (typeof pfRaw === 'number' ? pfRaw : 0);
  if (files > 0 && pf > 0) {
    const r = pf / files;
    penalties.push(pen('parse_failures', Math.min(25, r * 200), r,
      `${pf}/${files} files failed to parse`));
  }
  const adv = (project.advisories || []).length;
  if (adv > 0) penalties.push(pen('vendored', Math.min(16, adv * 8), adv,
    `${adv} vendored-flooding advisor${adv === 1 ? 'y' : 'ies'}`));
  if (n) {
    const iso = decls.filter((d) => !(d.in_degree > 0) && !(d.out_degree > 0)).length / n;
    if (iso > 0) penalties.push(pen('isolated', Math.min(20, iso * 80), iso,
      `${pct(iso)} of declarations have no edges`));
    const over = decls.filter((d) =>
      (d.loc || 0) > (FN_KINDS.has(d.kind) ? 300 : 800)).length / n;
    if (over > 0) penalties.push(pen('oversized', Math.min(15, over * 60), over,
      `${pct(over)} of declarations are oversized units`));
  }
  return dim(penalties);
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

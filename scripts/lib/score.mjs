// scripts/lib/score.mjs — arch-score rubric v2: deterministic architecture
// scoring over a code-map.json model. Pure logic — no I/O, no timestamps,
// no randomness: the same model always yields the byte-identical score
// object (eval golden snapshots depend on this).
//
// Rubric of record: skills/arch-score/SKILL.md
// total = round(D × E) + AI adjustment (bounded ±10% of base, CLI-enforced).
// v2 (2026-06): kind-weighted granularity (extractors emit type-level decls
// for JVM languages but function-level for Python/TS/C — raw counts are not
// comparable across languages), largest-SCC cycle weighting, api-layer
// exemption, opacity penalty for dynamic-language-dominated graphs.
import { round3 } from './core.mjs';

export const RUBRIC = 'arch-score-v2';

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

const FN_KINDS = new Set(['function', 'method', 'composable_function']);
const ALIAS_KINDS = new Set(['type_alias', 'typedef']);
const DYNAMIC_LANGS = new Set(['python', 'javascript', 'lua']);

// Granularity weights: a type is the architectural unit; functions are
// sub-units, aliases are one-liners. Without this, a function-level
// extraction (Python/TS/C) counts ~10× a type-level one (JVM).
const kindWeight = (k) => (FN_KINDS.has(k) ? 1 / 3 : ALIAS_KINDS.has(k) ? 1 / 6 : 1);

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
 *  inheritance normal). Edges into a layer marked `api: true` are exempt:
 *  a library's published API surface is its domain center, and internals
 *  referencing their own API types is the norm, not a violation. */
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

    const orderOf = new Map(), apiOf = new Map();
    layers.forEach((l, i) => {
      const ord = typeof l.order === 'number' ? l.order : i;
      for (const c of l.classes || []) { orderOf.set(c.id, ord); apiOf.set(c.id, l.api === true); }
    });
    let cross = 0, up = 0;
    for (const e of model.edges || []) {
      if (e.kind !== 'uses') continue;
      const a = orderOf.get(e.from), b = orderOf.get(e.to);
      if (a == null || b == null || a === b) continue;
      if (b < a && apiOf.get(e.to)) continue; // api-bound upward edge: exempt entirely
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

/** Dq — dependency clarity (0-100): cycle tangles (Tarjan; the largest SCC
 *  is the MacCormack "architectural core", weighted 90, smaller SCCs 30;
 *  2-node mutual pairs are a single bidirectional relationship — domain
 *  normal, exempt), reach density (≥50 decls — small graphs are naturally
 *  dense), degree concentration (≥20 edges), TS/JS import-resolution
 *  coverage when present, opacity when dynamic languages dominate. */
export function scoreDependencies(model) {
  const { ids, adj } = adjacencyOf(model);
  const n = ids.length;
  const nEdge = (model.edges || []).length;
  const penalties = [];
  if (n) {
    const sccs = tarjanSCC(ids, adj)
      .filter((c) => c.length >= 3)
      .map((c) => c.length)
      .sort((a, b) => b - a);
    const core = sccs[0] || 0;
    const others = sccs.slice(1).reduce((s, x) => s + x, 0);
    if (core > 0) {
      penalties.push(pen('cycles', Math.min(30, (90 * core + 30 * others) / n), (core + others) / n,
        `largest cycle holds ${core}/${n} declarations`
        + (others ? ` (+${others} in smaller cycles)` : '')));
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
    const byLang = model.project?.declarations_by_language || {};
    const langTotal = Object.values(byLang).reduce((s, v) => s + v, 0);
    if (langTotal > 0) {
      const dyn = Object.entries(byLang)
        .filter(([l]) => DYNAMIC_LANGS.has(l))
        .reduce((s, [, v]) => s + v, 0) / langTotal;
      if (dyn > 0.5) {
        penalties.push(pen('opacity', 8 * dyn, dyn,
          `${pct(dyn)} of declarations are in dynamic languages — runtime coupling is invisible to static extraction`));
      }
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
    // kind-weighted: a stray alias or helper fn is noise; a stray class is signal
    const wAll = decls.reduce((s, d) => s + kindWeight(d.kind), 0);
    const wIso = decls.filter((d) => !(d.in_degree > 0) && !(d.out_degree > 0))
      .reduce((s, d) => s + kindWeight(d.kind), 0);
    const iso = wAll > 0 ? wIso / wAll : 0;
    if (iso > 0) penalties.push(pen('isolated', Math.min(20, iso * 80), iso,
      `${pct(iso)} of declaration weight has no edges`));
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

const W_LAYERING = 0.4, W_DEPENDENCIES = 0.4, W_HYGIENE = 0.2;

/**
 * Deterministic baseline score for a code-map.json model.
 * total = round(D × E); no adjustment, no timestamp (byte-stable output).
 *   D (unbounded difficulty) = 10·ln(1+wDecl) + 6·ln(1+wEdge)
 *                            + 4·ln(1+files) + 5·(effLangs−1)
 *     wDecl = Σ kindWeight (type 1, function 1/3, alias 1/6);
 *     wEdge = edges · wDecl/decls (edges scale by the same granularity);
 *     effLangs counts only languages holding ≥10% of declarations.
 *   E (execution, 0.5–1.5)   = 0.5 + (0.4·L + 0.4·Dq + 0.2·H)/100
 */
export function computeScore(model) {
  const project = model.project || {};
  const decls = declsOf(model);
  const nDecl = decls.length;
  const wDecl = decls.reduce((s, d) => s + kindWeight(d.kind), 0);
  const g = nDecl ? wDecl / nDecl : 1;
  const nEdge = (model.edges || []).length;
  const wEdge = nEdge * g;
  const nFile = project.files_scanned || 0;
  const byLang = project.declarations_by_language || {};
  const langTotal = Object.values(byLang).reduce((s, v) => s + v, 0);
  let nLang = Object.values(byLang).filter((v) => v > 0).length;
  let effLang = Object.values(byLang).filter((v) => v > 0 && v / langTotal >= 0.10).length;
  if (!nLang) nLang = (project.languages || []).length || 1;
  if (!effLang) effLang = nLang;

  const D = 10 * Math.log1p(wDecl) + 6 * Math.log1p(wEdge)
          + 4 * Math.log1p(nFile) + 5 * Math.max(0, effLang - 1);
  const layering = scoreLayering(model);
  const dependencies = scoreDependencies(model);
  const hygiene = scoreHygiene(model);
  const E = 0.5 + (W_LAYERING * layering.score + W_DEPENDENCIES * dependencies.score
                 + W_HYGIENE * hygiene.score) / 100;
  const base = round3(D * E, 0);
  return {
    rubric: RUBRIC,
    total: base,
    base,
    difficulty: round3(D, 1),
    execution: round3(E, 3),
    dimensions: { layering, dependencies, hygiene },
    inputs: { decls: nDecl, edges: nEdge, files: nFile, languages: nLang,
      weighted_decls: round3(wDecl, 1), effective_languages: effLang },
  };
}

/**
 * Bounded AI adjustment: |delta| ≤ round(10% of base), both bilingual
 * reasons mandatory. Throws on violation — the CLI surfaces the message,
 * so the bound holds no matter what the caller intended.
 */
export function applyAdjustment(score, delta, reasonZh, reasonEn) {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error('adjustment delta must be a non-zero integer');
  }
  const maxAbs = Math.round(0.10 * score.base);
  if (Math.abs(delta) > maxAbs) {
    throw new Error(`adjustment ${delta} exceeds the bound ±${maxAbs} (10% of base ${score.base})`);
  }
  if (!reasonZh || !reasonEn) {
    throw new Error('adjustment requires both --reason-zh and --reason-en');
  }
  return {
    ...score,
    total: score.base + delta,
    adjustment: { delta, reason_zh: reasonZh, reason_en: reasonEn },
  };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tarjanSCC, reachDensity, scoreLayering, scoreDependencies, scoreHygiene,
  computeScore, applyAdjustment,
} from '../scripts/lib/score.mjs';
import { round3 } from '../scripts/lib/core.mjs';

const decl = (id, extra = {}) => ({
  id, name: id.split('.').pop(), kind: 'class', loc: 50,
  in_degree: 1, out_degree: 1, ...extra,
});

function mkModel({ layers, edges = [], project = {} }) {
  return {
    project: { files_scanned: 10, declarations_by_language: { typescript: 9 }, ...project },
    layers, edges, flows: [],
  };
}

test('tarjanSCC: finds the 3-cycle, leaves the singleton alone', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const adj = new Map([['a', ['b']], ['b', ['c']], ['c', ['a']], ['d', []]]);
  const sccs = tarjanSCC(ids, adj);
  const big = sccs.filter((c) => c.length >= 2);
  assert.equal(big.length, 1);
  assert.deepEqual([...big[0]].sort(), ['a', 'b', 'c']);
});

test('tarjanSCC: acyclic graph has no multi-node SCC', () => {
  const ids = ['a', 'b', 'c'];
  const adj = new Map([['a', ['b', 'c']], ['b', ['c']], ['c', []]]);
  assert.equal(tarjanSCC(ids, adj).filter((c) => c.length >= 2).length, 0);
});

test('reachDensity: chain a→b→c reaches 3 pairs over n²=9', () => {
  const ids = ['a', 'b', 'c'];
  const adj = new Map([['a', ['b']], ['b', ['c']], ['c', []]]);
  // a reaches {b,c}, b reaches {c}, c reaches {} → 3/(3*3)
  assert.equal(reachDensity(ids, adj), 3 / 9);
});

test('reachDensity: empty / single-node graphs are 0', () => {
  assert.equal(reachDensity([], new Map()), 0);
  assert.equal(reachDensity(['a'], new Map([['a', []]])), 0);
});

test('layering: clean balanced two-layer model scores 100', () => {
  const m = mkModel({
    layers: [
      { id: 'app', name: 'App', order: 1, classes: [decl('app.A'), decl('app.B')] },
      { id: 'lib', name: 'Lib', order: 2, classes: [decl('lib.C'), decl('lib.D')] },
    ],
    edges: [
      { from: 'app.A', to: 'lib.C', kind: 'uses' },
      { from: 'app.B', to: 'lib.D', kind: 'uses' },
    ],
  });
  const L = scoreLayering(m);
  assert.equal(L.score, 100);
  assert.deepEqual(L.penalties, []);
});

test('layering: uncategorized-dominated model takes uncategorized + monolayer caps', () => {
  const uncls = Array.from({ length: 8 }, (_, i) => decl(`u.c${i}`));
  const m = mkModel({
    layers: [
      { id: 'app', name: 'App', order: 1, classes: [decl('app.A'), decl('app.B')] },
      { id: 'uncategorized', name: 'Uncategorized', order: 99, classes: uncls },
    ],
  });
  const L = scoreLayering(m);
  assert.equal(L.penalties.find((p) => p.id === 'uncategorized').points, 40); // 0.8·150 → cap 40
  assert.equal(L.penalties.find((p) => p.id === 'monolayer').points, 30);     // (0.8−0.5)·100
  assert.equal(L.score, 30);
});

test('layering: empty layers penalized 5 each (cap 15)', () => {
  const m = mkModel({
    layers: [
      { id: 'a', name: 'A', order: 1, classes: [decl('a.X'), decl('a.Y')] },
      { id: 'b', name: 'B', order: 2, classes: [decl('b.Z'), decl('b.W')] },
      { id: 'c', name: 'C', order: 3, classes: [] },
      { id: 'd', name: 'D', order: 4, classes: [] },
    ],
  });
  assert.equal(scoreLayering(m).penalties.find((p) => p.id === 'empty_layers').points, 10);
});

test('layering: upward uses edges are violations once ≥10 cross-layer edges', () => {
  const top = Array.from({ length: 3 }, (_, i) => decl(`ui.t${i}`));
  const bot = Array.from({ length: 3 }, (_, i) => decl(`db.b${i}`));
  const edges = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    edges.push({ from: `ui.t${i}`, to: `db.b${j}`, kind: 'uses' });   // 9 downward
  }
  for (let i = 0; i < 3; i++) edges.push({ from: `db.b${i}`, to: `ui.t${i}`, kind: 'uses' }); // 3 upward
  const m = mkModel({
    layers: [
      { id: 'ui', name: 'UI', order: 1, classes: top },
      { id: 'db', name: 'DB', order: 2, classes: bot },
    ],
    edges,
  });
  const v = scoreLayering(m).penalties.find((p) => p.id === 'layer_violations');
  assert.equal(v.points, 15); // 3/12 = 0.25 → ·60 = 15
});

test('layering: upward uses edges into an api:true layer are exempt (v2)', () => {
  const apiDecls = [decl('api.A'), decl('api.B')];
  const implDecls = Array.from({ length: 12 }, (_, i) => decl(`impl.i${i}`));
  const edges = [];
  for (let i = 0; i < 11; i++) edges.push({ from: `impl.i${i}`, to: 'api.A', kind: 'uses' }); // upward
  for (let i = 0; i < 5; i++) edges.push({ from: 'api.A', to: `impl.i${i}`, kind: 'uses' });  // downward
  for (let i = 5; i < 10; i++) edges.push({ from: 'api.B', to: `impl.i${i}`, kind: 'uses' }); // downward
  const layersOf = (apiFlag) => [
    { id: 'api', name: 'API', order: 0, classes: apiDecls, ...(apiFlag ? { api: true } : {}) },
    { id: 'impl', name: 'Impl', order: 1, classes: implDecls },
  ];
  // without the flag: 11/21 upward → ·60 = 31.4 → cap 30
  const plain = scoreLayering(mkModel({ layers: layersOf(false), edges }));
  assert.equal(plain.penalties.find((p) => p.id === 'layer_violations').points, 30);
  // with api:true: the 11 api-bound edges leave both numerator and denominator
  const exempt = scoreLayering(mkModel({ layers: layersOf(true), edges }));
  assert.equal(exempt.penalties.find((p) => p.id === 'layer_violations'), undefined);
});

test('layering: test/mock/sample layers are excluded from scoring entirely (v2)', () => {
  const clean = {
    layers: [
      { id: 'app', name: 'App', order: 0, classes: [decl('app.A'), decl('app.B')] },
      { id: 'lib', name: 'Lib', order: 1, classes: [decl('lib.C'), decl('lib.D')] },
    ],
    edges: [
      { from: 'app.A', to: 'lib.C', kind: 'uses' },
      { from: 'app.B', to: 'lib.D', kind: 'uses' },
    ],
  };
  // a polluted map: a testing layer holding most decls, with heavy upward edges
  const testDecls = Array.from({ length: 12 }, (_, i) => decl(`t.x${i}`));
  const polluted = {
    layers: [...clean.layers, { id: 'testing', name: 'Testing', order: 2, classes: testDecls }],
    edges: [...clean.edges, ...testDecls.map((d) => ({ from: d.id, to: 'app.A', kind: 'uses' }))],
  };
  const a = scoreLayering(mkModel(clean));
  const b = scoreLayering(mkModel(polluted));
  assert.equal(a.score, 100);
  assert.deepEqual(b, a); // no monolayer from test mass, no upward violations from test edges
});

test('layering: <10 cross-layer uses edges → violation metric not judged', () => {
  const m = mkModel({
    layers: [
      { id: 'ui', name: 'UI', order: 1, classes: [decl('ui.A'), decl('ui.B')] },
      { id: 'db', name: 'DB', order: 2, classes: [decl('db.C'), decl('db.D')] },
    ],
    edges: [{ from: 'db.C', to: 'ui.A', kind: 'uses' }],
  });
  assert.equal(scoreLayering(m).penalties.find((p) => p.id === 'layer_violations'), undefined);
});

test('dependencies: full cycle hits the 30-point cycles cap (v2)', () => {
  const cls = ['a', 'b', 'c', 'd'].map((x) => decl(`m.${x}`));
  const m = mkModel({
    layers: [{ id: 'm', name: 'M', order: 1, classes: cls }],
    edges: [
      { from: 'm.a', to: 'm.b', kind: 'uses' },
      { from: 'm.b', to: 'm.c', kind: 'uses' },
      { from: 'm.c', to: 'm.d', kind: 'uses' },
      { from: 'm.d', to: 'm.a', kind: 'uses' },
    ],
  });
  const D = scoreDependencies(m);
  assert.equal(D.penalties.find((p) => p.id === 'cycles').points, 30); // core 4/4 → 90·1 cap 30
  assert.equal(D.score, 70); // n=4<50 propagation skipped; 4 edges<20 god skipped
});

test('dependencies: a 2-node mutual pair is not a cycle penalty (v2)', () => {
  const cls = ['a', 'b', 'c', 'd'].map((x) => decl(`m.${x}`));
  const m = mkModel({
    layers: [{ id: 'm', name: 'M', order: 1, classes: cls }],
    edges: [
      { from: 'm.a', to: 'm.b', kind: 'uses' },
      { from: 'm.b', to: 'm.a', kind: 'uses' },
      { from: 'm.c', to: 'm.d', kind: 'uses' },
    ],
  });
  assert.equal(scoreDependencies(m).penalties.find((p) => p.id === 'cycles'), undefined);
});

test('dependencies: cycles weigh the largest SCC 90 and smaller SCCs 30 (v2)', () => {
  const cls = Array.from({ length: 20 }, (_, i) => decl(`m.n${i}`));
  const cyc = (a, b, c) => [
    { from: `m.n${a}`, to: `m.n${b}`, kind: 'uses' },
    { from: `m.n${b}`, to: `m.n${c}`, kind: 'uses' },
    { from: `m.n${c}`, to: `m.n${a}`, kind: 'uses' },
  ];
  const m = mkModel({
    layers: [{ id: 'm', name: 'M', order: 1, classes: cls }],
    edges: [...cyc(0, 1, 2), ...cyc(3, 4, 5)],
  });
  const c = scoreDependencies(m).penalties.find((p) => p.id === 'cycles');
  assert.equal(c.points, 18); // 90·(3/20) + 30·(3/20)
});

test('dependencies: opacity caps a clean dynamic-language graph at 85 (v2)', () => {
  const layers = [{ id: 'm', name: 'M', order: 1,
    classes: Array.from({ length: 10 }, (_, i) => decl(`m.c${i}`)) }];
  const dyn = scoreDependencies(mkModel({ layers,
    project: { declarations_by_language: { python: 8, typescript: 2 } } }));
  // no visible penalties → opacity = max(8·0.8, 100−0−85) = 15 → unverifiable ≠ perfect
  assert.equal(dyn.penalties.find((p) => p.id === 'opacity').points, 15);
  assert.equal(dyn.score, 85);
  const half = scoreDependencies(mkModel({ layers,
    project: { declarations_by_language: { python: 5, typescript: 5 } } }));
  assert.equal(half.penalties.find((p) => p.id === 'opacity'), undefined); // share not > 0.5
});

test('dependencies: opacity falls back to the 8·share floor when problems are visible (v2)', () => {
  const cls = Array.from({ length: 10 }, (_, i) => decl(`m.c${i}`));
  const edges = cls.map((d, i) => ({ from: d.id, to: cls[(i + 1) % 10].id, kind: 'uses' }));
  const m = mkModel({
    layers: [{ id: 'm', name: 'M', order: 1, classes: cls }],
    edges, // one 10-cycle → cycles min(30, 90·1) = 30 already visible
    project: { declarations_by_language: { python: 10 } },
  });
  const D = scoreDependencies(m);
  assert.equal(D.penalties.find((p) => p.id === 'opacity').points, 8); // max(8·1, 100−30−85<0)
  assert.equal(D.score, 62); // 100 − 30 − 8
});

test('dependencies: god node fires only at ≥20 edges, capped at 15', () => {
  const others = Array.from({ length: 20 }, (_, i) => decl(`m.n${i}`));
  const cls = [decl('m.hub'), ...others];
  const edges = others.map((d, i) => (i % 2
    ? { from: 'm.hub', to: d.id, kind: 'uses' }
    : { from: d.id, to: 'm.hub', kind: 'uses' }));
  const m = mkModel({ layers: [{ id: 'm', name: 'M', order: 1, classes: cls }], edges });
  const g = scoreDependencies(m).penalties.find((p) => p.id === 'god_node');
  assert.equal(g.points, 15); // g = 20/(2·20) = 0.5 → (0.5−0.15)·100 = 35 → cap 15
});

test('dependencies: resolution coverage penalty when project.resolution present', () => {
  const m = mkModel({
    layers: [{ id: 'm', name: 'M', order: 1, classes: [decl('m.a')] }],
    project: { resolution: { coverage: 0.8 } },
  });
  const r = scoreDependencies(m).penalties.find((p) => p.id === 'resolution');
  assert.equal(r.points, 6); // (1−0.8)·30
});

test('hygiene: parse failures, advisories, isolated, oversized all itemized', () => {
  const ds = [
    decl('m.a', { in_degree: 0, out_degree: 0 }),
    decl('m.b', { kind: 'function', loc: 400 }),
    decl('m.c'), decl('m.d'),
  ];
  const m = mkModel({
    layers: [{ id: 'm', name: 'M', order: 1, classes: ds }],
    project: { files_scanned: 10, parse_failures: 1, advisories: [{ dir: 'x' }] },
  });
  const H = scoreHygiene(m);
  assert.deepEqual(H.penalties.map((p) => p.id).sort(),
    ['isolated', 'oversized', 'parse_failures', 'vendored']);
  assert.equal(H.score, 37); // 100 − 20(pf) − 8(vendored) − 20(isolated cap) − 15(oversized cap)
});

test('hygiene: clean model scores 100', () => {
  const m = mkModel({ layers: [{ id: 'm', name: 'M', order: 1, classes: [decl('m.a'), decl('m.b')] }] });
  assert.equal(scoreHygiene(m).score, 100);
});

test('hygiene: isolated share is kind-weighted — a stray alias is noise, not signal (v2)', () => {
  const m = mkModel({
    layers: [{ id: 'm', name: 'M', order: 1, classes: [
      decl('m.a'),
      decl('m.t', { kind: 'type_alias', in_degree: 0, out_degree: 0 }),
    ] }],
  });
  const iso = scoreHygiene(m).penalties.find((p) => p.id === 'isolated');
  assert.equal(iso.points, 11.4); // (1/6)/(1+1/6) ≈ 0.143 → ·80
  assert.equal(iso.value, 0.143);
});

test('computeScore: D×E assembly, schema shape, no timestamp', () => {
  const m = mkModel({
    layers: [
      { id: 'app', name: 'App', order: 1, classes: [decl('app.A'), decl('app.B')] },
      { id: 'lib', name: 'Lib', order: 2, classes: [decl('lib.C'), decl('lib.D')] },
    ],
    edges: [
      { from: 'app.A', to: 'lib.C', kind: 'uses' },
      { from: 'app.B', to: 'lib.D', kind: 'uses' },
    ],
  });
  const s = computeScore(m);
  assert.equal(s.rubric, 'arch-score-v2');
  assert.equal(s.execution, 1.5); // all dims 100
  // all-class model: wDecl = decls → D = 10·ln5 + 6·ln3 + 4·ln11 ≈ 32.278
  assert.equal(s.difficulty, 32.3);
  assert.equal(s.difficulty_raw, 32.3); // below the 90 gate: raw == capped
  assert.equal(s.base, 48);
  assert.equal(s.total, s.base);
  assert.deepEqual(s.inputs, { decls: 4, edges: 2, files: 10, languages: 1,
    weighted_decls: 4, effective_languages: 1 });
  assert.equal(s.adjustment, undefined);
  assert.ok(!('computed_at' in s));
});

test('computeScore: D weighs functions 1/3 and aliases 1/6 of a type (v2)', () => {
  const mk = (kind, n) => computeScore(mkModel({
    layers: [{ id: 'm', name: 'M', order: 1,
      classes: Array.from({ length: n }, (_, i) => decl(`m.x${i}`, { kind })) }],
  }));
  // 3 functions → wDecl 1 → D = 10·ln2 + 4·ln11 ≈ 16.52
  assert.equal(mk('function', 3).difficulty, 16.5);
  // 3 classes → wDecl 3 → D = 10·ln4 + 4·ln11 ≈ 23.45
  assert.equal(mk('class', 3).difficulty, 23.5);
  // 6 aliases → wDecl 1 → same D as 3 functions
  assert.equal(mk('type_alias', 6).difficulty, 16.5);
});

test('computeScore: edges scale by the same granularity factor (v2)', () => {
  const cls = [decl('m.a'), decl('m.b'),
    ...Array.from({ length: 4 }, (_, i) => decl(`m.f${i}`, { kind: 'function' }))];
  const m = mkModel({
    layers: [{ id: 'm', name: 'M', order: 1, classes: cls }],
    edges: [
      { from: 'm.a', to: 'm.f0', kind: 'uses' },
      { from: 'm.b', to: 'm.f1', kind: 'uses' },
      { from: 'm.f2', to: 'm.f3', kind: 'uses' },
    ],
  });
  const s = computeScore(m);
  // wDecl = 2 + 4/3 ≈ 3.333, g ≈ 0.556, wEdge = 3g ≈ 1.667
  // D = 10·ln(4.333) + 6·ln(2.667) + 4·ln11 ≈ 30.14
  assert.equal(s.difficulty, 30.1);
  assert.equal(s.inputs.weighted_decls, 3.3);
});

test('computeScore: extra language adds 5 points to D', () => {
  const layers = [{ id: 'm', name: 'M', order: 1, classes: [decl('m.a')] }];
  const one = computeScore(mkModel({ layers }));
  const two = computeScore(mkModel({ layers,
    project: { declarations_by_language: { typescript: 1, go: 1 } } }));
  assert.equal(round3(two.difficulty - one.difficulty, 1), 5);
});

test('computeScore: difficulty is a gate, capped at 90 (v2)', () => {
  const cls = Array.from({ length: 2000 }, (_, i) => decl(`m.c${i}`));
  const edges = Array.from({ length: 3000 }, (_, i) => ({
    from: `m.c${i % 2000}`, to: `m.c${(i + 1) % 2000}`, kind: 'uses' }));
  const s = computeScore(mkModel({ layers: [{ id: 'm', name: 'M', order: 1, classes: cls }], edges }));
  assert.equal(s.difficulty, 90); // scale beyond the gate buys nothing
  assert.ok(s.difficulty_raw > 90);
  assert.equal(s.base, round3(90 * s.execution, 0));
});

test('computeScore: test layers and their edges leave decl/edge inputs (v2)', () => {
  const base = {
    layers: [{ id: 'app', name: 'App', order: 0, classes: [decl('app.A'), decl('app.B')] }],
    edges: [{ from: 'app.A', to: 'app.B', kind: 'uses' }],
  };
  const polluted = {
    layers: [...base.layers,
      { id: 'examples', name: 'Examples', order: 1, classes: [decl('ex.E1'), decl('ex.E2')] }],
    edges: [...base.edges, { from: 'ex.E1', to: 'app.A', kind: 'uses' }],
  };
  const s = computeScore(mkModel(polluted));
  assert.equal(s.inputs.decls, 2);
  assert.equal(s.inputs.edges, 1);
  assert.equal(s.total, computeScore(mkModel(base)).total);
});

test('computeScore: a language under 10% of declarations earns no bonus (v2)', () => {
  const layers = [{ id: 'm', name: 'M', order: 1,
    classes: Array.from({ length: 4 }, (_, i) => decl(`m.c${i}`)) }];
  const pure = computeScore(mkModel({ layers,
    project: { declarations_by_language: { typescript: 20 } } }));
  const trace = computeScore(mkModel({ layers,
    project: { declarations_by_language: { typescript: 19, go: 1 } } }));
  assert.equal(trace.difficulty, pure.difficulty); // go at 5% is not a second architecture
  assert.equal(trace.inputs.languages, 2);
  assert.equal(trace.inputs.effective_languages, 1);
});

test('computeScore: deterministic and safe on degenerate inputs', () => {
  const m = mkModel({ layers: [{ id: 'm', name: 'M', order: 1, classes: [] }] });
  assert.deepEqual(computeScore(m), computeScore(m));
  const empty = computeScore({ project: {}, layers: [], edges: [] });
  assert.equal(typeof empty.total, 'number');
  assert.equal(empty.inputs.decls, 0);
});

test('applyAdjustment: enforces the ±10% bound and bilingual reasons', () => {
  const s = { rubric: 'arch-score-v1', base: 118, total: 118 };
  const ok = applyAdjustment(s, 12, '理由', 'reason'); // max = round(11.8) = 12
  assert.equal(ok.total, 130);
  assert.deepEqual(ok.adjustment, { delta: 12, reason_zh: '理由', reason_en: 'reason' });
  assert.equal(ok.base, 118);
  assert.throws(() => applyAdjustment(s, 13, '理由', 'reason'), /±12/);
  assert.throws(() => applyAdjustment(s, -13, '理由', 'reason'), /±12/);
  assert.throws(() => applyAdjustment(s, 5, '', 'reason'), /reason/);
  assert.throws(() => applyAdjustment(s, 5, '理由', ''), /reason/);
  assert.throws(() => applyAdjustment(s, 2.5, '理由', 'reason'), /integer/);
  assert.throws(() => applyAdjustment(s, 0, '理由', 'reason'), /integer/);
});

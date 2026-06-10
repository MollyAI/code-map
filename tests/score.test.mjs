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

test('dependencies: full cycle hits the 40-point cycles cap', () => {
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
  assert.equal(D.penalties.find((p) => p.id === 'cycles').points, 40); // c=1 → ·120 cap 40
  assert.equal(D.score, 60); // n=4<50 propagation skipped; 4 edges<20 god skipped
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
  assert.equal(s.rubric, 'arch-score-v1');
  assert.equal(s.execution, 1.5); // all dims 100
  // D = 10·ln5 + 6·ln3 + 4·ln11 ≈ 32.278; base = round(D·1.5) = 48
  assert.equal(s.difficulty, 32.3);
  assert.equal(s.base, 48);
  assert.equal(s.total, s.base);
  assert.deepEqual(s.inputs, { decls: 4, edges: 2, files: 10, languages: 1 });
  assert.equal(s.adjustment, undefined);
  assert.ok(!('computed_at' in s));
});

test('computeScore: extra language adds 5 points to D', () => {
  const layers = [{ id: 'm', name: 'M', order: 1, classes: [decl('m.a')] }];
  const one = computeScore(mkModel({ layers }));
  const two = computeScore(mkModel({ layers,
    project: { declarations_by_language: { typescript: 1, go: 1 } } }));
  assert.equal(round3(two.difficulty - one.difficulty, 1), 5);
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

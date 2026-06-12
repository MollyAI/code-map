import { test } from 'node:test';
import assert from 'node:assert/strict';
import { round3, isEntryPoint, buildGraph, markCore } from '../scripts/lib/core.mjs';
import { Declaration } from '../scripts/lib/extractors/base.mjs';

test('round3 matches Python round(x,3) banker rounding', () => {
  assert.equal(round3(0.0005), 0.0);   // half → even (0)
  assert.equal(round3(0.0015), 0.002); // half → even (2)
  assert.equal(round3(0.2324), 0.232);
  assert.equal(round3(0.2326), 0.233);
});

test('isEntryPoint recognizes name/suffix/path hints', () => {
  assert.ok(isEntryPoint({ name: 'MainActivity', path: 'a.kt' }));
  assert.ok(isEntryPoint({ name: 'OrderApplication', path: 'a.kt' }));
  assert.ok(isEntryPoint({ name: 'whatever', path: 'src/cmd/x.go' }));
  assert.ok(!isEntryPoint({ name: 'Helper', path: 'a.kt' }));
});

test('buildGraph: edges, degrees, importance blend, entry-point tag', () => {
  const decls = [
    Declaration({ name: 'A', namespace: 'm', kind: 'class', path: 'm.py', line: 1, refs: ['B'] }),
    Declaration({ name: 'B', namespace: 'm', kind: 'function', path: 'm.py', line: 5 }),
  ];
  const [out, edges] = buildGraph(decls);
  assert.deepEqual(edges, [{ from: 'm.A', to: 'm.B', kind: 'uses' }]);
  const A = out.find((d) => d.name === 'A'), B = out.find((d) => d.name === 'B');
  assert.equal(A._out_degree, 1); assert.equal(B._in_degree, 1);
  assert.ok(B._importance > 0 && A._importance > 0);
});

test('markCore tie-break is deterministic by qualified_name', () => {
  // two equal-importance decls in one layer at the k boundary
  const mk = (n) => { const d = Declaration({ name: n, namespace: 'm', kind: 'function', path: 'm.py', line: 1 }); d._layer = 'x'; d._importance = 0.5; return d; };
  const a = mk('aaa'), b = mk('bbb'), c = mk('ccc'), z = mk('zzz');
  // percentile 0.25 of 4 → k=1 (minPerLayer=1 disables the lonely-layer floor);
  // lowest qualified_name (m.aaa) wins
  markCore([z, c, b, a], 0.25, 40, 1);
  assert.equal(a._core, true);
  assert.equal(b._core, false);
  assert.equal(z._core, false);
});

test('markCore lonely-layer floor pads up to minPerLayer, importance>0 only', () => {
  const mk = (n, imp) => { const d = Declaration({ name: n, namespace: 'm', kind: 'function', path: 'm.py', line: 1 }); d._layer = 'x'; d._importance = imp; return d; };
  // percentile 0.1 of 6 → k=1, floor pads to 4 — but the zero-importance decl
  // stays non-core even inside the floor.
  const decls = [mk('a', 0.9), mk('b', 0.8), mk('c', 0.7), mk('d', 0.6), mk('e', 0.5), mk('f', 0)];
  markCore(decls, 0.1, 40, 4);
  assert.deepEqual(decls.map((d) => !!d._core), [true, true, true, true, false, false]);
  // floor never exceeds the layer size, and an all-zero layer stays non-core
  const zeros = [mk('p', 0), mk('q', 0)];
  markCore(zeros, 0.5, 40, 4);
  assert.deepEqual(zeros.map((d) => !!d._core), [false, false]);
});

test('buildGraph: private decls are downweighted by PRIVATE_PENALTY (R2)', () => {
  const pub = [
    Declaration({ name: 'Pub', namespace: 'm', kind: 'function', path: 'm.py', line: 1, refs: ['Sink'] }),
    Declaration({ name: 'Sink', namespace: 'm', kind: 'function', path: 'm.py', line: 5 }),
  ];
  const priv = [
    Declaration({ name: 'Pub', namespace: 'm', kind: 'function', path: 'm.py', line: 1, refs: ['Sink'], visibility: 'private' }),
    Declaration({ name: 'Sink', namespace: 'm', kind: 'function', path: 'm.py', line: 5 }),
  ];
  buildGraph(pub);
  buildGraph(priv);
  const pubImp = pub.find((d) => d.name === 'Pub')._importance;
  const privImp = priv.find((d) => d.name === 'Pub')._importance;
  assert.ok(pubImp > 0, 'public decl should have nonzero importance');
  assert.ok(privImp < pubImp, `private (${privImp}) should be below public (${pubImp})`);
  assert.ok(Math.abs(privImp - pubImp * 0.3) < 0.001, `private should be ~0.3× public: ${privImp} vs ${pubImp}*0.3`);
});

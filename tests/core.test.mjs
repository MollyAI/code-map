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
  // percentile 0.25 of 4 → k=1; lowest qualified_name (m.aaa) wins
  markCore([z, c, b, a], 0.25, 40);
  assert.equal(a._core, true);
  assert.equal(b._core, false);
  assert.equal(z._core, false);
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
});

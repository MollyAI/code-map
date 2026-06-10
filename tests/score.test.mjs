import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tarjanSCC, reachDensity } from '../scripts/lib/score.mjs';

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

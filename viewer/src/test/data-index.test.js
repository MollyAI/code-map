import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEdgeIndex, buildClassIndex } from '../data/index.js';

test('buildEdgeIndex 建 from/to 邻接', () => {
  const { edgesFromIdx, edgesToIdx } = buildEdgeIndex([{ from: 'A', to: 'B', kind: 'uses' }]);
  assert.equal(edgesFromIdx.get('A')[0].to, 'B');
  assert.equal(edgesToIdx.get('B')[0].from, 'A');
});
test('buildClassIndex 收集 hubIds', () => {
  const { classById, hubIds } = buildClassIndex([
    { classes: [{ id: 'A', name: 'A', hub: true }, { id: 'B', name: 'B' }] },
  ]);
  assert.ok(classById.has('A') && hubIds.has('A') && !hubIds.has('B'));
});

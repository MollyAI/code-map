import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEdgeIndex, buildClassIndex, buildFlowIndex } from '../data/index.js';

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
test('buildFlowIndex: 只保留带合法 diagram 的流程，无图流程被剔除', () => {
  const classById = new Map([['A', { id: 'A', name: 'A' }], ['B', { id: 'B', name: 'B' }]]);
  const seq = {
    type: 'sequence',
    participants: [
      { id: 'p:a', name_zh: '甲', name_en: 'A', kind: 'code', nodes: ['A'] },
      { id: 'p:b', name_zh: '乙', name_en: 'B', kind: 'code', nodes: ['B'] },
    ],
    steps: [{ from: 'p:a', to: 'p:b', label_zh: '调', label_en: 'call' }],
  };
  const model = { flows: [
    { id: 'flow:withdg', name: 'X', nodes: ['A', 'B'], edges: [], diagram: seq },
    { id: 'flow:nodg',   name: 'Y', nodes: ['A'], edges: [] },
  ] };
  const { flowsById, defaultFlowId } = buildFlowIndex(model, { classById, activeFlow: null });
  assert.deepEqual([...flowsById.keys()], ['flow:withdg']);
  assert.equal(defaultFlowId, 'flow:withdg');
});

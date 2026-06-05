import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceFlow, synthesizeFlows } from '../data/flows.js';

const ctx = {
  edgesFromIdx: new Map([['A', [{ to: 'B', kind: 'uses' }]], ['B', [{ to: 'C', kind: 'uses' }]]]),
  hubIds: new Set(['B']),
  classById: new Map([['A', { id: 'A', name: 'A' }], ['B', { id: 'B', name: 'B' }], ['C', { id: 'C', name: 'C' }]]),
  maxDepth: 6,
};
test('traceFlow: hub 作叶子，不展开其下游', () => {
  const f = traceFlow('A', ctx);
  assert.ok(f.nodes.includes('A') && f.nodes.includes('B'));
  assert.ok(!f.nodes.includes('C'), 'hub B 不应展开到 C');
});
test('traceFlow: 只走 kind=uses 边', () => {
  const ctx2 = { ...ctx, edgesFromIdx: new Map([['A', [{ to: 'B', kind: 'extends' }]]]), hubIds: new Set() };
  const f = traceFlow('A', ctx2);
  assert.ok(!f.nodes.includes('B'), 'extends 边不应进入 flow');
});

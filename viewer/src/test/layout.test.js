import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLayout } from '../layout/metrics.js';
import { layoutLayers } from '../layout/layers.js';
import { layoutFlow } from '../layout/flow.js';

const L = makeLayout(1);
test('layoutLayers 返回 bands 且 totalHeight>0', () => {
  const layers = [{ id: 'a', name: 'A', order: 0, summary: '', classes: [
    { id: 'X', name: 'X', importance: 0.9 }, { id: 'Y', name: 'Y', importance: 0.1 },
  ]}];
  const out = layoutLayers(layers, 1000, L);
  assert.ok(Array.isArray(out.bands) && out.bands.length === 1);
  assert.ok(out.totalHeight > 0);
});
test('layoutFlow 把 seed 放在第 0 列', () => {
  const flow = { seed: 'A', nodes: ['A', 'B'], edges: [{ from: 'A', to: 'B' }] };
  const classById = new Map([['A', { id: 'A', name: 'A' }], ['B', { id: 'B', name: 'B' }]]);
  const out = layoutFlow(flow, classById, L);
  const a = out.nodes.find(n => n.datum.id === 'A');
  const b = out.nodes.find(n => n.datum.id === 'B');
  assert.ok(a.x < b.x, 'seed 应在 B 左侧');
});
test('layoutFlow 同一流程内所有节点等宽（取最长标签）', () => {
  const flow = { seed: 'A', nodes: ['A', 'B', 'C'], edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }] };
  const classById = new Map([
    ['A', { id: 'A', name: 'A' }],
    ['B', { id: 'B', name: 'AVeryLongOrchestratorClassName' }],
    ['C', { id: 'C', name: 'C' }],
  ]);
  const out = layoutFlow(flow, classById, L);
  const widths = new Set(out.nodes.map(n => n.w));
  assert.equal(widths.size, 1, `所有节点应等宽，实际: ${[...widths]}`);
});

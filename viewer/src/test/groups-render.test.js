// DOM-free test of layerView.computeLayout branching. The project has no DOM
// test harness (pure-logic tests only; DOM wiring is verified end-to-end), so
// we exercise computeLayout — which is DOM-free — directly via the registered
// view. buildContent (DOM) is covered by the end-to-end serve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerBuiltinViews, getView } from '../render/registry.js';
import { makeLayout } from '../layout/metrics.js';

registerBuiltinViews();
const layerView = getView('layer');
const LAYOUT = makeLayout(1);
const ctx = { canvasWidth: () => 1000 };
const cls = (id) => ({ id, name: id, importance: 0.5, core: true });

test('layer view 已注册,含 computeLayout/buildContent', () => {
  assert.ok(layerView);
  assert.equal(typeof layerView.computeLayout, 'function');
  assert.equal(typeof layerView.buildContent, 'function');
});

test('computeLayout: 无 layer_groups → frames 为空(扁平路径)', () => {
  const st = { LAYOUT, raw: { layers: [
    { id: 'a', name: 'A', classes: [cls('X')] },
  ] } };
  const out = layerView.computeLayout(st, ctx);
  assert.deepEqual(out.frames, []);
  assert.equal(out.bands.length, 1);
  assert.equal(out.bands[0].x, 0);
});

test('computeLayout: 有 layer_groups → 产出 frames + 并排子带', () => {
  const st = { LAYOUT, raw: {
    layer_groups: [{ id: 'g', name: 'Storage', order: 1, layout: 'row', children: ['file', 'blob'] }],
    layers: [
      { id: 'app', name: 'App', order: 0, classes: [cls('A')] },
      { id: 'file', name: 'File', order: 1, group: 'g', classes: [cls('F')] },
      { id: 'blob', name: 'Blob', order: 1, group: 'g', classes: [cls('B')] },
    ],
  } };
  const out = layerView.computeLayout(st, ctx);
  assert.equal(out.frames.length, 1);
  assert.equal(out.frames[0].group.name, 'Storage');
  const file = out.bands.find((b) => b.layer.id === 'file');
  const blob = out.bands.find((b) => b.layer.id === 'blob');
  assert.ok(blob.x > file.x, '子带横向并排');
});

test('computeLayout: core 过滤后空层不渲染,但保留 group 字段', () => {
  const st = { LAYOUT, raw: {
    layer_groups: [{ id: 'g', name: 'G', order: 0, layout: 'row', children: ['file', 'empty'] }],
    layers: [
      { id: 'file', name: 'File', order: 0, group: 'g', classes: [cls('F')] },
      { id: 'empty', name: 'Empty', order: 0, group: 'g', classes: [{ id: 'Z', name: 'Z', importance: 0.5, core: false }] },
    ],
  } };
  const out = layerView.computeLayout(st, ctx);
  // empty 全是非 core → 不渲染;file 仍在
  assert.ok(out.bands.find((b) => b.layer.id === 'file'));
  assert.equal(out.bands.find((b) => b.layer.id === 'empty'), undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModel } from '../data/schema.js';

test('loadModel 回填缺失 id、镜像 package/namespace', () => {
  const m = loadModel({ project: { name: 'p' }, layers: [
    { id: 'l', name: 'L', order: 0, summary: '', classes: [{ name: 'Foo', namespace: 'a' }] },
  ], edges: [], flows: [] });
  const c = m.layers[0].classes[0];
  assert.equal(c.id, 'a.Foo');
  assert.equal(c.package, c.namespace);
});
test('loadModel 无 edges 时 importance 兜底为 0.5', () => {
  const m = loadModel({ project: { name: 'p' }, layers: [
    { id: 'l', name: 'L', order: 0, summary: '', classes: [{ id: 'X', name: 'X' }] },
  ], edges: [], flows: [] });
  assert.equal(m.layers[0].classes[0].importance, 0.5);
});
test('loadModel 标注 schemaVersion', () => {
  const m = loadModel({ project: { name: 'p' }, layers: [], edges: [], flows: [] });
  assert.ok(typeof m.schemaVersion === 'number');
});

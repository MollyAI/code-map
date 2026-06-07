import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT_BASE, makeLayout, nodeWidth } from '../layout/metrics.js';

test('makeLayout 按 fontScale 缩放、不改 LAYOUT_BASE', () => {
  const before = JSON.stringify(LAYOUT_BASE);
  const L = makeLayout(2);
  assert.equal(L.nodeH, LAYOUT_BASE.nodeH * 2);
  assert.equal(JSON.stringify(LAYOUT_BASE), before, 'LAYOUT_BASE 必须保持不可变');
});
test('nodeWidth 受 importance 影响且落在 [min,max]', () => {
  const L = makeLayout(1);
  const w = nodeWidth({ name: 'abcdef', importance: 0.9 }, L);
  assert.ok(w >= L.minNodeW && w <= L.maxNodeW);
});
test('nodeWidth sizes by display_name when present', () => {
  const L = makeLayout(1);
  const short = nodeWidth({ name: 'run' }, L);
  const long  = nodeWidth({ name: 'run', display_name: 'server:run' }, L);
  assert.ok(long > short, `display_name should widen the box: ${long} vs ${short}`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT_BASE, makeLayout, nodeWidth, labelWidth } from '../layout/metrics.js';

test('makeLayout 按 fontScale 缩放、不改 LAYOUT_BASE', () => {
  const before = JSON.stringify(LAYOUT_BASE);
  const L = makeLayout(2);
  assert.equal(L.nodeH, LAYOUT_BASE.nodeH * 2);
  assert.equal(JSON.stringify(LAYOUT_BASE), before, 'LAYOUT_BASE 必须保持不可变');
});
test('nodeWidth 自适应：永远容纳完整标签（无截断），且不低于 minNodeW', () => {
  const L = makeLayout(1);
  assert.equal(nodeWidth({ name: 'ab' }, L), L.minNodeW, '短名走最小宽度');
  const longName = 'AVeryLongDeclarationNameThatUsedToBeTruncated';
  const w = nodeWidth({ name: longName }, L);
  assert.equal(w, labelWidth(longName, L) + L.nodePadX * 2, '长名按实宽 + 两侧 padding');
  assert.ok(w > 220, '不再受旧 maxNodeW=220 截断');
});
test('nodeWidth sizes by display_name when present', () => {
  const L = makeLayout(1);
  const short = nodeWidth({ name: 'run' }, L);
  const long  = nodeWidth({ name: 'run', display_name: 'server:run:with-a-long-disambiguator' }, L);
  assert.ok(long > short, `display_name should widen the box: ${long} vs ${short}`);
});

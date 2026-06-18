import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEdgePath } from '../render/edges.js';

const A = { x: 0,   y: 0,   w: 80, h: 28 };
const B = { x: 200, y: 200, w: 80, h: 28 };
const C = { x: 200, y: 0,   w: 80, h: 28 };  // same row as A (|Δy| < 6)

test('buildEdgePath 返回以 M 开头的 SVG path d 字符串', () => {
  // 跨 band 分支
  const d = buildEdgePath(A, B);
  assert.equal(typeof d, 'string');
  assert.ok(d.startsWith('M'), `expected path to start with M, got: ${d}`);
  assert.ok(d.includes('C'), 'expected a cubic segment');
});

test('buildEdgePath 同排走下弧分支（含 nodeH dip）', () => {
  const d = buildEdgePath(A, C, 28);
  assert.ok(d.startsWith('M'));
  // 同排时两端点 y 都落在 row bottom (= from.y + from.h = 28)
  assert.ok(d.includes('M 40 28'), `expected start at row bottom, got: ${d}`);
});

test('buildEdgePath: 侧排 peer 节点(Δy>6)产出竖直三次曲线,不抛错', () => {
  const from = { x: 50, y: 100, w: 80, h: 28 };
  const to   = { x: 400, y: 140, w: 80, h: 28 };  // 不同子带、横向远离
  const d = buildEdgePath(from, to, 28);
  assert.ok(d.startsWith('M') && d.includes('C'), `应为合法竖直曲线: ${d}`);
});

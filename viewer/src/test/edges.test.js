import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEdgePath, buildFlowEdgePath, buildLinkPath, flowEdgeClass } from '../render/edges.js';

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

test('buildFlowEdgePath 返回以 M 开头的 SVG path d 字符串', () => {
  const d = buildFlowEdgePath(A, B);
  assert.equal(typeof d, 'string');
  assert.ok(d.startsWith('M'), `expected path to start with M, got: ${d}`);
  assert.ok(d.includes('C'), 'expected a cubic segment');
});

test('flowEdgeClass: dispatch 加 dispatch class；active/dimmed 互斥', () => {
  assert.equal(flowEdgeClass('uses'), 'edge flow');
  assert.equal(flowEdgeClass('dispatch'), 'edge flow dispatch');
  assert.equal(flowEdgeClass('dispatch', { active: true }), 'edge flow dispatch active');
  assert.equal(flowEdgeClass('uses', { dimmed: true }), 'edge flow dimmed');
  assert.equal(flowEdgeClass('dispatch', { active: true, dimmed: true }), 'edge flow dispatch active'); // active 优先
});

test('flowEdgeClass passes non-uses kinds through as k-<kind>', () => {
  assert.equal(flowEdgeClass('data'), 'edge flow k-data');
  assert.equal(flowEdgeClass('control', { dimmed: true }), 'edge flow k-control dimmed');
  assert.equal(flowEdgeClass('return', { active: true }), 'edge flow k-return active');
  assert.equal(flowEdgeClass('dispatch'), 'edge flow dispatch');   // 既有行为不变
  assert.equal(flowEdgeClass('uses'), 'edge flow');
  assert.equal(flowEdgeClass(undefined), 'edge flow');
});

test('buildLinkPath: forward delegates to right→left, backward mirrors', () => {
  const a = { x: 0, y: 0, w: 100, h: 28 };
  const b = { x: 200, y: 0, w: 100, h: 28 };
  assert.equal(buildLinkPath(a, b), buildFlowEdgePath(a, b));
  const back = buildLinkPath(b, a);            // b 在 a 右侧 → 反向
  assert.match(back, /^M 200 14 C /);          // 从 b 左边缘出发
  assert.match(back, / 100 14$/);              // 到 a 右边缘
});

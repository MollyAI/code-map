import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchDistance, touchMidpoint, pinchZoom } from '../interact/touch.js';

const pt = (x, y) => ({ clientX: x, clientY: y });

test('touchDistance 3-4-5 直角三角形', () => {
  assert.equal(touchDistance(pt(0, 0), pt(3, 4)), 5);
});
test('touchDistance 对称、同点为 0', () => {
  assert.equal(touchDistance(pt(1, 2), pt(4, 6)), touchDistance(pt(4, 6), pt(1, 2)));
  assert.equal(touchDistance(pt(5, 5), pt(5, 5)), 0);
});
test('touchMidpoint 取两点中点', () => {
  assert.deepEqual(touchMidpoint(pt(0, 0), pt(10, 20)), { x: 5, y: 10 });
});
test('pinchZoom 放大/缩小/不变', () => {
  assert.equal(pinchZoom(1, 100, 200), 2);
  assert.equal(pinchZoom(2, 200, 100), 1);
  assert.equal(pinchZoom(1.5, 80, 80), 1.5);
});
test('pinchZoom 退化指距(0)返回原缩放', () => {
  assert.equal(pinchZoom(1.5, 0, 50), 1.5);
});

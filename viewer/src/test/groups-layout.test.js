import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLayout } from '../layout/metrics.js';
import { layoutGrouped } from '../layout/groups.js';

const L = makeLayout(1);
const cls = (id, imp = 0.5) => ({ id, name: id, importance: imp, core: true });

test('standalone 叶层:整宽单带,x=0', () => {
  const leaves = [{ id: 'a', name: 'A', order: 0, classes: [cls('X')] }];
  const out = layoutGrouped(leaves, [], 1000, L);
  assert.equal(out.bands.length, 1);
  assert.equal(out.bands[0].x, 0);
  assert.equal(out.bands[0].width, 1000);
  assert.equal(out.frames.length, 0);
  assert.ok(out.totalHeight > 0);
});

test('row group:两个子带并排(x 递增、y 相近),一个 frame', () => {
  const leaves = [
    { id: 'file', name: 'File', order: 0, group: 'g', classes: [cls('F')] },
    { id: 'blob', name: 'Blob', order: 0, group: 'g', classes: [cls('B')] },
  ];
  const groups = [{ id: 'g', name: 'Storage', order: 0, layout: 'row', children: ['file', 'blob'] }];
  const out = layoutGrouped(leaves, groups, 1000, L);
  assert.equal(out.frames.length, 1);
  assert.equal(out.frames[0].group.name, 'Storage');
  const fileBand = out.bands.find((b) => b.layer.id === 'file');
  const blobBand = out.bands.find((b) => b.layer.id === 'blob');
  assert.ok(fileBand && blobBand);
  assert.ok(blobBand.x > fileBand.x, '子带横向并排');
  assert.ok(Math.abs(fileBand.y - blobBand.y) < 2, '同一行 y 相近');
  const fr = out.frames[0];
  assert.ok(fileBand.x >= fr.x && blobBand.x + blobBand.width <= fr.x + fr.width + 1);
});

test('column group:两个子带竖排(y 递增、x 相同)', () => {
  const leaves = [
    { id: 'net', name: 'Net', order: 1 + 1 / 3, group: 'infra', classes: [cls('N')] },
    { id: 'os', name: 'OS', order: 1 + 2 / 3, group: 'infra', classes: [cls('O')] },
  ];
  const groups = [{ id: 'infra', name: 'Infra', order: 1, layout: 'column', children: ['net', 'os'] }];
  const out = layoutGrouped(leaves, groups, 1000, L);
  const net = out.bands.find((b) => b.layer.id === 'net');
  const os = out.bands.find((b) => b.layer.id === 'os');
  assert.ok(os.y > net.y, '子带竖向堆叠');
  assert.equal(net.x, os.x);
});

test('裸 group(无 name):frame.group.name 为空', () => {
  const leaves = [
    { id: 'a', name: 'A', order: 0, group: 'g', classes: [cls('A')] },
    { id: 'b', name: 'B', order: 0, group: 'g', classes: [cls('B')] },
  ];
  const groups = [{ id: 'g', order: 0, layout: 'row', children: ['a', 'b'] }];
  const out = layoutGrouped(leaves, groups, 1000, L);
  assert.ok(!out.frames[0].group.name);
});

test('顶层按 order 排序:standalone(0) 在 group(1) 之上', () => {
  const leaves = [
    { id: 'top', name: 'Top', order: 0, classes: [cls('T')] },
    { id: 'x', name: 'X', order: 1, group: 'g', classes: [cls('X')] },
  ];
  const groups = [{ id: 'g', name: 'G', order: 1, layout: 'row', children: ['x'] }];
  const out = layoutGrouped(leaves, groups, 1000, L);
  const top = out.bands.find((b) => b.layer.id === 'top');
  const x = out.bands.find((b) => b.layer.id === 'x');
  assert.ok(top.y < x.y);
});

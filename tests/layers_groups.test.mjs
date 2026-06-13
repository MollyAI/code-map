import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandGroups } from '../scripts/lib/layers.mjs';

test('expandGroups: 扁平配置原样透传,无 group/无 layer_groups', () => {
  const cfg = [
    { id: 'pres', name: 'Pres', order: 0, path_segments: ['ui'] },
    { id: 'data', name: 'Data', order: 1, path_segments: ['data'] },
    { id: 'uncategorized', name: 'Uncategorized', order: 99 },
  ];
  const { leaves, groups } = expandGroups(cfg);
  assert.equal(groups.length, 0);
  assert.equal(leaves.length, 3);
  // 字段与 order 完全不变,且不引入 group 键(保扁平字节一致)
  assert.deepEqual(leaves[0], { id: 'pres', name: 'Pres', order: 0, path_segments: ['ui'] });
  assert.equal(leaves[1].order, 1);
  assert.equal('group' in leaves[0], false);
});

test('expandGroups: row group 子层共享 order=t,带 group id', () => {
  const cfg = [
    { id: 'pres', name: 'Pres', order: 0 },
    { id: 'storage-tier', name: 'Storage', order: 1, layout: 'row',
      children: [
        { id: 'file', name: 'File', path_segments: ['file'] },
        { id: 'blob', name: 'Blob', path_segments: ['blob'] },
      ] },
  ];
  const { leaves, groups } = expandGroups(cfg);
  const file = leaves.find((l) => l.id === 'file');
  const blob = leaves.find((l) => l.id === 'blob');
  assert.equal(file.order, 1);
  assert.equal(blob.order, 1);          // peers 同序 → 评分中性
  assert.equal(file.group, 'storage-tier');
  assert.equal(file.path_segments[0], 'file');  // 路由字段保留
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], {
    id: 'storage-tier', name: 'Storage', order: 1, layout: 'row',
    children: ['file', 'blob'],
  });
});

test('expandGroups: column group 子层递增子序号,落在 (t,t+1)', () => {
  const cfg = [
    { id: 'app', name: 'App', order: 0 },
    { id: 'infra', name: 'Infra', order: 1, layout: 'column',
      children: [
        { id: 'net', name: 'Net', path_segments: ['net'] },
        { id: 'os', name: 'OS', path_segments: ['os'] },
      ] },
  ];
  const { leaves } = expandGroups(cfg);
  const net = leaves.find((l) => l.id === 'net');
  const os = leaves.find((l) => l.id === 'os');
  assert.equal(net.order, 1 + 1 / 3);   // (j=0): 1/3
  assert.equal(os.order, 1 + 2 / 3);    // (j=1): 2/3
  assert.ok(net.order > 1 && os.order < 2 && net.order < os.order);
});

test('expandGroups: 缺省 layout 视为 row', () => {
  const { leaves } = expandGroups([
    { id: 'g', name: 'G', order: 0, children: [{ id: 'a' }, { id: 'b' }] },
  ]);
  assert.equal(leaves.find((l) => l.id === 'a').order, 0);
  assert.equal(leaves.find((l) => l.id === 'b').order, 0);
});

test('expandGroups: 名空 group → groups 项不含 name(裸 peer)', () => {
  const { groups } = expandGroups([
    { id: 'g', order: 0, layout: 'row', children: [{ id: 'a' }, { id: 'b' }] },
  ]);
  assert.equal('name' in groups[0], false);
});

test('expandGroups: 二级嵌套被展平(只一层),不崩溃', () => {
  const { leaves, groups } = expandGroups([
    { id: 'g', name: 'G', order: 0, layout: 'row',
      children: [{ id: 'inner', children: [{ id: 'a' }, { id: 'b' }] }, { id: 'c' }] },
  ]);
  // inner 的 children 被提升,inner 本身不作为叶层
  const ids = leaves.map((l) => l.id).sort();
  assert.deepEqual(ids, ['a', 'b', 'c']);
  assert.deepEqual(groups[0].children, ['a', 'b', 'c']);
});

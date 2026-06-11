import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutPipeline } from '../layout/pipeline.js';
import { LAYOUT_BASE } from '../layout/metrics.js';

const classById = new Map([
  ['a.x', { id: 'a.x', name: 'x' }],
  ['a.y', { id: 'a.y', name: 'yyyyyyyyyyyyyyyy' }],
  ['a.z', { id: 'a.z', name: 'z' }],
]);

const flow = {
  seed: 'a.x',
  nodes: ['a.x', 'a.y', 'a.z'],
  diagram: {
    type: 'pipeline',
    stages: [
      { id: 's1', name_zh: '一', name_en: 'One', nodes: ['a.x'] },
      { id: 's2', name_zh: '二', name_en: 'Two', nodes: ['a.y', 'a.z'] },
    ],
    extra_nodes: [
      { id: 'x:in', kind: 'actor', name: 'user', stage: 's1' },
      { id: 'x:out', kind: 'artifact', name: 'out.json' },        // unstaged
    ],
    links: [
      { from: 's1', to: 's2', label_zh: '数据', label_en: 'data' },
      { from: 'a.y', to: 'x:out', label_zh: '写', label_en: 'write' },
    ],
  },
};

test('stages: 从左到右、等高、x 单调且不重叠', () => {
  const lay = layoutPipeline(flow, classById, LAYOUT_BASE);
  assert.equal(lay.stages.length, 2);
  const [s1, s2] = lay.stages;
  assert.ok(s2.x > s1.x + s1.w, 'stage 2 starts after stage 1 ends');
  assert.equal(s1.h, s2.h, 'equal stage heights');
  assert.equal(s1.y, s2.y);
});

test('decl 节点居中落在所属 stage 内，纵向不重叠', () => {
  const lay = layoutPipeline(flow, classById, LAYOUT_BASE);
  const s2 = lay.stages[1];
  const inS2 = lay.nodes.filter((n) => ['a.y', 'a.z'].includes(n.datum.id));
  assert.equal(inS2.length, 2);
  for (const n of inS2) {
    assert.ok(n.x >= s2.x && n.x + n.w <= s2.x + s2.w, 'inside stage horizontally');
    assert.ok(n.y >= s2.y && n.y + n.h <= s2.y + s2.h, 'inside stage vertically');
  }
  const [n1, n2] = inS2.sort((a, b) => a.y - b.y);
  assert.ok(n2.y >= n1.y + n1.h, 'stacked without overlap');
});

test('staged extra 入容器；unstaged extra 排在最后一个 stage 之后', () => {
  const lay = layoutPipeline(flow, classById, LAYOUT_BASE);
  const xin = lay.extraNodes.find((n) => n.datum.id === 'x:in');
  const xout = lay.extraNodes.find((n) => n.datum.id === 'x:out');
  const s1 = lay.stages[0], s2 = lay.stages[1];
  assert.ok(xin.x >= s1.x && xin.x + xin.w <= s1.x + s1.w);
  assert.ok(xout.x > s2.x + s2.w, 'unstaged extra after the last stage');
  assert.ok(lay.width > xout.x + xout.w, 'width covers the trailing column');
});

test('links: 端点解析为 stage/节点矩形，label 锚点在两端之间', () => {
  const lay = layoutPipeline(flow, classById, LAYOUT_BASE);
  assert.equal(lay.links.length, 2);
  const l1 = lay.links[0];                       // s1 → s2 (stage rects)
  assert.equal(l1.from.x, lay.stages[0].x);
  assert.equal(l1.to.x, lay.stages[1].x);
  assert.ok(l1.label.x > l1.from.x + l1.from.w && l1.label.x < l1.to.x);
  const l2 = lay.links[1];                       // a.y → x:out (node rects)
  assert.equal(l2.from.x, lay.nodes.find((n) => n.datum.id === 'a.y').x);
});

test('引用失效的 link 被静默丢弃（防御）', () => {
  const f = JSON.parse(JSON.stringify(flow));
  f.diagram.links.push({ from: 'ghost', to: 's2', label_zh: '鬼', label_en: 'ghost' });
  const lay = layoutPipeline(f, classById, LAYOUT_BASE);
  assert.equal(lay.links.length, 2);
});

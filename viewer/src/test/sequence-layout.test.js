import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSequence, SELF_LOOP } from '../layout/sequence.js';
import { LAYOUT_BASE, labelWidth } from '../layout/metrics.js';

const flow = {
  diagram: {
    type: 'sequence',
    participants: [
      { id: 'p:m', name_zh: '主流程', name_en: 'main', kind: 'code', nodes: ['a.x'] },
      { id: 'p:e', name_zh: '抽取器', name_en: 'extractors', kind: 'code', nodes: ['a.y'] },
      { id: 'p:fs', name_zh: '文件系统', name_en: 'filesystem', kind: 'artifact' },
    ],
    steps: [
      { from: 'p:m', to: 'p:e', label_zh: '解析', label_en: 'parse', kind: 'call' },
      { from: 'p:e', to: 'p:m', label_zh: '返回', label_en: 'decls', kind: 'return' },
      { from: 'p:m', to: 'p:m', label_zh: '建图', label_en: 'build graph', kind: 'self' },
      { from: 'p:m', to: 'p:fs', label_zh: '写文件', label_en: 'write', kind: 'call' },
    ],
  },
};

test('participants 一行排开，x 单调不重叠', () => {
  const lay = layoutSequence(flow, LAYOUT_BASE);
  assert.equal(lay.participants.length, 3);
  for (let i = 1; i < lay.participants.length; i++) {
    const prev = lay.participants[i - 1], cur = lay.participants[i];
    assert.ok(cur.x > prev.x + prev.w, 'no overlap');
    assert.equal(cur.y, prev.y, 'same row');
  }
});

test('lifelines 从参与者盒底部垂到图底，x 在盒中心', () => {
  const lay = layoutSequence(flow, LAYOUT_BASE);
  assert.equal(lay.lifelines.length, 3);
  lay.lifelines.forEach((L, i) => {
    const p = lay.participants[i];
    assert.equal(L.x, p.x + p.w / 2);
    assert.equal(L.y1, p.y + p.h);
    assert.ok(L.y2 > L.y1);
  });
});

test('steps y 严格递增、等间距，端点 x 对到生命线', () => {
  const lay = layoutSequence(flow, LAYOUT_BASE);
  assert.equal(lay.steps.length, 4);
  for (let i = 1; i < lay.steps.length; i++) {
    assert.ok(lay.steps[i].y > lay.steps[i - 1].y);
  }
  const gap1 = lay.steps[1].y - lay.steps[0].y;
  const gap2 = lay.steps[2].y - lay.steps[1].y;
  assert.equal(gap1, gap2, 'uniform step gap');
  assert.equal(lay.steps[0].x1, lay.lifelines[0].x);
  assert.equal(lay.steps[0].x2, lay.lifelines[1].x);
  assert.equal(lay.steps[0].index, 1, '1-based order index');
});

test('self step 两端同 x；尺寸覆盖全部内容', () => {
  const lay = layoutSequence(flow, LAYOUT_BASE);
  const self = lay.steps[2];
  assert.equal(self.x1, self.x2);
  const last = lay.participants[2];
  assert.ok(lay.width >= last.x + last.w);
  assert.ok(lay.height > lay.steps[3].y);
});

test('相邻生命线距离随长标签加宽（标签不压参与者盒）', () => {
  const f = JSON.parse(JSON.stringify(flow));
  f.diagram.steps[0].label_en = 'a quite long message label that must fit between lifelines';
  const lay = layoutSequence(f, LAYOUT_BASE);
  const d = lay.lifelines[1].x - lay.lifelines[0].x;
  assert.ok(d >= labelWidth(f.diagram.steps[0].label_en, LAYOUT_BASE), `distance ${d}`);
});

test('末位参与者的 self 长标签计入总宽（不被裁掉）', () => {
  const f = JSON.parse(JSON.stringify(flow));
  f.diagram.steps.push({ from: 'p:fs', to: 'p:fs',
    label_zh: '一段很长很长的自环步骤说明文字', label_en: 'long self note', kind: 'self' });
  const lay = layoutSequence(f, LAYOUT_BASE);
  const lastLife = lay.lifelines[2].x;
  const lw = labelWidth('一段很长很长的自环步骤说明文字', LAYOUT_BASE);
  assert.ok(lay.width >= lastLife + SELF_LOOP.w + 8 + lw, `width ${lay.width}`);
});

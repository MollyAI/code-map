import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertInv1, assertInvU1, assertInvB1, renderedLabel, collectViolations, formatDiagnostics } from '../data/invariants.js';
import { makeLayout, labelWidth } from '../layout/metrics.js';

const layer = (name, classes) => ({ id: name.toLowerCase().replace(/\s+/g, '-'), name, classes });
const cls = (o) => ({ core: true, ...o });

const HERE = dirname(fileURLToPath(import.meta.url));
const LONG = 'AVeryLongDeclarationNameThatWouldHaveBeenTruncatedBeforeAdaptiveWidth';

test('renderedLabel prefers display_name, falls back to name', () => {
  assert.equal(renderedLabel({ name: 'x' }), 'x');
  assert.equal(renderedLabel({ name: 'x', display_name: 'A:x' }), 'A:x');
});

test('INV-1: duplicate rendered label in one category fires once', () => {
  const model = { layers: [layer('Cocoa Bindings', [
    cls({ id: 'a', name: 'observeWeaklyKeyPathFor', path: 'Foundation/NSObject+Rx.swift',
          signature: 'func observeWeaklyKeyPathFor(_:options:) -> Observable<T?>' }),
    cls({ id: 'b', name: 'observeWeaklyKeyPathFor', path: 'Foundation/NSObject+Rx.swift',
          signature: 'func observeWeaklyKeyPathFor(_:options:) -> Observable<T>' }),
  ])] };
  const v = assertInv1(model);
  assert.equal(v.length, 1);
  assert.equal(v[0].inv, 'INV-1');
  assert.equal(v[0].category, 'Cocoa Bindings');
  assert.equal(v[0].label, 'observeWeaklyKeyPathFor');
  assert.equal(v[0].sources.length, 2);
  assert.equal(v[0].sources[0].signature, 'func observeWeaklyKeyPathFor(_:options:) -> Observable<T?>');
});

test('INV-1: distinct display_name → green', () => {
  const model = { layers: [layer('Cocoa Bindings', [
    cls({ id: 'a', name: 'x', display_name: 'A:x' }),
    cls({ id: 'b', name: 'x', display_name: 'B:x' }),
  ])] };
  assert.deepEqual(assertInv1(model), []);
});

test('INV-1: non-core duplicates are ignored (never rendered)', () => {
  const model = { layers: [layer('L', [
    cls({ id: 'a', name: 'dup', core: false }),
    cls({ id: 'b', name: 'dup', core: false }),
  ])] };
  assert.deepEqual(assertInv1(model), []);
});

test('INV-1: same label across DIFFERENT categories is allowed', () => {
  const model = { layers: [
    layer('L1', [cls({ id: 'a', name: 'dup' })]),
    layer('L2', [cls({ id: 'b', name: 'dup' })]),
  ] };
  assert.deepEqual(assertInv1(model), []);
});

test('INV-U1: green under real geometry (boxes always fit the full label)', () => {
  const L = makeLayout(1);
  const model = { layers: [layer('L', [cls({ id: 'a', name: LONG })])] };
  assert.deepEqual(assertInvU1(model, L), []);
});

test('INV-U1: a reintroduced width cap is caught (injected nodeWidth)', () => {
  const L = makeLayout(1);
  const model = { layers: [layer('L', [cls({ id: 'a', name: LONG })])] };
  const capped = () => 220; // pretend nodeWidth re-added the old maxNodeW=220 cap
  const v = assertInvU1(model, L, { nodeWidth: capped, labelWidth });
  assert.equal(v.length, 1);
  assert.equal(v[0].inv, 'INV-U1');
  assert.equal(v[0].node, LONG);
});

test('INV-U1: only core nodes are checked', () => {
  const L = makeLayout(1);
  const model = { layers: [layer('L', [cls({ id: 'a', name: LONG, core: false })])] };
  const capped = () => 220;
  assert.deepEqual(assertInvU1(model, L, { nodeWidth: capped, labelWidth }), []);
});

test('static guard: render/node.js renders the full label, never truncates', () => {
  const src = readFileSync(join(HERE, '../render/node.js'), 'utf8');
  assert.ok(src.includes('n.datum.display_name || n.datum.name'),
    'node label must be the full display_name||name');
  for (const bad of ['truncate(', '…', 'text-overflow', 'maxNodeW']) {
    assert.ok(!src.includes(bad), `render/node.js must not clip node labels (found ${JSON.stringify(bad)})`);
  }
});

test('static guard: the .node .nlabel CSS rule has no clip/ellipsis', () => {
  const css = readFileSync(join(HERE, '../../style.css'), 'utf8');
  const start = css.indexOf('.node .nlabel {');
  assert.ok(start >= 0, '.node .nlabel rule must exist');
  const block = css.slice(start, css.indexOf('}', start));
  for (const bad of ['text-overflow', 'overflow', 'white-space']) {
    assert.ok(!block.includes(bad), `.node .nlabel must not clip (found ${bad})`);
  }
});

test('collectViolations merges INV-1 + INV-U1', () => {
  const L = makeLayout(1);
  const model = { layers: [layer('Cocoa Bindings', [
    cls({ id: 'a', name: 'dup' }), cls({ id: 'b', name: 'dup' }),
  ])] };
  const v = collectViolations(model, L);
  assert.equal(v.filter((x) => x.inv === 'INV-1').length, 1);
});

test('formatDiagnostics renders the actionable INV-1 block', () => {
  const out = formatDiagnostics([{
    inv: 'INV-1', category: 'Cocoa Bindings', label: 'observeWeaklyKeyPathFor',
    sources: [
      { path: 'Foundation/NSObject+Rx.swift', signature: 'func observeWeaklyKeyPathFor(_:options:) -> Observable<T?>' },
      { path: 'Foundation/NSObject+Rx.swift', signature: 'func observeWeaklyKeyPathFor(_:options:) -> Observable<T>' },
    ],
  }]);
  assert.match(out, /INV-1 FAIL — category "Cocoa Bindings"/);
  assert.match(out, /duplicate rendered label: "observeWeaklyKeyPathFor" ×2/);
  assert.match(out, /Foundation\/NSObject\+Rx\.swift {2}func observeWeaklyKeyPathFor/);
  assert.match(out, /fix: R3b/);
});

test('formatDiagnostics renders the INV-U1 block', () => {
  const out = formatDiagnostics([{ inv: 'INV-U1', node: 'Foo', reason: 'box narrower than label (nodeWidth 220px < label 312px)' }]);
  assert.match(out, /INV-U1 FAIL — node "Foo"/);
  assert.match(out, /reason: box narrower than label/);
  assert.match(out, /fix: 检查 nodeWidth/);
});

test('INV-1: group 模型按叶层判唯一(同名跨叶层不算冲突)', () => {
  const model = { layer_groups: [{ id: 'g', layout: 'row', children: ['file', 'blob'] }],
    layers: [
      { id: 'file', name: 'File', group: 'g', classes: [cls({ id: 'a', name: 'Store' })] },
      { id: 'blob', name: 'Blob', group: 'g', classes: [cls({ id: 'b', name: 'Store' })] },
    ] };
  // 同名 "Store" 分处两个不同叶层 → INV-1 不报(逐叶层判定)
  assert.equal(assertInv1(model).length, 0);
});

test('INV-1: 同一叶层内重复标签仍然报', () => {
  const model = { layers: [
    { id: 'file', name: 'File', classes: [
      cls({ id: 'a', name: 'Store' }), cls({ id: 'b', name: 'Store' }),
    ] },
  ] };
  assert.equal(assertInv1(model).length, 1);
});

test('INV-B1: layer 裸 summary(无配对)判红', () => {
  const v = assertInvB1({ layers: [{ id: 'fs', name: 'FileSystem', summary: '文件系统 · FileSystem', classes: [] }] });
  assert.equal(v.length, 1);
  assert.equal(v[0].inv, 'INV-B1');
  assert.match(v[0].field, /summary/);
});

test('INV-B1: layer 完整配对通过', () => {
  const v = assertInvB1({ layers: [{ id: 'fs', name: 'FileSystem', summary_zh: '文件系统', summary_en: 'FileSystem', classes: [] }] });
  assert.equal(v.length, 0);
});

test('INV-B1: layer 缺 summary(可选)放行', () => {
  const v = assertInvB1({ layers: [{ id: 'x', name: 'X', classes: [] }] });
  assert.equal(v.length, 0);
});

test('INV-B1: 只缺一半判红', () => {
  const v = assertInvB1({ layers: [{ id: 'x', name: 'X', summary_zh: '只有中文', classes: [] }] });
  assert.equal(v.length, 1);
});

test('INV-B1: 有 diagram 的 flow 名必须双语,缺则判红', () => {
  const v = assertInvB1({ layers: [], flows: [
    { id: 'f1', name: 'Init Flow', diagram: { type: 'pipeline' } },
    { id: 'f2', name_zh: '初始化', name_en: 'Init', diagram: { type: 'pipeline' } },
  ] });
  assert.equal(v.length, 1);
  assert.match(v[0].subject, /f1/);
});

test('INV-B1: 无 diagram 的候选 flow 不校验(Phase1 raw 不被误伤)', () => {
  const v = assertInvB1({ layers: [], flows: [{ id: 'cand', name: 'auto seed' }] });
  assert.equal(v.length, 0);
});

test('INV-B1: group 裸 summary 判红;无名无 summary 的 bare peer 放行', () => {
  const bad = assertInvB1({ layers: [], layer_groups: [{ id: 'g', name: 'IO', summary: 'x · y' }] });
  assert.equal(bad.length, 1);
  const ok = assertInvB1({ layers: [], layer_groups: [{ id: 'g2', children: ['a', 'b'] }] });
  assert.equal(ok.length, 0);
});

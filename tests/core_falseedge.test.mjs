import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceTokens, moduleToken, buildGraph } from '../scripts/lib/core.mjs';
import { Declaration } from '../scripts/lib/extractors/base.mjs';

test('sourceTokens: identifier set, no substring false hits', () => {
  const t = sourceTokens('foo_bar.get(x2); // target');
  assert.ok(t.has('foo_bar'));
  assert.ok(t.has('get'));
  assert.ok(t.has('x2'));
  assert.ok(t.has('target'));
  assert.ok(!t.has('foo')); // 不切 substring
});

test('moduleToken: namespace last segment, fallback to file stem', () => {
  assert.equal(moduleToken({ namespace: 'pkg.cost_tracker', path: 'pkg/cost_tracker.py' }), 'cost_tracker');
  assert.equal(moduleToken({ namespace: 'a/b/c', path: 'x.go' }), 'c');
  assert.equal(moduleToken({ namespace: null, path: 'foo/bar/baz.py' }), 'baz');
});

test('buildGraph guard: drops cross-file short-name edge when source never mentions target module', () => {
  const decls = [
    Declaration({ name: 'run', namespace: 'caller', kind: 'function', path: 'caller.py', line: 1, refs: ['get'] }),
    Declaration({ name: 'get', namespace: 'cost_tracker', kind: 'function', path: 'cost_tracker.py', line: 1 }),
  ];
  const mentionsByFile = new Map([
    ['caller.py', sourceTokens('def run(): return dict.get(0)')], // 不提及 cost_tracker
    ['cost_tracker.py', sourceTokens('def get(): pass')],
  ]);
  const [, edges] = buildGraph(decls, { mentionsByFile });
  assert.deepEqual(edges, []); // 假边被丢弃
});

test('buildGraph guard: keeps cross-file edge when source mentions target module', () => {
  const decls = [
    Declaration({ name: 'run', namespace: 'caller', kind: 'function', path: 'caller.py', line: 1, refs: ['get'] }),
    Declaration({ name: 'get', namespace: 'cost_tracker', kind: 'function', path: 'cost_tracker.py', line: 1 }),
  ];
  const mentionsByFile = new Map([
    ['caller.py', sourceTokens('from cost_tracker import get\ndef run(): return get()')],
    ['cost_tracker.py', sourceTokens('def get(): pass')],
  ]);
  const [, edges] = buildGraph(decls, { mentionsByFile });
  assert.deepEqual(edges, [{ from: 'caller.run', to: 'cost_tracker.get', kind: 'uses' }]);
});

test('buildGraph guard: same-file edge and extends edge are never filtered', () => {
  const decls = [
    Declaration({ name: 'A', namespace: 'm', kind: 'class', path: 'm.py', line: 1, refs: ['B'], supertypes: ['Base'] }),
    Declaration({ name: 'B', namespace: 'm', kind: 'function', path: 'm.py', line: 5 }),
    Declaration({ name: 'Base', namespace: 'other', kind: 'class', path: 'other.py', line: 1 }),
  ];
  const mentionsByFile = new Map([
    ['m.py', sourceTokens('class A(Base): pass\ndef B(): pass')], // 不提及 other,但 extends 不过滤
    ['other.py', sourceTokens('class Base: pass')],
  ]);
  const [, edges] = buildGraph(decls, { mentionsByFile });
  assert.ok(edges.some((e) => e.from === 'm.A' && e.to === 'm.B' && e.kind === 'uses'));
  assert.ok(edges.some((e) => e.from === 'm.A' && e.to === 'other.Base' && e.kind === 'extends'));
});

test('buildGraph without mentionsByFile is unchanged (fail-open)', () => {
  const decls = [
    Declaration({ name: 'run', namespace: 'caller', kind: 'function', path: 'caller.py', line: 1, refs: ['get'] }),
    Declaration({ name: 'get', namespace: 'cost_tracker', kind: 'function', path: 'cost_tracker.py', line: 1 }),
  ];
  const [, edges] = buildGraph(decls); // 无 opts → 闸门跳过
  assert.deepEqual(edges, [{ from: 'caller.run', to: 'cost_tracker.get', kind: 'uses' }]);
});

test('buildGraph guard: exact-qname cross-file edge is exempt (TS-rewritten refs not dropped)', () => {
  // ref 已是完整 qname(resolve/typescript 把 TS refs 重写成 qname),命中 byQname →
  // exact=true → 即便源文不提及目标模块也豁免,绝不误删 TS 边。
  const decls = [
    Declaration({ name: 'run', namespace: 'caller', kind: 'function', path: 'caller.ts', line: 1, refs: ['cost_tracker.get'] }),
    Declaration({ name: 'get', namespace: 'cost_tracker', kind: 'function', path: 'cost_tracker.ts', line: 1 }),
  ];
  const mentionsByFile = new Map([
    ['caller.ts', sourceTokens('export function run() { return g(0); }')], // 不提及 cost_tracker
    ['cost_tracker.ts', sourceTokens('export function get() {}')],
  ]);
  const [, edges] = buildGraph(decls, { mentionsByFile });
  assert.deepEqual(edges, [{ from: 'caller.run', to: 'cost_tracker.get', kind: 'uses' }]);
});

test('buildGraph guard: a globally-unique short name is still gated cross-file (uniqueness ≠ exemption)', () => {
  // 刻意设计:唯一短名也要过闸门——源文调用真目标必经 import(会提及模块名);
  // 若源文只含函数短名而不含模块名,该名多半是本地物,跨文件边视为假边丢弃。
  const decls = [
    Declaration({ name: 'run', namespace: 'caller', kind: 'function', path: 'caller.py', line: 1, refs: ['uniqueHelper'] }),
    Declaration({ name: 'uniqueHelper', namespace: 'helpers', kind: 'function', path: 'helpers.py', line: 1 }),
  ];
  const mentionsByFile = new Map([
    ['caller.py', sourceTokens('def run(): return uniqueHelper()')], // 含短名 uniqueHelper,不含模块 helpers
    ['helpers.py', sourceTokens('def uniqueHelper(): pass')],
  ]);
  const [, edges] = buildGraph(decls, { mentionsByFile });
  assert.deepEqual(edges, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { honestCount, countLabel } from '../data/counts.js';

test('honestCount: all types', () => {
  assert.deepEqual(honestCount([{ kind: 'class' }, { kind: 'struct' }, { kind: 'interface' }]),
    { types: 3, functions: 0, total: 3 });
});

test('honestCount: all functions (method counts as function)', () => {
  assert.deepEqual(honestCount([{ kind: 'function' }, { kind: 'method' }, { kind: 'composable_function' }]),
    { types: 0, functions: 3, total: 3 });
});

test('honestCount: mixed', () => {
  assert.deepEqual(honestCount([{ kind: 'class' }, { kind: 'function' }, { kind: 'enum' }]),
    { types: 2, functions: 1, total: 3 });
});

test('honestCount: unknown kind defaults to function bucket', () => {
  assert.deepEqual(honestCount([{ kind: 'macro_thing' }]), { types: 0, functions: 1, total: 1 });
});

test('countLabel: all types (en)', () => {
  assert.equal(countLabel([{ kind: 'class' }, { kind: 'struct' }], 'en'), '2 classes');
});

test('countLabel: all functions (zh)', () => {
  assert.equal(countLabel([{ kind: 'function' }, { kind: 'method' }], 'zh'), '2 个函数');
});

test('countLabel: mixed (zh) substitutes {n}/{c}/{f}', () => {
  assert.equal(countLabel([{ kind: 'class' }, { kind: 'function' }, { kind: 'enum' }], 'zh'), '3 项（2 类 · 1 函数）');
});

test('countLabel: mixed (en) substitutes {n}/{c}/{f}', () => {
  assert.equal(countLabel([{ kind: 'class' }, { kind: 'function' }], 'en'), '2 items (1 cls · 1 fn)');
});

test('countLabel: empty → 0 types label', () => {
  assert.equal(countLabel([], 'en'), '0 classes');
});

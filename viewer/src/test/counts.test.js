import test from 'node:test';
import assert from 'node:assert/strict';
import { honestCount } from '../data/counts.js';

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

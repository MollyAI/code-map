import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertInv1, renderedLabel } from '../data/invariants.js';

const layer = (name, classes) => ({ id: name.toLowerCase().replace(/\s+/g, '-'), name, classes });
const cls = (o) => ({ core: true, ...o });

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

import { assertInvU1 } from '../data/invariants.js';
import { makeLayout, labelWidth } from '../layout/metrics.js';

const LONG = 'AVeryLongDeclarationNameThatWouldHaveBeenTruncatedBeforeAdaptiveWidth';

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

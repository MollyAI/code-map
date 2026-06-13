import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLayout } from '../layout/metrics.js';
import { layoutLayers } from '../layout/layers.js';

const L = makeLayout(1);
test('layoutLayers 返回 bands 且 totalHeight>0', () => {
  const layers = [{ id: 'a', name: 'A', order: 0, summary: '', classes: [
    { id: 'X', name: 'X', importance: 0.9 }, { id: 'Y', name: 'Y', importance: 0.1 },
  ]}];
  const out = layoutLayers(layers, 1000, L);
  assert.ok(Array.isArray(out.bands) && out.bands.length === 1);
  assert.ok(out.totalHeight > 0);
});

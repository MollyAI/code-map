import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, migrateGrouping } from '../settings.js';

function fakeStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
test('createSettings 带前缀读写、缺失返回 fallback', () => {
  const s = createSettings(fakeStorage(), 'code-map-');
  assert.equal(s.get('view', 'core'), 'core');
  s.set('view', 'all');
  assert.equal(s.get('view', 'core'), 'all');
});
test('migrateGrouping 把 legacy subsystem 映射为 layer', () => {
  assert.equal(migrateGrouping('subsystem'), 'layer');
  assert.equal(migrateGrouping('flow'), 'flow');
});

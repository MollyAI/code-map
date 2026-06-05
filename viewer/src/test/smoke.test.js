import { test } from 'node:test';
import assert from 'node:assert/strict';

// Toolchain smoke: confirms `node --test` can load native ESM under viewer/src/.
// Real module tests live alongside this file (util.test.js, flows.test.js, ...).
test('toolchain smoke', () => {
  assert.equal(1 + 1, 2);
});

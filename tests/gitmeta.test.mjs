import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDirtyExcludingCodeMap } from '../scripts/lib/gitmeta.mjs';

test('isDirtyExcludingCodeMap: only .code-map/ changes → not dirty', () => {
  assert.equal(isDirtyExcludingCodeMap('?? .code-map/\n'), false);
  assert.equal(isDirtyExcludingCodeMap('?? .code-map/code-map.json\n M .code-map/overlay.json\n'), false);
});

test('isDirtyExcludingCodeMap: a non-.code-map change → dirty', () => {
  assert.equal(isDirtyExcludingCodeMap(' M src/app.py\n'), true);
  assert.equal(isDirtyExcludingCodeMap('?? .code-map/x\n M src/app.py\n'), true);
});

test('isDirtyExcludingCodeMap: clean / empty → not dirty', () => {
  assert.equal(isDirtyExcludingCodeMap(''), false);
  assert.equal(isDirtyExcludingCodeMap('\n'), false);
});

test('isDirtyExcludingCodeMap: rename uses the arrow target path', () => {
  assert.equal(isDirtyExcludingCodeMap('R  .code-map/a -> src/b\n'), true);
  assert.equal(isDirtyExcludingCodeMap('R  src/a -> .code-map/b\n'), false);
});

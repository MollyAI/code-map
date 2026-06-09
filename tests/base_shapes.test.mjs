import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImportSpec, ReexportSpec, ParseResult } from '../scripts/lib/extractors/base.mjs';

test('ImportSpec carries bindings (default empty)', () => {
  assert.deepEqual(ImportSpec('./m'), { raw: './m', qualified: null, alias: null, bindings: [] });
  const b = [{ local: 'B', imported: 'A' }];
  assert.deepEqual(ImportSpec('./m', './m', 'm', b).bindings, b);
});

test('ReexportSpec shape', () => {
  assert.deepEqual(ReexportSpec('./m'), { source: './m', names: [], star: false, alias: null });
  assert.deepEqual(
    ReexportSpec('./m', [{ local: 'c', imported: 'b' }], false, null).names,
    [{ local: 'c', imported: 'b' }]);
});

test('ParseResult carries reexports (default empty)', () => {
  const r = ParseResult([], [], []);
  assert.deepEqual(r.reexports, []);
  assert.deepEqual(ParseResult([], [], [], [ReexportSpec('./m')]).reexports, [ReexportSpec('./m')]);
});

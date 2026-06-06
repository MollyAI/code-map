import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNodesByPath, nodeIdsForCommit } from '../data/githistory.js';

test('buildNodesByPath: path → 同文件多个类 id', () => {
  const m = buildNodesByPath([
    { classes: [{ id: 'a.A', path: 'src/a.ts' }, { id: 'a.B', path: 'src/a.ts' }] },
    { classes: [{ id: 'c.C', path: 'src/c.kt' }, { id: 'x.X' /* no path */ }] },
  ]);
  assert.deepEqual(m.get('src/a.ts'), ['a.A', 'a.B']);
  assert.deepEqual(m.get('src/c.kt'), ['c.C']);
  assert.equal(m.has(undefined), false);
});

test('nodeIdsForCommit: 改动文件取并集,未命中文件忽略', () => {
  const m = buildNodesByPath([{ classes: [
    { id: 'a.A', path: 'src/a.ts' }, { id: 'a.B', path: 'src/a.ts' }, { id: 'c.C', path: 'src/c.kt' },
  ] }]);
  const ids = nodeIdsForCommit({ files: ['src/a.ts', 'docs/readme.md'] }, m);
  assert.deepEqual([...ids].sort(), ['a.A', 'a.B']);
  assert.equal(nodeIdsForCommit({ files: [] }, m).size, 0);
  assert.equal(nodeIdsForCommit({}, m).size, 0);
});

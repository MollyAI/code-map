import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../scripts/lib/ts.mjs';
import * as c from '../scripts/lib/extractors/c.mjs';

test('c extractor: struct + function with kind/name/line/refs/namespace', async () => {
  await init();
  const src = [
    '#include <stdio.h>',
    '',
    'struct Point {',
    '    int x;',
    '    int y;',
    '};',
    '',
    'int add(int a, int b) {',
    '    return helper(a, b);',
    '}',
    '',
  ].join('\n');
  const res = await c.parse('src/geom/point.c', src, '/proj');
  const kinds = res.declarations.map((d) => `${d.kind}:${d.name}`).sort();
  assert.deepEqual(kinds, ['function:add', 'struct:Point']);

  const point = res.declarations.find((d) => d.name === 'Point');
  assert.equal(point.line, 3);
  // 'src' prefix is stripped from the path-derived namespace
  assert.equal(point.namespace, 'geom.point');

  const add = res.declarations.find((d) => d.name === 'add');
  assert.equal(add.line, 8);
  assert.equal(add.visibility, 'public'); // non-static = public
  assert.ok(add.refs.includes('helper'), `refs were ${JSON.stringify(add.refs)}`);

  // #include must NOT synthesize refs/edges
  assert.deepEqual(res.imports.map((i) => i.raw), ['stdio.h']);
  assert.equal(res.imports[0].qualified, null);
});

test('c extractor: static function is visibility private; typedef + pointer declarator', async () => {
  await init();
  const src = [
    'typedef struct Node Node;',
    '',
    'static int *make(void) {',
    '    return alloc();',
    '}',
    '',
  ].join('\n');
  const res = await c.parse('util.c', src, '/proj');

  const make = res.declarations.find((d) => d.name === 'make');
  assert.ok(make, `decls were ${JSON.stringify(res.declarations.map((d) => d.name))}`);
  assert.equal(make.kind, 'function');
  assert.equal(make.visibility, 'private'); // static = private
  assert.equal(make.line, 3);
  assert.ok(make.refs.includes('alloc'), `refs were ${JSON.stringify(make.refs)}`);

  const td = res.declarations.find((d) => d.kind === 'typedef');
  assert.ok(td, `decls were ${JSON.stringify(res.declarations.map((d) => `${d.kind}:${d.name}`))}`);
  assert.equal(td.name, 'Node');
});

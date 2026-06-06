import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../scripts/lib/ts.mjs';
import * as dart from '../scripts/lib/extractors/dart.mjs';

test('dart extractor: class supertypes + constructor ref + namespace + method_count', async () => {
  await init();
  const src = 'class Repo extends Base implements Cache {\n' +
    '  void load() {\n' +
    '    var x = new Thing(1);\n' +
    '  }\n' +
    '}\n';
  const res = await dart.parse('lib/data/repo.dart', src, '/proj');
  const repo = res.declarations.find((d) => d.name === 'Repo');
  assert.ok(repo, 'Repo decl present');
  assert.equal(repo.kind, 'class');
  assert.equal(repo.line, 1);
  assert.equal(repo.namespace, 'data.repo'); // leading lib/ stripped
  assert.deepEqual(repo.supertypes, ['Base', 'Cache']);
  assert.ok(repo.refs.includes('Thing'), `refs were ${JSON.stringify(repo.refs)}`);
  assert.equal(repo.method_count, 1);
});

test('dart extractor: enum + top-level function with signature', async () => {
  await init();
  const src = "import 'package:flutter/material.dart';\n\n" +
    'enum Color { red, green }\n\n' +
    'int compute(int n) {\n' +
    '  return n;\n' +
    '}\n';
  const res = await dart.parse('lib/util.dart', src, '/proj');
  const kinds = res.declarations.map((d) => `${d.kind}:${d.name}`).sort();
  assert.deepEqual(kinds, ['enum:Color', 'function:compute']);

  const fn = res.declarations.find((d) => d.name === 'compute');
  assert.equal(fn.line, 5);
  assert.equal(fn.namespace, 'util');
  assert.equal(fn.signature, 'int compute(int n)');

  // import URI is surfaced as an ImportSpec
  assert.ok(res.imports.some((i) => i.qualified === 'package:flutter/material.dart'));
});

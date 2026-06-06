import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../scripts/lib/ts.mjs';
import * as py from '../scripts/lib/extractors/python.mjs';
import { textOf, runQuery } from '../scripts/lib/extractors/_common.mjs';
import { loadLanguage, makeQuery, Parser } from '../scripts/lib/ts.mjs';

test('python extractor: class + function with kind/line/refs/namespace', async () => {
  await init();
  const src = 'import os\n\nclass Service:\n    def run(self):\n        helper()\n\ndef helper():\n    return 1\n';
  const res = await py.parse('pkg/svc.py', src, '/proj');
  const kinds = res.declarations.map((d) => `${d.kind}:${d.name}`).sort();
  assert.deepEqual(kinds, ['class:Service', 'function:helper']);
  const svc = res.declarations.find((d) => d.name === 'Service');
  assert.equal(svc.line, 3);
  assert.equal(svc.namespace, 'pkg.svc');
  assert.ok(svc.refs.includes('helper'), `refs were ${JSON.stringify(svc.refs)}`);
  assert.equal(svc.method_count, 1);
});

test('python extractor: supertypes + dotted-call ref tail', async () => {
  await init();
  const src = 'class Repo(Base, db.Mixin):\n    def save(self):\n        self.conn.commit()\n';
  const res = await py.parse('repo.py', src, '/proj');
  const repo = res.declarations.find((d) => d.name === 'Repo');
  assert.deepEqual(repo.supertypes, ['Base', 'db.Mixin']);
  assert.ok(repo.refs.includes('commit'), `refs were ${JSON.stringify(repo.refs)}`);
});

test('__init__.py namespace drops the __init__ tail', async () => {
  await init();
  const res = await py.parse('pkg/__init__.py', 'class A:\n    pass\n', '/proj');
  assert.equal(res.declarations[0].namespace, 'pkg');
});

test('runQuery yields per-match capture dicts in order', async () => {
  await init();
  const lang = await loadLanguage('python');
  const parser = new Parser(); parser.setLanguage(lang);
  const tree = parser.parse('class A:\n    pass\nclass B:\n    pass\n');
  const q = makeQuery(lang, '(class_definition name: (identifier) @name) @decl');
  const got = [];
  for (const caps of runQuery(q, tree.rootNode)) got.push(textOf(caps.name[0]));
  assert.deepEqual(got, ['A', 'B']);
});

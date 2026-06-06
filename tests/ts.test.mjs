import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init, loadLanguage, makeQuery, Parser } from '../scripts/lib/ts.mjs';

test('loads python grammar and queries a class name', async () => {
  await init();
  const lang = await loadLanguage('python');
  const q = makeQuery(lang, '(class_definition name: (identifier) @name)');
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse('class Foo:\n    pass\n');
  const names = q.captures(tree.rootNode)
    .filter((c) => c.name === 'name')
    .map((c) => c.node.text);
  assert.deepEqual(names, ['Foo']);
});

test('a second language loads alongside the first (cache + ABI ok)', async () => {
  await init();
  const go = await loadLanguage('go');
  const parser = new Parser();
  parser.setLanguage(go);
  const tree = parser.parse('package main\nfunc Run() {}\n');
  const q = makeQuery(go, '(function_declaration name: (identifier) @name)');
  const names = q.captures(tree.rootNode).map((c) => c.node.text);
  assert.deepEqual(names, ['Run']);
});

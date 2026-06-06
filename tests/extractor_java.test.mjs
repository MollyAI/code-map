import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../scripts/lib/ts.mjs';
import * as java from '../scripts/lib/extractors/java.mjs';

test('java extractor: class with namespace, supertypes, refs, method_count', async () => {
  await init();
  const src = [
    'package com.example.app;',
    '',
    'import java.util.List;',
    '',
    'public class Service extends Base implements Runnable {',
    '    public void run() {',
    '        helper();',
    '        Widget w = new Widget();',
    '    }',
    '}',
  ].join('\n');
  const res = await java.parse('src/Service.java', src, '/proj');
  const svc = res.declarations.find((d) => d.name === 'Service');
  assert.ok(svc, 'Service decl present');
  assert.equal(svc.kind, 'class');
  assert.equal(svc.line, 5);
  assert.equal(svc.namespace, 'com.example.app');
  assert.deepEqual(svc.supertypes, ['Base', 'Runnable']);
  assert.ok(svc.refs.includes('helper'), `refs were ${JSON.stringify(svc.refs)}`);
  assert.ok(svc.refs.includes('Widget'), `refs were ${JSON.stringify(svc.refs)}`);
  assert.ok(svc.refs.includes('java.util.List'), `refs were ${JSON.stringify(svc.refs)}`);
  assert.equal(svc.method_count, 1);
});

test('java extractor: interface, record, enum kinds', async () => {
  await init();
  const src = [
    'interface Shape {}',
    'record Point(int x, int y) {}',
    'enum Color { RED, GREEN }',
  ].join('\n');
  const res = await java.parse('Shapes.java', src, '/proj');
  const kinds = res.declarations.map((d) => `${d.kind}:${d.name}`).sort();
  assert.deepEqual(kinds, ['enum:Color', 'interface:Shape', 'record:Point']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../scripts/lib/ts.mjs';
import * as cpp from '../scripts/lib/extractors/cpp.mjs';

test('cpp extractor: namespaced class with inheritance + method_count + refs', async () => {
  await init();
  const src = [
    '#include <vector>',
    '#include "engine/core.h"',
    '',
    'namespace app {',
    '',
    'class Engine : public Base, private util::Mixin {',
    'public:',
    '  void run() {',
    '    helper();',
    '    auto* p = new Widget();',
    '  }',
    '  int tick() { return 0; }',
    '};',
    '',
    'void freeFunc() {',
    '  doThing();',
    '}',
    '',
    '}  // namespace app',
    '',
  ].join('\n');

  const res = await cpp.parse('src/engine/engine.cpp', src, '/proj');

  const engine = res.declarations.find((d) => d.name === 'Engine');
  assert.ok(engine, 'Engine class declaration present');
  assert.equal(engine.kind, 'class');
  assert.equal(engine.line, 6);
  assert.equal(engine.namespace, 'app');
  assert.deepEqual(engine.supertypes, ['Base', 'util::Mixin']);
  assert.equal(engine.method_count, 2);
  assert.ok(engine.refs.includes('helper'), `refs were ${JSON.stringify(engine.refs)}`);
  assert.ok(engine.refs.includes('Widget'), `refs were ${JSON.stringify(engine.refs)}`);

  const fn = res.declarations.find((d) => d.name === 'freeFunc');
  assert.ok(fn, 'free function declaration present');
  assert.equal(fn.kind, 'function');
  assert.equal(fn.namespace, 'app');
  assert.ok(fn.refs.includes('doThing'), `refs were ${JSON.stringify(fn.refs)}`);

  // includes parsed as imports
  const aliases = res.imports.map((i) => i.alias).sort();
  assert.deepEqual(aliases, ['core.h', 'vector']);
});

test('cpp extractor: file-path namespace when no enclosing namespace; enum + struct', async () => {
  await init();
  const src = [
    'enum Color { RED, GREEN, BLUE };',
    'struct Point { int x; int y; };',
    '',
  ].join('\n');
  const res = await cpp.parse('lib/geom/shapes.cpp', src, '/proj');

  const kinds = res.declarations.map((d) => `${d.kind}:${d.name}`).sort();
  assert.deepEqual(kinds, ['enum:Color', 'struct:Point']);
  const color = res.declarations.find((d) => d.name === 'Color');
  // 'lib' prefix stripped by pathToNamespace
  assert.equal(color.namespace, 'geom.shapes');
  assert.equal(color.line, 1);
});

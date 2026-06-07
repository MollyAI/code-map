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

test('cpp extractor: recovers a free function inside a #ifdef preprocessor block', async () => {
  await init();
  const src = [
    '#ifdef ENABLE_LOGGING',
    'void logMessage() {',
    '  sink();',
    '}',
    '#endif',
    '',
  ].join('\n');
  const res = await cpp.parse('log.cpp', src, '/proj');
  const fn = res.declarations.find((d) => d.name === 'logMessage');
  assert.ok(fn, `decls were ${JSON.stringify(res.declarations.map((d) => d.name))}`);
  assert.equal(fn.kind, 'function');
  assert.ok(fn.refs.includes('sink'), `refs were ${JSON.stringify(fn.refs)}`);
});

test('cpp extractor: same class name in two namespaces is not deduped', async () => {
  await init();
  // dedup must be keyed on the qualified name, never the bare name.
  const src = [
    'namespace a { class Widget { public: void f() {} }; }',
    'namespace b { class Widget { public: void g() {} }; }',
    '',
  ].join('\n');
  const res = await cpp.parse('w.cpp', src, '/proj');
  const widgets = res.declarations.filter((d) => d.name === 'Widget');
  assert.equal(widgets.length, 2, `expected two distinct Widget classes, got ${widgets.length}`);
  assert.deepEqual(widgets.map((w) => w.namespace).sort(), ['a', 'b']);
});

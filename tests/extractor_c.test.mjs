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

test('c extractor: recovers functions inside #if preprocessor blocks', async () => {
  await init();
  // timers.c / croutine.c wrap their whole body in a feature #if — the functions
  // are grandchildren of translation_unit and were previously skipped entirely.
  const src = [
    '#if ( configUSE_TIMERS == 1 )',
    '',
    'void vTimerInit( void ) {',
    '    setup();',
    '}',
    '',
    '#endif',
    '',
  ].join('\n');
  const res = await c.parse('timers.c', src, '/proj');
  const fn = res.declarations.find((d) => d.name === 'vTimerInit');
  assert.ok(fn, `decls were ${JSON.stringify(res.declarations.map((d) => d.name))}`);
  assert.equal(fn.kind, 'function');
  assert.equal(fn.line, 3);
  assert.ok(fn.refs.includes('setup'), `refs were ${JSON.stringify(fn.refs)}`);
});

test('c extractor: dedups same-name definitions across #if/#else branches', async () => {
  await init();
  const src = [
    '#ifdef USE_FAST',
    'int compute( void ) { return fast(); }',
    '#else',
    'int compute( void ) { return slow(); }',
    '#endif',
    '',
    '#ifdef HAVE_EXTRA',
    'void extra( void ) { more(); }',
    '#endif',
    '',
  ].join('\n');
  const res = await c.parse('impl.c', src, '/proj');
  const computes = res.declarations.filter((d) => d.name === 'compute');
  assert.equal(computes.length, 1, `same-name #if/#else defs should dedup to one, got ${computes.length}`);
  const extra = res.declarations.find((d) => d.name === 'extra');
  assert.ok(extra, 'function in a separate #ifdef block is recovered');
});

test('c extractor: recovers a macro-defined function (static portTASK_FUNCTION form)', async () => {
  await init();
  // FreeRTOS declares task bodies via a function-style macro; tree-sitter parses
  // it as a function_definition with a macro_type_specifier and no real name.
  const src = [
    'static portTASK_FUNCTION( prvTimerTask, pvParameters )',
    '{',
    '    processTimers();',
    '}',
    '',
  ].join('\n');
  const res = await c.parse('timers.c', src, '/proj');
  const fn = res.declarations.find((d) => d.name === 'prvTimerTask');
  assert.ok(fn, `decls were ${JSON.stringify(res.declarations.map((d) => d.name))}`);
  assert.equal(fn.kind, 'function');
  assert.equal(fn.visibility, 'private'); // static
  assert.equal(fn.confidence, 'low'); // heuristic recovery
  assert.ok(fn.tags.includes('macro-defined'), `tags were ${JSON.stringify(fn.tags)}`);
  assert.ok(fn.refs.includes('processTimers'), `refs were ${JSON.stringify(fn.refs)}`);
});

test('c extractor: recovers a bare macro-defined function followed by a block', async () => {
  await init();
  const src = [
    'portTASK_FUNCTION( prvIdleTask, pvParameters )',
    '{',
    '    idleWork();',
    '}',
    '',
  ].join('\n');
  const res = await c.parse('tasks.c', src, '/proj');
  const fn = res.declarations.find((d) => d.name === 'prvIdleTask');
  assert.ok(fn, `decls were ${JSON.stringify(res.declarations.map((d) => d.name))}`);
  assert.equal(fn.kind, 'function');
  assert.equal(fn.visibility, 'public'); // no static qualifier
  assert.ok(fn.tags.includes('macro-defined'), `tags were ${JSON.stringify(fn.tags)}`);
  assert.ok(fn.refs.includes('idleWork'), `refs were ${JSON.stringify(fn.refs)}`);
  // the macro name itself must not become a declaration
  assert.ok(!res.declarations.some((d) => d.name === 'portTASK_FUNCTION'), 'macro name is not a decl');
});

test('c extractor: does not misextract a loop-style macro used inside a function body', async () => {
  await init();
  // a FOREACH-style macro looks identical to a function-defining macro, but it
  // lives inside a function body — file-scope-only detection must ignore it.
  const src = [
    'void run( void ) {',
    '    LIST_FOR_EACH( item, list )',
    '    {',
    '        process( item );',
    '    }',
    '}',
    '',
  ].join('\n');
  const res = await c.parse('run.c', src, '/proj');
  const names = res.declarations.map((d) => d.name).sort();
  assert.deepEqual(names, ['run'], `only the real function expected, got ${JSON.stringify(names)}`);
});

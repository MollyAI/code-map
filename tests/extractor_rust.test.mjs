import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../scripts/lib/ts.mjs';
import * as rust from '../scripts/lib/extractors/rust.mjs';

test('rust extractor: struct/trait/fn with kind/name/line, trait supertypes, namespace', async () => {
  await init();
  const src = [
    'use std::collections::HashMap;',
    'use foo::bar::Baz as Qux;',
    '',
    'struct Service {',
    '    count: u32,',
    '}',
    '',
    'trait Run : Send + Sync {',
    '    fn run(&self);',
    '}',
    '',
    'impl Service {',
    '    fn start(&self) {',
    '        helper();',
    '        println!("go");',
    '    }',
    '}',
    '',
    'fn helper() -> u32 {',
    '    1',
    '}',
    '',
  ].join('\n');
  const res = await rust.parse('src/api/order.rs', src, '/proj');

  const kinds = res.declarations.map((d) => `${d.kind}:${d.name}`).sort();
  assert.deepEqual(kinds, ['function:helper', 'struct:Service', 'trait:Run']);

  const svc = res.declarations.find((d) => d.name === 'Service');
  assert.equal(svc.line, 4);
  assert.equal(svc.namespace, 'api.order'); // src/ dropped
  assert.equal(svc.method_count, 1); // start() counted from impl block

  const run = res.declarations.find((d) => d.name === 'Run');
  assert.deepEqual([...run.supertypes].sort(), ['Send', 'Sync']);
  assert.equal(run.method_count, 1); // fn run signature in trait body

  // imports: alias from `as`, qualified before ` as `
  const aliasImp = res.imports.find((i) => i.raw.includes(' as '));
  assert.equal(aliasImp.qualified, 'foo::bar::Baz');
  assert.equal(aliasImp.alias, 'Qux');
  const plainImp = res.imports.find((i) => i.raw === 'std::collections::HashMap');
  assert.equal(plainImp.alias, 'HashMap');

  const fn = res.declarations.find((d) => d.name === 'helper');
  assert.equal(fn.kind, 'function');
  assert.ok(fn.signature.startsWith('fn helper'), `signature was ${JSON.stringify(fn.signature)}`);
});

test('rust extractor: body refs include calls + macro names', async () => {
  await init();
  const src = [
    'fn driver() {',
    '    do_work();',
    '    obj.method();',
    '    Type::assoc();',
    '    println!("x");',
    '}',
    '',
  ].join('\n');
  const res = await rust.parse('lib.rs', src, '/proj');
  const drv = res.declarations.find((d) => d.name === 'driver');
  assert.equal(drv.namespace, null); // lib.rs filename dropped -> empty -> null
  for (const expected of ['do_work', 'method', 'assoc', 'println']) {
    assert.ok(drv.refs.includes(expected), `refs ${JSON.stringify(drv.refs)} missing ${expected}`);
  }
});

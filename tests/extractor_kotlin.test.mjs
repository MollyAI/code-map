import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../scripts/lib/ts.mjs';
import * as kt from '../scripts/lib/extractors/kotlin.mjs';

test('kotlin extractor: class + interface with kind/name/line/namespace/supertypes', async () => {
  await init();
  const src = [
    'package com.app.domain',
    '',
    'import com.app.data.Repo',
    '',
    'interface Service',
    '',
    'class OrderService(val repo: Repo) : Service {',
    '    fun run() {',
    '        Repo()',
    '    }',
    '}',
  ].join('\n');
  const res = await kt.parse('src/Order.kt', src, '/proj');
  const kinds = res.declarations.map((d) => `${d.kind}:${d.name}`).sort();
  assert.deepEqual(kinds, ['class:OrderService', 'interface:Service']);

  const svc = res.declarations.find((d) => d.name === 'OrderService');
  assert.equal(svc.line, 7);
  assert.equal(svc.namespace, 'com.app.domain');
  assert.deepEqual(svc.supertypes, ['Service']);
  // constructor call resolves to the class via tailName; imports become qualified refs
  assert.ok(svc.refs.includes('Repo'), `refs were ${JSON.stringify(svc.refs)}`);
  assert.ok(svc.refs.includes('com.app.data.Repo'), `refs were ${JSON.stringify(svc.refs)}`);

  const iface = res.declarations.find((d) => d.name === 'Service');
  assert.equal(iface.kind, 'interface');
});

test('kotlin extractor: data/object kinds and @Composable screen', async () => {
  await init();
  const src = [
    'package com.app.ui',
    '',
    'data class User(val id: Int)',
    '',
    'object Registry',
    '',
    '@Composable',
    'fun HomeScreen() {',
    '    render()',
    '}',
    '',
    '@Composable',
    'fun helperWidget() {}',
  ].join('\n');
  const res = await kt.parse('ui/Home.kt', src, '/proj');
  const byName = Object.fromEntries(res.declarations.map((d) => [d.name, d]));

  assert.equal(byName.User.kind, 'data_class');
  assert.equal(byName.Registry.kind, 'object');
  // @Composable + Screen suffix => emitted as composable_function.
  assert.ok(byName.HomeScreen, 'HomeScreen should be emitted');
  assert.equal(byName.HomeScreen.kind, 'composable_function');
  // @Composable without a presentation suffix => not emitted.
  assert.ok(!byName.helperWidget, 'helperWidget should NOT be emitted');
});

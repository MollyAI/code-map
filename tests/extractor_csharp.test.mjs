import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../scripts/lib/ts.mjs';
import * as cs from '../scripts/lib/extractors/csharp.mjs';

test('csharp extractor: block-scoped namespace, supertypes, refs, method_count', async () => {
  await init();
  const src = [
    'using System;',
    'using System.Collections.Generic;',
    '',
    'namespace App.Services',
    '{',
    '    public interface IRepo { }',
    '',
    '    public class OrderService : IRepo, IDisposable',
    '    {',
    '        public void Run()',
    '        {',
    '            var repo = new Repository();',
    '            repo.Save();',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');
  const res = await cs.parse('src/OrderService.cs', src, '/proj');

  const kinds = res.declarations.map((d) => `${d.kind}:${d.name}`).sort();
  assert.deepEqual(kinds, ['class:OrderService', 'interface:IRepo']);

  const svc = res.declarations.find((d) => d.name === 'OrderService');
  assert.equal(svc.namespace, 'App.Services');
  assert.equal(svc.line, 8);
  assert.deepEqual(svc.supertypes, ['IRepo', 'IDisposable']);
  assert.equal(svc.method_count, 1);
  assert.ok(svc.refs.includes('Repository'), `refs were ${JSON.stringify(svc.refs)}`);
  assert.ok(svc.refs.includes('Save'), `refs were ${JSON.stringify(svc.refs)}`);
  // imports contribute qualified refs
  assert.ok(svc.refs.includes('System'), `refs were ${JSON.stringify(svc.refs)}`);

  // imports captured
  const aliases = res.imports.map((i) => i.alias).sort();
  assert.deepEqual(aliases, ['Generic', 'System']);
});

test('csharp extractor: file-scoped namespace + nested type', async () => {
  await init();
  const src = [
    'namespace Acme.Core;',
    '',
    'public struct Point { }',
    '',
    'public class Outer',
    '{',
    '    public enum Color { Red, Green }',
    '}',
    '',
  ].join('\n');
  const res = await cs.parse('Core.cs', src, '/proj');

  const byName = Object.fromEntries(res.declarations.map((d) => [d.name, d]));
  assert.equal(byName.Point.kind, 'struct');
  assert.equal(byName.Point.namespace, 'Acme.Core');
  assert.equal(byName.Outer.kind, 'class');
  assert.equal(byName.Outer.namespace, 'Acme.Core');
  // nested enum accumulates the outer type into its namespace
  assert.equal(byName.Color.kind, 'enum');
  assert.equal(byName.Color.namespace, 'Acme.Core.Outer');
});

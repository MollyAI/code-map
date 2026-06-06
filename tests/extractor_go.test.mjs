import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../scripts/lib/ts.mjs';
import * as go from '../scripts/lib/extractors/go.mjs';

test('go extractor: struct/interface/func/method kinds, namespace, supertypes', async () => {
  await init();
  const src = [
    'package server',
    '',
    'import "net/http"',
    '',
    'type Reader interface {',
    '\tRead() string',
    '}',
    '',
    'type RWCloser interface {',
    '\tReader',
    '\tClose() error',
    '}',
    '',
    'type Server struct {',
    '\tport int',
    '}',
    '',
    'func (s *Server) Start() {',
    '\thelper()',
    '}',
    '',
    'func helper() {',
    '\thttp.Get("x")',
    '}',
    '',
  ].join('\n');
  const res = await go.parse('cmd/api/server.go', src, '/proj');
  const byName = new Map(res.declarations.map((d) => [d.name, d]));

  // kinds
  assert.equal(byName.get('Reader').kind, 'interface');
  assert.equal(byName.get('RWCloser').kind, 'interface');
  assert.equal(byName.get('Server').kind, 'struct');
  assert.equal(byName.get('Start').kind, 'method');
  assert.equal(byName.get('helper').kind, 'function');

  // namespace = parent dir + package
  assert.equal(byName.get('Server').namespace, 'cmd.api.server');

  // line is 1-indexed
  assert.equal(byName.get('Reader').line, 5);

  // interface method_count counts method_spec entries (RWCloser: only Close; embed not a method_spec)
  assert.equal(byName.get('Reader').method_count, 1);
  assert.equal(byName.get('RWCloser').method_count, 1);

  // struct method_count from receiver tally (same-file)
  assert.equal(byName.get('Server').method_count, 1);

  // body refs resolve trailing name of selector call
  assert.ok(byName.get('Start').refs.includes('helper'), `refs=${JSON.stringify(byName.get('Start').refs)}`);
  assert.ok(byName.get('helper').refs.includes('Get'), `refs=${JSON.stringify(byName.get('helper').refs)}`);

  // imports
  assert.equal(res.imports.length, 1);
  assert.equal(res.imports[0].raw, 'net/http');
  assert.equal(res.imports[0].alias, 'http');
});

test('go extractor: type_alias kind + func signature, root-level package namespace', async () => {
  await init();
  // *func* (pointer-typed) alias is a type_spec → kind type_alias; bare `= string`
  // parses to a `type_alias` node this grammar doesn't expose as type_spec.
  const src = [
    'package main',
    '',
    'type Handler func(int) error',
    '',
    'func main() {',
    '}',
    '',
  ].join('\n');
  const res = await go.parse('main.go', src, '/proj');
  const byName = new Map(res.declarations.map((d) => [d.name, d]));

  assert.equal(byName.get('Handler').kind, 'type_alias');
  assert.equal(byName.get('main').kind, 'function');
  // no parent dir → namespace is just the package
  assert.equal(byName.get('main').namespace, 'main');
  // signature present for function
  assert.ok(byName.get('main').signature.includes('func main'), `sig=${JSON.stringify(byName.get('main').signature)}`);
});

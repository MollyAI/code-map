// NOTE: the tree-sitter-swift grammar wasm (~3.1MB) crashes V8's optimizing
// WASM compiler (Zone OOM) under the default test runner. Run with the
// optimizing tier disabled:  node --liftoff-only --test tests/extractor_swift.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../scripts/lib/ts.mjs';
import * as swift from '../scripts/lib/extractors/swift.mjs';

test('swift extractor: class/struct/protocol/function kind+name+line+supertypes', async () => {
  await init();
  const src = [
    'import Foundation',
    '',
    'protocol Greeter {',
    '    func greet()',
    '}',
    '',
    'struct Point {',
    '    var x: Int',
    '}',
    '',
    'class Service: Greeter {',
    '    func run() {',
    '        helper()',
    '    }',
    '}',
    '',
    'func helper() {',
    '    print("hi")',
    '}',
    '',
  ].join('\n');
  const res = await swift.parse('Sources/App/Svc.swift', src, '/proj');
  const kinds = res.declarations.map((d) => `${d.kind}:${d.name}`).sort();
  assert.deepEqual(kinds, ['class:Service', 'function:helper', 'protocol:Greeter', 'struct:Point']);

  const svc = res.declarations.find((d) => d.name === 'Service');
  assert.equal(svc.kind, 'class');
  assert.equal(svc.line, 11);
  assert.equal(svc.namespace, 'App.Svc'); // "Sources" prefix dropped
  assert.deepEqual(svc.supertypes, ['Greeter']);
  assert.ok(svc.refs.includes('helper'), `refs were ${JSON.stringify(svc.refs)}`);

  // import becomes a ref on every decl that gets impRefs
  assert.ok(svc.refs.includes('Foundation'), `refs were ${JSON.stringify(svc.refs)}`);
});

test('swift extractor: extension folds into same-file type', async () => {
  await init();
  const src = [
    'struct Repo {',
    '    func save() {}',
    '}',
    '',
    'extension Repo: Codable {',
    '    func load() {',
    '        decode()',
    '    }',
    '}',
    '',
  ].join('\n');
  const res = await swift.parse('Repo.swift', src, '/proj');
  // extension must NOT create a second colliding node
  const repos = res.declarations.filter((d) => d.name === 'Repo');
  assert.equal(repos.length, 1, `expected one Repo decl, got ${repos.length}`);
  const repo = repos[0];
  assert.equal(repo.kind, 'struct');
  assert.ok(repo.supertypes.includes('Codable'), `supertypes were ${JSON.stringify(repo.supertypes)}`);
  assert.ok(repo.refs.includes('decode'), `refs were ${JSON.stringify(repo.refs)}`);
  assert.equal(repo.method_count, 2); // save + load
});

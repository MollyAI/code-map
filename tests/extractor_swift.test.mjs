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

test('swift extractor: cross-file extension surfaces member functions, not a type-named node', async () => {
  await init();
  // The RxSwift pattern: one file = one `extension ObservableType { func op }`,
  // with no ObservableType type declared in this file. The operator is the unit.
  const src = [
    'public extension ObservableType {',
    '    func map<R>(_ t: @escaping (Element) -> R) -> Observable<R> {',
    '        Map(source: self, transform: t)',
    '    }',
    '    func filter(_ p: @escaping (Element) -> Bool) -> Observable<Element> {',
    '        Filter(source: self, predicate: p)',
    '    }',
    '}',
    '',
  ].join('\n');
  const res = await swift.parse('RxSwift/Observables/Map.swift', src, '/proj');
  const names = res.declarations.map((d) => d.name).sort();
  assert.ok(names.includes('map'), `expected operator node 'map'; names were ${JSON.stringify(names)}`);
  assert.ok(names.includes('filter'), `expected operator node 'filter'; names were ${JSON.stringify(names)}`);
  assert.ok(
    !names.includes('ObservableType'),
    `must NOT emit a node named after the extended type; names were ${JSON.stringify(names)}`,
  );
  const mapDecl = res.declarations.find((d) => d.name === 'map');
  assert.equal(mapDecl.kind, 'function');
  assert.ok(mapDecl.tags.includes('extension-method'), `tags were ${JSON.stringify(mapDecl.tags)}`);
  assert.ok(mapDecl.refs.includes('Map'), `member refs should carry body callees; refs were ${JSON.stringify(mapDecl.refs)}`);
});

test('swift extractor: foreign-type extension with no methods emits no first-party node', async () => {
  await init();
  // RxCocoa `extension Int: KVORepresentable { init?(...) }` — must not masquerade
  // as a first-party `Int` node, and the conformance init is not an operator.
  const src = [
    'import Foundation',
    'extension Int: KVORepresentable {',
    '    public typealias KVOType = NSNumber',
    '    public init?(KVOValue: KVOType) { self.init(KVOValue.int32Value) }',
    '}',
    '',
  ].join('\n');
  const res = await swift.parse('RxCocoa/Foundation/KVORepresentable+Swift.swift', src, '/proj');
  const names = res.declarations.map((d) => d.name);
  assert.ok(!names.includes('Int'), `must not emit Int as a node; names were ${JSON.stringify(names)}`);
  assert.equal(res.declarations.length, 0, `expected no decls, got ${JSON.stringify(names)}`);
});

test('swift extractor: overloaded extension members collapse to one node per name', async () => {
  await init();
  // CombineLatest+arity.swift defines many same-named arity overloads.
  const src = [
    'extension ObservableType {',
    '    func combineLatest<A>(_ a: A) {}',
    '    func combineLatest<A, B>(_ a: A, _ b: B) {}',
    '    func combineLatest<A, B, C>(_ a: A, _ b: B, _ c: C) {}',
    '}',
    '',
  ].join('\n');
  const res = await swift.parse('RxSwift/Observables/CombineLatest+arity.swift', src, '/proj');
  const cl = res.declarations.filter((d) => d.name === 'combineLatest');
  assert.equal(cl.length, 1, `expected one combineLatest node, got ${cl.length}`);
});

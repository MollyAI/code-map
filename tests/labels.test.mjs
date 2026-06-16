import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignDisplayNames, signatureParts } from '../scripts/lib/labels.mjs';

const D = (name, namespace, path) => ({ name, namespace, path });
const labels = (decls) => { assignDisplayNames(decls); return decls.map((d) => d._display_name ?? d.name); };

test('unique short name keeps its bare label (no display_name)', () => {
  const decls = [D('Gson', 'com.google.gson', 'Gson.java'), D('TypeAdapter', 'com.google.gson', 'TypeAdapter.java')];
  assignDisplayNames(decls);
  assert.equal(decls[0]._display_name, undefined);
  assert.equal(decls[1]._display_name, undefined);
});

test('R3a: generic name fanned out across >=3 sibling modules → module label, name dropped', () => {
  const decls = [
    D('parse', 'scripts.lib.extractors.kotlin', 'scripts/lib/extractors/kotlin.mjs'),
    D('parse', 'scripts.lib.extractors.java', 'scripts/lib/extractors/java.mjs'),
    D('parse', 'scripts.lib.extractors.python', 'scripts/lib/extractors/python.mjs'),
  ];
  assert.deepEqual(labels(decls), ['kotlin', 'java', 'python']);
});

test('R3a: per-dir fanout where filename is constant → distinguishing dir segment', () => {
  const decls = [
    D('main', 'frontends.cli', 'frontends/cli/main.py'),
    D('main', 'frontends.discord', 'frontends/discord/main.py'),
    D('main', 'frontends.slack', 'frontends/slack/main.py'),
  ];
  assert.deepEqual(labels(decls), ['cli', 'discord', 'slack']);
});

test('R3b: generic name across <FANOUT_THRESHOLD modules keeps name → module:name', () => {
  const decls = [D('run', 'src.server', 'src/server.ts'), D('run', 'src.engine', 'src/engine.ts')];
  assert.deepEqual(labels(decls), ['server:run', 'engine:run']);
});

test('R3b: non-generic collision keeps the name visible', () => {
  const decls = [D('Config', 'app.api', 'app/api/config.ts'), D('Config', 'app.db', 'app/db/config.ts')];
  assert.deepEqual(labels(decls), ['api:Config', 'db:Config']);
});

test('uniqueness repair: one module owning two fanned-out generics is disambiguated', () => {
  const decls = [
    D('parse', 'x.extractors.kotlin', 'x/extractors/kotlin.mjs'),
    D('parse', 'x.extractors.java', 'x/extractors/java.mjs'),
    D('parse', 'x.extractors.go', 'x/extractors/go.mjs'),
    D('ensure', 'x.extractors.kotlin', 'x/extractors/kotlin.mjs'),
    D('ensure', 'x.extractors.java', 'x/extractors/java.mjs'),
    D('ensure', 'x.extractors.go', 'x/extractors/go.mjs'),
  ];
  const out = labels(decls);
  assert.equal(out[0], 'kotlin:parse');
  assert.equal(out[3], 'kotlin:ensure');
  assert.equal(new Set(out).size, out.length, `labels not unique: ${JSON.stringify(out)}`);
});

test('Go method collision: receiver in namespace disambiguates same-package methods', () => {
  const decls = [D('Close', 'net.srv.Server', 'net/srv.go'), D('Close', 'net.srv.Conn', 'net/srv.go')];
  assert.deepEqual(labels(decls), ['Server:Close', 'Conn:Close']);
});

test('all display labels are globally unique', () => {
  const decls = [
    D('parse', 'a.kotlin', 'a/kotlin.mjs'), D('parse', 'a.java', 'a/java.mjs'), D('parse', 'a.go', 'a/go.mjs'),
    D('run', 'b.server', 'b/server.ts'), D('run', 'b.engine', 'b/engine.ts'),
    D('Gson', 'g', 'Gson.java'),
  ];
  assignDisplayNames(decls);
  const lbl = decls.map((d) => d._display_name ?? d.name);
  assert.equal(new Set(lbl).size, lbl.length, JSON.stringify(lbl));
});

test('R3b: same qualifiedName overloads split by distinct signature', () => {
  const decls = [
    { name: 'observeWeaklyKeyPathFor', namespace: 'RxCocoa.Foundation.NSObject+Rx',
      path: 'Foundation/NSObject+Rx.swift', signature: 'func observeWeaklyKeyPathFor(_:options:) -> Observable<T?>' },
    { name: 'observeWeaklyKeyPathFor', namespace: 'RxCocoa.Foundation.NSObject+Rx',
      path: 'Foundation/NSObject+Rx.swift', signature: 'func observeWeaklyKeyPathFor(_:options:) -> Observable<T>' },
  ];
  assignDisplayNames(decls);
  const lbl = decls.map((d) => d._display_name ?? d.name);
  assert.equal(new Set(lbl).size, 2, `labels must be distinct: ${JSON.stringify(lbl)}`);
  assert.ok(lbl.every((s) => s.includes('observeWeaklyKeyPathFor')));
});

test('R3b: truly identical decls (same qname + same signature) stay equal (assertion catches them)', () => {
  const decls = [
    { name: 'f', namespace: 'a.b', path: 'a/b.swift', signature: 'func f() -> Int' },
    { name: 'f', namespace: 'a.b', path: 'a/b.swift', signature: 'func f() -> Int' },
  ];
  assignDisplayNames(decls);
  const lbl = decls.map((d) => d._display_name ?? d.name);
  assert.equal(lbl[0], lbl[1], 'genuine duplicates are left for a human to merge');
});

// --- Task 1: signatureParts ------------------------------------------------

test('signatureParts: alamofire publishData → return type after stripping attrs/defaults', () => {
  const sig = '@available(macOS 10.15, iOS 13, watchOS 6, tvOS 13, *) public func publishData(queue: DispatchQueue = .main, preprocessor: any DataPreprocessor = DataResponseSerializer.defaultDataPreprocessor, emptyResponseCodes: Set<Int> = DataResponseSerializer.defaultEmptyResponseCodes, emptyRequestMethods: Set<HTTPMethod> = DataResponseSerializer.defaultEmptyRequestMethods) -> DataResponsePublisher<Data>';
  const p = signatureParts(sig, 'publishData');
  assert.equal(p.returnType, 'DataResponsePublisher<Data>');
  assert.equal(p.selector, 'queue: DispatchQueue, preprocessor: any DataPreprocessor, emptyResponseCodes: Set<Int>, emptyRequestMethods: Set<HTTPMethod>');
});

test('signatureParts: generics after name and trailing where-clause are skipped', () => {
  const sig = '@available(macOS 10.15, *) public func publishResponse<Serializer: ResponseSerializer, T>(using serializer: Serializer, on queue: DispatchQueue = .main) -> DataResponsePublisher<T> where Serializer.SerializedObject == T';
  const p = signatureParts(sig, 'publishResponse');
  assert.equal(p.returnType, 'DataResponsePublisher<T>');
  assert.equal(p.selector, 'using serializer: Serializer, on queue: DispatchQueue');
});

test('signatureParts: nested parens in defaults (JSONDecoder()) balance correctly', () => {
  const sig = 'public func publishDecodable<T: Decodable>(type: T.Type = T.self, decoder: any DataDecoder = JSONDecoder()) -> DataStreamPublisher<T>';
  const p = signatureParts(sig, 'publishDecodable');
  assert.equal(p.returnType, 'DataStreamPublisher<T>');
  assert.equal(p.selector, 'type: T.Type, decoder: any DataDecoder');
});

test('signatureParts: selector-style params (RxSwift) preserved, return type split', () => {
  const p = signatureParts('func observeWeaklyKeyPathFor(_:options:) -> Observable<T?>', 'observeWeaklyKeyPathFor');
  assert.equal(p.returnType, 'Observable<T?>');
  assert.equal(p.selector, '_:options:');
});

test('signatureParts: Python trailing block colon stripped from return type', () => {
  const p = signatureParts('def edit( text: str, editor: str | None = None ) -> str | None:', 'edit');
  assert.equal(p.returnType, 'str | None');
  assert.equal(p.selector, 'text: str, editor: str | None');
});

test('signatureParts: no return type → empty returnType, selector still parsed', () => {
  const p = signatureParts('func onCreate(savedInstanceState: Bundle)', 'onCreate');
  assert.equal(p.returnType, '');
  assert.equal(p.selector, 'savedInstanceState: Bundle');
});

test('signatureParts: unparseable (name not followed by paren) → null', () => {
  assert.equal(signatureParts('let x: Int = 3', 'x'), null);
  assert.equal(signatureParts('', 'foo'), null);
});

// --- Task 2: compact overload differentiator (Repair 3/4) -------------------

test('Repair 3: return-type-distinct overloads → "name → ReturnType" (alamofire)', () => {
  const mk = (ret) => ({ name: 'publishData', namespace: 'Features.Combine',
    path: 'Source/Features/Combine.swift',
    signature: `@available(macOS 10.15, *) public func publishData(queue: DispatchQueue = .main) -> ${ret}` });
  const decls = [mk('DataResponsePublisher<Data>'), mk('DataStreamPublisher<Data>'), mk('DownloadResponsePublisher<Data>')];
  assert.deepEqual(labels(decls), [
    'publishData → DataResponsePublisher<Data>',
    'publishData → DataStreamPublisher<Data>',
    'publishData → DownloadResponsePublisher<Data>',
  ]);
});

test('Repair 3: same return type, distinct params → "name(selector)"', () => {
  const mk = (params) => ({ name: 'foo', namespace: 'a.b', path: 'a/b.swift',
    signature: `func foo(${params}) -> Int` });
  const decls = [mk('x: Int'), mk('x: Int, y: Int')];
  assert.deepEqual(labels(decls), ['foo(x: Int)', 'foo(x: Int, y: Int)']);
});

test('Repair 3: differ in both → "name(selector) → ReturnType"', () => {
  const decls = [
    { name: 'g', namespace: 'a.b', path: 'a/b.swift', signature: 'func g(x: Int) -> A' },
    { name: 'g', namespace: 'a.b', path: 'a/b.swift', signature: 'func g(y: Int) -> A' },
    { name: 'g', namespace: 'a.b', path: 'a/b.swift', signature: 'func g(x: Int) -> B' },
  ];
  const out = labels(decls);
  assert.equal(new Set(out).size, 3, JSON.stringify(out));
  assert.ok(out.every((s) => s.startsWith('g(')), JSON.stringify(out));
});

test('Repair 4: truly identical decls stay equal (compact scheme cannot separate)', () => {
  const decls = [
    { name: 'f', namespace: 'a.b', path: 'a/b.swift', signature: 'func f() -> Int' },
    { name: 'f', namespace: 'a.b', path: 'a/b.swift', signature: 'func f() -> Int' },
  ];
  const out = labels(decls);
  assert.equal(out[0], out[1]);
});

test('Repair 4: cross-namespace overload clash on same compact label is repaired', () => {
  // Two namespaces, each with two overloads; one return type collides across them.
  const decls = [
    { name: 'foo', namespace: 'A', path: 'A.swift', signature: 'func foo(a: Int) -> Void' },
    { name: 'foo', namespace: 'A', path: 'A.swift', signature: 'func foo(a: Int) -> Int' },
    { name: 'foo', namespace: 'B', path: 'B.swift', signature: 'func foo(b: Int) -> Void' },
    { name: 'foo', namespace: 'B', path: 'B.swift', signature: 'func foo(b: Int) -> Bool' },
  ];
  const out = labels(decls);
  assert.equal(new Set(out).size, 4, `labels must be globally unique: ${JSON.stringify(out)}`);
});

// --- Task 3: distinguisher length cap --------------------------------------

test('distinguisher cap: no common prefix/suffix → shortest unique suffix, not full path', () => {
  const decls = [
    D('MainActivity', 'com.vibe.app.presentation.ui.main', 'app/.../main/MainActivity.kt'),
    D('MainActivity', '$packagename', 'assets/.../$packagename/MainActivity.java'),
  ];
  assert.deepEqual(labels(decls), ['main:MainActivity', '$packagename:MainActivity']);
});

test('distinguisher cap: short middle (<=2 segments) is unchanged', () => {
  const decls = [D('Config', 'app.api', 'app/api/config.ts'), D('Config', 'app.db', 'app/db/config.ts')];
  assert.deepEqual(labels(decls), ['api:Config', 'db:Config']); // identical to pre-cap behavior
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTs } from '../scripts/lib/resolve/typescript.mjs';

const D = (name, ns, path, refs, visibility = 'public') =>
  ({ name, namespace: ns, path, refs: [...refs], visibility, language: 'typescript' });

function ctxFor(fileset) {
  return { root: '/p', tsconfig: { baseUrl: null, paths: {} }, exists: (p) => fileset.has(p) };
}

test('same-file ref resolves to qname (via same-file), strict-ownership rewrite', () => {
  const consumer = D('run', 'm', 'src/m.ts', ['helper', 'unknownGlobal']);
  const helper = D('helper', 'm', 'src/m.ts', [], 'private');
  const decls = [consumer, helper];
  const imports = new Map([['src/m.ts', []]]);
  const out = resolveTs(decls, imports, new Map(), ctxFor(new Set(['/p/src/m.ts'])));
  assert.deepEqual(consumer.refs, ['m.helper']);
  assert.ok(out.resolved.some((e) => e.from === 'm.run' && e.to === 'm.helper' && e.via === 'same-file'));
  assert.equal(out.unresolved.length, 0);
});

test('imported ref through barrel resolves with via=barrel', () => {
  const widget = D('Widget', 'widget', 'src/widget.ts', []);
  const consumer = D('run', 'consumer', 'src/consumer.ts', ['Widget']);
  const decls = [widget, consumer];
  const imports = new Map([['src/consumer.ts', [{ raw: './index', bindings: [{ local: 'Widget', imported: 'Widget' }] }]]]);
  const reexports = new Map([['src/index.ts', [{ source: './widget', names: [], star: true, alias: null }]]]);
  const fileset = new Set(['/p/src/widget.ts', '/p/src/consumer.ts', '/p/src/index.ts']);
  const out = resolveTs(decls, imports, reexports, ctxFor(fileset));
  assert.deepEqual(consumer.refs, ['widget.Widget']);
  const e = out.resolved.find((x) => x.from === 'consumer.run');
  assert.equal(e.to, 'widget.Widget');
  assert.equal(e.via, 'barrel');
  assert.equal(out.stats.barrels_expanded, 1);
});

test('import to external package is audited as external, ref dropped', () => {
  const consumer = D('run', 'm', 'src/m.ts', ['useState']);
  const imports = new Map([['src/m.ts', [{ raw: 'react', bindings: [{ local: 'useState', imported: 'useState' }] }]]]);
  const out = resolveTs([consumer], imports, new Map(), ctxFor(new Set(['/p/src/m.ts'])));
  assert.deepEqual(consumer.refs, []);
  assert.ok(out.unresolved.some((u) => u.from === 'm.run' && u.raw === 'useState' && u.reason === 'external'));
});

test('imported name not exported by target is audited not_exported', () => {
  const target = D('Other', 't', 'src/t.ts', []);
  const consumer = D('run', 'm', 'src/m.ts', ['Missing']);
  const imports = new Map([['src/m.ts', [{ raw: './t', bindings: [{ local: 'Missing', imported: 'Missing' }] }]]]);
  const fileset = new Set(['/p/src/t.ts', '/p/src/m.ts']);
  const out = resolveTs([target, consumer], imports, new Map(), ctxFor(fileset));
  assert.deepEqual(consumer.refs, []);
  assert.ok(out.unresolved.some((u) => u.raw === 'Missing' && u.reason === 'not_exported'));
});

test('unresolved module specifier is audited', () => {
  const consumer = D('run', 'm', 'src/m.ts', ['Gone']);
  const imports = new Map([['src/m.ts', [{ raw: './gone', bindings: [{ local: 'Gone', imported: 'Gone' }] }]]]);
  const out = resolveTs([consumer], imports, new Map(), ctxFor(new Set(['/p/src/m.ts'])));
  assert.ok(out.unresolved.some((u) => u.raw === 'Gone' && u.reason === 'unresolved_specifier'));
});

test('output arrays are deterministically sorted', () => {
  const a = D('a', 'm', 'src/m.ts', ['c', 'b']);
  const b = D('b', 'm', 'src/m.ts', []);
  const c = D('c', 'm', 'src/m.ts', []);
  const out = resolveTs([a, b, c], new Map([['src/m.ts', []]]), new Map(), ctxFor(new Set(['/p/src/m.ts'])));
  assert.deepEqual(a.refs, ['m.b', 'm.c']);
});

test('distinct short names mapping to one qname (aliased imports) count once', () => {
  const widget = D('Widget', 'widget', 'src/widget.ts', []);
  const consumer = D('run', 'consumer', 'src/consumer.ts', ['Widget', 'W2']);
  const imports = new Map([['src/consumer.ts', [
    { raw: './widget', bindings: [{ local: 'Widget', imported: 'Widget' }, { local: 'W2', imported: 'Widget' }] },
  ]]]);
  const fileset = new Set(['/p/src/widget.ts', '/p/src/consumer.ts']);
  const out = resolveTs([widget, consumer], imports, new Map(), ctxFor(fileset));
  assert.deepEqual(consumer.refs, ['widget.Widget']);
  assert.equal(out.stats.edges_resolved, 1);
  assert.equal(out.resolved.filter((e) => e.from === 'consumer.run').length, 1);
});

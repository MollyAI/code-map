import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../scripts/lib/ts.mjs';
import * as ts from '../scripts/lib/extractors/typescript.mjs';

test('typescript extractor: class/interface/function kinds, supertypes, refs, namespace', async () => {
  await init();
  const src = [
    "import { Base } from './base';",
    "export interface Repo extends Base {",
    "  save(): void;",
    "}",
    "export class Service extends Base implements Repo {",
    "  run() {",
    "    helper();",
    "    return new Widget();",
    "  }",
    "}",
    "function helper() { return 1; }",
    "",
  ].join('\n');
  const res = await ts.parse('src/api/svc.ts', src, '/proj');

  const kinds = res.declarations.map((d) => `${d.kind}:${d.name}`).sort();
  assert.deepEqual(kinds, ['class:Service', 'function:helper', 'interface:Repo']);

  const svc = res.declarations.find((d) => d.name === 'Service');
  assert.equal(svc.line, 5);
  assert.equal(svc.namespace, 'api.svc'); // 'src' prefix stripped
  assert.deepEqual(svc.supertypes.sort(), ['Base', 'Repo']);
  assert.ok(svc.refs.includes('helper'), `refs were ${JSON.stringify(svc.refs)}`);
  assert.ok(svc.refs.includes('Widget'), `refs were ${JSON.stringify(svc.refs)}`);
  // import 串不再污染 refs（import 是作用域，不是边）
  assert.ok(!svc.refs.includes('./base'), `refs should not include import strings: ${JSON.stringify(svc.refs)}`);
  assert.equal(svc.method_count, 1);

  const repo = res.declarations.find((d) => d.name === 'Repo');
  assert.deepEqual(repo.supertypes, ['Base']);

  const helper = res.declarations.find((d) => d.name === 'helper');
  assert.ok(helper.signature.includes('function helper'), `sig was ${helper.signature}`);

  assert.equal(res.imports.length, 1);
  assert.equal(res.imports[0].qualified, './base');
  assert.equal(res.imports[0].alias, 'base');
});

test('typescript extractor: .tsx uses tsx grammar and parses JSX-bearing component', async () => {
  await init();
  const src = [
    "export function App() {",
    "  return <div>{render()}</div>;",
    "}",
    "",
  ].join('\n');
  const res = await ts.parse('src/ui/App.tsx', src, '/proj');
  const app = res.declarations.find((d) => d.name === 'App');
  assert.ok(app, 'App declaration found');
  assert.equal(app.kind, 'function');
  assert.equal(app.line, 1);
  assert.ok(app.refs.includes('render'), `refs were ${JSON.stringify(app.refs)}`);
});

test('ts: non-exported function is private; exported is public (R2)', async () => {
  await init();
  const src = 'export function publicApi() { helper(); }\nfunction helper() { return 1; }\n';
  const res = await ts.parse('src/mod.ts', src, '/proj');
  const vis = (n) => res.declarations.find((d) => d.name === n).visibility;
  assert.equal(vis('publicApi'), 'public');
  assert.equal(vis('helper'), 'private');
});

test('typescript extractor: captures import bindings (named/default/namespace + alias)', async () => {
  await init();
  const src = [
    "import Default from './d';",
    "import { A, B as C } from './m';",
    "import * as NS from './ns';",
    "export function use() { A(); }",
    "",
  ].join('\n');
  const res = await ts.parse('src/x.ts', src, '/proj');
  const byRaw = Object.fromEntries(res.imports.map((i) => [i.raw, i.bindings]));
  assert.deepEqual(byRaw['./d'], [{ local: 'Default', imported: 'default' }]);
  assert.deepEqual(byRaw['./m'], [{ local: 'A', imported: 'A' }, { local: 'C', imported: 'B' }]);
  assert.deepEqual(byRaw['./ns'], [{ local: 'NS', imported: '*' }]);
});

test('typescript extractor: captures re-exports (star / named-from / namespace)', async () => {
  await init();
  const src = [
    "export * from './a';",
    "export { x, y as z } from './b';",
    "export * as ns from './c';",
    "export const local = 1;", // NOT a re-export (no source) -> ignored here
    "",
  ].join('\n');
  const res = await ts.parse('src/barrel.ts', src, '/proj');
  const bySrc = Object.fromEntries(res.reexports.map((r) => [r.source, r]));
  assert.equal(bySrc['./a'].star, true);
  assert.equal(bySrc['./a'].alias, null);
  assert.deepEqual(bySrc['./b'].names, [{ local: 'x', imported: 'x' }, { local: 'z', imported: 'y' }]);
  assert.equal(bySrc['./b'].star, false);
  assert.equal(bySrc['./c'].star, true);
  assert.equal(bySrc['./c'].alias, 'ns');
  assert.equal(res.reexports.length, 3);
});

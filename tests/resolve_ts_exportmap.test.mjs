import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExportMaps } from '../scripts/lib/resolve/typescript.mjs';

// decls: minimal {name, namespace, path, visibility, language}
const D = (name, ns, path, visibility = 'public') => ({ name, namespace: ns, path, visibility, language: 'typescript', refs: [] });

test('export map includes own public decls as name->qname', () => {
  const decls = [D('Widget', 'widget', 'src/widget.ts')];
  const ctx = { root: '/p', tsconfig: { baseUrl: null, paths: {} }, exists: (p) => p === '/p/src/widget.ts' };
  const maps = buildExportMaps(decls, new Map(), ctx);
  assert.equal(maps.get('src/widget.ts').get('Widget'), 'widget.Widget');
});

test('export * from barrel transitively re-exports', () => {
  const decls = [D('Widget', 'widget', 'src/widget.ts')];
  const reexportsByFile = new Map([['src/index.ts', [{ source: './widget', names: [], star: true, alias: null }]]]);
  const fileset = new Set(['/p/src/widget.ts', '/p/src/index.ts']);
  const ctx = { root: '/p', tsconfig: { baseUrl: null, paths: {} }, exists: (p) => fileset.has(p) };
  const maps = buildExportMaps(decls, reexportsByFile, ctx);
  assert.equal(maps.get('src/index.ts').get('Widget'), 'widget.Widget');
});

test('export {x as y} from aliases the re-exported name', () => {
  const decls = [D('Inner', 'm', 'src/m.ts')];
  const reexportsByFile = new Map([['src/api.ts', [{ source: './m', names: [{ local: 'Outer', imported: 'Inner' }], star: false, alias: null }]]]);
  const fileset = new Set(['/p/src/m.ts', '/p/src/api.ts']);
  const ctx = { root: '/p', tsconfig: { baseUrl: null, paths: {} }, exists: (p) => fileset.has(p) };
  const maps = buildExportMaps(decls, reexportsByFile, ctx);
  assert.equal(maps.get('src/api.ts').get('Outer'), 'm.Inner');
});

test('re-export cycle is guarded (no infinite loop)', () => {
  const decls = [D('A', 'a', 'src/a.ts')];
  const reexportsByFile = new Map([
    ['src/a.ts', [{ source: './b', names: [], star: true, alias: null }]],
    ['src/b.ts', [{ source: './a', names: [], star: true, alias: null }]],
  ]);
  const fileset = new Set(['/p/src/a.ts', '/p/src/b.ts']);
  const ctx = { root: '/p', tsconfig: { baseUrl: null, paths: {} }, exists: (p) => fileset.has(p) };
  const maps = buildExportMaps(decls, reexportsByFile, ctx);
  assert.equal(maps.get('src/a.ts').get('A'), 'a.A'); // own decl still present, no hang
});

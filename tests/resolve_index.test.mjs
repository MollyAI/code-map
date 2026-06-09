import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProject } from '../scripts/lib/resolve/index.mjs';

test('resolveProject resolves TS decls and leaves non-TS untouched', () => {
  const ts = { name: 'run', namespace: 'm', path: 'src/m.ts', refs: ['helper'], visibility: 'public', language: 'typescript' };
  const helper = { name: 'helper', namespace: 'm', path: 'src/m.ts', refs: [], visibility: 'private', language: 'typescript' };
  const go = { name: 'Serve', namespace: 'srv', path: 'srv.go', refs: ['doThing'], visibility: 'public', language: 'go' };
  const decls = [ts, helper, go];
  const imports = new Map([['src/m.ts', []]]);
  const out = resolveProject(decls, imports, new Map(), {
    root: '/p',
    tsconfig: { baseUrl: null, paths: {} },
    exists: (p) => p === '/p/src/m.ts',
  });
  assert.deepEqual(ts.refs, ['m.helper']);    // TS rewritten to qname
  assert.deepEqual(go.refs, ['doThing']);     // non-TS untouched
  assert.equal(out.stats.files_ts, 1);
});

test('resolveProject with no TS decls returns empty audit', () => {
  const go = { name: 'X', namespace: 'g', path: 'g.go', refs: ['y'], language: 'go' };
  const out = resolveProject([go], new Map(), new Map(), { root: '/p' });
  assert.deepEqual(go.refs, ['y']);
  assert.equal(out.stats.files_ts, 0);
  assert.deepEqual(out.resolved, []);
});

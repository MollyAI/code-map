import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpecifier } from '../scripts/lib/resolve/modres.mjs';

const mkCtx = (fileset, tsconfig = { baseUrl: null, paths: {} }) => ({
  root: '/p',
  tsconfig,
  exists: (p) => fileset.has(p),
});

test('relative import probes extensions', () => {
  const ctx = mkCtx(new Set(['/p/src/a.ts']));
  assert.deepEqual(resolveSpecifier('./a', '/p/src/consumer.ts', ctx), { file: 'src/a.ts', kind: 'relative' });
});

test('relative import probes directory index', () => {
  const ctx = mkCtx(new Set(['/p/src/a/index.ts']));
  assert.deepEqual(resolveSpecifier('./a', '/p/src/consumer.ts', ctx), { file: 'src/a/index.ts', kind: 'relative' });
});

test('relative import written with .js resolves to .ts', () => {
  const ctx = mkCtx(new Set(['/p/src/a.ts']));
  assert.deepEqual(resolveSpecifier('./a.js', '/p/src/consumer.ts', ctx), { file: 'src/a.ts', kind: 'relative' });
});

test('relative import with no file is unresolved', () => {
  const ctx = mkCtx(new Set());
  assert.deepEqual(resolveSpecifier('./missing', '/p/src/consumer.ts', ctx), { unresolved: true });
});

test('tsconfig paths alias resolves via baseUrl', () => {
  const ctx = mkCtx(new Set(['/p/src/widget.ts']), { baseUrl: '/p', paths: { '@/*': ['src/*'] } });
  assert.deepEqual(resolveSpecifier('@/widget', '/p/src/consumer.ts', ctx), { file: 'src/widget.ts', kind: 'alias' });
});

test('alias matched but file missing is unresolved (not external)', () => {
  const ctx = mkCtx(new Set(), { baseUrl: '/p', paths: { '@/*': ['src/*'] } });
  assert.deepEqual(resolveSpecifier('@/widget', '/p/src/consumer.ts', ctx), { unresolved: true });
});

test('bare package is external', () => {
  const ctx = mkCtx(new Set());
  assert.deepEqual(resolveSpecifier('react', '/p/src/consumer.ts', ctx), { external: true });
});

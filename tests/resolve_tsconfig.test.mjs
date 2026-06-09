import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripJsonc, loadTsconfig } from '../scripts/lib/resolve/tsconfig.mjs';
import { resolve as resolvePath } from 'node:path';

test('stripJsonc removes comments and trailing commas', () => {
  const out = stripJsonc('{\n // a\n "x": 1, /* b */\n "y": [2,],\n}');
  assert.deepEqual(JSON.parse(out), { x: 1, y: [2] });
});

test('loadTsconfig reads baseUrl + paths (injected fs)', () => {
  const files = {
    '/p/tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
  };
  const cfg = loadTsconfig('/p', {
    readFile: (p) => files[p],
    exists: (p) => p in files,
  });
  assert.equal(cfg.baseUrl, resolvePath('/p', '.'));
  assert.deepEqual(cfg.paths, { '@/*': ['src/*'] });
});

test('loadTsconfig follows relative extends (base merged, child overrides)', () => {
  const files = {
    '/p/tsconfig.json': JSON.stringify({ extends: './base.json', compilerOptions: { paths: { '@/*': ['src/*'] } } }),
    '/p/base.json': JSON.stringify({ compilerOptions: { baseUrl: './app', paths: { '~/*': ['lib/*'] } } }),
  };
  const cfg = loadTsconfig('/p', { readFile: (p) => files[p], exists: (p) => p in files });
  assert.equal(cfg.baseUrl, resolvePath('/p', './app'));
  assert.deepEqual(cfg.paths, { '~/*': ['lib/*'], '@/*': ['src/*'] });
});

test('loadTsconfig returns empty config when no tsconfig', () => {
  const cfg = loadTsconfig('/p', { readFile: () => { throw new Error('nope'); }, exists: () => false });
  assert.deepEqual(cfg, { baseUrl: null, paths: {} });
});

test('loadTsconfig tolerates JSONC (comments in file content)', () => {
  const files = { '/p/tsconfig.json': '{ // comment\n "compilerOptions": { "baseUrl": "." }\n}' };
  const cfg = loadTsconfig('/p', { readFile: (p) => files[p], exists: (p) => p in files });
  assert.equal(cfg.baseUrl, resolvePath('/p', '.'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dominantUnsupportedLanguage } from '../scripts/analyze.mjs';

test('dominantUnsupportedLanguage: shell-dominated repo triggers', () => {
  const ext = new Map([['.sh', 40], ['.zsh', 12], ['.md', 100]]);
  const r = dominantUnsupportedLanguage(ext, 2); // supportedFileCount=2
  assert.deepEqual(r, { language: 'shell', files: 52 });
});

test('dominantUnsupportedLanguage: supported-dominated repo returns null', () => {
  const ext = new Map([['.py', 100], ['.sh', 3]]); // .py 有 extractor,不在 KNOWN_CODE_EXT
  const r = dominantUnsupportedLanguage(ext, 100);
  assert.equal(r, null);
});

test('dominantUnsupportedLanguage: docs-only / no code returns null', () => {
  assert.equal(dominantUnsupportedLanguage(new Map([['.md', 50], ['.json', 10]]), 0), null);
});

test('dominantUnsupportedLanguage: tie not strictly greater returns null', () => {
  const ext = new Map([['.rb', 5]]);
  assert.equal(dominantUnsupportedLanguage(ext, 5), null); // 5 > 5 为假
});
